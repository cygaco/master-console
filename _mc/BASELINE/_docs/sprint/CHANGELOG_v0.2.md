# Sprint Workflow v0.2 — Changelog

**Sprint:** `SP-20260512-001` — Multi-sprint parallelism for Sprint Workflow
**Release:** `RL-20260513-001` (`0.2.0-sprint-workflow`, internal-canary)
**Closed:** 2026-05-13

## Summary

v0.2 lifts the single-active-sprint singleton constraint baked into v0.1. The
sprint subsystem now supports more than one sprint being alive at a time, and
allows independent sprints to execute concurrently in isolated lanes
(default / worktree / branch) without stepping on each other's tracker state,
git state, or downstream artifacts.

Two senses of "parallel" are now first-class:
- **Open at once** — multiple sprints can sit in `planning`, `executing`,
  `paused`, or `in_review` simultaneously. This is the default flow with a
  state-shape refactor only.
- **Executing simultaneously** — sprints with `lane.type === "worktree"`
  run Ralph loops inside isolated git worktrees with conflict-detection
  on declared `affected_surfaces`.

## What changed

### New file layout — `per_sprint_subdir`

- `paths.sprintActiveRegistry` (`.claude/project/sprint/active-sprints.yaml`)
  — top-level registry of every live sprint (`primary` pointer, per-sprint
  `lane`, `layout`, `pointer`, `status`).
- `.claude/project/sprint/sprints/<SP-id>/current.yaml` and
  `progress.yaml` — per-sprint tracker files (replacing the v0.1 root
  singletons).
- Old paths (`current-sprint.yaml`, `sprint-progress.yaml` at the sprint
  root) are deprecated. `scripts/sprint/paths.js` keeps `SPRINT.current` /
  `SPRINT.progress` getters as one-release back-compat aliases that
  resolve through the registry.

### New helpers

| Helper | Purpose |
|---|---|
| `scripts/sprint/migrate-v0.2.js` | Move legacy tracker into the per-sprint layout. `--dry-run` / `--apply` / `--rollback`. Backup → copy → byte-equivalent verify → operator confirm (COPY C-7) → flip registry → delete legacy → record approval → emit TR-6. Idempotent and crash-safe. |
| `scripts/sprint/conflict-check.js` | Set-intersect `affected_surfaces` across active+executing sprints. Warn at plan; block at execute (unless `--allow-overlap` is passed). |
| `scripts/sprint/status.js` + `/sprint:status` | Print the live registry as a table (`SPRINT_ID`, `LANE`, `STATUS`, `PHASE`, `LAST_CHECKPOINT`, `RESUME_COMMAND`; ticket+loop when executing). |

### Updated helpers

Every helper in `scripts/sprint/` now accepts `--sprint <SP-id>`, defaults
to the registry primary when omitted, and exits non-zero with COPY C-10 on
an unknown id. `parseSprintArg` lives in `paths.js` and sets
`process.env.MC_SPRINT_ID` so the centralized logger and decision
ledger auto-tag every appended row with `sprint_id`.

`scripts/sprint/execute.js` honors `lane.type === "worktree"`:
- Refuses with COPY C-6 when the worktree path doesn't exist.
- Fires one no-op warm-up agent dispatch before the first real Ralph
  call (workaround for the documented first-dispatch-leak issue — emits
  `TR-3 sprint.warmup_dispatch` for audit).

### Schemas

- New: `schemas/sprint/active-sprints.schema.json` (`mc/sprint/active-sprints/v1`).
- Updated: `schemas/sprint/current-sprint.schema.json` — dropped the
  singleton claim from the description; added required `lane` field
  (`type: default|worktree|branch`, `value`, `isolation_notes`).
- Updated: `schemas/sprint/plan-contract.schema.json` — added the same
  `lane` block at top level. `plan.js` writes a default block when
  callers omit one (so legacy payloads keep working).
- Updated: `schemas/sprint/sprint-progress.schema.json` — description
  no longer asserts singleton.

### Hook + guard coverage

- `scripts/hooks/sprint-tracker-guard.js` accepts the new
  `sprints/<id>/*.yaml` layout and the registry file. Same `block` on
  schema violations.
- `scripts/hooks/lib/logger.js` auto-resolves `sprint_id` from
  `process.env.MC_SPRINT_ID` (or `opts.sprint_id`) and emits the
  field on every row. Pre-existing rows without `sprint_id` are treated
  as `null` (forward-compat, no retro-fill).
- `scripts/decisions/ledger.js` reads the same env so decision entries
  auto-tag.

### Documentation

- New: `_docs/sprint/LANES.md` — design-authoritative doc for the lane
  model (types, worktree creation, warm-up dispatch citation,
  conflict-check contract, concurrency policy, recovery).
- Updated: `_docs/sprint/OVERVIEW.md`, `CRASH_RECOVERY.md`,
  `FRAMEWORK_VS_DOWNSTREAM.md`, `MODE_RELATIONSHIP.md`,
  `.claude/project/reference/sprint-workflow.md` — none of these
  still describe sprint as a singleton.
- New: `.claude/agents/00-alex/.system/policy/adr/0002-multi-sprint-parallel-lanes.md`
  — ADR capturing decision (recommended variant + worktree default),
  rejected alternatives (minimal_safe, expanded coordinator).

### Routing policy

`sprint-routing.json` gained a `concurrency` block
(`max_lanes`, `default_lane`, `default_isolation: worktree`).
`routing.concurrency()` exposes the parsed block.

## Migration

Live SP-20260512-001 was migrated in this release.

- 150 fields verified byte/semantically before the legacy delete.
- Backup preserved at
  `.claude/runtime/migrate-v0.2-backup/SP-20260512-001-2026-05-13T00-52-54-137Z/`.
- AP-20260512-001 (`destructive_migration`) flipped to `approved`.
- `TR-6 sprint.migration.applied` row in `paths.eventsFile` with
  `legacy_paths_deleted=true`, `verified_field_count=150`,
  `backup_dir`, `approval_id`, and the `sprint_id` tag.

### Downstream upgrade

For consumers running the v0.1 layout:
1. `node scripts/sprint/migrate-v0.2.js --dry-run` to preview.
2. `node scripts/sprint/migrate-v0.2.js --apply` and answer `y` at the
   COPY C-7 prompt.
3. If anything looks wrong: `node scripts/sprint/migrate-v0.2.js --rollback`.

## Tests

- 36/36 `scripts/test-sprint-hooks.js`
- 9/9 `scripts/test-sprint-migration.js` (new)
- 0 regressions in either suite

## Rollback

Two layers, independent of each other:

1. **Migration rollback** (data layer):
   `node scripts/sprint/migrate-v0.2.js --rollback` — restores
   `current-sprint.yaml` + `sprint-progress.yaml` at the root from the
   backup directory; reverts `active-sprints.yaml` to `layout: legacy_root`;
   removes the new `sprints/<id>/*` files.
2. **Code rollback** (framework layer):
   `git revert <merge-sha>` on the release commit reverts the
   schemas + helpers. Run migration rollback first if the data is in
   the new layout.

## Post-release monitoring

- First downstream consumer running the new init: confirm
  `active-sprints.yaml` is created.
- First two-sprint user: confirm `/sprint:status` renders both sprints
  and `conflict-check` fires as expected.
- Watch `paths.eventsFile` for `TR-3 sprint.warmup_dispatch` — confirm
  it fires on every worktree-lane execute.
- Watch for `sprint.conflict_check.run` rows with `allow_overlap: true`
  — if frequent, raise as a `/learn:integrate` candidate.

## Notes

- **No new ESDs.** This sprint touches framework internals only.
- **No new env vars.** `MC_SPRINT_ID` is set by `parseSprintArg` at
  invocation time; not a persistent secret.
- **No user-facing surface deploys.** Framework promotion to canonical
  MC is a separate `/mc:release` flow.
