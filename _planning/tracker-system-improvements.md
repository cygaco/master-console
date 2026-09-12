# Roadmap, Epic, Sprint, Definition, and Tracker System Improvements

This document defines the required improvements to the Roadmap, Epic, Sprint, Definition, Tracker, and Agentic OS enforcement systems.

The goal is to make long-running work reliably planned, tracked, resumed, verified, audited, completed, reconciled, and enforced across sessions, agents, modes, files, and implementation phases.

This system must become the highest operational source of truth for long-running work and the definitions used to manage that work.

---

# 1. Purpose

The purpose of this work is to create an accurate, enforced, and resumable tracking system for workloads that span multiple sessions, agents, modes, and development phases.

During the agent system restructuring, where the system shifted from behaving like another development tool to behaving more like a company, several failures appeared:

- Work was lost between sessions.
- Work was believed complete when it was not.
- Work was believed incomplete when it was already complete.
- Agents repeated work unnecessarily.
- Plans changed without traceability.
- Sprints and epics drifted from actual implementation state.
- Terms were used inconsistently across sessions, modes, and agents.
- Definitions lived in memory, chat history, scattered files, or assumptions instead of one authoritative place.
- Claude's built-in memory was treated as authoritative even when stale, incomplete, unverifiable, or wrong.
- Work completed outside formal sprint or epic structures was not consistently captured.
- Tracker-related paths, files, hooks, modes, and wirings were assumed to exist without verification.
- System instructions described intended behavior but did not prove that the Agentic OS actually enforced it.

This system must prevent those failures going forward.

The tracker must truthfully mirror the actual state of long-running work and enable near-perfect resumption of large goals between sessions, with no meaningful loss, confusion, terminology drift, missing paths, missing wiring, or hidden dependency on memory.

Optimize first for completeness, correctness, auditability, enforceability, verification, and reliability. Efficiency can be optimized after the system has proven itself.

---

# 2. Core Outcome

When this work is complete, an agent must be able to resume the Agentic OS from written files alone and determine:

- What work exists.
- What work is active.
- What work is planned.
- What work is completed.
- What work is cancelled.
- What work is superseded.
- What work is untracked.
- What definitions govern the system.
- What paths exist.
- What paths are expected but missing.
- What paths are intentionally nonexistent.
- What modes exist.
- What modes are wired into tracking.
- What hooks, commands, validators, templates, or enforcement points exist.
- What enforcement is currently working.
- What enforcement is missing.
- What claims are proven by evidence.
- What claims are unverified.
- What the next action is.

The completed system must leave no known gaps in the Agentic OS tracking layer.

If a gap exists, it must be recorded as a blocker, validation failure, unfinished task, or follow-up item. No gap may remain invisible.

---

# 3. Source of Truth and Authority

The primary tracker must be named:

`TRACKER.md`

The existing `TRACKER.md` must be deleted, unwired, and replaced with the new system described here.

The new `TRACKER.md` has higher authority than:

- Claude's built-in memory
- Chat memory
- Implied context
- Informal summaries
- Agent assumptions
- Old roadmap language
- Unlinked sprint notes
- Unlinked implementation notes
- Prior terminology used before this tracker exists
- Undocumented code behavior
- Unverified wiring assumptions

When there is a conflict between sources, authority resolves in this order:

1. `TRACKER.md`
2. Definitions inside `TRACKER.md`
3. Verification and validation records linked from `TRACKER.md`
4. Epic tracker files
5. Sprint tracker files
6. Roadmap files
7. Untracked work logs
8. Directly inspected code, config, hooks, and paths
9. Claude memory or chat recollection

Claude memory may be used as a hint, but it must never override tracker state, tracker definitions, verified filesystem state, roadmap state, epic state, sprint state, wiring state, or completion evidence.

If direct inspection of code or paths contradicts tracker state, the tracker is not automatically overwritten. Instead, the contradiction must be recorded and reconciled through the reconciliation process.

---

# 4. Ownership

This tracker is owned by the President agent.

The President agent is accountable for:

- Ensuring `TRACKER.md` exists.
- Ensuring `TRACKER.md` is the highest written source of truth for tracked work.
- Ensuring all definitions used by the roadmap, epic, sprint, tracker, and Agentic OS systems are captured in `TRACKER.md`.
- Ensuring all epics and sprints are represented truthfully.
- Ensuring all referenced files, directories, modes, hooks, commands, validators, templates, and wirings are verified.
- Ensuring expected nonexistence is recorded where relevant.
- Ensuring tracker updates happen at meaningful intervals.
- Ensuring completed work is not lost.
- Ensuring incomplete work is not incorrectly marked complete.
- Ensuring untracked work is captured.
- Ensuring other agents follow the tracker system.
- Ensuring roadmap, epic, sprint, definition, verification, and untracked-work documents stay consistent.
- Ensuring enforcement mechanisms exist rather than relying only on prose instructions.
- Ensuring tracker validation is run and failures are corrected or tracked.
- Ensuring no known Agentic OS tracking gap remains invisible.

Other agents may update tracker documents when appropriate, but the President agent owns correctness, reconciliation, enforcement, validation, and final state authority.

---

# 5. Required Tracker Structure

`TRACKER.md` must include, at minimum, the following sections:

1. Header
2. How to Use This Document
3. Authority and Conflict Resolution
4. Definitions
5. System Inventory
6. Verification Matrix
7. Active Epics
8. Active Sprints
9. Planned but Not Started Epics
10. Planned but Not Started Sprints
11. Completed Epics
12. Completed Sprints
13. Cancelled or Superseded Work
14. Untracked Work
15. State Model
16. Percent Completion Rules
17. Language Rules
18. Update Triggers
19. Enforcement Requirements
20. Validation Requirements
21. Roadmap Rules
22. Epic Tracker Rules
23. Sprint Tracker Rules
24. Session Logging Rules
25. Change Tracking Rules
26. Evidence Rules
27. Definition of Done
28. Reconciliation Rules
29. Required Files
30. Required Wirings
31. Required Templates
32. Implementation Priority
33. Non-Negotiable Requirements
34. Known Gaps and Open Flaws

No required section may be omitted.

If a section has no entries yet, it must explicitly say `None currently recorded.` or another precise equivalent.

Blank sections are prohibited because they create ambiguity.

---

# 6. Header Requirements

The tracker must include:

- Title
- Version
- Last updated timestamp
- Owner
- Purpose
- Authority statement
- Links to related tracker documents
- Current global state summary
- Last validation timestamp
- Current validation status
- Known gaps count
- Current highest-priority next action

Example:

`# TRACKER.md`

`Version: 1.0.0`

`Owner: President Agent`

`Last Updated: YYYY-MM-DD HH:MM TZ`

`Last Validation: YYYY-MM-DD HH:MM TZ`

`Validation Status: Passing | Failing | Not Yet Run`

`Authority: Highest written source of truth for active, planned, completed, cancelled, superseded, untracked, definition-bound, and verification-bound long-running work.`

---

# 7. How to Use This Document

This section must exist in `TRACKER.md`.

It must be written as operational instructions, not passive documentation.

Every agent must read and apply this section before doing meaningful work that could affect roadmap, epic, sprint, definition, implementation, documentation, validation, wiring, or Agentic OS state.

## 7.1 Required Use Cases

Agents must use `TRACKER.md` when:

- Starting work.
- Resuming work.
- Planning work.
- Creating an epic.
- Creating a sprint.
- Updating an epic.
- Updating a sprint.
- Completing an epic.
- Completing a sprint.
- Cancelling work.
- Superseding work.
- Changing scope.
- Discovering a blocker.
- Resolving a blocker.
- Changing definitions.
- Introducing new terms.
- Interpreting existing terms.
- Verifying paths.
- Verifying file existence.
- Verifying file nonexistence.
- Verifying directory existence.
- Verifying hooks.
- Verifying commands.
- Verifying mode wiring.
- Verifying validator behavior.
- Working outside a sprint.
- Preparing a handoff.
- Compacting or summarizing context.
- Switching modes.
- Reconciling roadmap state.
- Reviewing completion claims.
- Validating project state.
- Debugging state mismatch.
- Answering “what is done?”
- Answering “what is next?”
- Answering “what exists?”
- Answering “what is missing?”
- Answering “what is wired?”
- Answering “what is enforced?”

## 7.2 Start-of-Work Procedure

Before beginning meaningful work, the agent must:

1. Open or inspect `TRACKER.md`.
2. Identify whether the work belongs to:
   - An active epic
   - An active sprint
   - A planned epic
   - A planned sprint
   - Completed work that is being revisited
   - Cancelled or superseded work
   - Untracked work
   - A new epic or sprint that must be created
3. Check the Definitions section for relevant terminology.
4. Confirm the current state of the relevant epic or sprint.
5. Confirm the current next action.
6. Confirm blockers and dependencies.
7. Confirm whether the roadmap needs to be updated.
8. Confirm whether tracker files exist for the relevant epic or sprint.
9. Confirm whether all referenced paths exist or are intentionally nonexistent.
10. Confirm whether all referenced modes, hooks, commands, and enforcement points are actually wired.
11. Create missing tracker files if required.
12. Record missing paths, missing wiring, or unclear state as validation failures if discovered.
13. Record the session start if the work is meaningful enough to affect state.

Agents must not begin substantial work from memory alone.

## 7.3 During-Work Procedure

During meaningful work, the agent must update tracker records when:

- The goal changes.
- The scope changes.
- A task is added.
- A task is removed.
- A blocker is discovered.
- A blocker is resolved.
- A decision is made.
- Evidence is produced.
- Files are changed.
- Paths are created.
- Paths are deleted.
- Paths are discovered missing.
- A wiring is added.
- A wiring is removed.
- A wiring is discovered missing.
- A mode is added or changed.
- A hook is added or changed.
- A validation command is added or changed.
- A definition is introduced.
- A definition changes.
- Work moves from planned to active.
- Work moves from active to review.
- Work moves from review to completed.
- Work is cancelled.
- Work is superseded.
- The next action changes.
- The percent completion changes meaningfully.

Agents do not need to update the tracker after every tiny edit, but they must never allow meaningful state, scope, definition, evidence, path, wiring, enforcement, or validation changes to go untracked.

## 7.4 End-of-Work Procedure

Before ending a meaningful work session, the agent must update:

- `TRACKER.md`
- Relevant epic tracker
- Relevant sprint tracker
- `ROADMAP.md`, if roadmap state changed
- `UNTRACKED_WORK.md`, if work happened outside a tracked epic or sprint
- Definitions section, if terms were introduced or changed
- System Inventory, if paths, modes, hooks, commands, validators, templates, or wiring changed
- Verification Matrix, if any existence, nonexistence, or wiring state was checked
- Evidence log, if work was completed or verified
- Change log, if scope, state, definition, path, wiring, or plan changed
- Session log

The agent must leave a clear next action unless the item is completed, cancelled, or superseded.

## 7.5 Resume Procedure

When resuming work, the agent must use tracker files as the source of truth.

The agent must:

1. Read `TRACKER.md`.
2. Read the relevant epic tracker.
3. Read the relevant sprint tracker.
4. Read relevant definitions.
5. Read latest session log entries.
6. Read latest change log entries.
7. Read latest evidence log entries.
8. Read the System Inventory.
9. Read the Verification Matrix.
10. Identify the next action.
11. Verify whether blockers still exist.
12. Verify whether referenced files and wirings still exist if the work depends on them.
13. Continue from tracker state, not from memory.

If memory conflicts with tracker state, the tracker wins.

If tracker state conflicts with filesystem or code inspection, the conflict must be reconciled before completion can be claimed.

If tracker state is unclear, the agent must mark the state as unclear and reconcile it before proceeding.

## 7.6 Completion Procedure

Before claiming work is complete, the agent must verify:

- The definition of done exists.
- The definition of done is satisfied.
- Evidence is recorded.
- Files changed are listed.
- Required paths exist.
- Required paths that should not exist are confirmed nonexistent.
- Required directories exist.
- Required templates exist.
- Required hooks exist and are wired.
- Required modes exist and are wired.
- Required commands exist and are runnable.
- Required validators exist and are runnable.
- Required validation checks pass or failures are tracked.
- Tests, validation, or review steps are recorded.
- Session log is updated.
- Change log is updated if the plan changed.
- Roadmap state is reconciled.
- Epic tracker is updated.
- Sprint tracker is updated.
- `TRACKER.md` is updated.
- Remaining follow-up work is either explicitly recorded or confirmed absent.
- No required definition is missing.
- No related untracked work remains unreconciled.
- No referenced path, wiring, or enforcement point remains assumed but unverified.

Agents must not say work is complete unless the tracker and evidence support that claim.

## 7.7 Definition Use Procedure

Before using a system term in planning or tracking, the agent must check whether the term is defined in `TRACKER.md`.

If the term is defined, the agent must use it according to the recorded definition.

If the term is not defined and it affects planning, execution, state, authority, completion, enforcement, validation, or Agentic OS behavior, the agent must add it to the Definitions section before relying on it.

If a term has conflicting meanings across older documents, the agent must:

1. Record the conflict.
2. Choose or propose the authoritative definition.
3. Update `TRACKER.md`.
4. Update affected documents or mark them stale.
5. Add a change log entry.
6. Run or update validation if the definition affects enforcement.

Definitions must not live only in chat, memory, code comments, or scattered documents.

## 7.8 Verification Use Procedure

Before relying on any referenced path, file, directory, hook, command, mode, validator, template, or wiring, the agent must verify its current state.

The agent must record whether each checked item is:

- Exists and is correct
- Exists but is stale
- Exists but is incomplete
- Exists but is miswired
- Missing but required
- Missing and intentionally nonexistent
- Present but should be removed
- Unknown and requiring inspection

Assumptions are not verification.

A path mentioned in `TRACKER.md`, `ROADMAP.md`, epic trackers, sprint trackers, templates, enforcement docs, or mode docs must not be treated as real until verified.

## 7.9 Mode Integration Procedure

Every mode that can affect work must consult `TRACKER.md`.

This includes:

- Sprint mode
- Roadmap mode
- Epic planning mode
- Implementation mode
- Review mode
- Debugging mode
- Refactor mode
- Documentation mode
- Agent coordination mode
- Handoff mode
- Resumption mode
- Validation mode
- Research mode when research affects roadmap, scope, plans, definitions, or enforcement

A mode may not bypass the tracker just because the work seems small.

If a mode performs meaningful work outside an epic or sprint, it must record that work in `UNTRACKED_WORK.md`.

## 7.10 Failure Procedure

If an agent discovers that work was performed without proper tracking, it must:

1. Stop treating the state as reliable.
2. Record the gap in `UNTRACKED_WORK.md` or the affected tracker.
3. Identify what was done.
4. Identify what is unknown.
5. Identify affected files.
6. Identify affected paths.
7. Identify affected wirings.
8. Identify affected definitions.
9. Identify affected epics or sprints.
10. Reconcile the work into the correct tracker structure.
11. Add a change log entry.
12. Continue only after state is clear enough to proceed.

Silent correction is prohibited.

## 7.11 Prohibited Uses

Agents must not use `TRACKER.md` as:

- A loose note file.
- A motivational progress log.
- A vague project summary.
- A replacement for actual evidence.
- A dumping ground for unverified claims.
- A place to mark work complete without proof.
- A place to hide unresolved ambiguity.
- A passive document that is not enforced.
- A substitute for epic and sprint trackers.
- A place where definitions can be implied instead of recorded.
- A place where paths can be assumed instead of verified.
- A place where wiring can be claimed without inspection.

---

# 8. Definitions

All operational definitions used by this system must be tracked in `TRACKER.md`.

This includes definitions for:

- Roadmap
- Epic
- Sprint
- Task
- Tracker
- Definition
- Source of truth
- State
- Percent completion
- Completion
- Verification
- Evidence
- Blocker
- Dependency
- Risk
- Scope
- Out of scope
- Change log
- Session log
- Evidence log
- Untracked work
- Reconciliation
- Superseded
- Cancelled
- Meaningful work
- Meaningful interval
- Meaningful state change
- Mode
- Agent
- Owner
- President agent
- Next action
- Definition of done
- Planned
- Ready
- Active
- Blocked
- Paused
- Review Needed
- Completed
- Cancelled
- Superseded
- System Inventory
- Verification Matrix
- Wiring
- Hook
- Command
- Validator
- Template
- Path
- Expected nonexistence
- Known gap
- Agentic OS

Definitions must be written in precise operational language.

A definition must explain how the term is used inside this system, not just what the word generally means.

## 8.1 Definition Record Format

Each definition must include:

- Term
- Definition
- Why it matters
- Where it applies
- Owner
- Date added
- Last updated
- Related documents
- Related enforcement rules
- Change history, if changed

Example:

`## Definition: Sprint`

`Definition: A bounded execution effort within a parent epic, with a specific goal, scope, definition of done, tracker file, session log, change log, evidence log, and completion record.`

`Why it matters: Sprints are the smallest formal unit of tracked long-running execution. Work should not be treated as a sprint unless it has a tracker and can be resumed from written state.`

## 8.2 Definition Authority

Definitions in `TRACKER.md` outrank definitions in:

- Claude memory
- Old roadmap files
- Old sprint notes
- Old implementation plans
- Chat summaries
- Agent assumptions
- Unlinked documentation
- Code comments unless verified and reconciled

If another document uses a conflicting definition, that document must be updated, marked stale, or explicitly reconciled.

## 8.3 Definition Change Rules

Definitions may be changed only if the change is recorded.

A definition change must include:

- Previous definition
- New definition
- Reason for change
- Affected documents
- Affected epics
- Affected sprints
- Affected modes
- Affected validators
- Affected hooks or wirings
- Migration needed
- Date and session ID
- Agent making the change

Definition changes must be treated as meaningful state changes.

## 8.4 Missing Definition Rule

If an agent needs to rely on a term that affects state, planning, execution, authority, completion, validation, enforcement, path state, wiring state, or Agentic OS behavior, and that term is not defined, the agent must add a definition before relying on the term.

Agents must not rely on undefined operational terms.

## 8.5 Definition Drift Rule

If the same term is being used inconsistently, the President agent must reconcile it.

The reconciliation must:

- Identify the conflicting uses.
- Choose the authoritative definition.
- Update `TRACKER.md`.
- Update or mark stale affected documents.
- Record the reconciliation in the change log.
- Update validation if needed.

---

# 9. System Inventory

`TRACKER.md` must include or link to a System Inventory.

The System Inventory must list every tracker-relevant component mentioned or required by this system.

For each item, record:

- Item name
- Item type
- Expected path or location
- Actual verified path or location
- Expected state
- Actual verified state
- Whether it exists
- Whether it should exist
- Whether it should not exist
- Whether it is wired
- Whether wiring was verified
- Verification method
- Verification timestamp
- Agent that verified it
- Related epic or sprint
- Related definition
- Related validation rule
- Notes

Inventory item types include:

- File
- Directory
- Template
- Mode
- Hook
- Command
- Validator
- Agent role
- Roadmap artifact
- Epic tracker
- Sprint tracker
- Definition record
- Untracked work log
- Documentation file
- Configuration file
- Script
- Test
- Enforcement point
- Deprecated artifact

No referenced operational artifact may remain outside the inventory.

---

# 10. Verification Matrix

`TRACKER.md` must include or link to a Verification Matrix.

The Verification Matrix proves the existence, nonexistence, state, and wiring of everything mentioned in this system.

For every required item, the matrix must answer:

- Is it mentioned?
- Is it required?
- Should it exist?
- Does it exist?
- If it exists, where is it?
- If it should not exist, was nonexistence verified?
- If it exists, is it current?
- If it exists, is it wired?
- If it is wired, where is it wired?
- How was wiring verified?
- What command, inspection, or file check proved the state?
- What evidence supports the claim?
- When was it checked?
- Who checked it?
- What remains unknown?

Allowed verification states:

- `Verified Exists`
- `Verified Nonexistent`
- `Verified Wired`
- `Verified Not Wired`
- `Exists But Stale`
- `Exists But Incomplete`
- `Exists But Miswired`
- `Missing But Required`
- `Present But Should Be Removed`
- `Unknown`

`Unknown` is allowed temporarily, but it must be treated as a validation failure or blocker if it affects completion.

---

# 11. Active Epics

For each active epic, include:

- Label, including number
- Link to the epic's own tracker
- Goal
- Current state
- Percent completion
- Session IDs that worked on it
- Dates and times worked on
- Agents that worked on it
- Current owner
- Current blockers
- Current risks
- Latest meaningful update
- Next required action
- Evidence of progress
- Related sprints
- Related roadmap item
- Related definitions
- Related verification items
- Related system inventory items

Each active epic must have its own tracker document.

If the document does not exist, it must be created before the epic can remain listed as active.

---

# 12. Active Sprints

For each active sprint, include:

- Label, including number
- Link to the sprint's own tracker
- Goal
- Current state
- Percent completion
- Session IDs that worked on it
- Dates and times worked on
- Agents that worked on it
- Current owner
- Current blockers
- Current risks
- Latest meaningful update
- Next required action
- Evidence of progress
- Parent epic
- Related roadmap item
- Related definitions
- Related verification items
- Related system inventory items

Each active sprint must have its own tracker document.

If the document does not exist, it must be created before the sprint can remain listed as active.

---

# 13. Planned but Not Started Epics

For each planned but not started epic, include:

- Label, including number
- Link to the epic's own tracker
- Goal
- Current state
- Percent completion
- Reason it is planned
- Dependencies
- Expected parent roadmap area
- Proposed first sprint, if known
- Related definitions
- Related verification items

Planned epics should usually be `0%` complete unless discovery, design, or preparatory work has already occurred and is documented.

---

# 14. Planned but Not Started Sprints

For each planned but not started sprint, include:

- Label, including number
- Link to the sprint's own tracker
- Goal
- Current state
- Percent completion
- Parent epic
- Dependencies
- Entry criteria
- Proposed first action
- Related definitions
- Related verification items

Planned sprints should usually be `0%` complete unless preparatory work has already occurred and is documented.

---

# 15. Completed Epics

For each completed epic, include:

- Label, including number
- Link to the epic's own tracker
- Goal
- Final state
- Percent completion
- Session IDs that worked on it
- Dates and times worked on
- Agents that worked on it
- Completion timestamp
- Evidence of completion
- Definition of done used
- Remaining follow-up items, if any
- Related completed sprints
- Related untracked work, if any
- Related definitions
- Related verification results

Completed epics must not be listed as completed unless their own tracker also confirms completion.

---

# 16. Completed Sprints

For each completed sprint, include:

- Label, including number
- Link to the sprint's own tracker
- Goal
- Final state
- Percent completion
- Session IDs that worked on it
- Dates and times worked on
- Agents that worked on it
- Completion timestamp
- Evidence of completion
- Definition of done used
- Remaining follow-up items, if any
- Parent epic
- Related untracked work, if any
- Related definitions
- Related verification results

Completed sprints must not be listed as completed unless their own tracker also confirms completion.

---

# 17. Cancelled or Superseded Work

Cancelled and superseded work must be tracked explicitly.

For each cancelled or superseded item, include:

- Label, including number
- Type: Epic, Sprint, Task, Roadmap item, Definition, Path, Wiring, Mode, Hook, Validator, or Other
- Previous goal
- Final state
- Reason cancelled or superseded
- Superseding item, if any
- Date changed
- Session ID
- Agent making the change
- Evidence or rationale
- Affected documents
- Follow-up required, if any

Cancelled and superseded work must not be deleted without a trace.

---

# 18. Untracked Work

`TRACKER.md` must include a link to `UNTRACKED_WORK.md`.

This document must capture meaningful work completed outside of formal epics or sprints.

Untracked work must include:

- Date and time
- Session ID
- Agent or agents involved
- Description of work
- Files changed
- Paths changed
- Wirings changed
- Definitions changed
- Reason work was not attached to an epic or sprint
- Whether it should be retroactively attached to an epic or sprint
- Follow-up action required
- Evidence of completion
- Related definitions
- Related verification items

Untracked work must not remain permanently unclassified if it belongs to an existing or new epic/sprint.

The President agent must periodically reconcile untracked work into the proper structure.

---

# 19. Required State Model

All epics and sprints must use clear, consistent states.

Allowed states:

- `Planned`
- `Ready`
- `Active`
- `Blocked`
- `Paused`
- `Review Needed`
- `Completed`
- `Cancelled`
- `Superseded`

Do not invent ambiguous states unless the tracker schema is explicitly updated.

## 19.1 State Definitions

### Planned

The work is known and captured but not ready to begin.

### Ready

The work has enough context, requirements, and dependencies resolved to begin.

### Active

Work has started and is currently expected to continue.

### Blocked

Work cannot continue until a specific blocker is resolved.

### Paused

Work is intentionally stopped but may resume later.

### Review Needed

Implementation or planning work is believed complete enough for review, but completion has not yet been confirmed.

### Completed

The work meets its definition of done and has evidence of completion.

### Cancelled

The work will not be done and has not been replaced by another item.

### Superseded

The work has been replaced by another epic, sprint, plan, definition, path, wiring, or system design.

---

# 20. Percent Completion Rules

Percent completion must be conservative, evidence-based, and non-performative.

Do not use percentages as vibes, guesses, or motivational signals.

Percent completion must reflect actual completed work against the stated goal and definition of done.

Rules:

- `0%` means no meaningful work has started.
- `1-25%` means discovery, setup, or early implementation has begun.
- `26-50%` means meaningful implementation exists but major work remains.
- `51-75%` means the core work exists but integration, validation, or important gaps remain.
- `76-99%` means the work is substantially complete but not fully verified.
- `100%` means complete, verified, documented, tracker-updated, reconciled, and passing required validation.

Nothing may be marked `100%` unless:

- The definition of done is satisfied.
- Evidence of completion is recorded.
- The relevant epic or sprint tracker is updated.
- `TRACKER.md` is updated.
- Related roadmap state is updated.
- Related definitions are present and current.
- Required paths are verified.
- Required wirings are verified.
- Required validators pass or failures are explicitly tracked.
- Any remaining follow-ups are explicitly captured elsewhere.

---

# 21. Language Requirements

Tracker language must be precise, factual, and state-safe.

Do not use language that creates ambiguity about actual state.

Prohibited examples:

- “Likely done by the end of this session.”
- “Probably complete.”
- “Mostly handled.”
- “Should be fine.”
- “Seems done.”
- “Basically finished.”
- “We can assume this is complete.”
- “No need to track this.”
- “Memory has it.”
- “Done unless something comes up.”
- “This is obvious.”
- “This does not need a definition.”
- “The agent will know what this means.”
- “Path should exist.”
- “Probably wired.”
- “Looks wired enough.”
- “Validation should pass.”

Required alternatives:

- “Incomplete; next action is X.”
- “Implemented but not verified.”
- “Verified against X on YYYY-MM-DD.”
- “Blocked by X.”
- “Completed according to definition of done Y.”
- “Superseded by EPIC-###.”
- “Moved to UNTRACKED_WORK.md pending reconciliation.”
- “Requires review before completion.”
- “Definition missing; must be added before use.”
- “State unknown; requires reconciliation.”
- “Path missing but required.”
- “Path verified nonexistent and expected to be nonexistent.”
- “Wiring verified in file X.”
- “Validation failed; failure recorded in X.”

All tracker entries must distinguish between:

- Planned work
- Work in progress
- Implemented work
- Verified work
- Completed work
- Deferred work
- Cancelled work
- Superseded work
- Unknown state
- Undefined terminology
- Unverified paths
- Unverified wiring
- Known validation failures

Unknown state must be labeled as unknown, not guessed.

Undefined terms must be labeled as undefined, not inferred.

Unverified paths and wirings must be labeled unverified, not assumed.

---

# 22. Epic Tracker Requirements

Every epic must have its own tracker document.

Recommended location:

`/trackers/epics/EPIC-###-short-name.md`

Each epic tracker must include:

- Epic label and number
- Title
- Owner
- Parent roadmap area
- Goal
- Background
- Scope
- Out of scope
- Current state
- Percent completion
- Definition of done
- Related definitions
- Related sprints
- Dependencies
- Blockers
- Risks
- Decisions
- Open questions
- Session log
- Change log
- Evidence log
- Verification log
- Current next action
- Completion record

Epic trackers must be linked from `TRACKER.md`.

---

# 23. Sprint Tracker Requirements

Every sprint must have its own tracker document.

Recommended location:

`/trackers/sprints/SPRINT-###-short-name.md`

Each sprint tracker must include:

- Sprint label and number
- Title
- Owner
- Parent epic
- Goal
- Scope
- Out of scope
- Current state
- Percent completion
- Definition of done
- Related definitions
- Tasks
- Files expected to change
- Files actually changed
- Paths expected to exist
- Paths verified to exist
- Paths verified nonexistent
- Wirings expected
- Wirings verified
- Dependencies
- Blockers
- Risks
- Decisions
- Open questions
- Session log
- Change log
- Evidence log
- Verification log
- Current next action
- Completion record

Sprint trackers must be linked from `TRACKER.md`.

---

# 24. Session Logging Requirements

Every meaningful work session on an epic or sprint must be logged.

Each session log entry must include:

- Session ID
- Date
- Start time, if known
- End time, if known
- Agent or agents involved
- Mode used
- Work performed
- Files changed
- Paths changed
- Wirings changed
- Decisions made
- Issues discovered
- Definitions added or changed
- State changes
- Completion percentage change
- Verification performed
- Validation run
- Validation result
- Next action
- Evidence or references

Session logs must be append-only unless correcting a factual error.

Corrections must themselves be logged.

---

# 25. Change Tracking Requirements

Changes to epics, sprints, roadmap structure, goals, scope, requirements, blockers, definitions, terminology, paths, wirings, validators, hooks, modes, commands, or plans must always be recorded.

If an issue is found and added to a plan, the tracker must show:

- What issue was found
- When it was found
- Who or what found it
- Which epic or sprint it affects
- What changed because of it
- Whether scope, state, completion, definition, path, wiring, validation, or priority changed

If a plan changes, the old plan must not simply disappear.

The change must be traceable.

Each tracker document must include a `Change Log` section with entries like:

`## Change Log`

`### YYYY-MM-DD HH:MM TZ — Session SESSION-ID`

`- Changed: ...`

`- Reason: ...`

`- Affected: ...`

`- Previous state: ...`

`- New state: ...`

---

# 26. Evidence Requirements

Work must not be marked complete without evidence.

Evidence may include:

- File paths changed
- Tests run
- Commands run
- Validation results
- Review notes
- Screenshots, where relevant
- Links to implementation files
- Links to PRs, commits, or diffs, where available
- Explicit confirmation that a document exists
- Explicit confirmation that a document does not exist and should not exist
- Explicit confirmation that a mode or hook is wired
- Explicit confirmation that a validator ran
- Explicit confirmation that relevant definitions exist
- Explicit confirmation that roadmap state is reconciled

Evidence must be concrete enough that another agent can resume or verify the work without relying on memory.

---

# 27. Update Triggers

`TRACKER.md` and related tracker files must be updated at meaningful intervals.

Meaningful state changes must never go untracked.

Tracker updates are required:

- At the start of a sprint session.
- At the end of a sprint session.
- Before a session handoff.
- Before context compaction.
- After completing a task.
- After discovering a blocker.
- After resolving a blocker.
- After changing scope.
- After changing priority.
- After changing roadmap structure.
- After creating an epic.
- After creating a sprint.
- After completing an epic.
- After completing a sprint.
- After cancelling or superseding work.
- After meaningful work happens outside an epic or sprint.
- After adding a new operational term.
- After changing a definition.
- After discovering definition drift.
- After creating, deleting, or moving a path.
- After discovering a path missing.
- After verifying expected nonexistence.
- After adding or removing wiring.
- After discovering missing wiring.
- After adding or changing a validator.
- After running validation.
- Before claiming work is complete.
- Before switching modes if work state changed.
- Before relying on prior state from memory.
- Before using a term whose definition affects state, completion, planning, authority, validation, or enforcement.

A tracker update is not required for every tiny edit, but it is required whenever state, scope, evidence, blockers, definitions, authority, paths, wirings, validation, enforcement, or resumability changes.

---

# 28. Enforcement Requirements

Proper use of this tracker must not exist only in prose.

It must be enforced.

The implementation must add enforcement mechanisms wherever possible.

## 28.1 Mode Integration Enforcement

The tracker system must be wired into all relevant modes, not only sprint mode.

This includes:

- Sprint mode
- Roadmap mode
- Epic planning mode
- Implementation mode
- Review mode
- Debugging mode
- Refactor mode
- Documentation mode
- Agent coordination mode
- Handoff/resumption mode
- Validation mode
- Research mode when research affects plans or definitions

Any mode that can create, modify, complete, define, discover, verify, or reinterpret long-running work must interact with the tracker system.

## 28.2 Start-of-Work Enforcement

Before beginning meaningful work, agents must check whether the work belongs to:

- An active epic
- An active sprint
- A planned epic
- A planned sprint
- Untracked work
- A new epic or sprint that must be created

Agents must not begin substantial long-running work without ensuring it is tracked.

## 28.3 Definition Enforcement

Before relying on a term that affects roadmap, epic, sprint, task, state, authority, ownership, completion, evidence, validation, path state, wiring state, or enforcement, agents must verify that the term is defined in `TRACKER.md`.

If the definition is missing, the agent must add it.

If the definition is ambiguous, the agent must clarify it.

If the definition conflicts with another document, the agent must reconcile it.

Undefined operational terminology is a validation failure.

## 28.4 Path and Wiring Enforcement

Before relying on a path, file, directory, hook, command, mode, validator, template, or wiring, agents must verify it.

A tracker claim that something exists is invalid unless supported by verification evidence.

A tracker claim that something does not exist is invalid unless supported by nonexistence verification evidence.

A tracker claim that something is wired is invalid unless supported by wiring evidence.

## 28.5 End-of-Work Enforcement

Before ending a work session, agents must update:

- Relevant epic tracker
- Relevant sprint tracker
- `TRACKER.md`
- `UNTRACKED_WORK.md`, if applicable
- Roadmap, if roadmap state changed
- Definitions, if terminology changed or new operational terms were introduced
- System Inventory, if paths or wiring changed
- Verification Matrix, if verification was performed

## 28.6 Completion Gate Enforcement

Agents must not mark a sprint or epic complete unless:

- Definition of done is satisfied.
- Evidence is recorded.
- Session log is updated.
- Change log is updated if the plan changed.
- Relevant definitions exist.
- Required files and directories are verified.
- Required nonexistence is verified.
- Required wirings are verified.
- Required validators pass or failures are tracked.
- Roadmap state is reconciled.
- Related untracked work is reconciled or explicitly linked.
- Next action is either empty or moved into a follow-up item.
- `TRACKER.md` and the item's own tracker agree.

## 28.7 Validation Enforcement

The system must include a validation process that checks for:

- Missing epic tracker files
- Missing sprint tracker files
- Broken links
- Active items with no next action
- Completed items without evidence
- Completed items below `100%`
- `100%` items not marked completed
- Sprints without parent epics
- Epics missing from roadmap
- Work logs with no session ID
- Ambiguous state language
- Undefined operational terms
- Definition drift
- Untracked work that should be attached to an epic or sprint
- Roadmap items still using milestones instead of epics
- Tracker sections that are blank
- Tracker entries missing owner, state, evidence, or next action
- Conflicts between `TRACKER.md`, roadmap, epic trackers, and sprint trackers
- Referenced paths that do not exist
- Referenced paths that exist but should not
- Required paths with unknown state
- Required wirings with unknown state
- Claims of wiring without evidence
- Validators that are documented but not runnable
- Modes that can perform work but do not consult the tracker
- Hooks that should enforce tracking but are missing

Validation should be runnable manually and, where possible, automatically.

## 28.8 Failure Enforcement

If validation fails, agents must not claim the tracker system is healthy.

Validation failures must be recorded and either:

- Fixed immediately
- Added to a tracked sprint
- Added to an active blocker list
- Added to `UNTRACKED_WORK.md` pending reconciliation

Validation failures must not be ignored.

---

# 29. Roadmap Improvements

The roadmap must no longer be organized around generic milestones.

The roadmap must be organized into epics.

Milestones should be deleted, migrated, or replaced with epics.

## 29.1 Roadmap Structure

The roadmap must include:

- Roadmap title
- Version
- Last updated timestamp
- Roadmap owner
- Strategic purpose
- Current active epics
- Planned epics
- Completed epics
- Superseded epics
- Cancelled epics
- Dependencies between epics
- Priority ordering
- Current focus
- Deferred work
- Links to `TRACKER.md`
- Links to relevant epic trackers
- Related definitions
- Related verification items

## 29.2 Epic-Based Roadmap Rules

Each roadmap item must map to an epic.

Each epic must have:

- Epic number
- Epic title
- Goal
- Priority
- State
- Completion percentage
- Link to epic tracker
- Related sprints
- Dependencies
- Rationale
- Expected impact
- Current next action
- Related definitions

The roadmap must not contain vague milestone entries that cannot be tracked, resumed, or verified.

## 29.3 Migration from Milestones to Epics

Existing roadmap milestones must be migrated into epics.

For each old milestone:

- Determine whether it should become one epic, multiple epics, or be removed.
- Create the relevant epic tracker file.
- Link the epic from the roadmap.
- Link the epic from `TRACKER.md`.
- Record the migration in the roadmap change log.
- Record any superseded milestone language.
- Ensure no active work remains attached only to the old milestone structure.
- Ensure any milestone-specific terminology is either removed or defined as deprecated.

The roadmap must not retain duplicate milestone and epic structures unless the milestone structure is explicitly marked deprecated during migration.

---

# 30. Relationship Between Roadmap, Epics, Sprints, and Tasks

The hierarchy is:

Roadmap -> Epic -> Sprint -> Task

Rules:

- Roadmap items are epics.
- Epics represent meaningful strategic goals.
- Sprints represent bounded execution efforts within epics.
- Tasks belong inside sprints unless they are small enough to be handled as untracked work.
- Untracked work must be reconciled into this hierarchy when appropriate.
- Definitions govern how every level of the hierarchy is interpreted.
- Verification governs whether referenced paths and wirings can be trusted.

A sprint must have a parent epic unless it is explicitly marked as temporary untracked/reconciliation work.

An epic may have zero or more sprints.

A roadmap item must not point directly to loose tasks when those tasks should be part of an epic or sprint.

---

# 31. Untracked Work Policy

Some useful work may happen outside formal sprint or epic planning.

That is allowed only if it is captured.

Untracked work must be recorded when:

- A quick fix is made outside a sprint.
- A bug is discovered and patched immediately.
- Documentation is updated outside planned work.
- Research changes the direction of future work.
- A system issue is found outside the current epic.
- An agent performs setup, cleanup, or refactor work not attached to a sprint.
- A definition is discovered or changed outside a planned definition update.
- A path is created, deleted, moved, or discovered outside planned work.
- A wiring is changed or discovered outside planned work.

Untracked work must not become a loophole for avoiding planning.

The President agent must periodically review `UNTRACKED_WORK.md` and decide whether each item should be:

- Attached to an existing epic
- Attached to an existing sprint
- Converted into a new epic
- Converted into a new sprint
- Left as standalone historical work
- Deleted only if it was erroneous, with a correction note

---

# 32. Reconciliation Rules

Reconciliation is required when two or more tracker-related sources disagree.

Reconciliation is required for conflicts involving:

- State
- Percent completion
- Ownership
- Scope
- Next action
- Blockers
- Evidence
- Completion
- Roadmap placement
- Definitions
- Sprint/epic relationship
- Untracked work
- Path existence
- Path nonexistence
- Directory state
- Mode wiring
- Hook wiring
- Command availability
- Validator behavior
- Template state

A reconciliation entry must include:

- Conflict discovered
- Sources involved
- Authoritative source selected
- Final reconciled state
- Reason
- Date and time
- Session ID
- Agent
- Documents updated
- Remaining uncertainty, if any

Unresolved conflicts must be marked as blockers or review-needed items.

---

# 33. Required Files and Paths

The implementation must create, verify, or explicitly reject the following files and paths:

- `TRACKER.md`
- `ROADMAP.md`
- `UNTRACKED_WORK.md`
- `/trackers/`
- `/trackers/epics/`
- `/trackers/sprints/`
- `/trackers/templates/`
- `/trackers/templates/EPIC_TEMPLATE.md`
- `/trackers/templates/SPRINT_TEMPLATE.md`
- `/trackers/templates/SESSION_LOG_TEMPLATE.md`
- `/trackers/templates/UNTRACKED_WORK_TEMPLATE.md`
- `/trackers/templates/DEFINITION_TEMPLATE.md`
- `/trackers/templates/CHANGE_LOG_TEMPLATE.md`
- `/trackers/templates/EVIDENCE_LOG_TEMPLATE.md`
- `/trackers/templates/VERIFICATION_TEMPLATE.md`
- `/trackers/templates/RECONCILIATION_TEMPLATE.md`

If the project uses different file organization, the equivalent structure must still exist, be verified, and be linked clearly from `TRACKER.md`.

The implementation must also identify old paths that should no longer exist, verify whether they still exist, and either remove them or record why they remain.

---

# 34. Required Wirings

The implementation must verify and document wiring for:

- Sprint mode tracker checks
- Roadmap mode tracker checks
- Epic planning tracker checks
- Implementation mode tracker checks
- Review mode tracker checks
- Debugging mode tracker checks
- Refactor mode tracker checks
- Documentation mode tracker checks
- Agent coordination tracker checks
- Handoff/resumption tracker checks
- Validation mode tracker checks
- Definition enforcement checks
- Start-of-work checks
- End-of-work checks
- Completion gate checks
- Path verification checks
- Wiring verification checks
- Validation commands

Each wiring record must include:

- Wiring name
- Purpose
- Source file or configuration
- Target behavior
- Verification method
- Verification result
- Evidence
- Date verified
- Agent that verified it

A wiring must not be marked complete because it was described in prose. It must be verified in the actual Agentic OS implementation.

---

# 35. Templates

The system must include templates for:

- Epic trackers
- Sprint trackers
- Session logs
- Change logs
- Evidence logs
- Definition records
- Untracked work entries
- Completion records
- Verification records
- Reconciliation records
- System inventory records

Templates must be practical, not decorative.

They must be designed so agents can quickly fill them in without ambiguity.

---

# 36. Known Gaps and Open Flaws

`TRACKER.md` must include a `Known Gaps and Open Flaws` section.

This section must list every known gap in the Agentic OS tracking layer.

Each gap must include:

- Gap ID
- Description
- Severity
- Affected system area
- Affected files or paths
- Affected wirings
- Affected modes
- Discovery date
- Discovered by
- Current owner
- Required fix
- Current state
- Related epic or sprint
- Evidence
- Next action

If there are no known gaps, the section must say:

`No known gaps currently recorded. Last verified: YYYY-MM-DD HH:MM TZ.`

This statement is only valid if validation has actually been run.

---

# 37. Definition of Done for This System

This work is complete only when:

- The old `TRACKER.md` has been deleted or fully unwired.
- A new `TRACKER.md` exists.
- `TRACKER.md` follows the required structure.
- `TRACKER.md` includes a robust `How to Use This Document` section.
- `TRACKER.md` includes authoritative definitions.
- All required operational terms are defined.
- Definition change rules are documented.
- Definition enforcement is wired into all relevant modes.
- `UNTRACKED_WORK.md` exists and is linked.
- Roadmap structure is epic-based, not milestone-based.
- Existing milestones are migrated or explicitly deprecated.
- Epic tracker files exist for all active and planned epics.
- Sprint tracker files exist for all active and planned sprints.
- Completed epics and sprints have evidence records.
- State language is standardized.
- Percent completion rules are documented.
- Update triggers are documented.
- Required paths are verified.
- Required nonexistence is verified where applicable.
- Required wirings are verified.
- Required validators exist and are runnable.
- System Inventory exists and is current.
- Verification Matrix exists and is current.
- Enforcement mechanisms are wired into sprint mode.
- Enforcement mechanisms are wired into all other relevant modes.
- The President agent is documented as owner.
- The tracker is documented as higher authority than Claude memory.
- Validation exists for missing links, missing tracker files, ambiguous state, undefined definitions, definition drift, missing paths, stale paths, missing wiring, and completion without evidence.
- Validation has been run.
- Validation failures are fixed or tracked.
- Known gaps and open flaws are either empty with evidence or fully tracked.
- The system can be resumed from tracker files alone without relying on chat memory.

---

# 38. Implementation Priority

Implement in this order:

1. Inspect the current Agentic OS structure.
2. Inventory current roadmap, tracker, epic, sprint, definition, mode, hook, command, validator, and template files.
3. Verify existence, nonexistence, and state of every relevant path mentioned in this spec.
4. Verify current wiring or non-wiring of every mode and enforcement point mentioned in this spec.
5. Delete and unwire the current `TRACKER.md` if it conflicts with this system.
6. Create the new `TRACKER.md`.
7. Add the robust `How to Use This Document` section.
8. Add the Definitions section.
9. Define all required operational terms.
10. Add the System Inventory section or linked file.
11. Add the Verification Matrix section or linked file.
12. Create tracker directories and templates.
13. Create `UNTRACKED_WORK.md`.
14. Update roadmap structure from milestones to epics.
15. Create or migrate epic tracker files.
16. Create or migrate sprint tracker files.
17. Wire tracker checks into sprint mode.
18. Wire definition checks into sprint mode.
19. Wire path and wiring verification into sprint mode.
20. Wire tracker checks into all other relevant modes.
21. Wire definition checks into all other relevant modes.
22. Wire path and wiring verification into all other relevant modes.
23. Add validation for tracker consistency.
24. Add validation for definition consistency.
25. Add validation for path existence and expected nonexistence.
26. Add validation for wiring existence and behavior.
27. Reconcile existing work into the new system.
28. Run validation and fix all failures.
29. Record completion evidence.
30. Record any remaining gaps as blockers or follow-up items.

---

# 39. Non-Negotiable Requirements

The system must not rely on memory as the source of truth.

The system must not allow meaningful work to disappear between sessions.

The system must not mark work complete without evidence.

The system must not use ambiguous state language.

The system must not use undefined operational terminology.

The system must not allow definitions to live only in memory, chat, or scattered documents.

The system must not assume paths exist.

The system must not assume paths do not exist.

The system must not assume wiring exists.

The system must not claim enforcement exists unless enforcement is verified.

The system must not keep roadmap milestones as the primary organizing unit.

The system must not treat tracker updates as optional.

The system must not allow active sprints or epics to exist without their own tracker files.

The system must not allow work completed outside epics or sprints to remain invisible.

The system must not allow definition changes without a change record.

The system must not allow validation failures to be ignored.

The system must not allow known gaps or flaws in the Agentic OS tracking layer to remain invisible.

The system must be thorough first. Efficiency comes later.

---

# 40. Final Instruction

Build the tracker system as an enforced operational layer, not as passive documentation.

The goal is not merely to describe work.

The goal is to make long-running work reliably resumable, auditable, defined, verified, enforced, and truthful across sessions, agents, modes, paths, wirings, and implementation phases.

When done, every meaningful claim about the Agentic OS tracking system must be either:

- Verified and evidenced
- Explicitly false and corrected
- Unknown and tracked as a gap
- Blocked and assigned a next action

No meaningful state, definition, path, wiring, enforcement point, validation failure, or Agentic OS flaw may remain hidden.
