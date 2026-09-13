---
description: Turn an approved Plan Contract into PRD, stories, COPY, INPUTS, TRACE, acceptance criteria, QA, red-team, release plan — then mint tickets.
user-invocable: true
---

# /sprint:design — Sprint Design

Take a `plan_quality: pass` (or `needs_design`) Plan Contract and turn
it into the requirements bundle and executable tickets.

Tickets are minted **here**, not in `/sprint:plan`. A ticket is the
smallest executable unit — it must link to a granular story, COPY,
INPUTS, TRACE, acceptance criteria, and (if applicable) an external
service dependency.

## Who authors (role routing — the WG-3 rule)

The **product-lead** persona authors the design bundle (PRD, stories,
ACs, COPY/INPUTS/TRACE) and mints the tickets — `/sprint:design` is named
in its registry-owned scope; **req-reviewer verifies** what product-lead
authored (producer ≠ checker). If you are α (or any orchestrator) reading
this skill: **dispatch product-lead** (in-process Agent tool, lean-return
envelope) per artifact group and review envelopes; do NOT hand-author the
PRD/stories/ACs yourself. The ε-conducted `/sprint:full` path (sprint-mode
default since T-297) already routes Phase 2 through the design roster
(product-lead, design-lead, req-reviewer); this rule covers DIRECT
invocations and non-sprint sessions — the historical WG-3 gap where the
skill body silently steered the orchestrator into self-authoring its own
requirements, which then sailed past review because author == reviewer.
Carry provenance in the PRD header (`authored_by:`). Solo-mode exception
as in `/sprint:plan`.
Enforcement: skill-body routing + provenance + req-reviewer's existing
verification gate; the events-based authorship detector is logged
enforcement debt — see `paths.enforcementDebt`.

## When to use

- The Plan Contract for the current sprint is written and is `pass`
  or `needs_design`.
- You need to produce the documentation bundle that lets execution
  start.
- You need to mint tickets for the granular stories.

## Inputs

```text
/sprint:design [--documentation-scale xs|s|m|l|xl] [--force] [--sprint <SP-id>]
```

- `--documentation-scale` defaults to `m`. For xs/s, COPY/INPUTS/TRACE
  and the red-team / release plans may be skipped.
- `--force` overwrites existing requirement files. Default is to
  refuse.
- `--sprint <SP-id>` (v0.2) targets a specific sprint instead of the
  registry primary. Defaults to `paths.sprintActiveRegistry#primary`.
  Unknown id → exit non-zero with COPY C-10.

## Procedure

### Step 1 — Load current sprint + Plan Contract

```bash
node scripts/sprint/design.js --documentation-scale <scale>
```

The script:

- Reads `paths.sprintCurrent` and the linked Plan Contract.
- Renders the templates from `paths.sprintTemplates/requirements/`.
- Writes the bundle to `paths.sprintRequirements/<sprint-id>/`.
- Updates `paths.sprintCurrent.requirements.*` with the new file
  pointers.
- Sets `current_phase: design` and `status: designing`.

### Step 2 — Hand-edit the rendered files

The scaffold gives you the structure. Hand-edit each file to fill in
real content:

- `prd.md` — concrete `R-N` requirements (uses the existing
  `requirement-format-guard.js` id convention).
- `high-level-stories.md` — `H-N` stories with persona/want/outcome.
- `granular-stories.md` — `S-N` stories, each producing roughly one
  ticket.
- `copy.md` — `C-N` blocks of user-visible text.
- `inputs.md` — `IN-N` fields with validation + failure modes.
- `trace.md` — `TR-N` observability hooks linking request →
  requirement → code → test → release → learning.
- `acceptance-criteria.md` — testable Given/When/Then per granular
  story. **For E-LIFECYCLE-001 sprints (and any sprint touching modes /
  teams / dispatch / lifecycle), also carry AC for the 20
  enforcement-criteria categories (S-LC-11, PLAN §11)** — the required
  headings/checklist read from the single source
  `scripts/sprint/ac-categories.js` (do NOT hand-retype the list).
  Audit both axes with `node scripts/sprint/check-ac-coverage.js
  --categories --sprint <SP-id>` (report-only ramp; `--enforce` to block).
- `qa-plan.md` — sprint-scope QA gate.
- `redteam-plan.md` — adversarial review checklist (skipped at xs/s).
- `release-plan.md` — ship-gate checklist (skipped at xs/s).

The legacy marker `<!-- requirement-format-legacy -->` at the top of
each template suppresses the requirement-format-guard while
placeholders are still in place. **Remove the marker once the file is
populated with real `R-N`/`S-N`/`H-N` ids** so the guard catches
malformed ids on subsequent edits.

### Step 3 — Mint tickets from granular stories

For each `S-N` granular story, mint one ticket:

```bash
node scripts/sprint/ticket.js create \
  --title "<short imperative title>" \
  --type <feature|bug|research|design|qa|redteam|refactor|docs|release|chore|trace|copy|input|integration|external_service_setup|approval|checkpoint> \
  --risk <low|medium|high|critical> \
  --linked-story <S-N> \
  --linked-hl <H-N> \
  --linked-prd "<path to prd.md>" \
  --linked-requirements "R-1;R-2" \
  --linked-copy "C-1" \
  --linked-inputs "IN-1" \
  --linked-trace "TR-1" \
  --linked-ac "AC-1.1;AC-1.2" \
  --description "<one-paragraph description>" \
  --status proposed
```

Promote a ticket from `proposed` → `planned` → `designed` →
`ready_for_execution` as the design is fleshed out:

```bash
node scripts/sprint/ticket.js update --id <T-id> --status designed
```

### Step 4 — Mint external service dependencies

For each ESD candidate from the Plan Contract:

```bash
node scripts/sprint/external-service.js create \
  --name "<service>" \
  --category <payment|auth|email|sms|analytics|database|cloud_storage|llm_provider|voice_calling|oauth_app|domain_dns|deployment_host|monitoring_logging|search_indexing|customer_support|marketplace|other> \
  --purpose "<why we need it>" \
  --phase <plan|design|execute|release|any> \
  [--signup] [--billing] [--credentials] [--oauth] [--dns] [--compliance] \
  [--approval-required] \
  [--related-ticket <T-id>]
```

Then add env vars (NAMES only — never values), human setup steps, and
terminal setup steps via `external-service.js update`.

### Step 5 — Mint approvals where required

For any ticket or ESD with `approval_required: true`, mint an approval
record:

```bash
# Plan Contract's approval_boundaries determines what level is needed.
# Manually edit _mc/templates/sprint/approval/approval.yaml.tmpl
# render, OR write the YAML directly under paths.sprintApprovals/.
```

`/sprint:design` does NOT auto-approve. Approval lifecycle goes
`pending` → `approved` | `rejected` | `waived`, recorded with
`decided_by` and `decided_at`.

### Step 6 — Beta review (adhoc mode)

In adhoc mode, send the designed requirements bundle to Beta for
review. Beta is expected to flag:

- missing requirements
- missed edge cases
- overbuild risk
- product fit
- ticket boundaries
- external service assumptions
- approval requirements

Log results to `paths.betaEvents`. Capture any rejected scope as
`needs_user_or_beta_review` in the Plan Contract `assumptions` block.

### Step 7 — Update checkpoint

```bash
node scripts/sprint/checkpoint.js \
  --sprint <sprint-id> \
  --phase design \
  --command /sprint:design \
  --status running \
  --last-completed-step "design_scaffolded_and_tickets_minted" \
  --next-action "Run /sprint:execute on the first ready_for_execution ticket." \
  --resume-command "/sprint:execute" \
  --resume-notes "Design complete at scale=<scale>. N tickets minted." \
  --tickets-updated "<T-id;T-id>" \
  --safe-to-continue true
```

### Step 8 — Surface to user

Tell the user:

1. Requirements bundle path (`paths.sprintRequirements/<sprint-id>/`).
2. Number of tickets minted and their ids.
3. ESDs identified and their statuses.
4. Approval gates that block `/sprint:execute`, if any.
5. Next command: `/sprint:execute`.

## Outputs

| Artifact | Path |
|---|---|
| Requirements bundle | `paths.sprintRequirements/<sprint-id>/*.md` |
| Tickets | `paths.sprintTickets/<T-id>.yaml` |
| ESDs | `paths.sprintExternalServices/<ESD-id>.yaml` |
| Approvals | `paths.sprintApprovals/<AP-id>.yaml` (where required) |
| Current sprint | `paths.sprintCurrent` (updated) |
| Progress checkpoint | `paths.sprintProgress` (updated) |

## Recovery

If interrupted mid-design, read `paths.sprintProgress`. Resume by
re-running `/sprint:design` with the same `--documentation-scale`. The
helper refuses to overwrite existing files unless `--force`, so partial
work is preserved.

If a ticket was created but its linked-requirement was not yet defined,
the ticket lives in `proposed` until the requirement is added.

## Approval gates

`/sprint:design` is reversible — it writes files but does not deploy or
contact external services. No approval needed for the design step
itself.

However, `/sprint:design` will surface required approvals identified in
the Plan Contract. Those approvals must be recorded before
`/sprint:execute` can run dependent tickets (the ESD gate at
`scripts/sprint/external-service.js gate` enforces this).

## Routing

Per `paths.sprintRouting`:
- `design.model_class` = `strong_reasoning`
- `design.diff_review` = `true`

## Routing enforcement

Routing is enforced — not aspirational (SP-20260514-002).

- `scripts/sprint/design.js` auto-calls `routing.recordTrace({phase: "design", artifact_id: "design:<SP-id>", ...})` after rendering the requirements bundle. Fail-open.
- `scripts/hooks/sprint-routing-guard.js` watches `Edit|Write` to `paths.sprintRequirements/<SP-id>/*.md`. In `block` mode it refuses writes when no design-phase trace exists. Default `enforcement.mode` is `warn` during soft rollout.
- Manual record (e.g. you hand-edited templates outside `design.js`): `node scripts/sprint/routing.js record --phase design --artifact design:<SP-id> --sprint <SP-id> --model <provider:model> --allow-single-vendor`.
- Trace location: `paths.sprintDecisions/routing-trace.jsonl`. Coverage check: `node scripts/sprint/routing.js coverage --sprint <SP-id>`.

## Sprint Goal Verification fixture gate (SP-20260518-007)

When the Plan Contract carries `goal_verification.reproduction =
executable`, `scripts/sprint/design.js` runs a post-scaffold gate
after writing the templates: it scans the rendered
`acceptance-criteria.md` and refuses to exit cleanly when any AC
lacks a real `verified_by: <test-file>::<test-name>` (or
`verified_by: not_applicable — <justification>`) line. Placeholders
containing `{{` or `<test-file>` count as missing. Refusal is loud
(stderr lists the offending ACs) and non-state-changing; fix the
linkage and re-run. When `goal_verification` is absent or
`reproduction = not_applicable` with a non-empty justification, the
gate is a no-op (backward-compat with pre-Sprint-A contracts). See
`paths.sprintReference#sprint-goal-verification-sp-20260518-007`.

**20-category coverage (axis 2, S-LC-11).** Separate from the per-AC
`verified_by:` linkage above, lifecycle/mode/team/dispatch sprints must
carry AC for the 20 enforcement-criteria categories (PLAN §11), single-
sourced from `scripts/sprint/ac-categories.js`. This axis is **report-only**
today — `node scripts/sprint/check-ac-coverage.js --categories --sprint
<SP-id>` FLAGS uncovered categories (exit 0) without blocking; `--enforce`
opts into a non-zero exit once the operator flips the ramp.

## Reference

See `paths.sprintReference` and `_docs/sprint/OVERVIEW.md`.
