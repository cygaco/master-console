<!-- COMPLETION RECORD TEMPLATE — completion fields (completed epics,
     completed sprints) and the Definition-of-Done gate. Paste into the
     "Completion record" section of an epic or sprint tracker when (and only when) the item
     is actually complete. An item must NOT be recorded complete unless its parent TRACKER.md
     entry also confirms completion, and not at 100% unless every gate is met.
     Replace every <angle-bracket> placeholder. -->

## Completion Record — <EPIC-OR-SPRINT-LABEL> <TITLE>

- **Label, including number:** <LABEL-AND-NUMBER>
- **Link to its own tracker:** <THIS FILE / relative link>
- **Goal:** <THE GOAL AS COMPLETED>
- **Final state:** <Completed | Cancelled | Superseded>
- **Percent completion:** <100% (Completed) | n/a (Cancelled/Superseded)>
- **Completion timestamp:** <YYYY-MM-DD HH:MM TZ>
- **Session IDs that worked on it:** <LIST>
- **Dates and times worked on:** <LIST>
- **Agents that worked on it:** <LIST>
- **Definition of done used:** <REFERENCE / RESTATEMENT OF THE DOD THAT WAS SATISFIED>
- **Evidence of completion:** <CONCRETE EVIDENCE — links, commands run, validation output, diffs, existence/nonexistence/wiring confirmations>
- **Remaining follow-up items:** <LIST or None — if any, where they are tracked>
- **Parent epic (sprints only):** <EPIC-LABEL or n/a>
- **Related completed sprints (epics only):** <LIST or n/a>
- **Related untracked work, if any:** <LINKS to ../../UNTRACKED_WORK.md or None>
- **Related definitions:** <TERMS or None>
- **Related verification results:** <VERIFICATION MATRIX ROWS / STATES that prove completion>

### Completion gate checklist — all must be true for 100% / Completed
- [ ] Definition of done is satisfied
- [ ] Evidence is recorded
- [ ] Session log is updated
- [ ] Change log is updated if the plan changed
- [ ] Relevant definitions exist and are current
- [ ] Required files and directories are verified to exist
- [ ] Required nonexistence is verified
- [ ] Required wirings are verified
- [ ] Required validators pass, or failures are explicitly tracked
- [ ] Roadmap state is reconciled
- [ ] Related untracked work is reconciled or explicitly linked
- [ ] Next action is empty, or moved into a follow-up item
- [ ] ../../TRACKER.md and this item's own tracker agree on completion

<!-- For Cancelled / Superseded items, also record:
- Reason cancelled or superseded: <REASON>
- Superseding item, if any: <LABEL>
- Affected documents: <LIST>
- Follow-up required, if any: <LIST or None>
-->
