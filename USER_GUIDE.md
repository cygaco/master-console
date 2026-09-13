# MC User Guide

How to actually use the system. Not the reference — the workflow.

If you've just installed, start at §1. If you want the mode summary, skip to §2.

---

## 1. First Session (15 min)

1. Install (see [README.md](README.md))
2. Open Claude Code in your project
3. Type `/mc:tour` — guided introduction
4. Type `/mc:health` — verifies every system; reports green/yellow/red
5. Type `/scan:environment` — flags missing provider CLIs (codex for OpenAI, `agy` for Gemini/Antigravity)
6. Type `/mode:solo` — stay solo for your first hour
7. Fix anything red before doing real work

Don't touch the team modes yet. Don't run `/oneshot:preflight`. Don't spawn agents. Just type prompts and watch what fires:
- Every prompt → `smart-context.js` runs, injects relevant memory
- Every Edit/Write → format + typecheck + lint + guards fire
- Every session end → handoff is generated

That's the baseline. Everything else builds on it.

---

## 2. The Three Modes

Pick ONE at a time. Modes are **project-wide and persistent** — whatever you set stays active until you change it, across every terminal you open. You can't have solo in one terminal and adhoc in another simultaneously; switching in any terminal switches for all. Switch with `/mode:solo`, `/mode:adhoc`, `/mode:oneshot`.

| Mode | Who's in the room | When to use |
|---|---|---|
| **solo** | You + Alex α | System tweaking, quick edits, exploratory reading, skill management. Default most of the day. |
| **adhoc** | α + β (judgment) + γ (builder orchestrator) | Building **one feature** with oversight. Gamma dispatches the builder → gauntlet: cross-lab code-quality reviewer → QA-Reviewer (traceability + integrity + 13 personas) → the 3-lab security panel. |
| **oneshot** | δ (standalone) | **End-to-end rebuild of an entire codebase from requirements.** Run when the existing code has drifted badly from its specs or a feature came out muddled. Delta runs a state machine with cycles, fix loops, points, rebuilds feature-by-feature in dependency order. No α/β involved. |

**Starting solo:** just type. You're Alex's pair.

**Starting adhoc:** `/mode:adhoc` → describe the feature. Alpha plans, Beta judges the plan (DECIDE / DIRECTIVE / ESCALATE), Gamma dispatches. Use this when the feature is significant enough to warrant review.

> **Note:** even when it's just you + α in the room (γ idle, no build in flight), α still **probes β** on every non-trivial decision in adhoc mode. You'll see β's DECIDE / DIRECTIVE responses appear in your log. That's the mode doing its job — β is always watching, not just during builds.

**Starting oneshot:** first run `/oneshot:preflight` (non-negotiable — see §5.6), then `/mode:oneshot` → write a skeleton spec → Delta builds every feature in dependency order with full gauntlet between phases. Wake up to either a completed project or a detailed halt report.

**When oneshot makes sense:**
- Cleaning up a project where features came out muddled and need a clean rewrite from spec
- Quality pass: features work but violate your design system / architecture / spec — rebuild them right
- Bootstrapping a new product from spec alone, no code yet (skeleton mode)

**Rule of thumb:** solo for 80% of work, adhoc for real feature builds, oneshot for overnight rebuilds or skeleton-from-scratch runs.

---

## 3. Git Discipline (the #1 thing most new users get wrong)

AI agents move fast and touch many files. Without discipline, you lose work or end up with an unshippable main branch.

1. **`main` stays clean at all times.** Never commit exploratory work to it. Always shippable.
2. **Every feature/fix/experiment gets its own branch.** `feat/auth-flow`, `fix/rate-limit`, `spike/new-prompts`.
3. **Commit often. Push often.** Any time you'd feel bad losing the work → commit. Laptop could die → push. The commit terminal (Terminal 4) is load-bearing.
4. **Test on a branch, not on main.** Oneshot run? Risky refactor? Branch first. If it goes sideways, `git checkout main` and your clean state is intact.
5. **Merge deliberately.** Open a PR (even to yourself), review what changed, then merge.

```bash
# Start of day
git checkout main && git pull
git checkout -b feat/today-thing

# During work (milestone reached)
/commit:both

# End of feature
/qa:check && /redteam:scan
# if green: merge. if red: fix on branch.
```

When a builder agent writes 40 files in 10 minutes, you can't un-think it. **Branches are your undo button. Commits are your save game.**

---

## 4. The Multi-Terminal Setup

Most productivity gains come from running **multiple Claude Code terminals side-by-side in VS Code** (or your IDE). Each terminal has a different job. They talk to each other via the cross-session inbox — `/session:write` + `/session:read`.

Minimum productive setup:

| # | Terminal | Mode | What happens here |
|---|---|---|---|
| 1 | **Main** | `/mode:solo` | Your home base. System questions, quick edits, skill management. Read handoff here, plan the day. |
| 2 | **Team / Build** | `/mode:adhoc` | When building a real feature. Keep this window focused — don't multitask inside it. |
| 3 | **Tools / Skills** | solo | `/skills:create`, `/skills:edit`, `/hooks:add`, updates to paths.json / manifest / docs. "Fixing the factory while the factory runs." |
| 4 | **Commits** | solo | Just runs `/commit:both`. While agents work in Terminal 2, you stage + push from here without interrupting their flow. |

Add a 5th **Research** terminal when you kick off `/research:deep` (15–40 min). Let it run while you work the other four.

### Cross-terminal coordination

When Terminal N finishes something important, it runs `/session:write` with a note **written for another Alex to pick up cold.** Not "done" — enough context that a different terminal, which didn't watch any of this happen, can continue the work.

Bad:
```
/session:write "done"
/session:write "fixed the bug"
```

Good:
```
/session:write "gamma finished auth build on feat/auth. All 6 gauntlet gates passed. Branch pushed to origin. Ready for /commit:both from Terminal 4."
/session:write "investigated the session-crash bug: root cause is TIMEOUT_MS=8000 in smart-context.js, context payload too big at 131 learnings. Fix drafted but not applied — needs β confirm on whether to slice or raise timeout."
```

The rule: **write as if handing off to another session that has no idea what you just did.** Include what happened, what state we're in, and what should happen next.

Terminal M's next prompt automatically reads the inbox via `smart-context.js` and picks up the note. **You don't have to copy-paste between terminals.** Each one independently sees what the others did.

This is the super-charge: one brain across many terminals, stitched together by the inbox.

---

## 4.5 Working a portfolio

MC is also a **portfolio console**. Your products live as sibling repos on disk — each its own private GitHub repo with its own Claude session — and MC is the home base from which you list, status, open, sync, and dispatch across all of them. The `/portfolio:*` skill family is the one namespace for everything product-related.

The core verbs:

| Verb | What it does |
|---|---|
| `/portfolio:list` | One-line summary table of every registered product. |
| `/portfolio:status` | Per-product dashboard: MC version, last commit, dirty count, current sprint, GitHub remote. Parallel probes with 5s per-product timeout — one slow product never blocks the others. |
| `/portfolio:new <slug>` | Scaffold a fresh sibling repo, copy templates, run `/mc:setup`, **auto-create a private GitHub repo** (`gh repo create --private --source=. --remote=origin --push`), and register it. One verb, end-to-end. |
| `/portfolio:adopt <slug>` | Same as `/portfolio:new` but seeded from an existing `_docs/briefs/<slug>/` or `_docs/clones/<slug>/`. Promotes a research deliverable into a real private product. |
| `/portfolio:register <slug> <path>` | Register an existing repo that wasn't scaffolded by MC. |
| `/portfolio:open <slug>` | Print the product's absolute path + a `cd … && claude` hint. With `--spawn`, opens a fresh Claude session in a new terminal window pinned to that repo. |
| `/portfolio:dispatch <slug> /<skill> [args]` | Run any skill against another product's working tree without leaving MC. Spawns a fresh Claude subprocess with `CLAUDE_PROJECT_DIR` set to the target; the current session is never retargeted. |
| `/portfolio:sync` | Run `/mc:update` across every registered product sequentially. No fail-fast — failures captured in the final summary. |
| `/portfolio:bootstrap`, `/portfolio:clone`, `/portfolio:import`, `/portfolio:ponder` | Pre-product research verbs (formerly `/product:*`). |

**Private-by-default.** Every `/portfolio:new` and `/portfolio:adopt` invocation hardcodes `--private`; there is no `--public` path. The GitHub repo is created under your authenticated `gh` user. On gh auth failure, the local repo stays intact and you get a one-line copyable command to finish manually.

**Where products live.** By default, sibling repos land one directory above WarpOS (e.g. if WarpOS is at `~/Projects/WarpOS`, products land at `~/Projects/<slug>`). Override via `--workspace <dir>` or `WARPOS_PORTFOLIO_WORKSPACE`.

**The registry.** `~/.mc/portfolio.json` is the source of truth. Edit only via the skills — they validate the schema and write atomically.

---

## 4.6 Multi-terminal parallel products

Pair this with section 4: each product opens in its own terminal window via `/portfolio:open <slug> --spawn`, and each terminal is an isolated Claude session with its own state, sprint, and context. MC stays the orchestration cockpit; products run in parallel as peer sessions.

Setup pattern:

| Terminal | What it's running | Purpose |
|---|---|---|
| 1 | MC, `/mode:solo` | Home base. `/portfolio:status`, decide what to work on, dispatch into products. |
| 2 | Product A (e.g. your product), `/mode:adhoc` | Build features for product A. |
| 3 | Product B (e.g. another product), `/mode:adhoc` | Build features for product B in parallel. |
| 4 | MC, solo | `/portfolio:sync`, `/skills:create`, tooling work. |

The active-CWD guard fires when you `/portfolio:open <slug> --spawn` against a product whose `repo_path` already equals `process.cwd()` — opening it would just duplicate the session you're in. Pass `--force` to spawn anyway, or stay put.

When no terminal binary is found on PATH (none of wt, powershell, cmd on Windows; iTerm, Terminal.app on macOS; gnome-terminal, xterm on Linux), `/portfolio:open --spawn` falls back gracefully — it prints a copyable `cd <path> && claude` string instead of failing silently.

Cross-terminal coordination uses the same `/session:write` + `/session:read` inbox pattern from section 4. A product session can leave a note that MC picks up on its next prompt — and vice versa. One brain, many terminals, all products visible from one place.

---

## 5. The Bread-and-Butter Command Suites

Six command families cover 90% of daily work.

### 5.1 Learn suite — capture patterns so you don't repeat mistakes

| Skill | Purpose |
|---|---|
| `/learn:deep` | Combined extraction from three sources in parallel — conversation (corrections, surprises), event log (tool hotspots, frustration signals), and oneshot retro files. Dedupes and appends to `paths.learningsFile`. Replaces the old `/learn:conversation` + `/learn:events` + `/learn:combined`. |
| `/learn:ingest <url or file>` | Ingest external knowledge — webpages, YouTube transcripts, research docs. Supports hub crawling: give it `platform.openai.com/docs/models`, it fetches every model page + dependencies. |
| `/learn:integrate` | Promote validated high-score learnings into actual system enforcement (hooks, rules, skills, agent specs, reference docs). |

**When to run:** after any meaningful debugging session, after reading something genuinely useful, at the end of a productive stretch. If you don't capture the pattern, you'll debug it again in 3 weeks.

### 5.2 Reasoning suite — think before acting

| Skill | Purpose |
|---|---|
| `/reasoning:run <problem>` | Auto-routes to quick-triage or deep-deliberate based on the problem's complexity. Picks a framework (First Principles, 5 Whys, OODA, SOLID, etc.), produces structured reasoning, logs to `paths.tracesFile`. |
| `/reasoning:log` | Manually record a reasoning episode after the fact. Categorize what framework you used and why. |
| `/reasoning:score` | Score fix quality (0–4) on a past trace after you have evidence it worked or failed. Retroactive reclassification when new info arrives. |

**When to run:** anything ambiguous, architectural, or high-stakes. The traces form your own lessons-learned dataset — `/sleep:deep` mines them for patterns.

### 5.3 Fix suite — debug + prevent

| Skill | Purpose |
|---|---|
| `/fix:fast <error>` | Direct investigation. Read error, find cause, fix it, verify. No formal framework. For typos, imports, simple logic errors. |
| `/fix:deep <problem>` | Full diagnostic pipeline — automatic framework selection, 5 solution candidates, root-cause analysis, prevention (hook or lint rule proposed). Trace logged. |

**Rule of thumb:** if you're stuck >15 min → `/fix:deep`. Fast is for trivially local issues.

**Always follow fix with capture:** `/fix:deep → /learn:deep`. The fix alone doesn't prevent repeat; the learning does.

### 5.4 Sleep suite — consolidate memory

| Skill | Purpose |
|---|---|
| `/sleep:quick` | Light nap (~5 min). NREM-style consolidation + glymphatic cleanup. Dedupes learnings, compresses old events, refreshes memory indexes. |
| `/sleep:deep` | Full 6-phase cycle (~15–30 min). NREM → cleanup → replay → REM dreaming → repair → growth. Surfaces unexpected connections, proposes improvements, runs `/scan:full --fast` as part of growth phase. |

**When to run:**
- `/sleep:quick` — end of each productive stretch, or when `/mc:health` flags memory bloat
- `/sleep:deep` — once a day, when you're stepping away (not mid-flow)

The sleep cycle isn't ceremony — it actively reshapes the memory that the next session will load. Skipping it = accumulating drift.

### 5.5 Session suite — terminals talking to each other

**This is the super-charging layer.** Multiple terminals become one brain.

| Skill | Purpose |
|---|---|
| `/session:write <note>` | Post a one-line note to the cross-session inbox (stored as `cat:inbox` in `paths.eventsFile`). Every other terminal's next prompt sees it. |
| `/session:read` | Display the last 24 hours of inbox messages. Explicit read; usually you don't need it because `smart-context.js` injects inbox items automatically. |
| `/session:handoff` | Generate a rich handoff document at end-of-session (or manually). Writes to `paths.handoffLatest` and `paths.handoffs/<timestamp>.md`. Next session auto-loads it. |
| `/session:checkpoint` | Force an immediate checkpoint save. Use before a risky operation. |
| `/session:resume` | After `/clear` or a cold start, loads the latest handoff or checkpoint. |
| `/session:history` | Browse past handoffs by timestamp. Useful for "what was I doing last Tuesday?" |

**The super-charging pattern:**

```
Terminal 1 (main):      /session:write "starting adhoc build of auth in terminal 2"
Terminal 2 (adhoc):     [your next prompt auto-sees: "starting adhoc build of auth in terminal 2"]
                        → builds auth. When done:
                        /session:write "auth done, on feat/auth, gates passed"
Terminal 4 (commits):   [next prompt sees the note]
                        → /commit:both
                        → /session:write "auth pushed to origin/feat/auth"
Terminal 1:             [sees everything that happened]
                        → next decision informed by the combined state
```

No copy-paste between windows. Every terminal independently sees the timeline.

### 5.6 Check + Preflight + Retro — system integrity

**Check** — six specialists + one aggregator. Run when you need to know "is the system healthy?"

| Skill | Scope |
|---|---|
| `/scan:architecture` | Do the layers connect? Agents, docs, foundation, seams. |
| `/scan:environment` | Can we build + run? Tools, hooks, paths, provider CLIs. |
| `/scan:patterns` | What patterns keep recurring across runs? Cross-run intelligence. |
| `/scan:references` | Broken links, orphans, stale SPEC_GRAPH edges. |
| `/scan:requirements` | Spec consistency + drift (static + review modes; folded in the old `/reqs:review`). |
| `/scan:system` | System inventory — scan disk vs manifest, flag drift. |
| **`/scan:full`** | **Runs all six in parallel, produces one unified report with ship/block/caution verdict.** Pre-ship gate. |

**Preflight** — the **pre-run** workflow that prepares everything Delta needs **for `/mode:oneshot`**.

ELI5: Oneshot is Delta building your entire codebase overnight. It builds from **skeleton stubs** — one-line placeholder files for every feature, created before the run starts. Delta replaces each stub with real code, phase by phase. Preflight is the bouncer at the door: it makes sure every stub is in place, every spec is consistent, every dependency is declared, and the branch is clean, *before* Delta touches anything. If preflight fails, Delta doesn't start.

The 7 passes preflight runs:
1. **Branch setup** — creates `skeleton-testN` branch off main, ensures clean working tree
2. **Skeleton stubs** — creates one-line placeholder files for every feature Delta will build; Delta replaces these, not empty dirs
3. **Spec consistency** — every feature dir has PRD + STORIES + INPUTS; template versions match; no STALE banners
4. **Environment readiness** — node, git, provider CLIs, API keys, Claude Code settings
5. **Run transition** — archives the previous oneshot's retros; resets the store cycle counter
6. **Architecture** — cross-references between specs are valid; SPEC_GRAPH has no dangling edges
7. **Skeleton check** — every stub file matches an entry in the manifest feature list

| Skill | Purpose |
|---|---|
| `/oneshot:preflight` | Runs the 7 passes above. Only needed for oneshot. |
| `/oneshot:improve` | Update preflight passes based on gaps discovered during runs. |

**Run `/oneshot:preflight` before every `/mode:oneshot` kickoff.** Non-negotiable — Delta's state machine assumes the skeleton + specs + branch are already set up. No other mode needs it; solo and adhoc just work off main.

**Retro** — retrospective analysis. **Best during and after oneshot runs**; also useful at feature boundaries.

| Skill | Purpose |
|---|---|
| `/oneshot:retro` | Full retrospective — context + git log + code diffs + cross-run analysis across all 9 categories. Default = full; args allow surgical access to subsets (e.g. `--context-only`, `--code-only`). Run at the END of a oneshot run or major feature; can also run mid-run for a phase boundary check. |

**Oneshot rhythm:** `/oneshot:retro` (in `--context-only` mode) after each phase → full `/oneshot:retro` at the end → `/learn:deep` to capture. Without this, you lose the expensive intelligence from the run.

---

## 6. The Daily Loop

```
work → milestone → /learn:deep → /sleep:quick → next
```

**Milestone** = a unit you'd describe to a teammate ("auth flow done", "prompt pipeline refactored"). Not too small, not 6 hours long.

Once a day, do a full `/sleep:deep` on a break. It's where patterns become hooks, learnings decay, and Alex evolves.

---

## 7. The Data You're Generating

| Store | Key | Writes when | Used for |
|---|---|---|---|
| Event log | `paths.eventsFile` | Every tool call, prompt, hook fire | Source of truth. Mine with `/learn:deep --events-only`. |
| Learnings | `paths.learningsFile` | `/learn:*`, `/sleep:*` | Long-term patterns, injected into every prompt. |
| Reasoning traces | `paths.tracesFile` | `/reasoning:log`, `/reasoning:run`, `/fix:deep` | Dataset of your problem-solving. |
| Systems manifest | `paths.systemsFile` | `systems-sync.js`, `/scan:system` | Living inventory of what exists. |
| Session logs | `paths.logs/s-<sid>/` | Every prompt (smart-context) | Per-session traces. |
| Handoffs | `paths.handoffs/` + `paths.handoffLatest` | Session stop | Resume after `/clear`. |
| Beta decisions | `paths.betaEvents` | Every Beta DECIDE/DIRECTIVE/ESCALATE | Beta's judgment history. |

Never edit these by hand — `memory-guard` will block. Read them with the skills above or grep.

---

## 8. Troubleshooting

| Symptom | First move |
|---|---|
| `/mc:health` red anywhere | Fix before doing real work |
| Hook blocking a legit command | `/hooks:disable <name>` temporarily; file a `/hooks:friction` note |
| Lost context after `/clear` | `/session:resume` |
| Don't know what the agent did overnight | `/session:history` + read latest handoff |
| Skill doing the wrong thing | `/skills:edit <name>` |
| Agent hanging | Check `paths.logs/s-*` for last entries, restart the terminal |
| Maps out of date | `/maps:all --refresh` |
| Event log is massive | `/sleep:deep` compresses old entries |
| Review agent failed (codex / `agy`) | `/scan:environment` — did you install the provider CLI? |

---

## 9. Anti-Patterns

- **Don't work on main.** Always branch.
- **Don't let work pile up uncommitted.** Terminal 4 should fire every milestone.
- **Don't run team modes for solo tasks.** Agent overhead is real.
- **Don't skip `/learn:deep` after a hard fix.** You'll repeat the debugging.
- **Don't forget `/maps:all` after structural changes.** Stale maps mislead the next session.
- **Don't ignore `/mc:health` yellow items.** They compound.
- **Don't edit `events.jsonl` / `learnings.jsonl` directly.** The guard will block; the system will drift.
- **Don't run oneshot without specs.** It'll build confidently in the wrong direction.
- **Don't skip preflight before oneshot.** Non-negotiable.
- **Don't forget retro during oneshot runs.** The pattern intelligence you lose is the main thing you were there to capture.

---

## 10. Where To Go Next

- [README.md](README.md) — install, quick start, provider CLIs
- [CLAUDE.md](CLAUDE.md) — Alex identity + autonomy rules
- [AGENTS.md](AGENTS.md) — agent system reference
- `.claude/project/reference/` — reasoning frameworks, operational loop, learning lifecycle, SYSTEMS.md
- `_requirements/README.md` — spec templates (fill them in with Alex's help)
- `patterns/` — engineering pattern library
- [ROADMAP.md](ROADMAP.md) — what's shipping next
