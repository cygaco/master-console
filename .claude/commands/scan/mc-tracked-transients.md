---
description: Catch transient state accidentally committed (.mc/, qa-*.png, runtime/qa-*/, runtime/**/*.{jsonl,log,diff,err,out}, oversized runtime/**/*.txt, the beta mining output dir)
---

# /scan:mc-tracked-transients

Scans `git ls-files` **and** the staged index for paths that should never be tracked. Exit 0 = green; 1 = tracked/staged transients found; 2 = the allowlist is unreadable or malformed (fail-closed). One of the five `/scan:leak-gate` gates; CI runs it on every push.

```bash
node scripts/checks/mc-tracked-transients.js
node scripts/checks/mc-tracked-transients.js --json
```

Rules (`FORBIDDEN` in the script):

| Rule | Why |
|---|---|
| `.mc/` anywhere | per-install transactional audit log |
| `qa-*.png`, `runtime/qa-*/`, `runtime/research/`, `runtime/logs/` | regenerable QA/research output |
| `*/beta/events.jsonl`, `*/events.jsonl`, `*/tools.jsonl`, `*/skill-usage.jsonl` | owner=runtime append-only logs (G5.7) |
| `.claude/agents/president/_system/beta/mined/**` | β mining output — verbatim operator prompts mined from ignored logs (S-OS-04 / ED-417) |
| `runtime/**/*.jsonl`, `*.log`, `*.diff`, `*.err`, `*.out` | per-run artifacts under `runtime/` (S-OS-04 / ED-417) |
| `runtime/**/*.txt` larger than 200 KB | transcript-like text (S-OS-04 / ED-417) |

**Allowlist:** a tracked path that matches a rule but is genuinely needed goes in `scripts/checks/mc-tracked-transients.allowlist.json` as `{ "path", "reason" }`. It is empty and should stay that way — an entry is a claim that a per-run artifact ships on purpose. A malformed entry (no reason) fails the gate closed.

**Why this exists:** the 2026-05-03 cleanup found 100+ `.mc/transactions/` backup files committed by mistake; the 2026-09-02 open-source review found tracked `.jsonl`/`.log`/`.diff` per-run artifacts under `runtime/`. This check makes both regressions impossible.

**Fix when failing:** `git rm --cached <file>` (tracked) or `git reset HEAD <file>` (staged) and verify `.gitignore` covers the pattern (`runtime/**/*.{jsonl,log,diff,err,out}` and the mining dir are already listed).

Enforcer of this skill's own contract: `scripts/checks/mc-tracked-transients.test.js` (planted tracked `runtime/*.jsonl` in a throwaway repo must exit 1; oversized `.txt`, β-mined file and allowlist semantics covered; the live tree must exit 0).
