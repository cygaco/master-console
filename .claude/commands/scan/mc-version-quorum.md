---
description: Verify version.json, .claude/framework-manifest.json, .claude/framework-installed.json, and install.ps1 header agree on the installed version (trust order = version.json wins).
---

# /scan:mc-version-quorum

Preflight gate composed by `scripts/mc/preflight.js`. Closes failure-mode F-3 (version drift between sources of truth).

Reads up to four sources and refuses if any two reachable ones disagree:

1. `version.json#version` — **trust winner**
2. `.claude/framework-manifest.json#version`
3. `.claude/framework-installed.json#installedVersion`
4. `install.ps1` header constant (optional)

`status: green` — all reachable sources agree.
`status: red` — any disagreement; `remediation` names the trust winner and the disagreeing files.

**No override** at the gate layer. The preflight composer accepts `--allow-version-drift` and re-interprets red as yellow, with `data.overrideUsed=true` emitted in the `mc.update.preflight` event.

```bash
node scripts/checks/mc-version-quorum.js [--target <path>] [--json]
```

