# Cognitive Load & Simplicity — Claude Deep Research Report (3-round WebSearch + WebFetch)

**Date:** 2026-06-01 · **Engine:** Claude (research:deep pipeline)

## Executive Summary
Cognitive load is the mental effort an interface demands; simplicity is the discipline of minimizing it without hiding what users need. The canonical laws converge: **Hick's Law** (decision time grows with number/complexity of choices), **Miller's Law** (working memory ~7±2, modern estimates 4±1 → chunk), **recognition over recall** (NN/g #6), **aesthetic-minimalist design** (NN/g #8), **progressive disclosure** (two tiers max), and **Tesler's Law** (irreducible complexity must be absorbed by the design, not dumped on the user). The strongest checkable rule: **one primary decision per screen/step; chunk and group; never force recall when recognition is possible.** The contrarian guard: don't oversimplify — hiding critical actions or fragmenting a task into more steps *adds* load.

## Phase 1: Landscape
**Finding — Hick's Law.** (HIGH) "The time it takes to make a decision increases with the number and complexity of choices." From Hick & Hyman (1952). Takeaways: minimize choices when response time matters, decompose complex tasks, emphasize suggested options, gradual onboarding, but avoid over-simplification/abstraction. Source: https://lawsofux.com/hicks-law/
**Finding — Miller's Law.** (HIGH) "The average person can only keep 7 (plus or minus 2) items in their working memory." Caution: do NOT use 7±2 as a rigid limit; the real lever is **chunking** — "segment information into smaller, meaningful groups." Miller 1956. Source: https://lawsofux.com/millers-law/
**Finding — Recognition over recall (NN/g #6).** (HIGH) "Minimize the user's memory load by making elements, actions, and options visible." Recognition demands less cognitive effort than recall. Source: https://www.nngroup.com/articles/ten-usability-heuristics/
**Finding — Aesthetic & minimalist (NN/g #8).** (HIGH) "Interfaces should not contain information that is irrelevant or rarely needed." Every extra unit competes with the relevant ones.

## Phase 2: Mechanics
**Finding — Progressive disclosure, two tiers.** (HIGH) "Initially, show users only a few of the most important options. Offer a larger set of specialized options upon request." Hard rule: "Designs that go beyond 2 disclosure levels typically have low usability." Source: https://www.nngroup.com/articles/progressive-disclosure/
**Finding — Operationalizing techniques.** (HIGH) Chunking (group fields/nav into labeled sets), smart defaults (pre-select the recommended option), recognition affordances (dropdowns/autocomplete over free-recall), subtract-before-add, highlight the recommended choice.
**Finding — Load is measurable.** (HIGH) Proxies: count of primary/competing CTAs per screen (target ~1); count of form fields (fewer = higher completion); nav breadth (top-level items); choices per single decision; visual density. Each additional form field is "another decision point."

## Phase 3: Failure Modes
**Finding — Choice overload.** (HIGH) Famous jam study: 24 options drew 60% to look but only 3% bought; 6 options → 30% bought. Detect: long flat lists of equal-weight options with no recommended default. Source: Schwartz/Iyengar via CXL.
**Finding — Mandatory recall.** (HIGH) Asking users to remember a code/value from a prior screen. Detect: required input with no on-screen reference.
**Finding — Wall of options / dense screen.** (HIGH) All advanced options shown at once, no progressive disclosure. Detect: high simultaneous control count.
**Finding — Redundant steps.** (MEDIUM-HIGH) Splitting a simple task into many screens to look "clean" — adds load.

## Phase 4: Contrarian
**Finding — Choice-overload effect is not universal.** (MEDIUM) Scheibehenne et al. meta-analysis found effect sizes vary and don't always replicate — more options aren't always worse; context (default quality, categorization) matters more than raw count. Source: CXL "Does offering more choices actually tank conversions?"
**Finding — Tesler's Law: don't oversimplify.** (HIGH) "For any system there is a certain amount of complexity which cannot be reduced." The designer should absorb irreducible complexity, not delete necessary capability. Hiding critical actions or removing power-user efficiency to look minimal is a failure, not a win. Source: https://lawsofux.com/teslers-law/

## Source Registry (verified live 2026-06-01)
| URL | Title | Cred | Type |
|---|---|---|---|
| lawsofux.com/hicks-law/ | Hick's Law | 5 | primary |
| lawsofux.com/millers-law/ | Miller's Law | 5 | primary |
| lawsofux.com/teslers-law/ | Tesler's Law | 5 | primary |
| nngroup.com/articles/ten-usability-heuristics/ | 10 Heuristics #6/#8 | 5 | primary |
| nngroup.com/articles/progressive-disclosure/ | Progressive Disclosure | 5 | primary |
| cxl.com/blog/does-offering-more-choices-actually-tank-conversions/ | Choice overload contrarian | 4 | secondary |

## Confidence Matrix
- Hick/Miller/recognition/minimalist: HIGH. Two-tier progressive disclosure: HIGH. One-primary-decision rule: HIGH. Choice-overload-not-universal: MEDIUM. Don't-oversimplify (Tesler): HIGH.
