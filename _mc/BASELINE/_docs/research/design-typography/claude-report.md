# Typography for UI — Claude Deep Research Report (3-round WebSearch + WebFetch)

**Date:** 2026-06-01 · **Engine:** Claude (research:deep pipeline)

## Executive Summary
Typography is the primary carrier of hierarchy and the largest single readability surface in a UI. The authorities converge on a set of numeric craft constants: **measure 45–75 characters per line (~66 ideal)**, **body line-height 1.4–1.6 (≈1.5 sweet spot, ~140%)**, **body size ≥16px on web**, **a modular type scale (ratio ~1.125–1.5)**, **≤2 typefaces**, and **weight/color as hierarchy levers, not just size**. The strongest checkable rules: measure capped ≈75ch, body line-height ≥1.4, body size ≥16px, never grey body text on a colored background, and never more than two font families. The contrarian nuance: these are ranges, not single optima — line-height should rise with measure and fall with size; system-font stacks trade custom branding for performance/CLS.

## Phase 1: Landscape
**Finding — The craft dimensions.** (HIGH) Scale, hierarchy, measure (line length), leading (line-height), pairing, alignment, tracking (letter-spacing), and readability. Some dimensions carry **hierarchy** (size, weight, case, color); others carry **readability** (measure, leading, size, contrast). Source: Refactoring UI "Designing Text"; supercharge.design 20-mistakes.

## Phase 2: Mechanics (the numeric constants)
**Finding — Measure 45–75 ch, ~66 ideal.** (HIGH) Emil Ruder: 50–60 chars optimal; up to 75 acceptable; WCAG 1.4.8 caps at ≤80 (≤40 CJK). CSS: `max-width: ~66ch` (≈34em). Too long → eye fatigue tracking back; too short → broken rhythm. Sources: https://www.uxpin.com/studio/blog/optimal-line-length-for-readability/, https://baymard.com/blog/line-length-readability
**Finding — Line-height 1.3–1.5, ~1.4–1.5 sweet spot.** (HIGH) "130%–150% is ideal... 140% the most quoted sweet spot," acceptable 120–200%. **Small fonts need MORE relative spacing; longer lines need MORE spacing.** Below 100% letters touch; above ~250% the eye loses the next line. Source: https://www.justinmind.com/blog/best-ux-practices-for-line-spacing/
**Finding — Body size ≥16px.** (HIGH) Minimum 16px body on web; headings 1.3×–1.6× body via a ratio scale (major-third 1.25, perfect-fifth 1.5, golden 1.618). Source: UXPin; justinmind.
**Finding — ≤2 typefaces, weight as a lever.** (HIGH) "Introduce new typefaces only when there's a need." Build hierarchy with size+weight+color rather than many fonts. Source: https://supercharge.design/blog/20-common-typography-mistakes-in-ui-design

**Measurable proxies (getComputedStyle):** font-size, line-height (compute ratio = line-height/font-size), max-width in ch, distinct font-family count, font-weight steps, letter-spacing.

## Phase 3: Failure Modes
**Finding — Long measure.** (HIGH) Body paragraphs >75–80ch. Detect: container width / avg char width > 80.
**Finding — Tight/loose leading.** (HIGH) line-height/font-size < 1.3 (cramped) or > 2.0 (drifting). Detect: computed ratio.
**Finding — Too many typefaces.** (HIGH) ≥3 distinct families. Detect: count distinct font-family stacks (excluding mono for code).
**Finding — Grey-on-color / low contrast text.** (HIGH) Muted body text over a tinted/colored surface drops below contrast floor. Couples to a11y. Detect: computed contrast ratio < 4.5:1 normal / 3:1 large.
**Finding — Tiny mobile body.** (HIGH) Body <16px (or <14px hard floor). Detect: computed font-size at mobile viewport.
**Finding — All-caps long runs / faux-bold.** (MEDIUM-HIGH) Long uppercase passages read slower; synthesized bold (no real weight) renders muddy. Detect: text-transform:uppercase on long text; font-synthesis.

## Phase 4: Contrarian
**Finding — The constants are ranges, not single optima.** (MEDIUM-HIGH) "66ch" is a midpoint of 45–75, not a law; novices read better near 45, experts tolerate 80. Line-height must covary with measure and size — a fixed 1.5 everywhere is itself a mistake. Source: UXPin; justinmind.
**Finding — Custom fonts vs system stacks.** (MEDIUM) Webfonts cost load time and risk FOUT/CLS (layout shift on swap); system-font stacks are instant but cede brand distinctiveness. The performance/branding tradeoff is real and couples to Core Web Vitals.

## Source Registry (verified live 2026-06-01)
| URL | Title | Cred | Type |
|---|---|---|---|
| baymard.com/blog/line-length-readability | Optimal line length | 5 | primary-research |
| uxpin.com/studio/blog/optimal-line-length-for-readability/ | Line length guide | 4 | secondary |
| justinmind.com/blog/best-ux-practices-for-line-spacing/ | Line spacing rules | 4 | secondary |
| supercharge.design/blog/20-common-typography-mistakes-in-ui-design | 20 typography mistakes | 4 | secondary |
| designsystem.digital.gov/components/typography/ | USWDS Typography | 5 | primary |

## Confidence Matrix
- Measure 45–75ch / ~66: HIGH. Line-height 1.4–1.5: HIGH. Body ≥16px: HIGH. ≤2 typefaces: HIGH. Ranges-not-optima contrarian: MEDIUM-HIGH. Webfont CLS tradeoff: MEDIUM.
