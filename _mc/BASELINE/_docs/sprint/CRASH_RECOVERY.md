# Sprint v0.2 — Crash Recovery

A sprint must be recoverable after session crash, context reset,
terminal interruption, or agent restart. The mechanism is files, not
chat. v0.2 adds the multi-sprint registry — recovery starts by
reading `active-sprints.yaml` to find out which sprints exist before
looking up their individual progress.

## Recovery truth sources (v0.2)

1. **`paths.sprintActiveRegistry`** (`active-sprints.yaml`)
   The list of live sprints. Read first. `primary` is the default
   target; helpers honor `--sprint <SP-id>` to address others.
2. **Per-sprint `progress.yaml`**
   For each sprint in the registry, the live checkpoint at
   `sprints/<SP-id>/progress.yaml` (v0.2 layout) or
   `paths.sprintProgress` (legacy v0.1 install with
   `layout: legacy_root` in the registry).
3. **Per-sprint `current.yaml`**
   `sprints/<SP-id>/current.yaml` mirrors the resume command in
   `crash_recovery.resume_command` / `crash_recovery.resume_summary`.
4. **`paths.sprintCheckpoints`** (`checkpoints/<SP-id>-<n>.yaml`)
   Frozen historical copies, sequence numbered. The audit trail when
   live state is corrupted.

Run `/sprint:status` for a one-glance view of the registry and every
sprint's resume command.

## The recovery procedure

When a fresh agent enters a repo with a sprint tracker:

### 1. Read sprint-progress.yaml

```bash
cat .claude/project/sprint/sprint-progress.yaml
```

Look at:

- `current_phase` — what phase of the sprint we were in
  (idle | plan | design | execute | release | retrospective).
- `current_command` — what `/sprint:*` was last running.
- `current_ticket`, `current_task`, `current_loop` — for in-flight
  execution.
- `status` — `starting | running | paused | blocked | waiting_on_human |
  waiting_on_external_service | stopped | completed | errored`.
- `last_completed_step` — last thing that finished cleanly.
- `next_action` — plain English instruction for resume.
- `resume_command` — the exact `/sprint:*` command to re-run.
- `resume_notes` — context for the resume.
- `safe_to_continue` — boolean. If `false`, do NOT auto-resume.
- `stop_reason` — populated when the loop stopped intentionally.
- `blockers` — list of unresolved issues.
- `approvals_needed` — pending approval refs.
- `external_services_needed` — pending ESD refs.

### 2. Read current-sprint.yaml#crash_recovery

The `crash_recovery` block mirrors the relevant sprint-progress fields,
plus:

- `active_files` — list of files being edited at the time.
- `dirty_state` — were there uncommitted modifications?
- `last_checkpoint` — pointer to the frozen checkpoint.

### 3. If `safe_to_continue: true`

Re-run `resume_command`. Most sprint commands are idempotent — they
detect existing state and pick up from there.

### 4. If `safe_to_continue: false`

Investigate before resuming. Common causes:

- A partial Plan Contract write (the YAML may be missing required
  fields).
- A Beta-escalation that was never surfaced to the user.
- A test run that started but the result wasn't captured.
- A ticket status change that didn't update current-sprint buckets.

To investigate:

```bash
# Compare frozen checkpoints to current state.
ls .claude/project/sprint/checkpoints/
cat .claude/project/sprint/checkpoints/<latest>.yaml
node scripts/sprint/validate.js .claude/project/sprint/current-sprint.yaml
node scripts/sprint/validate.js .claude/project/sprint/sprint-progress.yaml
```

Fix any schema-level corruption (e.g. truncated yaml from a crash mid-
write). Then either:

- Roll forward: edit `safe_to_continue: true` and re-run resume_command.
- Roll back: copy a frozen checkpoint over `sprint-progress.yaml` and
  re-run `resume_command` from there.

### Resuming a `beta_consult_pending` halt (adhoc /sprint:full)

In adhoc mode, `/sprint:full` halts at each phase boundary so the operator can
perform the real Beta (Alex β) consult. The halt report names the boundary
(e.g. `before_design`, `before_execute`).

**Resume contract** — after consulting Beta via SendMessage, resume with:

```bash
node scripts/sprint/full.js --sprint <SP-id> --resume \
  --pending-phase <boundary> \
  --beta-verdict <DECIDE|DIRECTIVE|ESCALATE> \
  --beta-message "<Beta's response>"
```

Notes:
- `--beta-verdict`, `--beta-message`, and `--pending-phase` are **resume-only**:
  supplying them on a fresh run is rejected (exit 2).
- One verdict per resume invocation. Later phase boundaries will halt again
  with `beta_consult_pending` and require their own resume.
- If Beta returns ESCALATE, the orchestrator records the verdict and then
  escalates to a `beta_escalate` hard halt — operator must resolve before the
  phase can proceed.

The halt taxonomy (all `halt_reason` values) lives in `_docs/sprint/AUTONOMY.md`.

### 5. If the sprint is in Ralph execution

Read `paths.sprintRalph/<sprint>/<ticket>.yaml`:

- `phase` tells you the loop step (plan | act | test | review | record |
  checkpoint | stopped).
- `status` tells you whether the loop was running or had stopped (and
  why).
- `failed_attempts` and `last_checks` give you the recent failure
  history.
- `next_action` is the resume hint.
- `resume_instructions` is the explicit text.

Common stop reasons and their unblock:

| Stop reason | Unblock |
|---|---|
| stopped_approval_required | Record an approval YAML, then re-run `/sprint:execute --ticket <T-id>`. |
| stopped_human_setup_required | Confirm the ESD's `human_setup_steps` are done, update via `external-service.js update`, then resume. |
| stopped_repeated_failure | Mark the issue deferred/abandoned, or escalate via `/fix:deep`. |
| stopped_scope_expansion | Either expand the Plan Contract (re-plan) or move the new scope into a new ticket. |
| stopped_destructive_action_needed | Ask the user. Do not auto-proceed. |
| stopped_production_deploy_needed | Switch to `/sprint:release`. |
| stopped_beta_warning | Surface the Beta concern to the user. |
| stopped_unclear_intent | Re-plan via `/sprint:plan`. |

## Recovery from corrupted tracker

If `current-sprint.yaml` or `sprint-progress.yaml` is unreadable:

1. Find the most recent good frozen checkpoint:

   ```bash
   ls -t .claude/project/sprint/checkpoints/ | head
   ```

2. Validate it:

   ```bash
   node scripts/sprint/validate.js .claude/project/sprint/checkpoints/<latest>.yaml
   ```

3. Copy it over `sprint-progress.yaml`:

   ```bash
   cp .claude/project/sprint/checkpoints/<latest>.yaml \
      .claude/project/sprint/sprint-progress.yaml
   ```

4. Re-derive `current-sprint.yaml#crash_recovery` by reading the
   checkpoint and updating the fields.

5. Re-run `resume_command`.

## What NOT to do during recovery

- Do NOT delete the tracker dir. The audit trail is the recovery
  surface.
- Do NOT re-run `scripts/sprint/init.js --force` on a live sprint.
  It will clobber `current-sprint.yaml` and `sprint-progress.yaml`.
- Do NOT skip the `safe_to_continue: false` check. That flag exists
  to prevent auto-resuming into a corrupt state.
- Do NOT assume team-task state is the source of truth. It's not.
  Sprint tracker is.
- Do NOT rely on chat history. Files only.

## Checkpoint discipline (write-time)

When writing a sprint command, the checkpoint discipline is:

1. **At command start** — write a checkpoint with
   `last_completed_step: command_started`, status `running`.
2. **After each meaningful step** — checkpoint with the step name.
3. **Before any operation that might fail** — checkpoint with
   `safe_to_continue: false` until it completes.
4. **After any operation that succeeded** — checkpoint with
   `safe_to_continue: true`.
5. **At command end** — checkpoint with `status: completed` or
   `paused`.

`scripts/sprint/checkpoint.js` is the single writer. It always:

- Updates `paths.sprintProgress` (the live file).
- Writes a frozen copy under `paths.sprintCheckpoints/<sprint>-<n>.yaml`.

## /mc:update recovery (SP-20260514-001)

When `/mc:update` is interrupted mid-pipeline:

1. Read the transaction id from the last `mc.update.transaction.start`
   event in `paths.eventsFile`. The transaction wrapper writes a frozen
   snapshot keyed by that id.
2. Run `node scripts/mc/preflight.js --target <path> --to <v>` to see
   which gates are red after the partial apply.
3. If a specific gate is red but the underlying state is acceptable to
   the operator, use `--operator-override <gate-name> --override-reason
   "<text>"` to proceed. Every override emits a
   `mc.update.operator-override-used` event (audit trail).
4. If the transaction was rolled back, `framework-installed.json` is
   restored from snapshot — no further action needed.
5. If the partial apply left mixed state, run the opt-in recovery tools:
   - `node scripts/mc/lf-normalize-target.js <path>` — normalize
     line endings (rarely needed after T-20260514-068 since the hash
     pipeline now collapses CRLF/LF semantically).
   - `node scripts/mc/prune-installed-assets.js <path>` — drop
     stale entries from `framework-installed.json`.

### New event kinds (T-20260514-076)

`scripts/mc/lib/update-events.js` emits these on top of TR-1..TR-6:

- `mc.update.content-hash-mismatch` — `kind: lf_only` is informational;
  `kind: real_drift` accompanies a MERGE_CONFLICT (real content divergence).
- `mc.update.operator-override-used` — audit trail for every
  `--operator-override` invocation. Captures gate, reason, operator, ts,
  txId.
- `mc.update.ownership-transitioned` — classifier promotes a
  `framework_template` path to `project_owned` on consumer non-whitespace
  edit. Decision-ledger 2026-05-14 documents the auto-trigger rule.

## See also

- `paths.sprintReference` — full reference doc.
- `_docs/sprint/RALPH_LOOP.md` — Ralph loop crash semantics.
- `_docs/sprint/UPDATE_PIPELINE.md` — three-phase `/mc:update` map +
  hash semantics + ownership state machine.
