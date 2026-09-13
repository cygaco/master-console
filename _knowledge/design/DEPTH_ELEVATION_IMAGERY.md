---
guide: DEPTH_ELEVATION_IMAGERY
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: standard
trains: [design-lead, design-quality, visual-review]
maps_to: [design-tokens, component-usage, layout, color]
sources:
  - "https://refactoringui.com/"
  - "https://m3.material.io/styles/elevation/overview"
  - "https://www.nngroup.com/articles/text-over-images/"
  - "https://www.w3.org/TR/WCAG22/"
  - "https://web.dev/articles/cls"
---

# Depth, Elevation & Imagery

**Depth & elevation** is the systematic use of shadow, light, and overlap to tell the eye which surfaces sit *above* others (the z-axis of a flat screen); **imagery** is the disciplined handling of photos/illustrations — including unpredictable user-uploaded content — so they reinforce hierarchy and legibility instead of breaking layout and contrast.

## Why it matters

A screen is physically flat, but users read it as layered: a card floats above the page, a modal floats above the card, a menu drops in front of content. That layering is **figure-ground perception** (see `GESTALT_GROUPING`) made tangible with light and shadow. Done as a token-backed system, depth communicates *interactivity and importance* instantly and consistently. Done ad-hoc, it produces the most common "looks unprofessional" tells: shadows pointing in different directions, a raised card that doesn't actually look raised, a modal that doesn't sit on top, an image whose text is illegible, a user avatar that blows out the layout.

For the MC designer agents:

- **design-lead** owns consistency and clarity (`clear-iconography`, `kiss`). Elevation is a *semantic* signal — "this is clickable / this is on top / this is the active surface." Inconsistent elevation is the same class of bug as inconsistent iconography: the same depth meaning two different things. Imagery handling (especially user-uploaded) is squarely the `build-for-audience-incl-limitations` and state-coverage lens — real content is messy.
- **design-quality** judges `design-tokens` (elevation must resolve to the token set, not ad-hoc box-shadows) and `component-usage` (the right primitive carries the right elevation for its role). A hand-rolled `box-shadow: 2px 2px 4px black` instead of a token is a tokens violation even when it "looks ok."
- **visual-review** judges `layout` (overlap/layering reads correctly) and `color` (image overlay contrast, shadow visibility in light *and* dark mode). It also catches the **CLS / layout-shift** failure: images with no reserved space that jump the layout when they load.

This guide is the depth side of the figure-ground law and the imagery side of contrast — it sits between `GESTALT_GROUPING`, `COLOR_AND_CONTRAST`, and `LAYOUT_GRID_SPACING`.

## Core principles / techniques

### 1. Elevation is a quantized scale, not free-form shadow

Real design systems treat depth as a small, ordered set of levels — *resting* surfaces, *raised* (cards/buttons), *floating* (menus/popovers/FABs), *overlay* (dialogs/sheets) — each mapped to a defined shadow recipe. Material's dp scale (0→24dp) and any tokenized `--shadow-sm / -md / -lg / -xl` set express the same idea: **a handful of elevation tokens, applied by role.**

- **Higher elevation = larger, softer, more-offset shadow.** As a surface rises, its shadow grows larger and more diffuse (the light spreads), and it casts farther. A button at rest has a tight shadow; an open dropdown has a broader, softer one; a modal has the largest. The *gradient of shadow size* is what the eye reads as "how high."
- **The scale must be monotonic and meaningful.** Resting < raised < floating < overlay. If a card has a heavier shadow than the modal that opens above it, the z-order *lies* and the user is confused about what's on top.
- *Why (perception):* shadows are a depth cue the visual system processes automatically from real-world light experience. A consistent, ordered set of shadows reads as a coherent physical space; a random assortment reads as "broken."

### 2. One light source — shadows all point the same way

In the physical world a scene has (effectively) one dominant light, so all shadows fall in the same direction. UIs inherit this: **a single, consistent light source — by overwhelming convention, top / slightly-top — so every shadow offsets downward (positive y, small or zero x).**

- **Downward shadows for raised surfaces; the same direction everywhere.** A card's shadow below it, a button's shadow below it, a header's shadow below it as content scrolls under. Mixed directions (one element's shadow up, another's down) instantly read as amateur because no real light could produce it.
- **Inset shadows for *pressed-in* surfaces.** An input or a pressed button can use an *inner* shadow to read as recessed below the surface — the inverse of elevation. This is a legitimate, distinct use; just keep its light direction consistent too.
- **Layered shadows for realism.** Refactoring UI's technique: combine a tight, slightly-darker shadow (the contact/penumbra) with a larger, softer, lighter one (ambient) for a natural raised look — but still one direction. This is the difference between a "flat drop shadow" and depth that looks intentional.

### 3. Color and overlap also create depth — shadow isn't the only tool

Depth is multi-cue. Even in a shadow-light ("flat") aesthetic you can establish layering with:

- **Overlap.** An element partially covering another is unambiguously in front — the strongest, most primitive depth cue. A profile photo overlapping the header band, a card peeking over a section edge.
- **Surface color steps.** A slightly lighter surface advances; a slightly darker one recedes (in light mode — inverted in dark mode). A subtly lighter card on a slightly darker page background reads as raised even before any shadow. (Dark-mode systems lean on this because shadows are weak on dark backgrounds — Material *brightens* higher surfaces instead of shadowing them.)
- **Size/blur (atmospheric depth).** Larger, sharper, higher-contrast = closer; smaller, blurrier, lower-contrast = farther. A backdrop blur behind a modal pushes the page back.

### 4. Depth must survive dark mode

Shadows are nearly invisible on dark backgrounds, so an elevation system that *only* uses drop-shadows breaks in dark mode — every surface flattens.

- **Pair shadow with a surface-tint strategy.** In dark mode, raise surfaces by *lightening* them (a higher overlay/tint) in addition to (or instead of) shadow. Token your elevation so the *same* level resolves to "shadow X" in light and "surface-tint Y" in dark.
- **Test both themes.** An elevation that's a crisp card in light mode and an invisible flat panel in dark mode is a real regression, not a theme preference.

### 5. Imagery: make real content behave

Images are content the designer doesn't fully control — especially user-uploaded avatars, listings, and uploads. Treat them as a state-coverage problem.

- **Reserve the space (kill layout shift).** Always give media an intrinsic size or aspect ratio (`width`/`height` attributes or `aspect-ratio`) so the box exists *before* the pixels load. The alternative — content jumping when an image arrives — is a Cumulative Layout Shift failure and a jarring, trust-eroding experience.
- **Constrain to a fixed frame with `object-fit: cover`.** User images come in every dimension. A fixed-ratio frame + `object-fit: cover` crops gracefully so a portrait upload doesn't stretch the layout and a wide one doesn't squish. Set a `background-color` behind transparent images so they don't clash.
- **Always provide the empty/broken state.** A missing avatar needs a placeholder (initials, a neutral silhouette); a failed image needs a fallback box, not a broken-image icon. If the product depends on user content, the empty state is a priority, not an afterthought.
- **Text over images needs guaranteed contrast.** Never lay text directly on an arbitrary photo and hope. Apply a semi-transparent overlay (a dark scrim, or a gradient scrim behind just the text band) or a text shadow so the text clears the contrast floor *regardless of the image behind it*. The contrast requirement (4.5:1 body / 3:1 large — see `COLOR_AND_CONTRAST` / `ACCESSIBILITY_WCAG`) applies to the worst-case pixel under the text, not the average.
- **Quiet the image so the UI leads.** A loud full-bleed photo competes with the content. Lower its contrast, tint it toward the brand, or scrim it so the foreground UI stays the figure (figure-ground again).
- **Consistent image treatment.** All avatars circular at the same size; all thumbnails the same ratio and corner radius; all hero images the same scrim. Inconsistent image treatment reads as inconsistency the same way mismatched buttons do.
- **Always set meaningful `alt`** (or `alt=""` for purely decorative images) — imagery is also an accessibility surface.

## Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Elevation as tokens, ordered by role**
- ❌ DON'T: `style={{ boxShadow: '2px 2px 5px rgba(0,0,0,0.6)' }}` on a card (off-axis x, ad-hoc, darker than the modal's shadow).
- ✅ DO: `shadow-sm` on resting cards, `shadow-md` on popovers/dropdowns, `shadow-lg`/`shadow-xl` on dialogs — every shadow a token, every level monotonic. The shadow scale lives in `globals.css`/theme; components reference it by role.

**One light source**
- ❌ DON'T: a header with `shadow-[0_-4px_8px...]` (upward) sitting above cards with downward shadows — two impossible light sources on one page.
- ✅ DO: every raised surface offsets its shadow downward (`0 y-offset, larger blur as it rises`); a sticky header gets a downward shadow when content scrolls under it (`shadow-sm` on scroll), matching the card direction.

**Dark-mode depth**
- ❌ DON'T: cards distinguished only by `shadow-md` — in `dark` they vanish into `bg-background` and the whole screen flattens.
- ✅ DO: `bg-card` is a touch lighter than `bg-background` in dark mode (surface-tint elevation) *and* keeps a subtle shadow in light mode; verify both `:root` and `.dark` token sets render the layering.

**User image frame + shift prevention**
- ❌ DON'T: `<img src={user.avatar} className="rounded-full" />` with no dimensions and no fallback — layout jumps on load (CLS), broken-image icon on failure, distorted shape for non-square uploads.
- ✅ DO: a fixed `h-10 w-10` (or `aspect-square`) frame, `object-cover`, `bg-muted` behind it, an `onError`/`Avatar`+`AvatarFallback` (initials) fallback, and `next/image` with `width`/`height` so the box is reserved before load.

**Text over image**
- ❌ DON'T: white headline directly on a user-uploaded hero photo (illegible whenever the photo is light).
- ✅ DO: a gradient scrim layer (`bg-gradient-to-t from-black/70 to-transparent`) behind the text band so the text always clears 4.5:1 regardless of the photo; or a solid `bg-black/50` overlay on the whole hero.

## Common failure modes

- **Ad-hoc / off-axis shadows.** Inline `box-shadow` with random offsets/colors, x-offset present, or darker-than-it-should-be. Reads as "amateur," and breaks the elevation system. *Detect:* computed `box-shadow` not matching any token; non-zero (or inconsistent-sign) x-offset across elements.
- **Inverted z-order.** A lower-role surface (card) has a stronger shadow than a higher-role one (modal/dropdown). The layering lies. *Detect:* compare shadow magnitude against role; resting must be ≤ raised ≤ floating ≤ overlay.
- **Mixed light sources.** Shadows pointing different directions on the same screen. *Detect:* sample `box-shadow` y/x signs across elements; all raised elements should share direction.
- **Dark-mode flattening.** Layering visible in light mode, gone in dark. *Detect:* screenshot both themes; if surfaces are indistinguishable in dark and depend solely on shadow, fail.
- **Layout shift on image load (CLS).** Media with no reserved dimensions; content jumps when images arrive. *Detect:* `<img>`/media without `width`/`height`/`aspect-ratio`; measure CLS or watch the box resize on load.
- **Unframed user content.** Non-square avatar stretched, oversized upload pushing layout, transparent PNG clashing with background. *Detect:* media without a fixed frame + `object-fit`; check behavior with extreme-aspect test content.
- **Missing image fallback.** Broken-image glyph or empty hole on load failure / missing data. *Detect:* no `onError`/placeholder/`AvatarFallback`; no empty state for content-dependent imagery.
- **Illegible text over imagery.** Text on a photo with no scrim/overlay/shadow. *Detect:* text directly over an image element with no intervening overlay; sample worst-case contrast under the text region.
- **Image dominates / competes.** Full-bleed loud photo overpowering the UI's primary action. *Detect:* the most prominent thing on screen is decorative imagery, not the primary task element (cross-check `VISUAL_HIERARCHY`).

## ✅ Agent-applicable RULES (the payoff)

| # | Rule (PASS condition) | Maps to | How to detect a violation | Severity if violated |
|---|---|---|---|---|
| D1 | **Elevation resolves to tokens.** Every `box-shadow` matches a defined elevation token (`--shadow-*` / theme scale); no inline/ad-hoc shadow values. | design-quality `design-tokens`; visual-review `layout` | `browser_evaluate` computed `box-shadow`; compare against the token set. Observed: arbitrary inline shadow. Expected: a named token value. | high |
| D2 | **Monotonic z-order.** Shadow strength increases with role: resting ≤ raised(card/button) ≤ floating(menu/popover) ≤ overlay(dialog). No lower surface out-shadows a higher one. | design-quality `component-usage`, `design-tokens`; visual-review `layout` | Compare shadow blur/spread of a card vs. the popover/modal layered above it. Observed: card shadow ≥ modal shadow. Expected: modal > card. | high |
| D3 | **Single light source.** All raised-surface shadows share one direction (convention: downward; y-offset positive, x-offset ~0). | visual-review `layout` | Sample `box-shadow` x/y signs across elevated elements. Observed: mixed directions / horizontal offsets. Expected: uniform downward. | medium |
| D4 | **Depth survives dark mode.** Surface layering remains perceptible in dark theme (via surface-tint and/or shadow), not shadow-only. | visual-review `color`, `layout`; design-quality `design-tokens` | Screenshot `.dark`; compare `bg-card` vs `bg-background` lightness + shadow visibility. Observed: surfaces indistinguishable in dark. Expected: visible layering in both themes. | high |
| D5 | **Media reserves space (no CLS).** Every image/media element has explicit `width`+`height` or `aspect-ratio` so its box exists before load; no layout shift on image arrival. | visual-review `regression` (CLS); design-quality `mobile-responsive` | Check for `width`/`height`/`aspect-ratio`; observe box during load (or measure CLS). Observed: missing dimensions / box resizes on load. Expected: reserved box, CLS ~0. | high |
| D6 | **User content is framed.** Avatars/thumbnails/uploads sit in a fixed-ratio frame with `object-fit: cover` and a background fill; no stretched/squished or layout-busting media. | design-quality `component-usage`, `mobile-responsive`; visual-review `layout` | Inspect for fixed frame + `object-fit`; test with non-square/oversized content. Observed: distorted or layout-pushing media. Expected: graceful crop within a fixed frame. | medium |
| D7 | **Image fallback / empty state exists.** Every dynamic image has a load-failure fallback (placeholder/initials), never a broken-image glyph; content-dependent surfaces have a designed empty state. | design-quality `component-usage`; visual-review `regression` | Force `onError` / empty data; observe. Observed: broken-image icon / empty hole. Expected: placeholder/fallback. | medium |
| D8 | **Text over imagery clears contrast.** Any text laid over a photo/illustration has a scrim/overlay/gradient/shadow guaranteeing ≥4.5:1 (body) / ≥3:1 (large) against the worst-case pixel beneath it. | design-quality `accessibility`; visual-review `color`, `a11y` | Inspect for an overlay element between image and text; sample worst-case contrast under the text region. Observed: text on bare image, low contrast. Expected: scrim + passing contrast. | high |
| D9 | **Consistent imagery treatment.** Like media share treatment (all avatars same shape/size, all thumbnails same ratio/radius/scrim) — no per-instance ad-hoc styling. | design-quality `component-usage`; visual-review `layout` | Compare radius/aspect/size across same-class media. Observed: inconsistent treatment. Expected: uniform per class. | low |
| D10 | **Imagery has `alt`.** Informative images carry meaningful `alt`; decorative images use `alt=""`. | design-quality `accessibility`; visual-review `a11y` | Snapshot a11y tree / inspect `alt`. Observed: missing/auto-filename `alt`. Expected: meaningful or explicitly empty. | medium |

**Verdict guidance:** D2, D4, D5, or D8 at `high` is a FAIL (the layering reads wrong, the layout jumps, or text is illegible — task-impacting). D1 at `high` is a tokens-axis FAIL even if it "looks fine." D3/D6/D7/D9/D10 at `low`/`medium` are fixes unless they accumulate.

## Sources

- Refactoring UI (Wathan & Schoger) — "Creating Depth" (layered shadows, light source, color/overlap depth) + "Working with Images" (object-fit cover, scrims, user content, empty states): https://refactoringui.com/
- Material Design 3 — *Elevation* (elevation scale, dp levels, dark-mode surface tint) as a principle source: https://m3.material.io/styles/elevation/overview
- Nielsen Norman Group — *Ensure High Contrast for Text Over Images*: https://www.nngroup.com/articles/text-over-images/
- W3C — WCAG 2.2 (contrast SC 1.4.3 / 1.4.11, non-text contrast): https://www.w3.org/TR/WCAG22/
- web.dev — *Cumulative Layout Shift* (reserve space for media): https://web.dev/articles/cls
