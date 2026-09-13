# MC 0.4.0 — Sprint Workflow v0.1

Released: 2026-05-11

Phase 1 of the Sprint Workflow initiative. Adds a four-command product
workflow layer above the existing modes, with durable, evidence-labeled,
approval-aware, crash-recoverable sprint state.

## Added

### Commands (4)

- `/sprint:plan` — brief intent → Plan Contract.
- `/sprint:design` — Plan Contract → requirements bundle + tickets.
- `/sprint:execute` — Ralph-style loops per ticket, crash-safe.
- `/sprint:release` — release record, approval gate, deploy mark,
  retrospective.

### Schemas (10)

Under `schemas/sprint/`:

- `plan-contract.schema.json` (`mc/sprint/plan-contract/v1`)
- `current-sprint.schema.json` (`mc/sprint/current-sprint/v1`)
- `sprint-progress.schema.json` (`mc/sprint/sprint-progress/v1`)
- `ticket.schema.json` (`mc/sprint/ticket/v1`)
- `issue.schema.json` (`mc/sprint/issue/v1`)
- `external-service-dependency.schema.json` (`mc/sprint/external-service-dependency/v1`)
- `approval.schema.json` (`mc/sprint/approval/v1`)
- `release.schema.json` (`mc/sprint/release/v1`)
- `sprint-history.schema.json` (`mc/sprint/sprint-history/v1`)
- `ralph-progress.schema.json` (`mc/sprint/ralph-progress/v1`)

### Templates (~24 files)

Under `framework/templates/sprint/`:

- `init/{current-sprint,sprint-progress}.yaml.tmpl`, `README.md.tmpl`,
  `issues.md.tmpl`
- `plan-contract/{plan-contract.yaml,plan-report.md}.tmpl`
- `requirements/{prd,high-level-stories,granular-stories,copy,inputs,trace,acceptance-criteria,qa-plan,redteam-plan,release-plan}.md.tmpl`
- `ticket/ticket.yaml.tmpl`
- `issue/{issue.yaml,issues-md-block.md}.tmpl`
- `external-service/{external-service.yaml,setup-checklist.md}.tmpl`
- `approval/approval.yaml.tmpl`
- `release/{release.yaml,release-report.md}.tmpl`
- `ralph/progress.yaml.tmpl`
- `checkpoint/checkpoint.yaml.tmpl`
- `history/sprint-history.yaml.tmpl`

### Helper scripts (13)

Under `scripts/sprint/`:

- `paths.js`, `ids.js`, `fs.js` (shared)
- `validate.js` (schema loader/validator, JSON-Schema draft-07 subset)
- `init.js` (downstream init — creates the tracker tree from templates)
- `plan.js` (Plan Contract writer; updates current-sprint)
- `design.js` (requirements bundle scaffolder)
- `ticket.js` (create/update/reopen/show/list)
- `issue.js` (create/update/promote/appendmd/list — keeps issues.md in sync)
- `external-service.js` (create/update/list/show/gate)
- `execute.js` (Ralph loop start/phase/stop/show)
- `release.js` (prepare/check/approve/deploy/rollback/report/show/list)
- `checkpoint.js` (sprint-progress writer + frozen checkpoint)
- `routing.js` (sprint-routing.json loader/validator)

### Acceptance test

- `scripts/test-sprint.js` — 8 tests: schemas load, routing validates,
  init creates tree, plan/checkpoint/ticket/issue/ESD writers produce
  schema-valid artifacts. All-green.

### Reference + policy

- `.claude/project/reference/sprint-workflow.md` (`paths.sprintReference`)
  — canonical agent-loaded doc.
- `.claude/agents/00-alex/.system/policy/sprint-routing.json`
  (`paths.sprintRouting`) — declarative routing for 11 sprint phases
  across 7 model classes.

### Public docs (10)

Under `_docs/sprint/`:

- `FINDINGS.md`
- `IMPLEMENTATION_PLAN.md`
- `OVERVIEW.md`
- `FRAMEWORK_VS_DOWNSTREAM.md`
- `DOWNSTREAM_ADOPTION.md`
- `CRASH_RECOVERY.md`
- `MODE_RELATIONSHIP.md`
- `MODEL_ROUTING.md`
- `EXTERNAL_SERVICES.md`
- `TICKET_MODEL.md`
- `ISSUES_MD.md`
- `RALPH_LOOP.md`
- `CHANGELOG_0.4.0.md` (this file)
- `FINAL_REPORT.md`

### Path registry (19 new keys)

In `framework/paths.registry.json`:

- `sprintRoot`
- `sprintCurrent` (warn-listed)
- `sprintProgress` (warn-listed)
- `sprintHistory`
- `sprintPlanContracts`
- `sprintTickets`
- `sprintIssues`
- `sprintIssuesLedger` (warn-listed)
- `sprintExternalServices`
- `sprintReleases`
- `sprintApprovals`
- `sprintDecisions`
- `sprintRalph`
- `sprintCheckpoints`
- `sprintRequirements`
- `sprintTemplates`
- `sprintSchemas`
- `sprintReference` (warn-listed)
- `sprintRouting` (warn-listed)

All `owner: runtime|project|framework` per their semantics. Added
`yaml` as a recognized `kind`. Added `.claude/project/sprint/` to
`skipSubstrings` so path-lint doesn't fire on tracker files.

## Changed

- `version.json` → `0.4.0`. Added `sprintWorkflowSchema` key.
- `.claude/framework-manifest.json` regenerated. Total: 418 → 434.
- `framework/paths.registry.json` — added 19 `sprint*` keys, the
  `yaml` kind, the new warn-keys, the new skipSubstrings line.
- All 5 path-registry generated artifacts (`.claude/paths.json`,
  `scripts/hooks/lib/paths.generated.js`,
  `scripts/path-lint.rules.generated.json`,
  `schemas/paths.schema.json`,
  `_requirements/03-architecture/PATH_KEYS.md`) rebuilt via
  `scripts/paths/build.js`.

## Not changed (verified)

- Existing modes (`/mode:solo`, `/mode:adhoc`, `/mode:oneshot`) —
  zero edits.
- Existing agents (`alpha`, `beta`, `gamma`, `delta`, build-chain) —
  zero edits.
- Existing hooks — zero edits. No new hooks added in Phase 1.
- Phase 0 verification (`scripts/phase0-verify.js`) — still 7/7 + 9/9
  GREEN.
- Path-lint, `paths/gate.js` — still all green.
- `paths.providerFallbackPolicy` — unchanged. Sprint routing
  references it but does not modify it.
- `paths.recurringIssuesFile` and the `/issues:*` skills — unchanged.
  Sprint product issues live in distinct `paths.sprintIssues`.
- `_requirements/04-features/<feature>/PRD.md` — unchanged. Sprint
  requirements link to per-feature PRDs there.
- Capsule release tooling (`scripts/mc/release-canonical.js`) —
  unchanged. Capsule build for 0.4.0 is a separate explicit step.

## Migration

Downstream repos on 0.3.x updating to 0.4.0:

1. Run `/mc:update --apply`. Framework sprint assets land.
2. Optional: `node scripts/sprint/init.js --project "<name>"` to opt
   in to the sprint workflow. This creates
   `.claude/project/sprint/` + `issues.md`.
3. Existing workflows (`/mode:*`, `/issues:*`, `_requirements/`,
   `paths.recurringIssuesFile`) continue to work unchanged.

Opting out: stop running `/sprint:*` commands. Tracker files freeze;
nothing else is affected. Re-pinning to 0.3.x via `/mc:update --to
0.3.0` removes the sprint paths cleanly.

## Known gaps (intentional)

These are explicit non-goals for v0.1:

- No `/sprint:resume` command. Resume behavior is documented inside
  each command and driven by `sprint-progress.yaml`.
- No automatic mode invocation. Plan Contract `recommended_mode` is
  advisory.
- No automated production deploys. `/sprint:release deploy` only marks
  a deployment performed out-of-band.
- No Linear / Jira / GitHub Issues sync. Local files are the source
  of truth.
- No new provider SDK installs. Routing declares intent; existing
  dispatch enforces availability.
- `/mode:oneshot` not retuned (out of scope per the prompt).
- ESD vendor adapters live in downstream repos, not the framework.
- Sprint tracker state is NOT seeded in the framework repo on
  install. Downstream init is opt-in.

## Built-in primitive limits (carried forward)

Phase 0's adhoc-primitive-limits inventory (`_docs/phase0/adhoc-primitive-limits.md`)
applies. Sprint v0.1's mitigation: the sprint tracker is the durable
task-truth source. Team-task ownership in adhoc remains ephemeral.

## Capsule build

The framework version bumps to 0.4.0 in `version.json` and
`.claude/framework-manifest.json`. The capsule (`framework/releases/0.4.0/`)
is NOT built in this pass — that's an explicit release step the user
runs separately via the existing release tooling.

## Verification

- `node scripts/test-sprint.js` — 8/8 passed.
- `node scripts/test-sprint-hooks.js` — 12/12 passed.
- `node scripts/paths/gate.js` — 5/5 ok.
- `node scripts/path-lint.js` — clean (pre-existing warn-only items
  unchanged).
- `node scripts/phase0-verify.js` — 7/7 + 9/9 GREEN.
- `node scripts/sprint/validate.js` — 10 schemas load and parse.
- `node scripts/sprint/routing.js validate` — 11 phases ok.
- `node scripts/mc/release-build.js 0.4.0 --check` — capsule
  verified (4 files, all checksums match).
- `node scripts/mc/release-gates.js` — 11 GRN / 1 YEL / 1 RED /
  1 MAN. Both YEL/RED are pre-existing (runtime-leak from prior
  commits; Phase 5G placeholder). All Sprint v0.1 + Phase 0 gates
  green.
- `install.ps1 -DryRun -SkipPrompt` — installer parses cleanly under
  Windows PowerShell 5.1, reports `MC 0.4.0 installer`,
  enumerates 441 assets.

## Release capsule

`framework/releases/0.4.0/`:

- `release.json` — schema `mc/release/v1`. `minUpgradeableFrom:
  "0.2.2"` (skips the source-only 0.3.0; consumers never got a 0.3.0
  capsule). `migrations: []` (additive). `postUpdateChecks` runs
  paths/build, paths/gate, hooks/build, hooks/test, sprint validate,
  sprint routing validate.
- `changelog.md` — human-readable changelog bundling Phase 0 + Sprint v0.1.
- `upgrade-notes.md` — step-by-step upgrade guide.
- `framework-manifest.json` — snapshot at build time.
- `checksums.json` — sha256 per capsule file.

Built with `node scripts/mc/release-build.js 0.4.0`. Verified
with `node scripts/mc/release-build.js 0.4.0 --check`.

## Bug fix bundled in 0.4.0

`scripts/mc/release-gates.js` had two `mc/releases/` paths
that were stale leftovers from Track B's 2026-05-03 rename
(`mc/` → `framework/`). The `update_fixture_from_previous` and
`version_consistency` gates were always reporting YELLOW because they
looked in the wrong directory. Both now resolve to
`framework/releases/<version>/` and report GREEN against the 0.4.0
capsule. Not a new bug introduced by Sprint v0.1 — pre-existing
leftover from the rename.

## Encoding fix bundled in 0.4.0

`install.ps1` previously contained em-dashes (`—`) as UTF-8 bytes
without a UTF-8 BOM. Windows PowerShell 5.1 reads `.ps1` as
Windows-1252 by default, which mangles `e2 80 94` into a sequence
that breaks string parsing. Replaced all em-dashes (20 occurrences)
with ASCII hyphens. Installer now parses cleanly under PowerShell
5.1 and 7.x.

## New environment knobs

- `SPRINT_GUARD=off` — bypass `sprint-tracker-guard.js`.
- `SPRINT_APPROVAL_GUARD=off` — bypass `sprint-approval-guard.js`.

## Installer changes

- Default `$Script:WARPOS_VERSION` fallback bumped `0.1.0` → `0.4.0`
  (version.json is still the source of truth; this is the fallback
  only).
- Header comment lists the new sprint-workflow schema
  (`mc/sprint/*/v1`).
- Stage 3 post-install hint now mentions
  `node scripts/sprint/init.js` as an opt-in step.
- Em-dashes replaced with ASCII hyphens (encoding fix).
