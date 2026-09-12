---
description: Open a registered portfolio product — print its path and a cd hint, or spawn a new terminal window with --spawn.
---

# /portfolio:open — Open a Portfolio Product

`/portfolio:open <slug> [--spawn] [--force]` — Navigate to a registered product or launch it in a new terminal window.

## Input

`$ARGUMENTS` — `<slug> [--spawn] [--force]`

- **slug** — registered product slug. Exits 0 with C-16 if not found.
- **--spawn** — launch a new terminal window in the product's repo (see S-4 / T-171 for full implementation).
- **--force** — bypass the active-CWD guard when using `--spawn`.

## Modes

### Attach mode (no --spawn) — THIS TICKET

Prints the product's absolute path and a `cd` hint per AC-3.3:

```
pantry-pilot is at: /Users/alex/repos/pantry-pilot
  cd /Users/alex/repos/pantry-pilot && claude
```

Emits TR-5 `portfolio_open` event.

### --spawn mode — T-171

Multi-terminal launcher (implemented in `scripts/portfolio/spawn.js`). See `/portfolio:open --spawn` documentation section below when T-171 lands.

Active-CWD guard (DEC-006): if `slug.repo_path == process.cwd()` and `--force` is not passed, prints C-6 warning and exits 0 without spawning.

PATH fallback (DEC-006): if no terminal binary found, prints C-7 copyable command and exits 0.

## Procedure

```bash
node scripts/portfolio/open.js $ARGUMENTS
```

## Exit codes

- `0` — success (path printed, or CWD-guard fired, or PATH-fallback printed)
- `2` — argument parse error

## TRACE

Attach mode: emits `portfolio_open` (TR-5) with `{slug, repo_path_offset}`. Fail-open.
Spawn mode (T-171): emits TR-5 + TR-6 `portfolio_spawn`.
