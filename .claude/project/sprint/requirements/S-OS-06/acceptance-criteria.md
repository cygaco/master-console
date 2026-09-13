<!-- requirement-format-legacy -->
# Acceptance Criteria — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**PRD:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\prd.md`
**Build spec:** `runtime/S-OS-06/BUILD-SPEC.md` (authoritative; folds β r1/r2 + DoE + Quality Lead + Product Lead)

> ACs grounded in the Quality Lead consult (runtime/S-OS-06/design-consults/quality-lead-advisory.md) and
> β's amended DoD line 8. Story→requirement map (Product Lead correction): S-1→R-1, S-2/S-3/S-4→R-2, S-5→R-3, S-6→R-4, S-7→R-5.

## S-1 — codemod engine + total-partition (R-1)

- AC-1.1: Given the tracked tree, when `rename-mc.js --dry-run` runs, then it prints `unclassified=0` and every tracked file maps to exactly one of the four classes.
  verified_by: tests/regression/S-OS-06/partition-total.test.js::unclassified_is_zero
- AC-1.2: Given an already-applied tree, when `rename-mc.js --apply` re-runs, then it is a no-op (zero diff — idempotent).
  verified_by: tests/regression/S-OS-06/codemod.test.js::codemod-idempotent
- AC-1.3: Given the frozen Class-3/4 deny-list (its own committed file with a header stating its question, incl. the 5 generated views), when `--apply` would rewrite a deny-listed path, then it refuses.
  verified_by: tests/regression/S-OS-06/denylist.test.js::denylist-frozen-blocks-generated-views
- AC-1.4: Given a Class-1 file containing a Class-3 `warpos` literal, when the codemod runs, then every `warpos` hit is rewritten OR pinned in the committed occurrence ledger and it prints `unpinned-unrewritten=0`.
  verified_by: tests/regression/S-OS-06/occurrence-ledger.test.js::two-grain-partition-total

## S-2 — deprecated-alias skills (R-2)

- AC-2.1: Given a legacy `warp:*` or `scan:warpos-*` skill invocation, when resolved, then it resolves to its `mc:*` target AND emits exactly one deprecation warning.
  verified_by: tests/regression/S-OS-06/alias-map.test.js::alias-map-resolves-and-warns
- AC-2.2: Given the committed alias MAP, when a shim (skill or `warpos-*.js` check) exists without a map entry, then the check fails.
  verified_by: tests/regression/S-OS-06/alias-map.test.js::alias-map-complete

## S-3 — env read-both + dir fallback (R-2)

- AC-3.1: Given both `MC_X` and `WARPOS_X` set, when the read-both helper reads, then `MC_X` wins; given only `WARPOS_X`, it falls back and emits one deprecation warning (canonical-precedence contract).
  verified_by: tests/regression/S-OS-06/env-read-both.test.js::env-read-both-precedence
- AC-3.2: Given dual-conflicting state (env or dir), when the helper reads, then it diagnoses the divergence deterministically; fixtures cover legacy-only / new-only / dual-identical / dual-conflicting.
  verified_by: tests/regression/S-OS-06/split-brain.test.js::dual-state-diagnosed
- AC-3.3: Given a raw `process.env.(MC|WARPOS)_` read outside the helper, when the enforcer runs, then it fails.
  verified_by: tests/regression/S-OS-06/env-read-both.test.js::no-raw-env-read-outside-helper

## S-4 — tracked-transients workflow shim (R-2, Class-2)

- AC-4.1: Given the `scripts/checks/warpos-tracked-transients.js` → `mc-tracked-transients.js` rename, when it lands, then the one-line alias shim (old name requiring the new) is in the SAME commit and `leak-gate.yml` is unedited.
  verified_by: tests/regression/S-OS-06/shim-co-commit.test.js::transients-shim-present-and-workflow-unedited
- AC-4.2: Given `leak-gate.js:35`, when the codemod runs, then the literal `warpos-tracked-transients.js` is pinned (occurrence ledger) so `leak-gate.test.js` workflow-sync still passes.
  verified_by: scripts/checks/leak-gate.test.js

## S-5 — paths registry values (R-3)

- AC-5.1: Given the registry SOURCE (framework/paths.registry.json — VALUES, no warpos keys), when values change `_warpos/*`→`_mc/*` etc. and `build.js` runs, then the changes survive in all generated views and no old value remains in source.
  verified_by: tests/regression/S-OS-06/paths-registry.test.js::paths-values-survive-regen
- AC-5.2: Given the codemod, when it runs, then no generated view is hand-edited (each matches a fresh regen byte-for-byte).
  verified_by: tests/regression/S-OS-06/paths-registry.test.js::generated-views-match-regen

## S-6 — downstream migration (R-4)

- AC-6.1: Given the fixture product (Pantry Pilot from `_warpos/BASELINE` → `runtime/S-OS-06/fixture-product/`), when `migrations/1.2.0-to-2.0.0/` runs, then `_warpos/→_mc/`, `.warpos/→.mc/`, `WARPOS.md→MC.md`, settings/hooks rewired, and the migrated product boots.
  verified_by: tests/regression/S-OS-06/migration.test.js::fixture-product-migrates-and-boots
- AC-6.2: Given the migration's own `warpos` literals (its DATA), when purity/codemod runs, then they are Class-3 pinned and NOT rewritten.
  verified_by: tests/regression/S-OS-06/migration.test.js::migration-data-literals-pinned
- AC-6.3: Given each product named in the portfolio registry, when the migration is assessed, then it either upgrades via the migration OR is recorded not-live with its registry line (ceiling: migration exercised on the fixture only).
  verified_by: tests/regression/S-OS-06/migration.test.js::every-product-upgrades-or-recorded

## S-7 — gates + framework-purity flip + 2.0.0 cut (R-5)

- AC-7.1: Given the cutover gate, when it runs, then it reads a FROZEN committed allow-list where every entry carries a one-line warrant, and EMITS per allow-listed dir the suppressed `warpos` count (printed, not swallowed).
  verified_by: tests/regression/S-OS-06/cutover-gate.test.js::gate-emits-suppressed-counts
- AC-7.2: Given framework-purity, when it runs, then it FAILS on `warpos` in any LIVE dir and PASSES on allow-listed historical dirs.
  verified_by: tests/regression/S-OS-06/purity.test.js::purity-fails-live-passes-historical
- AC-7.3: Given the record-trust falsifier fixtures F1-F8, when the suite runs, then each is present and fails CLOSED as specified (a missing F1-F6 blocks build-entry).
  verified_by: tests/regression/S-OS-06/falsifiers.test.js::all-falsifiers-present-and-fail-closed
- AC-7.4: Given the release, when gates run, then `npm test` + `npm run leak-gate` + readme-drift are green, version=2.0.0, CHANGELOG has a `[2.0.0]` entry naming the alias-removal release (2.1.0), and both manifests are regenerated LAST (fm→installed→_mc).
  verified_by: tests/regression/S-OS-06/release-gates.test.js::release-gates-green
- AC-7.5: Given the invariants, when checked, then `warpos@*` tags still exist (git tag, not grep) and HOME-anchored state reads `~/.mc` then `~/.warpos` without auto-move.
  verified_by: tests/regression/S-OS-06/invariants.test.js::tags-and-home-state
