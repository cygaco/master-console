<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-TEST-SUITE-001 — Per-Sprint Exhaustive Test-Suite System

- **Epic label and number:** E-TEST-SUITE-001
- **Title:** Per-Sprint Exhaustive Test-Suite System
- **Owner:** President Agent
- **Parent roadmap area:** ../../ROADMAP.md § Epics → Active epics (E-TEST-SUITE-001; detail in the deprecated-milestone blocks `🟡 0.17.0` + `🔬 Mandatory regression seed`)
- **Goal:** Make exhaustive testing a permanent SYSTEM, not per-sprint discretion — every canonical sprint ships or extends a test suite sized as real work, gated by a named enforcer, seeded with a baseline regression set covering every recurring bug class; the product layer opts in but is never forced.
- **Background:** The framework is unstable — green gates pass without exhaustive behavioral coverage, and recurring bug classes keep resurfacing because "done" has meant "the author wrote some tests." This epic converts coverage from per-sprint discretion into an enforced system so a passing gate is trustable for every framework change.
- **Scope:** The shared harness + the per-sprint convention + a named enforcer (sprint-close / release-gates, repo-role-aware) + a product-layer opt-out + the recurring-bug-class regression seed; plus the batch that flows through the system — the `_planning/` seed-zone, the MC↔product diff, and the hook-system overhaul — each shipping with its own exhaustive suite.
- **Out of scope:** Defining "stable" / LTS release channels — that is E-STABLE-CHANNEL-001, which CONSUMES this epic's regression seed to define what "stable" means (this epic produces the seed, not the channel taxonomy).
- **Current state:** Active
- **Percent completion:** ~40% — FOUNDATION SHIPPED: the enforcer `scripts/testsuite/enforce.js`, the recurring-bug-class registry `_requirements/07-testing/recurring-bug-classes.json` (28 classes on disk), the sprint-close `regressionSeedGate()` in `scripts/sprint/release.js` `cmdPrepare` (commit `4bfb0ac`, fail-closed, role-aware via `enforce.run()`), the release-gates wiring, and the `_docs/sprint/TESTSUITE.md` convention. REMAINING: the `_planning`/diff/hook-overhaul batch + each batch item's exhaustive suite + a focus/centering mechanism. Conservative per §20 — the system spine exists and gates one chokepoint, but the bulk of the per-sprint feature suites is not yet built.

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [ ] The test-suite system is a documented, manifest-registered MC system with a named enforcer (`scripts/testsuite/enforce.js`) — PARTIAL: enforcer + convention doc (`_docs/sprint/TESTSUITE.md`) exist; manifest registration as a first-class system still to confirm/record.
- [ ] The enforcer refuses to close a canonical sprint without its suite AND is a no-op / opt-in in consumer repos — proven by `scripts/mc/test-install-matrix.js` in BOTH repo roles — PARTIAL: `regressionSeedGate()` is wired into the sprint-close chokepoint and fails closed / role-aware; both-role install-matrix proof not yet recorded here.
- [ ] The baseline regression seed covers every recurring bug class, all green — PARTIAL: 28-class registry on disk; full-green run not yet evidenced in this epic.
- [ ] Each feature sprint ships its exhaustive suite (hook-overhaul carries explicit before/after numbers) — NOT STARTED: the `_planning`/diff/hook-overhaul suites are the remaining batch (`/mc:diff` shipped 2026-05-29 with 24 unit tests; the rest pending).
- [ ] The per-sprint convention is documented so it binds every future sprint — PARTIAL: `_docs/sprint/TESTSUITE.md` exists; binding-on-every-future-sprint enforcement to confirm.

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Validator — see ../../TRACKER.md
- Validation — see ../../TRACKER.md
- Evidence — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- SP-20260528-002 — Active/Planned — test-suite foundation + planning (shipped the enforcer + 28-class regression seed + the sprint-close `regressionSeedGate()` half; commit `4bfb0ac`).
- `_planning` seed-zone sprint — Planned — ship `_planning/` as a seeded-with-provenance seed-zone, with its exhaustive suite.
- MC↔product diff sprint — Planned — `/mc:diff` engine (`scripts/mc/diff.js`, shipped 2026-05-29 with 24 unit tests) deepened, with its exhaustive suite.
- Hook-system overhaul sprint — Planned — hook-system overhaul carrying its exhaustive suite + before/after numbers.

## Dependencies
- Shared repo-role resolver (canonical-mandatory / consumer-optional switch) — shared with E-GOLDEN-FLOW-001 — partial: `regressionSeedGate()` already routes via `enforce.run()` role detection; the shared resolver hardens the canonical↔consumer switch.

## Blockers
- None currently recorded.

## Risks
- A documented-but-not-runnable enforcer would be a false-green gate (CLAUDE.md gate-honesty) — mitigation: `regressionSeedGate()` already fails CLOSED on a NEW regression (exit 1) OR a runner error (exit 2), returning sentinel exit 3 so a broken suite never reads as a clean close. Likelihood: low · Impact: high.
- A gate that lives only in one orchestrator gets bypassed by the other sprint-close path (the "lib-only fix bypassed by callers" class) — mitigation: the gate lives in `release.js cmdPrepare`, the single chokepoint BOTH `/sprint:full` phase 4 and `/sprint:release` pass through. Likelihood: low · Impact: high.
- Per-sprint suites stay aspirational (written but not exhaustive) without a centering mechanism — mitigation: a focus/centering mechanism is an explicit remaining deliverable. Likelihood: medium · Impact: medium.

## Decisions
- 2026-06-06 — The regression-seed enforcer lives in `release.js cmdPrepare`, not in the `full.js` orchestrator — rationale: `cmdPrepare` is the single chokepoint both sprint-close paths traverse, so a one-orchestrator gate would be bypassable via `/sprint:release` (CLAUDE.md lib-only-fix-bypass class).
- 2026-06-06 — The enforcer is role-aware and fails CLOSED — rationale: consumer repos must no-op (opt-in, not forced) while canonical is mandatory, and a crashed/timed-out suite must block (exit 3), never read green (CLAUDE.md gate-honesty).

## Open questions
- The ROADMAP § Epics entry and the foundation narrative say "26-class" registry, but `_requirements/07-testing/recurring-bug-classes.json` holds 28 classes on disk — reconcile the count (and confirm the seed still covers EVERY recurring class) — owner: President Agent.
- Whether the test-suite system is registered as a first-class entry in the systems manifest (and where) — owner: President Agent.

## Session log
<!-- Append-only (§24). One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
### 2026-06-06 — Session 2026-06-06-t5-roadmap-to-epic (june-5)
- Agent(s): President Agent (via systems builder) · Mode: sprint
- Work performed: Created this epic tracker file during the T5 roadmap→epic migration of E-TRACKER-001 — authored from the EPIC_TEMPLATE, grounded against disk (verified `scripts/testsuite/enforce.js`, `scripts/sprint/release.js` `regressionSeedGate()`/`cmdPrepare`, the 28-class `recurring-bug-classes.json`, `_docs/sprint/TESTSUITE.md`, `scripts/mc/test-install-matrix.js`, `scripts/mc/diff.js`, commit `4bfb0ac`).
- Files changed: trackers/epics/E-TEST-SUITE-001-per-sprint-test-suite.md (this file) · Paths changed: none · Wirings changed: none (authoring only)
- Decisions: see Decisions section (gate-at-chokepoint; role-aware fail-closed).
- Definitions added/changed: None
- State change: (new) → Active · Completion change: 0% → ~40%
- Verification performed: confirmed enforcer / gate / registry / convention-doc / install-matrix / diff engine / commit on disk before citing them as evidence; noted the 26-vs-28 class-count discrepancy as an open question rather than asserting a count not on disk.
- Validation run: `node scripts/trackers/validate.js` · Validation result: PASS (exit 0)
- Next action: complete the `_planning` seed-zone + MC↔product diff integration + hook-system overhaul, each with its exhaustive suite.
- Evidence/references: ../../ROADMAP.md § Epics → Active epics (E-TEST-SUITE-001); commit `4bfb0ac`; see Evidence log below.

## Change log
<!-- §25 -->
### 2026-06-06 — E-TEST-SUITE-001 created during T5 roadmap→epic migration (President Agent via systems builder)
- Changed: Created this epic tracker file (state (new) → Active, ~40%); recorded the shipped foundation (enforcer + 28-class seed + sprint-close gate + release-gate wiring + convention doc) and the remaining `_planning`/diff/hook-overhaul batch.
- Reason: T5 of E-TRACKER-001 migrates ROADMAP milestones→epics; every active epic needs a `trackers/epics/` file backing its ROADMAP entry.
- Affected: this epic file; backs the existing ../../ROADMAP.md § Epics → Active epics E-TEST-SUITE-001 entry (which already links here).
- Previous state: No epic tracker file existed for E-TEST-SUITE-001 (ROADMAP entry linked to a not-yet-created file).
- New state: Epic tracker file exists; Active at ~40%; foundation recorded as shipped, batch recorded as remaining.

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
### 2026-06-06 — Test-suite foundation exists on disk and gates sprint close
- Evidence type: Existence confirmation
- Detail/location: `scripts/testsuite/enforce.js` (enforcer); `_requirements/07-testing/recurring-bug-classes.json` (28 classes — `node -e` count); `scripts/sprint/release.js` `regressionSeedGate()` @line 98, called from `cmdPrepare()` @line 159, both exported; `_docs/sprint/TESTSUITE.md` (convention); `scripts/mc/test-install-matrix.js` (both-role install proof harness); `scripts/mc/diff.js#computeDiff` (`/mc:diff`, shipped 2026-05-29).
- Verified by: President Agent (via systems builder) · Supports: DoD items 1, 2, 3, 4 (foundation half)
- Remaining uncertainty: full-green seed run, both-role install-matrix proof, and the per-sprint feature suites are not yet evidenced here; the registry holds 28 classes vs the "26" in the ROADMAP narrative (open question).

### 2026-06-06 — Sprint-close enforcer wiring committed
- Evidence type: Command run
- Detail/location: `git log -1 --format="%h %s" 4bfb0ac` → `4bfb0ac feat(0.17.0): wire regression-seed enforcer into sprint close (BC-15)`; `grep -n regressionSeedGate scripts/sprint/release.js` → defined @98, invoked @159, exported @851.
- Verified by: President Agent (via systems builder) · Supports: DoD item 2 (sprint-close enforcement)

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| Enforcer `scripts/testsuite/enforce.js` | Yes | Verified Exists | scripts/testsuite/ | `ls scripts/testsuite/enforce.js` | 2026-06-06 | President Agent |
| Recurring-bug-class registry | Yes | Verified Exists | `_requirements/07-testing/recurring-bug-classes.json` | `node -e` → 28 classes | 2026-06-06 | President Agent |
| Sprint-close gate `regressionSeedGate()` | Yes | Verified Wired | `scripts/sprint/release.js` → `cmdPrepare` (chokepoint for `/sprint:full` + `/sprint:release`) | `grep -n regressionSeedGate` → @98 def, @159 call, @851 export | 2026-06-06 | President Agent |
| Convention doc | Yes | Verified Exists | `_docs/sprint/TESTSUITE.md` | `ls _docs/sprint/TESTSUITE.md` | 2026-06-06 | President Agent |
| Both-role install-matrix proof harness | Yes | Verified Exists | `scripts/mc/test-install-matrix.js` | `ls scripts/mc/test-install-matrix.js` | 2026-06-06 | President Agent |
| `/mc:diff` engine | Yes | Verified Exists | `scripts/mc/diff.js#computeDiff` | `ls scripts/mc/diff.js` (shipped 2026-05-29, 24 unit tests) | 2026-06-06 | President Agent |
| `_planning/` seed-zone + per-sprint feature suites | Yes | Missing But Required | to be built (`_planning/` + diff/hook-overhaul suites) | ROADMAP `[open] _planning/` + batch listing | 2026-06-06 | President Agent |
| Focus/centering mechanism | Yes | Missing But Required | not yet built | none (remaining deliverable) | 2026-06-06 | President Agent |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
Complete the `_planning` seed-zone + the MC↔product diff integration + the hook-system overhaul, each shipping its own exhaustive suite (hook-overhaul with before/after numbers), and add the focus/centering mechanism; then record the full-green seed run and the both-role install-matrix proof.

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Not yet complete (Active, ~40%)
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: see Definition of Done section above
- Evidence of completion: n/a — in progress (foundation shipped: enforcer + 28-class seed + sprint-close gate + release-gate wiring + convention doc; the `_planning`/diff/hook-overhaul batch + per-sprint suites remain)
- Session IDs / dates / agents: 2026-06-06-t5-roadmap-to-epic / 2026-06-06 / President Agent (via systems builder)
- Related completed sprints: None
- Remaining follow-up items: `_planning` seed-zone + suite; MC↔product diff + suite; hook-system overhaul + suite (before/after numbers); focus/centering mechanism; full-green seed run + both-role install-matrix proof; reconcile the 26-vs-28 class count
- Related untracked work: None
- ../../TRACKER.md updated: No · Roadmap reconciled: Yes (ROADMAP § Epics entry already exists and links here)
