---
description: Verify every migration listed in capsule release.json#migrations[] exists in the source tree before /warp:update may apply.
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

Linked: SP-20260513-005 / S-4 / AC-S-4.3 / R-10 / C-4 / failure-mining.md F-5.
