<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-STABLE-CHANNEL-001 — Stable / LTS Release Channel

- **Epic label and number:** E-STABLE-CHANNEL-001
- **Title:** Stable / LTS Release Channel
- **Owner:** President Agent
- **Parent roadmap area:** ../../ROADMAP.md § Epics → Planned epics (E-STABLE-CHANNEL-001; detail in the deprecated-milestone block `🟡 0.18.0`)
- **Goal:** MC stops being one rolling `latest`. Releases flow `edge → latest → stable → lts`, and a release earns `stable`/`lts` only by passing the full regression seed + an artifact-first downstream contract test + a soak window. Products pin to a channel and choose stability over freshness.
- **Background:** Downstream products track a single rolling "latest" and inherit hollow-rung (capsule-gap) and regressed releases; there is no known-good channel to pin to. The operator's driving complaint is instability — a release that ships green can still carry a missing capsule or a fresh regression, and a consumer has no way to say "give me only the proven ones." This epic adds the channel taxonomy and the promotion gate that makes "stable" mean something earned, not assumed.
- **Scope:** A `channel` field on `version.json` / the release capsule; `release-build.js` tags the channel; channel-aware `/mc:check` + `/mc:update`; the stable-promotion gate (regression seed + contract test + migration/quorum checks + soak window); channel-aware update + pinning + downgrade-protection. Portfolio products default to `stable`.
- **Out of scope:** Building the regression seed itself (E-TEST-SUITE-001) and the executable consumer-contract gate itself (E-GOLDEN-FLOW-001) — this epic CONSUMES both at the promotion boundary; it does not build them.
- **Current state:** Planned
- **Percent completion:** 0% — Planned, no work started. Activates only after E-TEST-SUITE-001 (the regression seed that defines "stable") and E-GOLDEN-FLOW-001 (the executable contract gate that is the promotion-boundary substance) both land.

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [ ] A release carries a channel label — `version.json` / the release capsule has a `channel` field (`edge`/`latest`/`stable`/`lts`) and `release-build.js` tags it.
- [ ] The stable-promotion gate REFUSES to label a release `stable`/`lts` unless the regression seed (E-TEST-SUITE-001) + the contract test (E-GOLDEN-FLOW-001) + migration/quorum checks are all green AND the soak window has elapsed — fail-closed.
- [ ] `/mc:update --channel stable` installs only stable releases; portfolio products default to `stable`; pinning + downgrade-protection hold.
- [ ] A synthetic attempt to promote a hollow-rung release (missing capsule) to `stable` is REFUSED — proven against a deliberately capsule-gapped release.

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Roadmap — see ../../TRACKER.md
- Epic — see ../../TRACKER.md
- Evidence — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- Release-channel-model — Planned — add the `channel` field to `version.json` / the capsule and have `release-build.js` tag it.
- Stable-promotion-gate — Planned — the fail-closed gate that consumes the regression seed + contract test + migration/quorum checks + soak window.
- Channel-aware-update+pinning — Planned — channel-aware `/mc:check` + `/mc:update --channel`, product pinning, and downgrade-protection.

## Dependencies
- E-TEST-SUITE-001 — Active — the regression seed defines what "stable" means; must land first.
- E-GOLDEN-FLOW-001 — Active — the executable consumer-contract gate is the promotion-boundary substance; must land first.

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
### 2026-06-06 — Session 2026-06-06-t5-roadmap-to-epic (june-5)
- Agent(s): President Agent (via systems builder) · Mode: sprint
- Work performed: Created this epic tracker file during the T5 roadmap→epic migration of E-TRACKER-001 — authored from the EPIC_TEMPLATE to back the existing ../../ROADMAP.md § Epics → Planned epics E-STABLE-CHANNEL-001 entry. Planned epic, no implementation work started.
- Files changed: trackers/epics/E-STABLE-CHANNEL-001-stable-lts-channel.md (this file) · Paths changed: none · Wirings changed: none (authoring only)
- Decisions: None
- Definitions added/changed: None
- State change: (new) → Planned · Completion change: 0% → 0%
- Verification performed: Confirmed the ../../ROADMAP.md § Epics → Planned epics entry already links to this file and that the two named dependencies (E-TEST-SUITE-001, E-GOLDEN-FLOW-001) have epic tracker files on disk.
- Validation run: `node scripts/trackers/validate.js` · Validation result: PASS (exit 0)
- Next action: None — Planned; activate after E-TEST-SUITE-001 + E-GOLDEN-FLOW-001 land (and when a 2nd external consumer needs differentiated risk).
- Evidence/references: ../../ROADMAP.md § Epics → Planned epics (E-STABLE-CHANNEL-001); ../../TRACKER.md.

## Change log
<!-- §25 -->
### 2026-06-06 — E-STABLE-CHANNEL-001 created during T5 roadmap→epic migration (President Agent via systems builder)
- Changed: Created this epic tracker file (state (new) → Planned, 0%) to back the existing ../../ROADMAP.md § Epics → Planned epics E-STABLE-CHANNEL-001 entry.
- Reason: T5 of E-TRACKER-001 migrates ROADMAP milestones→epics; every planned epic needs a `trackers/epics/` file backing its ROADMAP entry.
- Affected: this epic file; backs the existing ../../ROADMAP.md § Epics → Planned epics E-STABLE-CHANNEL-001 entry (which already links here).
- Previous state: No epic tracker file existed for E-STABLE-CHANNEL-001 (ROADMAP entry linked to a not-yet-created file).
- New state: Epic tracker file exists; Planned at 0%; scope/DoD/dependencies recorded.

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
None currently recorded.

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
None currently recorded.

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
None — Planned; activate after E-TEST-SUITE-001 + E-GOLDEN-FLOW-001 land (and when a 2nd external consumer needs differentiated risk).

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Not yet complete (Planned, 0%)
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: see Definition of Done section above (spec §37)
- Evidence of completion: n/a — Planned; no work started
- Session IDs / dates / agents: 2026-06-06-t5-roadmap-to-epic / 2026-06-06 / President Agent (via systems builder)
- Related completed sprints: None
- Remaining follow-up items: Release-channel-model; Stable-promotion-gate; Channel-aware-update+pinning (all Planned)
- Related untracked work: None
- ../../TRACKER.md updated: No · Roadmap reconciled: Yes (ROADMAP § Epics entry already exists and links here)
