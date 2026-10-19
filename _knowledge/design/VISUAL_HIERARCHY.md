---
guide: VISUAL_HIERARCHY
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [visual-hierarchy, layout]
sources:
  - "https://www.nngroup.com/articles/ten-usability-heuristics/"
  - "https://ixdf.org/literature/topics/visual-hierarchy"
  - "https://lawsofux.com/von-restorff-effect/"
  - "https://lawsofux.com/serial-position-effect/"
  - "https://refactoringui.com/"
  - "https://ixdf.org/literature/topics/gestalt-principles"
---

# Visual Hierarchy

**Visual hierarchy** is the deliberate arrangement of interface elements by importance so the eye is guided — first, second, last — to the things that matter, in the order they matter. It is the backbone of every screen: it decides what the user notices, what they ignore, and whether they can act without thinking.

> One-line test: *cover the page, uncover it for one second, then cover it again. The thing you remember seeing is your hierarchy. If you can't name one thing, the page has no hierarchy.*

---

## 1. Why it matters

A screen without hierarchy is a maze: every element shouts at the same volume, so the user must read everything to find anything. The canonical formulation is **"if everything stands out, nothing stands out."** Good hierarchy does two jobs at once:

- **Readability** — the user can *scan* the screen in seconds and locate the one thing they came for.
- **Action** — the user's gaze is *led* to the primary action (a CTA, a submit, the next step) without a label saying "look here."

For the **agents this guide trains**:

- **design-lead** — hierarchy is the craft expression of the inherited `clarity-is-king` and the owned `kiss` principle: a clear screen has one obvious focal point and a legible second tier. Hierarchy is how "what's most important" becomes visible without a paragraph of explanation.
- **conversion-lead** — the conversion page has *one job*. Hierarchy is the mechanism of the hook→proof→CTA flow: the value-prop hook lands first, proof sustains, the single dominant CTA finishes. A buried or co-equal CTA is a conversion leak.
- **design-quality** gauntlet — this guide is the backing for the **`visual-hierarchy`** axis: "the primary action/message is the most prominent thing; the eye lands where the brief says it should. Clarity beats cleverness. A buried CTA or competing emphasis is a finding."
- **visual-review** — backs the **`layout`** category: overlapping/competing focal points, off-balance emphasis, and a CTA that doesn't read as primary are layout findings.

**Perception basis.** The eye is drawn pre-attentively (before conscious reading) to whatever differs most from its surroundings in size, brightness, color, and isolation. Hierarchy is the craft of *engineering that difference on purpose* so the most important element wins the pre-attentive race.

---

## 2. Core principles & techniques

### 2.1 The visual cues that encode importance

Hierarchy is built from a small, fixed toolkit. Each cue raises or lowers an element's *perceived weight*. The strongest, roughly ranked:

| Cue | How it raises emphasis | How it lowers emphasis (de-emphasis) |
|---|---|---|
| **Size / scale** | Larger = more attention. "Larger elements command more attention than smaller ones." | Smaller — but watch the legibility floor (don't shrink below readable size). |
| **Weight** | Bolder strokes pull the eye. | **Prefer reducing weight over shrinking size** — keeps text legible while receding. |
| **Color & saturation** | Bright/saturated pops; one accent color marks the primary action. | Muted/tonal/grey recedes. |
| **Contrast** | High light–dark difference against the *local* background stands out. | Low contrast (within the a11y floor) recedes. |
| **Position** | Top and along the scan path (top-left start) is seen first. | Lower, off-path positions are seen later. |
| **Whitespace / isolation** | Empty space *around* an element isolates and elevates it (von Restorff). | Crowded elements blur together. |
| **Alignment** | A single off-axis element stands out against an aligned set. | Aligned with the group = part of the group. |
| **Proximity / grouping** | (Gestalt) close items read as one unit, building tier structure. | Separated items read as distinct. |

**Key craft move — de-emphasize with weight/color, not just size.** Refactoring UI's core insight: when secondary text competes, the instinct is to shrink it, but that hurts legibility. Instead, drop its *weight* (regular vs bold) or its *color* (muted-foreground vs foreground). You keep the text readable while it recedes.

### 2.2 The three-tier system (Hook / Secondary / Finisher)

Every coherent screen resolves to three emphasis tiers. Plan them explicitly:

1. **Tier 1 — Hook (entry point):** the *one* element the eye lands on first. The hero headline, the key number, the primary CTA, or the main visual. There is **exactly one** per viewport.
2. **Tier 2 — Secondary detail:** what sustains attention after the hook — the supporting subhead, the benefit, the proof, the body copy. Multiple allowed, but visibly quieter than Tier 1.
3. **Tier 3 — Finisher / tertiary:** the lowest-priority content — metadata, fine print, secondary/ghost actions, footers.

The discipline is *one Tier-1 element per view*. Two Tier-1 elements is the most common hierarchy bug.

### 2.3 Plan the eye's path (scanning patterns)

Users don't read screens; they scan them in predictable shapes. Place the three tiers along the path the layout triggers:

- **F-pattern** (text-heavy pages, articles, dashboards): eyes sweep the top, a second horizontal band, then run down the left edge. → Put the hook top-left; front-load the first words of headings and list items.
- **Z-pattern** (sparse, hero-led landing pages): top-left → top-right → diagonal → bottom-right. → Logo/hook top-left, secondary nav/CTA top-right, primary CTA at the bottom-right terminus.
- **Layer-cake** (heading-dense pages): eyes jump heading to heading, skipping body. → Headings must carry the meaning on their own.

The point isn't to force a pattern; it's to *put the most important element where the eye already goes.*

### 2.4 The Laws that govern emphasis

- **Von Restorff (isolation) effect:** "the one [object] that differs from the rest is most likely to be remembered." This is *why* a single accent-colored CTA among neutral elements wins. **Built-in caution:** "use restraint... to avoid them competing with one another," and **never rely on color alone** (excludes color-blind/low-vision users — pair color with weight, size, or an icon).
- **Serial position effect (primacy/recency):** users best remember the **first and last** items in a series. Put the least important items in the *middle* of nav/lists; put key actions at the **far ends**.
- **NN/g #8, Aesthetic and minimalist design:** "interfaces should not contain information that is irrelevant or rarely needed." Every extra element competes with your Tier-1 element for the same attention budget — removing noise is itself a hierarchy technique.

### 2.5 Trade-offs to name

- **Emphasis is a budget.** The more you emphasize, the less each emphasis is worth. Spend it on one thing.
- **Hierarchy vs. density.** A data-dense table can't isolate one cell; there, hierarchy lives in the *header row, alignment, and grouping*, not in a single hero element. Match the technique to the surface.
- **Aesthetic-usability effect:** a striking visual hierarchy makes a product *feel* more usable and can mask real usability problems — don't let a bold hero excuse a buried action.

---

## 3. Concrete examples (build terms — Next / Tailwind / Radix / shadcn)

> All examples are generic substrate patterns. No product-specific colors or values — use the project's design tokens (`var(--…)` / theme tokens), never hardcoded hex.

**DO — one dominant focal point per view**
```tsx
<section className="space-y-6">
  {/* Tier 1 — Hook: largest, boldest, one only */}
  <h1 className="text-4xl font-bold tracking-tight">Ship your idea this weekend</h1>
  {/* Tier 2 — Secondary: quieter via weight + muted color, NOT tiny */}
  <p className="text-lg text-muted-foreground">From prompt to a live, shareable product.</p>
  {/* Tier 1 action — single primary, default (solid) variant */}
  <Button size="lg">Start building</Button>
  {/* Tier 3 — tertiary action, visibly recedes */}
  <Button variant="ghost" size="sm">See how it works</Button>
</section>
```

**DON'T — two co-equal CTAs (competing focal points)**
```tsx
{/* Both solid, both large, same color weight → the eye can't choose */}
<Button size="lg">Start building</Button>
<Button size="lg">Watch demo</Button>   {/* should be variant="outline" or "ghost" */}
```

**DO — de-emphasize with color/weight, keep size legible**
```tsx
<p className="text-base text-foreground">Order total</p>
<p className="text-base text-muted-foreground">Estimated tax calculated at checkout</p>
{/* secondary line recedes by color, still 16px+ and readable */}
```

**DON'T — shrink secondary text into illegibility to make it "feel" secondary**
```tsx
<p className="text-[10px] text-foreground">Estimated tax calculated at checkout</p>
{/* now it's a readability + a11y problem, not just a hierarchy choice */}
```

**DO — isolate the hero with whitespace (von Restorff)**
```tsx
<div className="py-24"> {/* generous space frames the one important thing */}
  <h1 className="text-5xl font-bold">One number that matters</h1>
</div>
```

**DON'T — emphasis inflation (everything Tier 1)**
```tsx
<h2 className="text-4xl font-bold text-primary">Feature A</h2>
<h2 className="text-4xl font-bold text-primary">Feature B</h2>
<h2 className="text-4xl font-bold text-primary">Feature C</h2>
{/* three equal hooks = no hook. Demote two to text-xl font-semibold text-foreground */}
```

---

## 4. Common failure modes

| Failure | How it reads to the user | How to detect it |
|---|---|---|
| **Flat hierarchy / emphasis inflation** | "Everything is shouting" — the user can't tell what's important; bounce/scan-and-leave. | More than one element occupies the top emphasis tier (large + bold + saturated/high-contrast) within a viewport. |
| **Competing focal points** | Two things fight for first attention; decision friction. | Two+ interactive elements compute equally "loud" (similar size × weight × accent). |
| **Buried CTA** | The primary action is quieter than secondary content/actions; users miss the next step. | The primary/`default`-variant button computes *less* prominent than a secondary/`outline` one, or sits below the fold with no above-fold cue. |
| **Heading-order mismatch** | Visual size order ≠ semantic order (a big `<h3>`, a tiny `<h1>`); confuses screen readers and the scan. | DOM heading sequence skips levels or visual size doesn't monotonically track heading level. |
| **Banner blindness** | Too many "important" callouts read as ads and get ignored wholesale. | ≥3 high-emphasis promo/callout blocks competing on one screen. |
| **Mid-list burial of key actions** | The important nav/list item is in the forgettable middle. | Primary action positioned in the middle of a series rather than first/last. |
| **Over-emphasis / false urgency** | Aggressive color/size/animation feels manipulative; erodes trust. | Emphasis dialed past the content's real importance (e.g. a low-stakes element styled like a critical alert). |

---

## 5. Relationship to other axes

- **Typography** is the primary *carrier* of hierarchy (size/weight/case) — see `TYPOGRAPHY.md`. A type scale with no contrast between levels produces a flat hierarchy even with "correct" tokens.
- **Cognitive load** — see `COGNITIVE_LOAD_SIMPLICITY.md` — fewer competing elements is *both* lower load and clearer hierarchy; the two reinforce.
- **Accessibility** — hierarchy must not depend on color alone, and visual order must match semantic heading order.
- **Conversion hierarchy** is this principle applied to the one-job landing page (hook→proof→CTA, single dominant CTA).

---

## 6. ✅ Agent-applicable RULES (the payoff)

PASS/FAIL rules the **design-quality** (`visual-hierarchy` axis) and **visual-review** (`layout` category) gauntlets can mechanically apply. Each rule names the check, the mapped axis/category, the detection method, and the finding to emit on violation.

> Finding format (matches the gauntlets): `axis|category` · `severity` · `observed` vs `expected`.

### VH-1 — Exactly one dominant focal point per viewport  *(critical)*
- **Axis/Category:** `visual-hierarchy` / `layout`
- **Assertion:** within a single rendered viewport (desktop AND mobile), exactly one element is in the top emphasis tier (largest + boldest + highest local contrast / accent).
- **Detect:** screenshot + `getComputedStyle` on candidate hero elements; rank by (font-size × font-weight × contrast-vs-local-bg). FAIL if ≥2 elements tie for top, or if 0 clearly lead.
- **Finding on violation:** `visual-hierarchy · high · "two elements share top emphasis (h1 text-4xl bold AND promo banner text-4xl bold) — no single focal point" · expected "one dominant Tier-1 element per view"`

### VH-2 — Primary action is the most prominent interactive element  *(critical)*
- **Axis/Category:** `visual-hierarchy` / `layout`
- **Assertion:** the primary CTA / submit / next-step is the visually loudest *interactive* element on the screen.
- **Detect:** compare computed prominence of the primary (`default`/solid) button against all other buttons/links. FAIL if any secondary control computes louder (larger, more saturated background, higher contrast) than the primary.
- **Finding:** `visual-hierarchy · critical · "secondary 'Watch demo' renders solid/accent equal to primary 'Start' — primary not dominant" · expected "primary action is the single loudest control; secondaries use outline/ghost"`

### VH-3 — No competing co-equal CTAs  *(high)*
- **Axis/Category:** `visual-hierarchy` / `layout`
- **Assertion:** at most one button per decision point uses the solid/primary variant; additional actions use a quieter variant.
- **Detect:** count solid/`default`-variant buttons in the same action cluster. FAIL if >1.
- **Finding:** `layout · high · "2 solid-variant buttons in the hero CTA cluster" · expected "one primary (solid) + secondaries as outline/ghost"`

### VH-4 — Visual size order matches semantic heading order  *(high)*
- **Axis/Category:** `visual-hierarchy` / `layout` (couples to `accessibility`)
- **Assertion:** rendered font-size is monotonic with heading level (h1 ≥ h2 ≥ h3 …) and heading levels are not skipped.
- **Detect:** read DOM heading sequence + computed font-size per level. FAIL if a lower-level heading renders larger than a higher-level one, or levels skip (h1→h3).
- **Finding:** `visual-hierarchy · high · "h3 renders 32px while h1 renders 20px; heading visual order inverted" · expected "h1>h2>h3 in both level and size"`

### VH-5 — Emphasis is selective (no emphasis inflation)  *(high)*
- **Axis/Category:** `visual-hierarchy` / `layout`
- **Assertion:** high-emphasis treatments (large + bold + saturated/accent) are not applied to ≥3 sibling elements simultaneously.
- **Detect:** count elements meeting the high-emphasis threshold within one section. FAIL if ≥3 siblings tie at top emphasis.
- **Finding:** `layout · high · "3 feature headings all text-4xl bold accent — flat hierarchy" · expected "one lead, the rest demoted by weight/color"`

### VH-6 — De-emphasis preserves legibility  *(medium)*
- **Axis/Category:** `visual-hierarchy` / `layout` (couples to `typography`/`accessibility`)
- **Assertion:** secondary/tertiary text recedes by weight or muted color, not by dropping below the readable size or the contrast floor.
- **Detect:** for de-emphasized text, computed font-size ≥ body floor AND contrast ≥ a11y floor. FAIL if secondary text is sub-readable size or sub-floor contrast.
- **Finding:** `layout · medium · "secondary caption rendered 10px to look minor" · expected "recede via text-muted-foreground at ≥14px, not by shrinking below legible size"`

### VH-7 — Hierarchy holds on mobile  *(high)*
- **Axis/Category:** `visual-hierarchy` / `layout` (couples to `mobile-responsive`)
- **Assertion:** at the mobile viewport the single dominant focal point and primary-action prominence survive the reflow (not collapsed so all elements look equal).
- **Detect:** re-run VH-1/VH-2 at mobile viewport. FAIL if the focal point or primary prominence is lost on reflow.
- **Finding:** `layout · high · "at 375px all CTAs stack full-width identical — primary no longer dominant" · expected "primary remains visually distinct on mobile"`

### VH-8 — Hierarchy does not rely on color alone  *(medium)*
- **Axis/Category:** `visual-hierarchy` / `layout` (couples to `accessibility`)
- **Assertion:** the primary element is distinguished by ≥2 cues (e.g. size + color, or weight + position), not color alone.
- **Detect:** if the only difference between primary and secondary is hue, FAIL.
- **Finding:** `layout · medium · "primary vs secondary CTA differ only by color; identical size/weight" · expected "pair color with size/weight/position so the difference survives color-blind viewing"`

---

## 7. Sources (provenance / evidence only)

- Nielsen Norman Group — 10 Usability Heuristics (esp. #8 Aesthetic and Minimalist Design): https://www.nngroup.com/articles/ten-usability-heuristics/
- Interaction Design Foundation — Visual Hierarchy (cues, scanning patterns): https://ixdf.org/literature/topics/visual-hierarchy
- Laws of UX — Von Restorff Effect: https://lawsofux.com/von-restorff-effect/
- Laws of UX — Serial Position Effect: https://lawsofux.com/serial-position-effect/
- Refactoring UI — "Hierarchy Is Everything" / de-emphasis with weight & color (provenance): https://refactoringui.com/
- Interaction Design Foundation — Gestalt principles (proximity, figure-ground): https://ixdf.org/literature/topics/gestalt-principles

*Sources cited for provenance only. This guide teaches the principle so the agent applies it directly in the build — it does not direct anyone to a third-party product.*
