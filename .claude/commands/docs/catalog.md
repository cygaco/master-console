---
description: Enumerate reference docs under _docs/ and paths.reference, with title/size/mtime.
user-invocable: true
namespace: docs
reads: [paths.reference]
writes: []
---

# /docs:catalog

Walk `_docs/` and `paths.reference` and report every `.md` file: relative path, title (first H1), size, mtime.

## Input

```
$ARGUMENTS  →  forwarded to: node scripts/docs/catalog.js
  --json                JSON output
  --root <dir>          single root override (skips defaults)
```

## Output

Plain text:
```
# <N> doc(s)
  <relpath>  <title>
```

JSON: array of `{ path, title, size, mtime }`.

## Exit codes

- `0` success
- `1` no docs found under any root
- `2` usage error

## Empty-state behavior

If no `.md` files found, stderr `no docs found under <roots>` and exit 1. (A MC install always has reference docs; absence is failure.)

## Example

```bash
$ node scripts/docs/catalog.js --root _requirements/00-canonical 2>&1 | head -3
```

## Implementation

```bash
node scripts/docs/catalog.js $ARGUMENTS
```

See: `tests/transcripts/docs-catalog.md`.
