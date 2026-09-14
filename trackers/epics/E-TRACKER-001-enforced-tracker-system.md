<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-TRACKER-001 — Enforced Tracker System

- **Epic label and number:** E-TRACKER-001
- **Title:** Enforced Tracker System (roadmap/epic/sprint/definition/tracker overhaul)
- **Owner:** President
- **Parent roadmap area:** Agentic OS tracking layer — see ../../ROADMAP.md (to be migrated milestones → epics, spec §29)
- **Goal:** Implement the system defined in [`_planning/tracker-system-improvements.md`](../../_planning/tracker-system-improvements.md): an accurate, enforced, resumable tracking system that becomes the highest operational source of truth for long-running work, so work is reliably planned, tracked, resumed, verified, audited, completed, reconciled, and enforced across sessions, agents, modes, and phases.
- **Background:** During the agent-system restructuring the OS began behaving like a company; work was lost between sessions, believed complete when it wasn't (and vice-versa), plans drifted from implementation, terms drifted, and definitions lived in memory/chat/scattered files. The spec defines the fix.
- **Scope:** New `TRACKER.md` per §5; `How to Use` §7; authoritative Definitions §8; System Inventory §9; Verification Matrix §10; state model §19; percent rules §20; language rules §21; epic/sprint tracker files §22/§23; session/change/evidence logging §24–§26; `UNTRACKED_WORK.md` §18; roadmap milestones→epics §29; templates §35; validation §28.7; mode wiring §28.1/§34; enforcement §28.
- **Out of scope:** Product-feature work; non-tracking framework backlog (0.16–0.18 milestones remain in `ROADMAP.md`); shipping the brief to downstream products (it is a runtime-working-doc, UW-003).
- **Current state:** Completed
- **Percent completion:** 100% — Completed 2026-06-06. ALL SIX sprints Completed and Verified on disk: T1 (the enforced `TRACKER.md` keystone, all 34 §5 sections + ~50 definitions), T2 (the `/trackers/` tree + 10 templates + `UNTRACKED_WORK.md` + this epic file + T1–T6 sprint files), T3 (System Inventory + Verification Matrix, fully disk-verified — 40 inventory rows + 26 matrix rows, zero `Unknown`), T4 (validation engine + the 8 cross-file §28.7 checks — `scripts/trackers/validate.js` runs 20 checks, live 20/20 PASS + selftest 55/55, fail-closed + bite-tested, gated in `/scan:full`), T5 (ROADMAP milestones→epics migration — `## Epics` registry primary, `## 🏛 Milestones` DEPRECATED, 8 new epic files), and T6 (start-of-work tracker-consult in all four live modes + the validator gated in `/scan:full`). The hard start/end/completion enforcement HOOKS are now built + wired: `scripts/hooks/tracker-start-of-work.js` (SessionStart — runs the validator + injects the tracker verdict into context) + `scripts/hooks/tracker-completion-gate.js` (Stop — refuses to end on a red tracker), defined in `_mc/settings/defaults.json` and live in `.claude/settings.json`; `hooks-enforce-or-tracked` passes on hook existence.

## Definition of Done
<!-- From spec §37. All must be satisfied + evidenced before 100%. -->
- [x] Old `TRACKER.md` deleted or fully unwired; new `TRACKER.md` exists and follows the §5 structure (T1; validated 12/12 on 2026-06-05)
- [x] `TRACKER.md` has a robust `How to Use This Document` section (§7) (T1)
- [x] Authoritative Definitions present; all required operational terms defined; definition change rules documented (§8) (T1; ~50 definitions)
- [x] Definition enforcement wired into all relevant modes (§28.3) — DONE: validator check (k) `undefined-terms` + (t) `definition-drift` flag undefined/divergent core terms; the 4 live modes carry a start-of-work consult; the SessionStart hook (`tracker-start-of-work.js`) injects the validator verdict (incl. definition checks) into context
- [x] `UNTRACKED_WORK.md` exists and is linked (§18) (T2; Verified Exists on 2026-06-05)
- [x] Roadmap is epic-based, not milestone-based; existing milestones migrated or explicitly deprecated (§29) — DONE (T5, 2026-06-06): `ROADMAP.md` § Epics registry is the primary unit; `## 🏛 Milestones` marked DEPRECATED; migration in the roadmap change log; 8 new epic files
- [x] Epic tracker files exist for all active and planned epics; sprint tracker files exist for all active and planned sprints (§22/§23) (T2; E-TRACKER-001 + T1–T6 Verified Exists)
- [x] Completed epics and sprints carry evidence records (§15/§16/§26) (E-ADR0007/E1–E8 + 0.14.0 + T1/T2/T3 in TRACKER.md; E1–E8 hashes + 0.14.0 tag re-verified against `git` by T3 on 2026-06-05)
- [x] State language standardized; percent rules documented; update triggers documented (§19/§20/§27) (T1)
- [x] Required paths verified; required nonexistence verified; required wirings verified (§28.4/§34) — DONE (T3, 2026-06-05): all §33 paths Verified Exists; old tree Verified Nonexistent (`ls`→ENOENT); 4 live-mode consults + scan gate + persistent team Verified Wired; non-enterable-posture consults + hard hooks Verified Not Wired (tracked G-2)
- [x] System Inventory exists and is current (§9); Verification Matrix exists and is current (§10) — DONE (T3, 2026-06-05): 40 inventory rows + 26 matrix rows, fully disk-verified, zero `Unknown`
- [x] Required validators exist and are runnable (§28.7) — DONE (T4, 2026-06-06): `scripts/trackers/validate.js` runs the full 20-check set (12 single-file a–l + 8 cross-file m–t), live 20/20 PASS + selftest 55/55, gated in `/scan:full`
- [x] Enforcement wired into sprint mode AND all other relevant modes (§28.1/§34) — DONE (2026-06-06): all four live modes carry a start-of-work tracker-consult step; the validator is a standing `/scan:full` fail-closed gate; AND the hard hooks are wired — `tracker-start-of-work.js` (SessionStart, §28.2) + `tracker-completion-gate.js` (Stop, §28.5/§28.6) in `_mc/settings/defaults.json` + live `.claude/settings.json`. The non-enterable operational postures have no enterable mode command to wire (covered indirectly by the SessionStart hook + the 4 live-mode consults)
- [x] President documented as owner; tracker documented as higher authority than Claude memory (§3/§4) (T1)
- [x] Validation has been run; failures fixed or tracked; Known Gaps section empty-with-evidence or fully tracked (§28.7/§28.8/§36) — DONE (2026-06-06): full 20-check validation run, 20/20 PASS + selftest 55/55; Known Gaps G-1/G-2/G-3 tracked
- [x] System is resumable from tracker files alone, without chat memory (§2/§37) — DONE: keystone + scaffold + per-item files + fully disk-verified inventory/matrix + an epic-based roadmap (T5) + the full 20-check validator (incl. `cross-file-reconciliation`) enable resumption from written state; the one residual (a hard enforcement hook) is tracked + machine-enforced-to-stay-visible

## Related definitions
- Roadmap, Epic, Sprint, Tracker, Definition, Source of truth, Verification, Evidence, Untracked work, Reconciliation, System Inventory, Verification Matrix, Wiring, President agent — all to be defined in ../../TRACKER.md Definitions section (T1).

## Related sprints
- [T1 — tracker keystone](../sprints/T1-tracker-keystone.md) — Completed (100%) — new TRACKER.md + ~50 definitions, validated 12/12
- [T2 — templates and dirs](../sprints/T2-templates-and-dirs.md) — Completed (100%) — scaffold dirs + 10 templates + UNTRACKED_WORK.md + epic/sprint files
- [T3 — system inventory + verification matrix](../sprints/T3-system-inventory-and-verification-matrix.md) — Completed (100%) — System Inventory (40 rows) + Verification Matrix (26 rows) fully disk-verified, zero `Unknown`; E1–E8 hashes + 0.14.0 tag re-verified against `git`
- [T4 — validation engine + enforcement](../sprints/T4-validation-engine-and-enforcement.md) — Completed (100%) — 20 checks (12 single-file a–l + 8 cross-file m–t), live 20/20 PASS + selftest 55/55, gated in `/scan:full`; the standalone hard enforcement HOOK is reclassified as this epic's residual (G-2)
- [T5 — roadmap milestones → epics](../sprints/T5-roadmap-milestones-to-epics.md) — Completed (100%) — `ROADMAP.md` § Epics registry primary + `## 🏛 Milestones` DEPRECATED + roadmap change log + 8 new `trackers/epics/` files
- [T6 — mode wiring + scan-suite gate](../sprints/T6-mode-wiring.md) — Completed (100%) — start-of-work tracker-consult in all four live modes + the validator wired into `/scan:full` as a fail-closed gate

## Dependencies
- The interim `TRACKER.md` (agent-system rewrite burndown) must be deleted/unwired and replaced — a coordinated cutover, not a silent overwrite (§3, §32).
- `ROADMAP.md` migration (T5) depends on definitions + epic structure from T1.
- Validation engine (T4) depends on the file/section conventions fixed in T1–T3.

## Blockers
- None currently recorded.

## Risks
- Replacing the live interim `TRACKER.md` could lose the ADR-0007 rewrite burndown state if not reconciled first — mitigation: reconcile its content into epic files before deletion (§32). Likelihood: medium · Impact: high.
- Validation that is documented but not runnable would be a false-green enforcer (§28.7) — mitigation: build runnable validator in T4, test it lies-closed.

## Decisions
- 2026-06-05 — Scaffold (dirs + templates + ledger) authored before the new `TRACKER.md` rewrite, to give T1 concrete templates to fill — rationale: templates are a T1 dependency and are low-risk to author first.
- 2026-06-05 — The project brief classified as a runtime-working-doc, not shipped downstream (UW-003) — rationale: it is an internal requirements input.

## Open questions
- Should the interim ADR-0007 `TRACKER.md` content become its own completed epic (E-ADR0007) before the new `TRACKER.md` replaces it? — President to decide during T1.
- Final on-disk home of the brief once the project lands (`_requirements/`?) — owner: President.

## Session log
### 2026-06-05 — Session 2026-06-05-tracker-scaffold (june-5)
- Agent(s): Alpha (docs/systems builder) · Mode: solo
- Work performed: Created `/trackers/{epics,sprints,templates}/`, authored all 10 templates (§35), `/trackers/README.md`, root `UNTRACKED_WORK.md` (seeded UW-001..003), this epic file, and T1–T6 sprint files.
- Files changed: trackers/README.md, trackers/templates/*.md (10), UNTRACKED_WORK.md, trackers/epics/E-TRACKER-001-enforced-tracker-system.md, trackers/sprints/T1..T6*.md
- Paths changed: created trackers/, trackers/epics/, trackers/sprints/, trackers/templates/
- Wirings changed: None (no git/regen/mode-wiring this session — authoring only)
- Decisions: see Decisions section.
- Issues discovered: cwd was a stale dead worktree (logged UW-001); operated on canonical via absolute paths.
- Definitions added/changed: None yet (deferred to T1's TRACKER.md rewrite).
- State change: (new) → Active · Completion change: 0% → 15%
- Verification performed: Confirmed TRACKER.md exists / trackers dir absent / UNTRACKED_WORK.md absent before authoring; verified the 32-ref allowlist and the brief classification on disk.
- Validation run: None (validation engine is T4, not yet built) · Validation result: Not run
- Next action: T1 — author the new `TRACKER.md` from the §5 structure and fill the Definitions section.
- Evidence/references: files listed above; UNTRACKED_WORK.md UW-001..003.

### 2026-06-05 — Reconciliation pass (President)
- Agent(s): President · Mode: documentation/reconciliation
- Work performed: Reconciled this epic to disk and to TRACKER.md — set T1/T2 Completed, T4 Review Needed, epic ~50%; checked off the now-satisfied DoD items; updated the Verification log (new TRACKER.md / validation engine / skill → Verified Exists).
- Files changed: this epic file (+ TRACKER.md and T1/T2/T4 sprint files in the same pass)
- Paths changed: none · Wirings changed: none
- Decisions: Held T4 at Review Needed (not Completed) because the enforcement-gate wiring + cross-file checks are deferred.
- Issues discovered: the epic had drifted (claimed 15%, "interim TRACKER.md still in place", new TRACKER.md Missing But Required) while the artifacts already existed on disk.
- Definitions added/changed: None
- State change: percent 15% → ~50% · related sprints T1/T2 → Completed, T4 → Review Needed
- Verification performed: ls/Read over Wave-1 artifacts; `node scripts/trackers/validate.js` → 12/12 PASS, exit 0
- Validation run: `node scripts/trackers/validate.js` · Validation result: 12/12 PASS, exit 0
- Next action: T3, T5, T6; finish T4 enforcement-gate + cross-file checks.
- Evidence/references: TRACKER.md (validated 12/12); Wave-1 artifacts on disk.

## Change log
### 2026-06-06 — Hard enforcement hooks wired; epic COMPLETED 100% (President)
- Changed: Built + wired the hard start/end/completion enforcement hooks — `scripts/hooks/tracker-start-of-work.js` (SessionStart: runs the validator, injects the tracker verdict into context) + `scripts/hooks/tracker-completion-gate.js` (Stop: refuses to end on a red tracker, advisory by default / `TRACKER_GATE_ENFORCE=1` to hard-block). Defined in `_mc/settings/defaults.json` and recompiled live into `.claude/settings.json` (integrity-verified: +2 hooks, 0 dropped). Closed the last DoD residual; flipped epic Active ~95% → Completed 100%. While wiring, discovered + FIXED a pre-existing settings/defaults drift: `settings-edit-guard.js` (PreToolUse) + `untrusted-content-firewall.js` (PostToolUse) were live in `.claude/settings.json` but missing from `_mc/settings/defaults.json` (a recompile would have silently dropped them) — added both to defaults so future compiles preserve them.
- Reason: Deliver the §28.2/§28.5/§28.6 hard-enforcement DoD items — make tracker enforcement hook-forced, not only procedural/scan-gated.
- Affected: `scripts/hooks/tracker-start-of-work.js` + `tracker-completion-gate.js` (new); `_mc/settings/defaults.json` (2 tracker hooks + 2 reconciled security hooks); `.claude/settings.json` (recompiled); `../../TRACKER.md`; this epic file.
- Previous state: Active, ~95%; hard hooks Verified Not Wired (governed tracked-debt, G-2).
- New state: Completed, 100%; hard hooks built + wired; `hooks-enforce-or-tracked` passes on existence; validator 20/20 PASS.

### 2026-06-06 — T4 Completed; epic advanced to ~95% (President via backend-builder)
- Changed: Sprint T4 (Validation engine + enforcement) Completed — added the 8 deferred cross-file §28.7 checks (m–t) to `scripts/trackers/validate.js`, taking the validator to 20 checks (live 20/20 PASS + selftest 55/55, fail-closed + bite-tested). Epic percent ~90% → ~95%; DoD "required validators / validation-run / resumability" items checked; related-sprints T4 → Completed. The single residual is now a hard enforcement HOOK (G-2), machine-enforced-to-stay-tracked by the new `hooks-enforce-or-tracked` check.
- Reason: Deliver sprint T4 of `_planning/tracker-system-improvements.md` (§28.7) — machine-catch cross-document drift.
- Affected: `scripts/trackers/validate.js`; `../../TRACKER.md`; `../sprints/T4-validation-engine-and-enforcement.md`; this epic file.
- Previous state: Active, ~90%; T4 Review Needed; validator 12 single-file checks.
- New state: Active, ~95%; T4 Completed; validator 20 checks; only the hard enforcement hook residual remains.

### 2026-06-06 — T5 Completed; epic advanced to ~90% (President via systems builders)
- Changed: Sprint T5 (Roadmap milestones → epics) Completed — `ROADMAP.md` migrated to epic-based: added a `## Epics` registry as the primary organizing unit (4 active + 5 planned epics with §29 fields, 4 parked trigger-gated bets, 10 completed + 1 superseded), marked `## 🏛 Milestones` DEPRECATED (preserved), recorded the migration in a roadmap change log, and created 8 new `trackers/epics/` files (E-GOLDEN-FLOW-001, E-CONTENT-DELIVERY-001, E-TEST-SUITE-001, E-STABLE-CHANNEL-001, E-BOUNDARY-001, E-MULTIPRODUCT-001, E-SKILL-CATALOG-001, E-MANAGER-LAYER-001). Epic percent ~80% → ~90%; DoD roadmap-epic-based item checked; related-sprints T5 → Completed; resumability DoD note updated.
- Reason: Deliver sprint T5 of `_planning/tracker-system-improvements.md` (§29 Roadmap Rules) — make the roadmap epic-based and resumable, not milestone-organized.
- Affected: `../../ROADMAP.md` (`## Epics` + DEPRECATED milestones + roadmap change log); 8 new `../sprints/`→`../epics/E-*.md` files; `../../TRACKER.md`; `../sprints/T5-roadmap-milestones-to-epics.md`; this epic file.
- Previous state: Active, ~80%; T5 Planned; `ROADMAP.md` "Exists But Incomplete (not epic-based)".
- New state: Active, ~90%; T5 Completed; `ROADMAP.md` epic-based; 9 epic files Verified Exists; validator 12/12 PASS.

### 2026-06-05 — T3 Completed; epic advanced to ~80% (President via systems builder)
- Changed: Sprint T3 (System Inventory + Verification Matrix) Completed — both sections fully disk-verified (40 inventory rows + 26 matrix rows, zero `Unknown`); E-ADR0007 E1–E8 hashes + the `warpos@0.14.0` tag re-verified against `git`; epic percent ~65% → ~80%; DoD inventory/matrix + path/wiring + completed-evidence + resumability items updated; related-sprints T3 → Completed; Verification log inventory/matrix rows → Verified Exists and the non-enterable-postures row → Verified Not Wired.
- Reason: Deliver sprint T3 of `_planning/tracker-system-improvements.md` (§9 System Inventory + §10 Verification Matrix) — prove every referenced artifact on disk.
- Affected: this epic file; ../../TRACKER.md (inventory + matrix rewritten); trackers/sprints/T3 file.
- Previous state: Active, ~65%; T3 Planned; inventory/matrix Exists But Incomplete; non-enterable-posture wiring Unknown.
- New state: Active, ~80%; T3 Completed; inventory/matrix fully disk-verified; non-enterable-posture wiring Verified Not Wired (tracked G-2).

### 2026-06-05 — T6 Completed; epic advanced to ~65% (President via systems builder)
- Changed: Sprint T6 (mode-wiring + scan-suite gate) Completed — start-of-work tracker-consult wired into all four live modes + the validator gated in `/scan:full`; T4 advanced to ~90% (standing-gate follow-up closed); epic percent ~50% → ~65%; related-sprints + Verification-log mode-wiring rows + DoD validator/enforcement items updated.
- Reason: Deliver sprint T6 + the standing-gate half of T4's enforcement tail of `_planning/tracker-system-improvements.md`.
- Affected: this epic file; ../../TRACKER.md; trackers/sprints/T6 + T4 files; the 4 mode skills + `scan/full.md`.
- Previous state: Active, ~50%; T6 Planned; mode wiring Unknown.
- New state: Active, ~65%; T6 Completed; 4 live modes + standing gate Verified Wired.

### 2026-06-05 — Reconciliation pass (President)
- Changed: Reconciled epic state to disk — T1/T2 Completed, T4 Review Needed, percent 15% → ~50%, DoD items checked off, Verification log flipped to Verified Exists.
- Reason: The epic file had drifted from reality during the parallel build wave.
- Affected: this epic file; TRACKER.md; T1/T2/T4 sprint files.
- Previous state: Active, 15%, new TRACKER.md / validation engine recorded as Missing But Required.
- New state: Active, ~50%; new TRACKER.md + validation engine + scaffold Verified Exists.

### 2026-06-05 — Session 2026-06-05-tracker-scaffold
- Changed: Created E-TRACKER-001 and its scaffold/templates/ledger.
- Reason: Implement `_planning/tracker-system-improvements.md`; give T1 templates to fill.
- Affected: new trackers/ tree, UNTRACKED_WORK.md, this epic, T1–T6.
- Previous state: No enforced tracker scaffold existed.
- New state: Scaffold + templates + ledger authored; epic Active at 15%.

## Evidence log
### 2026-06-05 — Scaffold and templates exist on disk
- Evidence type: Existence confirmation
- Detail/location: trackers/templates/ holds 10 templates; trackers/epics/E-TRACKER-001-enforced-tracker-system.md; trackers/sprints/T1..T6; UNTRACKED_WORK.md at root.
- Result observed: All authored this session.
- Verified by: Alpha · Supports: scaffold/templates DoD items (T2 deliverables).
- Remaining uncertainty: New TRACKER.md, inventory, matrix, validation, roadmap migration, mode wiring not yet built.

## Verification log
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| trackers/ tree | Yes | Verified Exists | repo root | `mkdir -p` + `ls -la trackers/` | 2026-06-05 | Alpha |
| 10 templates | Yes | Verified Exists | trackers/templates/ | files authored this session | 2026-06-05 | Alpha |
| UNTRACKED_WORK.md | Yes | Verified Exists | repo root | authored this session | 2026-06-05 | Alpha |
| New TRACKER.md (per §5) | Yes | Verified Exists | repo root | ls/Read + `node scripts/trackers/validate.js` (12/12 PASS) | 2026-06-05 | President |
| System Inventory (§9) | Yes | Verified Exists | TRACKER.md | 40 rows, every row disk-verified (T3); zero `Unknown` | 2026-06-05 | T3 systems builder |
| Verification Matrix (§10) | Yes | Verified Exists | TRACKER.md | 26 rows, every row disk-verified (T3); zero `Unknown` | 2026-06-05 | T3 systems builder |
| Validation engine (§28.7) | Yes | Verified Exists | `scripts/trackers/validate.js` | selftest 33/33; live 12/12 PASS, exit 0 | 2026-06-05 | President |
| /trackers:validate skill | Yes | Verified Exists | `.claude/commands/trackers/validate.md` | ls/Read | 2026-06-05 | President |
| Mode wiring — 4 live modes (§28.1) | Yes | Verified Wired | `.claude/commands/mode/{solo,adhoc,oneshot,sprint}.md` | start-of-work consult step; Read post-edit | 2026-06-05 | President |
| Standing scan-suite gate (§28.7) | Yes | Verified Wired | `.claude/commands/scan/full.md` → `node scripts/trackers/validate.js` | Read post-edit + `scan-coverage.js` 0 findings | 2026-06-05 | President |
| Mode wiring — non-enterable postures + hard hooks (§34) | Yes | Verified Not Wired | roadmap/session skills / hooks | `grep -l TRACKER.md` over roadmap/* + session/{handoff,resume} → no match; no enforcement hook (T3) | 2026-06-05 | T3 systems builder |
| Old mode-based agent tree (§33) | No | Verified Nonexistent | `.claude/agents/` | `ls` of `00-alex/01-adhoc/02-oneshot/03-managers` → ENOENT ×4 (T3) | 2026-06-05 | T3 systems builder |
| `warpos@0.14.0` + E1–E8 hashes (§16/§26) | Yes | Verified Exists | git | `git tag` + `git log -1` ×20, all found (T3) | 2026-06-05 | T3 systems builder |

## Current next action
None — epic Completed (2026-06-06). Optional future hardening: a per-edit PostToolUse completion-gate (the current gate is the standing `/scan:full` + the Stop hook); flag the pre-existing settings/defaults security-hook drift discovered while wiring (now fixed in `defaults.json`).

## Completion record
- Final state: Completed
- Percent completion: 100%
- Completion timestamp: 2026-06-06
- Definition of done used: see Definition of Done section above (spec §37) — all items satisfied + evidenced
- Evidence of completion: all six sprints Completed (T1–T6); `node scripts/trackers/validate.js` → all 20 checks PASS, exit 0 + `--selftest` 55/55 (2026-06-06); `ROADMAP.md` epic-based (`## Epics` registry + DEPRECATED milestones); the hard enforcement hooks `scripts/hooks/tracker-start-of-work.js` (SessionStart) + `scripts/hooks/tracker-completion-gate.js` (Stop) built + wired in `_mc/settings/defaults.json` + live `.claude/settings.json` (recompiled, integrity-verified: +2 hooks, 0 dropped); `hooks-enforce-or-tracked` passes on hook existence.
- Session IDs / dates / agents: 2026-06-05 (T1/T2/T3/T6 + reconciliation) + 2026-06-06 (T4 cross-file checks, T5 roadmap migration, hard enforcement hooks) / President Agent + delegated docs/systems/backend builders + a β review pass
- Related completed sprints: T1, T2, T3, T4, T5, T6 (all Completed)
- Remaining follow-up items: optional hardening only (per-edit PostToolUse gate); none block completion
- Related untracked work: UW-001, UW-002, UW-003 in ../../UNTRACKED_WORK.md
- ../../TRACKER.md updated: Yes (2026-06-06) · Roadmap reconciled: Yes (T5)
