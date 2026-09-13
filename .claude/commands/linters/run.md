---
description: Run every project linter (path-lint, lint-*, npm lint:*) and aggregate pass/fail.
user-invocable: true
namespace: linters
reads: []
writes: []
---

# /linters:run

Discover and run every linter declared in:
- `scripts/path-lint.js`
- `scripts/lint-*.js`
- `package.json` scripts beginning with `lint`

…and report pass/fail per linter with aggregate exit code.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/linters/run.js
  --list                discover only, do not execute
  --only <substring>    run only linters matching substring
  --json                JSON output
```

## Output

Plain text:
```
PASS  <name>  (<ms>ms)
FAIL  <name>  (<ms>ms)
      <first 5 lines of error>
# <pass>/<total> passed
```

JSON: array of `{ name, cmd, ok, elapsedMs, error? }`.

## Exit codes

- `0` all passed
- `1` at least one failed OR no linters discovered
- `2` usage error

## Empty-state behavior

If no linters discovered, stderr `no linters discovered` and exit 1. (A MC install ships with at least path-lint; absence is failure.)

## Example

```bash
$ node scripts/linters/run.js --list 2>&1 | head -5
```

## Implementation

```bash
node scripts/linters/run.js $ARGUMENTS
```

See: `tests/transcripts/linters-run.md`.
