<!-- SPRINT TRACKER TEMPLATE. Copy to /trackers/sprints/<sprint-id>-<short-name>.md
     Replace every <angle-bracket> placeholder. Must be linked from ../../TRACKER.md and from its parent epic.
     A sprint must have a parent epic unless explicitly marked temporary untracked/reconciliation work.
     States: Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# <SPRINT-LABEL e.g. T1> — <TITLE>

- **Sprint label and number:** <SPRINT-LABEL-AND-NUMBER>
- **Title:** <TITLE>
- **Owner:** <OWNER>
- **Parent epic:** [<EPIC-LABEL>](../epics/<epic-file>.md)
- **Goal:** <ONE-OR-TWO-SENTENCE GOAL>
- **Scope:** <WHAT IS IN SCOPE>
- **Out of scope:** <WHAT IS EXPLICITLY OUT OF SCOPE>
- **Current state:** <Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded>
- **Percent completion:** <0-100>% — <conservative, evidence-based rationale>

## Definition of Done
- [ ] <DOD ITEM 1>
- [ ] <DOD ITEM 2>

## Related definitions
- <TERM> — see ../../TRACKER.md
- <None currently recorded.>

## Tasks
- [ ] <TASK 1>
- [ ] <TASK 2>

## Files expected to change
- <PATH>
- <None currently recorded.>

## Files actually changed
- <PATH> — <YYYY-MM-DD>
- <None currently recorded.>

## Paths expected to exist
- <PATH>
- <None currently recorded.>

## Paths verified to exist
- <PATH> — Verified Exists <YYYY-MM-DD> via <CHECK> by <AGENT>
- <None currently recorded.>

## Paths verified nonexistent
- <PATH> — Verified Nonexistent (and expected nonexistent) <YYYY-MM-DD> via <CHECK> by <AGENT>
- <None currently recorded.>

## Wirings expected
- <WIRING NAME — purpose — source file>
- <None currently recorded.>

## Wirings verified
- <WIRING NAME> — Verified Wired in <FILE> <YYYY-MM-DD> via <CHECK> by <AGENT>
- <None currently recorded.>

## Dependencies
- <DEPENDENCY> · <or: None currently recorded.>

## Blockers
- <BLOCKER — next action to clear it> · <or: None currently recorded.>

## Risks
- <RISK — likelihood / impact / mitigation> · <or: None currently recorded.>

## Decisions
- <YYYY-MM-DD> — <DECISION> — <rationale>
- <None currently recorded.>

## Open questions
- <OPEN QUESTION — who owns the answer>
- <None currently recorded.>

## Session log
<!-- Append-only. See SESSION_LOG_TEMPLATE.md for the full field set. -->
### <YYYY-MM-DD HH:MM TZ> — Session <SESSION-ID>
- Agent(s): <AGENT(S)> · Mode: <MODE>
- Work performed: <WHAT WAS DONE>
- Files changed: <FILES> · Paths changed: <PATHS> · Wirings changed: <WIRINGS>
- Decisions: <DECISIONS> · Issues discovered: <ISSUES>
- Definitions added/changed: <DEFINITIONS or None>
- State change: <FROM → TO> · Completion change: <X% → Y%>
- Verification performed: <WHAT> · Validation run: <CMD> · Validation result: <PASS/FAIL/Not run>
- Next action: <NEXT ACTION>
- Evidence/references: <LINKS / RECORDS>

## Change log
### <YYYY-MM-DD HH:MM TZ> — Session <SESSION-ID>
- Changed: <WHAT CHANGED>
- Reason: <WHY>
- Affected: <DOCS/EPICS/SPRINTS/DEFS/PATHS/WIRINGS>
- Previous state: <PREVIOUS>
- New state: <NEW>

## Evidence log
### <YYYY-MM-DD HH:MM TZ> — <CLAIM>
- Evidence type: <File changed | Test run | Command run | Validation result | Review note | Existence confirmation | Nonexistence confirmation | Wiring confirmation | Link>
- Detail/location: <PATH / COMMAND / OUTPUT / LINK>
- Verified by: <AGENT> · Supports: <WHICH DOD ITEM / CLAIM>

## Verification log
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| <ITEM> | <Yes/No> | <VERIFICATION STATE> | <PATH / WIRING SITE> | <COMMAND OR FILE CHECK> | <YYYY-MM-DD> | <AGENT> |

## Current next action
<SINGLE CLEAR NEXT ACTION, or: None — sprint <completed | cancelled | superseded>.>

## Completion record
<!-- Fill only on completion. See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: <Completed | Cancelled | Superseded — or: Not yet complete>
- Percent completion: <100% | n/a>
- Completion timestamp: <YYYY-MM-DD HH:MM TZ | n/a>
- Definition of done used: <REFERENCE TO DOD ABOVE>
- Evidence of completion: <LINKS / RECORDS>
- Session IDs / dates / agents: <LIST>
- Parent epic: <EPIC-LABEL>
- Remaining follow-up items: <LIST or None>
- Related untracked work: <LINKS to ../../UNTRACKED_WORK.md or None>
- ../../TRACKER.md updated: <Yes/No> · Roadmap reconciled: <Yes/No>
