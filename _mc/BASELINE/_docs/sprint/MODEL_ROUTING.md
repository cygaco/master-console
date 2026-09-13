# Sprint v0.1 — Model Routing

Sprint workflows are multi-phase and have different reasoning needs at
each phase. The routing policy at `paths.sprintRouting`
(`sprint-routing.json`) declares which model class each phase prefers.

## The policy artifact

```json
{
  "policies": {
    "<phase>": {
      "model_class": "<class>",
      "diff_review": true|false,
      "escalate_to": "<class>"   // optional
    }
  },
  "model_classes": {
    "<class>": ["vendor:model", "vendor:model"]
  }
}
```

11 phases. 7 classes.

## Phases

| Phase | model_class | diff_review | Notes |
|---|---|---|---|
| `planning` | strongest_reasoning | true | Plan formation — highest-leverage step. |
| `plan_contract_review` | strongest_reasoning | true | Beta-like judgment over the Plan Contract. |
| `design` | strong_reasoning | true | PRD/STORIES/COPY/INPUTS/TRACE. |
| `execution` | economical_coder | false (escalate_to: strong_reasoning) | Routine ticket work. |
| `qa` | strong_reviewer | true | 13-persona QA scan. |
| `redteam` | independent_reviewer | true | Adversarial — must NOT be the model that wrote the code. |
| `release` | strongest_reasoning | true | Final go/no-go. |
| `docs_sync` | economical_writer | false | After code changes. |
| `tracker_updates` | economical_structurer | false | Status changes, link updates. |
| `trace_updates` | economical_structurer | false | TRACE entries are structured. |
| `external_service_setup` | strong_reasoning | true | ESD records affect billing, approvals, secrets. |

## Classes

| Class | Default providers (highest preference first) |
|---|---|
| strongest_reasoning   | `claude:claude-opus-4-8`, `openai:gpt-5.5` |
| strong_reasoning      | `claude:claude-opus-4-8`, `gemini:gemini-3.1-pro-preview` |
| strong_reviewer       | `openai:gpt-5.5`, `claude:claude-sonnet-4-6` |
| independent_reviewer  | `gemini:gemini-3.1-pro-preview`, `openai:gpt-5.5` |
| economical_coder      | `claude:claude-sonnet-4-6`, `openai:gpt-5.4-mini` |
| economical_writer     | `claude:claude-haiku-4-5-20251001`, `openai:gpt-5.4-mini` |
| economical_structurer | `claude:claude-haiku-4-5-20251001` |

## How routing is honored

Sprint commands read `sprint-routing.json` via
`scripts/sprint/routing.js`. They use the policy to **declare intent**:
"this work prefers strongest_reasoning + a diff review."

Actual provider selection happens downstream in
`scripts/dispatch-agent.js` / `runProvider`. That layer:

- Honors `paths.providerFallbackPolicy` from Phase 0.
- Falls back to peer providers in the same class if the primary is
  unavailable.
- Records the actual provider chosen in `paths.providerTrace`.

So the routing intent is preserved by class even when the actual vendor
shifts.

## Diff-model review

When `diff_review: true`, the sprint command MUST get a second-model
read from a different vendor row before finalizing the artifact.

Example: `/sprint:plan` runs with `planning.diff_review: true`. After
drafting the Plan Contract, the command sends the draft to a second
model (different vendor) and folds in the review notes before writing
the final YAML.

If a second vendor is unavailable:

1. The command logs the unavailability to `paths.decisionLedger`.
2. It proceeds without the diff review.
3. It does NOT silently downgrade — the lack of diff review is
   visible in the trace.

## No override floor

Routing only chooses which model class **drafts** an artifact. It
does NOT override:

- Approval boundaries.
- Safety hooks (dispatch-route-guard, memory-guard, secret-guard,
  framework-manifest-guard).
- Service / security decisions.
- Production deploy authorization.

A cheap model can write a checkpoint or update a tracker file. It
cannot approve a production deploy.

## Cost / token discipline

Sprint workflows are token-sensitive because they're long and
multi-phase. The default routing reserves strongest_reasoning for
planning + plan-contract review + release; everything else is
economical-coder or economical-structurer with class-escalation on
repeated failure.

To audit token spend per sprint:

```bash
# Provider trace records every dispatch (Phase 0).
cat .claude/project/decisions/provider-trace.jsonl | grep <sprint-id>
```

## Customizing the policy

Edit `sprint-routing.json` in the framework repo (or in a downstream
override). Validate:

```bash
node scripts/sprint/routing.js validate
```

The validator checks every `model_class` referenced in `policies`
exists in `model_classes`, and every `escalate_to` exists too.

Downstream override pattern: if a project wants to swap providers,
they can edit their checked-in copy of `sprint-routing.json`. The
canonical version updates on `/warp:update`, but local edits are
preserved (this file is `owner: framework`, `mutable: false`, but the
file watcher hook does not block reads).

## No new SDK installs

Sprint v0.1 explicitly does NOT install new provider SDKs. Routing
**declares preferences**; the existing dispatch layer handles
availability. If a class lists a provider the consumer's repo doesn't
have, runProvider falls back per `paths.providerFallbackPolicy`.

## See also

- `paths.providerFallbackPolicy` — Phase 0 fallback policy.
- `paths.providerTrace` — actual provider chosen per dispatch.
- `paths.decisionLedger` — diff-review unavailability logs.
- `scripts/dispatch-agent.js` — actual dispatch + routing entry point.
