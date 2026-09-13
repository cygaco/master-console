# ADR 0001 - Build /warp:promote in DevRepo First

**Date:** 2026-05-01
**Status:** accepted
**Class:** B (architecture and release process)

> **Note (D-2, 2026-06-08):** the dev repo's brand name is genericized to `DevRepo` here per the framework branding boundary (no product slug ships in framework). The historical decision is unchanged.

---

## Decision

Build `/warp:promote` in the DevRepo repository first, then use it to promote framework-owned assets into the canonical MC repository.

## Context

DevRepo is the further-along development repository for the Alex/MC framework. It already contains the active agent specs, hook system, path registry, release capsules, migration scripts, and product-tested failure fixes. The separate MC repository is the shipped installable product, but at the time of this decision it lagged behind DevRepo.

The Phase 4 plan needed a promotion engine that can compare framework-owned assets, exclude project/runtime data, classify changes, and produce a safe promotion plan. Building that engine directly in the less-complete canonical repo would require first backporting the same assets manually, which is exactly the drift class the engine is meant to eliminate.

## Options considered

1. **DevRepo first:** Build and validate `/warp:promote` where the current framework actually lives.
2. **MC first:** Pause DevRepo framework work, manually backport enough state to MC, then build the engine there.
3. **Parallel implementation:** Build separate promote scripts in both repositories and reconcile later.

## Decision criteria

| Criterion | DevRepo first | MC first | Parallel |
|---|---|---|---|
| Product fit | high | medium | low |
| Simplicity | high | low | low |
| Reliability | high | medium | low |
| Reversibility | high | medium | low |
| Drift reduction | high | medium | low |

## Why this option won

DevRepo-first scored highest because it keeps the promotion engine close to the most complete source of truth and avoids a manual sync prerequisite. The engine is reversible because its Phase 4 baseline is dry-run only, and the actual apply path stays gated behind classification, review, and release checks.

## Risks

- DevRepo-specific files may accidentally enter a promotion plan.
- The canonical MC repository remains behind until promotion is run.
- The source of truth can be confusing if humans assume the shipped repo is always ahead.

## Mitigations

- `/warp:promote` classifies framework, generated, runtime, project, secret, template-review, and migration-candidate files separately.
- Runtime and project paths are excluded by manifest owner and path prefix.
- `NEXT-WARP.md` records that DevRepo is the framework dev repo and MC is the shipped product.
- Phase 4 keeps apply mode dry-run until the target clone path and post-promotion gates are wired.

## Reversal plan

If MC becomes the more complete development repo, move the promote engine there and reverse the direction: MC becomes source, DevRepo becomes a consumer. The trigger would be a release where MC contains a newer framework manifest and DevRepo has no framework-only changes not already promoted.

## References

- `NEXT-WARP.md` Section 9, ADR-001
- `NEXT-WARP.md` Section 10, decision Q3
- `scripts/mc/promote.js`
- `CLAUDE.md` cross-repo parity rule
