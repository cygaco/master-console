---
description: Portfolio dashboard — per-product MC version, last commit, dirty count, current sprint, GitHub remote (parallel, 5s per-product timeout).
---

# /portfolio:status — Portfolio Dashboard

`/portfolio:status` — Print a single ASCII table summarizing the health of every registered product. Parallel per-product probes with a 5s per-product timeout so one slow disk or unreachable remote never blocks siblings.

## Input

`$ARGUMENTS` — none expected. Any argument is silently ignored.

## Output

Empty registry → onboarding hint (mirrors `/portfolio:list` empty branch).

Non-empty registry → ASCII table per C-11:

```
SLUG          WARP    LAST COMMIT          DIRTY   SPRINT           REMOTE
pantry-pilot    0.8.2   a1b2c3d 2 days ago   0       SP-20260530-001  ✓ github
orbit-notes    0.8.1   ----    never        0       (none)           (none)
stale-prod    ?       ----    stale        ?       (none)           ? stale
```

Columns:
- **SLUG** — registry key
- **WARP** — `installedVersion` from `<repo_path>/.claude/framework-installed.json`, or `?`
- **LAST COMMIT** — `git log -1 --format='%h %ar'` in `repo_path`, or `----`/`stale`/`timeout`
- **DIRTY** — count from `git status --porcelain`, or `?`
- **SPRINT** — sprint id from `<repo_path>/.claude/project/sprint/current-sprint.yaml`, or `(none)`
- **REMOTE** — `gh repo view --json url` result: `✓ github` / `(none)` / `?` (gh missing) / `? stale` / `? timeout`

## Parallel-execution contract

`scripts/portfolio/status.js` uses `Promise.all` over the product list. Each product's three subprocess probes (`git log`, `git status`, `gh repo view`) run in an inner `Promise.all` bounded by a 5s `Promise.race` timeout. One slow product does not block siblings; one slow probe inside a product does not block its other probes.

Sequential implementation would be a regression — Beta design-review directive 2026-05-21T21:11Z + user feedback `parallelize_multi_sprint`.

## Procedure

```bash
node scripts/portfolio/status.js
```

## Exit codes

- `0` — success
- `2` — registry corrupt (load error)

## TRACE

Emits `portfolio_status` (TR-9) to `paths.eventsFile`. **Privacy contract (Scenario-9):** payload is counts-only — no slugs, no repo_path strings:

```
{type: "portfolio_status", product_count, dirty_count, stale_count, remote_unreachable_count}
```

Fail-open.

## Acceptance criteria covered

- AC-6.1 — N-row ASCII table matching C-11 format
- AC-6.2 — stale `repo_path` → row indicator + `stale_count` increments in TR-9
- AC-6.3 — `gh` not on PATH → REMOTE shows `?` (best-effort, never an error)
