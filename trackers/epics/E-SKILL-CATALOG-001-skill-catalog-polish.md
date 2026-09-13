<!-- EPIC TRACKER — spec §22. Linked from ../../TRACKER.md. Template: ../templates/EPIC_TEMPLATE.md
     States (§19): Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# E-SKILL-CATALOG-001 — Skill Catalog Polish

- **Epic label and number:** E-SKILL-CATALOG-001
- **Title:** Skill Catalog Polish
- **Owner:** President Agent
- **Parent roadmap area:** ../../ROADMAP.md § Epics → Planned epics (E-SKILL-CATALOG-001 entry; detail: the `🟡 0.13.0 — Skill Catalog Polish` deprecated-milestone block)
- **Goal:** Zero known papercuts in the skill catalog — every shipped skill is either end-to-end-verified or honestly marked deprecated.
- **Background:** `/research:deep` is a large untested skill with stale model versions; the Gemini catalog has ghost models that fail HTTP 404; `/ui:review` hardcodes product names; `/retro:context` + `/retro:code` and `/fav:list` + `/fav:search` each want to be one skill with modes; and `events.jsonl` crosses ~6MB without auto-roll. The catalog is a place where you currently have to know which skills "actually work" vs which are aspirational — this epic removes that burden.
- **Scope:** (1) `/research:*` consolidation — validate `/research:deep` end-to-end OR deprecate it toward `/research:simple`, and add a synthesis phase to `/research:simple`. (2) Provider catalog hygiene — remove ghost Gemini models; add a catalog-validation check that pings declared models and flags 404s; flip the redteam default. (3) Skill merges + genericize — `/retro:context` + `/retro:code` → `/retro:full`; `/fav:list` + `/fav:search` → `/fav`; parameterize `/ui:review` (remove hardcoded product names; configurable design-system path). (4) Events retention policy — compress/roll `events.jsonl` above ~10MB.
- **Out of scope:** None specific.
- **Current state:** Planned
- **Percent completion:** 0% — Planned; not closed as this epic. Some sub-items have been addressed piecemeal (provider/ghost-model hygiene was partly handled in the 2026-05-30 dispatch cluster), but no DoD item is complete-with-evidence under this epic. Conservative per §20.

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced (§20, §27). -->
- [ ] `/skills:cleanup` reports zero known-broken skills.
- [ ] `events.jsonl` auto-rolls without manual `sleep:deep` intervention.
- [ ] `/scan:mc-staleness` for providers exits 0 across declared models.
- [ ] `/ui:review` runs cleanly on a fresh portfolio product with no source edits.

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- Command — see ../../TRACKER.md
- Roadmap — see ../../TRACKER.md

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- [SP-20260525-010](../sprints/SP-20260525-010.md) — Planned — `/research:*` consolidation (validate or deprecate `/research:deep` + add synthesis phase to `/research:simple`)
- [SP-20260525-011](../sprints/SP-20260525-011.md) — Planned — provider catalog hygiene (remove ghost Gemini models + catalog-validation check + redteam default flip)
- [SP-20260525-012](../sprints/SP-20260525-012.md) — Planned — skill merges + genericize (`/retro:full`, `/fav`, `/ui:review` parameterized)
- [SP-20260525-013](../sprints/SP-20260525-013.md) — Planned — events retention policy (auto-roll `events.jsonl` above threshold)

## Dependencies
- None currently recorded.

## Blockers
- None currently recorded.

## Risks
- None currently recorded.

## Decisions
- None currently recorded.

## Open questions
- Absorbed open items (homed here by sprint T5 from the deprecated 0.18.1 reconcile block): **H4** — port `/roadmap:improve` + `/roadmap:ship` (almanac-built multi-agent Workflow skills) into canonical *(almanac)*; **G1** — add the product-layer-vs-dev-tooling-layer distinction to the `DICTIONARY.md` glossary *(dreamteam W-16)*; **G2** — add the invocation-authority-vs-mode clarification to `gamma.md` *(mc WI-12)*. Decide one-by-one whether each lands in this epic or as a standalone doc/skill fix when activated.

## Session log
<!-- Append-only (§24). One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
### 2026-06-06 — Session 2026-06-06-roadmap-epic-migration (june-5)
- Agent(s): President Agent (via systems builder) · Mode: sprint
- Work performed: Created this epic tracker file during the T5 roadmap→epic migration of `_planning/tracker-system-improvements.md`; populated Goal/Background/Scope/DoD from the `🟡 0.13.0` deprecated-milestone block and the § Epics Planned-epics entry in ../../ROADMAP.md.
- Files changed: trackers/epics/E-SKILL-CATALOG-001-skill-catalog-polish.md · Paths changed: none · Wirings changed: none
- Decisions: None · Issues discovered: None
- Definitions added/changed: None
- State change: (new) → Planned · Completion change: 0% → 0%
- Verification performed: Confirmed this epic file was absent before authoring; sourced content from ../../ROADMAP.md § Epics + the `🟡 0.13.0` block · Validation run: `node scripts/trackers/validate.js` · Validation result: PASS
- Next action: None — Planned (opportunistic, cadence-rule permitting).
- Evidence/references: ../../ROADMAP.md § Epics → Planned epics (E-SKILL-CATALOG-001); `🟡 0.13.0 — Skill Catalog Polish` block.

## Change log
<!-- §25 -->
### 2026-06-06 — Session 2026-06-06-roadmap-epic-migration
- Changed: Created E-SKILL-CATALOG-001 epic tracker file (T5 roadmap→epic migration).
- Reason: Migrate the deprecated `🟡 0.13.0` milestone into an epic tracker per spec §29.
- Affected: new trackers/epics/E-SKILL-CATALOG-001-skill-catalog-polish.md; ../../ROADMAP.md § Epics entry; ../../TRACKER.md.
- Previous state: No epic tracker file existed for Skill Catalog Polish.
- New state: Epic tracker authored; epic Planned at 0%.

## Evidence log
<!-- §26 — concrete enough that another agent can resume/verify without memory -->
- None currently recorded.

## Verification log
<!-- §10 states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| This epic tracker file | Yes | Verified Exists | trackers/epics/E-SKILL-CATALOG-001-skill-catalog-polish.md | authored this session; `node scripts/trackers/validate.js` PASS | 2026-06-06 | President Agent |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
None — Planned (opportunistic, cadence-rule permitting).

## Completion record
<!-- Fill only on completion (§15/§37). See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: Not yet complete
- Percent completion: n/a
- Completion timestamp: n/a
- Definition of done used: see Definition of Done section above (spec §37)
- Evidence of completion: n/a — Planned, not yet started
- Session IDs / dates / agents: 2026-06-06-roadmap-epic-migration / 2026-06-06 / President Agent (via systems builder)
- Related completed sprints: None
- Remaining follow-up items: SP-20260525-010..013 (all Planned)
- Related untracked work: None
- ../../TRACKER.md updated: Yes · Roadmap reconciled: Yes
