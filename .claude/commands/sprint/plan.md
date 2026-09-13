---
description: Turn a brief plain-language request into a structured sprint plan and durable Plan Contract. Evidence-labeled, approval-aware, crash-recoverable.
user-invocable: true
---

# /sprint:plan — Sprint Plan

Front door for the sprint workflow. Turn brief founder/product intent
into a durable Plan Contract that prevents fantasy planning, premature
ticketing, hidden assumptions, and accidental execution.

`/sprint:plan` is **planning only**. It does not mint executable tickets
(except for explicitly tiny low-risk work). It does not invoke or
switch modes. It does not start a build.

## Who authors (role routing — the WG-3 rule)

The **product-lead** persona authors the Plan Contract — requirement
authoring is its registry-owned scope (`_org/role-registry.json`). If you
are α (or any orchestrator) reading this skill: **dispatch product-lead**
(in-process Agent tool, lean-return envelope — write the artifact to its
path, return ≤8 lines) and review the result; do NOT hand-author the
contract yourself. The ε-conducted path (`/sprint:full` in sprint-mode
sessions) already routes this through the hook-point roster; this rule
covers DIRECT invocations and non-sprint sessions, which historically
steered the orchestrator into self-authoring (the WG-3 failure mode:
self-authored reqs never get the producer/checker split that catches
fantasy planning). Solo-mode exception: α may author directly only when
the operator explicitly chose `/mode:solo` for a quick one-off — say so
in the contract's provenance line either way (`authored_by: product-lead`
or `authored_by: alpha-solo`).
Enforcement: skill-body routing (this section) + provenance line; an
events-based detector (plan-contract-exists ⇒ product-lead authorship
record) is logged enforcement debt — see `paths.enforcementDebt`.

> Ledger contract — this skill writes a `ROADMAP.md` sprint row via `scripts/sprint/ledger.js`. See `paths.sprintReference#ledger-discipline` for what qualifies and the fail-open contract.

## When to use

- A user gives you a brief plain-language request and you need a
  structured starting point before any design/code/QA work.
- You need to convert "make X do Y" into evidence-labeled assumptions,
  a scope variant set, and an honest plan-quality verdict.
- You need to identify external service dependencies (signup, billing,
  credentials, OAuth, DNS, compliance) BEFORE execution begins.

## Inputs

```text
/sprint:plan "<brief plain-language request>" [--sprint <SP-id>]
```

The `--sprint <SP-id>` flag (v0.2, T-20260512-007) targets a specific
sprint instead of the registry primary. Omitted → defaults to
`paths.sprintActiveRegistry#primary`. Unknown id → helper exits
non-zero with the COPY C-10 "unknown sprint" message. Set
`process.env.MC_SPRINT_ID` as a side effect so logger +
decision-ledger auto-tag rows for the targeted sprint.

Examples:

- `/sprint:plan "Make the pizza agent check delivery before calling."`
- `/sprint:plan "Add onboarding to the app."`
- `/sprint:plan "Remove the old compatibility flow."`
- `/sprint:plan "Add Stripe subscriptions."`
- `/sprint:plan "Add SMS notifications for missed appointments."`
- `/sprint:plan "Refactor invoicing" --sprint SP-20260520-002` (target
  a second live sprint without bumping the primary).

## Procedure

### Step 1 — Ensure tracker exists

If `.claude/project/sprint/` is missing, run:

```bash
node scripts/sprint/init.js --project "$(basename "$PWD")"
```

This creates the tracker tree from the templates in
`_mc/templates/sprint/init/` (see `paths.sprintTemplates`). Safe
to re-run — it refuses to overwrite existing files unless `--force`.

### Step 2 — Preserve the request verbatim

Capture `$ARGUMENTS` exactly as the user typed it. This becomes
`plan_contract.source_request_verbatim` and MUST NOT be cleaned up,
shortened, or paraphrased. The cleaned-up version goes into
`source_request`.

### Step 3 — Classify the request

Pick one `request_type` from:

```
feature_add | feature_modify | feature_remove | bug_fix | research |
architecture_change | refactor | qa | release | docs |
operating_loop | integration | external_service_setup
```

### Step 4 — Inspect the repo just enough to avoid fantasy

Inspect existing surfaces likely affected. For each surface, set an
`evidence_level`:

- `verified_from_repo` — confirmed by reading the actual files.
- `inferred_from_repo` — strongly suggested by neighboring files.
- `assumed_from_request` — taken from the user's words; not yet
  verified.
- `unknown` — flagged honestly.

Do **not** broad-scan the codebase. Do **not** start refactor work.
Inspection is bounded: just enough to label evidence honestly.

### Step 5 — Identify external service dependencies

For each candidate external service, decide whether it requires:

- signup
- billing
- credentials / secrets
- OAuth or app approval
- domain/DNS configuration
- compliance / legal review
- production access vs sandbox

If the answer is "possibly" or "yes", record an ESD candidate in
`external_service_dependencies.required` or `.possible`. Later
`/sprint:design` will mint full ESD records via
`scripts/sprint/external-service.js create`.

### Step 6 — Identify scope variants

Always produce three:

- `minimal_safe` — smallest change that achieves the outcome.
- `recommended` — your honest pick (usually mid).
- `expanded` — what we'd add if scope grew.

### Step 7 — Decide design + approval requirements

- `design_required`: true unless the work is explicitly tiny low-risk.
- `execution_allowed_without_design`: false except for `documentation_scale=xs`.
- Populate `approval_boundaries` with anything in CLAUDE.md "Autonomy"
  table that this work would trip: paid services, production deploy,
  destructive migration, secrets handling, sensitive user data.

### Step 8 — Run the plan-quality gate

Mark `plan_quality.status` as one of:

- `pass` — meets all criteria below.
- `needs_design` — must run `/sprint:design` before execution.
- `needs_user_clarification` — has blocking open questions.
- `blocked` — has an unresolved approval or ESD blocker.

Pass criteria (every one must be true):

1. Original request preserved verbatim.
2. Outcome stated separately from proposed implementation.
3. Affected surfaces identified with evidence levels.
4. Current behavior claims labeled with evidence levels.
5. Safe and unsafe assumptions separated.
6. Non-goals stated.
7. External service dependencies checked.
8. Approval boundaries stated.
9. Design requirement decided.
10. Execution mode recommended (not silently invoked).
11. No executable tickets unless explicitly tiny low-risk.
12. Next command stated.
13. Resume instructions written.
14. Tracker updated durably (see Step 9).
15. Crash recovery state recorded (see Step 9).

### Step 9 — Write the Plan Contract

Build a JSON payload matching `schemas/sprint/plan-contract.schema.json`
(except for fields the script fills in: `id`, `created_at`, `updated_at`,
`sprint`, `tracker_paths`, `reports`). Write it to a temp file and run:

```bash
node scripts/sprint/plan.js --payload <tmpfile>
```

The script:

- Generates the Plan Contract id (`PC-YYYYMMDD-NNNN`).
- Writes the YAML under `paths.sprintPlanContracts/`.
- Writes the companion `plan-report.md`.
- Updates `paths.sprintCurrent` (links the Plan Contract, sets
  `current_phase: plan`, `status: planning|designing|ready_for_execution`
  depending on `plan_quality.status` and `design_required`).
- Records the resume command on `crash_recovery.resume_command`.

### Step 10 — Update the progress checkpoint

```bash
node scripts/sprint/checkpoint.js \
  --sprint <sprint-id> \
  --phase plan \
  --command /sprint:plan \
  --status running \
  --last-completed-step "plan_contract_written" \
  --next-action "<next_recommended_command>" \
  --resume-command "<next_recommended_command>" \
  --resume-notes "Plan Contract <PC-id> created. plan_quality=<status>." \
  --safe-to-continue true
```

### Step 11 — Beta consultation (adhoc mode only)

If running in adhoc mode and the plan touches Class B/C decisions per
`paths.decisionPolicy`, consult Beta via SendMessage **before**
presenting the next-recommended-command to the user. Log to
`paths.betaEvents`. Honor `ESCALATE:` returns by prefixing the user
report.

### Step 12 — Surface the result to the user

Report to the user, in this order:

1. `plan_quality.status` (one line).
2. `next_recommended_command` (one line).
3. Top 2 unsafe assumptions, if any.
4. Top 2 blocking open questions, if any.
5. External service dependency status (one line).
6. Resume instructions: where `sprint-progress.yaml` lives + the resume
   command.

Keep it terse. The Plan Contract YAML is the source of truth; the
on-screen summary is a pointer.

## Outputs

| Artifact | Path |
|---|---|
| Plan Contract | `paths.sprintPlanContracts/<PC-id>.yaml` |
| Plan report | `paths.sprintPlanContracts/<PC-id>.report.md` |
| Current sprint | `paths.sprintCurrent` (updated) |
| Progress checkpoint | `paths.sprintProgress` (updated) |
| Frozen checkpoint | `paths.sprintCheckpoints/<sprint>-<n>.yaml` |

## Recovery

If the session crashed mid-`/sprint:plan`:

1. Read `paths.sprintProgress`. The `resume_command` field tells you
   what to run; `resume_notes` summarizes what was last completed.
2. If `safe_to_continue: false`, **investigate** before re-running —
   do not auto-resume. Common causes: a partial Plan Contract write
   or a Beta-escalation that was never surfaced.
3. To re-plan from scratch, run `/sprint:plan` again — the new Plan
   Contract gets a fresh id and supersedes the previous one (sprint
   `plan_contract` pointer is updated; the old contract remains on
   disk for history).

## Relationship to existing modes

`/sprint:plan` is **mode-aware, not mode-dependent**. It runs in solo,
adhoc, and oneshot.

- **Solo:** Alpha runs the plan directly.
- **Adhoc:** Alpha runs the plan and consults Beta on Class B/C calls.
  Gamma is not invoked here.
- **Oneshot:** Allowed but unusual — oneshot is for full skeleton
  rebuilds, not plan formation. Most users invoke `/sprint:plan` from
  solo or adhoc and let `/sprint:execute` choose whether to bring in a
  mode/team later.

Mode invocation stays the user's choice. `recommended_mode` in the
Plan Contract is advisory.

## Approval gates

Plan formation itself is reversible and does NOT require approval.
Approval gates apply downstream:

- `/sprint:design` (only if the plan flagged production-data design risks)
- `/sprint:execute` (only if a ticket trips an `approval_required: true` boundary)
- `/sprint:release` (always — production deploy is user-approved)

## Routing

Per `paths.sprintRouting`:
- `planning.model_class` = `strongest_reasoning`
- `planning.diff_review` = `true`

If a diff-model review is available, the Plan Contract MUST be read by
a second model from a different vendor before `plan_quality.status` is
finalized. If unavailable, log to `paths.decisionLedger` and proceed.

## Routing enforcement

Routing is enforced — not aspirational (SP-20260514-002).

- `scripts/sprint/plan.js` auto-calls `routing.recordTrace({phase: "planning", artifact_id: <pcId>, ...})` after `writePlanContract`. The recording is **fail-open**: a missing policy file, a misconfigured class, or any other error MUST NOT block plan formation.
- The trace lands in `paths.sprintDecisions/routing-trace.jsonl` (schema `mc/sprint/routing-trace/v1`).
- When `paths.sprintRouting#policies.planning.diff_review = true` and no second-vendor reviewer is configured, the trace is recorded with `evidence: single_vendor_session` and a row is appended to `paths.decisionLedger`. Single-vendor users are NOT blocked.
- `scripts/hooks/sprint-routing-guard.js` runs on PreToolUse Edit|Write and (in `block` mode) refuses writes to sprint artifact paths missing a trace row. Default policy `enforcement.mode` is `warn` during soft rollout (until the date in `sprint-routing.json#enforcement.soft_rollout_until`). Flip to `block` after smoke validation.
- To record manually: `node scripts/sprint/routing.js record --phase planning --artifact <PC-id> --sprint <SP-id> --model <provider:model> [--diff-reviewer <provider:model> | --allow-single-vendor]`.

## Sprint Goal Verification (SP-20260518-007)

The Plan Contract carries an optional `goal_verification` block when
the sprint wants to opt into the executable-goal convention. When
present, it records: `origin_evidence`, `bug_classes_closed`,
`reproduction (executable|not_applicable)`, `justification`,
`cited_tests[]`, `fixture_path`. Adding this block at plan-time means
later phases enforce real `verified_by:` linkage at design exit and
run the cited tests at release. Omit the field for legacy/exempt
sprints — the gate is fully gated on its presence. See
`paths.sprintReference#sprint-goal-verification-sp-20260518-007` for
the full convention.

## Reference

Plans must obey `_planning/principle.md` (the canonical planning principles — ground in truth, name an enforcer, prove done, assess blast radius); enforced report-only by `/scan:planning-principles`. Durable plan artifacts persist under `_planning/sprints/` (see `_planning/README.md` for the tracker-linkage convention).

Full sprint workflow doc: `paths.sprintReference`.
Crash recovery procedure: `_docs/sprint/CRASH_RECOVERY.md`.
Framework vs downstream boundary: `_docs/sprint/FRAMEWORK_VS_DOWNSTREAM.md`.
