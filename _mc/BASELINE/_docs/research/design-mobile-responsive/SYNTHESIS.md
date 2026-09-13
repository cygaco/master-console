# Mobile / Responsive — Deep Research Synthesis

**Date:** 2026-06-01
**Method:** Real Deep Research — OpenAI o3-deep-research 4-phase (Responses API) + Claude 3-round WebSearch/WebFetch. Gemini SKIPPED (down per run directive).
**Brief by:** Claude (Phase-1 brief authored directly — Gemini CLI route blocked by dispatch-route-guard; sanctioned fallback).
**Original query:** Evidence-based, teachable principles of mobile-first / responsive design — reflow with no overflow/overlap, tap-target sizing, readable mobile type, touch ergonomics — yielding agent-checkable rules for the mobile-responsive axis (+ layout/a11y).
**Estimated cost:** ~$1.00–2.50 for the OpenAI o3-deep-research 4-phase crawl (this topic) + Claude search included. Gemini $0. Combined with the tokens topic, total run under the $5 autonomous ceiling.

## Engines
| Engine | Method | Status |
|---|---|---|
| Claude | 3-round WebSearch (12+ searches) + WebFetch (2 WCAG verifications against w3.org) | SUCCEEDED — claude-report.md |
| OpenAI | o3-deep-research, 4-phase Responses API | RUNNING / confirmatory (runs after the tokens topic; appends to openai-report.md) |
| Gemini | deep-research-pro Interactions API | SKIPPED — engine down per run directive |

## Executive Summary
Mobile is the default surface and the floor is codified: **WCAG 2.2 SC 2.5.8** (tap target ≥ 24×24 CSS px, or spacing exception) and **SC 1.4.10 Reflow** (usable at 320 CSS px, no two-dimensional scroll) — both *verified against w3.org primary*. Platform comfort targets are larger (Apple 44pt, Material 48dp). Build mobile-first (base styles small, enhance up). The dominant failures — horizontal overflow, overlap/clipping, sub-floor or too-close tap targets, and **input/body type < 16px** (iOS focus-zoom) — are all mechanically detectable via DOM geometry (`scrollWidth > innerWidth`, bounding-rect overlap) and computed styles (`font-size`, box size). Contrarian: pure mobile-first is wrong for genuinely desktop-primary B2B/data-dense tools; reconcile via content-parity responsive with the *priority* surface chosen by audience — but the hard floors still apply.

## High-Confidence Insights (verified)
1. **Tap target ≥ 24×24 CSS px** (WCAG 2.5.8), prefer 44/48 for primary. (HIGH, primary-verified)
2. **Reflow usable at 320px, no 2-D scroll** (WCAG 1.4.10); 2-D content excepted but isolated. (HIGH, primary-verified)
3. **Input/body ≥ 16px prevents iOS focus-zoom**; never disable zoom to mask it (WCAG failure). (HIGH)
4. **Overflow is mechanically detectable** — `document.documentElement.scrollWidth > window.innerWidth`; iterate elements past the viewport to find the culprit. (HIGH)
5. **Both viewports required** — design-quality reviews desktop + 375px; a mobile overflow hiding content is a critical gate failure. (HIGH, agent-spec-verified)

## Applicability to This Project
Authored as `_guides/design/MOBILE_RESPONSIVE.md` — the whole-axis owner of the design-quality `mobile-responsive` axis, backing visual-review `layout`/`a11y` at the mobile viewport. §6 rules are stated as PASS/FAIL with severity + observed-vs-expected + Playwright-style detection (`browser_resize` + `browser_evaluate` geometry/computed-style), with a desktop-primary guidance clause to avoid false flags.

## Raw Reports
- [Claude Report](claude-report.md) — 3-round search (succeeded; WCAG 2.5.8 + 1.4.10 verified live)
- [OpenAI Report](openai-report.md) — o3-deep-research 4-phase (confirmatory; appends as phases land)
- [Brief](brief.json)
- Deliverable: `_guides/design/MOBILE_RESPONSIVE.md`
