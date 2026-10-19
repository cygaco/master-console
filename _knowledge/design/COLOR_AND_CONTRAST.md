---
guide: COLOR_AND_CONTRAST
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [design-tokens, accessibility, color, a11y]
sources:
  - "https://webaim.org/articles/contrast/"
  - "https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum"
  - "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html"
  - "https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html"
  - "https://www.w3.org/WAI/WCAG22/Techniques/failures/F81.html"
  - "https://www.w3.org/TR/WCAG20-TECHS/F73.html"
  - "https://www.w3.org/TR/WCAG22/"
  - "https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl"
  - "https://www.nngroup.com/articles/ten-usability-heuristics/"
---

# Color & Contrast

**Color and contrast is the discipline of using color as a *system of roles* — not a palette of decorations — so that every color earns meaning, every text/background pair clears a measurable legibility floor, and no piece of information is ever carried by hue alone.**

It is the bridge topic between visual craft and accessibility: the same decision that makes a primary button feel "brand-right" also decides whether a low-vision or color-blind user can read it. Get color right and the interface is legible, scannable, and trustworthy; get it wrong and it is illegible, ambiguous, or invisible to a meaningful slice of users.

---

## 1. Why it matters

Color does three jobs at once, and they are easy to confuse:

1. **Identity** — brand recognition (the "this is us" color).
2. **Hierarchy** — pulling the eye to the primary action and pushing chrome back (a saturated CTA against muted surroundings).
3. **Meaning** — communicating state: success, warning, error, info, disabled, selected.

When any of these is done by *raw hex picked per-component* instead of by a *named role drawn from a system*, the UI drifts: two "primary" buttons render two different oranges, an error message is a slightly different red than the error toast, and a low-contrast caption is illegible on one screen and fine on another. The system is what keeps color honest across surfaces.

**Which agents and checks this governs:**

- **design-lead** — owns the per-screen call that color carries meaning legibly for the *real cohort, including their limitations* (`build-for-audience-incl-limitations`): older eyes, low-vision, color-blind, bright-sunlight contexts all need a higher contrast floor and never-color-alone. Pairs with `clear-iconography` (state communicated with a consistent, legible vocabulary, not "red = bad" alone).
- **conversion-lead** — color is a primary lever of `conversion-hierarchy`: the single dominant CTA must be the most saturated/contrasting thing on the page, and competing high-saturation elements are conversion leaks.
- **design-quality gauntlet** — this guide feeds two of its six axes directly: **`design-tokens`** (colors resolve to the token set, not ad-hoc values) and **`accessibility`** (sufficient contrast; not color-alone for state).
- **visual-review** — feeds two of its seven categories: **`color`** (brand color drift, wrong/illegible color) and **`a11y`** (contrast failures, color-only signaling).

---

## 2. Core principles & techniques

### 2.1 Color as a system: ramps, neutrals, and semantic roles

A color *system* has three layers; an ad-hoc palette has none.

- **Shade ramps.** Each base hue exists at a *range* of lightness steps (e.g. 50 → 900), not a single value. You need the light steps for tinted backgrounds and the dark steps for text-on-light and borders. A single "blue" is not enough; you will reach for ~8–10 steps of it.
- **A neutral / gray family.** Most of a real UI is neutral — text, borders, dividers, surfaces, disabled states. A dedicated gray ramp (often subtly tinted toward the brand hue or toward warm/cool) does the heavy lifting. Reaching for pure `#000`/`#fff` and mid-grays ad hoc is the tell of a non-system.
- **Semantic roles.** Color is consumed by *role*, not by name. The component asks for `--color-primary`, `--color-on-primary` (the text/icon color that sits *on* primary), `--color-destructive`, `--color-success`, `--color-warning`, `--color-muted`, `--color-border`, `--color-surface`. The role maps to a step of a ramp. Re-theming, dark mode, and brand changes then happen at the role↔ramp mapping, not in 400 components.

**Why (perception/cognition):** consistent semantic color lets users *learn* the interface once — red always means destructive, the same blue always means "primary action." That is the aesthetic-and-minimalist + consistency basis of Nielsen's heuristics: a learned visual vocabulary lowers cognitive load on every subsequent screen.

### 2.2 Perceptual color space: why "lightness" lies in HSL

HSL/HSV are convenient (hue, saturation, lightness as separate dials) but **not perceptually uniform**: equal numeric steps in "lightness" do *not* look equally bright across hues. A yellow at L=50% looks far lighter than a blue at L=50%. So a ramp built by holding S constant and stepping L in HSL produces *uneven* perceived contrast — some steps legible, some not.

**OKLCH** (Oklab in polar form: Lightness `L` 0–1, Chroma `C` 0–~0.37, Hue `h` 0–360) is perceptually uniform: equal `L` steps look equally bright, and adjusting `L` doesn't drag the perceived hue/saturation with it. For *generating accessible ramps* this matters — a ramp stepped evenly in OKLCH lightness gives predictable, even contrast across hues, which is exactly what you need to guarantee a contrast floor.

**Teachable takeaway:** reason about lightness perceptually. When you need "the same darkness of two different hues," trust an OKLCH-style perceptual step, not the HSL number — the HSL number will betray you on yellows and cyans.

### 2.3 The contrast floor (the measurable part)

Contrast is computed, not eyeballed. The contrast ratio between two colors is:

```
contrast = (L1 + 0.05) / (L2 + 0.05)
```

where `L1` is the relative luminance of the lighter color and `L2` of the darker, and relative luminance is the WCAG-defined linearized, weighted sum of sRGB channels. The ratio ranges from **1:1** (identical) to **21:1** (pure black on pure white).

**WCAG 2.2 thresholds (memorize these — they are the gate):**

| What | Level | Minimum ratio |
|---|---|---|
| Normal text (SC 1.4.3) | AA | **4.5:1** |
| Large text (SC 1.4.3) | AA | **3:1** |
| Normal text (SC 1.4.6) | AAA | **7:1** |
| Large text (SC 1.4.6) | AAA | **4.5:1** |
| Non-text / UI component state & boundary, meaningful graphics (SC 1.4.11) | AA | **3:1** |

**"Large text"** = **≥18pt (24px)**, or **≥14pt bold (≈18.66px)**. The 4.5:1 floor exists to account for moderately-low visual acuity, color-vision deficiency, and the contrast-sensitivity loss of aging — i.e. it is a *real-cohort* floor, not pedantry.

**Non-text contrast (1.4.11)** is the one most often missed: the *boundary or fill that identifies a control or its state* (an input's border, a toggle's track, a focus ring, an icon that conveys meaning, a chart segment) must hit **3:1 against its adjacent colors** — and "adjacent" can be more than one color, so you may need to measure in several places.

### 2.4 Never color alone (SC 1.4.1, Level A)

**Color must never be the *only* visual means of conveying information, indicating an action, prompting a response, or distinguishing an element.** This is a Level-A normative requirement, not a nicety.

Concretely, *state* must always have a non-color signifier in addition to color:

- **Error:** red border + an error icon + a text message. Not red alone.
- **Success:** green + a check icon / confirmation text.
- **Required field:** an asterisk or "(required)" label, not just a red label.
- **Selected / active:** a checkmark, underline, weight change, or container — not only a color swap.
- **Inline links in body text:** distinguishable from surrounding text by *more than color* (underline, or 3:1 contrast vs the body text **plus** a non-color cue on hover/focus). Color-only links are W3C failure **F73**.
- **Color-only required/error fields** are W3C failure **F81**.

**Why:** ~1 in 12 men and ~1 in 200 women have a color-vision deficiency; in grayscale (or on a failing display, or in bright sun) a red/green-only distinction vanishes. The non-color cue is what survives.

### 2.5 Brand color, used with discipline

Brand fidelity and accessibility are not enemies — they conflict only when you treat the brand color as a single fixed hex. The resolution: the brand hue lives as a *ramp*, and you pick the *step* that clears the contrast floor for each context. A brand orange that fails 4.5:1 as text-on-white becomes a darker step of the same hue for text, while the bright step stays for large fills/CTAs (which only need 3:1). You keep the brand and clear the floor — by moving along the ramp, never by abandoning the floor.

In dark mode, don't reuse the same saturated hues at the same lightness — heavily saturated colors vibrate on dark surfaces; desaturate and shift lightness so the *perceived* contrast and brand feel are preserved.

---

## 3. Concrete examples (build terms — Next/Tailwind/Radix/shadcn substrate)

**Do — color as tokens / roles:**
```tsx
// globals.css defines the role tokens (mapped to ramp steps)
// :root { --primary: oklch(0.62 0.19 35); --primary-foreground: oklch(0.98 0 0); --destructive: ...; }
<Button className="bg-primary text-primary-foreground">Start free trial</Button>
// destructive action uses the role, plus the component variant
<Button variant="destructive">Delete account</Button>
```
The button reaches for `--primary` / `--primary-foreground`; theming and dark mode change the token, not the component.

**Don't — raw hex / raw Tailwind palette per component:**
```tsx
<button className="bg-[#ff6b35] text-white">Start free trial</button>   // hex literal — forks the system
<button className="bg-orange-500 text-white">Delete</button>            // raw palette + wrong meaning (delete isn't "primary")
```
These render fine once and drift forever; the static lane (`design-system.js --strict`) fail-closed-rejects the hex literal and raw palette colors for exactly this reason.

**Do — state with color + icon + text:**
```tsx
<p role="alert" className="flex items-center gap-2 text-destructive">
  <AlertCircleIcon aria-hidden /> Email is already in use.
</p>
```

**Don't — state by color alone:**
```tsx
<p className="text-red-600">Email is already in use.</p>   // red-only: invisible in grayscale → F81 territory
<input className="border-red-500" />                        // red border with no icon/text/aria
```

**Do — contrast-aware text choice:** body text uses a dark neutral step (`text-foreground`, ~`oklch(0.2 …)`) on a light surface → comfortably > 4.5:1. Captions/placeholders use a *muted* step that **still** clears 4.5:1, not the lightest gray.

**Don't — gray-on-gray:** `text-gray-400` on `bg-gray-100` is a classic sub-4.5:1 caption; it reads as "designed" but is illegible to the floor cohort.

---

## 4. Common failure modes

| Failure | How it reads to the user | How to detect |
|---|---|---|
| Low-contrast text (< 4.5:1 normal, < 3:1 large) | Strained or impossible to read; worse for aging/low-vision | Compute fg vs bg ratio on the rendered element |
| **Color-only state** (red error / green success, no icon/text) | Ambiguous; invisible to color-blind / in grayscale | State differentiator is hue only — no icon, text, shape, or weight change (F81) |
| **Color-only links** in body | Links unfindable without color vision | Inline link same weight/decoration as body, distinguished by color only (F73) |
| Brand color drift (primary renders grey/wrong) | "Looks broken / off-brand"; CTA loses prominence | Computed bg ≠ the `--primary` token value |
| Sub-3:1 non-text (input border, toggle, focus ring, icon) | Can't tell where a control is or its state | Compute control boundary/fill vs adjacent (1.4.11) |
| Placeholder used as the label | Label vanishes on focus; low-contrast gray | Input with no `<label>`; placeholder is the only label |
| Dark-mode inversion drops below floor | Legible in light, illegible in dark (or vibrating saturated text) | Re-compute ratios in the dark theme too |
| Over-saturation everywhere | Nothing stands out; "everything shouts" | Multiple high-chroma colors competing; no single dominant accent |

---

## 5. ✅ Agent-applicable RULES (the payoff)

PASS/FAIL rules the **design-quality** / **visual-review** gauntlet can mechanically apply. Each maps to an axis/category and states an observed-vs-expected detection. Severity follows the gauntlet convention: `critical` = breaks the page / makes the primary task unusable; `high` = a gate failure; `medium`/`low` = degraded/cosmetic. **Any `critical` or `high` finding = FAIL.**

| # | Rule (assertion) | Axis / Category | Detection (observed vs expected) | Severity if violated |
|---|---|---|---|---|
| C1 | **No raw color literals.** Colors resolve to token roles (`var(--…)` / theme roles), not hex or raw palette values in component markup. | design-tokens / color | Computed/source color is a hex literal or raw palette class (`bg-[#…]`, `text-red-600`) instead of a `--token`. Observed: `#ff6b35`; Expected: `var(--primary)`. | high |
| C2 | **Normal text ≥ 4.5:1.** Body/normal text clears 4.5:1 against its background. | accessibility / a11y | Compute relative-luminance ratio of computed `color` vs `background-color`. Observed: 3.1:1; Expected: ≥ 4.5:1. | high (critical if primary content/CTA illegible) |
| C3 | **Large text ≥ 3:1.** Text ≥24px (or ≥18.66px bold) clears 3:1. | accessibility / a11y | Ratio < 3:1 on large text. Observed 2.4:1; Expected ≥ 3:1. | high |
| C4 | **Non-text/UI contrast ≥ 3:1.** Control boundaries/fills that identify a component or its state, the focus ring, and meaningful icons/graphics clear 3:1 vs adjacent. | accessibility / a11y | Compute control border/fill vs adjacent color(s) (1.4.11). Observed input border 1.8:1 vs surface; Expected ≥ 3:1. | high |
| C5 | **Never color alone for state.** Every state (error/success/warning/required/selected/link) carries a non-color signifier (icon, text, shape, weight, underline) in addition to color. | accessibility / color | State element differentiated by hue only — no icon/text/decoration (F81/F73). Observed: red text, no icon/message; Expected: color + icon + text. | high (critical for error/required state) |
| C6 | **State colors come from semantic roles.** error→`--destructive`, success→`--success`, warning→`--warning`, used consistently across surfaces. | design-tokens / color | Two error surfaces render different reds, or a destructive action uses `--primary`. Observed: toast `#e02` vs inline `#d00`; Expected: both `--destructive`. | medium–high |
| C7 | **Brand/primary renders the brand color.** The primary CTA's computed background equals the `--primary` token (no drift to grey/default). | color | Computed bg of `[data-testid=cta-primary]` ≠ resolved `--primary`. Observed `rgb(120,120,120)`; Expected resolved `--primary`. | high |
| C8 | **Contrast holds in dark mode.** All text/non-text contrast rules (C2–C4) also pass in the dark theme; saturated text is desaturated/lightness-shifted, not reused raw. | accessibility / a11y | Re-compute ratios in dark theme; any drop below floor. Observed dark caption 2.9:1; Expected ≥ 4.5:1. | high |
| C9 | **Single dominant accent.** One high-saturation accent dominates per view; chrome/secondary elements recede (supports `conversion-hierarchy` / `visual-hierarchy`). | color / visual-hierarchy | Multiple competing high-chroma elements at CTA-level saturation. Observed: 3 equally-saturated buttons; Expected: 1 dominant. | medium |
| C10 | **Placeholders are not labels.** Inputs have a persistent visible label; placeholder text (typically muted/low-contrast) is not the sole label, and where shown clears its own contrast floor. | accessibility / a11y | Input with no associated `<label>`, placeholder as label. Observed: placeholder-only field, `#9ca3af` on white (~2.5:1); Expected: visible label + ≥4.5:1. | high |

> **Hedging note for the gauntlet (contrarian-grounded):** WCAG 2.x luminance-ratio math is the *enforceable* floor today, but it is perceptually imperfect (notably light-on-dark and thin fonts), and WCAG 3's **APCA** models contrast more accurately. For values *near* the threshold (within ~0.3:1) on light-on-dark or thin type, prefer a `medium` "verify perceptually / human-review" finding over a hard `critical` — the principle ("legible to the floor cohort") is the truth; the 2.x number is the current proxy.

---

## 6. Sources (provenance / evidence only)

- WebAIM — Contrast and Color Accessibility (formula, thresholds, large-text definition). https://webaim.org/articles/contrast/
- W3C WAI — Understanding SC 1.4.3 Contrast (Minimum). https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
- W3C WAI — Understanding SC 1.4.11 Non-text Contrast. https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- W3C WAI — Understanding SC 1.4.1 Use of Color. https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html
- W3C WAI — Failure F81 (color-only required/error fields). https://www.w3.org/WAI/WCAG22/Techniques/failures/F81.html
- W3C — Failure F73 (color-only links). https://www.w3.org/TR/WCAG20-TECHS/F73.html
- W3C — WCAG 2.2 Recommendation. https://www.w3.org/TR/WCAG22/
- Evil Martians — OKLCH in CSS: why we quit RGB/HSL (perceptual uniformity for ramps). https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl
- Nielsen Norman Group — 10 Usability Heuristics (consistency, aesthetic-minimalist). https://www.nngroup.com/articles/ten-usability-heuristics/
