---
description: Verify every paths.json key points to an existing path (skip generated/ephemeral keys)
---

# /scan:mc-path-resolution

Walks `.claude/paths.json` and verifies every value resolves to an existing path. Skips ephemeral/generated keys (events file, store, checkpoint, lock files).

```bash
node scripts/checks/mc-path-resolution.js
```

Future expansion (refine via /reasoning:run): add the reverse direction — verify every `paths.X` reference in scripts/agents/skills resolves to a defined key.
