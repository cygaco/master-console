<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-GOLDEN-FLOW-001 — Golden-Flow End-to-End Hardening + Executable Consumer-Contract Gate

- **Epic label and number:** E-GOLDEN-FLOW-001
- **Title:** Golden-Flow End-to-End Hardening + Executable Consumer-Contract Gate
- **Owner:** President Agent
- **Parent roadmap area:** `/mc:reconcile` golden-flow thrust — see ../../ROADMAP.md § Epics → Active epics (and the two `🔭 … TOP PRIORITY` reconcile blocks + the `🔭 Root-cause deepening` detail that feed it)
- **Goal:** Make the bootstrap on-ramp → on-screen "WOW" on a clean machine the hardened core target, generalized across all portfolio products, and prove the exact sealed capsule a consumer pins survives a real consumer lifecycle (`setup → scan:install → real sprint → dispatch telemetry → update`, both repo roles, cold + warm) before external users hit it.
- **Background:** The downstream portfolio products' `MC.md` reconciliation surfaced a deeper generator than "downstream missing": **contractless productization** — no hard boundary between authoring state and the shipped runtime contract (canonical is source + test + artifact + only-user at once). That root sits behind ~every downstream `MC.md` gap; the executable consumer-contract gate is the structural cure (it consumes the exact artifact downstream receives instead of diffing a static manifest). Operator-directed 2026-06-02 (golden-flow-first reprioritization): hardening the golden flow *is* the engine's core job.
- **Scope:** The executable consumer-contract gate (sealed-capsule isolation with canonical inaccessible + both-role cold+warm lifecycle, fail-closed); the shared repo-role resolver (ED-009 — one canonical-vs-consumer source every guard consults); typed success semantics (BC-16 — green = the action occurred AND a telemetry record exists); dispatch-readiness preflight wiring (`provider-smoke.js --per-role` into `/mc:health` + SessionStart + `/agents:test`); the bootstrap `:setup`/`:paint` split + EVENT-CONTRACT (typed seam events so a cockpit renders buttons not commands); smart-canon (S4 — zero `{{token}}` leak, canon-type coverage).
- **Out of scope:** The 0.16.0 manifest/ship-coverage reconciliation (that is E-CONTENT-DELIVERY-001); the per-sprint exhaustive test-suite system (that is E-TEST-SUITE-001).
- **Current state:** Completed (2026-06-16)
- **Percent completion:** 100% (2026-06-16 — Completed) — ALL 4 DoD items DONE + evidenced: the executable consumer-contract gate is BUILT + CERTIFIED (self-test 17/17 + bounded PASS + `--full` matrix 4/4 cells, `runtime/sealed-gate-full.log`), the shared repo-role resolver landed (ED-009, 2026-06-15 `8f48ba9c`), and BC-16 typed-success is implemented in the gate's `verifyTyped()`. The keystone the trackers carried as "Missing But Required" / "next action = build it" was actually built 2026-06-01 (SP-20260602-001, `25197c98`) and never reconciled — corrected here (a tracker-honesty drift, ironic for the gate that fights false-green). DoD item 4 (dispatch-readiness preflight) ALSO verified wired 2026-06-16 — `provider-smoke.js --per-role` is live in SessionStart (`perRoleProbe` + readiness nudge), `/mc:health` §11, and `/agents:test --smoke`; it too was carried stale as "orphaned". **ALL 4 DoD items satisfied → epic Completed 100%.** Earlier: cheap-slice fresh-install smoke shipped (`ff04cd9`, caught the `manifest.mc.version="0.1.0"` version-quorum bug) + the S1/W1/S3/S5 golden-flow batch (`ac56602`).

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [x] Executable consumer-contract gate runs the sealed capsule through `setup → scan:install → real sprint → dispatch telemetry → update` under BOTH repo roles, cold + warm, fail-closed — **DONE + CERTIFIED.** `scripts/mc/test-sealed-capsule-gate.js` (built `25197c98`/`e839350d`/`e0279d08` 2026-06-01, SP-20260602-001, ADR-0006; cross-provider gauntlet-reviewed, 2 fix-cycles; registered in `recurring-bug-classes.json` + `release-gates.js`). Re-certified 2026-06-16: self-test **17/17**, bounded gate **PASS** (sealed 1311/1311 assets, canonical-unreachable asserted, scan:install certifies), `--full` matrix **PASS — all 4 cells (canonical/consumer × cold/warm)** with real telemetry dispatch + typed-success verify (`runtime/sealed-gate-full.log`).
- [x] Shared repo-role resolver (ED-009) is the single source every guard consults for canonical-vs-consumer (no guard re-derives role "from path vibes") — **DONE 2026-06-15** (`scripts/mc/repo-role.js` exports `resolveRepoRole`/`isCanonicalDir`/`ROLES`; adoption tail landed `8f48ba9c`; the gate threads role via the resolver override-arg).
- [x] Typed success semantics (BC-16) kill fail-open false-green at the contract level (green = action occurred AND telemetry record exists) — **DONE.** The gate's `verifyTyped()` is BC-16: it calls `scripts/dispatch/gauntlet-verify.js` against the canonical-anchored ledger; green requires the action occurred AND a well-formed completion record exists; fail-closed on malformed / no-record / runner-error (proven by self-tests `verifytyped-requires-action-and-record` + `verifytyped-fail-closed-on-malformed-norecord-runnererror`, and live by the `--full` matrix's per-cell typed verify).
- [x] Dispatch-readiness preflight (`provider-smoke.js --per-role`) wired into `/mc:health` + SessionStart + `/agents:test` — **DONE (verified wired 2026-06-16).** `scripts/mc/provider-smoke.js` exports `perRoleProbe`/`classifyPerRole`/`PER_ROLE_BUILD_CHAIN`; SessionStart (`scripts/hooks/session-start.js:482`) calls `perRoleProbe(PER_ROLE_BUILD_CHAIN,{noPing:true})` LIVE and emits a dispatch-readiness nudge on red rows; `/mc:health` §11 runs `--per-role`; `/agents:test --smoke` routes to it. No-ping probe returns 7 role rows. (This item too was carried stale as "built but orphaned".)

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Wiring — see ../../TRACKER.md
- Verification — see ../../TRACKER.md
- Evidence — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- SP-20260602-001 — retrospected — Sealed-capsule executable consumer-contract gate (the epic keystone; ledger sprint, no file link)
- SP-Pickup-Queue do-next #1/#2/#3/#5/#7/#8 — ranked in ../../ROADMAP.md § Sprint Pickup Queue (ledger sprints, referenced by rank, no file link)

## Dependencies
- Shared repo-role resolver (ED-009) — **SATISFIED (DONE 2026-06-15 `8f48ba9c`)** — `scripts/mc/repo-role.js` (`resolveRepoRole`/`isCanonicalDir`/`ROLES`); the gate threads role via its override-arg (both-role half unblocked).
- Typed success semantics (BC-16) — **SATISFIED (DONE)** — implemented as the gate's `verifyTyped()` → `scripts/dispatch/gauntlet-verify.js` (green = action occurred AND well-formed record; fail-closed on malformed/no-record/runner-error); the `--full` matrix's per-cell verify exercises it live. The gate cannot emit false-green.

## Blockers
- None currently recorded.

## Risks
- The launch-time freeze-vs-pull posture sets the required depth of the sealed-isolation half — a hard freeze-on-snapshot down-scopes it; an imminent pull demands the full canonical-inaccessible isolation. Likelihood: medium · Impact: high · Mitigation: build the both-role lifecycle half first (independent of posture), confirm MC launch date/posture before scoping the isolation half.

## Decisions
- 2026-06-02 — Golden-flow-first reprioritization: the bootstrap on-ramp → on-screen "WOW" on a clean machine is the main hardening target, generalized across all portfolio products — rationale: hardening this is the engine's core job (get any product to on-screen/PMF); operator-directed.
- 2026-05-30 — Freeze-vs-pull is a launch-time call; because pull is a live possibility, the consumer-contract gate is the keystone either way — rationale: it makes a pull-posture safe, certifies a freeze snapshot, and produces the stability signal that informs the call.

## Open questions
- Confirm MC launch date/posture — it sets the required depth of the sealed-isolation half. Owner: operator (President surfaces the tradeoff).

## Session log
<!-- Append-only (§24). One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
### 2026-06-06 — Session 2026-06-06-tracker-T5-migration (june-5)
- Agent(s): President Agent via systems builder · Mode: sprint
- Work performed: Created this epic file as part of the T5 roadmap→epic migration — authored from the §22 epic template, deepened from the ROADMAP golden-flow reconcile + root-cause-deepening detail blocks.
- Files changed: trackers/epics/E-GOLDEN-FLOW-001-golden-flow-consumer-contract.md (new) · Paths changed: none · Wirings changed: none (authoring only)
- Decisions: see Decisions section.
- Definitions added/changed: None
- State change: (new file) → Active · Completion change: 0% → ~35%
- Verification performed: confirmed the file did not previously exist before authoring · Validation run: `node scripts/trackers/validate.js` · Validation result: PASS (12/12, exit 0)
- Next action: build the executable consumer-contract gate (sealed-capsule isolation + both-role cold+warm lifecycle); land the shared repo-role resolver first.
- Evidence/references: ../../ROADMAP.md § Epics → E-GOLDEN-FLOW-001; commits `ff04cd9` (fresh-install smoke) + `ac56602` (S1/W1/S3/S5); SP-20260602-001 in the ledger.

## Change log
<!-- §25 -->
### 2026-06-06 — Session 2026-06-06-tracker-T5-migration
- Changed: Created E-GOLDEN-FLOW-001 epic tracker file.
- Reason: T5 of E-TRACKER-001 — migrate the ROADMAP golden-flow thrust into an epic tracker file (spec §29, Roadmap item == Epic).
- Affected: new trackers/epics/E-GOLDEN-FLOW-001-golden-flow-consumer-contract.md; linked from ../../ROADMAP.md § Epics and ../../TRACKER.md.
- Previous state: No epic tracker file existed for the golden-flow thrust (ROADMAP entry only).
- New state: Epic tracker authored; Active at ~35%.

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
### 2026-06-06 — Cheap-slice fresh-install smoke shipped and caught a real first-run bug
- Evidence type: Command run
- Detail/location: `scripts/mc/test-fresh-install-smoke.js` (commit `ff04cd9`) — spins up a fresh empty repo, runs the consumer install, asserts `scan:install` certifies it (exit 0), fail-closed on a stale manifest; first run caught `manifest.mc.version = "0.1.0"` ≠ `version.json`, fixed in `scaffold-core.js#resolveWarposVersion`.
- Verified by: President Agent · Supports: the cheap-slice leading-indicator portion of DoD item 1 (the full sealed gate was subsequently BUILT 2026-06-01 + CERTIFIED 2026-06-16 — self-test 17/17 + bounded PASS + `--full` matrix 4/4 cells; see § Percent completion 2026-06-16 reconciliation).

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| Fresh-install smoke (cheap slice) | Yes | Verified Exists | `scripts/mc/test-fresh-install-smoke.js` | shipped `ff04cd9`; per-commit via `scripts/linters/run.js`; caught the `0.1.0` version-quorum bug | 2026-06-06 | President Agent |
| Executable consumer-contract gate (full) | Yes | Verified Wired | `scripts/mc/test-sealed-capsule-gate.js`; registered in `recurring-bug-classes.json` + `release-gates.js` | BUILT 2026-06-01 (SP-20260602-001, ADR-0006); CERTIFIED 2026-06-16: self-test 17/17 + bounded PASS + `--full` matrix 4/4 cells (`runtime/sealed-gate-full.log`) | 2026-06-16 | President Agent |
| Shared repo-role resolver (ED-009) | Yes | Verified Wired | `scripts/mc/repo-role.js` (`resolveRepoRole`/`isCanonicalDir`/`ROLES`); consumed by the gate via the override-arg | landed 2026-06-15 `8f48ba9c`; adopted by admin/bootstrap guards + enforcer | 2026-06-16 | President Agent |
| Typed success semantics (BC-16) | Yes | Verified Wired | the gate's `verifyTyped()` → `scripts/dispatch/gauntlet-verify.js` (canonical-anchored ledger) | green = action occurred AND well-formed record; fail-closed on malformed/no-record/runner-error (self-tests + live `--full` per-cell verify) | 2026-06-16 | President Agent |
| Dispatch-readiness preflight wiring | Yes | Verified Wired | `provider-smoke.js --per-role` → SessionStart (`session-start.js:482` `perRoleProbe`+nudge) + `/mc:health` §11 + `/agents:test --smoke` | exports `perRoleProbe`/`classifyPerRole`/`PER_ROLE_BUILD_CHAIN`; no-ping probe returns 7 role rows; all three entry points wired | 2026-06-16 | President Agent |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
Build the executable consumer-contract gate (sealed-capsule isolation + both-role cold+warm lifecycle); land the shared repo-role resolver (ED-009) first as the structural unblock.

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Not yet complete (Active, ~35%)
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: see Definition of Done section above (spec §37)
- Evidence of completion: n/a — in progress (cheap-slice fresh-install smoke shipped `ff04cd9`; S1/W1/S3/S5 shipped `ac56602`; full executable gate open)
- Session IDs / dates / agents: 2026-06-06-tracker-T5-migration / 2026-06-06 / President Agent via systems builder
- Related completed sprints: None currently recorded.
- Remaining follow-up items: executable consumer-contract gate (sealed-capsule isolation + both-role cold+warm lifecycle); shared repo-role resolver (ED-009); typed success semantics (BC-16); dispatch-readiness preflight wiring
- Related untracked work: None currently recorded.
- ../../TRACKER.md updated: No · Roadmap reconciled: Yes (../../ROADMAP.md § Epics → E-GOLDEN-FLOW-001 points here)
