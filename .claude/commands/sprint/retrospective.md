---
description: Synthesize a post-sprint retrospective from tracker artifacts — outcomes, friction, action items. Idempotent, fail-open, schema-validated.
user-invocable: true
---

# /sprint:retrospective — Sprint Retrospective

Run at the end of a sprint to produce a structured retro that surfaces
wins, misses, friction, and action items. Reads tracker artifacts
(Plan Contract, tickets by bucket, issues, decisions, checkpoints,
release record, sprint-history entry) and writes
`paths.sprintHistory/<sprint-id>/retro.yaml` + `retro.md`. Flips the
sprint's `paths.sprintActiveRegistry` status from `closed` to
`retrospected`.

`/sprint:retrospective` is **reversible** — it writes files but does
not deploy, send, or contact anything external. Synthesis fails open:
if the LLM call fails, the skill writes a `<TO FILL>` skeleton retro
instead and exits `0`.

> Ledger contract — this skill updates the `ROADMAP.md` sprint row to status=retrospected via `scripts/sprint/ledger.js` after the registry transition. See `paths.sprintReference#ledger-discipline` for what qualifies and the fail-open contract.

## When to use

- A sprint has finished `/sprint:release` and its registry status is
  `closed` (or `abandoned`).
- You want a durable analytical record of what shipped, what didn't,
  why, and what to change next sprint.
- Cross-sprint trend analysis (recurring friction, plan-quality drift)
  needs retro YAMLs as its input — `/scan:patterns` will read them
  later (deferred to expanded scope).

`/sprint:retrospective` does **not** run mid-sprint, per-ticket, or as
a learning promoter (`/learn:integrate` still owns that).

## Inputs

```text
/sprint:retrospective [--sprint <SP-id>] [--no-synth] [--force]
                      [--review-only] [--no-plan-contract]
                      [--retry-synth] [--signed-off-by <name>]
```

| Flag | Default | Effect |
|---|---|---|
| `--sprint <SP-id>` | `paths.sprintActiveRegistry#primary` | Target sprint. Must exist in registry or `paths.sprintHistory/`. Unknown id → exit `1` with COPY `C-6`. |
| `--no-synth` | off | Skip the LLM call entirely. Emit a `<TO FILL>` skeleton retro. Always exits `0`. |
| `--force` | off | Overwrite an existing retro. Idempotent w.r.t. registry status. |
| `--review-only` | off | Print the existing retro YAML to stdout. No mutation. Mutually exclusive with `--force`. |
| `--no-plan-contract` | off | Allow retro without a Plan Contract (legacy/imported sprints). `plan_quality_actual` is left as `<unknown — no evidence in tracker>`. |
| `--retry-synth` | off | Re-attempt synthesis on a sprint whose existing retro is in `synthesis_mode: skeleton`. Implies `--force`. |
| `--signed-off-by <name>` | `alpha` | Override the `signed_off_by` field. |

Exit codes (per PRD R-2):

```
0  success (incl. fallback-to-skeleton)
1  validation failure / malformed artifact / unknown sprint
2  bad usage (incl. mutually exclusive flags)
3  sprint not in closed/abandoned state (COPY C-2 + TR-4)
4  retro already exists, --force absent (COPY C-5)
```

Examples:

- `/sprint:retrospective` — retro on the registry primary.
- `/sprint:retrospective --sprint SP-20260512-001` — explicit target.
- `/sprint:retrospective --sprint SP-20260512-001 --no-synth` —
  skeleton only, fill by hand.
- `/sprint:retrospective --sprint SP-20260512-001 --force` —
  regenerate from updated tracker state.
- `/sprint:retrospective --sprint SP-20260512-001 --review-only` —
  print existing retro without regenerating.
- `/sprint:retrospective --sprint SP-20260512-001 --retry-synth` —
  re-attempt synthesis after a prior skeleton fallback.

## Procedure

### Step 1 — Confirm target sprint is `closed` or `abandoned`

```bash
node scripts/sprint/status.js --json | jq '.[] | select(.id=="<SP-id>") | .status'
```

If the value is anything other than `closed`, `abandoned`, or
`retrospected`, stop and run `/sprint:release` first.

### Step 2 — Collect tracker artifacts

The script does this automatically, but for review purposes the inputs
are:

- `paths.sprintCurrent` (per-sprint `current.yaml` — has `plan_contract`)
- `paths.sprintPlanContracts/<PC-id>.yaml`
- `paths.sprintTickets/*.yaml` filtered by `sprint == <SP-id>`
- `paths.sprintIssues/*.yaml` filtered by `sprint == <SP-id>`
- `paths.sprintDecisions/*.yaml` filtered by `sprint == <SP-id>`
- `paths.sprintCheckpoints/<SP-id>-*.yaml`
- `paths.sprintReleases/*.yaml` filtered by `sprint == <SP-id>` (latest by `updated_at`)
- `paths.sprintHistory/<SP-id>/sprint-history.yaml` (if `/sprint:release` archived one)

Missing files produce empty arrays in the retro, not errors —
**except** the Plan Contract, which fails with COPY `C-3` unless
`--no-plan-contract`.

### Step 3 — Synthesize sections (default path)

The skill body invokes the synthesis call. Routing follows
`paths.sprintRouting#policies.retrospective` (added by T-20260513-041,
mirroring the `release` class — `strongest_reasoning` + `diff_review:
true`).

The synthesis prompt:

- Wraps each tracker field in delimiter blocks (e.g.
  `<<<PLAN-CONTRACT-START>>>...<<<PLAN-CONTRACT-END>>>`) so prompt
  injection in any field cannot escape into instructions
  (redteam A-3 defense).
- Instructs the model: **only** synthesize from supplied evidence;
  mark unknown fields with the literal `<unknown — no evidence in
  tracker>`; output structured JSON matching the retro YAML shape.
- Returns the structured JSON via the runProvider pipeline. The skill
  body writes it to a temp file and passes `--synthesis <tmpfile>` to
  the script.

### Step 4 — Operator review

Before signing off, read `retro.md` and amend any sections that the
synthesis got wrong. Synthesis is a draft, not a verdict. The retro
YAML is the source of truth; edit it, not the MD (the MD is
re-rendered on every run).

### Step 5 — Write artifacts (the script's job)

```bash
node scripts/sprint/retrospective.js \
  --sprint <SP-id> \
  --synthesis <tmpfile>      # omitted under --no-synth
```

The script:

1. Validates the merged retro against `sprint-retrospective.schema.json`.
2. Writes `paths.sprintHistory/<SP-id>/retro.yaml` atomically (`.tmp`
   + `rename`).
3. Writes `paths.sprintHistory/<SP-id>/retro.md` from
   `_mc/templates/sprint/retrospective/retro.md.tmpl`.
4. Flips `paths.sprintActiveRegistry#sprints[].status` from `closed`
   → `retrospected` (idempotent on re-run).
5. Emits TR-1 / TR-2 / TR-3 via `paths.loggerLib` for crash recovery
   and cross-sprint trend analysis.
6. Writes a checkpoint via `scripts/sprint/checkpoint.js`.

Validation failure leaves `retro.yaml.partial` on disk for inspection
and exits `1`.

### Step 6 — Sign-off

Default sign-off is `alpha` + current ISO timestamp. Pass
`--signed-off-by <name>` (e.g. `user`) when the user reviews the retro
themselves.

### Step 7 — Surface to user

Print, in this order:

1. Retro paths (YAML + MD).
2. Status transition (`closed → retrospected`).
3. Synthesis mode (`llm` or `skeleton`) + action-items count.
4. Next: review `retro.md` and amend any synthesized sections.

The retro YAML is the source of truth; the on-screen summary is a
pointer.

## Outputs

| Artifact | Path |
|---|---|
| Retro YAML | `paths.sprintHistory/<SP-id>/retro.yaml` |
| Retro MD | `paths.sprintHistory/<SP-id>/retro.md` |
| Partial (on validation fail) | `paths.sprintHistory/<SP-id>/retro.yaml.partial` |
| Active-sprints flip | `paths.sprintActiveRegistry#sprints[].status` → `retrospected` |
| Frozen checkpoint | `paths.sprintCheckpoints/<SP-id>-<n>.yaml` |
| Progress checkpoint | `paths.sprintProgress` (updated) |
| Events | TR-1 `retro_started`, TR-2 `retro_synthesized`, TR-3 `retro_signed_off`, TR-4 `retro_status_transition_blocked` (when applicable) on `paths.eventsFile` |

## Recovery

If the session crashed mid-`/sprint:retrospective`:

1. Read `paths.sprintProgress`. The `resume_command` field tells you
   what to run.
2. Check `paths.sprintHistory/<SP-id>/` — if `retro.yaml` exists, the
   write succeeded; if `retro.yaml.partial` exists, validation failed
   (inspect, fix, re-run).
3. Re-run `/sprint:retrospective --sprint <SP-id> --force` to
   regenerate. The registry flip is idempotent; emitting events twice
   is acceptable.

## Approval gates

None. Retro is reversible — it writes files but does not deploy.
The framework-contract change (adding `retrospected` to the
active-sprints status enum) was approved in `AP-20260513-005` at sprint
plan time.

## Routing

Per `paths.sprintRouting`:

- `retrospective.model_class` = `strong_reasoning`
- `retrospective.diff_review` = `true`

If a diff-model review is available, the retro YAML MUST be read by a
second model from a different vendor before the operator signs off. If
unavailable, log to `paths.decisionLedger` and proceed.

## Routing enforcement

Routing is enforced — not aspirational (SP-20260514-002).

- `scripts/sprint/retrospective.js` auto-calls `routing.recordTrace({phase: "retrospective", artifact_id: "retro:<SP-id>", ...})` after `retro.yaml` is written. Fail-open.
- `scripts/hooks/sprint-routing-guard.js` watches `paths.sprintHistory/<SP-id>/retro.yaml`. In `block` mode it refuses writes when no retro trace exists; default `enforcement.mode` is `warn` during soft rollout.
- Manual record: `node scripts/sprint/routing.js record --phase retrospective --artifact retro:<SP-id> --sprint <SP-id> --model <provider:model> --allow-single-vendor`.
- A retro phase trace is required for a sprint whose registry status flipped to `retrospected` (added to the required set by `routing.classifyRequired(<SP-id>)`).

## Relationship to existing modes

`/sprint:retrospective` is **mode-aware, not mode-dependent**:

- **Solo:** Alpha runs the retro directly.
- **Adhoc:** Alpha runs the retro; Beta is consulted for the synthesis
  pass when the sprint touched Class B/C decisions.
- **Oneshot:** Allowed but unusual — oneshot is for full skeleton
  rebuilds. Retros happen post-skeleton via solo or adhoc.

## Non-Goals

- `/sprint:retrospective` does **not** auto-promote learnings into
  `paths.learningsFile`. `learning_candidates[]` is a hand-off to
  `/learn:integrate`.
- `/sprint:retrospective` does **not** auto-mint tickets in a NEW
  sprint from `action_items[]`. Operators decide what enters the next
  Plan Contract.
- `/sprint:retrospective` does **not** publish externally (Notion,
  Slack, email).
- `/sprint:retrospective` does **not** support mid-sprint check-ins
  (deferred to expanded scope).
- `/sprint:retrospective` does **not** perform cross-sprint trend
  analysis itself (deferred to `/scan:patterns`).

## Reference

- PRD: `.claude/project/sprint/requirements/SP-20260513-004/prd.md`
- Plan Contract: `paths.sprintPlanContracts/PC-20260513-0005.yaml`
- Schema: `schemas/sprint/sprint-retrospective.schema.json`
- Active-sprints schema: `schemas/sprint/active-sprints.schema.json`
  (status enum includes `retrospected`)
- Templates: `_mc/templates/sprint/retrospective/retro.{yaml,md}.tmpl`
- Workflow: `paths.sprintReference` (`sprint-workflow.md`)
- Crash recovery: `_docs/sprint/CRASH_RECOVERY.md`
