---
guide: GESTALT_GROUPING
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: standard
trains: [design-lead, design-quality, visual-review]
maps_to: [visual-hierarchy, component-usage, layout]
sources:
  - "https://ixdf.org/literature/topics/gestalt-principles"
  - "https://lawsofux.com/laws/law-of-proximity/"
  - "https://lawsofux.com/laws/law-of-common-region/"
  - "https://lawsofux.com/laws/law-of-pragnanz/"
  - "https://refactoringui.com/"
  - "https://www.nngroup.com/articles/gestalt-proximity/"
---

# Gestalt Grouping

**Gestalt grouping** is the set of perceptual laws (proximity, similarity, common region, continuity, closure, figure-ground) by which the human visual system automatically decides which on-screen elements *belong together* before the user has read a single word — and a designer either works *with* those laws or fights them.

## Why it matters

Grouping is **pre-attentive**: the brain partitions a screen into groups in the first ~50–100ms, faster than conscious reading. The user never decides "these three things are related" — perception decides it for them, and they act on that perception. This makes Gestalt the *physics* underneath layout: if your spacing, borders, and styling say "these belong together," the user will treat them as one unit whether or not they actually do. Mis-grouping is therefore not cosmetic — it is a comprehension bug that ships as a layout that "looks fine" but is read wrong.

For the MC designer agents specifically:

- **design-lead** owns clarity and consistency (`kiss`, `clear-iconography`). Gestalt is how a screen becomes "simple": fewer *perceived* objects (a labeled group reads as one chunk) lowers cognitive load even when the element count is unchanged. It's also how the same action looks the same everywhere — similarity is the perceptual mechanism behind a consistent visual language.
- **design-quality** judges the `visual-hierarchy` and `component-usage` axes. A control whose label is visually grouped with the *wrong* field, a card whose footer floats free of its body, or a related set of items with no shared region are all Gestalt failures that read as hierarchy/grouping defects.
- **visual-review** judges the `layout` category from pixels. Most "this looks off / cluttered / disorganized" findings reduce to a violated Gestalt law — equal spacing inside and outside a group, a misaligned item breaking continuity, a tooltip with no figure-ground separation from the page.

Gestalt is the perceptual *cause*; visual hierarchy is the *effect* you steer with it. This guide is the layer beneath `VISUAL_HIERARCHY` and `LAYOUT_GRID_SPACING`.

## Core principles / techniques

### 1. Proximity — distance encodes relationship

Elements placed close together are perceived as a group; elements with more space between them are perceived as separate. Proximity is the **strongest and cheapest** grouping signal — it beats similarity and often beats explicit borders. The brain reads *relative* spacing, not absolute: what matters is that the gap *within* a group is smaller than the gap *between* groups.

- **The within < between invariant.** A label and its input must be closer to each other than that pair is to the next field. A card's title, body, and metadata must be closer to each other than the card is to its neighbor. When inner and outer spacing are equal, the eye cannot find the group boundary and the layout reads as an undifferentiated grid of items.
- **Whitespace is the separator.** You do not need a border or a line to create a group — a larger gap does it. Refactoring UI's rule: reach for space before you reach for a divider. Dividers add visual noise; absence of a divider where proximity already groups is *cleaner*, not lazier.
- **The classic failure** (NN/g): a label sitting equidistant between the field above and the field below, so the user can't tell which field it labels. Proximity ambiguity in a form is a data-entry error generator.
- *Why (perception):* proximity grouping is one of the earliest, most robust visual operations; it is largely involuntary and survives across cultures and ages, which is why it's the safest lever for low-literacy or older cohorts (the design-lead's `build-for-audience-incl-limitations`).

### 2. Similarity — shared appearance encodes "same kind"

Elements that share a visual attribute — color, shape, size, type style, icon treatment — are perceived as the same *category* of thing, even when far apart. Similarity is what lets a user learn "blue underlined = link" or "this pill shape = a tag" once and apply it everywhere.

- **Consistency is similarity applied across the app.** If every primary action is the same color/shape/size, the user finds the next primary action instantly. If two buttons that do different-importance jobs look identical, the user is told (falsely) they are equivalent. This is the perceptual basis of `component-usage`: a library primitive used consistently *is* a similarity contract.
- **Don't make unrelated things look alike** (false grouping). A non-interactive badge styled exactly like a button promises an affordance it doesn't have. Distinct roles need distinct, *systematic* styling — not random difference, but difference that maps to meaning.
- **One dimension per distinction.** If color already separates two groups, you usually don't also need shape *and* size *and* a border — redundant encoding becomes noise. Vary the *minimum* number of attributes that makes the distinction unambiguous.

### 3. Common region — a shared container is an unbreakable group

Enclosing elements in a shared boundary — a card, a panel, a tinted background, a bordered box — groups them *more strongly than proximity*, and can override proximity. Two items inside one card read as related even if a third (closer, but outside the card) is not.

- **The card is the workhorse.** A surface (background tint, border, radius, optional elevation) declares "everything here is one unit." This is why card-based layouts scale: each card is a self-evident region. Misuse: a card whose padding is so tight the content touches the edge, weakening the "contained" reading; or nested cards with the same surface, so the regions stop separating.
- **Common region resolves proximity conflicts.** When two groups must sit close (dense dashboards), give each a region (subtle background or border) so proximity alone doesn't bleed them together.
- *Trade-off:* every region you draw is visual weight. Don't box things that proximity already groups — that's the divider-overuse failure. Use the *weakest* grouping cue that works: space → subtle tint → border → elevation, in that order of escalation.

### 4. Continuity — the eye follows aligned paths

The eye prefers to follow continuous lines and smooth paths; elements arranged along a line (a shared edge, a baseline, a column) are perceived as related and as a *sequence*. Alignment is continuity in practice.

- **A shared edge is a free grouping line.** Left-aligning a stack of items creates an invisible vertical line the eye rides down — they read as one list. One item indented out of that line breaks the group and signals (intentionally or not) "this is different."
- **Alignment is not decoration; it's grouping.** Ragged, multi-axis alignment forces the eye to re-acquire each element, raising scan cost and reading as "messy." A strict alignment grid is the cheapest way to look organized.
- **Z- and F-pattern scanning** (continuity at page scale): users sweep along predictable paths. Place the entry point, then the next beat, then the resolution *along* that path so continuity carries the eye through the intended sequence (this is the bridge to `VISUAL_HIERARCHY`'s three-flow).

### 5. Closure & Prägnanz — the eye completes and simplifies

**Closure:** the mind fills in gaps to perceive a complete, recognizable shape (an icon outline, a partially-shown carousel item that implies "more to the right"). **Prägnanz (law of good figure):** people perceive the *simplest* possible interpretation of complex stimuli.

- **Closure lets you do more with less** — a clipped card at the viewport edge tells the user the list continues; an open-path icon still reads as the object. But broken closure (a shape that *almost* closes but visibly doesn't, a border that's open on one side by accident) reads as a rendering bug.
- **Prägnanz is the argument for simplicity** (the design-lead's `kiss`): a layout that resolves to a clean grid of obvious groups is perceived as effortless; one that has no simple reading is perceived as cluttered and is mentally taxing. "If the eye can't find the simple structure, there isn't one."

### 6. Figure-ground — what is foreground vs. background

Perception separates a scene into the *figure* (the object of attention) and the *ground* (everything behind it). Stable figure-ground is what makes a modal read as "on top," a dropdown as "in front of," a disabled control as "receded."

- **Layered UI depends on it.** A modal needs a scrim/overlay so the dialog is unambiguously figure and the page is ground; without separation the modal floats confusingly *in* the page. A dropdown/popover needs enough contrast or elevation that it doesn't merge with the content beneath (this is the seam with `DEPTH_ELEVATION_IMAGERY`).
- **Ambiguous figure-ground = a usability bug**, not an aesthetic quirk: a tooltip the same color as the page, a sticky header that doesn't visually detach when content scrolls under it, light-grey text that recedes into a light background (which is also a contrast failure).

### How the laws stack and conflict

Real layouts use several laws at once, and they can fight:
- Proximity says "group A and B (they're close)"; common region says "no — B is in a different card." **Common region wins.**
- Similarity says "these two are the same kind"; proximity says "they're in different groups." Both can be true (same *kind*, different *group*) — this is normal and good.
- The designer's job is to make the *intended* grouping the one that wins, by escalating to a stronger cue (region/elevation) only when a weaker one (space/alignment) is being overridden.

## Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Proximity — form field grouping**
- ❌ DON'T: `<label>` and `<input>` separated by `mb-4`, and consecutive field pairs also separated by `mb-4`. Equal inner/outer gap → the eye can't bind label to field.
- ✅ DO: tight label→input (`space-y-1` / `mb-1`), generous pair→pair (`space-y-6`). Inner gap < outer gap. The form reads as discrete labeled groups with no dividers needed.

**Common region — card integrity**
- ❌ DON'T: a shadcn `Card` whose `CardFooter` action buttons sit in `p-0` flush to the edge, or a card with `p-1` so content kisses the border — the "contained" reading collapses and the footer looks detached.
- ✅ DO: consistent internal padding (`p-6`) so a clear margin proves containment; one surface per logical unit; never nest two `bg-card` surfaces with identical tint (give the inner one a different shade or drop the surface entirely).

**Similarity — consistent action styling**
- ❌ DON'T: the "Save" primary action is a solid brand-colored `Button` on one screen and a ghost `Button` on the next; meanwhile a read-only status badge is styled identically to a button.
- ✅ DO: one `Button variant="default"` for every primary action app-wide (similarity = findability); non-interactive things (`Badge`) use a visibly non-button shape/weight so they never falsely promise an affordance.

**Continuity — alignment**
- ❌ DON'T: a settings list where each row's label starts at a slightly different x because icons have inconsistent widths; the left edge zig-zags.
- ✅ DO: a fixed-width leading slot (`w-6` icon column) so every label shares one left edge — `flex items-center gap-3` with a constrained icon box. One continuous vertical line = one perceived list.

**Figure-ground — overlay**
- ❌ DON'T: a Radix `Dialog` with no overlay tint (`bg-transparent`) so the modal sits ambiguously over still-vivid page content.
- ✅ DO: a `Dialog.Overlay` with `bg-black/50` (or a backdrop blur) so the dialog is unmistakably figure and the page recedes to ground; the same logic for `Popover`/`DropdownMenu` (give the surface `bg-popover` + `shadow-md` so it lifts off the content).

## Common failure modes

- **Equidistant spacing ("the grey soup").** Inner and outer gaps equal everywhere → no perceptible groups; the screen reads as one flat field. To the user: cluttered, hard to scan, "where do I look?" *Detect:* compare the gap inside a logical group to the gap between groups; if they're equal or within ~25%, grouping has failed.
- **Divider overuse.** Every group fenced with a border/line when extra space would have grouped it for free → heavy, noisy, "boxed-in." *Detect:* count separators; if removing a divider doesn't merge two groups (because proximity/region already separates them), the divider is noise.
- **False grouping via false similarity.** Unrelated things share a strong style (a badge that looks like a button) → users expect an affordance that isn't there; or a heading styled like body text so its group never reads as a header. *Detect:* does visual sameness imply functional sameness? If two same-styled elements behave differently, similarity is lying.
- **Broken alignment (continuity).** Items off the shared edge, multi-axis ragged layout → "messy," eye re-acquires each element, scan cost up. *Detect:* trace the left/right edges of a list/column; any item off-axis without a deliberate reason is a violation.
- **Figure-ground collapse.** Overlay/popover/tooltip/sticky-header with no separation from the content behind → layering is ambiguous; the floating element looks broken or unreadable. *Detect:* can you tell, from a static screenshot, what is on top? If the modal/popover doesn't have a scrim, border, elevation, or contrast step against what's behind it, it fails.
- **Region without breathing room.** A card with near-zero padding so the boundary and content fuse → containment reading lost. *Detect:* is there a visible margin between a region's edge and its contents on all sides?

## ✅ Agent-applicable RULES (the payoff)

Each rule is a mechanically-checkable PASS/FAIL the design-quality / visual-review gauntlet can apply, mapped to an axis/category, phrased in observed-vs-expected form.

| # | Rule (PASS condition) | Maps to | How to detect a violation | Severity if violated |
|---|---|---|---|---|
| G1 | **Within < between.** For any labeled control or grouped block, the spacing *inside* the group is strictly less than the spacing to the adjacent group (recommend ≥1.5× ratio). | design-quality `visual-hierarchy`; visual-review `layout` | Measure computed `margin`/`gap`/`padding` (`browser_evaluate` `getComputedStyle`) inside vs. between groups. Observed: inner gap ≥ outer gap. Expected: inner < outer. | high |
| G2 | **Label–control binding is unambiguous.** Every form label is visibly closer to its own control than to any neighboring control, AND is programmatically associated (`for`/`id` or wrapping). | design-quality `component-usage`, `accessibility`; visual-review `layout`, `a11y` | Snapshot a11y tree (label association) + compute label→own-field vs label→other-field distance. Observed: equidistant/ambiguous. Expected: bound to one field. | critical (data-entry risk) |
| G3 | **One surface per logical unit; regions have padding.** Each card/panel has internal padding on all sides (content does not touch its boundary) and no two directly-nested surfaces share an identical background. | design-quality `component-usage`, `design-tokens`; visual-review `layout` | Compute card `padding` (must be > 0 on all sides) and compare nested surface `background-color`. Observed: `p-0`/content flush, or identical nested `bg`. Expected: visible inner margin, distinct/absent nested surface. | medium |
| G4 | **No divider where space already groups.** Separators (`<hr>`, full borders) appear only where proximity/region don't already establish the boundary. | visual-review `layout`; design-quality `visual-hierarchy` | Count dividers; for each, check whether adjacent groups would still read as separate without it (sufficient gap/region). Observed: redundant divider. Expected: divider only carries the boundary. | low |
| G5 | **Similarity maps to function.** Elements that look alike (same color+shape+size as an interactive primitive) ARE interactive of the same role; non-interactive elements (badges, chips, status) are visibly distinct from buttons. | design-quality `component-usage`; visual-review `layout` | Compare computed style of suspected look-alikes; cross-check `role`/tag. Observed: a non-button styled as a button (false affordance) or two same-styled controls of different importance. Expected: visual sameness ⇒ functional sameness. | high |
| G6 | **Shared alignment edge (continuity).** Items in a list/column/menu share a common left (or right) edge; none is off-axis without a deliberate, explained reason (e.g., intentional indent for nesting). | visual-review `layout`; design-quality `visual-hierarchy` | Compare `getBoundingClientRect().left` across sibling items; flag outliers beyond ~2px not attributable to nesting. Observed: ragged edge. Expected: one continuous edge. | medium |
| G7 | **Figure-ground separation for overlays.** Every modal/dialog has a backdrop scrim (or blur); every popover/dropdown/tooltip has a surface treatment (distinct background + border/elevation) so it reads as on-top of the content behind it. | design-quality `component-usage`; visual-review `layout`, `color` | Inspect overlay element: presence of scrim element / non-transparent background + shadow/border. Observed: transparent overlay, popover merging with page. Expected: clear figure-ground step. | high |
| G8 | **No equidistant "grey soup."** Across the primary view, distinct logical groups are perceptible (the layout does not resolve to a single uniform field of evenly-spaced items). | visual-review `layout`; design-quality `visual-hierarchy` | Visually inspect screenshot + sample gaps: if every gap is within ~25% of every other gap and no regions exist, no groups are perceptible. Observed: flat uniform spacing. Expected: ≥2 distinguishable groups via space/region. | high |

**Verdict guidance:** any G2 or G7 at `critical`/`high`, or two or more `high` findings across G1/G5/G8, is a gauntlet FAIL (the grouping is being read wrong, not merely imperfect). Isolated G4/G6 at `low`/`medium` are fixes, not gate failures.

## Sources

- Interaction Design Foundation — *Gestalt Principles* (proximity, similarity, common region, continuity, closure, figure-ground, Prägnanz): https://ixdf.org/literature/topics/gestalt-principles
- Laws of UX — Law of Proximity: https://lawsofux.com/laws/law-of-proximity/ ; Law of Common Region: https://lawsofux.com/laws/law-of-common-region/ ; Law of Prägnanz: https://lawsofux.com/laws/law-of-pragnanz/
- Refactoring UI (Wathan & Schoger) — "Layout and Spacing" / grouping with whitespace before dividers: https://refactoringui.com/
- Nielsen Norman Group — *Proximity Principle in Visual Design*: https://www.nngroup.com/articles/gestalt-proximity/
