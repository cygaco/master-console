# UI/UX & Web-Conversion Design-Principles Taxonomy — Deep Research Synthesis

**Date:** 2026-06-01
**Method:** Real Deep Research pipeline. Claude 3-round search SUCCEEDED (carries the deliverable). OpenAI o3-deep-research FAILED on Phase 4 (quota/billing). Gemini Deep Research SKIPPED (depleted credits).
**Brief by:** Claude (Gemini CLI brief route blocked by dispatch-route-guard → sanctioned "Claude writes it" fallback).
**Original query:** What is the canonical, evidence-based taxonomy of UI/UX & web-conversion design PRINCIPLES that a designer must master?
**Estimated cost:** ~$1.00-2.00 (OpenAI ran 3 of 4 phases before quota cutoff; partial phases discarded) + Claude search (included). Gemini $0 (skipped). Under the $5 autonomous ceiling.

## Engines

| Engine | Method | Status |
|---|---|---|
| Claude | 3-round WebSearch (22 searches) + WebFetch (8 fetches, 5 verified) | SUCCEEDED — carries the deliverable; see claude-report.md |
| OpenAI | o3-deep-research, 4-phase Responses API | FAILED (no report) — phases 1-3 (Landscape/Mechanics/Failure-Modes) completed, but Phase 4 (Contrarian) hit "exceeded your current quota" (billing); o4-mini fallback hit the same quota wall immediately. Runner aborts + discards partial phase files on any phase failure, so no openai-report.md was assembled. See openai-error-*.log. |
| Gemini | deep-research-pro Interactions API | SKIPPED — prepay credits depleted (API key, HTTP 429) + OAuth scope insufficient (HTTP 403). See gemini-error.log. |

> **Single-engine synthesis.** Only the Claude engine produced a usable report (both paid APIs hit
> billing/quota walls). The taxonomy is nonetheless high-confidence: it is grounded directly in 5
> verified primary authorities (NN/g, Laws of UX, Refactoring UI, WCAG 2.2, Gestalt/IxDF) plus the
> CXL/Baymard conversion strand, with 5 load-bearing source URLs fetch-verified. Confidence is reduced
> only on the cross-engine triangulation dimension, not on the source grounding.

## Executive Summary

The canonical principle literature converges on a stable core. Reconciling five authorities (NN/g 10
heuristics, Laws of UX, Gestalt, Refactoring UI, WCAG 2.2) plus the conversion strand (CXL/Baymard)
deduplicates to a **19-topic taxonomy (11 core / 8 standard) across six clusters** — Foundations, Visual Craft, Interaction,
Accessibility, Conversion, Systems/Cross-cutting. The taxonomy fully covers the design-quality 6 axes
and visual-review 7 categories with no gap, spans both app-UI and web-conversion, and every topic
yields checkable rules. Modern principle areas the classic heuristic lists omit but the agents must
check — content/microcopy, performance-as-UX, motion, and ethics/dark-patterns — are included as
explicit topics.

## High-Confidence Insights (verified against primary sources)

1. **The high-consensus core** (every authority touches): visual hierarchy, typography, color/contrast,
   layout/spacing, accessibility, feedback/system-status, consistency. → these are the `core`-tier topics. (HIGH)
2. **Accessibility yields the most mechanically-checkable rules** — WCAG 2.2 SC 1.4.3 contrast ≥4.5:1
   and SC 2.5.8 target size ≥24×24px **verified live** at w3.org/TR/WCAG22. (HIGH)
3. **Refactoring UI's section structure is the right teachable granularity** — it separates
   hierarchy / layout&spacing / typography / color / depth / images / finishing-touches; folds the 30
   Laws of UX into a few cognitive/hierarchy/interaction topics. Verified TOC at refactoringui.com. (HIGH)
4. **Conversion is a distinct cluster** — above-fold value prop + single dominant CTA + hook→proof→CTA
   + friction/trust/forms — adjacent to but not subsumed by product-UI craft. (HIGH)
5. **Four modern additions belong as topics** — content/microcopy (→ visual-review `copy`),
   performance/Core Web Vitals (→ `console-error`/`regression`), motion (→ `regression`/`a11y`),
   ethics/dark-patterns (→ claims-boundary). deceptive.design/Brignull verified live. (HIGH)

## Sub-Question Answers

- **SQ (granularity):** ~14-18 topics is right; one coherent teachable topic per guide. Typography is
  one topic; color+contrast one; layout/spacing/grid one. Confidence HIGH.
- **SQ (app vs conversion clustering):** Shared foundations (hierarchy/type/color/space/Gestalt/a11y/
  consistency) + a web-specific conversion cluster + cross-cutting systems layer. Confidence HIGH.
- **SQ (checkable vs judgment):** Mechanically checkable — contrast, target size, type scale, token
  usage, heading order, field labels, CLS, console errors. Judgment — hierarchy, cohort fit,
  conversion-leak. Both kinds are captured per topic. Confidence HIGH.
- **SQ (gaps in heuristic lists):** content design, performance UX, motion, ethics/dark-patterns,
  i18n. First four are standalone topics; i18n folded into accessibility/typography. Confidence HIGH.

## Hallucination Check

Spot-verified 5 load-bearing URLs via WebFetch: WCAG 2.2 (✓ SC 1.4.3 + 2.5.8 confirmed), NN/g 10
heuristics (✓ full list), Refactoring UI TOC (✓ 9 sections), Baymard mobile forms (✓ inline-label
claim), deceptive.design (✓ Brignull + pattern types). CXL above-the-fold returned 403 to the
automated fetcher (bot-gated) but appears in search with supporting snippets — real, not hallucinated.

## Practical Takeaways

1. Author the 11 `core` topics first in dependency order (hierarchy → a11y → type → color → layout →
   design-system → feedback-states → mobile → cognitive-load → conversion-hierarchy → friction/forms),
   each warranting a `research:deep` pass.
2. Then the 8 `standard` topics, groundable from cited sources without a dedicated deep pass.
3. Every guide must end in PASS/FAIL rules mapped to a design-quality axis / visual-review category.

## Applicability to This Project

This is the syllabus for `runtime/sprints/wave-guides/` guides that train `product-designer` and
`web-conversion-designer` and feed the `design-quality` gauntlet + `visual-review`. The TAXONOMY.md
coverage table is the contract: each axis/category has a named owning topic, so the guide library, once
authored, gives every review axis a teachable backing.

## Raw Reports

- [Claude Report](claude-report.md) — 3-round iterative search (succeeded)
- OpenAI Report — NOT PRODUCED (quota cutoff on Phase 4; partial phases discarded by the runner). See openai-error-o3-deep-research-phase3.log + openai-error-o4-mini-deep-research-phase0.log
- [Gemini skip log](gemini-error.log)
- [Research Brief](BRIEF.md)
- [Deliverable: TAXONOMY.md](../../../runtime/sprints/wave-guides/TAXONOMY.md)
