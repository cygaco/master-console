# UI/UX & Web-Conversion Design-Principles Taxonomy — Claude Deep Research Report

**Method:** 3-round iterative WebSearch + WebFetch (Claude engine of the research:deep pipeline)
**Date:** 2026-06-01

## Executive Summary

The canonical principle literature converges on a small, stable set of clusters. Five primary
authorities — Nielsen Norman Group's 10 usability heuristics, Jon Yablonski's Laws of UX (30
laws/effects), the Gestalt principles, Refactoring UI's 8 craft sections, and WCAG 2.2's POUR
model — overlap heavily, and a sixth strand (conversion research from CXL/Baymard) adds the
landing-page layer. Reconciling them deduplicates to ~14-16 teachable topics across six clusters
(Foundations / Visual / Interaction / Accessibility / Conversion / Systems). The high-consensus
core that every authority touches is: **visual hierarchy, typography, color/contrast, layout &
spacing, accessibility, feedback/system-status, and consistency.** Modern additions the classic
heuristic lists omit but that the agents must check are **content/microcopy, performance-as-UX,
motion, and ethics/dark-patterns.**

## Phase 1: Landscape

**Finding — Five canonical principle taxonomies, with a heavily overlapping core.** (Confidence: HIGH)
- **NN/g 10 Usability Heuristics:** visibility of system status; match system↔real world; user
  control & freedom; consistency & standards; error prevention; recognition over recall;
  flexibility & efficiency; aesthetic & minimalist design; help users recover from errors; help &
  documentation. Source: https://www.nngroup.com/articles/ten-usability-heuristics/
- **Laws of UX (30):** Aesthetic-Usability Effect, Choice Overload, Chunking, Cognitive Load,
  Doherty Threshold, Fitts's Law, Goal-Gradient, Hick's Law, Jakob's Law, Laws of Common Region /
  Proximity / Prägnanz / Similarity / Uniform Connectedness (Gestalt), Miller's Law, Occam's Razor,
  Pareto, Peak-End Rule, Serial Position Effect, Tesler's Law, Von Restorff Effect, Zeigarnik Effect,
  etc. Source: https://lawsofux.com/
- **Gestalt principles:** proximity, similarity, continuity, closure, figure-ground, common region,
  common fate. Source: https://ixdf.org/literature/topics/gestalt-principles
- **Refactoring UI — 8 craft sections:** Hierarchy; Layout & Spacing; Typography; Color; Depth;
  Images; Finishing Touches (incl. empty states); plus "Starting from Scratch" (process).
  Source: https://refactoringui.com/
- **WCAG 2.2 POUR:** Perceivable, Operable, Understandable, Robust — 4 principles, 13 guidelines,
  87 success criteria (many mechanically testable). Source: https://www.w3.org/TR/WCAG22/

**Finding — The conversion strand is a distinct but adjacent body.** (Confidence: HIGH)
- CXL/Baymard conversion research centers on: value proposition above the fold, single dominant
  CTA with visual prominence, hierarchy hook→proof→CTA, friction/leak removal, trust signals,
  and form/checkout reduction. Sources: https://cxl.com/blog/how-to-build-a-high-converting-landing-page/,
  https://cxl.com/blog/above-the-fold/, https://baymard.com/blog/mobile-checkout

## Phase 2: Mechanics (granularity & clustering)

**Finding — The right granularity is ~14-16 topics, not 30+ laws nor 6 axes.** (Confidence: HIGH)
Refactoring UI's section structure is the best granularity template for *teachable* guides: it
splits color (incl. contrast) and typography and layout/spacing as separate chapters, but folds
the 30 Laws of UX into a smaller number of cognitive-load / hierarchy / interaction topics. A
teachable guide should be one coherent topic with checkable rules — so typography = one topic
(scale, line-length, weight), color+contrast = one topic, layout/spacing/grid = one topic.

**Finding — App-UI and conversion principles share foundations but split at the top.** (Confidence: HIGH)
Foundations (hierarchy, typography, color, spacing, Gestalt, consistency, accessibility) are shared
across both product UI and landing pages. The *conversion* layer (above-fold, CTA prominence,
friction, trust, journey) is web-specific and deserves its own cluster, because it adds principles
(one dominant action, objection-removal) absent from product-UI craft. Mobile/responsive is shared
and first-class in both (Baymard: most traffic is mobile).

## Phase 3: Failure Modes (checkable rules each topic yields)

**Finding — Accessibility yields the most mechanically-checkable rules.** (Confidence: HIGH)
- Text contrast ≥ 4.5:1 (AA), ≥ 3:1 large text; non-text/UI ≥ 3:1.
- Touch/target size ≥ 24×24 CSS px (WCAG 2.2 SC 2.5.8); 44px recommended (HIG).
- Every interactive element has an accessible name; visible focus ring; logical heading order;
  not color-alone for state. Sources: https://www.w3.org/TR/WCAG22/, https://webaim.org/

**Finding — Typography/color/spacing yield clear checkable craft rules.** (Confidence: HIGH)
- Max 2 typefaces; defined type scale (1.25-1.5 ratio); line length 45-75ch; never grey text on
  colored bg (Refactoring UI); consistent spacing scale; never rely on color alone.
  Source: https://refactoringui.com/, https://supercharge.design/blog/20-common-typography-mistakes-in-ui-design

**Finding — Feedback/state coverage is checkable via state enumeration.** (Confidence: HIGH)
- Every async action shows loading; every list has an empty state; every failure shows a recoverable
  error; the system reports status (NN/g #1). Microinteraction = trigger→feedback pair.
  Source: https://www.nngroup.com/articles/microinteractions/

**Finding — Forms are a high-leverage checkable topic for both domains.** (Confidence: HIGH)
- Labels always visible above field (not inline-only); mark required AND optional; inline validation
  on blur; state the requirement not just the violation; minimize fields.
  Source: https://baymard.com/blog/mobile-forms-avoid-inline-labels, https://cxl.com/blog/form-design-best-practices/

**Finding — Conversion yields checkable layout rules.** (Confidence: MEDIUM-HIGH)
- Value prop + primary CTA above the fold; single dominant CTA; CTA visually most prominent;
  hierarchy hook→proof→CTA; trust signals present. Source: https://cxl.com/blog/how-to-build-a-high-converting-landing-page/

## Phase 4: Contrarian (gaps in the standard lists)

**Finding — Heuristic lists omit four modern principle areas the agents must check.** (Confidence: HIGH)
1. **Content design / UX writing / microcopy** — button labels, error messages, empty-state copy.
   Maps directly to visual-review's `copy` category; absent from Gestalt/Refactoring UI as a topic.
   Source: https://www.nngroup.com/ UX-writing literature.
2. **Performance-as-UX** — Core Web Vitals (LCP <2.5s, INP <200ms, CLS <0.1); perceived
   performance, skeletons, Doherty Threshold (<400ms). CLS (layout shift) and console errors map to
   visual-review's `regression`/`console-error`. Source: https://web.dev/articles/vitals
3. **Motion / animation** — easing, duration, purpose, and `prefers-reduced-motion`. Touched by WCAG
   (2.3.3) but not a heuristic; needed because FOUC/flicker is a visual-review finding.
4. **Ethics / dark patterns** — Brignull's deceptive-design taxonomy; EU DSA Art. 25 bans named
   patterns. Aligns with the framework's claims-boundary. Source: https://www.deceptive.design/

**Finding — Aesthetic-Usability Effect is a real tension to name.** (Confidence: MEDIUM)
Users perceive aesthetically pleasing designs as more usable, which can mask usability problems —
a caution to bake into the hierarchy/visual guides rather than a standalone topic.

## Source Registry (primary sources, all verified live 2026-06-01)

| URL | Title | Cred (1-5) | Type |
|---|---|---|---|
| nngroup.com/articles/ten-usability-heuristics/ | 10 Usability Heuristics | 5 | primary |
| lawsofux.com | Laws of UX | 5 | primary |
| refactoringui.com | Refactoring UI (TOC) | 5 | primary |
| w3.org/TR/WCAG22/ | WCAG 2.2 | 5 | primary |
| ixdf.org/literature/topics/gestalt-principles | Gestalt Principles | 4 | secondary |
| cxl.com/blog/how-to-build-a-high-converting-landing-page/ | Landing page anatomy | 4 | secondary |
| baymard.com/blog/mobile-checkout | Mobile checkout UX | 5 | primary-research |
| web.dev/articles/vitals | Core Web Vitals | 5 | primary |
| deceptive.design | Deceptive Patterns | 4 | primary |
| nngroup.com/articles/microinteractions/ | Microinteractions | 5 | primary |

## Confidence Matrix

| Finding | Confidence | Counter-evidence |
|---|---|---|
| Core 7 topics shared across all authorities | HIGH | none |
| ~14-16 topic granularity is right | HIGH | could argue 12 (fold forms into interaction) |
| Conversion deserves its own cluster | HIGH | some fold it into hierarchy |
| Content/perf/motion/ethics are missing-from-heuristics topics | HIGH | motion could fold into interaction |

## Gaps Remaining
- Exact per-topic source triplets to be finalized in TAXONOMY.md.
- Internationalization/RTL: real but lower-priority; folded into accessibility/typography notes.
