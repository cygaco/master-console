<!-- EPIC TRACKER TEMPLATE. Copy to /trackers/epics/E-<id>-<short-name>.md
     Replace every <angle-bracket> placeholder. Must be linked from ../../TRACKER.md.
     States: Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded -->

# <EPIC-LABEL e.g. E-EXAMPLE-001> — <TITLE>

- **Epic label and number:** <EPIC-LABEL-AND-NUMBER>
- **Title:** <TITLE>
- **Owner:** <OWNER e.g. President>
- **Parent roadmap area:** <ROADMAP-AREA / link to ROADMAP.md entry>
- **Goal:** <ONE-OR-TWO-SENTENCE GOAL>
- **Background:** <WHY THIS EPIC EXISTS / CONTEXT>
- **Scope:** <WHAT IS IN SCOPE>
- **Out of scope:** <WHAT IS EXPLICITLY OUT OF SCOPE>
- **Current state:** <Planned | Ready | Active | Blocked | Paused | Review Needed | Completed | Cancelled | Superseded>
- **Percent completion:** <0-100>% — <conservative, evidence-based rationale>

## Definition of Done
<!-- Concrete, checkable criteria. Nothing reaches 100% until all are satisfied + evidenced. -->
- [ ] <DOD ITEM 1>
- [ ] <DOD ITEM 2>
- [ ] <DOD ITEM 3>

## Related definitions
<!-- Terms from ../../TRACKER.md §Definitions that govern this epic -->
- <TERM> — see ../../TRACKER.md
- <None currently recorded.>

## Related sprints
<!-- Link each sprint tracker in /trackers/sprints/ -->
- [<SPRINT-LABEL>](../sprints/<sprint-file>.md) — <state> — <one-line goal>
- <None currently recorded.>

## Dependencies
- <DEPENDENCY> — <state / blocking?>
- <None currently recorded.>

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
<!-- Append-only. One entry per meaningful session; use SESSION_LOG_TEMPLATE.md fields. -->
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
<!-- concrete enough that another agent can resume/verify without memory -->
### <YYYY-MM-DD HH:MM TZ> — <CLAIM>
- Evidence type: <File changed | Test run | Command run | Validation result | Review note | Existence confirmation | Nonexistence confirmation | Wiring confirmation | Link>
- Detail/location: <PATH / COMMAND / OUTPUT / LINK>
- Verified by: <AGENT> · Supports: <WHICH DOD ITEM / CLAIM>

## Verification log
<!-- states: Verified Exists | Verified Nonexistent | Verified Wired | Verified Not Wired | Exists But Stale | Exists But Incomplete | Exists But Miswired | Missing But Required | Present But Should Be Removed | Unknown -->
| Item | Should exist? | State | Where / wired where | Proof (cmd/inspection) | Checked | By |
| --- | --- | --- | --- | --- | --- | --- |
| <ITEM> | <Yes/No> | <VERIFICATION STATE> | <PATH / WIRING SITE> | <COMMAND OR FILE CHECK> | <YYYY-MM-DD> | <AGENT> |

## Current next action
<!-- Required while state is not Completed/Cancelled/Superseded -->
<SINGLE CLEAR NEXT ACTION, or: None — epic <completed | cancelled | superseded>.>

## Completion record
<!-- Fill only on completion. See COMPLETION_RECORD_TEMPLATE.md. -->
- Final state: <Completed | Cancelled | Superseded — or: Not yet complete>
- Percent completion: <100% | n/a>
- Completion timestamp: <YYYY-MM-DD HH:MM TZ | n/a>
- Definition of done used: <REFERENCE TO DOD ABOVE>
- Evidence of completion: <LINKS / RECORDS>
- Session IDs / dates / agents: <LIST>
- Related completed sprints: <LIST>
- Remaining follow-up items: <LIST or None>
- Related untracked work: <LINKS to ../../UNTRACKED_WORK.md or None>
- ../../TRACKER.md updated: <Yes/No> · Roadmap reconciled: <Yes/No>
