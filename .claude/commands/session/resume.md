---
description: Pick up the previous session and KEEP GOING — load the handoff, re-establish mode + team + turbo, and start executing the next action autonomously. The human shouldn't have to do anything.
user-invocable: true
says:
  - pick up where we left off
  - resume the session
  - continue from last time
  - session resume
  - run session recovery
  - where were we
says-flags:
  read only: --read-only
---

# /session:resume — Resume and Continue

Cold-start a fresh session into full continuity: read the previous session's prescriptive handoff, re-establish the operating substrate (mode, persistent team, turbo), and **begin executing the next action** — without the operator having to issue any further instruction. The counterpart to `/session:end`: end writes the handoff, resume consumes it and runs.

> **This is the active resume.** The old "read-and-display, no writes" behavior is the first half of Step 1–2 below; the point of this skill is to NOT stop there.

## Input

`/session:resume [--turbo] [--read-only]`

- `--turbo` — re-enter speed mode by calling `/session:turbo` after the substrate is up (re-applies the previous session's authorization profile so you're not asked per-action again). Default: off (honor the standing autonomy table).
- `--read-only` — the OLD behavior: load + display + summarize the handoff and STOP. No mode change, no team, no execution. Use when you just want to see where things were.

## The authorization this skill carries (read this — it's the doctrine reconciliation)

CLAUDE.md says **mode-init ≠ authorization** and an inherited "continue" from a `DUMP.md` / handoff is *context, not a command*. `/session:resume` does NOT violate that — it **satisfies** it: the operator typing `/session:resume` **this session** IS the explicit in-session instruction to pick up and proceed. That single command is the green light that turns the handoff's next-action from inherited context into an authorized command. (Same way `/mode:oneshot "<brief>"` is itself the instruction.)

So: after `/session:resume`, you MAY proceed autonomously through the handoff's next-action **within the standing autonomy bounds** — you still STOP for the genuinely-gated things (irreversible + ambiguous, >$5 spend, push-to-remote unless authorized, a β `ESCALATE`). "The human doesn't have to do anything" means the *happy path* is hands-free, not that ceilings are lifted.

## Procedure

### Step 1 — Load the handoff (priority order, stop at first rich hit)
1. **`DUMP.md`** (project root) — the prescriptive next-session handoff written by `/session:end`. THIS is the primary source — it carries the next-action, in-flight state, operating-model/directive changes, and anti-instructions. Prefer it.
2. `.claude/runtime/handoff.md` — the Layer-1 live git-ground-truth snapshot (per-sid; `handoff-live.js`). Cross-check `DUMP.md` against it for uncommitted/untracked drift.
3. `.claude/runtime/.session-checkpoint.json` — periodic checkpoint (crash fallback).
4. `TRACKER.md` (root) — the enforced source of truth; **outranks the handoff** on any disagreement. Always reconcile the handoff against it.

### Step 2 — Orient (and, if `--read-only`, STOP here)
Read the loaded handoff + `TRACKER.md`. Establish: the active epic/sprint, the next action, blockers, the operating model in force, and any directives the previous session captured. Verify ground truth: `git -C <root> log --oneline -8` + `node scripts/trackers/validate.js` (must be green; if RED, fixing/​surfacing it is the first action). **If `--read-only`: display the handoff + a 3-line summary and STOP — no writes, no mode, no execution.**

### Step 3 — Re-establish the substrate
Bring the operating environment back to where the handoff expects it:
- **Mode + team.** If the handoff indicates sprint/adhoc work in flight, enter the mode (`/mode:sprint` or `/mode:adhoc`) and stand up the persistent team per that mode's Step 1.5/1.75 — plain names (`Epsilon`/`Beta`), reconcile any stale members (step 1.75 reconciliation), confirm BOTH readiness pings before proceeding. **Honor the operating model the handoff names** — e.g. if it says "ε orchestrates, α is the thin substrate-hand," hand ε the orchestration rather than doing the legwork in α.
- **Turbo (`--turbo`).** If `--turbo` was passed, run `/session:turbo` (or `node scripts/turbo/apply.js` with the handoff's prior scope) to re-apply the speed profile. If the handoff notes a still-live grant, just verify it rather than re-granting.
- **Worktrees / branch.** If the handoff says to resume on a specific branch (e.g. an unmerged mid-fix-cycle sprint branch), `git switch` to it. Preserved worktrees named in the handoff are the build surfaces — don't recreate them.

### Step 4 — Execute the next action (autonomously, within bounds)
Begin the handoff's ranked next-action. Drive it through to a natural checkpoint. Under the operating model, that usually means: hand the conducting to ε, be the substrate-hand for the Agent-tool spawns ε can't make, and reserve α for judgment + the operator interface. Keep going across natural sub-steps — the operator invoking this skill authorized the run (see "the authorization this skill carries"). STOP and surface only at a real gate: irreversible+ambiguous, ≥$5 spend, push-to-remote (unless authorized), a β `ESCALATE`, or genuine ambiguity the handoff doesn't resolve.

### Step 5 — Report what you picked up and what you're doing
One concise status: loaded-from + age, the reconciled next-action, substrate re-established (mode/team/turbo/branch), and "executing now — will surface at <the next real gate>." Then proceed.

## Notes / lessons baked in
- **Resume is the authorization, not a bypass of it** — the operator's `/session:resume` command is what makes the inherited next-action runnable; absent that command, a fresh session must NOT auto-run a handoff's "continue" (the mode-init gate). This skill exists precisely so the operator has a one-word "go."
- **`TRACKER.md` outranks the handoff** — if `DUMP.md` and the tracker disagree, the tracker wins; reconcile before executing.
- **Honor the handoff's operating model** — if it says ε orchestrates / α is thin, don't resume by having α do the legwork (the exact drift the model corrects).
- **Ceilings still hold** — hands-free happy path, but irreversible/spend/push/β-ESCALATE still gate.
- **`--read-only` preserves the old behavior** — pure load+display+summarize for when you just want to look.

## Related
- `/session:end` (esp. `--fast`) — writes the `DUMP.md` this skill consumes.
- `/session:turbo` — re-applied by `--turbo`.
- `/session:dump`, `/session:handoff`, `/session:checkpoint` — the handoff artifacts loaded in Step 1.
- `/mode:sprint`, `/mode:adhoc` — the modes + team stood up in Step 3.
- `TRACKER.md` — the enforced source of truth that outranks the handoff.
