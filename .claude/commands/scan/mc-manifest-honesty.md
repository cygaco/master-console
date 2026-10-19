---
description: Verify framework-installed.json reflects actual disk state (no missing files, no hash drift)
---

# /scan:mc-manifest-honesty

Walks `framework-installed.json` and verifies every framework-owned asset exists on disk and matches its install-time hash. `owner: "project"` files are ignored (allowed to drift).

```bash
node scripts/checks/mc-manifest-honesty.js
```

Refine the hash-drift threshold via:
```
/reasoning:run "What thresholds distinguish 'expected local edit' from 'broken install' for hash drift on framework-owned files?"
```
