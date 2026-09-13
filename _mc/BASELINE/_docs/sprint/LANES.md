# Sprint Lanes — Multi-sprint parallelism (v0.2)

Sprint Workflow v0.2 lifts the single-current-sprint constraint of v0.1.
Multiple sprints can coexist; some can execute concurrently in isolated
**lanes**. This doc explains the lane model, when to choose each lane
type, and the safety contracts (conflict-check, warm-up dispatch) that
make parallel execution sound.

For the architectural decision and rejected alternatives, see ADR
`paths.policy/adr/0002-multi-sprint-parallel-lanes.md`.

## The shape

```
.claude/project/sprint/
  active-sprints.yaml       ← paths.sprintActiveRegistry (lists every live sprint)
  sprints/
    <SP-id-A>/
      current.yaml
      progress.yaml
    <SP-id-B>/
      ...
  ralph/<SP-id>/<T-id>.yaml
  checkpoints/<SP-id>-<n>.yaml
  history/<SP-id>/sprint-history.yaml
  requirements/<SP-id>/*.md
  plan-contracts/<PC-id>.yaml      ← shared across sprints
  tickets/<T-id>.yaml              ← each ticket's `sprint:` field points back
  issues/<I-id>.yaml               ← each issue's `related_sprint:` field
  external-services/<ESD-id>.yaml
  approvals/<AP-id>.yaml
  releases/<RL-id>.yaml
```

The legacy v0.1 layout (`current-sprint.yaml` + `sprint-progress.yaml`
at the sprint root) still validates. Existing installs stay on
`layout: legacy_root` until `scripts/sprint/migrate-v0.2.js` moves
them.

## Lane types

Every sprint declares a `lane` on its Plan Contract and on
`current.yaml`:

```yaml
lane:
  type: default | worktree | branch
  value: <path | branch-name | null>
  isolation_notes: <free text>
```

### `default`

Shares the working tree with every other `default`-lane sprint and
with non-sprint work. No isolation primitive. Conflict-check warns at
plan-time and blocks at execute-time when `affected_surfaces` overlap.

Choose `default` when:
- The sprint touches narrowly-scoped, well-bounded files unlikely to
  collide with anything else.
- The sprint is short-lived and you don't need parallel execution.
- You're upgrading a v0.1 install and haven't created any worktrees
  yet.

### `worktree`

Ralph runs inside a git worktree (`lane.value` is the worktree path).
This is the isolation model that actually lets two sprints execute
simultaneously without colliding on the working tree or git HEAD.

Choose `worktree` when:
- Two independent workstreams need to run on the same calendar day.
- The sprint will spawn parallel agents (builder, reviewer, fixer)
  whose first dispatch needs the warm-up workaround (see below).

**Creating a worktree** (manual — `/sprint:execute` does NOT create
worktrees for you):

```bash
git worktree add ../mc-lane-B feature/lane-b
# Then declare it on the Plan Contract:
lane:
  type: worktree
  value: ../mc-lane-B
  isolation_notes: "Lane B — feature branch off main"
```

`/sprint:execute` validates `lane.value` exists before starting Ralph,
captures the worktree HEAD via `git -C <lane.value> rev-parse HEAD`
(this also fires the warm-up; see below), logs the
`sprint.warmup_dispatch` event (TR-3), then chdir's into the lane for
all subsequent Ralph phases. The captured HEAD is recorded on the
Ralph file for drift detection.

### `branch`

Light isolation — declares an intent to work on a specific branch
without spinning up a worktree. v0.2 treats `branch` like `default`
for execution purposes (no chdir, no warm-up). v0.3 may add a
`git switch <lane.value>` step.

Choose `branch` when:
- You want to record the branch convention but you're OK sharing the
  working tree.
- The cost of a worktree (disk, hygiene) outweighs the safety benefit
  for this particular sprint.

## Warm-up dispatch

When `lane.type === "worktree"`, `/sprint:execute` performs a single
sequential read inside the lane (`git -C <lane.value> rev-parse HEAD`)
before any Ralph activity. This addresses LRN-2026-04-17:

> When Alpha/Gamma spawns parallel Agent calls with isolation:worktree,
> the FIRST builder's commit can land on the primary repo HEAD instead
> of its assigned worktree. Subsequent parallel dispatches isolate
> correctly — only first leaks.

The warm-up "primes" the worktree process before any agent dispatch.
Original ticket spec (AC-11.1) called for a no-op agent via
`scripts/dispatch-agent.js`. The implementation uses `git rev-parse`
instead — it achieves the same priming effect at zero cost (no LLM
call, no provider quota burn) while also capturing the HEAD for
drift detection. The deviation is documented in
`scripts/sprint/execute.js#prepareLane`.

The warm-up logs event TR-3:

```json
{
  "type": "warmup",
  "action": "sprint.warmup_dispatch",
  "target": "<lane.value>",
  "detail": "first-dispatch-leak-workaround; head=<sha>",
  "sprint_id": "<SP-id>"
}
```

A regression test in `scripts/test-sprint-hooks.js` (T-20260512-011)
asserts the event fires on every worktree-lane execute. Skipping the
warm-up requires `--skip-warmup` (test-only — production never sets
this).

## Conflict-check

`scripts/sprint/conflict-check.js` (T-20260512-013) computes set
intersection of `affected_surfaces.surface` strings between the
candidate sprint and every other in-flight sprint. Severity model:

- **clean** — no overlap. Exit 0.
- **warn** — overlap detected during `/sprint:plan`. Print the
  conflict list to stderr; do not block. Exit 0 (the plan still gets
  written).
- **block** — overlap detected at `/sprint:execute` start. Print the
  conflict list; refuse to start the Ralph loop unless
  `--allow-overlap` is passed.

When `--allow-overlap` is used, the override is logged to
`paths.decisionLedger` as `manual_allow_overlap` with the conflicting
surface list. Beta and retros can audit the override later.

**Limitations** (per redteam probe A-5):

- Conflict-check reads `affected_surfaces.surface` strings literally.
  Under-declared surfaces let conflicts slip through.
- The intersection is exact-match; "src/foo.js" and "src/foo.ts" do
  not collide even if they conceptually touch the same module.
- Sprints in `closed`, `abandoned`, or `not_started` states are
  excluded at execute-time (no point blocking on a sprint that isn't
  actively committing). They DO appear at plan-time so the warn
  surfaces them.

The intersection algorithm is intentionally simple. v0.3 may add
path-glob expansion or import-graph propagation.

## Append-singleton sprint-id tagging

Four append-only stores tag every new row with `sprint_id`:

- `paths.eventsFile` — `events.jsonl` rows gain `sprint_id` when
  `process.env.MC_SPRINT_ID` is set (sprint helpers set this on
  every invocation via `SPRINT.parseSprintArg`).
- `paths.decisionLedger` — `decision-ledger.jsonl` records carry
  `sprint_id` on append; resolution order is explicit field → env →
  null.
- `paths.betaEvents` — Beta consultation rows carry `sprint_id` when
  logged from a sprint context.
- `issues.md` — the human ledger heading is now `### [SP-X] I-id …`.
  YAML records under `paths.sprintIssues` already carry
  `related_sprint`.

Pre-existing rows without `sprint_id` are forward-compatible: readers
treat missing as null. No retro-fill — the historical record is
preserved verbatim.

## Concurrency policy

`paths.sprintRouting` (`sprint-routing.json`) ships a `concurrency`
block in v0.2:

```json
"concurrency": {
  "max_lanes": 2,
  "default_lane": "default",
  "default_isolation": "worktree"
}
```

`max_lanes` is **advisory** in v0.2 — `/sprint:execute` does not yet
enforce a hard cap. `default_lane` is the lane type assigned when
`/sprint:plan` omits one. `default_isolation` is the recommended
isolation type for non-default lanes (`worktree` reuses the
builder/oneshot primitive proven for months).

`scripts/sprint/routing.js#concurrency()` returns the parsed block
for any caller that wants to enforce a cap. v0.3 may add a
hard-block when `max_lanes` is reached.

## `/sprint:status`

`/sprint:status` (T-20260512-015) prints a one-line-per-sprint table:

```
SPRINT_ID         LANE                STATUS       PHASE     LAST_CHECKPOINT                              RESUME_COMMAND
* SP-20260512-001 default             executing    execute   .../sprint-progress.yaml                     /sprint:execute
  SP-20260520-002 worktree:../wt-b    designing    design    .../sprints/.../progress.yaml                /sprint:design
```

The `*` marks the registry primary. Orphan subdirs (on disk but not
in the registry) appear with `STATUS=orphaned`. Registry entries with
no on-disk files appear with `STATUS=missing-subdir`. Drift is
surfaced, never auto-reconciled.

## Recovery

If a session crashed with multiple sprints in flight:

1. Run `/sprint:status` to see which sprints exist and where each
   stopped.
2. For each sprint, read its `progress.yaml` — `resume_command` and
   `next_action` tell you what to run.
3. If a sprint's `safe_to_continue: false`, investigate before
   resuming.
4. `/sprint:execute --sprint <SP-id>` targets one specifically.

## Related

- `paths.sprintReference` — short top-level sprint reference.
- `_docs/sprint/OVERVIEW.md` — sprint workflow overview.
- `_docs/sprint/CRASH_RECOVERY.md` — recovery procedures (now
  multi-sprint aware).
- `_docs/sprint/FRAMEWORK_VS_DOWNSTREAM.md` — framework/product
  separation.
- `_docs/sprint/MODE_RELATIONSHIP.md` — how lanes interact with
  modes (solo/adhoc/oneshot).
- `paths.policy/adr/0002-multi-sprint-parallel-lanes.md` — the ADR.
- `scripts/one-off-log-dispatch-issues.js` — the LRN-2026-04-17 source
  documenting the parallel-dispatch first-leak.
