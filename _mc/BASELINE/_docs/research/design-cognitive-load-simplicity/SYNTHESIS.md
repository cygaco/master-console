# Cognitive Load & Simplicity — Deep Research Synthesis

**Date:** 2026-06-01
**Method:** Real Deep Research — Claude 3-round WebSearch+WebFetch (primary, SUCCEEDED) + OpenAI o3-deep-research 4-phase (ATTEMPTED, FAILED mid-run). Gemini SKIPPED (down).
**Brief by:** Claude (sanctioned fallback — Gemini brief route blocked by dispatch-route-guard).
**Engines:** Claude SUCCEEDED (primary — fully sufficient). OpenAI completed Phase 1 (Landscape, 468s) then FAILED on Phase 2 (Mechanics) with `insufficient_quota` (OpenAI account billing credits exhausted mid-run); driver clean-up removed the partial output, so no OpenAI report survived. Confirmatory only.
**Estimated cost:** OpenAI ~$0.30–0.60 actually spent (Phase 1 before the quota wall). Claude included. Under $5 ceiling.

## Executive Summary
Cognitive load = mental effort the UI demands; simplicity = minimizing extraneous load (Hick, Miller, recognition-over-recall, minimalist, progressive disclosure) without amputating necessary capability (Tesler). Dominant rules: one primary decision per screen; chunk; recognition over recall; ≤2 disclosure levels; subtract before add. Authored to `_guides/design/COGNITIVE_LOAD_SIMPLICITY.md` with 8 PASS/FAIL rules.

## High-Confidence Insights (verified live)
1. Hick's Law — decision time grows with choices; highlight a recommended default. HIGH.
2. Miller's Law — chunk; do NOT misuse 7±2 as a hard cap. HIGH.
3. Recognition over recall (NN/g #6); aesthetic-minimalist (NN/g #8). HIGH.
4. Progressive disclosure — never exceed 2 levels (NN/g). HIGH.
5. Tesler's Law — irreducible complexity must be absorbed, not deleted; oversimplification is a failure. HIGH.
6. Choice overload is real but not universal (Scheibehenne meta-analysis). MEDIUM — handled as a named trade-off.

## Applicability to This Project
Home of product-designer's owned `kiss` + cognitive-load lens. §6 rules (CL-1..CL-8) map to design-quality `visual-hierarchy`/`component-usage` + visual-review `layout`/`copy`. CL-8 is the anti-oversimplification (Tesler) guard.

## Raw Reports
- [Claude Report](claude-report.md) — succeeded
- OpenAI Report — none produced (quota exhausted on Phase 2; see driver.log)
- [Brief](brief.json)
- Deliverable: ../../../_guides/design/COGNITIVE_LOAD_SIMPLICITY.md
