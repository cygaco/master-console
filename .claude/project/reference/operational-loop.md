# Operational Loop

Every problem, every session, every task — this is the cycle:

1. **Detect & classify** — What kind of problem? (see reasoning-frameworks.md)
2. **Search memory** — `learnings.jsonl`, `traces.jsonl`, retro BUGS.md, git log
3. **Compare context** — Same problem? Same conditions? Don't reuse blindly.
4. **Select framework** — Use the router. Know why you chose it.
5. **Generate fix/solution** — Multiple options when stakes are high.
6. **Evaluate immediately** — Build passes? Behavior correct? Edge cases?
7. **Score quality** — Level 0-4. Be honest.
8. **Log everything** — Trace to `traces.jsonl`, learning to `learnings.jsonl`.
9. **Revisit** — `/sleep` and `/retro` re-evaluate past fixes.
10. **Update rules** — Patterns that repeat 3x become skills, hygiene rules, or hooks.

## Session Rhythms

- **Start:** Read `.claude/project/memory/systems.jsonl`. Note untested/broken systems. Propose work.
- **After significant work:** `/retro` to capture learnings.
- **After self-modifications:** Update systems manifest, log to events.jsonl (category: `modification`).
- **Pattern repeats 3x:** Create a skill (`/skills:create`).
- **Errors accumulate:** `/learn:conversation` to review and validate pending learnings.
- **Session ending:** `/sleep` or `/session:handoff`.
- **Don't know something:** Research immediately (WebSearch/WebFetch). Don't guess.

## Self-Modification Tracking

When modifying infrastructure (CLAUDE.md, hooks, skills, agents): the `systems-sync.js` hook auto-logs to the centralized logger (category: `modification`). Legacy dual-write to `paths.memory/modifications.jsonl` is still active.

## Systems Manifest

`.claude/project/memory/systems.jsonl` is the structured truth about every system (28 entries). Each entry has: id, status, files, dependencies, test command, diagnostic steps. Update it after creating or modifying systems.

## Background tasks and Windows process hygiene

The harness exposes two ways to keep work alive across tool calls:

- **`Bash run_in_background: true`** — fire-and-forget shell command. The shell exits when its work finishes; if the parent session exits first, the child is orphaned (most painful on Windows where child cleanup is unreliable).
- **`Monitor` tool** — long-running observer keyed to a check expression. Sends a single notification when the condition fires. Lifecycle is tied to the harness, not a shell.

**When to use which:**
- Use **`Monitor`** when you want to be notified on a specific condition (CI finished, file appeared, port opened). It's the right tool for "wait until done."
- Use **`Bash run_in_background`** when you have genuinely independent work to do in parallel AND you have a plan for cleanup. Avoid in the Ralph test phase — orphan risk when the loop unwinds unexpectedly.

**Windows process hygiene:**
- Per-edit hooks that shell out (Prettier, ESLint, etc.) can leak Node processes when timeouts fire. `cmd.exe` wrappers don't honor SIGTERM, so the child survives past the parent's timeout. `scripts/hooks/format.js` keeps the PID of its Prettier child and, when that spawn times out, runs `taskkill /F /T /PID <pid>` on Windows (`SIGKILL` on POSIX) to clean up the tree.
- Run `/scan:node-procs` to see every alive Node process at a glance (PID, start-time, working-set KB, command). Read-only diagnostic — no kill flow in v1.
- If a session leaks tens of Node processes, the framework-level cause is a hook timeout path that doesn't clean its child. Don't reach for `taskkill /FI "IMAGENAME eq node.exe"` and call it a day — find the leaky hook and fix it upstream.
