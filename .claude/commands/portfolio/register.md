---
description: Register an existing local repo as a portfolio product in ~/.mc/portfolio.json.
---

# /portfolio:register — Register a Product

`/portfolio:register <slug> <path> [<github-url>]` — Add a product to the portfolio registry. Idempotent: re-registering an existing slug with the same path is a no-op (exits 0).

## Input

`$ARGUMENTS` — `<slug> <path> [<github-url>]`

- **slug** — per IN-1: `^[a-z0-9][a-z0-9-]{0,63}$`. Exits 2 on invalid.
- **path** — per IN-3: absolute or relative (resolved to absolute). Must exist on disk. Exits 4 if not found.
- **github-url** — optional. Per IN-4: `https://github.com/`, `git@github.com:`, or `git://github.com/` schemes only.

## What it does

1. Validates slug regex and path existence.
2. Loads current registry via `registry.js`.
3. If slug already registered at same path → exits 0 with "already registered" note.
4. If slug already registered at a DIFFERENT path → exits 2 with existing-path context.
5. Writes new entry with `role: "product"`, `last_synced: now`, `remote_type: "github"` if github_url provided.
6. Prints C-5 success banner.
7. Emits TR-4 `portfolio_register` event.

## Procedure

```bash
node scripts/portfolio/register.js $ARGUMENTS
```

## Exit codes

- `0` — registered (or already registered at same path)
- `2` — invalid slug, duplicate slug at different path, or invalid github-url
- `4` — path does not exist on disk

## TRACE

Emits `portfolio_register` (TR-4) with `{slug, status: "registered"|"rejected", rejection_reason?}`. Path stored as `path_offset` in event (relative to HOME). Fail-open.
