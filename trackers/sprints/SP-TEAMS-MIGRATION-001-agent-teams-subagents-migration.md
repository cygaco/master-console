<!-- SPRINT TRACKER — spec §23. Linked from ../../TRACKER.md and from its parent epic. Template: ../templates/SPRINT_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# SP-TEAMS-MIGRATION-001 — Agent-Teams→Subagents migration (skills + hooks + reaper + doctrine + enforcer)

- **Sprint label and number:** SP-TEAMS-MIGRATION-001
- **Title:** Agent-Teams→Subagents migration & orchestration hardening
- **Owner:** President (ε conductor)
- **Parent epic:** [E-TEAMS-MIGRATION-001](../epics/E-TEAMS-MIGRATION-001-agent-teams-subagents-migration.md)
- **Goal:** Migrate MC off the removed Claude Code v2.1.178 team primitives (`TeamCreate`/`TeamDelete`) to the spawn-via-Agent model across the 5 skills, 4 hooks, tests, and ~12 docs that still instruct the dead API; build a subprocess reaper + liveness contract for orphaned `dispatch-*.js` OS processes; add the orchestration-doctrine doc + a regression enforcer; and land it green through the cross-provider gauntlet.
- **Scope:** the 4 build legs (A skills, B hooks-directive-strings, C subprocess-reaper, D doctrine-doc + `no-dead-team-tools.js` enforcer + test migration) defined in the parent epic's Scope.
- **Out of scope:** `_requirements/`, `_mc/EXAMPLES/` (W4), `dispatch-contract.json` / dispatch-config (W5), historical archives + per-run `runtime/*`, and the team-guard/lifecycle gate LOGIC (only directives change).
- **Current state:** Completed
- **Percent completion:** 100% — LANDED on `main` @ `7b40bbf7` (ff-merge, 9 commits) + pushed (2026-06-19). All 4 legs + gauntlet GREEN + β DECIDE B 0.88 + 4 riders applied.

## Definition of Done
- [ ] Inherits the parent epic's 6 DoD items (skills migrated · hooks directives migrated + logic/fail-open unchanged · reaper built+wired+enforced · doctrine doc · enforcer wired into /scan:full + planted-violation test · all team_name tests pass + cross-provider gauntlet GREEN + manifests regen + merged).

## Related definitions
- Enforcer / fail-closed gate, Fail-open, Wiring, Verification — see ../../TRACKER.md

## Tasks
- [ ] Leg A — migrate 5 skills + β judgement-model (TeamCreate→Agent-spawn directives).
- [ ] Leg B — migrate 4 hooks' emitted directive strings (team-guard, session-start, lifecycle, install); logic + fail-open untouched.
- [ ] Leg C — build `scripts/dispatch/reap-orphans.js` (PID-liveness, fail-open) + wire into session-start + /warp:health + named enforcer.
- [ ] Leg D — orchestration-doctrine doc (CLAUDE.md + dispatch-guide §9) + `scripts/checks/no-dead-team-tools.js` (+ .test.js) wired into /scan:full + migrate team_name tests.
- [ ] Gauntlet — cross-provider GPT+Gemini on hook changes; qa on skills+docs; security on the reaper; telemetry gate.
- [ ] Close — regen both manifests; reconcile epic/TRACKER/ROADMAP; merge to main.

## Files expected to change
- `.claude/commands/mode/sprint.md`, `.claude/commands/mode/adhoc.md`, `.claude/commands/warp/health.md`, `.claude/commands/session/end.md`, `.claude/project/reference/sprint-workflow.md`, `.claude/agents/president/_system/beta/judgement-model.md`
- `scripts/hooks/team-guard.js`, `scripts/hooks/session-start.js`, `scripts/teams/lifecycle.js`, `scripts/check/install.js`
- `scripts/dispatch/reap-orphans.js` (new), `scripts/checks/no-dead-team-tools.js` (new) + `.test.js`
- `CLAUDE.md`, `.claude/agents/_system/guides/agent-dispatch-guide.md`
- `tests/regression/S-LC-04/init-gate.test.js`, `scripts/hooks/team-guard-gate.test.js`, `scripts/hooks/team-guard-sprint.test.js`, `scripts/hooks/session-start-teaminit.test.js`, `tests/regression/SP-20260611-002/team-guard-verify.test.js`
- `ROADMAP.md`, `TRACKER.md`, the two manifests (regen)

## Files actually changed
- `trackers/epics/E-TEAMS-MIGRATION-001-*.md`, `trackers/sprints/SP-TEAMS-MIGRATION-001-*.md` — 2026-06-19

## Paths expected to exist
- `scripts/dispatch/reap-orphans.js`, `scripts/checks/no-dead-team-tools.js` (post-build)

## Paths verified to exist
- `scripts/hooks/session-end-team-teardown.js` — Verified Exists 2026-06-19 via Read (no migration needed) by Epsilon

## Paths verified nonexistent
- `scripts/checks/no-dead-team-tools.js` — Verified Nonexistent (expected, to be built) 2026-06-19 via Glob by Epsilon
- `scripts/dispatch/reap-orphans.js` — Verified Nonexistent (expected, to be built) 2026-06-19 via Glob by Epsilon

## Wirings expected
- `no-dead-team-tools.js` → /scan:full — regression enforcer must run in the scan set
- `reap-orphans.js` → session-start eager-prune + /warp:health — reaper must run on session start + be visible in health

## Wirings verified
- None currently recorded.

## Dependencies
- None hard. Coordinated to avoid W4 (`_mc/EXAMPLES`) + W5 (`dispatch-contract.json`) edit surfaces.

## Blockers
- None currently recorded.

## Risks
- Blast-sensitive hooks — see parent epic Risks. Mitigation: directive-strings-only + fail-open test + cross-provider gauntlet on every hook change.
- Reaper kills by PID — see parent epic Risks. Mitigation: PID-liveness + dispatch-ownership scoping + fail-open + security-reviewer pass.

## Decisions
- 2026-06-19 — In-process Agent-tool dispatch for the 4 additive build legs (teammate-ε confirmed to hold the Agent tool); cross-provider CLI dispatch reserved for the gauntlet. Rationale: proven-safe (6/6) for additive legs; provider diversity required for review.

## Open questions
- Reaper wiring depth — see parent epic Open questions (confirm with β at design boundary).

## Session log
### 2026-06-19 — Session SP-TEAMS-MIGRATION-001 (α + ε + β)
- Agent(s): President α (lead) + ε (conductor) + β (judgment) · Mode: sprint
- Work performed: composition + leg partition; authored epic + sprint trackers; cut branch off main; probed Agent-tool availability.
- Files changed: this file; ../epics/E-TEAMS-MIGRATION-001-*.md; ../../ROADMAP.md; ../../TRACKER.md.
- Decisions: see Decisions. · Issues discovered: none yet.
- Definitions added/changed: None
- State change: (new) → Active · Completion change: 0% → 10%
- Verification performed: read session-end-team-teardown.js (no migration); Glob'd the two new-file paths (nonexistent, expected). · Validation run: pending. · Validation result: Not run yet
- Next action: dispatch the 4 build legs.
- Evidence/references: parent epic E-TEAMS-MIGRATION-001; REPORT-JULY-18.md Part 2; DUMP.md §2.

## Change log
### 2026-06-19 — Session SP-TEAMS-MIGRATION-001
- Changed: created the sprint tracker under the parent epic.
- Reason: full-lifecycle sprint for the externally-triggered teams migration.
- Affected: trackers/sprints/SP-TEAMS-MIGRATION-001-*.md; parent epic; ROADMAP; TRACKER.
- Previous state: (new)
- New state: Active, 10%

## Evidence log
### 2026-06-19 — Branch + trackers established
- Evidence type: Command run
- Detail/location: `git switch -c sprint/SP-TEAMS-MIGRATION-001 main` (HEAD `5eae16f3`); epic + sprint tracker files written.
- Verified by: Epsilon · Supports: sprint setup / DoD scaffolding.

## Verification log
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| Sprint branch off main | Yes | Verified Exists | `sprint/SP-TEAMS-MIGRATION-001` @ 5eae16f3 | `git rev-parse HEAD` 2026-06-19 | 2026-06-19 | Epsilon |
| `no-dead-team-tools.js` | Yes | Missing But Required | scripts/checks/ + /scan:full | Glob 2026-06-19 | 2026-06-19 | Epsilon |
| `reap-orphans.js` | Yes | Missing But Required | scripts/dispatch/ + session-start | Glob 2026-06-19 | 2026-06-19 | Epsilon |

## Current next action
None — sprint completed (merged to `main` @ `7b40bbf7` + pushed 2026-06-19).

## Completion record
- Final state: Completed
- Percent completion: 100%
- Completion timestamp: 2026-06-19
- Definition of done used: inherits the parent epic DoD (all 7 items checked)
- Evidence of completion: merged to `main` @ `7b40bbf7` (ff from this branch, 9 commits) + pushed to `origin/main`; cross-provider gauntlet GREEN (backend/qa/security binding PASS); β DECIDE B 0.88; post-merge on main enforcer 2113-files-clean + reaper 20/20 + enforcer 18/18 + S-LC-05 18/18.
- Session IDs / dates / agents: SP-TEAMS-MIGRATION-001 / 2026-06-19 / α + ε + β
- Parent epic: E-TEAMS-MIGRATION-001
- Remaining follow-up items: ED-063 (gemini corpus-diversity gauntlet re-run on the reaper once Antigravity is live); mc shipping-MANIFEST regen on a clean main
- Related untracked work: None
- ../../TRACKER.md updated: via ROADMAP § Epics pointer · Roadmap reconciled: Yes
