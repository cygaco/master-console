---
description: Print .claude/manifest.json (pretty by default, --json for compact).
user-invocable: true
namespace: manifest
reads: [paths.manifest]
writes: []
---

# /manifest:show

Pretty-print the project manifest.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/manifest/cli.js show
  --json    compact one-line JSON
```

## Output

JSON.

## Exit codes

- `0` success
- `1` manifest missing or invalid JSON
- `2` usage error

## Empty-state behavior

If `paths.manifest` does not exist, stderr `manifest not found: <path>` and exit 1. (A MC install always has a manifest; absence is failure.)

## Example

```bash
$ node scripts/manifest/cli.js show | head -3
{
  "$schema": "mc/manifest/v1",
  "project": {
```

## Implementation

```bash
node scripts/manifest/cli.js show $ARGUMENTS
```

See: `tests/transcripts/manifest-show.md`.
