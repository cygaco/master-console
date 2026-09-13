# /sprint:full Autonomy — Plain-English Reference

`/sprint:full` runs the whole sprint pipeline in one invocation, but
only does as much on your behalf as the **preset** allows. Hard
ceilings exist that no preset can lift.

## The three default presets

Preset bundle lives at `paths.sprintFullAutonomy` (operator-editable).

### `conservative` — halt early, halt often

Auto-progresses phase boundaries only when everything is clean.
First sniff of an approval, a Beta concern, a repeated failure, a
scope expansion — halt. Best when you want the front-door
convenience of `/sprint:full` but plan to make every decision
yourself.

- Pre-authorizes: `no_approval_needed` only.
- Repeated failure: halt (no auto-defer).
- Cost threshold: $5 (CLAUDE.md autonomy line).
- Branch protection: refuses on main; `--allow-main` does not help.

### `moderate` — the default

Auto-defers tickets that hit the 3-attempt rule (matches `execute.js`
behavior). Pre-authorizes design-time approvals only. Halts on
everything else.

- Pre-authorizes: `no_approval_needed`, `design_approval_required`.
- Repeated failure: **defer** (log + continue to next ticket).
- Cost threshold: $5.
- Branch protection: refuses on main; `--allow-main` does not help.

Designed for: small/medium sprints where you're confident in the
plan, want to skip the keyboard cadence, but still want to be asked
about execution + release approvals.

### `aggressive` — maximum autonomy within hard ceilings

Pre-authorizes execution + staging-release approvals. Auto-continues
through `approval_required` when within preset. Allows `--allow-main`
override. Still halts on production deploy, paid services, Beta
ESCALATE, destructive actions, and scope expansion.

- Pre-authorizes: `no_approval_needed`, `design_approval_required`,
  `execution_approval_required`, `release_approval_required` (staging
  / internal-canary / dev only).
- Repeated failure: **defer**.
- Cost threshold: $5.
- Branch protection: respects `--allow-main`.

Designed for: well-defined, low-risk sprints you've already shipped
versions of; sprints where the staging/internal pre-deploy step is
the only "release" target.

## Hard ceilings — never bypassable

These are hardcoded in `scripts/sprint/full.js#HARD_CEILINGS`. The
orchestrator refuses to load any preset that tries to lift them.

| Ceiling | What it blocks | Why |
|---|---|---|
| `push_to_remote` | `git push`, `gh pr merge`, any remote-state mutation | Pushing affects shared state. Operator approves per CLAUDE.md autonomy. |
| `paid_service_signup` | New ESDs that incur cost | Spending money requires explicit operator decision. |
| `production_deploy` | `release.js deploy` against production target | Production deploys are always operator-invoked. Even `aggressive` only auto-approves staging/internal/dev. |
| `destructive_migration` | DROP TABLE, rm -rf prod data, similar | Data loss requires explicit operator decision. |
| `secret_to_remote` | `secret: true` env values appearing in tracked files / reports | Leaking credentials is a high-severity bug class. |

If you find a preset that lets the orchestrator do any of these, it's
a bug — file a Class B issue.

## The halt taxonomy

When the orchestrator halts mid-run, it writes
`paths.sprintFullReports/<SP-id>/halt-<ISO>.md` and exits 1. The
halt report names a `halt_reason` and a `resume_command`. Common
halts:

| halt_reason | What happened | What to do |
|---|---|---|
| `plan_quality_fail` | Plan Contract returned `needs_user_clarification` or `blocked` | Read the PC's `open_questions.blocking`, answer them, re-plan |
| `esd_signup` | An ESD requires signup/billing/credentials | Complete external setup, mark ESD `ready_for_terminal_work`, resume |
| `approval_beyond_preset` | A ticket needs approval at a level outside preset | Record the approval OR re-run with broader preset (still hard-ceiling-bound) |
| `beta_consult_pending` | Adhoc mode: reached a Beta phase boundary with no supplied verdict | Consult Beta (Alex β), then resume with --beta-verdict <DECIDE\|DIRECTIVE\|ESCALATE> --beta-message "<...>" --pending-phase <boundary> |
| `beta_escalate` | Beta returned ESCALATE at a phase boundary | Address Beta's concern, resume |
| `cost_threshold` | Cumulative cost estimate > preset threshold | Resume with `--cost-acknowledged` (2× for this run only) OR raise preset's threshold |
| `repeated_failure_threshold` | > N% of tickets deferred via 3-attempt rule | Investigate root cause, fix, re-run |
| `scope_expansion` | execute.js detected scope drift on a ticket | Re-plan the ticket, don't extend silently |
| `destructive_action_needed` | A ticket needs DROP TABLE or rm -rf | Operator does it manually; do not auto |
| `production_deploy_needed` | Release phase reached a production target | Operator invokes deploy manually |
| `unclear_intent` | Ticket intent ambiguous mid-Ralph-loop | Re-plan the ticket with clearer wording |
| `branch_protection` | Current branch is main/master | `git switch -c sprint/<SP-id>` then re-run (NOT resume — sprint hasn't started) |
| `plan_payload_missing` | No `.mc/plan-payload-*.json` found at Phase 1 | Skill body must construct the payload before invoking full.js |
| `plan_payload_invalid` | plan.js rejected the payload | Fix the payload, re-run |
| `design_scaffold_failed` | design.js exited non-zero | Check stderr; fix the template inputs |
| `release_prepare_failed` | release.js prepare exited non-zero | Check stderr; missing fields likely |

## Writing your own preset

Add a key to `paths.sprintFullAutonomy#presets`. Required fields:

```json
"my_preset": {
  "preset_name": "my_preset",
  "description": "one-line summary",
  "pre_authorized_approval_levels": ["no_approval_needed"],
  "release_approval_targets": [],
  "stop_condition_policy": {
    "approval_required": "halt",
    "human_setup_required": "halt",
    "repeated_failure": "defer",
    "scope_expansion": "halt",
    "destructive_action_needed": "halt",
    "production_deploy_needed": "halt",
    "beta_warning": "halt",
    "unclear_intent": "halt"
  },
  "halt_threshold_failed_tickets_pct": 50,
  "cost_estimate_threshold_usd": 5.0,
  "branch_protection_allow_main": false
}
```

Run `node scripts/sprint/validate-autonomy-config.js` to verify the
preset is schema-valid AND ceiling-compliant before first use.

### What you CAN configure

- Which approval levels are auto-recorded (within hard ceilings).
- Per-stop-reason behavior (`halt` / `auto_continue` / `defer`).
- The failed-tickets percentage that triggers a global halt.
- The cost-estimate threshold (above CLAUDE.md $5 line requires
  operator awareness).
- Whether `--allow-main` is honored (only set `true` for an
  intentionally aggressive preset).
- Which release targets the preset may auto-approve (staging,
  internal-canary, dev — production is forbidden).

### What you CANNOT configure

- Hard ceilings (`push_to_remote`, `paid_service_signup`,
  `production_deploy`, `destructive_migration`, `secret_to_remote`).
- Adding `production_release_approval` or `paid_service_approval` to
  `pre_authorized_approval_levels[]` — the orchestrator rejects
  startup.
- Adding `production` to `release_approval_targets[]` — also rejected.
- The phase order (always plan→design→execute→release-prep→retro).
- Skipping phases entirely (use per-phase commands if you want
  surgical control).

## Cost estimate semantics

`/sprint:full` keeps a coarse counter of LLM spend per phase:

| Phase | Typical spend (USD) |
|---|---|
| plan | $0.75 |
| design | $2.00 |
| execute | $1.50 × ticket_count |
| release-prep | $0.50 |
| retro | $0.50 |

Numbers are rough — they'll be calibrated from real telemetry as the
sprint history grows. If your sprint has 5 tickets, the estimate is
~`0.75 + 2.00 + 1.50*5 + 0.50 + 0.50 = $11.25`, which trips the $5
threshold in `moderate` and `aggressive` presets.

Two ways to handle:

- **One-time**: resume with `--cost-acknowledged` — raises threshold
  to 2× for this run only, non-persistent.
- **Persistent**: edit `cost_estimate_threshold_usd` in your
  preset.

## Audit trail

Every `/sprint:full` run leaves:

- `sprint_full_started` event (preset, mode, branch, request hash)
- `sprint_full_phase_started` + `_phase_completed` per phase
- `sprint_full_auto_approval` for every auto-recorded approval
- `sprint_full_beta_consult` for every Beta exchange, carrying the verdict
- `sprint_full_halt` if any halt fires
- `sprint_full_ceiling_breach_attempt` if a hard ceiling was tested
  (should always be zero)
- `sprint_full_done` on success

Filter with: `grep '"kind":"sprint_full_' .claude/project/events/events.jsonl`.

Beta consultation at phase boundaries is **enforced**, not aspirational: in
adhoc mode `/sprint:full` halts at each boundary (`beta_consult_pending`) until
a real Beta verdict is supplied on resume. ESCALATE cannot be silently
downgraded to a placeholder DECIDE. (SP-20260525-003.) Durable audit coverage
is provided by `/scan:sprint-beta-honesty`, which verifies that recent
post-cutoff sprints carried real (non-placeholder) Beta consults at expected
boundaries and that every ESCALATE produced a `beta_escalate` halt; it exits
non-zero on findings — run it ad-hoc or wire it into CI to confirm cadence
integrity. (SP-20260525-004.)

## See also

- Skill: `.claude/commands/sprint/full.md`
- Orchestrator: `scripts/sprint/full.js`
- Schema: `schemas/sprint/sprint-full-autonomy.schema.json`
- Default presets: `paths.sprintFullAutonomy`
- Sprint workflow: `paths.sprintReference`
- CLAUDE.md autonomy table: `CLAUDE.md#Autonomy`
- Beta-cadence audit: `/scan:sprint-beta-honesty` (`scripts/checks/sprint-beta-honesty.js`)
- Test-suite convention + enforcer: `_docs/sprint/TESTSUITE.md` (regression-seed green per sprint; enforced by the `regression_seed` release gate)
