---
description: Run /warp:update across every registered portfolio product sequentially. No fail-fast — failures captured in the final summary.
---

# /portfolio:sync — Portfolio-Wide MC Update

Iterate the portfolio registry and run `/warp:update` against each product. Sequential (not parallel) to avoid gh rate-limit risk per the Plan Contract.

## Usage

```
/portfolio:sync
```

No arguments. Reads `~/.mc/portfolio.json` and processes every entry.

## Implementation

```bash
node scripts/portfolio/sync.js
```

The script:
1. Loads the registry via `scripts/portfolio/registry.js#load()`.
2. For each product: emits C-13 per-product line, spawns `node ../MC/scripts/mc/update.js --target <repo_path>` with a 5min timeout.
3. **No fail-fast** (AC-8.2) — capture per-product failure in the summary and continue.
4. Skip rows when `repo_path` no longer exists (emit SKIP, don't abort).
5. Print final summary table: SLUG / FROM / TO / RESULT.
6. Exit code 0 only when all products succeed; ≥1 failure → exit 1 (but every product was still attempted).

## Telemetry

TR-11 fires at start, once per product (`phase: per_product`), and once at end.

## Reference
- AC-8.1, AC-8.2
- COPY C-13
- TRACE TR-11
- Sprint SP-20260521-001 / T-20260521-175
