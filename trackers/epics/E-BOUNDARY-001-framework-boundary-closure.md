<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-BOUNDARY-001 — Framework Boundary Closure

- **Epic label and number:** E-BOUNDARY-001
- **Title:** Framework Boundary Closure
- **Owner:** President Agent
- **Parent roadmap area:** Epics → Planned epics — see ../../ROADMAP.md (detail under the `🟡 0.10.0` deprecated-milestone block)
- **Goal:** Move the framework/product boundary from "documented" to "enforced at write-time" — relocate the MC-as-product specs to a private repo, flip `ROOT_LEAK_PENDING_SCRUB=false`, and have `framework-purity-guard` hard-refuse any reintroduction.
- **Background:** `_requirements/00-canonical/*` and product-titled `_requirements/03-architecture/*` currently live at canonical root; the `ROOT_LEAK_PENDING_SCRUB=true` flag keeps `framework-purity.js` from rejecting them. The framework cannot self-execute the repo move — it is operator-scoped — so the boundary is documented but not yet enforced.
- **Scope:** `/portfolio:new --slug mc-as-product` + move `_requirements/00-canonical/*`, product-titled `_requirements/03-architecture/*`, and `_docs/research|briefs|clones|imports/*` into the new private repo; flip the flag to `false` in `framework-purity.js`; regenerate the manifest; `/scan:framework-purity --full` clean; verify a post-scrub install writes no product-titled paths.
- **Out of scope:** The MC-as-product deep-dogfooding bet (parked E-MC-DOGFOOD) — this epic only creates the private workspace, not the dogfooding programme.
- **Current state:** Planned
- **Percent completion:** 0% — Planned; no scrub, flag flip, or enforcement hardening performed yet. Operator-gated on the repo move.

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [ ] Private `mc-as-product` repo exists with the relocated specs + a first ROADMAP entry
- [ ] `grep -rn "00-canonical\|jobzooka\|dreamteam\|aiweb\|companycam" .` in canonical returns hits only in ROADMAP archive references + version-history
- [ ] `framework-purity-guard` rejects a synthetic `_requirements/00-canonical/foo.md` write attempt on canonical
- [ ] A fresh `/mc:setup` of canonical into a new product writes zero product-titled paths

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Roadmap — see ../../TRACKER.md
- Epic — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- [SP-20260525-001](../sprints/SP-20260525-001.md) — Planned — maintainer canonical scrub (relocate specs to the private repo)
- [SP-20260525-002](../sprints/SP-20260525-002.md) — Planned — post-scrub gate hardening (flip flag + harden framework-purity-guard)

## Dependencies
- Operator runs the repo creation + spec move — the framework cannot self-execute it · blocking

## Blockers
- Operator-scoped repo move not yet performed — next action: operator runs `/portfolio:new --slug mc-as-product` + relocates the specs.

## Risks
- None currently recorded.

## Decisions
- None currently recorded.

## Open questions
- None currently recorded.

## Session log
<!-- Append-only (§24). One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
### 2026-06-06 — Session 2026-06-06-t5-roadmap-epic-migration
- Agent(s): President Agent (via systems builder) · Mode: sprint
- Work performed: Created this epic file during the T5 roadmap→epic migration — captured the framework boundary-closure work as a Planned epic with real Goal/Background/Scope/DoD and linked it to its two Planned sprints.
- Files changed: trackers/epics/E-BOUNDARY-001-framework-boundary-closure.md
- Paths changed: created trackers/epics/E-BOUNDARY-001-framework-boundary-closure.md · Wirings changed: None
- Decisions: None
- Issues discovered: None
- Definitions added/changed: None
- State change: (new) → Planned · Completion change: 0% → 0%
- Verification performed: Confirmed the epic file did not previously exist before authoring · Validation run: `node scripts/trackers/validate.js` · Validation result: PASS
- Next action: None — Planned; operator-gated (awaiting the canonical scrub).
- Evidence/references: ../../ROADMAP.md § Epics → Planned epics; ../../TRACKER.md.

## Change log
<!-- §25 -->
### 2026-06-06 — Session 2026-06-06-t5-roadmap-epic-migration
- Changed: Created E-BOUNDARY-001 as a Planned epic.
- Reason: Migrate the framework boundary-closure work from the roadmap (`🟡 0.10.0` deprecated-milestone block) into an enforced epic tracker file (T5).
- Affected: new trackers/epics/E-BOUNDARY-001-framework-boundary-closure.md; ../../TRACKER.md; ../../ROADMAP.md.
- Previous state: No epic tracker file existed for framework boundary closure.
- New state: Planned epic authored at 0%, linked to SP-20260525-001 + SP-20260525-002.

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
### 2026-06-06 — Epic file created
- Evidence type: File changed
- Detail/location: trackers/epics/E-BOUNDARY-001-framework-boundary-closure.md
- Verified by: President Agent · Supports: epic-exists (T5 migration deliverable)

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| E-BOUNDARY-001 epic file | Yes | Verified Exists | trackers/epics/E-BOUNDARY-001-framework-boundary-closure.md | authored this session; `node scripts/trackers/validate.js` PASS | 2026-06-06 | President Agent |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
None — Planned; operator-gated (awaiting the canonical scrub).

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Not yet complete
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: see Definition of Done section above (spec §37)
- Evidence of completion: n/a — Planned
- Session IDs / dates / agents: 2026-06-06-t5-roadmap-epic-migration / 2026-06-06 / President Agent (via systems builder)
- Related completed sprints: None
- Remaining follow-up items: SP-20260525-001 (maintainer canonical scrub); SP-20260525-002 (post-scrub gate hardening)
- Related untracked work: None
- ../../TRACKER.md updated: No · Roadmap reconciled: No
