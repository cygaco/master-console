---
description: Verify installed framework has the structural skeleton dirs canonical declares
---

# /scan:mc-structure-parity

Catches the gap that opened the 2026-05-03 cleanup: canonical had `_shared/`, `_standards/`, `_audits/` etc. but the installer never created them in consumer projects, so structural changes never propagated.

```bash
node scripts/checks/mc-structure-parity.js
```

**Fix when failing:** `/mc:update --apply` to pull canonical's structure.
