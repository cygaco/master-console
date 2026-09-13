<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-TEAMS-MIGRATION-001 — Agent-Teams→Subagents Migration & Orchestration Hardening

- **Epic label and number:** E-TEAMS-MIGRATION-001
- **Title:** Agent-Teams→Subagents Migration & Orchestration Hardening
- **Owner:** President
- **Parent roadmap area:** [ROADMAP.md § Epics → E-TEAMS-MIGRATION-001](../../ROADMAP.md) — externally-triggered platform-alignment epic (Claude Code v2.1.178, 2026-06-15).
- **Goal:** Bring MC into line with Claude Code **v2.1.178 (2026-06-15)**, which REMOVED the experimental agent-teams tools (`TeamCreate`/`TeamDelete`), made teams **implicit + session-scoped**, and routes teammate creation through **background subagents** (`Agent(name, run_in_background:true)`, nesting ≤5). `SendMessage` is unchanged; the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag is phasing out. Nothing crashes today, but ~5 skills, ~4 hooks, tests, and ~12 docs still instruct the dead API and must migrate to the spawn-via-Agent model — plus a subprocess-reaper + liveness contract for orphaned `dispatch-*.js` OS subprocesses (operator-flagged), an orchestration-doctrine doc (in-process subagents vs OS subprocesses), and a regression enforcer so the dead API can't creep back.
- **Background:** v2.1.178 removed the harness team primitives. The migration is fundamentally a **directive swap** (`TeamCreate(team_name, agent_type:"alpha")` → spawn named background subagents via `Agent`), NOT a logic rewrite: the harness still writes `~/.claude/teams/<session>/config.json`, so every hook's `team_name` / member inspection and slug-scoping logic remains valid. The risk surface is therefore (a) stale *instructional text* that tells the model to run a tool that no longer exists, and (b) **silent fail-open** in hooks whose emitted directives reference the dead tool. Diagnosed from three sources (official docs + Reddit + observed-live) and captured in `REPORT-JULY-18.md` Part 2 + `DUMP.md` §2. The operator additionally folded in subprocess cleanup (the reap/bg-drop orphan class) and asked for an orchestration-doctrine doc distinguishing in-process subagents (Agent tool, separate context windows, talk via SendMessage) from OS subprocesses (`dispatch-claude.js`/`dispatch-agent.js`, the ones that orphan/reap).
- **Scope:** (Leg A) migrate the 5 skills citing `TeamCreate`/`TeamDelete` — `mode/sprint.md` (Steps 1.5/1.75), `mode/adhoc.md` (Step 2 + primitive-limits), `warp/health.md` (§3.5), `session/end.md` (Phase 9 teardown), `.claude/project/reference/sprint-workflow.md` (primitive-limits §), and β `judgement-model.md` (harness-primitive row) — to the spawn-via-Agent pattern; mark the env flag deprecated/phasing-out. (Leg B) audit + migrate the **emitted directive strings** in `scripts/hooks/team-guard.js` (block-message), `scripts/hooks/session-start.js` (`teamInitDirective`), `scripts/teams/lifecycle.js` (`verify()` directive + honest-ceiling comment), `scripts/check/install.js` (flag-detail string) — logic, fail-open, and config.json inspection PRESERVED untouched. (Leg C) a reliable subprocess **reaper + liveness contract** for orphaned `dispatch-*.js` OS processes (PID-liveness based, fail-open), wired into session-start eager-prune + `/mc:health`, with a named enforcer. (Leg D) the **orchestration-doctrine doc** (CLAUDE.md + dispatch-guide §9: in-process subagents vs OS subprocesses, pull-don't-push context, lean envelopes, nesting-5, turn-cost), a **regression enforcer** (`scripts/checks/no-dead-team-tools.js` — flags new live `TeamCreate`/`TeamDelete` directives in skills/hooks/scripts, allowlisting historical/`_docs`/`_mc/BASELINE`/this epic's own files, fail-closed on runner error, `.test.js` with a planted violation) wired into `/scan:full`, and migration of the tests referencing `team_name` (`tests/regression/S-LC-04/init-gate.test.js`, the `team-guard-*.test.js`, `session-start-teaminit.test.js`, `tests/regression/SP-20260611-002/team-guard-verify.test.js`).
- **Out of scope:** Rewriting the *team-guard / lifecycle gate LOGIC* (the gates still work; only the human/model-facing directives change). Touching `_requirements/`, `_mc/EXAMPLES/`, `_mc/BASELINE/` (immutable/W4-owned), or `.claude/agents/_org/dispatch-contract.json` / dispatch-config (W5-owned, E-DISPATCH-PERFECT-001). Historical archives, `_docs/phase0/*`, `_planning/*`, and per-run `runtime/*` artifacts (immutable history — the enforcer allowlists them). Re-architecting the dispatch reliability stack (the reaper *complements* `epsilon-liveness.js` + `concurrency-lock` pruning; it does not replace them).
- **Current state:** Completed
- **Percent completion:** 100% — LANDED on `main` @ `7b40bbf7` (ff-merge from `sprint/SP-TEAMS-MIGRATION-001`, 9 commits) + pushed to `origin/main` (2026-06-19). All 4 build legs done; cross-provider gauntlet GREEN (backend/qa/security all binding PASS, telemetry-gate clean); β DECIDE B 0.88 to merge + the 4 β riders applied; framework manifest regenerated; post-merge sanity green on main (enforcer 2113 files clean, reaper test 20/20, enforcer test 18/18, S-LC-05 18/18). Engine-sprint fast-close (RI-001): no deploy artifact; formal retro deferred to milestone close.

## Definition of Done
- [x] All 5 skills (`mode/sprint`, `mode/adhoc`, `warp/health`, `session/end`, `sprint-workflow`) + β `judgement-model` instruct **spawn-via-Agent** (`Agent(subagent_type, name, run_in_background:true)`), not `TeamCreate`/`TeamDelete`; the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag is documented as deprecated/phasing-out (no skill instructs it as a hard prerequisite). — Leg A; enforcer-clean.
- [x] The 4 hooks' (`team-guard.js`, `session-start.js`, `lifecycle.js`, `install.js`) emitted directives/strings reference spawn-via-Agent; their gate **logic, fail-open behavior, and config.json inspection are unchanged** + the one real logic fix (`lifecycle.teamBelongsToProject` member-cwd arm for the `session-<uuid>` rename) is empirically validated, wrong-project-survives invariant preserved. — Leg B; backend-reviewer PASS; hook tests + S-LC-05 18/18 green.
- [x] A subprocess reaper (`scripts/dispatch/reap-orphans.js`) reliably detects + (with `--apply`) reaps orphaned `node <abs-wrapper>` dispatch processes (PID-liveness + PPID-orphan + age + no-live-lock + not-own-tree, fail-open, SIGTERM-first), wired into session-start eager-prune (report-only) + `/mc:health` §12.5, with a 20-assertion fixture test. — Leg C; security-reviewer PASS after a multi-round hardening.
- [x] The orchestration-doctrine doc (CLAUDE.md + dispatch-guide §9.5) distinguishes in-process subagents vs OS subprocesses, documents pull-don't-push / lean envelopes / nesting-5 / turn-cost, and the post-v2.1.178 implicit-team model. — Leg D.
- [x] `scripts/checks/no-dead-team-tools.js` exists, is wired into `/scan:full`, fails closed on runner error, FIRES on a planted new `TeamCreate(` directive (proven: CLI exit 1), asserts the new Agent-spawn remediation EXISTS, and is GREEN against the migrated tree (2113 files). — Leg D; qa-reviewer PASS; 18-assertion test.
- [x] Every `team_name`-referencing test passes against the migrated code; the cross-provider gauntlet is GREEN on every hook change (GPT-only — gemini TIER-DEAD, debt ED-063); β DECIDE B 0.88 to merge. — gauntlet done.
- [x] Framework manifest regenerated; ff-merged to `main` @ `7b40bbf7` + pushed. (The mc shipping MANIFEST regen was deferred — it picked up uncommitted cross-session disk drift, not mine; mc-ship-coverage is GREEN on clean main, regenerates clean post-merge.)

## Related definitions
- Enforcer / fail-closed gate, Wiring, Verification, Evidence — see ../../TRACKER.md
- Fail-open (a hook must never crash/block on error) — see ../../TRACKER.md (Hook)

## Related sprints
- [SP-TEAMS-MIGRATION-001](../sprints/SP-TEAMS-MIGRATION-001-agent-teams-subagents-migration.md) — Active — full-lifecycle sprint: migrate skills+hooks+tests+docs, build the reaper + enforcer, cross-provider gauntlet, merge.

## Dependencies
- None hard. Complements E-DISPATCH-SHAPE-001 / E-DISPATCH-PERFECT-001 (the dispatch-shape + model-routing layer) but touches a disjoint surface (team-spawn directives + subprocess lifecycle, NOT dispatch-contract/config). Coordinated to NOT touch W4 (`_mc/EXAMPLES`) or W5 (`dispatch-contract.json`) edit surfaces.

## Blockers
- None currently recorded.

## Risks
- **Hooks are blast-sensitive** (run every session) — a fail-open regression in `team-guard.js`/`session-start.js`/`lifecycle.js` would silently break every session's dispatch gating. Mitigation: directive-strings-only edits, logic untouched, the existing+migrated hook tests + a planted-malformed-input fail-open assertion, and a mandatory cross-provider GPT+Gemini gauntlet on every hook change. Likelihood: low · Impact: high.
- **The subprocess reaper kills processes by PID** — a mis-scoped or over-broad reaper could kill a live, legitimate dispatch. Mitigation: PID-liveness + MC-dispatch-ownership scoping (only orphaned `dispatch-*.js` with a dead parent / stale lock), fail-open, conservative-by-construction (skip on any ambiguity), security-reviewer pass. Likelihood: medium · Impact: medium.
- **Incomplete migration leaves a live `TeamCreate` directive** that silently instructs a dead tool. Mitigation: the `no-dead-team-tools.js` regression enforcer wired into `/scan:full` makes any residual live directive self-detecting. Likelihood: low (with the enforcer) · Impact: medium.

## Decisions
- 2026-06-19 — Migration is a **directive swap, not a logic rewrite**: the harness still writes `~/.claude/teams/<session>/config.json`, so every hook's `team_name`/member inspection + slug-scoping stays valid. Only emitted human/model-facing directives change. Rationale: minimizes blast radius on session-critical hooks; preserves the load-bearing fail-open invariant.
- 2026-06-19 — `session-end-team-teardown.js` needs **no migration**: it calls `lifecycle.teardown()` (the Node-side surrogate), contains no `TeamCreate` text, and is already security-hardened + fail-open. Its honest-ceiling ("a Node script can't force-kill a live in-process teammate") remains true post-v2.1.178. Rationale: verified by reading the file, not assumed from the DUMP's "~4 hooks" estimate.
- 2026-06-19 — Engine-sprint fast-close (RI-001): no deploy artifact, so close via ff-merge to `main` + defer formal retro to milestone close. Rationale: tooling/system sprint, established precedent.

## Open questions
- Reaper wiring depth — owner: President (ε, with director-of-engineering domain judgment). Provisional: PID-liveness reaper wired into session-start eager-prune (alongside `pruneDeadLocks`) + surfaced in `/mc:health`; confirm scope with β at the design boundary.

## Session log
### 2026-06-19 — Session SP-TEAMS-MIGRATION-001 (α lead + ε conductor + β judgment)
- Agent(s): President α (lead) + ε (Epsilon, sprint conductor) + β (judgment) · Mode: sprint
- Work performed: read DUMP.md §2 + REPORT-JULY-18.md Part 2 + dispatch-guide; surveyed the full migration surface (47 md / 16 js / 56 `team_name` files, scoped to canonical excluding `.worktrees`/`runtime`/`_docs`/`_mc/BASELINE`); established composition (system/tooling, MEDIUM-HIGH risk, no UI); partitioned into 4 build legs (skills / hooks / subprocess-reaper / doctrine-doc+enforcer+tests); probed + confirmed the Agent tool is available to teammate-ε (ED-041-corrected); authored this epic tracker.
- Files changed: this file; ../sprints/SP-TEAMS-MIGRATION-001-*.md; ../../ROADMAP.md (Epic-tracker link); ../../TRACKER.md.
- Decisions: see Decisions. · Issues discovered: none yet.
- Definitions added/changed: None
- State change: Planned → Active · Completion change: 0% → 10%
- Verification performed: probed Agent-tool availability (general-purpose returned ALIVE); read `session-end-team-teardown.js` (no migration needed). · Validation run: pending (node scripts/trackers/validate.js at close). · Validation result: Not run yet
- Next action: dispatch the 4 build legs in-process, then the cross-provider gauntlet.
- Evidence/references: REPORT-JULY-18.md Part 2; DUMP.md §2; ROADMAP.md § Epics E-TEAMS-MIGRATION-001.

## Change log
### 2026-06-19 — Session SP-TEAMS-MIGRATION-001
- Changed: created the epic tracker; registered SP-TEAMS-MIGRATION-001; linked from ROADMAP § Epics + TRACKER.md.
- Reason: the epic was registered in ROADMAP § Active epics but had no `trackers/epics/` file (validate-shape gap); externally-triggered by Claude Code v2.1.178.
- Affected: trackers/epics/E-TEAMS-MIGRATION-001-*.md; trackers/sprints/SP-TEAMS-MIGRATION-001-*.md; ROADMAP.md; TRACKER.md.
- Previous state: (no tracker file) / Planned
- New state: Active, 10%

## Evidence log
### 2026-06-19 — Migration surface measured + Agent-tool context confirmed
- Evidence type: Command run
- Detail/location: `grep TeamCreate|TeamDelete` (47 md, 16 js) + `grep team_name` (56 files) across the repo, scoped to canonical (excluding `.worktrees/`, `runtime/`, `_docs/`, `_mc/BASELINE/`); Agent-tool probe (`subagent_type:general-purpose` → "ALIVE").
- Verified by: Epsilon · Supports: scope partition + the in-process dispatch route decision.

## Verification log
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| `scripts/hooks/session-end-team-teardown.js` migration | No | Verified Not Wired (no `TeamCreate` text; no change needed) | scripts/hooks/ | Read 2026-06-19 — calls `lifecycle.teardown()`, fail-open, security-hardened | 2026-06-19 | Epsilon |
| `scripts/checks/no-dead-team-tools.js` (regression enforcer) | Yes | Missing But Required | scripts/checks/ + /scan:full | Glob 2026-06-19 — not present | 2026-06-19 | Epsilon |
| Subprocess reaper (`reap-orphans.js`) | Yes | Missing But Required | scripts/dispatch/ + session-start + /mc:health | Build pending | 2026-06-19 | Epsilon |

## Current next action
Dispatch the 4 build legs (skills / hooks / subprocess-reaper / doctrine-doc+enforcer+tests) in-process, then run the cross-provider gauntlet on the hook changes, then regen both manifests + merge to `main`.

## Completion record
- Final state: Completed
- Percent completion: 100%
- Completion timestamp: 2026-06-19
- Definition of done used: the Definition of Done section above (all 7 items checked)
- Evidence of completion: merged to `main` @ `7b40bbf7` (ff from `sprint/SP-TEAMS-MIGRATION-001`, 9 commits) + pushed to `origin/main`. Cross-provider gauntlet GREEN (backend/qa/security binding PASS, real `ok:true` completion records). β DECIDE B 0.88. Post-merge on main: enforcer 2113 files clean (exit 0), reaper test 20/20, enforcer test 18/18, S-LC-05 18/18.
- Session IDs / dates / agents: SP-TEAMS-MIGRATION-001 / 2026-06-19 / α (lead) + ε (conductor, Epsilon-2) + β (Beta-2) · GPT-5.5 gauntlet (gemini TIER-DEAD)
- Related completed sprints: SP-TEAMS-MIGRATION-001 (this epic's only sprint)
- Remaining follow-up items: ED-063 (re-run the gemini/Antigravity corpus-diversity gauntlet leg on the reaper once that provider is live); the mc shipping-MANIFEST regen on a clean main (deferred — was contaminated by uncommitted W4/W5 disk drift)
- Related untracked work: None
- ../../TRACKER.md updated: via ROADMAP § Epics pointer (TRACKER delegates theme-epics to ROADMAP) · Roadmap reconciled: Yes (ROADMAP § Epics entry → Completed 100%)
