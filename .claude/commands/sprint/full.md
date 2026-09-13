---
description: Single-invocation execution of the full sprint pipeline (plan→design→execute→release-prep→retro) under a bounded autonomy preset. Cannot bypass CLAUDE.md hard ceilings.
user-invocable: true
---

# /sprint:full — Autonomous Sprint Orchestrator

Single entry point for the whole sprint pipeline. Chains
`plan → design → execute → release-prep → retro` without per-command
operator input. Approval gates are auto-satisfied **only within the
preset's pre-authorization**; everything else halts cleanly with a
single resume command.

`/sprint:full` is composition over duplication — it shells out to the
existing `/sprint:plan`, `/sprint:design`, `/sprint:execute`,
`/sprint:release`, `/sprint:retrospective` helpers rather than
reimplementing their logic. Crash-safe checkpoints, routing traces,
and Beta consultation cadence are inherited.

## When to use

- Small/medium sprints where you want the leverage of the full
  pipeline without the per-phase keyboard cadence.
- After you've decided which preset matches your risk appetite for
  this sprint (default `moderate`).
- When the current branch is **not** `main` (orchestrator refuses on
  main unless `--allow-main` + `--autonomy aggressive`).

Do NOT use `/sprint:full` for:
- Production deploys (hard ceiling — never auto).
- Sprints that need a human in the design-phase hand-edit. Use
  `/sprint:plan` + `/sprint:design` manually instead.
- Skeleton rebuilds (use `/mode:oneshot` directly).

## Inputs

```text
/sprint:full "<request>" \
  [--autonomy conservative|moderate|aggressive] \
  [--scope minimal_safe|recommended|expanded] \
  [--documentation-scale auto|xs|s|m|l|xl] \
  [--mode solo|adhoc] \
  [--sprint <SP-id>] \
  [--resume] \
  [--allow-main] \
  [--cost-acknowledged]
```

Defaults: `--autonomy moderate --scope recommended --documentation-scale auto --mode adhoc`.

**ε-conduct default (sprint-mode only):** When the session mode is `sprint` (`.claude/runtime/mode.json`
`mode === "sprint"`), `--epsilon` and `--epsilon-dispatch` are ON by default — the orchestrator
detects this via `scripts/hooks/lib/mode.js#isSprint()`. Explicit CLI flags (`--epsilon`,
`--no-epsilon`, `--epsilon-dispatch`) and `MC_EPSILON_RUNTIME` env var always win. Non-sprint
sessions have byte-identical behavior to the pre-T-297 default (ε OFF unless explicitly passed).

See `paths.sprintFullAutonomy` for preset definitions and
`_docs/sprint/AUTONOMY.md` for plain-English semantics. The 11 input
contracts (validation + failure modes) live in
`paths.sprintRequirements/SP-20260518-001/inputs.md` (IN-1..IN-11).

## Hard ceilings (NEVER bypassable by any preset)

- `push_to_remote` — orchestrator commits locally but never pushes.
- `paid_service_signup` — operator handles out-of-band.
- `production_deploy` — operator runs `release.js deploy` manually.
- `destructive_migration` — operator runs migrations manually.
- `secret_to_remote` — `secret: true` env-var values never appear in
  any tracked file or report.

Hard ceilings are enumerated in `scripts/sprint/full.js#HARD_CEILINGS`
and re-stated (informational) in the autonomy config's `hard_ceilings[]`
field. The orchestrator refuses to start if the config tries to drift.

## Procedure

### Step 1 — Skill body responsibilities (Alpha's reasoning)

Before invoking `scripts/sprint/full.js`, the skill body (this file)
sets up state that the orchestrator can't infer:

1. **Construct the Plan Contract payload** from the verbatim
   `$ARGUMENTS` request. Write to `.mc/plan-payload-<slug>.json`
   matching `schemas/sprint/plan-contract.schema.json` (per
   `/sprint:plan` Step 9). The orchestrator's Phase 1 picks up the
   most recent matching file in `.mc/`.
2. **Ensure a sprint id exists.** If the operator didn't pass
   `--sprint <SP-id>`, run `node scripts/sprint/add-sprint.js --id
   <new-id> --title "<derived>"` to mint a new sprint in the
   registry. The orchestrator will use it.
3. **Pre-flight check.** Run
   `node scripts/sprint/validate-autonomy-config.js` to confirm the
   preset bundle at `paths.sprintFullAutonomy` is healthy. Refuse to
   continue if validation fails.

### Step 2 — Invoke the orchestrator

```bash
node scripts/sprint/full.js "$ARGUMENTS" \
  --autonomy "$autonomy" \
  --scope "$scope" \
  --documentation-scale "$doc_scale" \
  --mode "$mode" \
  --sprint "$sprint_id"
```

The orchestrator drives all 5 phases. Each phase writes a checkpoint
via `scripts/sprint/checkpoint.js` and emits `sprint_full_phase_*`
events to `paths.eventsFile`.

### Step 2b — ε-conducted design phase (Phase 2)

**When ε-conduct is active** (`epsilonDispatch: true` — the default in sprint sessions, see above),
Phase 2 routes through ε's hook-point roster rather than a bare scaffold call:

- ε dispatches the design roster by each role's REGISTRY-DERIVED route, not a single shape. Per the
  hook-point registry the design step is `product-lead`, `director-of-engineering`, `design-lead`,
  `quality-lead`, `copy-lead`: the GPT roles (product-lead, design-lead — `provider: openai`) go via
  **subprocess** (`dispatch-agent.js`, the `cross_provider_consult_lead` class), while the Claude roles
  (director-of-engineering, quality-lead) go **in-process via the Agent tool**. (`design-quality` is
  gauntlet-only, not design; `req-reviewer` no longer exists — absorbed into `qa-reviewer` at the
  gauntlet.) The per-step set is `epsilon.md`'s hook-point registry.
- **Agent-tool capability (ADR-0014):** ε — top-level OR teammate-spawned — CAN call the Agent tool
  and summon the in-process roster directly, each spawn supplying a `scopeContract`. The Agent tool
  is a per-spec capability (ε's spec lists it); ADR-0014 retired the old ED-041 "α-only" constraint
  (`mode_profiles.sprint.alpha_only_shapes` is now `[]`). The only node-script limit is that the
  runtime returns `spawned:false, reason:requires-orchestrator` — handing the spawn to the ε-agent,
  which runs the roster agents as in-process Agent-tool dispatches and writes their completion records.
  No-cascade invariant: a summoned roster consult must not dispatch the build chain (ε is the sole
  builder-dispatcher).
- Every roster completion is recorded to `paths.dispatchCompletionsFile`
  (`.claude/runtime/dispatch-completions.jsonl`) with `{sprint, step:"design", ok:true}`.
- After design.js succeeds, the orchestrator checks for those records and emits a
  `design_without_roster` warning event if none are found (report-only, `T-297-enforcer-ramp`).

After Phase 2 scaffolds the requirements templates, the orchestrator
**always halts** with `halt_reason: tickets_pending`. This is by
design — the orchestrator cannot auto-fill placeholders or infer
ticket scope from rendered templates.

**Required operator action before resuming:**

1. Review and fill `.claude/project/sprint/requirements/<SP-id>/`
   (prd.md, acceptance-criteria.md, granular-stories.md, etc.).
   - The PRD's Requirements list is generated from `plan_contract.requirement_areas`
     (R-1..R-N, single-source per T-298). Do NOT add R-ids that don't exist in that list.
2. Mint tickets via:
   ```bash
   node scripts/sprint/ticket.js create \
     --sprint <SP-id> \
     --title "<title>" \
     --type <type> \
     --risk <level>
   ```
   Each ticket that should execute must reach status `ready_for_execution`.
3. Resume: `/sprint:full --sprint <SP-id> --resume`

The orchestrator's Phase 3 will refuse to advance (halt: `no_tickets_ready`)
if it finds zero `ready_for_execution` tickets AND zero `done`/`deferred`
tickets — this is the second guard against hollow runs.

### Step 3 — ε-conducted execute phase + Ralph-loop handoff (Phase 3)

When the orchestrator reaches Phase 3, it iterates
`ready_for_execution` tickets and marks each `in_progress`.

**When ε-conduct is active,** ε dispatches the build-chain agents (builders, reviewers, fixers)
via the CLI routes (`dispatch-claude.js` / `dispatch-agent.js`) — the ADR-0009 registry-driven
runtime. Each builder/reviewer dispatch lands a completion record in
`paths.dispatchCompletionsFile` (`.claude/runtime/dispatch-completions.jsonl`) with
`{sprint, step:"execute", role, ok}` so the gauntlet-verify can check liveness (not just the
presence of the file). Worktree-cwd dispatches write to the WORKTREE's runtime path — see
`project_dispatch_completions_relative_path_cwd` memory for the caveat; check the worktree
record before concluding silent death.

The Ralph loop (`plan → act → test → review → record → checkpoint`) is
the skill body's responsibility per `/sprint:execute`'s contract.
Alpha drives each ticket through its loop, then marks
the ticket `done` and continues to the next.

Mapping `execute.js` stop_reasons to the preset's
`stop_condition_policy`:

| stop_reason | conservative | moderate (default) | aggressive |
|---|---|---|---|
| `completed` | continue | continue | continue |
| `approval_required` | halt | halt | auto_continue (within preset) |
| `human_setup_required` | halt | halt | halt |
| `repeated_failure` | halt | **defer** (3-attempt) | **defer** |
| `scope_expansion` | halt | halt | halt |
| `destructive_action_needed` | halt | halt | halt |
| `production_deploy_needed` | halt | halt | halt |
| `beta_warning` | halt | halt | halt |
| `unclear_intent` | halt | halt | halt |

### Step 4 — Skill body Phase 4 release-prep handoff

The orchestrator's Phase 4 calls `release.js prepare` for non-production
targets when the preset allows. For `moderate` (which does NOT
pre-authorize release approvals), Phase 4 halts and emits a halt
report; the operator either records the approval and resumes, or
re-runs with `--autonomy aggressive` (still bounded by hard ceilings
— production deploy is never auto).

`release.js deploy` is never called from `/sprint:full`. Always.

### Step 5 — Beta consultation cadence (adhoc mode)

In `adhoc` mode, the orchestrator does **not** consult Beta inline.
Instead, at each of the 4 phase boundaries it **halts** with
`halt_reason: beta_consult_pending` and exits 1:

- before Phase 2 (post-plan)
- before Phase 3 (post-design)
- before Phase 4 (post-execute)
- before Phase 5 (post-release-prep)

The skill body (Alpha in the foreground) then performs the real Beta
(Alex β) consult via SendMessage. Each consult MUST include
`data.topic_tags` containing `sprint_full_phase_boundary` so the
beta-gate hook recognizes it. Beta returns `DECIDE | DIRECTIVE |
ESCALATE`. After obtaining the verdict, Alpha resumes with:

```bash
node scripts/sprint/full.js --sprint <SP-id> --resume \
  --pending-phase <boundary> \
  --beta-verdict <DECIDE|DIRECTIVE|ESCALATE> \
  --beta-message "<Beta's response>"
```

ESCALATE is a **hard halt regardless of preset** — the orchestrator
records the verdict and writes a halt report with
`halt_reason: beta_escalate`. Solo mode skips Beta entirely.

### Step 6 — Halt handling

On any halt:

1. Orchestrator writes a halt report at
   `paths.sprintFullReports/<SP-id>/halt-<ISO>.md` (schema in COPY
   C-14).
2. Orchestrator emits `sprint_full_halt` event with the halt_reason.
3. Orchestrator writes a checkpoint with `status: halted` and
   `resume_command: /sprint:full --sprint <SP-id> --resume`.
4. Orchestrator exits non-zero (1).
5. Skill body surfaces the halt-report path + resume command to the
   operator.

### Step 7 — Resume

```bash
node scripts/sprint/full.js --sprint <SP-id> --resume \
  [--cost-acknowledged] [--autonomy <new-preset>] \
  [--pending-phase <boundary> --beta-verdict <DECIDE|DIRECTIVE|ESCALATE> --beta-message "<...>"]
```

Reads `paths.sprintProgress`, identifies the last completed phase,
continues from the next phase boundary. Does NOT restart the failed
phase mid-state — per-phase helpers own intra-phase resume.

`--cost-acknowledged` is only meaningful when resuming after a
`cost_threshold` halt: it raises the threshold to 2× for the
remainder of this run only (NOT persisted to preset config).

`--pending-phase` / `--beta-verdict` / `--beta-message` resume a
`beta_consult_pending` halt with the real Beta verdict. These three
args are **resume-only** — supplying them on a fresh run is rejected
(exit 2).

### Step 8 — Completion

When all 5 phases complete:

- Orchestrator writes the final report at
  `paths.sprintFullReports/<SP-id>/sprint-full-report.md` (schema in
  COPY C-13).
- Emits `sprint_full_done` with totals (tickets, durations, cost
  estimate, auto-approvals).
- Final checkpoint with `status: completed`.

### Step 8b — Roadmap trace (ALWAYS) — WG-16

`/sprint:full` ALWAYS records the sprint to `ROADMAP.md`, so work that wasn't a
pre-planned roadmap item is still tracked:

1. **Sprints-table row** — `scripts/sprint/ledger.js` appends the row at sprint
   mint (`add-sprint.js`); the completion step **verifies/repairs** it so the
   row is guaranteed present at completion (not merely assumed at mint). This
   half is **enforced** by the ledger (idempotent, anchor-gated
   `<!-- ledger:sprints -->`).
2. **Shipped narrative** — the completion step appends a one-line Shipped entry
   under the matching epic, or under an **"Ad-hoc / unplanned"** subsection
   for off-roadmap work. This half is **skill-body discipline** (no hook verifies
   it) → enforcement-debt, closed by `/scan:roadmap-trace` (asserts every
   `done`/`retrospected` sprint has both a Shipped entry AND a ledger row; wired
   into `/scan:full`).
3. **No `ROADMAP.md`?** — warn and proceed. Best-effort; never blocks the sprint.

### Step 9 — Surface to operator

Report:

1. Outcome (`done` or `halted:<reason>`).
2. Report path (final or halt).
3. Per-phase durations from the timeline.
4. Total cost estimate vs threshold.
5. Auto-approvals recorded (if any).
6. Next command (`/sprint:release deploy` if shipping, or the resume
   command if halted).

## Outputs

| Artifact | Path |
|---|---|
| Halt report | `paths.sprintFullReports/<SP-id>/halt-<ISO>.md` |
| Final report | `paths.sprintFullReports/<SP-id>/sprint-full-report.md` |
| Plan payload | `.mc/plan-payload-<slug>.json` (constructed by skill body) |
| Plan Contract | `paths.sprintPlanContracts/<PC-id>.yaml` |
| Requirements bundle | `paths.sprintRequirements/<SP-id>/*.md` |
| Tickets | `paths.sprintTickets/T-*.yaml` |
| Approvals (auto-recorded) | `paths.sprintApprovals/AP-*.yaml` |
| Release record | `paths.sprintReleases/<RL-id>.yaml` |
| Retrospective | `paths.sprintHistory/<SP-id>/retro.{yaml,md}` |
| Events | `paths.eventsFile` filter `kind=sprint_full_*` |
| Checkpoints | `paths.sprintProgress` + `paths.sprintCheckpoints/<SP-id>-N.yaml` |

## Recovery

Any halt is recoverable. Read the halt report; it names the resume
command and the human action needed. Most common:

- `tickets_pending` — Phase 2 design scaffold complete. Fill requirement
  templates, mint `ready_for_execution` tickets via `ticket.js create`,
  then resume.
- `no_tickets_ready` — Phase 3 found 0 tickets in `ready_for_execution`
  and 0 in `done`/`deferred`. Ticket minting was skipped. See
  `tickets_pending` above.
- `no_tickets_done` — Phase 4 refuses to mint a release record when 0
  tickets are in `done` or `deferred`. Complete at least one ticket
  before releasing.
- `approval_beyond_preset` — record the approval (or re-run aggressive),
  then resume.
- `beta_consult_pending` — adhoc mode reached a Beta phase boundary;
  consult Beta (Alex β), then resume with --beta-verdict / --beta-message /
  --pending-phase.
- `beta_escalate` — address Beta's concern, then resume.
- `cost_threshold` — resume with `--cost-acknowledged` (2× for this
  run only) or raise the threshold permanently in the autonomy preset.
- `esd_signup` — complete the external setup, mark the ESD
  `ready_for_terminal_work` via `external-service.js update`, then
  resume.
- `branch_protection` — `git switch -c sprint/<SP-id>` then re-run
  (no `--resume` needed; the sprint hasn't started yet).

## Approval gates

`/sprint:full` itself is reversible (writes local files; never
pushes; never deploys). But within a run it MAY auto-record approvals
within the preset's `pre_authorized_approval_levels[]`. The
authoritative enum that cannot be lifted by any preset:

- `production_release_approval` — NEVER auto.
- `paid_service_approval` — NEVER auto.

Operator MUST review the autonomy preset config
(`paths.sprintFullAutonomy`) before first use; the four design-time
approvals AP-20260518-017..020 record the operator's sign-off on the
default preset semantics.

## Routing

`/sprint:full` does not introduce a new routing class. Each phase
records its trace via the existing helpers (per-phase routing in
`paths.sprintRouting`). The orchestrator itself records phase-start
and phase-completion events but no separate `full_orchestration`
trace in v0.1.

## Relationship to existing modes

- **Solo:** Alpha runs all 5 phases directly. No Beta cadence. ε-conduct default still applies
  when mode is `sprint`; toggle with `--no-epsilon` if you need bare-scaffold behavior.
- **Adhoc (default):** Alpha runs phases; Beta consulted at the 4 phase boundaries. ESCALATE
  halts regardless of preset. ε-conduct is the default in sprint sessions (see above).
- **Sprint (session-level):** When `/mode:sprint` is active, the orchestrator auto-enables
  `epsilon + epsilonDispatch` — ε conducts the full lifecycle via the ADR-0009 registry-driven
  runtime. The ε conductor — top-level OR teammate-spawned — calls the in-process roster directly
  with a `scopeContract` (ADR-0014 retired the ED-041 "α-only" constraint; `alpha_only_shapes` is
  now `[]`). The only node-script limit is the runtime's `requires-orchestrator` hand-off to the
  ε-agent.
- **Oneshot:** NOT supported. `--mode oneshot` is rejected. Oneshot is
  for skeleton rebuilds, not sprint pipelines.

## Non-goals

- Auto-deploying to production — hard ceiling.
- Auto-pushing to remote — hard ceiling.
- Auto-signing up for paid services — hard ceiling.
- Replacing `/sprint:plan` as the front door — per-phase commands
  remain available.
- Cross-sprint orchestration in v0.1 — single sprint only.
- Auto-promoting retro `action_items` into a new sprint — operator
  decides.
- Building a UI for autonomy preset editing — config file is
  operator-editable.

## Reference

- Skill source of truth: this file
- Orchestrator: `scripts/sprint/full.js`
- Preset schema: `schemas/sprint/sprint-full-autonomy.schema.json`
- Default presets: `paths.sprintFullAutonomy`
- Preset validator: `scripts/sprint/validate-autonomy-config.js`
- Integration tests: `scripts/sprint/test-sprint-full.js`
- AUTONOMY plain-English: `_docs/sprint/AUTONOMY.md`
- Sprint workflow overview: `paths.sprintReference`
- Crash recovery: `_docs/sprint/CRASH_RECOVERY.md`
