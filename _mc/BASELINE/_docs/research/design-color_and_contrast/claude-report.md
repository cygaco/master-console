# COLOR_AND_CONTRAST — Claude 3-round research notes

**Engine:** Claude WebSearch + WebFetch (3 rounds). Date: 2026-06-01.

## Phase 1: Landscape
- A color SYSTEM is shade ramps (a base hue at multiple lightness steps), a neutral/gray family, and named semantic roles (primary, success, warning, error/destructive, info), NOT ad-hoc hex. (Refactoring UI "Working with Color"; Material 3 color roles.) HIGH.
- HSL is convenient but NOT perceptually uniform: equal numeric "lightness" steps don't look equal across hues (yellow looks far lighter than blue at the same L). OKLCH (Oklab polar: L 0–1, C 0–~0.37, h 0–360) gives perceptually even steps; changing L doesn't shift perceived hue/saturation. This matters for generating accessible ramps. HIGH. (evilmartians OKLCH; solo_cube HSL→OKLCH.)

## Phase 2: Mechanics (exact numbers — verified against WebAIM primary)
- **Contrast ratio** = (L1 + 0.05) / (L2 + 0.05), where L = relative luminance; range 1:1 → 21:1. (WebAIM describes ratio range; formula is the WCAG relative-luminance definition.) HIGH.
- **SC 1.4.3 Contrast (Minimum), Level AA:** normal text ≥ **4.5:1**; large text ≥ **3:1**. HIGH.
- **Large text definition:** ≥18pt (=24px), OR ≥14pt bold (≈18.66px). HIGH.
- **SC 1.4.6 Enhanced, Level AAA:** normal **7:1**, large **4.5:1**. HIGH.
- **SC 1.4.11 Non-text Contrast, Level AA:** UI component states/boundaries + meaningful graphics ≥ **3:1** against adjacent colors. Measure in MORE than one place (component vs adjacent). HIGH.
- Encode as tokens: components reference roles via CSS custom properties (--color-primary, --color-destructive, --color-on-primary), not raw hex. Verify on computed style (getComputedStyle backgroundColor/color → compute ratio). HIGH.

## Phase 3: Failure Modes (each with detection)
- Low-contrast text < 4.5:1 (3:1 large) → illegible to low-vision/aging users. Detect: compute fg/bg ratio. (WCAG 1.4.3.)
- **Color-alone state** (red error / green success with no icon or text) → violates **SC 1.4.1 Use of Color (Level A)**; invisible to color-blind users. W3C failure **F81** = required/error fields by color only. Detect: error/success element whose only differentiator is hue (no icon, no text label, no shape). HIGH.
- Links distinguished by color only without 3:1 + non-color cue → W3C failure **F73**. Detect: inline link same weight/decoration as body, color-only.
- Brand color drift (primary button rendering grey) → computed bg != token value. Detect: compare computed bg to --color-primary.
- Gray placeholder used as label → low contrast + lost label. Detect: input with no <label>, placeholder as sole label.
- Dark-mode contrast inversion → fg/bg flip drops below floor. Detect: compute ratio in dark theme too.
- Focus ring with < 3:1 vs background → invisible focus (also a11y). Detect: compute focus-ring vs adjacent.

## Phase 4: Contrarian
- WCAG 2.x contrast math (luminance ratio) is perceptually imperfect — notably light-on-dark and thin fonts; **APCA** (Advanced Perceptual Contrast Algorithm, WCAG 3 candidate) accounts for font size/weight + polarity and predicts real-world readability better. HIGH. So: teach 4.5:1/3:1 as the enforceable floor TODAY, but frame "never color alone" + "verify perceptually" as the durable principle; don't hard-fail solely on a borderline 2.x number when APCA passes — flag for human, don't pretend the ratio is the whole truth.
- Brand-vs-a11y tension: strict 4.5:1 sometimes fights brand palette; resolve by adjusting the *token shade* (pick a darker/lighter step of the same hue), not by abandoning the floor.

## Sources
- WebAIM Contrast — https://webaim.org/articles/contrast/ (primary-ish, 5)
- W3C Understanding 1.4.3 — https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum (primary, 5)
- W3C Understanding 1.4.11 — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html (primary, 5)
- W3C Understanding 1.4.1 Use of Color — https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html (primary, 5)
- W3C F81 (color-only error fields) — https://www.w3.org/WAI/WCAG22/Techniques/failures/F81.html (primary, 5)
- W3C F73 (color-only links) — https://www.w3.org/TR/WCAG20-TECHS/F73.html (primary, 5)
- evilmartians OKLCH — https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl (secondary, 4)
- HSL→OKLCH (solo_cube) — https://medium.com/@solo_cube/from-hsl-to-oklch-and-betterlch... (opinion, 3)
