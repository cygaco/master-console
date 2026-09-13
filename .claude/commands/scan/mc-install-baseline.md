---
description: Verify a MC install baseline exists (.claude/framework-installed.json present, installedVersion ≠ 0.0.0) before /warp:update may proceed.
---

# /scan:mc-install-baseline

Preflight gate composed by `scripts/mc/preflight.js`. Closes failure-mode F-4 (missing per-machine snapshot turns update into a fresh install with massive ADD_SAFE).

`status: green` — `.claude/framework-installed.json` exists, `installedVersion` is real.
`status: red` — file missing OR `installedVersion === "0.0.0"` OR malformed JSON.
`status: yellow` — `--force-fresh` override accepted; apply will be treated as a fresh install.

```bash
node scripts/checks/mc-install-baseline.js [--target <path>] [--force-fresh] [--json]
```

## `--guard-remediation` — the closed-trap backstop (C-8 / doogle WG-1)

A second, canonical-side assertion: every script path a guard names in a USER-FACING remediation message ("Run: node scripts/<name>.js", "Use: …", a `block()` reason, a stderr instruction) must actually EXIST on disk. Otherwise a guard blocks the user and then points them at a file the install never shipped — a closed trap with no exit (the doogle WG-1 class). This scans `scripts/hooks/*.js`, extracts remediation script paths (strict extension boundary — `.json` data files are never treated as runnable), and fails if any is missing.

```bash
node scripts/checks/mc-install-baseline.js --guard-remediation [--json]
```

`status: green` — every guard remediation script path exists. `status: red` (exit 1) — at least one points at a missing file; findings list `guard → path`. Run BOTH modes in `/scan:full`: the baseline check (per-target) and `--guard-remediation` (canonical guard-set integrity).

Linked: SP-20260513-005 / S-4 / AC-S-4.2 / R-4 / C-1 / failure-mining.md F-4 / C-8 / doogle WG-1.
