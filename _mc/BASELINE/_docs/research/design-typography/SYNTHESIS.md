# Typography for UI — Deep Research Synthesis

**Date:** 2026-06-01
**Method:** Real Deep Research — Claude 3-round WebSearch+WebFetch (primary, SUCCEEDED). OpenAI o3-deep-research 4-phase ATTEMPTED — FAILED (no report produced). Gemini SKIPPED (down).
**Brief by:** Claude (sanctioned fallback).
**Engines:** Claude SUCCEEDED (primary grounding — fully sufficient for authoring). OpenAI FAILED twice: (1) first attempt rejected on Phase 1 with `rate_limit_exceeded` (org TPM 200k shared, exhausted by concurrent VH+CL runs); (2) the planned serial retry was cancelled because the OpenAI account then hit `insufficient_quota` (billing credits exhausted) — confirmed when VH+CL also died on Phase 2 with the same quota error. No OpenAI report exists for typography. Confirmatory only.
**Estimated cost:** OpenAI $0 for typography (both attempts rejected pre-billing). Claude included.

## Root cause of the OpenAI failure
Two stacked causes. (1) Running 3 deep-research jobs in parallel exhausted the org-wide 200k TPM limit; typography lost the race (errors showed Used ~188k / Requested ~16–29k). (2) Then the OpenAI account ran out of billing quota mid-session (`insufficient_quota`), which killed VH+CL on Phase 2 and made the typography retry futile, so it was cancelled. Neither is a content gap. The Claude engine completed all 3 rounds for typography with strong primary sources (Baymard line-length, UXPin, Justinmind leading, USWDS, 20-mistakes), so the guide is fully grounded. Lessons: (a) serialize deep-research jobs (cap concurrency to 1) to stay under the shared TPM ceiling; (b) check OpenAI account quota/billing before launching a multi-job deep-research wave.

## Executive Summary
Typography is the largest readability surface and the primary hierarchy carrier. Numeric constants: measure 45–75ch (~66), body line-height 1.4–1.6 (~1.5), body ≥16px, modular scale ratio ~1.125–1.5, ≤2 typefaces, weight/color as levers, contrast ≥4.5:1. Authored to `_guides/design/TYPOGRAPHY.md` with 9 PASS/FAIL rules.

## High-Confidence Insights (verified live)
1. Measure 45–75ch, ~66 ideal; WCAG 1.4.8 ≤80. HIGH (Baymard/UXPin).
2. Body line-height 1.4–1.6; covaries with measure (longer→more) and size (smaller→more). HIGH (Justinmind).
3. Body ≥16px floor on web. HIGH.
4. ≤2 typefaces; hierarchy from size+weight+color. HIGH (20-mistakes).
5. Text contrast ≥4.5:1 / 3:1 large (WCAG 1.4.3); grey-on-color is the classic fail. HIGH.

## Applicability to This Project
Backs design-quality `design-tokens` (type scale must be tokens) + `visual-hierarchy`, and visual-review `typography`. §6 rules (TY-1..TY-9) are computed-style-checkable via getComputedStyle.

## Raw Reports
- [Claude Report](claude-report.md) — 3-round search (succeeded — primary grounding)
- [OpenAI Report](openai-report.md) — TPM-failed; serial retry in driver-retry.log
- [Brief](brief.json)
- Deliverable: ../../../_guides/design/TYPOGRAPHY.md
