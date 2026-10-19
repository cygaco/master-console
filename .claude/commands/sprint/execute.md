---
description: Execute the sprint via Ralph-style plan/act/test/review/record/checkpoint loops per ticket, with crash-safe progress, issue tracking, and approval-aware stop conditions.
user-invocable: true
says:
  - execute the sprint
  - run the tickets
  - sprint execute
  - build the sprint
---

# /sprint:execute — Sprint Execute

Run approved tickets through governed Ralph loops. Each ticket goes
through: plan → act → test → review → record → checkpoint → repeat-or-stop.
Progress is persisted to files so a crash or context reset can resume.

`/sprint:execute` is **execution**, not planning. It refuses to invent
work outside the approved tickets and stops at approval boundaries,
external-service blocks, repeated failures, scope expansion, and
production-deploy needs.

## When to use

- Tickets exist with status `ready_for_execution` (or `in_progress`
  resumed after a crash).
- Plan Contract approvals are satisfied.
- ESDs for the relevant phase are `ready_for_terminal_work`, `mocked`,
  `integrated`, or explicitly `deferred`.

## Inputs

```text
/sprint:execute [--ticket <T-id>] [--sprint <SP-id>] [--allow-overlap]
```

- `--ticket <T-id>` — execute one specific ticket. If omitted, pick the
  first ticket in the targeted sprint's `ready_for_execution` bucket.
- `--sprint <SP-id>` (v0.2) — target a specific sprint. Defaults to
  `paths.sprintActiveRegistry#primary`. Unknown id → exit non-zero
  with the unknown-sprint message.
- `--allow-overlap` (v0.2) — proceed even when
  `scripts/sprint/conflict-check.js` reports `affected_surfaces`
  overlap with another live sprint. The override is logged to
  `paths.decisionLedger` with reason `manual_allow_overlap`.

If the target sprint has `lane.type === "worktree"`, Ralph phases run
inside the lane's git worktree (the sprint's `lane.value`). The first
agent dispatch fires a no-op warm-up agent first, because the first
parallel dispatch can otherwise run against the main repo's HEAD instead of the lane worktree.

## Procedure

### Step 1 — Pre-flight

```bash
node scripts/sprint/external-service.js gate --phase execute
```

If the gate fails, halt. Surface the offending ESDs and exit. Do NOT
proceed to ticket execution.

### Step 2 — Pick a ticket

Read `paths.sprintCurrent`. Pick a ticket from `ready_for_execution`
(or honor `--ticket`). Move it to `in_progress`:

```bash
node scripts/sprint/ticket.js update --id <T-id> --status in_progress --owner-agent alpha
```

### Step 3 — Start the Ralph loop

```bash
node scripts/sprint/execute.js start --ticket <T-id> \
  --tasks "task A;task B;task C" \
  --next-action "Plan the smallest next change for <T-id>."
```

This creates `paths.sprintRalph/<sprint>/<ticket>.yaml` in phase `plan`,
loop 1.

### Step 4 — Run the Ralph loop

Each loop:

1. **plan** — read the ticket; pick ONE coherent next task; write the
   intended change as a tiny plan.
2. **act** — make the smallest meaningful change.
3. **test** — run relevant checks (lint, typecheck, unit tests). Use
   `--add-passing`/`--add-failing` on the phase update to record
   results.
4. **review** — does the change match the ticket and requirements?
   Does it satisfy COPY, INPUTS, TRACE, acceptance criteria, ESD
   constraints, and QA expectations? If not, note what's missing.
5. **record** — update the ticket (status, evidence, fix attempts).
   Update the requirements files if behavior diverged from spec.
6. **checkpoint** — write a checkpoint via `scripts/sprint/checkpoint.js`
   AND advance the Ralph file via `execute.js phase --phase checkpoint`.
7. **repeat or stop** — if remaining tasks exist and no stop condition
   was hit, loop. Otherwise stop.

Phase transitions:

```bash
node scripts/sprint/execute.js phase --ticket <T-id> --phase act \
  --note "Started implementing X"
node scripts/sprint/execute.js phase --ticket <T-id> --phase test \
  --add-passing "lint;typecheck" --add-failing "unit-tests:X"
node scripts/sprint/execute.js phase --ticket <T-id> --phase review \
  --note "AC-1.1 satisfied; AC-1.2 missing"
node scripts/sprint/execute.js phase --ticket <T-id> --phase record
node scripts/sprint/execute.js phase --ticket <T-id> --phase checkpoint \
  --next-action "Next loop: address AC-1.2."
```

### Step 5 — Stop conditions

Halt the Ralph loop and call `execute.js stop` when any of these
trigger:

| Condition | Stop reason |
|---|---|
| Ticket meets all AC; tests pass | `completed` |
| Approval required | `stopped_approval_required` |
| Human setup / signup required | `stopped_human_setup_required` |
| 3+ failed attempts on the same fix | `stopped_repeated_failure` |
| Scope is expanding beyond the ticket | `stopped_scope_expansion` |
| Destructive action needed | `stopped_destructive_action_needed` |
| Production deploy needed | `stopped_production_deploy_needed` |
| Beta predicts user rejection | `stopped_beta_warning` |
| Intent is unclear (re-plan needed) | `stopped_unclear_intent` |

```bash
node scripts/sprint/execute.js stop --ticket <T-id> \
  --reason <reason> --notes "<what's needed next>"
```

After `completed`, update the ticket:

```bash
node scripts/sprint/ticket.js update --id <T-id> --status in_review \
  --add-evidence "tests/<path>.spec.ts passing; PR #N"
```

### Step 6 — Log issues found

Any bug, regression, or edge case discovered mid-loop is recorded:

```bash
node scripts/sprint/issue.js create \
  --title "<short>" \
  --severity <low|medium|high|critical> \
  --source <test_failure|qa_finding|redteam_finding|agent_observation> \
  --expected "<expected>" \
  --actual "<actual>" \
  --related-ticket <T-id>
```

Promote an issue to a new ticket if it requires its own scoped work:

```bash
node scripts/sprint/issue.js promote --id <I-id> --to-ticket-type bug
```

### Step 7 — 3-attempt rule

If a fix on the same bug fails 3+ times:

1. Stop brute-forcing.
2. Each attempt is already logged via
   `execute.js phase --add-failed-attempt "<approach>"`.
3. Mark the issue `deferred` (or `abandoned` if non-blocking) unless
   the issue blocks the sprint objective.
4. If it blocks the sprint, escalate via `/fix:deep`.

This matches the existing rule in CLAUDE.md and the bug helpers.

### Step 8 — Checkpoint discipline

Write a checkpoint at minimum:

- after each Ralph loop completes
- before each ticket starts
- when an issue is discovered
- when an approval boundary is hit
- when external service setup is required
- when scope expands (and the run halts)
- before final report

```bash
node scripts/sprint/checkpoint.js \
  --sprint <sprint-id> \
  --phase execute \
  --command /sprint:execute \
  --status running \
  --ticket <T-id> \
  --loop <n> \
  --next-action "<plain English>" \
  --resume-command "/sprint:execute --ticket <T-id>" \
  --resume-notes "Loop <n>, phase <p>. Next: <text>." \
  --safe-to-continue true
```

### Step 9 — Final execution report

When the sprint's ready_for_execution queue is empty (or you stop
intentionally), write a one-page execution report. The simplest form:
update `paths.sprintCurrent.reports.execution` to point at a markdown
file you draft summarizing tickets completed, issues resolved/deferred,
checks results, and learning candidates.

## Outputs

| Artifact | Path |
|---|---|
| Ralph progress | `paths.sprintRalph/<sprint>/<ticket>.yaml` |
| Ticket updates | `paths.sprintTickets/<T-id>.yaml` |
| Issue records | `paths.sprintIssues/<I-id>.yaml` + `paths.sprintIssuesLedger` |
| Checkpoints | `paths.sprintProgress` + `paths.sprintCheckpoints/<sprint>-<n>.yaml` |
| Current sprint | `paths.sprintCurrent` (tickets, ralph, crash_recovery updated) |

## Recovery

Crash mid-loop:

1. Read `paths.sprintProgress`. The `current_ticket`, `current_loop`,
   `current_phase`, and `next_action` fields tell you where you were.
2. Read `paths.sprintRalph/<sprint>/<ticket>.yaml` for the loop's full
   state.
3. If `status` is `stopped_*`, **investigate** the `stop_reason` before
   resuming.
4. Resume by re-running `/sprint:execute --ticket <T-id>` and advancing
   the phase from where you left off (`execute.js phase`).

## Approval gates

- Any ticket with `approval_required: true` halts the loop until the
  approval record exists.
- ESDs with `approval_required: true` halt the loop until approved.
- Production deploy is never automated. `/sprint:execute` halts; the
  user invokes `/sprint:release`.

## Routing

Per `paths.sprintRouting`:
- `execution.model_class` = `economical_coder`
- `execution.escalate_to` = `strong_reasoning` (on repeated failure or
  architecture-touching tickets)
- `qa.diff_review` = `true`
- `redteam.diff_review` = `true`

## Routing enforcement

Routing is enforced — not aspirational.

- `scripts/sprint/execute.js stop --reason completed` auto-records `phase=execution` per ticket via `routing.recordTrace({...auto_override: true, allow_single_vendor: true})`. Fail-open.
- QA and Redteam phases are recorded by their gauntlet entry points (Gamma's dispatch); when running them by hand, record manually:
  - `node scripts/sprint/routing.js record --phase qa --artifact <T-id> --sprint <SP-id> --model <provider:model> [--diff-reviewer <provider:model>|--allow-single-vendor] --ticket <T-id>`
  - `node scripts/sprint/routing.js record --phase redteam --artifact <T-id> --sprint <SP-id> --model <provider:model> [--diff-reviewer <provider:model>|--allow-single-vendor] --ticket <T-id>`
- When the recording model (e.g. `claude:claude-opus-4-8`) is not in the phase's declared class (e.g. `economical_coder`), `auto_override: true` downgrades the row to `evidence: mismatch_override` with an auto decision-ledger ref — honest about the gap rather than blocking.
- `/sprint:release` calls `routing.coverageReport(<SP-id>)` and refuses release when required phases (planning, design, execution, qa, redteam, release) lack traces; `--allow-routing-gap` is the documented override.
- Trace: `paths.sprintDecisions/routing-trace.jsonl`. Coverage: `node scripts/sprint/routing.js coverage --sprint <SP-id>`.

## Relationship to existing modes

`/sprint:execute` is mode-aware:

- **Solo:** Alpha runs the loop directly.
- **Adhoc:** Alpha runs the loop. Gamma is invoked when a ticket needs
  a build/gauntlet cycle (existing Gamma flow). Sprint progress is the
  durable record; team-task ownership is ephemeral.
- **Oneshot:** Not the intended path. Oneshot is a standalone skeleton
  rebuild; sprint v0.1 does NOT auto-invoke it. If a sprint genuinely
  needs an oneshot rebuild, halt sprint execution, run
  `/mode:oneshot`, and re-enter sprint when complete.

The sprint tracker is the source of truth for what's done, regardless
of mode. Team tasks are NEVER used as the durable record.

## Background-task pitfall in the Ralph test phase

Do NOT use `Bash run_in_background: true` inside the Ralph test phase — if the loop exits unexpectedly (timeout, halt, crash), the child process is orphaned, and on Windows it survives past the parent (cmd.exe wrappers don't honor SIGTERM). Run tests in the foreground with an explicit timeout, or use the `Monitor` tool for "wait until condition X" semantics. See `paths.reference/operational-loop.md#background-tasks-and-windows-process-hygiene` and `/scan:node-procs` for a session-side snapshot of leaked Node processes.

## Sprint Goal Verification linkage convention

When a ticket implements an AC that's part of an opted-in sprint
(Plan Contract carries `goal_verification.reproduction = executable`),
the ticket author MUST emit a real `verified_by: <test-file>::<test-name>`
line in `acceptance-criteria.md` and author the cited test under
`paths.sprintRegressionCorpus/<SP-id>/`. The test follows the bespoke
node-script convention (`  ok    <name>` / `  FAIL  <name>` per case;
exit 0 on all-pass). The design-time gate refuses to advance the
sprint when this linkage is missing; the release-time ship-gate runs
every cited test. See
`paths.sprintReference#sprint-goal-verification`.

## Reference

See `paths.sprintReference` (§ "Ralph loop" and § "Crash recovery rule").
