# Visual Hierarchy — Deep Research Synthesis

**Date:** 2026-06-01
**Method:** Real Deep Research — Claude 3-round WebSearch+WebFetch (primary, SUCCEEDED) + OpenAI o3-deep-research 4-phase (ATTEMPTED, FAILED mid-run). Gemini SKIPPED (down: 429/403).
**Brief by:** Claude (Gemini brief route blocked by dispatch-route-guard — sanctioned "Claude writes it" fallback per authoring spec).
**Engines:** Claude SUCCEEDED (primary grounding — fully sufficient). OpenAI completed Phase 1 (Landscape, 409s) then FAILED on Phase 2 (Mechanics) with `insufficient_quota` ("You exceeded your current quota") — the OpenAI account ran out of billing credits mid-run; the driver's clean-up removed the partial Phase-1 temp output, so no OpenAI report artifact survived. Confirmatory only — the guide does not depend on it.
**Estimated cost:** OpenAI ~$0.30–0.60 actually spent (Phase 1 completed before the quota wall). Claude included. Under the $5 autonomous ceiling.

## Executive Summary
Visual hierarchy is the deliberate ordering of elements by importance via a fixed cue set (size, weight, color, contrast, position, whitespace, alignment, proximity), traversed by predictable scanning patterns (F/Z/layer-cake). The dominant rule: one focal point per view, primary action loudest. Authored to `_guides/design/VISUAL_HIERARCHY.md` with 8 PASS/FAIL rules mapped to design-quality `visual-hierarchy` + visual-review `layout`.

## High-Confidence Insights (verified live)
1. Eight hierarchy cues; de-emphasize via weight/color over size (Refactoring UI). HIGH.
2. Von Restorff (isolation) governs the single distinctive CTA; restraint required; not color-alone. HIGH. (lawsofux.com)
3. Serial position → key actions at list/nav ends. HIGH.
4. "If everything is bold, nothing is bold" — emphasis is a finite budget. HIGH.
5. NN/g #8 minimalist: removing noise is a hierarchy technique. HIGH.

## Applicability to This Project
This guide trains product-designer, web-conversion-designer, design-quality, visual-review. §6 rules (VH-1..VH-8) are the agent-checkable payoff for the `visual-hierarchy` axis / `layout` category.

## Raw Reports
- [Claude Report](claude-report.md) — 3-round search (succeeded)
- OpenAI Report — none produced (quota exhausted on Phase 2; see driver.log)
- [Brief](brief.json)
- Deliverable: ../../../_guides/design/VISUAL_HIERARCHY.md
