---
description: Cutover gate — greps the IMPERATIVE layer + keystone registries for RAW deleted-old-tree literals (00-alex/01-adhoc/02-oneshot/03-managers) + renamed-away role names, fail-closed. Catches the staleness role-parity can't, because it checks raw literals NOT alias-resolved roles (the alias table masks cutover-incompleteness).
---

# /scan:cutover-completeness — Did the rename actually finish?

A tree-wide rename/cutover (the `00-alex/01-adhoc/02-oneshot/03-managers` tree → `president/engineering/product/growth/_system`, plus the role renames `product-designer`→`design-lead`, `web-conversion-designer`→`conversion-lead`, `research-insight-lead`→`research-lead`, `growth-lead`→`marketing-lead`) is only **done** when the **imperative layer** is migrated too — runtime path consumers, hooks, the paths registry + fallback tables, fixtures, and the keystone registries. <!-- stale-ok: this gate documents the renamed-away role names it greps for; naming them is its purpose, not a stale dispatch -->

`/scan:role-parity` does **not** cover this. It asserts the declarative role↔spec bijection, so it can pass while scripts or the `paths.js` fallback table still point at a deleted tree. **Worse:** `scripts/hooks/lib/role-aliases.js` resolves old→new, so `manager-principles` + `role-parity` scan GREEN on **stale registry data** — the staleness is invisible.

**The key insight:** this gate greps the **RAW literals**, NOT the alias-resolved roles. *A passing alias-resolved scan is not evidence the source is clean.*

## Run

```bash
node scripts/checks/cutover-completeness.js          # human-readable
node scripts/checks/cutover-completeness.js --json   # machine-readable (findings + allowed)
```

## What it asserts (fail-closed)

One invariant: **no deleted-old-tree path literal and no renamed-away role name appears as LIVE (non-comment, non-`was:`) content** in the imperative layer or the keystone registries.

- **Targets** — the layer role-parity misses: `scripts/hooks/lib/paths.js` + `paths.generated.js` + `.claude/paths.json` + `framework/paths.registry.json` (incl. the `LEGACY_FALLBACK` table), all of `scripts/hooks/**` + `scripts/checks/**` + `scripts/sprint/**`, the live dispatch/manifest scripts, `fixtures/**`, and the keystone registries (`_principles/registry.json`, `_org/role-registry.json`, `_evals/*.json`). Bite-tests (`*.test.js`) are excluded by construction — they deliberately embed old names to test detection.
- **Literals** — dead-tree dirs `00-alex` · `01-adhoc/` · `02-oneshot/` · `03-managers`; renamed-away roles `product-designer` · `web-conversion-designer` · `research-insight-lead` · `growth-lead` (matched as whole tokens, so `research-lead` never false-matches `research-insight-lead`). <!-- stale-ok: these are the gate's grep targets, documented by design -->

Exit `0` clean · `1` at least one live-stale ref · `2` runner/allowlist error (**fail-closed** — a cutover gate that errors must never read green).

## What it allowlists (the false-positive guard)

The flag/allow decision is in the pure `evaluate()`. A hit is **suppressed** when it is:

1. inside a `//`, `#`, or `/* */` **comment** (migrated-from / ADR-context comments),
2. the value of a JSON `"was":` field (the historical record of a rename — a path that *moved* still flags; only the role-NAME history is exempt),
3. in a **file** on `cutover-completeness.allowlist.json` `files` (e.g. `role-aliases.js` itself, the detector + allowlist, the cutover-coexistence `LEGACY_TREE` shim in `dispatch-agent.js`),
4. under an allowlisted **prefix** (`framework/releases/*` frozen capsules, the ADR-0007 doc dir).

Each allowlist entry carries a **reason**; an entry that matches nothing is surfaced as a stale-allowlist note.

## When to run

- Inside `/scan:full` (Tier 2 governance) — the rename/cutover gate, so a future tree rename can't ship a half-migrated mode.
- After any tree-wide rename, role rename, or directory move — confirm the **imperative** layer caught up, not just the declarative bijection.

## Reference

- Engine: `scripts/checks/cutover-completeness.js` (pure `evaluate()` + bite-test `cutover-completeness.test.js`)
- Allowlist: `scripts/checks/cutover-completeness.allowlist.json`
