<!-- requirement-format-legacy -->
# TRACE Requirements — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**PRD:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\prd.md`

> TRACE captures the observability, traceability, event capture, decision
> logging, and requirement-to-code linkage layer. The point of TRACE is
> to answer: why did this exist, where did the requirement come from,
> what changed because of it, what external dependency or approval was
> required, how was it tested, what shipped, and what should persist as
> a learning.

## Trace Map

> One row per requirement area (R-1..R-N, single-source from plan_contract.requirement_areas,
> T-298). Fill in Ticket, Code, and Test columns during execution.

> Story→requirement map corrected per the Product Lead consult: S-1→R-1, S-2/S-3/S-4→R-2, S-5→R-3, S-6→R-4, S-7→R-5.

| Source | Requirement | Story | COPY | INPUT | ESD | Ticket | Code | Test | Release | Learning |
|---|---|---|---|---|---|---|---|---|---|---|
| operator: slug `mc` confirmed 2026-09-13 | R-1 | S-1 | C-1 | IN-1 | — | T1 | scripts/open-source/rename-mc.js | tests/regression/S-OS-06/partition-total.test.js | RL (T5) | — |
| operator: slug `mc` confirmed 2026-09-13 | R-2 | S-2, S-3, S-4 | C-2 | IN-2 | — | T2, T3 | .claude/commands/{warp,scan}/*, scripts/checks/warpos-*.js shims, env helper | tests/regression/S-OS-06/alias-map.test.js, env-read-both.test.js, shim-co-commit.test.js | RL (T5) | — |
| operator: slug `mc` confirmed 2026-09-13 | R-3 | S-5 | C-3 | IN-3 | — | T4 | framework/paths.registry.json + build.js | tests/regression/S-OS-06/paths-registry.test.js | RL (T5) | — |
| operator: slug `mc` confirmed 2026-09-13 | R-4 | S-6 | C-4 | IN-4 | — | T4 | migrations/1.2.0-to-2.0.0/** | tests/regression/S-OS-06/migration.test.js | RL (T5) | — |
| operator: slug `mc` confirmed 2026-09-13 | R-5 | S-7 | C-5 | IN-5 | — | T2, T5 | cutover-completeness.js, framework-purity.js, falsifier fixtures | tests/regression/S-OS-06/cutover-gate.test.js, purity.test.js, falsifiers.test.js | RL (T5) | — |

## TR-1 — R-1 codemod engine + inventory: an idempotent scripts/open-source/rename-mc.js with --dry-run (writes runtime/S-OS-06/rename-plan.json: path renames via git mv + content rules per category — env, skill namespace, dirs, paths keys, identifiers, prose) and --apply, plus a committed rule ledger and per-category before/after counts

**Event:** (fill)
**When:** (fill)
**Captured fields:** (fill)
**Linked requirement:** `R-1`
**Linked story:** `S-1`
**Why we capture this:** (fill)

## TR-2 — R-2 one-release aliases + read-both compat: warp:* -> deprecated-alias skills pointing at mc:*; scan:warpos-* -> scan:mc-* alias skills; warpos-*.js check scripts -> shims requiring mc-*.js (incl. the workflow-referenced warpos-tracked-transients.js); an env helper reading MC_X then WARPOS_X with a one-time deprecation warning; _warpos//.warpos/ fallback read; a role-aliases-style skill-id map

**Event:** (fill)
**When:** (fill)
**Captured fields:** (fill)
**Linked requirement:** `R-2`
**Linked story:** `S-2`
**Why we capture this:** (fill)

## TR-3 — R-3 paths registry rename: /paths:rename per key, scripts/paths/build.js regen, and a verify step that the renamed keys survive in the generated views (source-vs-generated + rename-both-layers rule)

**Event:** (fill)
**When:** (fill)
**Captured fields:** (fill)
**Linked requirement:** `R-3`
**Linked story:** `S-3`
**Why we capture this:** (fill)

## TR-4 — R-4 downstream migration: migrations/1.2.0-to-2.0.0/ renaming _warpos/->_mc/, .warpos/->.mc/, WARPOS.md->MC.md and rewriting settings/hook wiring for the 8 downstream products, proven on a fixture product copied from _warpos/BASELINE (Pantry Pilot) into runtime/S-OS-06/fixture-product/ (gate G5)

**Event:** (fill)
**When:** (fill)
**Captured fields:** (fill)
**Linked requirement:** `R-4`
**Linked story:** `S-4`
**Why we capture this:** (fill)

## TR-5 — R-5 gates + version + manifests: npm test green, npm run leak-gate green, /scan:cutover-completeness green, framework-purity fails on 'warpos' in LIVE dirs (historical dirs allow-listed), readme-drift green, package.json + manifests bumped to 2.0.0, CHANGELOG [2.0.0] entry, and BOTH manifests regenerated LAST (fm -> installed -> _mc) before each commit

**Event:** (fill)
**When:** (fill)
**Captured fields:** (fill)
**Linked requirement:** `R-5`
**Linked story:** `S-5`
**Why we capture this:** (fill)
