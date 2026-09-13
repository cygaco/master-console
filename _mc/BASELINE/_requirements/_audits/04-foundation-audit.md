# Foundation Audit Report

**Date:** 2026-03-30
**Canonical docs:** 8 (_requirements/00-canonical/)
**Design system docs:** 6 (_requirements/01-design-system/)
**Copy system docs:** 4 (_requirements/02-copy-system/)
**Integration docs:** 8 (_requirements/09-integrations/PROVIDER/)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 2 |
| LOW | 3 |

## Agent Risk Assessment

Foundation docs are well-maintained and consistent. If agents read these as-is: (1) page-to-phase naming inversion (PrepPage hosts PLAN, PlanPage hosts PREP) will confuse builders who don't read GLOSSARY. Terminology is fully consistent — no drift found across 14 features.

## Findings

### 1. Glossary — Terminology

Terminology is **consistent across all docs**. Grep verification for 5 key term pairs found zero drift:

| Term | Canonical | Variants Found | Status |
|---|---|---|---|
| market analysis (output) / market research (feature) | Both used correctly in scope | None | PASS |
| usage quota | "usage" only | No "credits" or "tokens" | PASS |
| auto-cart | Hyphenated everywhere | No "automatic cart" | PASS |
| deep-dive-qa / mining Q&A | Both used contextually | No confusion | PASS |
| readiness labels | 0-39/40-69/70-89/90-100/100+ | Previously incorrect ranges fixed | PASS |

### 2. Product Model

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | PASS | All 14 features in _requirements/04-features/ have PRODUCT_MODEL entries | N/A |
| 2 | PASS | Data dependency chain accurate | N/A |
| 3 | PASS | Quota costs match across GLOSSARY, PRDs, and INTEGRATION-MAP | N/A |

### 3. Golden Paths

| # | Severity | Finding | Fix |
|---|---|---|---|
| 4 | PASS | All 4 golden paths match FLOW_SPEC.md entry/exit states | N/A |
| 5 | PASS | All 10 steps covered across paths | N/A |

### 4. Failure States

| # | Severity | Finding | Fix |
|---|---|---|---|
| 6 | PASS | All failure modes have recovery strategies (CS-001 through CS-009 + ERROR_RECOVERY.md) | N/A |

### 5. Design System

| # | Severity | Finding | Fix |
|---|---|---|---|
| 7 | PASS | COLOR_SEMANTICS.md ↔ DESIGN_TOKENS.md — perfect alignment | N/A |
| 8 | PASS | COMPONENT_LIBRARY.md ↔ COMPONENT_HIERARCHY.md — names match | N/A |
| 9 | PASS | FEEDBACK_PATTERNS.md ↔ CS-002/CS-003 — patterns match shared stories | N/A |
| 10 | PASS | ANIMATION_MOTION.md ↔ DESIGN_TOKENS.md — animation tokens match | N/A |

### 6. Copy System

| # | Severity | Finding | Fix |
|---|---|---|---|
| 11 | PASS | COPY_STRATEGY.md voice/tone followed in spot-checked features | N/A |
| 12 | PASS | SURFACE_MAP.md covers 29 surfaces across 6 tiers | N/A |
| 13 | PASS | deep-dive-qa/COPY.md exists (agent false positive — file verified on disk) | N/A |
| 14 | PASS | grocery-export/COPY.md exists (agent false positive — file verified on disk) | N/A |
| 15 | MEDIUM | All features should have COPY.md verified during preflight — add existence check | Add COPY.md preflight check |

### 7. Architecture Naming

| # | Severity | Finding | Fix |
|---|---|---|---|
| 16 | HIGH | Page-to-phase naming inversion (PrepPage=PLAN, PlanPage=PREP) — documented but confusing | Add "Platform Clarity" section to COMPONENT_HIERARCHY; recommend builders use getScreen() |
| 17 | MEDIUM | FLOW_SPEC references page names, not logical phase names — requires GLOSSARY cross-reference | Expand FLOW_SPEC naming debt section |

### 8. Recipe Index Integration

| # | Severity | Finding | Fix |
|---|---|---|---|
| 18 | PASS | Dataset ID ri_lpfll7v5hcqtkxl6l consistent across all docs | N/A |
| 19 | PASS | Known issues (pack prices on weight-sold items, thin data, unit regex) still accurate | N/A |
| 20 | LOW | Recipe Index known issues not consolidated in integration docs (only in CLAUDE.md) | Add Known Issues section to Recipe Index overview doc |

### 9. Strategic Docs

| # | Severity | Finding | Fix |
|---|---|---|---|
| 21 | PASS | EVOLUTION.md now distinguishes DONE vs FUTURE items (fixed in prior audit) | N/A |
| 22 | PASS | CORE_BRIEF.md matches current product scope | N/A |
| 23 | LOW | Historical fix: readiness score ranges corrected from 0-19/20-39 to 0-39/40-69 | Already resolved |
| 24 | LOW | Historical fix: Recipe Index API format corrected from URL to keyword-based | Already resolved |

## Top 5 Actions Before Next Run

1. **Add naming debt clarity to COMPONENT_HIERARCHY.md** — explain PrepPage/PlanPage inversion prominently (1 finding)
2. **Add COPY.md existence check to preflight/evaluator** — ensure every feature with user-facing stories has COPY.md (1 finding)
3. **Consolidate Recipe Index known issues** into integration docs overview (1 finding)
