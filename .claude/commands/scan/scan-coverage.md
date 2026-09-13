---
description: Scan-suite self-inventory — asserts every /scan:* skill is delegated by /scan:full or explicitly excluded (with a reason). Kills the dir↔aggregator drift class (the "enforcer exists but isn't on the path" gap full.md hit with ship-coverage).
---

# /scan:scan-coverage — Does the suite scan itself?

The `/scan:*` suite grew one-enforcer-per-sprint to 40+ skills, and `/scan:full` is a **hand-maintained** tier list. It drifts: a scan gets built but never added to `/scan:full`, so the full-system health check silently skips it. `full.md` documents exactly this failure — `mc-ship-coverage` existed and passed but was never delegated ("the enforcer exists but isn't on the path"). This scan is the suite **auditing itself**, so that gap can't recur silently.

## Run

```bash
node scripts/checks/scan-coverage.js          # human-readable
node scripts/checks/scan-coverage.js --json   # machine-readable
```

## What it asserts (fail-closed)

1. **UNCOVERED** — every `/scan:<x>` skill is either delegated by `/scan:full` **or** on the exclusion allowlist (`scripts/checks/scan-coverage.allowlist.json`) with a reason.
2. **DANGLING** — every `/scan:<x>` that `full.md` references resolves to a real skill file.
3. **STALE-EXCLUSION** — the allowlist never excludes a scan that no longer exists.
4. **REASONLESS-EXCLUSION** — every exclusion carries a reason (a silent exclusion is just future drift).

Exit `0` clean · `1` findings · `2` setup error (**fail-closed** — a self-inventory that errors must never read green).

## The exclusion allowlist

`scripts/checks/scan-coverage.allowlist.json` lists scans intentionally NOT in `/scan:full`, each with a reason. An exclusion is a *claim* that the scan has no go/no-go signal for a full-system pass — e.g. `mc-layer-diff` is a read-only informational view (exit 0 always), not a health gate. Keep it **small**: prefer adding a scan to `/scan:full` over excluding it.

## When to run

- Inside `/scan:full` (Tier 2) — it audits the same suite it belongs to.
- After adding, renaming, or deleting any `/scan:*` skill — the fast way to confirm the aggregator stayed honest.

## Reference

- Engine: `scripts/checks/scan-coverage.js` (pure `evaluate()` + bite-test `scan-coverage.test.js`)
- Allowlist: `scripts/checks/scan-coverage.allowlist.json`
- Sprint: SP-20260531-004 (scan-suite reconciliation)
