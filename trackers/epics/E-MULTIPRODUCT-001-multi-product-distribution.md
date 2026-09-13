<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-MULTIPRODUCT-001 — Multi-Product Distribution Maturity

- **Epic label and number:** E-MULTIPRODUCT-001
- **Title:** Multi-Product Distribution Maturity
- **Owner:** President Agent
- **Parent roadmap area:** [../../ROADMAP.md](../../ROADMAP.md) § Epics → Planned epics (detail: the `🟡 0.12.0` deprecated-milestone block)
- **Goal:** Keep N≥3 portfolio products current with low maintainer touch — capsules ship complete orchestrator infra, the installer is branch-safe by default, same-name agent collisions prompt for resolution, and the install matrix exercises cross-version `--apply`.
- **Background:** DreamTeam is missing `/sprint:full` orchestrator infra (`paths.sprintFullAutonomy`, `paths.sprintSchemas`, and the full-reports/checkpoints/plan-contracts/approvals/releases/history/routing dirs); `/warp:setup` runs on `main` by default with no branch guard; same-name agent collisions are silent; and the install matrix exercises only dry-run for cross-version upgrades. Each new product is a custodial burden until these gaps close.
- **Scope:** DreamTeam orchestrator capsule fix (canonical ships the capsule; the operator pulls it from the dreamteam-side session — MC canonical never reaches into dreamteam directly); installer branch-safety (`warp/install-<timestamp>` default; refuse on `main` without `--yes-install-on-main`); same-name agent collision detection at install; install-matrix cross-version `--apply` via historical-source-tree fixtures; a `/scan:skill-engines` skill (parse every skill .md for `scripts/...` refs, verify the engine exists) wired into release-build + `/warp:setup` postflight.
- **Out of scope:** Central multi-product architecture (parked E-CENTRAL-MC).
- **Current state:** Planned
- **Percent completion:** 0% — not started; Planned. Conservative per §20.

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [ ] `/portfolio:sync` lands clean across ≥3 products in one invocation
- [ ] Fresh-product `/warp:setup` on `main` requires explicit `--yes-install-on-main` or auto-creates a branch
- [ ] A synthetic same-name collision prompts for resolution instead of silently overwriting
- [ ] Install matrix exercises cross-version `--apply` against ≥2 historical-source-tree fixtures
- [ ] `/scan:skill-engines` exits 0 across canonical and release-build refuses a capsule where any installed skill's engine script is missing

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Roadmap — see ../../TRACKER.md
- Epic — see ../../TRACKER.md
- Path — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- SP-20260525-005 — Planned — DreamTeam orchestrator capsule fix
- SP-20260525-006 — Planned — installer branch-safety
- SP-20260525-007 — Planned — same-name agent collision detection
- SP-20260525-008 — Planned — install-matrix cross-version `--apply` coverage
- SP-20260525-009 — Planned — skill-engine coherence check

## Dependencies
- None currently recorded.

## Blockers
- None currently recorded.

## Risks
- None currently recorded.

## Decisions
- None currently recorded.

## Open questions
- None currently recorded.

## Session log
<!-- Append-only (§24). One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
### 2026-06-06 — Session 2026-06-06-t5-roadmap-to-epics
- Agent(s): President Agent (via systems builder) · Mode: sprint
- Work performed: Created this epic tracker file during the T5 roadmap→epic migration of `_planning/tracker-system-improvements.md` (§29) — captured the multi-product-distribution work from the deprecated `🟡 0.12.0` milestone block as an enforced Planned epic.
- Files changed: trackers/epics/E-MULTIPRODUCT-001-multi-product-distribution.md
- Paths changed: none · Wirings changed: none (authoring only; no git/regen/mode-wiring this session)
- Decisions: None
- Issues discovered: None
- Definitions added/changed: None
- State change: (new) → Planned · Completion change: 0% → 0%
- Verification performed: Confirmed this epic file did not previously exist before authoring; structure matched against ../templates/EPIC_TEMPLATE.md.
- Validation run: `node scripts/trackers/validate.js` · Validation result: PASS (exit 0)
- Next action: None — Planned.
- Evidence/references: ../../ROADMAP.md § Epics → Planned epics (`🟡 0.12.0` block); SP-20260525-005..009.

## Change log
<!-- §25 -->
### 2026-06-06 — Epic created during T5 roadmap→epic migration (President Agent via systems builder)
- Changed: Created E-MULTIPRODUCT-001 — Multi-Product Distribution Maturity, at Planned / 0%, from the deprecated `🟡 0.12.0` milestone block.
- Reason: T5 of `_planning/tracker-system-improvements.md` (§29) — migrate roadmap milestones → enforced epics; the multi-product-distribution work needs an epic tracker file as its source of truth.
- Affected: new trackers/epics/E-MULTIPRODUCT-001-multi-product-distribution.md; ../../ROADMAP.md (0.12.0 block deprecation); ../../TRACKER.md (Planned Epics).
- Previous state: No enforced epic tracker file existed for multi-product distribution (work lived only in the ROADMAP 0.12.0 block).
- New state: Epic authored; Planned at 0%.

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
### 2026-06-06 — Epic tracker file authored
- Evidence type: Existence confirmation
- Detail/location: trackers/epics/E-MULTIPRODUCT-001-multi-product-distribution.md authored this session from the ROADMAP `🟡 0.12.0` block.
- Verified by: President Agent · Supports: the 0% Planned state (authoring only; no scope work started).

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| This epic tracker file | Yes | Verified Exists | trackers/epics/E-MULTIPRODUCT-001-multi-product-distribution.md | authored this session | 2026-06-06 | President Agent |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
None — Planned.

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Not yet complete (Planned, 0%)
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: see Definition of Done section above (spec §37)
- Evidence of completion: n/a — not started (Planned)
- Session IDs / dates / agents: 2026-06-06-t5-roadmap-to-epics / 2026-06-06 / President Agent (via systems builder)
- Related completed sprints: None
- Remaining follow-up items: SP-20260525-005..009 (capsule fix / branch-safety / collision-detect / cross-version matrix / skill-engine coherence)
- Related untracked work: None
- ../../TRACKER.md updated: No (pending T5 Planned-Epics row) · Roadmap reconciled: No (pending 0.12.0 block deprecation)
