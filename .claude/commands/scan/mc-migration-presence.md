---
description: Verify every migration listed in capsule release.json#migrations[] exists in the source tree before /mc:update may apply.
---

# /scan:mc-migration-presence

Preflight gate composed by `scripts/mc/preflight.js`. Closes failure-mode F-5 (capsule lists migrations that don't exist in source — silent skip leaves install inconsistent).

For each `release.json#migrations[]` entry (string or `{file}` object), resolves the path against the source tree and verifies it exists.

`status: green` — every listed migration file exists in source (or list is empty).
`status: red` — any migration is missing.

**No override** — a broken capsule is the bug; refuse to apply.

```bash
node scripts/checks/mc-migration-presence.js --to <v> [--source <path>] [--target <path>] [--json]
```

