---
description: Diff canonical MC against an installed product — version/staleness, framework-file drift (stale vs locally-modified), coverage gaps, and skills/agents/hooks delta. Read-only; reports on the product, never edits it.
---

# /warp:diff — Canonical ↔ Product Divergence Report

Show exactly how an installed product's MC differs from **this** canonical checkout: what version it's on, which framework-owned files have drifted (and whether the product is just *stale* or has *locally modified* them), which framework files/skills/agents/hooks it's missing or carries extra.

**Read-only and canonical-side.** This reads the product repo to compute the diff; it **never writes** to it (the MC-only / products-operate-in-their-own-session boundary — see `[[feedback_mc_only_no_cross_project]]`). To actually update a product, run `/warp:update` *inside that product's own session*.

## Usage

```
/warp:diff <slug>              # resolve the product via the portfolio registry
/warp:diff --product <path>    # diff an explicit product root
/warp:diff <slug> --json       # machine-readable report
```

`<slug>` is a registered portfolio product (see `/portfolio:list`). A path that is an existing directory is used directly.

## Procedure

Run the engine — it does all the work:

```
node scripts/mc/diff.js <slug|--product PATH> [--json]
```

Then summarize the report for the operator. The engine compares:

| Section | What it surfaces |
|---|---|
| **version + staleness** | product `installedVersion` vs canonical `version.json`; `product_behind` / `product_ahead` / `same`; registry `last_synced` age (when resolved by slug) |
| **framework file drift** | framework-owned files whose on-disk content differs from canonical, sub-classified: `product_stale` (unchanged since install — canonical moved on, a clean `/warp:update` would fix), `product_modified` (locally edited — an update would conflict), `missing_in_product` |
| **coverage gaps** | framework files canonical ships that the product lacks (missing) and framework files the product carries that canonical dropped (extra) |
| **skills/agents/hooks Δ** | counts + lists of each `kind` present in canonical but missing in the product, and vice-versa |

## Interpreting it

- **Lots of `product_stale` + `product_behind`** → the product is simply out of date; recommend `/warp:update` in its session.
- **`product_modified` files** → the product has local edits to framework-owned files; an update will conflict there. Flag these for the operator — they're the real merge risk.
- **`extra_in_product`** → either product-only additions or files removed from canonical since install; worth a closer look.
- **`missing_in_product` skills/agents/hooks** → capabilities the product never received (often a capsule that didn't include them — cross-reference the install-baseline gaps).

## Boundaries

- Never edits the product. If the diff reveals work to do, hand it off (`/portfolio:open <slug>` then `/warp:update` there).
- Builds on `/portfolio:status`, `/warp:check`, and the `/scan:mc-*` family — this is the **divergence** view that unifies "how stale" + "how diverged" + "what's missing" into one report.
- Exit code is `0` even when divergence is found (divergence is informational); `2` only on a usage/resolution error (no slug+path, product has no readable `.claude/framework-installed.json`).
