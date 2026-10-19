# Sprint Workflow v0.2 — Reference

Canonical agent-loaded reference for the `/sprint:*` commands. Cite
from `paths.sprintReference`. The per-phase commands live under
`.claude/commands/sprint/` and the helpers under `scripts/sprint/`.

## Front doors

Two equally valid entry points:

- **Per-phase commands** — `/sprint:plan` → `/sprint:design` →
  `/sprint:execute` → `/sprint:release` → `/sprint:retrospective`.
  Operator drives every gate. Use for production work, novel
  surfaces, or when you want granular control.
- **Autonomous front door** — `/sprint:full "<request>"` chains all
  five phases in one invocation under a **bounded autonomy preset**
  (`conservative` / `moderate` / `aggressive`). Pre-authorizes
  approvals only within the preset. Cannot bypass hard ceilings:
  `push_to_remote`, `paid_service_signup`, `production_deploy`,
  `destructive_migration`, `secret_to_remote`. See
  `/sprint:full --help` for the preset list and hard ceilings (a preset-semantics guide is not included in this release) and the halt
  taxonomy.

The autonomous front door is a thin orchestrator (`scripts/sprint/full.js`)
that shells out to the per-phase helpers — same checkpoints, same
routing traces, same Beta consultation cadence. Pick the front door
that matches your risk tolerance for this sprint; everything
underneath is identical.

## Lanes & parallel sprints (v0.2)

Sprint Workflow v0.2 (ADR 0002) lifts the
single-current-sprint constraint:

- `paths.sprintActiveRegistry` (`active-sprints.yaml`) lists every
  live sprint. Exactly one `primary` — the default target when
  `--sprint` is omitted.
- Per-sprint state lives at `sprints/<SP-id>/{current,progress}.yaml`.
  Legacy v0.1 installs keep `current-sprint.yaml` + `sprint-progress.yaml`
  at the root with `layout: legacy_root` in the registry; the
  migration script (`scripts/sprint/migrate-v0.2.js`) flips them on
  user confirmation.
- Each sprint declares a `lane`: `default` (shares working tree),
  `worktree:<path>` (Ralph runs inside a git worktree, reusing the
  builder/oneshot isolation primitive), or `branch:<name>` (light
  isolation).
- `/sprint:execute` honors `lane.type === "worktree"` and fires a
  one-shot warm-up dispatch first before
  any real Ralph dispatch.
- `scripts/sprint/conflict-check.js` refuses to launch a
  second sprint whose `affected_surfaces` overlap with a live sprint's
  unless `--allow-overlap` is passed (logged to the decision ledger).
- Append singletons (`paths.eventsFile`, `paths.decisionLedger`,
  `paths.betaEvents`, `issues.md`) tag every new row with `sprint_id`.
  Pre-existing rows without the field still parse — readers treat
  missing as null. No retro-fill.
- `/sprint:status` lists every live sprint in one table — lane,
  status, phase, current ticket, current loop, last checkpoint,
  resume command. Read-only.
- Concurrency knobs live in `paths.sprintRouting#concurrency`:
  `max_lanes: 2`, `default_lane: "default"`,
  `default_isolation: "worktree"`. Advisory only in v0.2.

The lane types are described above in this section.

## Hierarchy (top to bottom)

```
Product / Project
  Product Thesis
    Current Sprint
      Sprint Objective
        Plan Contract
          External Service Dependencies
          Approval Boundaries
          Scope Variants
          Design Requirement
        PRD / Requirement Set
          High-Level Stories (H-N)
            Granular Stories (S-N)
              COPY (C-N)
              INPUTS (IN-N)
              TRACE (TR-N)
              Acceptance Criteria (AC-N.M)
              QA / Red-Team Expectations
              Tickets (T-…)
                Tasks / Checklist Items
                Linked Issues (I-…)
                Linked Tests
                Linked Docs
                Linked Decisions
                Linked External Services (ESD-…)
                Linked Releases (RL-…)
                Ralph Progress
      Release Record (RL-…)
        Retrospective  ← terminal phase
          Outcomes shipped vs planned
          Plan quality predictions vs reality
          Friction points + action items
          Learning candidates
```

The retrospective is the **terminal phase** of a sprint. It runs only
after `/sprint:release` has archived the sprint and the registry
status is `closed` (or `abandoned`).

Tickets sit at the bottom. They are NEVER a substitute for
requirements. `/sprint:design` is the only command that mints tickets
for non-trivial work.

## Sprint Goal Verification

Every sprint can opt into an **executable-goal contract** via the
optional `goal_verification` block on its Plan Contract. When opted
in, the framework enforces a load-bearing rule: *every sprint
produces at least one test that would have failed before the sprint
started and passes after.*

### `goal_verification` block (Plan Contract)

Additive optional field on `plan-contract.schema.json`. Shape:

```yaml
goal_verification:
  origin_evidence: "<free-text description of the failure>"
  bug_classes_closed: ["<class-a>", "<class-b>"]
  reproduction: executable | not_applicable
  justification: "<required & non-empty when reproduction=not_applicable>"
  cited_tests:
    - { file: "tests/regression/<SP-id>/foo.test.js", test_name: "test_one" }
  fixture_path: null  # or paths.sprintRegressionCorpus/<SP-id>/<RF-id>.yaml
```

Empty `justification` is treated as missing — `validate.js` rejects
the contract.

### AC `verified_by:` linkage convention

In `acceptance-criteria.md`, each AC must carry a `verified_by:` line
when the Plan Contract has `goal_verification`. Two accepted forms:

- `verified_by: <test-file>::<test-name>` (executable — the
  ship-gate runs this exact test)
- `verified_by: not_applicable — <non-empty justification>` (skipped;
  legal only when the contract's `reproduction = not_applicable`)

The template at `_mc/templates/sprint/requirements/acceptance-criteria.md.tmpl`
documents both forms. Placeholder lines containing `{{` or
`<test-file>` count as **missing** for gate purposes.

### Per-sprint regression corpus

Per `paths.sprintRegressionCorpus` (=`tests/regression`), each
opted-in sprint authors its fixtures under
`tests/regression/<SP-id>/`. The convention is bespoke `node` scripts
emitting `  ok    <name>` / `  FAIL  <name>` per case (same format as
`scripts/sprint/test-plan-honors-registry-primary.js`). The corpus is
**excluded** from `/linters:run` discovery — fixtures execute via the
ship-gate only.

### `/sprint:design` fixture gate

When `goal_verification.reproduction = executable`,
`scripts/sprint/design.js` runs a post-scaffold gate: it scans
`acceptance-criteria.md` and refuses to exit cleanly if any AC lacks
a real `verified_by:` line. Refusal is loud (stderr lists the missing
ACs) and non-state-changing — operator fixes the linkage and re-runs.

When `reproduction = not_applicable` and justification is non-empty,
the gate is honored without scanning ACs. When the Plan Contract has
no `goal_verification` field at all, the gate is a no-op (fully
backward-compat).

### `/sprint:release` cited-test ship-gate

`scripts/sprint/release.js check` enumerates the cited tests from
`acceptance-criteria.md` + any fixture records, executes each, and
classifies into three branches:

1. **pass** — exit 0 + parseable `  ok    <name>` line for the cited
   `<test-name>`.
2. **fail** — parseable `  FAIL  <name>` line OR **ENOENT on the cited
   file path** (stop-the-bus: closes the rename/delete
   bypass class — a missing test path NEVER falls through to inconclusive).
3. **inconclusive** — non-zero exit with no recognizable per-case
   markers; blocks the release until an operator records an override.

The operator override is a `decision-ledger.jsonl` row of
`kind=release_override_inconclusive_test`, matched by
`(sprint_id, test_file, test_name)`. There is **no
`--allow-coverage-gap` CLI flag in v1** — the override IS the audit
trail (observe real bypass patterns first).

`acceptance_criteria_satisfied` flips to `true` only when zero
fails AND zero unresolved inconclusive.

### `/scan:ac-coverage` audit skill

Read-only diagnostic that scans every active sprint's AC markdown and
reports per-AC linkage state (`executable` / `not_applicable` /
`missing`). Prose default; `--json` for machine output. Exit 0 when
clean or gate not applicable; 1 when any gate-applicable sprint has
`missing > 0`. Runs ad-hoc — not in `/scan:full` default set in v1.

### Retrospective annotation

`scripts/sprint/retrospective.js` surfaces a per-AC linkage summary
in the retro report (executable / not_applicable / missing counts).
Read-only annotation; no scoring, no blocking.

### Backward compatibility

The entire feature is **gated on `plan_contract.goal_verification`
presence.**
The gate, executor, and
audit all skip when the field is absent. Downstream projects updating
via `/mc:update` inherit the schema additive but their existing
sprints continue to ship unchanged.

## Commands

| Command | Purpose | Layer |
|---|---|---|
| `/sprint:plan`           | Brief intent → Plan Contract | front door |
| `/sprint:design`         | Plan Contract → PRD/STORIES/COPY/INPUTS/TRACE/AC/QA/release + tickets | design |
| `/sprint:execute`        | Tickets → Ralph loops + checks + issues + checkpoints | execution |
| `/sprint:release`        | Sprint → release record, approval, deploy mark, retrospective | release |
| `/sprint:retrospective`  | Closed sprint → structured retro (outcomes, friction, action items) + status flip to `retrospected` | post-release |
| `/sprint:status`         | List every live sprint (v0.2) | read-only |

There is no `/sprint:resume` skill. Resume behavior is in each
command's "Recovery" section and is driven entirely by per-sprint
`progress.yaml` (or the legacy `paths.sprintProgress` singleton on
unmigrated v0.1 installs).

All five commands accept `--sprint <SP-id>` (v0.2). Omitted →
`paths.sprintActiveRegistry#primary`. Unknown id → exit non-zero with
the "unknown sprint" copy message.

## Relationship to modes

Sprint is a workflow layer **above** modes. Modes (`/mode:solo`,
`/mode:adhoc`, `/mode:oneshot`) remain user-controlled.

| Sprint phase | Solo | Adhoc | Oneshot |
|---|---|---|---|
| plan    | Alpha plans directly | Alpha plans; Beta consulted on Class B/C | unusual but allowed |
| design  | Alpha designs directly | Alpha designs; Beta reviews | unusual |
| execute | Alpha executes | Alpha + Gamma for builds | NOT the intended path |
| release | Alpha releases | Alpha + Beta for ship/no-ship | NOT the intended path |

Sprint state lives in files and survives mode transitions. Team task
ownership (in adhoc) is ephemeral — sprint tracker is the durable
record.

## Documentation scaling

`/sprint:plan` and `/sprint:design` honor a `documentation_scale`:

| Scale | Required artifacts |
|---|---|
| xs   | Plan Contract, AC, ticket-or-task, validation note |
| s    | Plan Contract, mini PRD, stories, AC, ticket, QA checklist |
| m    | Plan Contract, PRD, stories, COPY, INPUTS, TRACE, tickets, QA, redteam, release |
| l/xl | All of m + Beta review + architecture note + ESD review + approval gates + staged rollout + monitoring |

For xs/s, `/sprint:design` skips COPY/INPUTS/TRACE/redteam/release plan
templates. Their absence is recorded as `null` on
`current-sprint.requirements.*`.

## Tracker location

Live tracker state always lives in the **downstream** product repo
under `paths.sprintRoot` (`.claude/project/sprint/`). The framework
repo ships templates + schemas + commands + docs only; it does NOT
seed live tracker state.

```
.claude/project/sprint/                paths.sprintRoot
  current-sprint.yaml                  paths.sprintCurrent
  sprint-progress.yaml                 paths.sprintProgress
  plan-contracts/<PC-id>.yaml          paths.sprintPlanContracts
  plan-contracts/<PC-id>.report.md
  tickets/<T-id>.yaml                  paths.sprintTickets
  issues/<I-id>.yaml                   paths.sprintIssues
  external-services/<ESD-id>.yaml      paths.sprintExternalServices
  approvals/<AP-id>.yaml               paths.sprintApprovals
  decisions/<DEC-id>.yaml              paths.sprintDecisions
  releases/<RL-id>.yaml                paths.sprintReleases
  releases/<RL-id>.report.md
  ralph/<sprint>/<T-id>.yaml           paths.sprintRalph
  checkpoints/<sprint>-<n>.yaml        paths.sprintCheckpoints
  requirements/<sprint>/*.md           paths.sprintRequirements
  history/<sprint>/sprint-history.yaml paths.sprintHistory

issues.md                              paths.sprintIssuesLedger (repo root)
```

## Schemas

12 JSON schemas under `paths.sprintSchemas` (`schemas/sprint/`):

- `plan-contract.schema.json`
- `current-sprint.schema.json`
- `sprint-progress.schema.json`
- `ticket.schema.json`
- `issue.schema.json`
- `external-service-dependency.schema.json`
- `approval.schema.json`
- `release.schema.json`
- `ralph-progress.schema.json`
- `active-sprints.schema.json` (v0.2 — registry)
- `sprint-retrospective.schema.json` (v0.2 — per-sprint retro, sibling to `sprint-history`)

Validate with `node scripts/sprint/validate.js [<file.yaml>]`.

## Helper scripts

```
scripts/sprint/
  paths.js              path resolver
  ids.js                id generators
  fs.js                 yaml writer/reader + template render
  validate.js           schema validator
  init.js               downstream init (writes tracker tree from templates)
  plan.js               /sprint:plan plumbing — writes Plan Contract
  design.js             /sprint:design scaffolder — writes requirements bundle
  ticket.js             create/update/reopen/show/list
  issue.js              create/update/promote/appendmd/list
  external-service.js   create/update/list/show/gate
  execute.js            Ralph loop start/phase/stop/show
  release.js            prepare/check/approve/deploy/rollback/report/show/list
  retrospective.js      /sprint:retrospective writer — reads tracker → writes retro.yaml + retro.md
  checkpoint.js         sprint-progress writer + frozen checkpoint
  routing.js            sprint-routing.json loader
  prompts/              prompt bodies (retrospective-synthesis.txt, etc.)
```

All read `paths.json` via the shared `scripts/hooks/lib/paths.js`.

## Retrospective phase

`/sprint:retrospective` runs **after** `/sprint:release` and only on
sprints whose registry status is `closed` or `abandoned`. It reads the
sprint's Plan Contract, tickets (by bucket), issues, decisions,
checkpoints, and release record, then writes:

- `paths.sprintHistory/<SP-id>/retro.yaml` — structured retro
  validated against `sprint-retrospective.schema.json`.
- `paths.sprintHistory/<SP-id>/retro.md` — human-readable retro from
  `_mc/templates/sprint/retrospective/retro.md.tmpl`.

### Status transition: `closed` → `retrospected`

`/sprint:retrospective` flips the matching `sprints[].status` entry in
`paths.sprintActiveRegistry` from `closed` to `retrospected`.
The flip is idempotent — re-running on an already-`retrospected`
sprint with `--force` rewrites the retro files and refreshes
`updated_at`, but does not double-emit registry mutations.

### Hard gates

- Sprint not in `closed` or `abandoned` → exit `3` with the not-closed copy message.
  TRACE event `retro_status_transition_blocked` is emitted.
- Retro already exists, `--force` absent → exit `4` with the retro-exists copy message.
- No Plan Contract found and `--no-plan-contract` not passed → exit
  `2` with the missing-plan-contract copy message.

### Synthesis

Default path invokes the LLM via
`paths.sprintRouting#policies.retrospective` (`strong_reasoning` +
`diff_review: true`). The prompt at
`scripts/sprint/prompts/retrospective-synthesis.txt` mandates
evidence-only synthesis (every claim cites a ticket/issue/decision
id), marks unknown fields with the literal `<unknown — no evidence in
tracker>`, and wraps tracker artifacts in delimiter blocks for
prompt-injection defense.

`--no-synth` skips the LLM and writes a skeleton retro with `<TO
FILL>` placeholders that still validates against the schema.
Synthesis failure auto-falls-back to skeleton mode (fail-open per the
synthesis-fallback copy message); operator can re-attempt via `--retry-synth`.

### Deferred scope

`/sprint:retrospective` MVP is post-release only. Two scope items are
deferred to expanded scope:

- **Mid-sprint check-ins** — partial retros while a sprint is still
  executing.
- **Cross-sprint trend analysis** — `/scan:patterns` will read TR-1,
  TR-2, TR-3 events across multiple retros to surface recurring
  friction themes, average synthesis duration, fallback rate, and
  per-sprint action-item counts.

### Reference

See
`.claude/commands/sprint/retrospective.md`
for the operator-facing skill doc.

## TRACE meaning

In sprint v0.1, **TRACE** is the traceability + observability layer
linking:

```
Source request → Product decision → Requirement (R-N) →
Story (H-N / S-N) → COPY (C-N) → INPUT (IN-N) →
ESD (if applicable) → Ticket (T-…) → Code change →
Test → QA result → Release → Learning
```

Each TRACE entry (`TR-N`) records an event, when it fires, what fields
it captures, why, and which requirement/story it links to. The
`trace.md` template scaffolds this; runtime events still flow through
`paths.eventsFile` (the existing logger) — TRACE is the **schema** for
what those events MUST capture for a given sprint.

## Ralph loop

`/sprint:execute` runs a governed Ralph loop per ticket:

```
plan → act → test → review → record → checkpoint → repeat | stop
```

Persisted at `paths.sprintRalph/<sprint>/<ticket>.yaml`. Stop
conditions (see `schemas/sprint/ralph-progress.schema.json#status`):

- `stopped_clean` (ticket complete)
- `stopped_approval_required`
- `stopped_human_setup_required`
- `stopped_repeated_failure` (3+ failed fix attempts)
- `stopped_scope_expansion`
- `stopped_destructive_action_needed`
- `stopped_production_deploy_needed`
- `stopped_beta_warning`
- `stopped_unclear_intent`

## Crash recovery rule

Every sprint command MUST:

1. Write a `paths.sprintProgress` checkpoint at start.
2. Write a `paths.sprintProgress` checkpoint at end.
3. Set `crash_recovery.resume_command` on `paths.sprintCurrent` to the
   command an agent should run on resume.
4. Set `crash_recovery.safe_to_continue` honestly. If `false`, an
   agent must investigate before resuming.

`paths.sprintCheckpoints/<sprint>-<n>.yaml` is a frozen copy of each
checkpoint (sequence numbered). This is the audit trail when an agent
needs to reconstruct what happened.

## Approval boundaries

Per `CLAUDE.md#Autonomy`, the following always require explicit user
approval:

- Production deploy
- Paid API usage / new paid service
- Service signup / billing setup
- OAuth/app approval
- Domain/DNS changes
- New credentials / secrets
- Destructive migration
- Deleting a major feature
- Changing product thesis
- Changing target customer
- Changing monetization
- Changing privacy / security posture
- Handling sensitive user data
- Bypassing Beta / judgment warning
- Major architecture replacement
- Entering large oneshot-style rebuild scope

Approval lifecycle:

```
pending → approved | rejected | waived | withdrawn
```

Approvals are durable. Sprint commands refuse to proceed past their
gate without an approval record.

## Model routing

Per `paths.sprintRouting` (`sprint-routing.json`):

| Phase | model_class | diff_review |
|---|---|---|
| planning              | strongest_reasoning  | true |
| plan_contract_review  | strongest_reasoning  | true |
| design                | strong_reasoning     | true |
| execution             | economical_coder (escalate: strong_reasoning) | false |
| qa                    | strong_reviewer      | true |
| redteam               | independent_reviewer | true |
| release               | strongest_reasoning  | true |
| docs_sync             | economical_writer    | false |
| tracker_updates       | economical_structurer| false |
| trace_updates         | economical_structurer| false |
| external_service_setup| strong_reasoning     | true |

Routing **declares intent**. Actual provider selection still flows
through `scripts/dispatch-agent.js` / `runProvider`, which honors
`paths.providerFallbackPolicy`. No new SDK installs.

## Issues integration

- `paths.sprintIssuesLedger` (`issues.md`, repo root) — human ledger.
- `paths.sprintIssues/<I-id>.yaml` — machine ledger.
- `scripts/sprint/issue.js create` writes both.
- `scripts/sprint/issue.js promote` prints the ticket-create command to
  link the issue.

Distinct from `paths.recurringIssuesFile` (SYSTEM-level recurring
issues in jsonl), which remains owned by `/issues:log`,
`/issues:list`, `/issues:resolve`, `/scan:issues`.

## Built-in primitive limits

The Claude Code harness's team / SendMessage / maxTurns primitives cannot
be fully fixed in-repo. (Note: `TeamCreate`/`TeamDelete` were removed in
Claude Code v2.1.178 — teams are now implicit + session-scoped, spawned via
`Agent(run_in_background: true)`; the durable-tracker mitigations below still
apply.) Sprint v0.1 mitigations:

- Sprint tracker is the durable task-truth source — never team-task
  ownership.
- `/mode:adhoc` already classifies stale teams.
- Sprint commands include resume instructions in tracker files so a
  defunct or refreshed team does not lose work.

## Ledger discipline

Every release-class event lands in one of two repo-root ledgers — `ROADMAP.md` (sprints) and `RELEASES.md` (versions + releases). The boundary condition is single: **an event qualifies iff it produced a durable artifact under `framework/releases/X.Y.Z/` OR `.claude/project/sprint/releases/RL-*`.**

### What qualifies

| Event | Tier | Lives in |
|---|---|---|
| `version.json` bump (capsule under `framework/releases/X.Y.Z/`) | MUST | `RELEASES.md#versions` |
| `RL-*` at status=deployed OR prepared-at-internal-canary | MUST | `RELEASES.md#sprints` |
| Bare git tag with capsule but outside `/mc:release` | MAY (flagged "tagged outside pipeline") | `RELEASES.md#versions` |
| Hotfix to `main` without an `RL-*` | MUST NOT | git log only |
| Docs-only commits | MUST NOT | git log only |

### Named enforcer (per CLAUDE.md#Policy-and-Enforcement-Hygiene)

- **Writer:** `scripts/sprint/ledger.js` — single shared module called by `plan.js`, `add-sprint.js`, `retrospective.js`, `release.js`, and the `/mc:release` driver. Fail-open: stderr `[ledger] failed: ...` on error, never blocks the host script. Atomic write-temp-then-rename to survive concurrent writers (multi-sprint parallelism).
- **Guard:** `scripts/hooks/ledger-presence-guard.js` — PostToolUse Bash matcher that watches the release-class commands its policy lists and warns when the corresponding ledger row was not detected. Ships with `enforcement.mode = warn`; flip to `block` after smoke validation. Policy file: `ledger-presence.json`.
- **Backfill:** `scripts/sprint/backfill-ledgers.js` — reads `active-sprints.yaml`, `releases/RL-*.yaml`, `version.json#previousVersions`, `framework/releases/X.Y.Z/release.json`. Dry-run default; `--apply` writes. Idempotent.

Anchor markers in each ledger file (`<!-- ledger:sprints -->`, `<!-- ledger:versions -->`, `<!-- ledger:releases -->`) tell the writer where to insert/update rows. Removing the marker is the documented opt-out (writer logs `opted-out` and skips, NOT warns).


## See also

- § Crash recovery rule above
- § Relationship to modes above
- § Model routing above
- § Hierarchy (top to bottom) above (tickets)
- § Issues integration above
- § Ralph loop above
- Downstream-adoption, framework-vs-downstream boundary and external-services guides: not included in this release
