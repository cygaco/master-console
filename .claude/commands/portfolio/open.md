---
description: Open a registered portfolio product — print its path and a cd hint, or spawn a new terminal window with --spawn.
says:
  - open the product
  - switch to the product
  - portfolio open
  - go to product
says-args: topic
---

# /portfolio:open — Open a Portfolio Product

`/portfolio:open <slug> [--spawn] [--force]` — Navigate to a registered product or launch it in a new terminal window.

## Input

`$ARGUMENTS` — `<slug> [--spawn] [--force]`

- **slug** — registered product slug. Exits 0 with an error message if not found.
- **--spawn** — launch a new terminal window in the product's repo.
- **--force** — bypass the active-CWD guard when using `--spawn`.

## Modes

### Attach mode (no --spawn)

Prints the product's absolute path and a `cd` hint:

```
pantry-pilot is at: /Users/<user>/repos/pantry-pilot
  cd /Users/<user>/repos/pantry-pilot && claude
```

Emits `portfolio_open` event.

### --spawn mode

Multi-terminal launcher (implemented in `scripts/portfolio/spawn.js`).

Active-CWD guard: if `slug.repo_path == process.cwd()` and `--force` is not passed, prints a warning and exits 0 without spawning.

PATH fallback: if no terminal binary found, prints a copyable command and exits 0.

## Procedure

```bash
node scripts/portfolio/open.js $ARGUMENTS
```

## Exit codes

- `0` — success (path printed, or CWD-guard fired, or PATH-fallback printed)
- `2` — argument parse error

## TRACE

Attach mode: emits `portfolio_open` with `{slug, repo_path_offset}`. Fail-open.
Spawn mode: emits `portfolio_spawn`.
