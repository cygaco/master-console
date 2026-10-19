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
- `/mc:update --status` reports (lists `unmanifested` paths the operator should sweep)
- `/scan:full` (listed in its Tier 3, MC distribution integrity)
- The downstream-install bug class where an installer reports completeness but misses asset directories — `--strict` fails if any on-disk path is unenumerated.

Modes:
- default — strict (any soft finding fails)
- without `--strict` — soft findings (drift, user_modified, unmanifested) report but don't block; hard findings (missing, schema_violation) still block

Schema: `schemas/mc-manifest.schema.json` (v1). Generator: `scripts/mc/manifest/build.js`. See also: `/scan:framework-views-fresh`, `/scan:framework-purity`.
