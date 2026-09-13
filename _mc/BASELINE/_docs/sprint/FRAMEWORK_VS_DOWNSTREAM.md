# Sprint v0.2 — Framework vs Downstream

The hard rule for sprint v0.2: **live tracker state lives in the
downstream product repo, never in the framework repo.** v0.2 adds
per-sprint subdirs and the active-sprints registry but the
framework/downstream separation is unchanged.

## In the framework repo (this one)

| Asset | Path | Owner |
|---|---|---|
| Templates | `framework/templates/sprint/**` | framework |
| Schemas | `schemas/sprint/**` | framework |
| Helper scripts | `scripts/sprint/**` | framework |
| Slash commands | `.claude/commands/sprint/**` | framework |
| Reference doc | `.claude/project/reference/sprint-workflow.md` | framework |
| Routing policy | `.claude/agents/00-alex/.system/policy/sprint-routing.json` | framework |
| Public docs | `_docs/sprint/**` | framework |
| Path keys | `framework/paths.registry.json` | framework |

These are versioned with the MC release. Downstream consumers get
them via `/warp:update`.

The framework repo MUST NOT contain:

- `.claude/project/sprint/active-sprints.yaml` (v0.2 — any non-test instance)
- `.claude/project/sprint/sprints/<SP-id>/current.yaml` (v0.2 — any non-test instance)
- `.claude/project/sprint/sprints/<SP-id>/progress.yaml` (v0.2 — any non-test instance)
- `.claude/project/sprint/current-sprint.yaml` (legacy v0.1 — any non-test instance)
- `.claude/project/sprint/sprint-progress.yaml` (legacy v0.1 — any non-test instance)
- `.claude/project/sprint/plan-contracts/*.yaml` (real ones)
- `.claude/project/sprint/tickets/*.yaml`
- `.claude/project/sprint/issues/*.yaml`
- `.claude/project/sprint/external-services/*.yaml`
- `.claude/project/sprint/releases/*.yaml`
- `.claude/project/sprint/approvals/*.yaml`
- `.claude/project/sprint/decisions/*.yaml`
- `.claude/project/sprint/ralph/**`
- `.claude/project/sprint/checkpoints/**`
- `.claude/project/sprint/requirements/**`
- `.claude/project/sprint/history/**`
- `issues.md` (any non-template instance)

## In the downstream product repo

| Asset | Path | Owner |
|---|---|---|
| Current sprint | `paths.sprintCurrent` | runtime |
| Progress checkpoint | `paths.sprintProgress` | runtime |
| Plan Contracts | `paths.sprintPlanContracts/*` | runtime |
| Tickets | `paths.sprintTickets/*` | runtime |
| Issues | `paths.sprintIssues/*` | runtime |
| Issues ledger (md) | `paths.sprintIssuesLedger` (`issues.md`) | project |
| External services | `paths.sprintExternalServices/*` | runtime |
| Releases | `paths.sprintReleases/*` | runtime |
| Approvals | `paths.sprintApprovals/*` | runtime |
| Decisions | `paths.sprintDecisions/*` | runtime |
| Ralph progress | `paths.sprintRalph/**` | runtime |
| Checkpoints | `paths.sprintCheckpoints/**` | runtime |
| Requirements bundles | `paths.sprintRequirements/**` | runtime |
| Sprint history | `paths.sprintHistory/**` | runtime |

These are created on demand by `scripts/sprint/init.js` and updated by
the `/sprint:*` commands.

## The exception (be careful)

The framework repo also treats itself as a tracked project — it has
`.claude/project/events`, `.claude/project/memory`, etc. Sprint v0.1
**permits** the framework repo to run `/sprint:plan` against its own
framework work IF the user explicitly initializes the tracker.

In that case, the framework repo's `.claude/project/sprint/` exists.
It is gitignored at the per-file level (the same way other runtime
state is). Sprint tracker files do NOT enter the MC release capsule
or framework manifest.

To audit cleanliness:

```bash
node scripts/sprint/init.js --status
```

If you see live sprint files in a downstream repo's framework PR or in
the canonical MC clone's release capsule, that's a bug. Open an
issue.

## Why this matters

If the framework ships live sprint state:

- Downstream consumers pull "someone else's sprints" on `/warp:update`.
- Tracker file conflicts become merge conflicts.
- The framework manifest count keeps growing for non-framework reasons.
- The capsule becomes non-deterministic.

The same discipline that keeps `paths.eventsFile` out of the capsule
applies here.

## /warp:update behavior

When a downstream repo runs `/warp:update`:

- Framework sprint assets (templates, schemas, scripts, commands, docs,
  routing policy, reference doc) are updated in place.
- Live downstream sprint files (`.claude/project/sprint/**`,
  `issues.md`) are NEVER touched by update.
- Path registry additions are added to `.claude/paths.json` so the new
  sprint paths resolve.

## Migration from a fresh install

A downstream repo on MC 0.3.x that updates to 0.4.0 will:

1. Receive the new framework sprint assets.
2. NOT receive a `.claude/project/sprint/` tree.
3. Need to run `node scripts/sprint/init.js` to opt in.

This is intentional — sprint is additive. A downstream repo can keep
running `/mode:solo`, `/mode:adhoc`, `/mode:oneshot` exactly as before
and never touch sprint.
