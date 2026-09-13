# Sprint Workflow v0.1 — Implementation Plan

This plan is the durable contract for the v0.1 sprint workflow build.
Authored before any sprint code changes land. Companion to `FINDINGS.md`.

Target framework version: **0.4.0** (additive feature release).

---

## Guiding Decisions

1. **Sprint is a workflow layer above modes.** Sprint commands do not
   replace, auto-invoke, or retune `/mode:{solo,adhoc,oneshot}`. Mode
   invocation stays user-controlled.
2. **`/sprint:plan` is approval-aware, not execution.** It produces a
   durable Plan Contract; it never opens tickets except for explicitly
   tiny low-risk work.
3. **Tickets sit below stories, COPY, INPUTS, TRACE, acceptance
   criteria, QA expectations.** `/sprint:design` is the only command
   that mints tickets for non-trivial work.
4. **Framework repo holds templates + schemas + commands + docs.**
   Live tracker state lives in the **downstream product repo** under
   `paths.sprintRoot` (`.claude/project/sprint/`).
5. **Sprint state survives crashes via files, not chat.** Every command
   writes a checkpoint and resume instructions to the tracker.
6. **Sprint tracker is the durable task-truth source.** Team-task
   ownership in `/mode:adhoc` is ephemeral; sprint files outlast it.
7. **Model routing is declarative.** Sprint v0.1 ships a routing policy
   artifact + docs. Actual provider selection continues to flow through
   `runProvider` / `scripts/dispatch-agent.js`. No new SDKs.
8. **Existing requirement-format-guard handles PRD/STORIES/HL/CROSS
   IDs.** `/sprint:design` writes those files; the existing guard
   (Phase 0 workstream J) catches malformed IDs at Edit/Write time.

## Path Registry Changes

Add to `framework/paths.registry.json#paths` (run `scripts/paths/build.js`
afterwards to regenerate `.claude/paths.json`, the generated lib,
path-lint rules, the schema, and `PATH_KEYS.md`):

| key | path | kind | owner | mutable |
|---|---|---|---|---|
| `sprintRoot` | `.claude/project/sprint` | dir | runtime | true |
| `sprintCurrent` | `.claude/project/sprint/current-sprint.yaml` | file (yaml) | runtime | true |
| `sprintProgress` | `.claude/project/sprint/sprint-progress.yaml` | file (yaml) | runtime | true |
| `sprintHistory` | `.claude/project/sprint/history` | dir | runtime | true |
| `sprintPlanContracts` | `.claude/project/sprint/plan-contracts` | dir | runtime | true |
| `sprintTickets` | `.claude/project/sprint/tickets` | dir | runtime | true |
| `sprintIssues` | `.claude/project/sprint/issues` | dir | runtime | true |
| `sprintIssuesLedger` | `issues.md` | md | project | true |
| `sprintExternalServices` | `.claude/project/sprint/external-services` | dir | runtime | true |
| `sprintReleases` | `.claude/project/sprint/releases` | dir | runtime | true |
| `sprintApprovals` | `.claude/project/sprint/approvals` | dir | runtime | true |
| `sprintDecisions` | `.claude/project/sprint/decisions` | dir | runtime | true |
| `sprintRalph` | `.claude/project/sprint/ralph` | dir | runtime | true |
| `sprintCheckpoints` | `.claude/project/sprint/checkpoints` | dir | runtime | true |
| `sprintRequirements` | `.claude/project/sprint/requirements` | dir | runtime | true |
| `sprintTemplates` | `framework/templates/sprint` | dir | framework | false |
| `sprintSchemas` | `schemas/sprint` | dir | framework | false |
| `sprintReference` | `.claude/project/reference/sprint-workflow.md` | md | framework | false |
| `sprintRouting` | `.claude/agents/00-alex/.system/policy/sprint-routing.json` | json | framework | false |

`kind: "file (yaml)"` is rendered as `yaml` in the generator.
All `owner: runtime` entries are downstream-written; they're not seeded
in the framework repo. `sprintIssuesLedger` is `owner: project` because
each downstream team curates it.

## Schemas (`schemas/sprint/*.schema.json`)

JSON-Schema draft-07. Validated by `scripts/sprint/validate.js`.

1. `plan-contract.schema.json` — full Plan Contract structure per
   prompt's minimum schema (id, source_request_verbatim, request_type
   enum, affected_surfaces[].evidence_level enum, scope variants,
   assumptions split, open_questions, non_goals, requirement_areas,
   story candidates, workstream candidates, external_service_dependencies,
   approval_boundaries, plan_quality.status enum, next_recommended_command,
   resume_instructions, tracker_paths, reports).
2. `current-sprint.schema.json` — per prompt's current-sprint schema
   (objective, status, plan_contract pointer, ticket sub-states,
   requirements/checks/approvals/reports/ralph/crash_recovery blocks).
3. `sprint-progress.schema.json` — checkpoint fields per prompt.
4. `ticket.schema.json` — ticket types + statuses + linked_* arrays +
   reopen_history.
5. `issue.schema.json` — structured per-issue file.
6. `external-service-dependency.schema.json` — full ESD record including
   `required_env_vars[].secret: true` and human_setup_steps array.
7. `approval.schema.json` — approval levels + required_for + recorded_by.
8. `release.schema.json` — release artifact.
9. `sprint-history.schema.json` — archive entry per closed sprint.
10. `ralph-progress.schema.json` — current Ralph state + loop count +
    last checkpoint pointer + stop_reason + next_action.

Each schema declares `$id: mc/sprint/<name>/v1` so future bumps are
explicit.

## Templates (`framework/templates/sprint/`)

YAML+MD templates with `{{placeholders}}`. Consumed by
`scripts/sprint/init.js` (downstream init) and the slash commands.

```
framework/templates/sprint/
  README.md                          (template index)
  init/                              (downstream init payload)
    current-sprint.yaml.tmpl
    sprint-progress.yaml.tmpl
    README.md.tmpl                   (lives at .claude/project/sprint/README.md)
  plan-contract/
    plan-contract.yaml.tmpl
    plan-report.md.tmpl
  requirements/
    prd.md.tmpl
    high-level-stories.md.tmpl
    granular-stories.md.tmpl
    copy.md.tmpl
    inputs.md.tmpl
    trace.md.tmpl
    acceptance-criteria.md.tmpl
    qa-plan.md.tmpl
    redteam-plan.md.tmpl
    release-plan.md.tmpl
  ticket/
    ticket.yaml.tmpl
  issue/
    issue.yaml.tmpl
    issues-md-block.md.tmpl
  external-service/
    external-service.yaml.tmpl
    setup-checklist.md.tmpl
  approval/
    approval.yaml.tmpl
  release/
    release.yaml.tmpl
    release-report.md.tmpl
  ralph/
    progress.yaml.tmpl
  checkpoint/
    checkpoint.yaml.tmpl
  history/
    sprint-history.yaml.tmpl
```

Templates use the same `requirement-format-guard.js` ID conventions
(`R-`, `S-`, `H-`, `CS-`) so generated files don't fight the existing
guard.

## Helper Scripts (`scripts/sprint/`)

Single-purpose, dependency-light Node modules.

```
scripts/sprint/
  paths.js              (resolves sprint paths via shared lib/paths.js)
  ids.js                (sprint/ticket/issue/ESD/release id generators)
  fs.js                 (template render + safe-write + yaml stringify)
  validate.js           (loads schemas; validates artifacts against them)
  init.js               (downstream init — creates dir tree from templates)
  plan.js               (Plan Contract generator + plan-quality gate)
  design.js             (PRD/Stories/COPY/INPUTS/TRACE/AC/QA/Release scaffolder + ticket generator)
  execute.js            (Ralph progress writer + checkpoint helper)
  release.js            (release report + readiness checks)
  checkpoint.js         (writes sprint-progress.yaml + ralph progress)
  ticket.js             (create/update/reopen/link)
  issue.js              (create/update/promote-to-ticket + issues.md upkeep)
  external-service.js   (ESD lifecycle)
  routing.js            (loads sprint-routing.json; helper for downstream display)
```

All scripts:
- Read `paths.json` via `scripts/hooks/lib/paths.js`.
- Use `js-yaml` if present; otherwise serialize-out via a tiny embedded
  YAML writer (no new dependency). Framework already uses node-only
  scripts; add a stub fallback rather than a new dep.
- Exit 0 on success, 1 on validation error, 2 on missing prerequisite.
- Emit structured events via `lib/logger.js` (`sprint.plan.created`,
  `sprint.design.scaffolded`, `sprint.execute.checkpoint`,
  `sprint.release.completed`, `sprint.ticket.opened`, etc.).

## Commands (`.claude/commands/sprint/*.md`)

Four user-facing skills (mirror existing skill frontmatter conventions):

```
.claude/commands/sprint/
  plan.md         /sprint:plan
  design.md       /sprint:design
  execute.md      /sprint:execute
  release.md      /sprint:release
```

Each command file:
- Frontmatter: `description:` + `user-invocable: true`.
- "When to use" + "Procedure" sections matching `/mode:*` and `/issues:*` style.
- Procedure delegates to `scripts/sprint/<name>.js` for tracker writes,
  then runs Alpha reasoning over the outputs.
- Each command explicitly documents:
  - inputs (free-text request + optional flags)
  - outputs (which tracker files written; which report written)
  - resume instructions (where to find them on next session)
  - escalation cases (Beta consultation; approval required; ESD blocked)
  - relationship to existing modes (no automatic mode switch)

**No `/sprint:resume` command in v0.1.** Resume behavior is documented
inside each command's "Recovery" section and read off
`paths.sprintProgress`. Avoids command-surface bloat; consistent with
the prompt's guidance.

## Sprint Routing Policy (`paths.sprintRouting`)

New file `.claude/agents/00-alex/.system/policy/sprint-routing.json`,
shape matches the prompt's `sprint_model_routing` recommendation:

```json
{
  "$schema": "mc/sprint-routing/v1",
  "version": 1,
  "comment": "Declarative — runProvider still controls actual selection.",
  "policies": {
    "planning":              { "model_class": "strongest_reasoning", "diff_review": true },
    "plan_contract_review":  { "model_class": "strongest_reasoning", "diff_review": true },
    "design":                { "model_class": "strong_reasoning",    "diff_review": true },
    "execution":             { "model_class": "economical_coder",    "escalate_to": "strong_reasoning" },
    "qa":                    { "model_class": "strong_reviewer",     "diff_review": true },
    "redteam":               { "model_class": "independent_reviewer","diff_review": true },
    "release":               { "model_class": "strongest_reasoning", "diff_review": true },
    "docs_sync":             { "model_class": "economical_writer" },
    "tracker_updates":       { "model_class": "economical_structurer" },
    "trace_updates":         { "model_class": "economical_structurer" },
    "external_service_setup":{ "model_class": "strong_reasoning",    "diff_review": true }
  },
  "model_classes": {
    "strongest_reasoning":   ["claude:claude-opus-4-7", "openai:gpt-5.5"],
    "strong_reasoning":      ["claude:claude-opus-4-7", "gemini:gemini-3.1-pro-preview"],
    "strong_reviewer":       ["openai:gpt-5.5", "claude:claude-sonnet-4-6"],
    "independent_reviewer":  ["gemini:gemini-3.1-pro-preview", "openai:gpt-5.5"],
    "economical_coder":      ["claude:claude-sonnet-4-6", "openai:gpt-5.4-mini"],
    "economical_writer":     ["claude:claude-haiku-4-5-20251001", "openai:gpt-5.4-mini"],
    "economical_structurer": ["claude:claude-haiku-4-5-20251001"]
  },
  "notes": [
    "Diff-model review: any phase with diff_review:true MUST get a second-opinion read from a model in a different vendor row.",
    "If runProvider falls back per provider-fallback.json, the routing intent is preserved by class — actual provider can shift.",
    "No new SDK installs in v0.1 — routing intent is honored by existing dispatch."
  ]
}
```

## Reference Doc (`paths.sprintReference`)

`.claude/project/reference/sprint-workflow.md` — the agent-loaded
canonical doc on how `/sprint:*` commands operate. Auto-loaded by
session-start (we add a one-line reference, no new auto-load mechanism)
and explicitly cited from each `/sprint:*` skill body.

## Public Docs (`_docs/sprint/`)

- `FINDINGS.md` (this PR)
- `IMPLEMENTATION_PLAN.md` (this file)
- `OVERVIEW.md` — sprint workflow overview for humans
- `DOWNSTREAM_ADOPTION.md` — how a product repo adopts sprint v0.1
- `FRAMEWORK_VS_DOWNSTREAM.md` — what lives where
- `CRASH_RECOVERY.md` — resume procedure
- `MODE_RELATIONSHIP.md` — sprint workflow vs modes
- `MODEL_ROUTING.md` — sprint routing policy walkthrough
- `EXTERNAL_SERVICES.md` — signup/credentials/approval flow
- `TICKET_MODEL.md` — sizing, reopening, ticket-vs-task vs ticket-vs-requirement
- `ISSUES_MD.md` — issue ledger semantics
- `RALPH_LOOP.md` — governed plan/act/test/review/record/checkpoint loop
- `FINAL_REPORT.md` — closed at end of build with checklist of what landed

## Test / Validation Strategy

A focused validation script + a small fixture set, not full end-to-end:

- `scripts/sprint/validate.js` — load every `schemas/sprint/*.schema.json`
  and verify it parses. Validate the rendered template stub against the
  schema (render with placeholder values).
- `scripts/test-sprint-init.js` — run `scripts/sprint/init.js` against a
  temp dir; assert dir tree + initial yaml files are valid against their
  schemas.
- `scripts/test-sprint-plan.js` — feed three different plain-language
  inputs into `scripts/sprint/plan.js` and assert Plan Contract:
  preserves verbatim source, includes evidence levels, separates safe
  vs unsafe assumptions, identifies likely external service for at
  least one (`Add Stripe subscriptions`), marks `plan_quality.status`
  correctly.
- `scripts/test-sprint-checkpoint.js` — write + read a checkpoint,
  assert schema validity, assert resume instructions present.
- `scripts/test-sprint-routing.js` — load `sprint-routing.json`,
  assert all `model_class` values referenced in `policies` exist in
  `model_classes`.

Existing tests/checks not broken: `scripts/phase0-verify.js`,
`scripts/paths/gate.js`, `scripts/path-lint.js`,
`scripts/test-dispatch-route-guard.js`,
`scripts/test-dispatch-telemetry.js`,
`scripts/test-provider-health.js`,
`scripts/test-requirement-format-guard.js`.

## Migration / Backward Compatibility

- v0.4.0 is additive. No existing path renames. No command renames.
  No agent renames. No hook removals.
- Downstream repos at v0.3.x: continue working unchanged. To adopt
  sprint v0.1, the consumer runs `node scripts/sprint/init.js`. This
  creates `.claude/project/sprint/` skeleton, drops a starter
  `current-sprint.yaml` (status: `not_started`), drops a starter
  `sprint-progress.yaml` (current_phase: `idle`), and writes a stub
  `issues.md` if one is not already present.
- Existing `_requirements/04-features/<feature>/PRD.md` etc. continue
  to be the canonical home for per-feature requirements. Sprint
  Requirements link to them via `linked_prd:` / `linked_files:`.
- `paths.recurringIssuesFile` (the SYSTEM-recurring-issues jsonl) is
  unrelated — sprint issues are PRODUCT-scope and live in their own dir.

## Framework Manifest + Capsule

After the implementation lands:

1. Bump capsule version to `0.4.0`.
2. Regenerate `.claude/framework-manifest.json` via
   `scripts/generate-framework-manifest.js`. New assets:
   - 4 commands (`.claude/commands/sprint/*.md`)
   - 1 reference doc (`paths.sprintReference`)
   - 1 routing policy (`paths.sprintRouting`)
   - 10 schemas (`schemas/sprint/*`)
   - 11+ template dirs/files (`framework/templates/sprint/**`)
   - 13 helper scripts (`scripts/sprint/*.js`)
   - 1 docs root + 12 docs (`_docs/sprint/*`)
3. Capsule rebuild via existing release tooling — only run on explicit
   release request, NOT inside this Phase 1 build. The build produces
   the source-side bump; release is a separate action.

## Risks and Tradeoffs

- **Risk:** Adding 19 new path keys widens the `paths.json` surface.
  Path-lint and the generated artifacts must regenerate cleanly.
  *Mitigation:* run `scripts/paths/build.js` + `scripts/paths/gate.js`
  + `scripts/path-lint.js` before commit; all five generated files
  ship together.
- **Risk:** Templates with `{{placeholders}}` could fail
  requirement-format-guard at write-time if the guard scans template
  files. *Mitigation:* templates live under `framework/templates/` and
  use placeholders for IDs (e.g. `R-{{n}}`); the guard already
  grandfathers files with the `<!-- requirement-format-legacy -->`
  marker. Add the marker to templates as needed.
- **Risk:** Downstream init script could clobber an existing
  `.claude/project/sprint/` tree. *Mitigation:* init.js refuses to
  overwrite existing files; `--force` is opt-in and prints a confirm
  banner.
- **Risk:** Sprint routing policy proposes provider names not present
  in the consumer's provider list. *Mitigation:* routing is declarative
  by class; `runProvider` already enforces availability. Document the
  fallback chain.
- **Tradeoff:** Yaml-as-yaml without `js-yaml` dependency. We use a
  small embedded serializer that handles strings, numbers, booleans,
  arrays, and objects — no anchors, no multi-doc, no flow style. This
  is enough for tracker files. Reading is via `js-yaml` if installed;
  otherwise the schema is also valid as JSON and downstream tooling can
  consume `.yaml` files as JSON-ish.

## Execution Order (revised from prompt's Phase 2-9)

1. **Path registry** — add 19 keys, run `scripts/paths/build.js`,
   verify with `scripts/paths/gate.js`.
2. **Schemas** — write the 10 `schemas/sprint/*.schema.json`.
3. **Templates** — write template tree.
4. **Helper scripts** — write `scripts/sprint/*.js`.
5. **Routing policy** — write `sprint-routing.json`.
6. **Reference doc** — write `sprint-workflow.md`.
7. **Slash commands** — write 4 `.claude/commands/sprint/*.md`.
8. **Public docs** — write `_docs/sprint/*.md`.
9. **Tests** — write `scripts/test-sprint-*.js`, run all sprint and
   sanity-check existing Phase 0 tests.
10. **Manifest regeneration** — `scripts/generate-framework-manifest.js`,
    bump version field to `0.4.0`.
11. **Capsule** — NOT in this build; release is a separate explicit
    step.
12. **Final report** — write `_docs/sprint/FINAL_REPORT.md`.

Approval gate: only step 11 (capsule release) requires user approval.
Everything else is reversible local file work.

Plan complete. Implementation begins next.
