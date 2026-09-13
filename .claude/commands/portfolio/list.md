---
description: List all registered portfolio products — slug, path, MC version, last commit, dirty count, current sprint.
---

# /portfolio:list — List Portfolio Products

`/portfolio:list` — Print a summary table of every product registered in `~/.mc/portfolio.json`.

## Input

`$ARGUMENTS` — none expected. Any argument is silently ignored.

## Output

Empty registry → C-3 (onboarding hint).

Non-empty registry → ASCII table with columns per C-4:

```
SLUG               PATH                                                       WARP    LAST COMMIT       DIRTY   SPRINT
pantry-pilot         /Users/alex/repos/pantry-pilot                               0.8.2   a1b2c3d 2d ago    0       SP-20260530-001
orbit-notes         /Users/alex/repos/orbit-notes                               0.8.1   ----              0       (none)
```

Columns:
- **SLUG** — registry key
- **PATH** — `repo_path` from registry
- **WARP** — `installedVersion` from `<repo_path>/.claude/framework-installed.json`, or `?` if absent
- **LAST COMMIT** — `git log -1 --format='%h %ar'` run in `repo_path`, or `----` if not a git repo
- **DIRTY** — count of lines from `git status --porcelain`, or `?` if not a git repo
- **SPRINT** — sprint id from `<repo_path>/.claude/project/sprint/current-sprint.yaml` field `sprint`, or `(none)` if absent

## Procedure

```bash
node scripts/portfolio/list.js
```

## Exit codes

- `0` — success (empty or non-empty)
- `2` — registry corrupt (load error)

## TRACE

Emits `portfolio_list` (TR-3) to `paths.eventsFile` with `{product_count, slugs}`. Fail-open.
