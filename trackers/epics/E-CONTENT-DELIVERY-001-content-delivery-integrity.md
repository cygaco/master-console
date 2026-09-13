<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-CONTENT-DELIVERY-001 — Content-Delivery Integrity & Ownership-Pattern Realignment

- **Epic label and number:** E-CONTENT-DELIVERY-001
- **Title:** Content-Delivery Integrity & Ownership-Pattern Realignment
- **Owner:** President Agent
- **Parent roadmap area:** [../../ROADMAP.md](../../ROADMAP.md) § Epics → Active epics (detail: the `🟡 0.16.0` deprecated-milestone block)
- **Goal:** Make "downstream is always missing something" stop being a recurring class — the shipping manifest provably covers the ownership manifest, every `seeded_from` pointer resolves, seed zones arrive seeded-with-provenance, and update restores the install skeleton.
- **Background:** MC has two manifests that drifted with nothing gating reconciliation — `_mc/MANIFEST.json` (authoritative ownership taxonomy: owner=framework|generated|project|runtime) vs `.claude/framework-manifest.json` (what install + update actually ship). `framework/templates/*` shipped to 0 consumers silently under green gates. SP-20260525-024 added the essential-roots patch (`framework/templates` + `hooks.registry` → ASSET_DIRS, `scaffoldProduct` + `populateWarposMirror` into `update.js`, `scripts/checks/mc-ship-coverage.js` enforcer). This epic makes reconciliation structural + exhaustive.
- **Scope:** Build `_mc/templates/` + `_mc/BASELINE/` in canonical; migrate `framework/templates` → `_mc/templates`; fix the dangling `seeded_from` at `scripts/mc/manifest/build.js:196-202`; extend `populate-source.js` to seed `_requirements/` / `_docs/` with provenance; harden `mc-ship-coverage.js` to assert every `seeded_from` resolves + curate ~218 owner=framework dev-tooling paths into a reviewed KNOWN_NOT_SHIPPED allowlist (exhaustive, not essential-only); add an install-matrix update-parity assertion (every REQUIRED_DIR present post-update).
- **Out of scope:** The executable consumer-contract gate (E-GOLDEN-FLOW-001); channels (E-STABLE-CHANNEL-001).
- **Current state:** Completed
- **Percent completion:** 100% (SP-20260618-001 templates-migration sprint, 2026-06-18 — gauntlet GREEN). All four DoD now satisfied + evidenced: DoD #1 (`_mc/templates/` built as the sole home, 9 dirs/108 files; `framework/templates/` DELETED; `_mc/BASELINE/` built; ship-coverage allowlist carved narrowly so templates SHIP while MANIFEST.json+settings+BASELINE stay not-shipped — U1 a35df99d), DoD #2 (ship-coverage exhaustive + `seeded_from` zero-tolerance — already DONE 2026-06-06, re-verified green at 1907 paths), DoD #3 (fresh install seeds `_requirements/`/`_docs/` with provenance via `scripts/mc/views/populate-seed-provenance.js`, idempotent + skip-if-user-modified + path-traversal-hardened — U2 eff3b1a0 + security-fix 0c802292), DoD #4 (`test-install-matrix.js` scenarios 1+2 assert the migrated shipped structure reaches a real install fixture; structure-parity {ok:true,count:24} — U3 57476d73). Cross-provider gauntlet GREEN (backend+qa+security PASS; security caught + fixed a real path-traversal). Known pre-existing non-regression: test-install-matrix scenario-2 exits 1 on a 0.16.0 capsule checksum drift that predates this sprint (same hash on main; releases/0.16.0 untouched) — tracked as a separate release-rebuild item, waived at merge.

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [x] `_mc/templates/` + `_mc/BASELINE/` exist; `framework/templates` migrated (no orphaned copy) — **DONE** (SP-20260618-001 U1 a35df99d: `_mc/templates/` is the sole home, 9 dirs/108 files; `framework/templates/` deleted; `_mc/BASELINE/` built as the per-install seed-snapshot; ship-coverage `--root` exit 0/1907 paths/0 gaps; the carve is narrow — templates ship, MANIFEST.json+settings+BASELINE do not)
- [x] All `seeded_from` pointers resolve, verified by hardened ship-coverage exiting 0 with zero unallowlisted owner=framework paths — **DONE** (verified 2026-06-06; re-verified 2026-06-18 at 1907 paths, 0 gaps, 0 dangling, `KNOWN_DANGLING_SET` empty)
- [x] Fresh install seeds `_requirements/` / `_docs/` with provenance, not bare `.gitkeep` — **DONE** (SP-20260618-001 U2 eff3b1a0 + security-fix 0c802292: `scripts/mc/views/populate-seed-provenance.js` writes a `.provenance.json` per seed zone, `seeded_from` `_mc/BASELINE`; idempotent, skip-if-user-modified, path-traversal-hardened; test-seed-provenance 14/14; fresh-install-smoke 8/8)
- [x] `test-install-matrix.js` existing_install_upgrade asserts every REQUIRED_DIR present post-update — **DONE** (SP-20260618-001 U3 57476d73: scenarios 1+2 assert the migrated shipped structure reaches a real install fixture; structure-parity `REQUIRED_DIRS` {ok:true,count:24}; the matrix's scenario-2 overall exit-1 is solely a pre-existing 0.16.0 capsule drift unrelated to this work — waived, separate ticket)

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Verification — see ../../TRACKER.md
- Path — see ../../TRACKER.md
- Wiring — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- Pattern-realignment-to-SP-20260522-001 — Planned — realign the content-delivery path to the SP-20260522-001 ownership/shipping taxonomy (named in the 0.16.0 block)
- Ship-coverage-hardening — **DONE** (verified 2026-06-06) — `mc-ship-coverage.js` asserts every `seeded_from` resolves + the exhaustive KNOWN_NOT_SHIPPED allowlist is curated; gate runs green with info_gaps as a hard failure
- Install-matrix-update-parity — Planned — add the update-parity assertion (every REQUIRED_DIR present post-update) to `test-install-matrix.js` (named in the 0.16.0 block)

## Dependencies
- The ownership/shipping manifest taxonomy from E-MANIFEST-ARCH-001 (SP-20260522-001) — Completed (not blocking)

## Blockers
- None currently recorded.

## Risks
- Curating ~218 owner=framework paths into a KNOWN_NOT_SHIPPED allowlist by hand risks allowlisting a path that SHOULD ship (re-creating the silent-drop class) — likelihood: medium · impact: high · mitigation: review each entry against the ownership taxonomy and make the allowlist itself reviewed + diffable, not a blanket suppression.
- Migrating `framework/templates` → `_mc/templates` while install/update still reference the old root could ship 0 templates again during the cutover — likelihood: medium · impact: high · mitigation: repoint ASSET_DIRS + the regen path in the same change and verify via ship-coverage before deleting the old copy.

## Decisions
- None currently recorded.

## Open questions
- Absorbed open item (homed here by sprint T5 from the deprecated 0.18.1 reconcile block): **E6** — product-overlay path registry (`.claude/paths.local.json` deep-merged by `scripts/paths/build.js`, or an `owner:project` section `/mc:update` never overwrites) so product-specific path keys survive framework updates without MERGE_CONFLICT + honesty-drift each update *(dreamteam W-9)*. Decide whether E6 lands in this epic or a dedicated paths-overlay sprint when activated.

## Session log
<!-- Append-only (§24). One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
### 2026-06-18 — Session session/2026-06-18 (SP-20260618-001 templates-migration — epic CLOSED)
- Agent(s): Alex ε (sprint conductor) + α (U1 finish + merge) + β (boundary DECIDEs) + backend-builders + cross-provider gauntlet + security-fixer · Mode: sprint
- Work performed: Conducted SP-20260618-001 to close the epic's remaining DoD. U1 — migrated `framework/templates` (9 dirs/108 files) → `_mc/templates` end-state home (sole home; old deleted), built `_mc/BASELINE`, carved the ship-coverage `KNOWN_NOT_SHIPPED` rule NARROWLY (templates ship; MANIFEST.json+settings+BASELINE do not), repointed the manifest generator + 3 paths.registry keys + ~20 regression tests + segmented `path.join` refs, added a standing `assert-mc-templates-shipped.js` enforcer + a FIX1-pin planted-violation test. U2 — `populate-seed-provenance.js` seeds `_requirements/`/`_docs/` with `.provenance.json` (`seeded_from` `_mc/BASELINE`), idempotent + skip-if-modified; the gauntlet caught a real path-traversal in it → security-fix added a static zone-allowlist + realpath guard. U3 — extended `test-install-matrix` scenarios 1+2 to assert the migrated shipped structure reaches a real install fixture.
- Files changed: `_mc/templates/**` (moved), `_mc/BASELINE/**` (new), `scripts/mc/views/populate-seed-provenance.js` (new), `scripts/mc/test-seed-provenance.js` (new), `scripts/checks/assert-mc-templates-shipped.js` (new), `scripts/checks/mc-ship-coverage.js`, `scripts/generate-framework-manifest.js`, `scripts/mc/manifest/build.js`, `scripts/mc/scaffold-core.js`, `scripts/mc/test-install-matrix.js`, `framework/paths.registry.json` + regenerated views/manifests, ~20 regression tests, this tracker.
- Decisions: gauntlet security FAIL was a binding verdict (not overridden) → fix-cycle. BASELINE = owner=project build-output, NOT shipped (correct reality-consistent reading, reviewer-ratified). gemini tier-ineligible → sanctioned GPT 2nd-pass failover. Scenario-2 capsule drift = pre-existing non-regression → waived + separate ticket.
- Issues discovered: a real path-traversal in the U2 writer (fixed); a pre-existing 0.16.0 capsule checksum drift (separate ticket); gemini→Antigravity tier-death (ED); three dispatch-infra reap modes (REAP-FIX-NOTE.md, candidate EDs).
- Definitions added/changed: None
- State change: Active ~60% → Completed 100% · Completion change: ~60% → 100%
- Verification performed: gauntlet GREEN (backend+qa+security PASS; gauntlet-verify telemetry PASS); close-verify ALL GREEN — ship-coverage `--root` exit 0/1907 paths/0 gaps, assert-templates-shipped pos+neg, structure-parity {ok:true,24}, seed-provenance 14/14, ship-coverage-own-test 30/30.
- Validation run: `node scripts/trackers/validate.js` → PASS (20/20 binding) · Next action: hand to α for convergence-battery + merge-to-main (operator-granted push this session).
- Evidence/references: commit chain a35df99d→eff3b1a0→57476d73→0c802292→54a7acff (tag `sp-20260618-001-gauntlet-green`); runtime/sp-20260618-001/HANDOFF-AND-WAIVER.md.

### 2026-06-06 — Session 2026-06-06-t5-roadmap-to-epics
- Agent(s): President Agent (via systems builder) · Mode: sprint
- Work performed: Created this epic tracker file during the T5 roadmap→epic migration of `_planning/tracker-system-improvements.md` (§29) — captured the content-delivery-integrity work from the deprecated `🟡 0.16.0` milestone block as an enforced epic.
- Files changed: trackers/epics/E-CONTENT-DELIVERY-001-content-delivery-integrity.md
- Paths changed: none · Wirings changed: none (authoring only; no git/regen/mode-wiring this session)
- Decisions: none this session.
- Issues discovered: none this session.
- Definitions added/changed: None
- State change: (new) → Active · Completion change: 0% → ~50%
- Verification performed: Confirmed this epic file did not previously exist before authoring; structure matched against ../templates/EPIC_TEMPLATE.md.
- Validation run: `node scripts/trackers/validate.js` · Validation result: PASS (exit 0)
- Next action: build `_mc/templates/` + `_mc/BASELINE/`; migrate `framework/templates`; fix the dangling `seeded_from`; harden ship-coverage to exhaustive.
- Evidence/references: ../../ROADMAP.md § Epics → Active epics (`🟡 0.16.0` block); SP-20260525-024 (essential-roots patch); scripts/checks/mc-ship-coverage.js.

### 2026-06-06 — Session session/2026-06-06 (verify-first reconcile)
- Agent(s): President Agent (α) · Mode: sprint (mc-sprint team α+ε+β; β consulted → DECIDE)
- Work performed: Started a scoped E-CONTENT-DELIVERY-001 sprint (harden ship-coverage to exhaustive + fix dangling `seeded_from`). Bounded verify-first inspection (ED-008) found BOTH items ALREADY DONE in canonical — `mc-ship-coverage.js` runs green/exhaustive (1304 paths, 0 hard_gaps / 0 info_gaps / 0 boundary_violations, info_gaps a hard failure, reviewed `KNOWN_NOT_SHIPPED` allowlist) and `seeded_from` is zero-tolerance (0 dangling, `KNOWN_DANGLING_SET` empty). Aborted the build (nothing to build); reconciled the stale ROADMAP epic + this tracker. β DECIDE (Class B, 0.87): defer the higher-blast-radius templates migration to its own scoped sprint with upfront design; reconcile now.
- Files changed: ../../ROADMAP.md (epic block: completion / related-sprints / next-action), this tracker, ../../_reports/epics/E-CONTENT-DELIVERY-001.md (correction appended).
- Paths changed: none · Wirings changed: none (reconcile only)
- Decisions: β-DECIDE — defer templates migration to its own scoped sprint; reconcile now.
- Issues discovered: ROADMAP epic state was STALE (listed DoD #2 as TODO when it had landed) — second verify-first catch this session (cf. the masterconsole false-alarm).
- Definitions added/changed: None
- State change: Active (unchanged) · Completion change: ~50% → ~60%
- Verification performed: ran `scripts/checks/mc-ship-coverage.js` (exit 0, green); `_mc/templates` + `_mc/BASELINE` confirmed absent; `populate-source.js` absent (DoD #3 open); `test-install-matrix.js` has scenario 2 + post-update checks (DoD #4 partial).
- Validation run: `node scripts/trackers/validate.js` (run after this reconcile) · Next action: mint the templates-migration sprint (see Current next action).
- Evidence/references: ship-coverage gate run; β verdict (DECIDE, precedent EVT-sp20260531-006-d7-lane3-ri002-001).

## Change log
<!-- §25 -->
### 2026-06-06 — Verify-first reconcile: DoD #2 found already done (President α, sprint mode)
- Changed: Completion ~50% → ~60%; DoD #2 (`seeded_from` integrity + exhaustive ship-coverage) marked DONE & enforced; next-action re-pointed from the (already-done) ship-coverage/`seeded_from` work to the genuine remaining `_mc/templates` migration (deferred to its own scoped sprint per β-DECIDE); Ship-coverage-hardening related-sprint → DONE.
- Reason: A scoped sprint's bounded verify-first inspection (ED-008) found the ROADMAP epic's next-action listed already-landed work; reconciled tracker to reality.
- Affected: ../../ROADMAP.md (epic block), this tracker, ../../_reports/epics/E-CONTENT-DELIVERY-001.md (correction appended).
- Previous state: Active ~50%; next-action included "fix dangling `seeded_from`; harden ship-coverage to exhaustive" (both already done).
- New state: Active ~60%; DoD #2 done & enforced; next-action = a scoped templates-migration sprint.

### 2026-06-06 — Epic created during T5 roadmap→epic migration (President Agent via systems builder)
- Changed: Created E-CONTENT-DELIVERY-001 — Content-Delivery Integrity & Ownership-Pattern Realignment, at Active / ~50%, from the deprecated `🟡 0.16.0` milestone block.
- Reason: T5 of `_planning/tracker-system-improvements.md` (§29) — migrate roadmap milestones → enforced epics; the content-delivery-integrity work needs an epic tracker file as its source of truth.
- Affected: new trackers/epics/E-CONTENT-DELIVERY-001-content-delivery-integrity.md; ../../ROADMAP.md (0.16.0 block deprecation); ../../TRACKER.md (Active Epics).
- Previous state: No enforced epic tracker file existed for content-delivery integrity (work lived only in the ROADMAP 0.16.0 block).
- New state: Epic authored; Active at ~50% (SP-20260525-024 essential-roots patch + ship-coverage enforcer shipped; structural/exhaustive reconciliation remains).

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
### 2026-06-06 — SP-20260525-024 essential-roots patch + ship-coverage enforcer shipped
- Evidence type: Existence confirmation
- Detail/location: scripts/checks/mc-ship-coverage.js (the enforcer); `framework/templates` + `hooks.registry` added to ASSET_DIRS; `scaffoldProduct` + `populateWarposMirror` wired into update.js.
- Verified by: President Agent · Supports: the ~50% percent rationale (essential-roots half done; exhaustive/structural half remains).

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| `mc-ship-coverage.js` enforcer | Yes | Verified Exists | scripts/checks/mc-ship-coverage.js | shipped in SP-20260525-024 | 2026-06-06 | President Agent |
| `_mc/templates/` | Yes | Missing But Required | `_mc/templates/` (target of `framework/templates` migration) | to build (DoD item 1) | 2026-06-06 | President Agent |
| `_mc/BASELINE/` | Yes | Missing But Required | `_mc/BASELINE/` | to build (DoD item 1) | 2026-06-06 | President Agent |
| Dangling `seeded_from` | No | Verified Nonexistent | resolved in the `build.js` generator (`KNOWN_DANGLING_SET` empty) | `node scripts/checks/mc-ship-coverage.js` → 0 dangling, exit 0 | 2026-06-06 | President Agent |
| Exhaustive ship-coverage (info_gaps hard-fail) | Yes | Verified Wired | `scripts/checks/mc-ship-coverage.js` → release-gates | gate green: 1304 paths, 0 hard_gaps/0 info_gaps/0 boundary_violations | 2026-06-06 | President Agent |
| Install-matrix update-parity assertion | Yes | Missing But Required | `test-install-matrix.js` existing_install_upgrade | to add (DoD item 4) | 2026-06-06 | President Agent |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
None — epic COMPLETED by SP-20260618-001 (templates-migration), 2026-06-18, gauntlet GREEN. Residual follow-up (not part of this epic's DoD): the pre-existing 0.16.0 release-capsule checksum drift surfaced by U3's matrix assertions (tracked separately for a `release-build.js 0.16.0` rebuild); the `_mc/BASELINE` regen-enforcer (deferred until the `validate.js` seed-drift consumer lands); the gemini→Antigravity provider-readiness gap.

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Completed
- Percent completion: 100%
- Completion timestamp: 2026-06-18
- Definition of done used: see Definition of Done section above (spec §37) — all 4 DoD checked + evidenced
- Evidence of completion: SP-20260618-001 templates-migration sprint, gauntlet GREEN. U1 a35df99d (`_mc/templates` sole home 9 dirs/108 files; `framework/templates` deleted; `_mc/BASELINE` built; narrow ship-coverage carve), U2 eff3b1a0 + security-fix 0c802292 (`populate-seed-provenance.js` seed-zone provenance, path-traversal-hardened; test 14/14), U3 57476d73 (matrix scenarios 1+2 assert shipped structure reaches a real install; structure-parity {ok:true,24}), qa-harden 54a7acff (BASELINE pinned not-shipped). Gauntlet: backend PASS, qa PASS, security FAIL→fix→PASS (real path-traversal caught + fixed); gauntlet-verify telemetry PASS. Close-verify ALL GREEN (ship-coverage 1907/0-gaps, assert-templates-shipped pos+neg, structure-parity 24, seed-provenance 14/14, ship-coverage-own-test 30/30).
- Session IDs / dates / agents: SP-20260618-001 / 2026-06-18 / Alex ε (sprint conductor) + backend-builders + cross-provider gauntlet (backend/qa/security reviewers) + security-fixer; α (U1 finish + convergence-merge); β (phase-boundary DECIDEs)
- Related completed sprints: SP-20260618-001 (templates-migration); SP-20260525-024 (essential-roots patch + ship-coverage enforcer, prior)
- Remaining follow-up items: pre-existing 0.16.0 capsule checksum drift → `release-build.js 0.16.0` rebuild (separate ticket, waived at this merge); `_mc/BASELINE` regen-enforcer (deferred-debt); gemini→Antigravity provider-readiness (ED)
- Related untracked work: None
- ../../TRACKER.md updated: pending (this sprint's reconcile) · Roadmap reconciled: pending (epic → Completed)
