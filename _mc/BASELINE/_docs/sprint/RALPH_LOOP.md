# Sprint v0.1 — Ralph Loop

The Ralph loop is the persistence engine for `/sprint:execute`. It is
NOT the product brain.

Product brain:

- Plan Contract
- requirements (PRD/STORIES/COPY/INPUTS/TRACE/AC)
- ESDs
- ticket scope
- approvals
- routing
- Beta judgment
- hooks
- tests
- tracker state

Ralph:

- runs approved tickets through governed plan/act/test/review/record/checkpoint loops
- persists state for crash recovery
- knows when to stop

## The loop

```
plan → act → test → review → record → checkpoint → repeat | stop
```

### plan

Read the ticket. Pick ONE coherent next task from `remaining_tasks` or
derive from acceptance criteria. Write the tiny plan into
`next_action`.

### act

Make the smallest meaningful change. Edit one file or a small coherent
set. Do not refactor adjacent code.

### test

Run relevant checks: lint, typecheck, unit tests, integration tests
(where applicable). Capture results via
`scripts/sprint/execute.js phase --phase test --add-passing "..." --add-failing "..."`.

### review

Does the change match the ticket? Does it satisfy AC, COPY, INPUTS,
TRACE, QA expectations, ESD constraints?

If yes, advance to `record`.
If no, log a `failed_attempt` and either retry or stop.

### record

Update the ticket (status changes, linked-files, linked-commits,
completion-evidence). Update requirements files if behavior diverged
from spec — TRACE in particular.

### checkpoint

Write a sprint-progress checkpoint via `scripts/sprint/checkpoint.js`.
Advance the Ralph file via `execute.js phase --phase checkpoint`. The
checkpoint pointer is added to `checkpoint_pointers[]`.

### repeat or stop

If `remaining_tasks` is non-empty AND no stop condition was hit, loop
back to `plan`. Otherwise stop with the appropriate reason.

## State

`.claude/project/sprint/ralph/<sprint-id>/<ticket-id>.yaml` carries:

- `current_loop` — incrementing counter (1, 2, 3, ...)
- `phase` — current step (plan, act, test, review, record, checkpoint,
  stopped)
- `status` — running | paused | blocked | stopped_* | completed
- `completed_tasks` — what's been done so far
- `remaining_tasks` — what's left
- `blockers` — anything stopping progress
- `failed_attempts[]` — each failed attempt with approach, outcome,
  notes
- `last_checks` — most recent test/lint/typecheck results
- `next_action` — plain English description for resume
- `external_dependency_status` — ESD statuses relevant to this ticket
- `stop_reason` — populated when stopped
- `resume_instructions` — plain English
- `checkpoint_pointers[]` — ordered list of frozen checkpoints

## Stop conditions

These ALWAYS stop the loop:

| Condition | Stop reason | Unblock |
|---|---|---|
| Ticket complete; AC + tests pass | `completed` | Update ticket → in_review |
| Approval required | `stopped_approval_required` | Record approval, re-run /sprint:execute --ticket <id> |
| Human signup / setup needed | `stopped_human_setup_required` | Resolve ESD's human_setup_steps, re-run |
| 3+ failed attempts on same fix | `stopped_repeated_failure` | Mark deferred/abandoned OR /fix:deep |
| Scope expanding beyond ticket | `stopped_scope_expansion` | Either re-plan (extend Plan Contract) or move new scope to a new ticket |
| Destructive action needed | `stopped_destructive_action_needed` | Ask user. Do NOT auto-proceed. |
| Production deploy needed | `stopped_production_deploy_needed` | Switch to /sprint:release |
| Beta predicts rejection | `stopped_beta_warning` | Surface to user; re-plan if needed |
| Intent unclear | `stopped_unclear_intent` | Re-run /sprint:plan |

The loop also stops on regular completion (`completed`) when all
`remaining_tasks` are done and no stop condition was hit.

## Why Ralph stops are a feature

A loop that doesn't stop:

- Burns tokens / cost.
- Repeats the same failed approach.
- Drifts past approved scope.
- Hides bugs in chat instead of `issues.md`.
- Skips approval gates.

A loop that stops too eagerly:

- Forces the operator to re-enter every checkpoint.
- Makes progress invisible.

Sprint v0.1 errs toward stopping on the listed conditions. They are
NOT advisory — they are enforced by `scripts/sprint/execute.js`. Any
attempt to bypass them must be recorded as an approval.

## Resume semantics

Crash recovery for a Ralph loop:

1. Read `paths.sprintProgress` (the live checkpoint).
2. Read `paths.sprintRalph/<sprint>/<ticket>.yaml` (the Ralph file).
3. Combine:
   - `progress.current_ticket` + `ralph.ticket` should match.
   - `progress.current_loop` + `ralph.current_loop` should match.
   - `ralph.phase` indicates which step to resume.
   - `ralph.status` indicates whether to auto-resume or investigate.
4. If `ralph.status` is `running` or `paused`, resume the indicated
   `phase`.
5. If `ralph.status` is `stopped_*`, investigate the `stop_reason`
   first.
6. If `ralph.status` is `completed`, the loop is done — advance the
   ticket to `in_review`.

## What Ralph does NOT do

- It does NOT decide product strategy.
- It does NOT skip approval gates.
- It does NOT silently expand scope.
- It does NOT keep state only in chat.
- It does NOT bypass `paths.providerFallbackPolicy`.
- It does NOT call external services without an ESD record.
- It does NOT mark a ticket `done` without `completion_evidence`.
- It does NOT replace `/fix:deep` for repeated bugs.

## See also

- `schemas/sprint/ralph-progress.schema.json`
- `scripts/sprint/execute.js`
- `_docs/sprint/CRASH_RECOVERY.md`
- `paths.sprintReference`
