# Consistency, Design Systems & Tokens — Deep Research Synthesis

**Date:** 2026-06-01
**Method:** Real Deep Research — OpenAI o3-deep-research 4-phase (Responses API) + Claude 3-round WebSearch/WebFetch. Gemini SKIPPED (down per run directive).
**Brief by:** Claude (Phase-1 brief authored directly — Gemini CLI route blocked by dispatch-route-guard; sanctioned fallback).
**Original query:** Evidence-based, teachable principles of design consistency via design systems — tokens, component-library usage, one visual language, design→build handoff — yielding agent-checkable rules for the design-tokens / component-usage / design-handoff axes.
**Estimated cost:** ~$1.00–2.50 for the OpenAI o3-deep-research 4-phase crawl (this topic) + Claude search included. Gemini $0. Under the $5 autonomous ceiling.

## Engines
| Engine | Method | Status |
|---|---|---|
| Claude | 3-round WebSearch (12+ searches) + WebFetch (2 WCAG verifications) | SUCCEEDED — claude-report.md |
| OpenAI | o3-deep-research, 4-phase Responses API | RUNNING / confirmatory (Phase 1 Landscape completed at synthesis time; later phases append to openai-report.md) |
| Gemini | deep-research-pro Interactions API | SKIPPED — engine down per run directive |

## Executive Summary
Consistency is a cognitive-cost reducer (Jakob's Law; NN/g #4). The teachable spine: **design tokens** are the named single-source-of-truth in three tiers (reference/primitive → semantic/system → component); the **semantic tier decouples intent from value**, which is what makes dark mode/theming a token swap. **Component primitives** (variant-driven, e.g. CVA) are the unit of reuse over raw elements. **Handoff fidelity** = the build realizes the spec's tokens/components/intent. The dominant failure is **drift** — hardcoded hex, raw theme utilities, one-off raw elements, untyped props — "especially common with AI-generated code," which is exactly why these must be enforced on agent output. The contrarian (Tesler's Law, Von Restorff) shows rigid consistency can be wrong — but a legitimate exception is *governed* (allow-listed: file+rule+reason), drift is not.

## High-Confidence Insights (verified)
1. **Three-tier token model** (reference/semantic/component) is the consensus structure; semantic tokens enable theming without touching components. (HIGH)
2. **NN/g #4 + Jakob's Law** — internal + external consistency reduce cognitive load. (HIGH, primary)
3. **Hardcoded values are the canonical drift anti-pattern** — hex, rgb, raw px spacing, raw font sizes/weights, radii, shadows. (HIGH)
4. **The MC static checker already encodes the mechanical rules** — `no-hex-literal`, `no-tailwind-theme-color`, `use-ui-primitive`, `no-any-props`, `missing-design-doc` — the guide's §6 maps 1:1 to these plus judgment-lane rules for what regex can't catch. (HIGH, code-verified)
5. **Governed exception vs drift** — Von Restorff highlight on the single CTA is legitimate; an undocumented hardcoded one-off is drift. Allow-list governance (file+rule+reason) is the discriminator. (HIGH/MEDIUM)

## Applicability to This Project
Authored as `_guides/design/CONSISTENCY_DESIGN_SYSTEMS_TOKENS.md` — the primary owner of the design-quality `design-tokens` + `component-usage` + `design-handoff` axes and the visual-review `color`/`typography`/`regression` categories. §6 rules are stated as PASS/FAIL with severity + observed-vs-expected + detection, cross-referenced to `scripts/checks/design-system.js` rule ids.

## Raw Reports
- [Claude Report](claude-report.md) — 3-round search (succeeded)
- [OpenAI Report](openai-report.md) — o3-deep-research 4-phase (confirmatory; appends as phases land)
- [Brief](brief.json)
- Deliverable: `_guides/design/CONSISTENCY_DESIGN_SYSTEMS_TOKENS.md`
