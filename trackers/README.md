# trackers/

Per-item tracker files and fill-in templates for the enforced tracking system
defined in [`_planning/tracker-system-improvements.md`](../_planning/tracker-system-improvements.md).

The top-level source of truth is [`../TRACKER.md`](../TRACKER.md). This directory
holds the per-epic and per-sprint tracker documents it links to, plus the blank
templates used to author them. Untracked work is logged in
[`../UNTRACKED_WORK.md`](../UNTRACKED_WORK.md).

## Layout

| Path | Contents |
| --- | --- |
| `epics/` | One tracker file per epic — `E-<id>-<short-name>.md` (spec §22). Linked from `../TRACKER.md`. |
| `sprints/` | One tracker file per sprint — `<sprint-id>-<short-name>.md` (spec §23). Each links to its parent epic. |
| `templates/` | Blank fill-in-the-blank templates (spec §35). Copy one, replace every `<angle-bracket>` placeholder, drop the result into `epics/` or `sprints/`. |

## Templates (spec §35)

| Template | Spec section | Used to author |
| --- | --- | --- |
| `templates/EPIC_TEMPLATE.md` | §22 | An epic tracker → `epics/` |
| `templates/SPRINT_TEMPLATE.md` | §23 | A sprint tracker → `sprints/` |
| `templates/SESSION_LOG_TEMPLATE.md` | §24 | A session-log entry inside an epic/sprint tracker |
| `templates/UNTRACKED_WORK_TEMPLATE.md` | §18 | An entry in `../UNTRACKED_WORK.md` |
| `templates/DEFINITION_TEMPLATE.md` | §8.1 | A definition record in `../TRACKER.md` |
| `templates/CHANGE_LOG_TEMPLATE.md` | §25 | A change-log entry inside any tracker |
| `templates/EVIDENCE_LOG_TEMPLATE.md` | §26 | An evidence-log entry inside any tracker |
| `templates/VERIFICATION_TEMPLATE.md` | §10 | A Verification Matrix row |
| `templates/RECONCILIATION_TEMPLATE.md` | §32 | A reconciliation record |
| `templates/COMPLETION_RECORD_TEMPLATE.md` | §15 / §16 / §37 | The completion record at the bottom of an epic/sprint tracker |

## Rules of use

- Replace **every** `<angle-bracket>` placeholder before the file is considered authored. A leftover placeholder is treated as an unfinished field.
- Use only the allowed states (spec §19): `Planned`, `Ready`, `Active`, `Blocked`, `Paused`, `Review Needed`, `Completed`, `Cancelled`, `Superseded`.
- Use precise, state-safe language (spec §21). No "probably", "should be fine", "seems done".
- Percent completion is conservative and evidence-based (spec §20). Nothing is `100%` without satisfied Definition of Done + recorded evidence + a synced `../TRACKER.md`.
- Every active/planned epic and sprint must have a file here, linked from `../TRACKER.md` (spec §22, §23).
- Session logs are append-only; corrections are themselves logged (spec §24).
