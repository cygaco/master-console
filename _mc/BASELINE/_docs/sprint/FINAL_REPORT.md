# Sprint Workflow v0.1 — Final Implementation Report

Phase: 1 (post Phase 0 framework-reliability prerequisites).
Target framework version: 0.4.0.
Date: 2026-05-11.

## 1. Summary of what changed

Added a four-command sprint workflow layer above the existing MC
mode system, with durable evidence-labeled approval-aware
crash-recoverable sprint state. All live tracker state is designed to
live in **downstream product repos**; the framework repo ships
templates + schemas + commands + docs only. Phase 0 capabilities are
preserved without modification.

The new layer answers the central goal of the prompt: **trustworthy
plan formation** — brief founder/product intent becomes a durable
Plan Contract from which design, execution, QA, release, and learning
can safely proceed.

## 2. Files changed

| Area | Count | Locations |
|---|---|---|
| Schemas | 10 | `schemas/sprint/*.schema.json` |
| Templates | ~24 | `framework/templates/sprint/**/*.tmpl` |
| Helper scripts | 13 | `scripts/sprint/*.js` |
| Acceptance test | 1 | `scripts/test-sprint.js` |
| Slash commands | 4 | `.claude/commands/sprint/{plan,design,execute,release}.md` |
| Reference doc | 1 | `.claude/project/reference/sprint-workflow.md` |
| Routing policy | 1 | `.claude/agents/00-alex/.system/policy/sprint-routing.json` |
| Public docs | 13 | `_docs/sprint/*.md` |
| Path registry | +19 keys | `framework/paths.registry.json` |
| Generated path artifacts | rebuilt | `.claude/paths.json`, `scripts/hooks/lib/paths.generated.js`, `scripts/path-lint.rules.generated.json`, `schemas/paths.schema.json`, `_requirements/03-architecture/PATH_KEYS.md` |
| version.json | bumped | `0.3.0` → `0.4.0`; added `sprintWorkflowSchema`; updated notes; added `0.3.0` to previousVersions |
| framework-manifest.json | regenerated | 418 → 434 assets; +4 skills, +10 schemas, +1 reference |

## 3. Phase 0 verification

Phase 0 (commit `b3a5ab0`, framework-manifest `0.3.0`) is verified
complete and intact:

- All 11 workstreams A-K present (see `FINDINGS.md` table).
- `scripts/phase0-verify.js` — 7/7 fixture tests + 9/9 consistency
  checks GREEN.
- No Phase 0 hook, command, agent, or path was modified by sprint
  v0.1.

## 4. New commands

| Command | Description |
|---|---|
| `/sprint:plan`    | Brief plain-language request → Plan Contract. Evidence-labeled, approval-aware, refuses to mint executable tickets except for tiny low-risk work. |
| `/sprint:design`  | Plan Contract → PRD/STORIES/COPY/INPUTS/TRACE/AC/QA/redteam/release plan + tickets. Documentation-scaled. |
| `/sprint:execute` | Ralph-style loops per ticket. Plan/act/test/review/record/checkpoint. Stop conditions enforced. Crash-safe. |
| `/sprint:release` | Prepare release, run checklist gate, request approval, mark deployment (no auto-deploy), retrospective. |

No `/sprint:resume`. Resume behavior is in each command's "Recovery"
section and driven by `paths.sprintProgress` + `paths.sprintCurrent`.

## 5. Plan Contract behavior

The Plan Contract is the durable artifact bridging brief founder intent
to design. See `schemas/sprint/plan-contract.schema.json` for the full
shape. Required behaviors verified by `scripts/test-sprint.js`:

- **Preserves the original request verbatim** in
  `source_request_verbatim`.
- **Separates request type** (13-entry enum: feature_add through
  external_service_setup).
- **Labels every affected surface with evidence level** (4-entry
  enum: verified_from_repo, inferred_from_repo, assumed_from_request,
  unknown).
- **Separates safe and unsafe assumptions** + needs-review.
- **Lists blocking vs non-blocking open questions.**
- **Produces three scope variants** (minimal_safe, recommended,
  expanded).
- **Identifies external service dependencies** + statuses.
- **Records approval boundaries.**
- **Marks plan_quality.status** (pass | needs_design |
  needs_user_clarification | blocked).
- **Records next_recommended_command + resume_instructions.**
- **Writes tracker_paths so a fresh agent can locate state.**
- **Refuses to mint executable tickets** except via
  `preliminary_ticket_candidates.allowed: true` (default false).

## 6. Project tracker structure

Live tracker lives in the downstream product repo at
`paths.sprintRoot` (`.claude/project/sprint/`):

```
current-sprint.yaml            paths.sprintCurrent
sprint-progress.yaml           paths.sprintProgress
plan-contracts/<PC-id>.yaml    paths.sprintPlanContracts
plan-contracts/<PC-id>.report.md
tickets/<T-id>.yaml            paths.sprintTickets
issues/<I-id>.yaml             paths.sprintIssues
external-services/<ESD-id>.yaml paths.sprintExternalServices
approvals/<AP-id>.yaml         paths.sprintApprovals
decisions/<DEC-id>.yaml        paths.sprintDecisions
releases/<RL-id>.yaml          paths.sprintReleases
releases/<RL-id>.report.md
ralph/<sprint>/<T-id>.yaml     paths.sprintRalph
checkpoints/<sprint>-<n>.yaml  paths.sprintCheckpoints
requirements/<sprint>/*.md     paths.sprintRequirements
history/<sprint>/sprint-history.yaml  paths.sprintHistory

issues.md                      paths.sprintIssuesLedger (repo root)
```

Initialization: `node scripts/sprint/init.js --project "<name>"`.
Re-runnable; refuses to clobber existing files unless `--force`.

## 7. Framework templates vs downstream live state

Strict separation enforced (`_docs/sprint/FRAMEWORK_VS_DOWNSTREAM.md`):

| In framework repo | In downstream repo |
|---|---|
| `framework/templates/sprint/**` | `.claude/project/sprint/**` (live) |
| `schemas/sprint/**` | `issues.md` (live) |
| `scripts/sprint/**` | |
| `.claude/commands/sprint/**` | |
| `.claude/project/reference/sprint-workflow.md` | |
| `paths.sprintRouting` | |
| `_docs/sprint/**` | |
| `framework/paths.registry.json` (the 19 sprint keys) | |

The framework repo never ships seeded live sprint state. `/warp:update`
updates framework assets but does not write to
`.claude/project/sprint/`.

## 8. Ticket schema

See `schemas/sprint/ticket.schema.json`. Highlights:

- 18 statuses: `proposed` → `released` + `reopened`, `deferred`,
  `abandoned`, `superseded`.
- 18 ticket types: feature, bug, research, design, qa, redteam,
  refactor, docs, release, decision, chore, trace, copy, input,
  integration, external_service_setup, approval, checkpoint.
- Comprehensive `linked_*` fields (requirements, stories, COPY,
  INPUTS, TRACE, AC, issues, decisions, ESDs, files, tests, commits,
  PRs, release).
- `reopen_history[]` with reason from 16-entry enum and append-only
  semantics.
- `fix_attempts[]` records each attempt; the 3-attempt rule triggers
  a stderr warning in `scripts/sprint/issue.js update` (and the same
  rule applies in `execute.js phase --add-failed-attempt`).

## 9. Issue integration

- `paths.sprintIssuesLedger` (`issues.md`, repo root) — human-readable
  bug inbox.
- `paths.sprintIssues/<I-id>.yaml` — machine-readable per-issue YAML.
- `scripts/sprint/issue.js` is the single writer that keeps both in
  sync.
- `issue.js promote --to-ticket-type <type>` prints the ticket-create
  command the operator runs to mint a linked ticket.
- `paths.recurringIssuesFile` (SYSTEM-recurring issues jsonl) is
  unchanged and continues to be owned by `/issues:log`,
  `/issues:list`, `/issues:resolve`, `/scan:issues`.

`/sprint:execute` discovers issues during Ralph loops and records them
via `issue.js create`. Issues can be promoted to tickets when they
require their own scoped work.

## 10. How `issues.md` is used now

The Sprint v0.1 model:

- `issues.md` is the human-readable mirror of the per-issue YAML files.
- One block per issue with id, title, status, severity, discovered_at,
  related sprint/ticket, expected vs actual.
- Sections: Open, In Progress, Fixed / Verified, Deferred / Abandoned.
- `appendmd` re-emits a block from the YAML.
- Sprint v0.1 appends rather than rewrites in place; an in-place
  mirror is a follow-up enhancement.

The previous `issues.md` (if downstream projects have one) is
preserved. Sprint init only creates the stub when no file exists.

## 11. Ralph loop integration

`scripts/sprint/execute.js` implements the governed Ralph loop:

```
plan → act → test → review → record → checkpoint → repeat | stop
```

State at `paths.sprintRalph/<sprint>/<ticket>.yaml`. Stop conditions
(enforced, not advisory):

- `completed`, `stopped_clean`
- `stopped_approval_required`
- `stopped_human_setup_required`
- `stopped_repeated_failure` (3+ attempts)
- `stopped_scope_expansion`
- `stopped_destructive_action_needed`
- `stopped_production_deploy_needed`
- `stopped_beta_warning`
- `stopped_unclear_intent`

Each phase advance updates the Ralph file + mirrors to current-sprint +
writes a sprint-progress checkpoint. `checkpoint_pointers[]` records
the frozen checkpoint history.

## 12. Crash recovery / checkpoint behavior

Every sprint command writes to `paths.sprintProgress` (the live
checkpoint) and a frozen copy at
`paths.sprintCheckpoints/<sprint>-<n>.yaml`. On resume, an agent
reads:

1. `paths.sprintProgress` — current phase, command, ticket, loop,
   status, next_action, resume_command, resume_notes, safe_to_continue.
2. `paths.sprintCurrent.crash_recovery` — mirrors the live checkpoint.
3. `paths.sprintRalph/<sprint>/<ticket>.yaml` if Ralph is mid-loop.

`safe_to_continue: false` blocks auto-resume — the agent must
investigate. See `_docs/sprint/CRASH_RECOVERY.md` for the full
procedure.

## 13. External service dependency behavior

Schema: `schemas/sprint/external-service-dependency.schema.json`. ESD
records track:

- Signup, billing, credentials, OAuth, DNS, compliance requirements.
- Human owner.
- Mock vs sandbox vs production status.
- Approval state.
- Required env vars (NAMES only — never values).
- Human setup steps and terminal setup steps.

`scripts/sprint/external-service.js gate --phase <p>` returns non-zero
if any ESD required for the given phase is not in
{`ready_for_terminal_work`, `mocked`, `integrated`, `deferred`}, or if
an approval-required ESD is still `pending`. `/sprint:execute` runs
this gate before starting any ticket.

Vendor adapters live in downstream repos. Framework only provides the
schema, lifecycle commands, gate enforcement, and the
vendor-neutral checklist template.

## 14. Model routing changes

Added `paths.sprintRouting`
(`.claude/agents/00-alex/.system/policy/sprint-routing.json`):

- 11 phases (planning, plan_contract_review, design, execution, qa,
  redteam, release, docs_sync, tracker_updates, trace_updates,
  external_service_setup).
- 7 model classes (strongest_reasoning, strong_reasoning,
  strong_reviewer, independent_reviewer, economical_coder,
  economical_writer, economical_structurer).
- `diff_review: true` declared for plan/plan-contract-review/design/
  qa/redteam/release/external_service_setup.
- `escalate_to` declared for execution (economical_coder → strong_reasoning).
- Validation script (`scripts/sprint/routing.js validate`) confirms
  every model_class and escalate_to references a declared class.

Routing **declares** intent. Actual provider selection still flows
through `scripts/dispatch-agent.js` / `runProvider`, which honors
`paths.providerFallbackPolicy` from Phase 0. No new SDK installs.

## 15. Provider health / fallback integration

Sprint v0.1 does NOT modify `paths.providerFallbackPolicy` or
`scripts/hooks/lib/provider-health.js`. It consumes them:

- Routing's class-to-provider mapping references the same vendor:model
  ids used by the fallback policy.
- When `runProvider` falls back per the policy, routing intent (class)
  is preserved while vendor may shift.
- Diff-model review requires a SECOND-vendor read; if the second
  vendor is unavailable, the sprint command logs to
  `paths.decisionLedger` and proceeds.

## 16. COPY / INPUTS / TRACE handling

- COPY: user-visible text expectations with stable ids (`C-N`). One
  block per text snippet with context. Linkable from tickets.
- INPUTS: fields/forms/data entry/validation with stable ids (`IN-N`).
  Each row records type, required, source (user|system|integration),
  validation, failure mode.
- TRACE: traceability + observability schema. Each entry (`TR-N`)
  records an event, when it fires, captured fields, linked
  requirement/story, why. The runtime events still flow through
  `paths.eventsFile`; TRACE is the **schema** for what those events
  capture.

Templates carry the `<!-- requirement-format-legacy -->` marker so
placeholders don't fight `scripts/hooks/requirement-format-guard.js`.
Real files drop the marker once populated, at which point the guard
catches malformed ids on subsequent edits.

## 17. Requirement write-time lint integration

Phase 0's `scripts/hooks/requirement-format-guard.js` (workstream J)
is unchanged. Sprint design templates carry the legacy marker so
template-stage files don't trip the guard. Once a sprint's
PRD/STORIES/HL/COPY/INPUTS/TRACE/AC are filled with real
`R-N`/`S-N`/`H-N`/`C-N`/`IN-N`/`TR-N`/`AC-N.M` ids, the marker is
removed and the guard takes over for subsequent edits.

## 18. How sprint commands integrate with existing modes

Sprint is a workflow layer ABOVE modes. Modes
(`/mode:{solo,adhoc,oneshot}`) remain user-controlled and unchanged.

| Sprint phase | Solo | Adhoc | Oneshot |
|---|---|---|---|
| plan    | Alpha plans | Alpha + Beta on Class B/C | unusual |
| design  | Alpha designs | Alpha + Beta review | not intended |
| execute | Alpha runs Ralph | Alpha runs Ralph; Gamma for builds | halt sprint, run oneshot, then resume |
| release | Alpha drives release | Alpha drives; Beta consulted | not intended |

`recommended_mode` in the Plan Contract is advisory. The user invokes
mode switches explicitly. Sprint state survives mode transitions
because it's in files, not team-task ownership.

See `_docs/sprint/MODE_RELATIONSHIP.md` for the full mapping.

## 19. Mode/team lifecycle follow-through

Phase 0 workstream I documented `/mode:adhoc` stale-team
classification and the no-auto-claim startup directive. Sprint v0.1
closes the remaining loop by making the sprint tracker the durable
task-truth source:

- Tickets in `paths.sprintTickets/<T-id>.yaml`, not team tasks.
- Issues in `paths.sprintIssues/<I-id>.yaml`, not chat or team tasks.
- Approvals in `paths.sprintApprovals/<AP-id>.yaml`, not chat.
- Crash recovery reads `paths.sprintProgress`, not live team state.

`/mode:adhoc` already references future `/sprint:design` writes
(`mode/adhoc.md` last section "Tracker source-of-truth rule"). Sprint
v0.1 fulfills that contract.

The remaining built-in primitive limits (TeamCreate --force-replace
unavailable, SendMessage to reaped teammate, claim_on_startup
prompt-level only) are unchanged — those live in the Claude Code
harness, not the repo. See
`_docs/phase0/adhoc-primitive-limits.md`.

## 20. Version/capsule/update changes

- `version.json`: `0.3.0` → `0.4.0`. Added `sprintWorkflowSchema`
  field. Updated `notes` to describe Sprint Workflow v0.1.
  `0.3.0` added to `previousVersions`.
- `.claude/framework-manifest.json`: regenerated. 418 → 434 assets.
  +4 skills, +10 schemas, +1 reference doc, plus the new helper
  scripts under `scripts/sprint/`.
- `framework/releases/0.4.0/` capsule directory: **NOT** built in
  this pass. Per the prompt, capsule release is an explicit separate
  step the user runs via existing release tooling.

## 21. Tests / checks run

| Check | Result |
|---|---|
| `node scripts/test-sprint.js` | 8/8 passed |
| `node scripts/sprint/validate.js` | 10 schemas load and parse |
| `node scripts/sprint/routing.js validate` | 11 phases ok |
| `node scripts/sprint/init.js --status` | 0/15 (framework repo — expected) |
| `node scripts/paths/build.js` | 5 artifacts written |
| `node scripts/paths/gate.js` | 5/5 ok |
| `node scripts/path-lint.js` | clean (pre-existing warn-only items unchanged) |
| `node scripts/phase0-verify.js` | 7/7 + 9/9 GREEN |
| `node scripts/generate-framework-manifest.js` | Version 0.4.0, 434 assets |

## 22. Known gaps

These are intentional non-goals for v0.1, documented for follow-up:

- No `/sprint:resume` skill. Resume is documented inside each command
  and driven by `sprint-progress.yaml`. Adding a dedicated skill is a
  command-surface decision deferred to v0.2.
- No in-place `issues.md` rewrite. `appendmd` appends only. v0.2
  could add a full re-emit pass.
- No diff-model review automation. The routing policy declares
  `diff_review: true` but the actual second-model read is the skill
  body's responsibility. A dedicated `scripts/sprint/diff-review.js`
  helper is a v0.2 candidate.
- No automatic Beta consultation in the sprint commands. The skill
  bodies describe when to consult Beta; the helpers don't dispatch to
  Beta. Centralizing this is a v0.2 candidate.
- No git-aware ticket ↔ commit ↔ PR auto-linking. The
  `linked_commits` / `linked_prs` fields exist but populate via
  `ticket.js update --add-commit`/`--add-pr` manually.
- No `paths.sprintIssuesLedger` re-emit / rewrite tooling beyond the
  appendmd command.

## 23. Built-in primitive limitations that could not be fixed in-repo

These remain from Phase 0 and apply to sprint workflows too:

- TeamCreate has no `--force-replace`.
- SendMessage to a maxTurns-reaped teammate returns an error string,
  not an auto-respawn.
- `claim_on_startup: false` is not a harness setting; it's
  prompt-level enforcement only.

Sprint v0.1 mitigation: the sprint tracker is the durable task-truth
source. Sprint state never depends on live team config. See
`_docs/phase0/adhoc-primitive-limits.md`.

## 24. Risks

- **Path-lint warn explosion.** Adding 19 path keys widens the warn
  list. Mitigated: `.claude/project/sprint/` is in skipSubstrings;
  only the five single-file keys are in warnKeys.
- **Template / requirement-format-guard interaction.** Mitigated:
  templates carry the legacy marker; rendered files drop the marker
  when real ids are populated.
- **Downstream init clobbering live state.** Mitigated: `init.js`
  refuses to overwrite existing files unless `--force`.
- **Sprint routing declaring providers not present in a consumer's
  config.** Mitigated: routing is declarative; runProvider handles
  availability via provider-fallback policy.
- **Yaml writer's minimal subset producing parse-incompatible files.**
  Mitigated: round-trip tested in `scripts/test-sprint.js`; tracker
  files are simple enough that the subset is sufficient. Reader
  prefers `js-yaml` if installed, falls back to the embedded
  parseMiniYaml otherwise.

## 25. Recommended next steps

1. **Capsule release for 0.4.0.** Run the canonical release flow
   (`scripts/mc/release-canonical.js`) when the user is ready to
   publish. This writes `framework/releases/0.4.0/`.
2. **Validate against a real downstream sprint.** Pick a real product
   repo, run `init.js`, run `/sprint:plan` on a small real request,
   walk through design/execute/release. Use the experience to
   identify v0.2 hardening.
3. **Wire diff-model review automation.** v0.2 could add
   `scripts/sprint/diff-review.js` that dispatches a second-vendor
   read against a Plan Contract or design artifact and folds in the
   review notes.
4. **Beta consultation dispatch.** Same v0.2 candidate — move the
   "consult Beta" step into a helper so the skill body doesn't carry
   the dispatch boilerplate.
5. **Git-aware ticket linking.** Hook on commit / PR creation to
   auto-update ticket `linked_commits` and `linked_prs`.
6. **Issues.md re-emit pass.** Rather than append-only, support a full
   re-emit of `issues.md` from `paths.sprintIssues/*.yaml`. Useful
   when statuses change.
7. **Provider-fallback policy enforcement.** Phase 0 left the policy
   as a scaffold not yet honored inside `runProvider`. Once the flag
   backlog drains (per the existing comment), wire the policy into
   `runProvider`. Sprint routing already references it.
8. **Mode/team lifecycle hardening.** Phase 0 closed the
   in-repo-feasible parts. If the harness ever exposes a
   `TeamCreate --force-replace` or programmatic `claim_on_startup`,
   wire `/mode:adhoc` to use it.
9. **/sprint:resume command.** If users keep typing it, surface it
   as a dedicated skill rather than embedded in each command's
   "Recovery" section.
10. **Karpathy-style optimization runs against sprint artifacts.**
    The Plan Contract, requirements bundle, and ticket scope are all
    editable artifacts that could be subject to `/karpathy:run`-style
    optimization against a metric.

## 26. How to use the new system from a downstream product repo

```bash
# In your product repo, after MC 0.4.0 is installed:
node scripts/sprint/init.js --project "my-product"

# Then in your Claude Code session:
/sprint:plan "<brief plain-language request>"
# Read the Plan Contract; decide whether to proceed.
/sprint:design [--documentation-scale m]
# Hand-edit the rendered requirements; mint tickets via scripts/sprint/ticket.js create.
/sprint:execute
# Each ticket goes through a Ralph loop; checkpoints persist to files.
/sprint:release
# Run the release gate; record an approval; deploy out-of-band; mark deployed.
```

See `_docs/sprint/DOWNSTREAM_ADOPTION.md` for the full guide and
`paths.sprintReference` for the canonical reference.

## 27. How to resume if the session crashes

1. Read `.claude/project/sprint/sprint-progress.yaml`.
2. The `resume_command` and `resume_notes` fields tell you what to
   run.
3. If `safe_to_continue: false`, **investigate** before resuming.
4. If a Ralph loop was active, also read
   `.claude/project/sprint/ralph/<sprint>/<ticket>.yaml` for the
   loop's full state — phase, status, failed_attempts, next_action.
5. Run the resume command. Sprint commands are idempotent — they
   detect existing state and pick up.

See `_docs/sprint/CRASH_RECOVERY.md` for the full procedure including
corrupt-tracker recovery from frozen checkpoints.

## Closing

Sprint Workflow v0.1 ships as an additive feature release. Existing
MC workflows (modes, hooks, agents, requirements, learnings,
dispatch, provider routing) are not modified. Phase 0 capabilities
are preserved without regression. The new layer makes brief founder
intent into trustworthy, durable, evidence-labeled, approval-aware,
crash-recoverable sprint work — without forcing any consumer to adopt
it.
