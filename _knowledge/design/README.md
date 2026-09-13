---
guide: README-DESIGN
anchor: none
shape: notice
timing: reference
lead_time: "none"
---

# MC Design-Principles Guides — agent training references

> This is the **design-principles guide library**: 19 self-contained, teachable UI/UX & web-conversion guides that **train the AI designer agents** — `design-lead`, `conversion-lead`, the `design-quality` gauntlet, and `visual-review`. Each guide closes with a §6 **agent-applicable RULES** section phrased in the agents' own finding vocabulary, so a guide is something an agent can PASS/FAIL against.
>
> **These are NOT launch guides.** Every guide here is `anchor: none` — they are *agent grounding*, consumed at judgment time, not staged into the spinup/lastmile bootstrap pipeline like the launch guides one level up (`_guides/*.md`). The single bootstrap touchpoint for this library is one pointer to this README (the design-overview entry); the rules live inside the agents that read them.
>
> **Machine-readable index:** `_knowledge/design/registry.json` — per-guide `tier` / `cluster` / `trains` / `maps_to`, plus a coverage block proving every design-quality axis and every visual-review category is owned by ≥1 guide.

---

## How the agents consume these

| Agent | What it reads here |
|---|---|
| **design-lead** | every guide whose `trains:` includes `design-lead` — app UI/UX craft, cohort fit, state coverage, simplicity, consistency |
| **conversion-lead** | every guide whose `trains:` includes `conversion-lead` — conversion hierarchy, friction/forms, typography, color, accessibility, mobile |
| **design-quality** (gauntlet) | the guides backing its **six approval axes** — each axis's owning guides are listed in the coverage table below |
| **visual-review** | the guides backing its **seven finding categories** — each category's owning guides are listed in the coverage table below |

Each agent applies the matching guides' §6 agent-applicable RULES as part of its judgment. The guides supply the *principle*; the agent keeps its existing finding/verdict contract.

---

## The 19 guides — grouped by cluster (TAXONOMY v1)

### Cluster A — Foundations (perception & cognition; both domains)
| Guide | Tier | Maps to |
|---|---|---|
| [VISUAL_HIERARCHY](VISUAL_HIERARCHY.md) | core | visual-hierarchy · layout |
| [GESTALT_GROUPING](GESTALT_GROUPING.md) | standard | visual-hierarchy · component-usage · layout |
| [COGNITIVE_LOAD_SIMPLICITY](COGNITIVE_LOAD_SIMPLICITY.md) | core | visual-hierarchy · component-usage · layout · copy |

### Cluster B — Visual Craft (the look; leans product)
| Guide | Tier | Maps to |
|---|---|---|
| [TYPOGRAPHY](TYPOGRAPHY.md) | core | design-tokens · visual-hierarchy · typography |
| [COLOR_AND_CONTRAST](COLOR_AND_CONTRAST.md) | core | design-tokens · accessibility · color · a11y |
| [LAYOUT_GRID_SPACING](LAYOUT_GRID_SPACING.md) | core | design-tokens · visual-hierarchy · layout |
| [DEPTH_ELEVATION_IMAGERY](DEPTH_ELEVATION_IMAGERY.md) | standard | design-tokens · component-usage · layout · color |

### Cluster C — Interaction (behavior; leans product)
| Guide | Tier | Maps to |
|---|---|---|
| [INTERACTION_FEEDBACK_STATES](INTERACTION_FEEDBACK_STATES.md) | core | component-usage · visual-hierarchy · console-error · regression · color |
| [AFFORDANCE_CONTROLS_ICONOGRAPHY](AFFORDANCE_CONTROLS_ICONOGRAPHY.md) | standard | component-usage · accessibility · mobile-responsive · a11y · layout |
| [NAVIGATION_IA](NAVIGATION_IA.md) | standard | visual-hierarchy · component-usage · layout · copy |
| [MOTION_ANIMATION](MOTION_ANIMATION.md) | standard | accessibility · mobile-responsive · regression · a11y |

### Cluster D — Accessibility (the inclusion floor; both domains)
| Guide | Tier | Maps to |
|---|---|---|
| [ACCESSIBILITY_WCAG](ACCESSIBILITY_WCAG.md) | core | accessibility · color · a11y |

### Cluster E — Conversion (web-specific; leans marketing)
| Guide | Tier | Maps to |
|---|---|---|
| [CONVERSION_HIERARCHY](CONVERSION_HIERARCHY.md) | core | visual-hierarchy · layout · copy |
| [FRICTION_TRUST_FORMS](FRICTION_TRUST_FORMS.md) | core | component-usage · accessibility · copy · a11y · layout |

### Cluster F — Systems & Cross-cutting (the production layer)
| Guide | Tier | Maps to |
|---|---|---|
| [CONSISTENCY_DESIGN_SYSTEMS_TOKENS](CONSISTENCY_DESIGN_SYSTEMS_TOKENS.md) | core | design-tokens · component-usage · design-handoff · color · typography · regression |
| [MOBILE_RESPONSIVE](MOBILE_RESPONSIVE.md) | core | mobile-responsive · layout · a11y |
| [CONTENT_MICROCOPY](CONTENT_MICROCOPY.md) | standard | design-handoff · copy |
| [PERFORMANCE_PERCEIVED_UX](PERFORMANCE_PERCEIVED_UX.md) | standard | mobile-responsive · component-usage · console-error · regression |
| [ETHICS_NO_DARK_PATTERNS](ETHICS_NO_DARK_PATTERNS.md) | standard | design-handoff · copy |

**Count: 19 guides (11 core, 8 standard) across 6 clusters.**

---

## Coverage — every axis & category is owned by ≥1 guide

### design-quality — the six approval axes
| Axis | Owning guides (primary first) |
|---|---|
| **design-tokens** | CONSISTENCY_DESIGN_SYSTEMS_TOKENS · TYPOGRAPHY · COLOR_AND_CONTRAST · LAYOUT_GRID_SPACING · DEPTH_ELEVATION_IMAGERY |
| **component-usage** | CONSISTENCY_DESIGN_SYSTEMS_TOKENS · AFFORDANCE_CONTROLS_ICONOGRAPHY · INTERACTION_FEEDBACK_STATES · NAVIGATION_IA · FRICTION_TRUST_FORMS · COGNITIVE_LOAD_SIMPLICITY · GESTALT_GROUPING · DEPTH_ELEVATION_IMAGERY · PERFORMANCE_PERCEIVED_UX |
| **visual-hierarchy** | VISUAL_HIERARCHY · GESTALT_GROUPING · COGNITIVE_LOAD_SIMPLICITY · TYPOGRAPHY · LAYOUT_GRID_SPACING · CONVERSION_HIERARCHY · INTERACTION_FEEDBACK_STATES · NAVIGATION_IA |
| **mobile-responsive** | MOBILE_RESPONSIVE · AFFORDANCE_CONTROLS_ICONOGRAPHY · MOTION_ANIMATION · PERFORMANCE_PERCEIVED_UX |
| **accessibility** | ACCESSIBILITY_WCAG · COLOR_AND_CONTRAST · AFFORDANCE_CONTROLS_ICONOGRAPHY · MOTION_ANIMATION · FRICTION_TRUST_FORMS |
| **design-handoff** | CONSISTENCY_DESIGN_SYSTEMS_TOKENS · CONTENT_MICROCOPY · ETHICS_NO_DARK_PATTERNS |

### visual-review — the seven finding categories
| Category | Owning guides (primary first) |
|---|---|
| **color** | COLOR_AND_CONTRAST · ACCESSIBILITY_WCAG · DEPTH_ELEVATION_IMAGERY · INTERACTION_FEEDBACK_STATES · CONSISTENCY_DESIGN_SYSTEMS_TOKENS |
| **layout** | VISUAL_HIERARCHY · GESTALT_GROUPING · COGNITIVE_LOAD_SIMPLICITY · LAYOUT_GRID_SPACING · DEPTH_ELEVATION_IMAGERY · AFFORDANCE_CONTROLS_ICONOGRAPHY · NAVIGATION_IA · CONVERSION_HIERARCHY · FRICTION_TRUST_FORMS · MOBILE_RESPONSIVE |
| **typography** | TYPOGRAPHY · CONSISTENCY_DESIGN_SYSTEMS_TOKENS |
| **copy** | CONTENT_MICROCOPY · COGNITIVE_LOAD_SIMPLICITY · NAVIGATION_IA · CONVERSION_HIERARCHY · FRICTION_TRUST_FORMS · ETHICS_NO_DARK_PATTERNS |
| **a11y** | ACCESSIBILITY_WCAG · COLOR_AND_CONTRAST · AFFORDANCE_CONTROLS_ICONOGRAPHY · MOTION_ANIMATION · FRICTION_TRUST_FORMS · MOBILE_RESPONSIVE |
| **console-error** | INTERACTION_FEEDBACK_STATES · PERFORMANCE_PERCEIVED_UX |
| **regression** | INTERACTION_FEEDBACK_STATES · MOTION_ANIMATION · CONSISTENCY_DESIGN_SYSTEMS_TOKENS · PERFORMANCE_PERCEIVED_UX |

**Result: all 6 design-quality axes and all 7 visual-review categories are owned by ≥1 guide. No gap.**

---

## Bootstrap

This library is **agent grounding (`anchor: none`)** — it is not staged into the spinup/lastmile launch pipeline the way the launch guides are. The bootstrap pipeline gets **one** design-overview entry: a pointer to *this README*. See the design-overview pointer in `.claude/commands/bootstrap/spinup.md` (onscreen stage). The per-axis / per-category rules are consumed live by the four designer agents, not placed as bootstrap markers.

---

*The MC design-principles guide library — reusable, framework-generic design judgment training. Sources are cited per guide for provenance only; principles are self-contained and teachable (no "go use product X"). Last reviewed: June 2026.*
