---
description: Read-only product-vs-dev-tooling layer diff — lists which framework-owned paths SHIP to consumer products (product layer) vs which stay framework-internal and never ship (dev-tooling layer), with summary counts. Cross-references _mc/MANIFEST.json (ownership) × .claude/framework-manifest.json (shipped). Informational, never a gate.
---

# /scan:mc-layer-diff — Product vs dev-tooling layer diff

A read-only observability view of the MC framework/product boundary. It answers, at a glance: **of everything MC owns as `framework`, which paths actually SHIP to consumer products (the product layer) and which stay framework-internal (the dev-tooling layer)?**

This is the read-only **complement** to `/scan:mc-ship-coverage`: ship-coverage is the *fail-closed gate* ("every framework-owned path under the essential roots must ship or be allowlisted; `_guides` ships, `_planning`/`_reports` never ship"); this scan just **shows the split** without judging it.

## Run

```bash
node scripts/checks/mc-layer-diff.js          # human-readable report
node scripts/checks/mc-layer-diff.js --json   # machine-readable
node scripts/checks/mc-layer-diff.js --root <dir>   # scan another install
```

## Output

Three sections (plus a glanceable count header):

1. **PRODUCT LAYER** — `owner=framework` paths that are in the shipped manifest (reach consumer products via `/mc:setup` + `/mc:update`).
2. **DEV-TOOLING LAYER** — `owner=framework` paths NOT in the shipped manifest (framework-internal: tests, dev-only top-level scripts, one-off tooling, etc.).
3. **SUMMARY** — counts (product · dev-tooling · total framework-owned).

`--json` emits `{ product_layer: [...], dev_tooling_layer: [...], summary: {...} }`.

## Semantics

- **Data sources:** `_mc/MANIFEST.json` (the per-path ownership truth) × `.claude/framework-manifest.json` (the shipped-asset truth). No new data — same inputs `scan:mc-ship-coverage` reads.
- **Read-only:** writes nothing.
- **Exit codes:** `0` = report emitted (regardless of the split — it is informational, not a gate); `2` = setup error (a manifest is missing or invalid). A missing manifest fails loudly rather than printing a misleading empty diff.
- Only `owner=framework` paths are considered (the "MC layers"); `generated`/`project`/`runtime` paths are out of scope by design.

## Reference

- Script: `scripts/checks/mc-layer-diff.js`
- Sibling gate: `/scan:mc-ship-coverage` (fail-closed ship boundary, SP-20260531-002, ADR-0005)
- Sprint: `SP-20260531-003`
