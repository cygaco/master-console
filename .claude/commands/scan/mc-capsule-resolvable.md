---
description: Verify the capsule for /warp:update --to <v> is resolvable from REPO_ROOT, sibling clones, manifest.mc.source, or framework-installed.json#source.
---

# /scan:mc-capsule-resolvable

Preflight gate composed by `scripts/mc/preflight.js`. Closes failure-mode F-1 (capsule missing for requested `--to <version>`).

Walks the same canonical-discovery lookup path as `/warp:update` itself, in order:

1. `<REPO_ROOT>/framework/releases/<v>/release.json`
2. `../MC/framework/releases/<v>/release.json`
3. `../mc/framework/releases/<v>/release.json`
4. `<manifest.json#mc.source>/framework/releases/<v>/`
5. `<framework-installed.json#source>/framework/releases/<v>/`

If found and `release.json` parses → `status: green` (evidence carries `resolvedAt`).

If found but `release.json` is malformed → `status: red` (does NOT crash the aggregator).

If absent everywhere → `status: red`, with `remediation` listing every available version per searched location PLUS the exact `--source <path>` command the operator should run.

```bash
node scripts/checks/mc-capsule-resolvable.js --to <v> [--target <path>] [--json]
```

Linked: SP-20260513-005 / S-3 / AC-S-3.{1,2,3} / R-3 / C-2 / failure-mining.md F-1.
