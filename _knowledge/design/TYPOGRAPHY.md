---
guide: TYPOGRAPHY
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [design-tokens, visual-hierarchy, typography]
sources:
  - "https://refactoringui.com/"
  - "https://baymard.com/blog/line-length-readability"
  - "https://www.uxpin.com/studio/blog/optimal-line-length-for-readability/"
  - "https://www.justinmind.com/blog/best-ux-practices-for-line-spacing/"
  - "https://supercharge.design/blog/20-common-typography-mistakes-in-ui-design"
  - "https://designsystem.digital.gov/components/typography/"
  - "https://www.w3.org/TR/WCAG22/"
---

# Typography

**Typography** is the craft of arranging type — its scale, weight, line length, line height, pairing, alignment, and spacing — so text is both *readable* (effortless to consume) and *hierarchical* (the eye knows what to read first). In a UI, type is the largest surface a user touches and the primary carrier of visual hierarchy; most "design" a user experiences is actually typography.

> One-line test: *can you read a full paragraph without your eye losing its place or straining, and can you tell a heading from body text without reading the words? If not, the type is broken.*

---

## 1. Why it matters

Text is most of the interface. If it's hard to read or its hierarchy is flat, every downstream principle fails — the user can't scan, can't find the action, can't trust the page. Typography does two jobs:

- **Readability** — line length, line height, size, and contrast determine whether reading is effortless or fatiguing.
- **Hierarchy** — size, weight, case, and color make headings, body, and captions distinguishable at a glance (this is the typographic half of `VISUAL_HIERARCHY.md`).

For the **agents this guide trains**:

- **design-lead** — type is where `clarity-is-king` and `clear-iconography` (legible visual language) become concrete; a returning user tolerates dense type less than a first-timer, and the cohort's *limitations* (older eyes, low vision, small phones) set the size/contrast floor.
- **conversion-lead** — readable, scannable type is conversion: an intimidating wall of long lines makes users skip the value prop entirely (Baymard observed this directly in e-commerce testing).
- **design-quality** gauntlet — this guide backs the **`design-tokens`** axis (type scale/size/line-height must resolve to tokens, not ad-hoc values) and contributes to the **`visual-hierarchy`** axis (type as the hierarchy carrier).
- **visual-review** — backs the **`typography`** category directly: wrong size, illegible line length/height, too many fonts, low-contrast text, wrong heading level are all typography findings.

**Readability basis.** The eye reads in saccades (jumps) and fixations. Lines that are too long make the return sweep (finding the next line's start) error-prone; lines too short break the rhythm with too many returns; tight leading makes adjacent lines visually collide; low contrast forces the eye to work to resolve letterforms. The numeric constants below are the ergonomic sweet spots for these mechanics.

---

## 2. Core principles & techniques (with the numeric craft constants)

### 2.1 Type scale — a system, not arbitrary sizes

Sizes should come from a **modular scale**: a base body size multiplied by a fixed ratio for each step up. Common ratios: **1.125** (major second, dense UI), **1.25** (major third), **1.333** (perfect fourth), **1.5** (perfect fifth, expressive), **1.618** (golden). Pick one ratio and derive every size from it. Headings land roughly **1.3×–1.6×** body size per step. This guarantees consistent, distinguishable steps and lets every size be a **design token** (`--text-sm`, `--text-base`, `--text-lg`…), never a one-off value.

### 2.2 Measure (line length) — 45–75 characters, ~66 ideal

The single most-cited readability constant. **Optimal body line length is 45–75 characters per line** (including spaces), with **~66 the cited sweet spot**. Bounds:
- Emil Ruder: 50–60 optimal.
- Up to ~75 acceptable; **WCAG 2.2 SC 1.4.8 caps blocks of text at ≤80 characters** (≤40 for CJK).
- Novices read better near 45; experts tolerate up to ~80.

In build terms: constrain prose containers with `max-width` near `66ch` (≈`34em`). Full-bleed paragraphs that run the width of a desktop are the most common readability failure.

### 2.3 Leading (line height) — 1.4–1.6 for body, ~1.5 sweet spot

**Body line-height of 1.4–1.6 (≈1.5 / 140–150%) is the readability sweet spot**; the acceptable band is ~1.2–2.0. Two coupling rules:
- **Longer measure → more leading.** If lines must run long, raise line-height to protect the return sweep.
- **Smaller text → proportionally more leading.** Small fonts need a higher line-height ratio than display sizes.
- **Headings → tighter leading.** Large headings can drop to ~1.1–1.25; a 1.5 ratio on a 48px headline looks gappy.
Below ~1.0 lines visually touch (a11y and legibility failure); above ~2.0–2.5 the eye loses the next line.

### 2.4 Size floor — body ≥16px on web

**Minimum body size on web is 16px** (≈1rem). Smaller body text is a readability and accessibility problem, especially on mobile and for older/low-vision cohorts. 14px is acceptable only for genuine secondary/caption text; below 12px is a fail. Define sizes in relative units (`rem`) so they respect the user's browser zoom/preferences.

### 2.5 Font count & pairing — ≤2 families, weight as the lever

Use **at most two typefaces** (often one is plenty; a third is for code/mono). Build hierarchy with **size + weight + color**, not by adding fonts. When pairing, ensure the two have *enough contrast* (e.g. a distinct display + a neutral body) — near-identical typefaces read as a mistake; clashing personalities read as chaos. Add a new typeface only when it brings a clear need and advantage.

### 2.6 Weight, case, and color as hierarchy/emphasis

- **Weight** is the cleanest de-emphasis lever (regular vs semibold/bold) — prefer it over shrinking size (see `VISUAL_HIERARCHY.md` §2.1).
- **Case:** reserve ALL CAPS for short labels (buttons, eyebrows, table headers) and **add letter-spacing/tracking** to caps; long all-caps runs read measurably slower.
- **Color:** mute secondary text with a `muted-foreground` token — but never below the contrast floor.

### 2.7 Contrast — type is an accessibility surface

Body text must meet **WCAG 2.2 SC 1.4.3: ≥4.5:1** contrast (≥3:1 for large text ≥24px or ≥18.66px bold). The classic failure is **grey body text on a colored/tinted background**, which silently drops below the floor. Couples to `COLOR_AND_CONTRAST` / `ACCESSIBILITY_WCAG`.

### 2.8 Alignment & spacing details

- **Left-align body** (in LTR); avoid **justified** text on the web — it creates uneven "rivers" of whitespace and inconsistent word spacing.
- Avoid **rags, widows, and orphans** (a single word/line stranded); not always mechanically checkable, but a craft finishing touch.
- Avoid **faux/synthetic bold/italic** (when a weight isn't loaded the browser fakes it, rendering muddy) — load the real weight.

### 2.9 Trade-offs to name

- **Measure is a range, not a single number** — 66ch is the midpoint of 45–75, not a law. Don't fail a 58ch column.
- **Webfonts vs system stacks** — custom fonts carry brand but cost load time and risk FOUT/FOIT/CLS (text reflows when the font swaps); system-font stacks are instant but generic. This couples to Core Web Vitals (`PERFORMANCE_PERCEIVED_UX`).
- **Density vs comfort** — data-dense tools can run tighter type than marketing pages; match the constant to the surface, but never below the legibility/contrast floors.

---

## 3. Concrete examples (build terms — Next / Tailwind / Radix / shadcn)

> Use the project's type tokens (`text-base`, `--text-lg`, theme font-family vars). No product-specific fonts/sizes hardcoded.

**DO — constrain measure on prose**
```tsx
<article className="max-w-prose"> {/* ~65ch; or max-w-[66ch] */}
  <p className="text-base leading-relaxed">Long-form copy stays in the 45–75ch band…</p>
</article>
```

**DON'T — full-width paragraphs**
```tsx
<p className="text-base">{/* runs the full 1280px width → ~140ch, unreadable */}…</p>
```

**DO — readable body leading; tighter heading leading**
```tsx
<h1 className="text-4xl font-bold leading-tight">A clear headline</h1>     {/* ~1.1–1.25 */}
<p className="text-base leading-relaxed">Body copy with comfortable spacing.</p> {/* ~1.5 */}
```

**DON'T — one leading everywhere**
```tsx
<h1 className="text-4xl leading-relaxed">Gappy headline</h1> {/* 1.6 on display = too airy */}
<p className="text-base leading-none">Cramped body</p>       {/* 1.0 body = lines touch */}
```

**DO — hierarchy from size+weight+color, one font**
```tsx
<h2 className="text-2xl font-semibold text-foreground">Section</h2>
<p className="text-base text-muted-foreground">Supporting detail, same font, quieter.</p>
```

**DON'T — three fonts to fake hierarchy**
```tsx
<h2 style={{fontFamily:'Display'}}>Section</h2>
<p style={{fontFamily:'Serif'}}>…</p>
<span style={{fontFamily:'Script'}}>note</span> {/* 3 families = chaos */}
```

**DO — body size floor + relative units**
```tsx
<p className="text-base">{/* 1rem = 16px, respects zoom */}…</p>
```

**DON'T — sub-floor body, especially on mobile**
```tsx
<p className="text-[11px]">Important instructions…</p> {/* below readable floor */}
```

---

## 4. Common failure modes

| Failure | How it reads to the user | How to detect it (computed style) |
|---|---|---|
| **Long measure** | Eye fatigue; loses the next line; skips reading entirely. | Prose container width ÷ avg char width > ~80 chars (or `max-width` unset on a `<p>` block). |
| **Tight leading** | Lines visually collide; cramped, hard to track. | `line-height / font-size < 1.3` on body text. |
| **Loose leading** | Lines feel disconnected; eye drifts. | ratio `> 2.0` on body text. |
| **Too many fonts** | Looks unprofessional/chaotic; weak hierarchy. | ≥3 distinct `font-family` stacks rendered (excluding monospace for code). |
| **Sub-floor body size** | Strain; unreadable on mobile; excludes low-vision users. | computed body `font-size < 16px` (hard fail `< 14px`), esp. at mobile viewport. |
| **Grey-on-color text** | Letters hard to resolve; fails a11y silently. | computed contrast ratio `< 4.5:1` (normal) / `< 3:1` (large). |
| **Heading level vs size mismatch** | Scan order confuses; screen-reader order wrong. | DOM heading level not monotonic with font-size; skipped levels. |
| **All-caps long runs / no tracking** | Slow to read; shouty. | `text-transform: uppercase` on long text, or caps with `letter-spacing: normal`. |
| **Justified web text** | Rivers of whitespace; uneven word spacing. | `text-align: justify` on body. |
| **Faux bold/italic** | Muddy, low-quality glyphs. | bold/italic rendered without the corresponding loaded font weight/style. |

---

## 5. Relationship to other axes

- **`VISUAL_HIERARCHY.md`** — type *is* the hierarchy carrier; a scale with no contrast between levels produces a flat hierarchy even with valid tokens.
- **`design-tokens`** — every size, line-height, weight, and family must be a token; ad-hoc `text-[13px]` values are a token-discipline finding.
- **Accessibility / color-contrast** — type size and contrast are shared a11y floors (WCAG 1.4.3, 1.4.4 resize, 1.4.8 measure).
- **Performance** — webfont loading strategy couples to CLS/perceived performance.

---

## 6. ✅ Agent-applicable RULES (the payoff)

PASS/FAIL rules the **design-quality** (`design-tokens`, `visual-hierarchy`) and **visual-review** (`typography`) gauntlets can mechanically apply via `getComputedStyle`.

> Finding format: `axis|category` · `severity` · `observed` vs `expected`.

### TY-1 — Body measure within 45–80 characters  *(high)*
- **Axis/Category:** `typography` / (`visual-hierarchy`)
- **Assertion:** blocks of running text render at 45–80 characters per line (target ~66).
- **Detect:** compute `containerContentWidth / avgCharWidth` for `<p>`/prose blocks (or check `max-width` ≈ 60–75ch is set). FAIL if > 80ch; WARN if < 45ch.
- **Finding:** `typography · high · "body paragraph renders ~118 chars/line (full 1200px width)" · expected "constrain to ~66ch (max-w-prose), ≤80 per WCAG 1.4.8"`

### TY-2 — Body line-height in the readable band  *(high)*
- **Axis/Category:** `typography`
- **Assertion:** body text `line-height / font-size` is 1.3–1.8 (target ~1.5).
- **Detect:** computed `lineHeight` ÷ `fontSize` on body text. FAIL if < 1.3 or > 2.0.
- **Finding:** `typography · high · "body line-height ratio 1.1 (16px/17.6px)" · expected "1.4–1.6 for body; raise leading"`

### TY-3 — Body font-size ≥16px  *(critical)*
- **Axis/Category:** `typography` / (`mobile-responsive`)
- **Assertion:** primary body text computes ≥16px at every viewport; secondary/caption ≥14px.
- **Detect:** computed `fontSize` on body text, desktop AND mobile. FAIL body < 14px; WARN body 14–15px.
- **Finding:** `typography · critical · "body renders 11px at 375px viewport" · expected "≥16px body (rem-based), ≥14px captions"`

### TY-4 — At most two typefaces  *(high)*
- **Axis/Category:** `typography` / `design-tokens`
- **Assertion:** ≤2 distinct font families render (a 3rd allowed only for monospace/code).
- **Detect:** collect distinct resolved `font-family` first-tokens across rendered text; exclude mono on `<code>/<pre>`. FAIL if ≥3 non-mono families.
- **Finding:** `typography · high · "3 font families rendered (Display, Serif, Script) in one view" · expected "≤2 families; build hierarchy with size/weight/color"`

### TY-5 — Text contrast meets WCAG 1.4.3  *(critical)*
- **Axis/Category:** `typography` / (`accessibility`/`color`)
- **Assertion:** text contrast ≥4.5:1 (normal) / ≥3:1 (large ≥24px or ≥18.66px bold) against its actual background.
- **Detect:** computed text color vs effective background; calculate contrast ratio. FAIL below threshold (esp. muted text on tinted surfaces).
- **Finding:** `typography · critical · "muted-foreground (#9aa) on tinted card = 2.9:1" · expected "≥4.5:1 normal text (WCAG 1.4.3)"`

### TY-6 — Type sizes/leading come from tokens  *(medium)*
- **Axis/Category:** `design-tokens` / `typography`
- **Assertion:** font-size, line-height, weight, family resolve to the token scale (CSS vars / theme), not ad-hoc literals.
- **Detect:** scan for arbitrary values (`text-[13px]`, inline `font-size`, raw `fontFamily`) not mapped to tokens. FAIL on ad-hoc type values.
- **Finding:** `design-tokens · medium · "inline font-size:13px; not on the type scale" · expected "use --text-sm / text-sm token"`

### TY-7 — Heading size monotonic with heading level  *(high)*
- **Axis/Category:** `typography` / `visual-hierarchy`
- **Assertion:** rendered font-size decreases (or holds) with heading level (h1 ≥ h2 ≥ h3); no skipped levels.
- **Detect:** DOM heading sequence + computed font-size. FAIL if a deeper heading renders larger, or levels skip.
- **Finding:** `typography · high · "h3 renders 28px, h2 renders 20px" · expected "size tracks level: h1≥h2≥h3"`

### TY-8 — No justified body or long all-caps runs  *(medium)*
- **Axis/Category:** `typography`
- **Assertion:** body text is not `text-align: justify`; long passages are not `text-transform: uppercase`; all-caps labels carry letter-spacing.
- **Detect:** computed `text-align` / `text-transform` on body and long text. FAIL on justified body or uppercased multi-line paragraphs.
- **Finding:** `typography · medium · "paragraph set justify with visible rivers" · expected "left-align body on web"`

### TY-9 — No faux (synthesized) bold/italic  *(low)*
- **Axis/Category:** `typography`
- **Assertion:** rendered bold/italic uses a loaded weight/style, not browser synthesis.
- **Detect:** element rendered bold/italic but the font's matching weight/style isn't loaded (`font-synthesis` active). FAIL → muddy glyphs.
- **Finding:** `typography · low · "bold heading synthesized (700 not loaded)" · expected "load the real 700 weight or use an available weight"`

---

## 7. Sources (provenance / evidence only)

- Refactoring UI — "Designing Text" (scale, weight, measure, de-emphasis) (provenance): https://refactoringui.com/
- Baymard Institute — Readability: The Optimal Line Length: https://baymard.com/blog/line-length-readability
- UXPin — Optimal Line Length for Readability: https://www.uxpin.com/studio/blog/optimal-line-length-for-readability/
- Justinmind — Best UX practices for line spacing: https://www.justinmind.com/blog/best-ux-practices-for-line-spacing/
- Supercharge Design — 20 common typography mistakes in UI design: https://supercharge.design/blog/20-common-typography-mistakes-in-ui-design
- U.S. Web Design System (USWDS) — Typography: https://designsystem.digital.gov/components/typography/
- WCAG 2.2 — SC 1.4.3 (contrast), 1.4.4 (resize text), 1.4.8 (visual presentation / line length): https://www.w3.org/TR/WCAG22/

*Sources cited for provenance only. This guide teaches the principle so the agent applies it directly in the build — it does not direct anyone to a third-party product.*
