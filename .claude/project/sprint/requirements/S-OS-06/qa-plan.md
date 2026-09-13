# QA Plan — Rebrand identifier layer: Master Console slug mc, mc@2.0.0 with one-release aliases + downstream migration

**Sprint:** `S-OS-06`
**PRD:** `C:\Users\Vlad\Desktop\Claude\Projects\WarpOS\.claude\project\sprint\requirements\S-OS-06\prd.md`
**Build spec:** `runtime/S-OS-06/BUILD-SPEC.md`

> Sprint v0.1 QA plan. Honored by `/sprint:execute` (mid-sprint checks) and `/sprint:release` (final QA gate).
> HIGH-risk keystone tree-shift where the verification gates are rewritten in the same sprint — the exit-0-that-lies surface.

## Smoke checks

- [ ] `rename-mc.js --dry-run` runs clean, prints per-category counts + `unclassified=0` + `unpinned-unrewritten=0`.
- [ ] `npm run leak-gate` green (5 gates + npm test) after the cut.

## Record-trust falsifier fixtures (BLOCKING, required-present, must FAIL CLOSED, OBSERVED RED before T3 --apply)

Baseline-first: each must be observed RED (plant, learn which lever trips, mutate that lever) BEFORE build-entry. A missing F1-F6 BLOCKS build.
- [ ] F1 live-warpos-off-allowlist → framework-purity exit 1 (RED)
- [ ] F2 unwarranted-allowlist-entry → cutover gate exit ≠0 (RED)
- [ ] F3 truncated/empty allow-list → gate fails CLOSED exit 2, not green (RED)
- [ ] F4 unclassified-tracked-path → codemod --apply refuses (RED)
- [ ] F5 codemod-touches-generated-view (.claude/paths.json / paths.generated.js / both manifests / _warpos/MANIFEST.json) → --apply refuses (RED)
- [ ] F6 codemod-rewrites-Class-3-migration-data → pin-test fails (RED)
- [ ] F7 stale/hollow allow-list entry → surfaced as stale
- [ ] F8 post-freeze silent allow-list addition (folded into a gate-fixing commit) → fails
- [ ] Split-brain (Product Lead): legacy-only / new-only / dual-identical / dual-conflicting env+dir fixtures diagnosed deterministically

## Per-story QA

### S-1 codemod (R-1)
- [ ] AC-1.1 unclassified=0 · AC-1.2 idempotent · AC-1.3 deny-list frozen blocks generated views · AC-1.4 two-grain occurrence ledger
- [ ] Regression: re-run --apply twice = zero diff; static require/path-literal resolver over scripts/** clean
### S-2 alias skills (R-2)
- [ ] AC-2.1 resolves+warns · AC-2.2 alias map complete
### S-3 env read-both (R-2)
- [ ] AC-3.1 precedence · AC-3.2 dual-state diagnosed · AC-3.3 no raw env read outside helper
### S-4 tracked-transients shim (R-2, Class-2)
- [ ] AC-4.1 shim co-commits + workflow unedited · AC-4.2 leak-gate.js:35 pinned, leak-gate.test.js green
### S-5 paths registry (R-3)
- [ ] AC-5.1 values survive regen · AC-5.2 generated views match fresh regen (no hand-edit)
### S-6 migration (R-4)
- [ ] AC-6.1 fixture product migrates + boots · AC-6.2 migration DATA pinned · AC-6.3 every product upgrades-or-recorded
### S-7 gates + 2.0.0 (R-5)
- [ ] AC-7.1 emitted suppressed counts · AC-7.2 purity fails-live/passes-historical · AC-7.3 F1-F8 present + fail closed · AC-7.4 release gates green + version 2.0.0 + CHANGELOG names 2.1.0 removal · AC-7.5 tags + HOME state invariants

## Gauntlet lanes (minimum, Quality Lead)

- [ ] qa-reviewer (functional + integrity) — BINDING: partition totality, deny-list freeze, alias-map completeness, no generated-view edits
- [ ] test-runner — executes F1-F8 + the fixture-product migration boot
- [ ] security-reviewer — cross-family, ≥1 non-Claude corpus (the false-green class is adversarial; a same-family reviewer shares the author's blind spot)
- [ ] EXECUTION-ACCESS required — gates RUN + observed RED-then-GREEN on real disk; no dry-review-only pass
- [ ] design-quality / visual-review — N/A (no rendered UI)

## Cross-cutting QA

- [ ] `npm test` passes · [ ] `npm run leak-gate` green · [ ] readme-drift green · [ ] both manifests regen LAST (fm→installed→_mc), BC-02/BC-05 clean
- [ ] No `secret: true` env-var values in any tracked file
- [ ] The single biggest false-green (allow-list silent catch-all): suppressed-counts reviewed as NUMBERS, not trusted green; post-freeze additions are separate warranted amendments

## External service QA

- [ ] No external service. Tag push + push-to-main are operator-run (out of band).

## Documentation scaling

`documentation_scale: m` cut. Red-team plan in `redteam-plan.md`.
