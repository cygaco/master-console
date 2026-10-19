---
description: Detect drift between the installed MC version on disk and the latest canonical version, flagging installs that have been stale for more than seven days.
tags: [check, mc, staleness]
---

# /scan:mc-staleness

Compares `.claude/framework-installed.json` against canonical `version.json`. Fails if installed < canonical for >7 days AND no pending `/mc:update` transaction.

```bash
node scripts/checks/mc-staleness.js
```

Set `MC_CANONICAL=/path/to/master-console` if the canonical repo isn't auto-discoverable from `installedSource`. Pass `--json` for machine-readable output.

**Fix when failing:** `/mc:update --to <canonical-version> --apply`
