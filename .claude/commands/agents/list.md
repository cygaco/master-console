---
description: Enumerate every agent spec by mode and role.
user-invocable: true
namespace: agents
reads: [paths.agents]
writes: []
---

# /agents:list

Walk `paths.agents/` and emit one row per agent spec, including provider_model where declared.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/agents/cli.js list
  --json                JSON output instead of plain text
```

## Output

Plain text:

```
# <N> agent(s)
  <role> [<provider_model>]  <relpath>
```

JSON (with `--json`): array of `{ role, path, provider_model, description }`.

## Exit codes

- `0` success
- `1` no agents found at `paths.agents`
- `2` usage error

## Empty-state behavior

If `paths.agents` does not exist or contains no `.md` files, stderr emits:

```
no agents found at <path>
```

…and exits 1. (Empty agents tree IS a failure — a working MC install always has agents.)

## Example

```bash
$ node scripts/agents/cli.js list --json | head -3
[
  {
    "role": "alpha",
```

## Implementation

Run:

```bash
node scripts/agents/cli.js list $ARGUMENTS
```

See: `tests/transcripts/agents-list.md`.
