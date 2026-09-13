---
description: Verify every on-disk path is enumerated in _mc/MANIFEST.json — catches "added framework content, forgot to register" before downstream installs silently break.
---

# /scan:mc-manifest-coverage

Runs the manifest validator in `--strict` mode. Fails if ANY of:

- A path on disk isn't enumerated in `_mc/MANIFEST.json` (`unmanifested`)
- A manifest path isn't on disk (`missing`)
- A framework entry's sha256 drifted (`drift`)
- A user-modified framework file (`user_modified`)
- A schema-shape violation (`schema_violation`)

```bash
node scripts/mc/manifest/validate.js --strict
```

Wires into:
- `/warp:update --status` reports (lists `unmanifested` paths the operator should sweep)
- Pre-release CI (refuses a capsule build with coverage gaps)
- The recurring downstream-install bug class where the installer claimed completeness but missed asset directories — manifests now refuse the run if anything is unenumerated.

Modes:
- default — strict (any soft finding fails)
- without `--strict` — soft findings (drift, user_modified, unmanifested) report but don't block; hard findings (missing, schema_violation) still block

Schema: `schemas/mc-manifest.schema.json` (v1). Generator: `scripts/mc/manifest/build.js`. See also: `/scan:framework-views-fresh`, `/scan:framework-purity`.
