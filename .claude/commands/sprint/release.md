---
description: Prepare a sprint release — final checks, approval, release notes, rollback plan, release report, sprint archive and retrospective trigger. Going live is a separate step the person runs.
user-invocable: true
---

# /sprint:release — Sprint Release

Drive the closing phase of a sprint: confirm gates, request release
approval, capture post-release monitoring, trigger retrospective +
learning capture.

`/sprint:release` is conservative and approval-gated by default. It
NEVER performs a production deployment. Deploying is a separate step:
`/sprint:deploy`, which the person types after running the deploy
themselves; it only marks it (or rolls the record back).

> Ledger contract — this skill writes a `RELEASES.md` sprint row via `scripts/sprint/ledger.js` on prepare; the deploy mark (`/sprint:deploy`) updates it. See `paths.sprintReference#ledger-discipline` for what qualifies and the fail-open contract.

## When to use

- All sprint tickets are `done`, `released`, `deferred`, or
  `abandoned`.
- All blocking issues are resolved, deferred, or explicitly accepted.
- The release plan and QA plan have run.
- External service dependencies are ready, mocked, integrated, or
  deferred.

## Inputs

```text
/sprint:release [--id <RL-id>] [--title "<t>"] [--version "<v>"] [--target "<env>"] [--sprint <SP-id>]
```

If `--id` is omitted and no in-progress release exists, a new one is
prepared. `--sprint <SP-id>` targets a specific sprint;
omitted → registry primary; unknown id → unknown-sprint error.

## Procedure

### Step 0 — Beta pre-flight consultation (REQUIRED in adhoc mode)

**Before** invoking any AskUserQuestion to record release approval, dispatch
SendMessage to Alex β with the release context:

```text
SendMessage(to: "Beta (β)", message: "Release pre-flight for sprint <SP-id> /
RL-<RL-id>. Context: <one-line summary of what's shipping, target env,
risk surface>. Verdict needed: DECIDE | DIRECTIVE | ESCALATE before I ask
the user for production deploy approval.")
```

β responds DECIDE | DIRECTIVE | ESCALATE. Log the verdict to `paths.betaEvents`.
Only when β returns ESCALATE do you surface to the user, as a
`⚠️ DECISION NEEDED` (CLAUDE.md § Talking to the Operator).

### Step 1 — Prepare release record

Before preparing the record, apply the gauntlet→release stop rule:

> **DISCHARGE rule.** A gate is DISCHARGED when its declared oracle is measured ZERO on the certifying head ONCE, on the platforms the release declares. A discharged gate is not re-opened in this round by a new falsifier, vacuity probe, hermeticity scrub or platform floor; each of those is a ROADMAP item (`/roadmap:add`) with the measured cost, never a new lane. β at gauntlet→release answers exactly three questions: (1) is every stage of the full package (in 2.1.0 the close always demands the full package, whatever the selection) green on this head, (2) is the budget met or is the overrun recorded as a finding, (3) does any open lane cite a roadmap id. Three yes → DECIDE. A DIRECTIVE that opens a lane without a roadmap id is malformed.

```bash
node scripts/sprint/release.js prepare \
  --title "<sprint title>" \
  --version "<version label>" \
  --target "<production|staging|internal-canary>"
```

This writes `paths.sprintReleases/<RL-id>.yaml` in `preparing` state and
links it from `paths.sprintCurrent.reports.release`.

### Step 2 — Run the release check

```bash
node scripts/sprint/release.js check --id <RL-id>
```

The check pulls state from `paths.sprintCurrent` and ESDs. It computes
checklist booleans for:

- `tickets_done_or_deferred`
- `blocking_issues_resolved`
- `requirements_satisfied`
- `copy_satisfied` / `inputs_satisfied` / `trace_satisfied`
- `acceptance_criteria_satisfied`
- `qa_passed` / `redteam_passed`
- `external_services_ready`
- `approval_recorded`

If everything is `true`, status moves to `approval_pending`.

### Step 3 — Fill in the human-curated items

The release script can't auto-detect:

- `release_notes_written` — draft the changelog and set
  `release.changelog_path`.
- `docs_updated` — confirm docs reflect the changes.
- `analytics_updated` — if applicable.
- `migration_plan` / `rollback_plan` — link to a doc or annotate
  `none_required`.
- `credentials_present` — confirm env vars by NAME (never values).
- `post_release_monitoring_plan` — set the dashboards/alerts to watch.

Edit `paths.sprintReleases/<RL-id>.yaml` directly to flip these to
`true` once met.

### Step 4 — Request release approval

Release approval is **always required** for production deploys.

Create an approval record:

```bash
# Pick the right level; level enum is in schemas/sprint/approval.schema.json.
node -e "
const { writeYaml, nowIso } = require('./scripts/sprint/fs');
const { approvalId } = require('./scripts/sprint/ids');
const SPRINT = require('./scripts/sprint/paths');
const id = approvalId(SPRINT.approvals);
const now = nowIso();
writeYaml(require('path').join(SPRINT.approvals, id + '.yaml'), {
  schema: 'mc/sprint/approval/v1',
  id,
  sprint: process.env.SPRINT_ID || 'SP-...',
  level: 'release_approval_required',
  required_for: 'production deploy of release <RL-id>',
  linked_release: '<RL-id>',
  state: 'pending',
  requested_by: 'alpha',
  decided_by: null,
  decided_at: null,
  reason: '',
  evidence: [],
  created_at: now,
  updated_at: now,
});
console.log('approval:', id);
"
```

Surface the pending approval to the user. After they decide, edit the
approval YAML to set `state: approved|rejected|waived`, `decided_by`,
`decided_at`, and `reason`.

Then bind it to the release:

```bash
node scripts/sprint/release.js approve --id <RL-id> --approval <AP-id>
```

This moves the release status to `ready_to_deploy`.

### Step 5 — Hand off the deploy (separate step: `/sprint:deploy`)

The actual deployment is run by the person, out-of-band. Marking it is
its own skill: tell the person to run the deploy and then type
`/sprint:deploy --id <RL-id>` (it calls `release.js deploy`, and
`release.js rollback` when the deploy fails). Stop here until the
release is `deployed` or `rolled_back`, then re-run `/sprint:release
--id <RL-id>` to continue at Step 6 (see Recovery).

### Step 6 — Render the release report

```bash
node scripts/sprint/release.js report --id <RL-id>
```

Writes `paths.sprintReleases/<RL-id>.report.md` from the template.

### Step 7 — Archive the sprint to history

When the sprint is done (closed or shipped), write a history entry:

Place the history entry at `paths.sprintHistory/<sprint-id>/sprint-history.yaml`.

Move `paths.sprintCurrent.status` to `closed`.

### Step 8 — Trigger retrospective + learning

Append learning candidates from the sprint to `paths.learningsFile`
via the existing learning system (`/learn:integrate` for promotion).

Release does not auto-write learnings; downstream projects can
extend this with `/karpathy:integrate` or similar.

### Step 9 — Final checkpoint

```bash
node scripts/sprint/checkpoint.js \
  --sprint <sprint-id> \
  --phase release \
  --command /sprint:release \
  --status completed \
  --last-completed-step "release_deployed_or_rolled_back" \
  --next-action "Sprint closed. Run /sprint:plan to begin the next sprint." \
  --resume-command "/sprint:plan" \
  --resume-notes "Sprint <sprint-id> closed; release <RL-id> status=<status>." \
  --safe-to-continue true
```

### Step 10 — Surface to user

Tell the user:

1. Release id + status.
2. Approval reference.
3. Changelog path.
4. Monitoring checklist (top items).
5. Rollback procedure (one line).
6. Next command.

## Outputs

| Artifact | Path |
|---|---|
| Release record | `paths.sprintReleases/<RL-id>.yaml` |
| Release report | `paths.sprintReleases/<RL-id>.report.md` |
| Approval | `paths.sprintApprovals/<AP-id>.yaml` |
| Sprint history | `paths.sprintHistory/<sprint-id>/sprint-history.yaml` |
| Current sprint | `paths.sprintCurrent.status: closed` |
| Final checkpoint | `paths.sprintProgress` + frozen checkpoint |

## Recovery

If the session crashed during release:

1. Read `paths.sprintProgress`. The `current_command: /sprint:release`
   and `next_action` tell you which sub-step was last attempted.
2. Read the release YAML — `status` plus `checklist` show what's done.
3. Resume:
   - If `status: preparing` or `approval_pending` — re-run `release.js check`.
   - If `status: ready_to_deploy` — the person still has to deploy and
     mark it with `/sprint:deploy`.
   - If `status: deployed` — render the report and capture learnings.
   - If `status: rolled_back` — write the rollback rationale into the
     report.

## Approval gates

- Production deploy: **always** requires an approval record.
- Rollback (in `/sprint:deploy`): does not require its own approval
  (it's a safety action), but the rollback reason must be recorded.
- New paid services discovered late: require their own approvals
  before they appear in the release.

## Routing

Per `paths.sprintRouting`:
- `release.model_class` = `strongest_reasoning`
- `release.diff_review` = `true`

## Routing enforcement

Routing is enforced — not aspirational.

- `scripts/sprint/release.js check` calls `routing.coverageReport(<sprint-id>)` early in the release flow. When required phases (planning, design, execution, qa, redteam, release) lack a trace row, the check exits non-zero. Operator override: `--allow-routing-gap` (logged to `paths.decisionLedger`).
- A `phase: release` trace is recorded when the release artifact is finalized. When running the release flow by hand: `node scripts/sprint/routing.js record --phase release --artifact <RL-id> --sprint <SP-id> --model <provider:model> [--diff-reviewer <provider:model>|--allow-single-vendor]`.
- `scripts/hooks/sprint-routing-guard.js` watches writes to `paths.sprintReleases/<RL-id>.yaml`. In `block` mode the hook refuses release-record writes that lack a trace; default `enforcement.mode` is `warn` during soft rollout.
- Coverage summary: `node scripts/sprint/routing.js coverage --sprint <SP-id>` (also `--format json` for machine consumption).

## Relationship to existing modes

`/sprint:release` is mode-aware:

- **Solo:** Alpha drives the release.
- **Adhoc:** Alpha drives release; Beta is consulted for ship/no-ship
  judgment.
- **Oneshot:** Not the intended path.

Mode is never auto-switched. The user invokes `/sprint:release`
explicitly.

## Non-Goals

- `/sprint:release` does NOT deploy code or mark a deployment; that is
  `/sprint:deploy`.
- `/sprint:release` does NOT bypass approval gates.
- `/sprint:release` does NOT close a sprint that has unresolved blocking
  issues unless the user explicitly waives them via an approval record.

## Reference

## Sprint Goal Verification cited-test executor

`scripts/sprint/release.js check` runs the cited-test ship-gate when
the Plan Contract carries `goal_verification.reproduction =
executable`. The executor reads every `verified_by: <file>::<name>`
line from `acceptance-criteria.md`, runs each cited test, and
classifies into three branches:

- **pass** — exit 0 + parseable `  ok    <name>` line for the cited test.
- **fail** — parseable `  FAIL  <name>` line **OR ENOENT on the cited
  test path**.
- **inconclusive** — non-zero exit + no recognizable per-case markers.
  Blocks the release until an operator records an override in
  `paths.decisionLedger` with `kind=release_override_inconclusive_test`
  matched by `(sprint_id, test_file, test_name)`. There is **no
  `--allow-coverage-gap` CLI flag** — the ledger row IS the
  audit trail.

`acceptance_criteria_satisfied` flips to `true` only when zero
fails AND zero unresolved inconclusive. Plan Contracts
(no `goal_verification`) retain the operator-discipline boolean. See
`paths.sprintReference#sprint-goal-verification`.

## Reference

See `paths.sprintReference` (including § "Crash recovery rule").
