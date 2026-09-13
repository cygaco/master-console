# Sprint v0.1 — Ticket Model

A ticket is the smallest executable unit in a sprint. Tickets are the
bottom of the hierarchy — they sit below requirements, stories, COPY,
INPUTS, TRACE, acceptance criteria, QA expectations, and external
service dependencies.

## Tickets are not requirements

Requirements (`R-N`) say what must be true.
Stories (`H-N`, `S-N`) describe user/product behavior.
COPY, INPUTS, TRACE refine specific dimensions.
Acceptance criteria are testable conditions.

Tickets are the **execution surface** for those.

A ticket without a linked story, requirement, COPY/INPUT/TRACE, or AC
is malformed for `documentation_scale: m+`. Sprint v0.1's
`scripts/sprint/ticket.js create` does not enforce this at write time
(some tickets exist below xs/s scale), but reviewers should flag any
ticket missing `linked_*` fields.

## Sizing

A ticket is roughly one granular story (`S-N`), one specific bug,
one specific docs change, one specific integration step.

| Good ticket | Bad ticket |
|---|---|
| Map current delivery compatibility flow | Build the whole compatibility system |
| Add menu evidence metadata | Refactor everything |
| Prevent generic menus from confirming item availability | Fix all bugs |
| Add pre-call compatibility gate tests | Make it better |
| Update docs for delivery evidence states | Add import |
| Fix signup redirect regression | Rename one variable |
| Add analytics event for onboarding completion | Set up all services |
| Update TRACE links for compatibility gate changes | Do Stripe |
| Add env var documentation for SMS provider | |
| Implement provider adapter after credentials available | |
| Add mock integration for payment provider sandbox | |

Implementation steps go inside the ticket's checklist or
`implementation_notes`, not as separate tickets — unless tracking
them separately would be useful (e.g. a multi-day refactor).

## Ticket types

(See `schemas/sprint/ticket.schema.json`.)

```
feature | bug | research | design | qa | redteam | refactor |
docs | release | decision | chore | trace | copy | input |
integration | external_service_setup | approval | checkpoint
```

Pick the most specific. A bugfix that also requires a TRACE change is
`bug` with `linked_trace` populated, not two tickets.

## Statuses

```
proposed                  (Plan/Design surfaced it; not yet ready)
planned                   (scope clear; not yet designed)
designed                  (design complete; tickets minted)
ready_for_execution       (designed + approvals + ESDs ready)
in_progress               (executing)
blocked                   (something stops progress)
waiting_on_human          (human action required)
waiting_on_external_service (ESD not ready)
in_review                 (work done; review pending)
qa_failed                 (QA found issues)
redteam_failed            (red-team found issues)
done                      (all AC satisfied; review complete)
released                  (shipped via /sprint:release)
reopened                  (was done; needs more work)
deferred                  (intentionally postponed)
abandoned                 (no longer pursued)
superseded                (replaced by a different ticket)
```

Transitions are validated by `scripts/sprint/ticket.js update`. The
sprint-current buckets stay in sync.

## Reopen rules

Reopen is explicit. `scripts/sprint/ticket.js reopen` requires a
reason from the enum:

```
regression_found | acceptance_criteria_missed | requirement_changed |
copy_changed | input_changed | trace_mismatch | test_failed_after_merge |
release_revealed_issue | user_rejected | beta_rejected |
dependency_changed | external_service_changed | supersede_was_wrong |
spec_drift | telemetry_failure | other
```

Reopening records:

- `reopened_at`, `reopened_by`
- `previous_status`, `previous_resolution`
- `new_required_outcome`
- `linked_issue` (optional)

Reopen history is append-only. Prior completion evidence remains in
`completion_evidence` so the original "done" state is preserved.

## Fix attempts

`fix_attempts[]` records each attempt at fixing a bug-like ticket:

```yaml
fix_attempts:
  - attempt: 1
    at: <iso>
    approach: "X"
    outcome: failed
    notes: "Y went wrong"
  - attempt: 2
    ...
```

After 3 failed attempts, the operator must either:

1. Mark the issue `deferred` or `abandoned`.
2. Escalate via `/fix:deep`.

This matches `CLAUDE.md`'s 3-attempt rule. `scripts/sprint/ticket.js
update --add-fix-attempt` warns on the 3rd attempt.

## Linked artifacts

Tickets carry many `linked_*` fields:

- `linked_requirements`, `linked_high_level_story`,
  `linked_granular_story`, `linked_prd`
- `linked_copy`, `linked_inputs`, `linked_trace`,
  `linked_acceptance_criteria`
- `linked_issues`, `linked_decisions`,
  `linked_external_services`
- `linked_files`, `linked_tests`, `linked_commits`,
  `linked_prs`, `linked_release`

These are pointers (ids or paths). They enable TRACE: starting from a
shipped commit, you can walk backward to the ticket → story →
requirement → original request.

## Ticket vs task vs checklist

- A **task** is a step inside a ticket. Tasks live in
  `implementation_notes` or `acceptance_criteria` checkboxes. They
  don't get their own ticket file.
- A **checklist item** is the smallest unit. A ticket can have many.
- A **ticket** is what an agent claims, executes, and closes.

If a "task" would benefit from its own ownership, status, or audit
trail — promote it to a ticket. Otherwise it stays in the parent
ticket.

## Ticket file naming

```
.claude/project/sprint/tickets/T-YYYYMMDD-NNN.yaml
```

Generated by `scripts/sprint/ids.js#ticketId`. NNN is the next number
within YYYYMMDD; counters don't span days.

## See also

- `schemas/sprint/ticket.schema.json` — full schema.
- `_docs/sprint/ISSUES_MD.md` — how tickets relate to issues.
- `paths.sprintReference` — full reference doc.
