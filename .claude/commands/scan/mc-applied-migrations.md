---
description: Detect already-applied MC migration scripts left on disk in consumer projects
---

# /scan:mc-applied-migrations

Migration scripts under `migrations/X-to-Y/` exist only in canonical MC. Once a consumer project's `installedVersion >= Y`, the migration source is dead weight and should be removed.

```bash
node scripts/checks/mc-applied-migrations.js
```

**Fix when failing:** `git rm -rf migrations/X-to-Y/` for each stale dir.
