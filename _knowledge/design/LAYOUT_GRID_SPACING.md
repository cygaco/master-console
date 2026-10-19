---
guide: LAYOUT_GRID_SPACING
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [design-tokens, visual-hierarchy, layout]
sources:
  - "https://www.designsystems.com/space-grids-and-layouts/"
  - "https://www.nngroup.com/articles/gestalt-proximity/"
  - "https://www.nngroup.com/articles/common-region/"
  - "https://www.nngroup.com/articles/form-design-white-space/"
  - "https://lawsofux.com/law-of-proximity/"
  - "https://baymard.com/blog/line-length-readability"
  - "https://m3.material.io/foundations/layout/understanding-layout/spacing"
---

# Layout, Grid & Spacing

**Layout, grid, and spacing is the systematic use of space — a small fixed scale of spacing values, a consistent alignment grid, and proximity-based grouping — to make a layout legible, grouped, aligned, and free of clutter and overflow.**

Space is not the absence of design; it *is* the design. The same constrained set of spacing values that makes a UI look intentional is also what lets the eye parse which elements belong together, what's primary, and where one section ends and the next begins.

---

## 1. Why it matters

A layout communicates structure *before* a user reads a word. Two questions get answered in the first half-second purely by space and alignment:

1. **What belongs with what?** (grouping — driven by proximity and shared regions)
2. **What's the reading order / what's important?** (hierarchy — driven by space, scale, and alignment)

When spacing is arbitrary (7px here, 13px there, 23px somewhere else), the eye gets no rhythm and the UI reads as "vibe-coded" — technically present, structurally noise. When groups have equal space inside and between them, the user literally cannot tell what's related. When elements don't share an alignment edge, the layout reads as sloppy and untrustworthy. And when a layout overflows or overlaps at a phone width, content is unreachable.

**Which agents and checks this governs:**

- **design-lead** — `kiss` ("subtract before you add"; a clear screen is a *spaced* screen) and the cognitive-load lens both live here. Crowding is a tax the user pays every visit.
- **conversion-lead** — whitespace isolates the CTA and the value prop (the `conversion-hierarchy` hook→proof→CTA flow is largely a *spacing* decision: give the dominant action room).
- **design-quality gauntlet** — feeds **`design-tokens`** (spacing/sizing resolve to the scale, not magic numbers) and **`visual-hierarchy`** (space creates emphasis and grouping).
- **visual-review** — feeds the **`layout`** category (overlap, overflow, missing padding, misalignment, broken reflow).

---

## 2. Core principles & techniques

### 2.1 A constrained spacing scale (the token-backed system)

A spatial system is a fixed, small set of spacing values that *all* margins, paddings, and gaps must draw from. The dominant convention is the **8-point grid** with a **4px half-step**:

```
4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96   (px)
```

**Why 8 (with 4 as a half-step):**

- **Divisibility.** 8 halves cleanly to 4 and 2 and divides neatly into common screen sizes and device pixel ratios, so it renders crisply across densities.
- **Enforceable constraint.** A smaller base (4/5/6 as the *only* step) explodes the number of legal values and makes consistency unenforceable across a team or codebase. A handful of allowed steps is the point — fewer decisions, more rhythm. (This is the spatial expression of `kiss`.)
- **The 4px half-step** is for genuinely tight relationships — label↔input, icon↔text — where 8 is too much. Used sparingly, it stays systematic.
- Material pairs an **8pt component grid** with a **4pt baseline grid** for typography (line-heights stepped by 4), so type and layout share a rhythm.

**Encode as tokens.** Components consume scale *steps* (`gap-4`, `p-6`, `space-y-8` → mapped to the scale), never raw `style={{margin: '23px'}}`. The scale lives once in the theme; layouts reference it. An off-scale value is the tell of a forked system.

### 2.2 Proximity & common region — space *is* grouping

The **Gestalt Law of Proximity**: items placed close together are perceived as one group, and proximity is strong enough to *overpower* competing cues like color or shape similarity. This yields the single most useful, checkable spacing rule:

> **Space *within* a group must be less than space *between* groups.** (intra-group gap < inter-group gap)

A heading must sit closer to its own section than to the section above it; a label closer to its field than to the next field; a card's items closer to each other than to the next card. When intra ≈ inter, grouping collapses and the user can't parse relationships.

**Common Region** is the complement: a shared container (a card, a bordered box, a tinted background) groups items *even without* tight proximity. Use a region when proximity alone isn't enough or when groups must sit close.

**Whitespace and hierarchy:** an element with more space around it reads as more important and as its own group — it gets more attention. Generous, *deliberate* whitespace isn't wasted; it's how you say "this matters, read this first." (NN/g form white space, visual design principles.)

### 2.3 Alignment & the grid

- **Share alignment edges.** Related elements line up on a common left/top edge or a shared column grid. Mixed, near-but-not-equal edges read as broken.
- **Consistent gaps between siblings.** Equivalent siblings (list items, cards, nav links) have *equal* gaps. Uneven gaps break rhythm.
- **Outer padding ≥ inner gaps (usually).** A container's padding should generally be ≥ the gaps between its children, so the group reads as contained, not bursting its edges.
- **Optical vs mathematical alignment.** Sometimes the *mathematically* centered glyph (an icon, a play triangle, punctuation) looks off and needs a small optical nudge. This is a *disciplined* exception, not a license for arbitrary values.

### 2.4 Measure (line length) & density

- **Measure.** Optimal body line length is ~**50–60 characters** per line, up to **~75** acceptable. Too long → the eye loses the start of the next line; too short → constant return-sweeps break rhythm. Constrain text containers (`max-w-prose` / a ch-based max width), don't let body copy run the full width of a desktop viewport.
- **Density tiers.** Consumer UIs lean spacious; information-dense pro tools (data tables, dashboards) legitimately run tighter. Density is a *named tier* with its own (still-systematic) scale, not an excuse to abandon the scale.

### 2.5 Responsive reflow

Space and layout must hold at the smallest target. A multi-column desktop layout reflows to a single column on a phone; nothing overflows the viewport horizontally; nothing overlaps. Spacing typically *reduces* a step or two at small viewports (less outer padding) but stays on the scale. Mobile is the real surface, not an afterthought.

---

## 3. Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Do — scale-based spacing + proximity grouping:**
```tsx
<section className="space-y-8 p-6">            {/* between groups: 32px */}
  <div className="space-y-1">                   {/* within a field group: 4px */}
    <Label>Email</Label>
    <Input type="email" />
  </div>
  <div className="space-y-1">
    <Label>Password</Label>
    <Input type="password" />
  </div>
</section>
```
Intra-group gap (4) < inter-group gap (32): the eye groups each label+field and separates the two fields. All values are scale steps.

**Don't — arbitrary, anti-grouping spacing:**
```tsx
<section style={{ padding: 23 }}>
  <Label style={{ marginBottom: 14 }}>Email</Label>
  <Input style={{ marginBottom: 16 }} />        {/* 16 within ≈ space between → grouping ambiguous */}
  <Label style={{ marginBottom: 14 }}>Password</Label>
  <Input />
</section>
```
Off-scale magic numbers; near-equal intra/inter spacing destroys grouping.

**Do — constrained measure:**
```tsx
<article className="max-w-prose mx-auto">{/* ~65ch */} {longCopy}</article>
```

**Don't — full-width body copy:**
```tsx
<article className="w-full">{longCopy}</article>   {/* 120+ char lines on desktop — fatiguing */}
```

**Do — reflow without overflow:** `className="grid grid-cols-1 md:grid-cols-3 gap-6"` — single column on mobile, three on desktop, equal gaps.

**Don't — fixed widths that overflow:** `className="w-[1100px]"` inside a phone viewport → horizontal scroll, cut-off content.

---

## 4. Common failure modes

| Failure | How it reads to the user | How to detect |
|---|---|---|
| Cramped / no breathing room | Cluttered, overwhelming, high cognitive load | Padding/gaps ≈ 0 or far below scale on dense regions |
| Off-scale / arbitrary values | Subtly "off," no rhythm; forked system | Computed margin/padding/gap is not a member of the spacing scale (e.g. 7/13/23px) |
| Ambiguous grouping (intra ≈ inter) | Can't tell what's related | Intra-group gap ≈ inter-group gap between sibling groups |
| Misalignment / off-grid | Sloppy, untrustworthy | Sibling elements that should align have differing left/top edges |
| Horizontal overflow / overlap (mobile) | Content cut off or unreachable; horizontal scroll | `scrollWidth > clientWidth` at 375px; overlapping bounding boxes |
| Over-long measure | Eye loses the line; fatigue | Text container line length > ~75ch |
| Uneven sibling gaps | Broken rhythm, looks accidental | Gaps between equivalent siblings differ |
| Outer padding < inner gaps | Group "bursts" its container | Container padding < child gaps |

---

## 5. ✅ Agent-applicable RULES (the payoff)

PASS/FAIL rules the **design-quality** / **visual-review** gauntlet can mechanically apply. Severity convention: `critical` = breaks the page / hides content; `high` = a gate failure; `medium`/`low` = degraded/cosmetic. **Any `critical` or `high` finding = FAIL.**

| # | Rule (assertion) | Axis / Category | Detection (observed vs expected) | Severity if violated |
|---|---|---|---|---|
| L1 | **Spacing is on-scale.** Every margin/padding/gap resolves to a spacing-scale step (4/8/12/16/24/32/48/64/96), not an arbitrary value. | design-tokens / layout | Computed spacing value not a scale member. Observed `margin: 23px`; Expected a scale step (e.g. 24px). | medium–high |
| L2 | **Intra-group < inter-group spacing.** Space within a group is strictly less than space between groups. | visual-hierarchy / layout | Measure gap inside a group vs between groups. Observed both ≈16px; Expected inner < outer (e.g. 4 vs 32). | high (grouping unparseable) |
| L3 | **No horizontal overflow at mobile.** At the 375px viewport, content fits — no horizontal scroll. | mobile-responsive / layout | `document.documentElement.scrollWidth > clientWidth` at 375px. Observed scrollWidth 412 > 375; Expected ≤ viewport. | critical (content cut off) |
| L4 | **No overlapping elements.** Interactive/content elements do not overlap unintentionally at any tested viewport. | layout | Compare bounding boxes; intersecting non-stacking rects. Observed CTA overlaps footer text; Expected no overlap. | critical |
| L5 | **Siblings align.** Equivalent siblings share an alignment edge / column grid. | layout / visual-hierarchy | Differing computed `left`/`top` on items that should align. Observed cards at x=16 and x=19; Expected equal. | medium |
| L6 | **Equal gaps between equivalent siblings.** List items / cards / nav links have consistent gaps. | layout | Gaps between equivalent siblings differ. Observed 12px / 20px / 12px; Expected uniform. | medium |
| L7 | **Body measure ≤ ~75ch.** Long-form text containers cap line length around 45–75 characters. | layout / visual-hierarchy | Computed line length of body container > ~75ch. Observed ~110ch full-width; Expected ≤ 75ch. | medium |
| L8 | **Adequate breathing room.** Primary content/sections have non-trivial padding (≥ a mid scale step); the layout isn't edge-to-edge cramped. | visual-hierarchy / layout | Section/container padding near 0 on a content region. Observed `padding: 2px`; Expected ≥ 16–24px. | medium–high |
| L9 | **Spacing stays on-scale after reflow.** At mobile, reduced spacing still resolves to scale steps (not arbitrary shrink). | mobile-responsive / design-tokens | Mobile computed spacing off-scale. Observed `padding: 11px`; Expected a scale step (e.g. 12px). | medium |
| L10 | **Container padding ≥ inner gaps (default).** A group's outer padding is not smaller than the gaps between its children. | layout | Container padding < child gap. Observed `p-2` with `gap-6`; Expected padding ≥ gap. | low–medium |

> **Hedging note (contrarian-grounded):** a rigid scale is the default, but disciplined exceptions exist — *optical* alignment nudges, *density tiers* for data-dense tools, and *fluid* `clamp()` spacing that interpolates between breakpoints rather than snapping to fixed steps. These pass L1 only if they are *systematic* (a named tier, a documented clamp formula), not one-off magic numbers. When an off-scale value is clearly an optical/fluid intent, prefer a `low` "confirm systematic" finding over a hard fail.

---

## 6. Sources (provenance / evidence only)

- Design Systems — Space, Grids, and Layouts (spatial systems rationale). https://www.designsystems.com/space-grids-and-layouts/
- Nielsen Norman Group — The Principle of Proximity. https://www.nngroup.com/articles/gestalt-proximity/
- Nielsen Norman Group — The Principle of Common Region. https://www.nngroup.com/articles/common-region/
- Nielsen Norman Group — Group Form Elements Effectively Using White Space. https://www.nngroup.com/articles/form-design-white-space/
- Laws of UX — Law of Proximity. https://lawsofux.com/law-of-proximity/
- Baymard Institute — Readability: The Optimal Line Length. https://baymard.com/blog/line-length-readability
- Material 3 — Layout / Spacing (8pt component grid + 4pt baseline). https://m3.material.io/foundations/layout/understanding-layout/spacing
