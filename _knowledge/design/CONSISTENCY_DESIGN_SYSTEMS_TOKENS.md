---
guide: CONSISTENCY_DESIGN_SYSTEMS_TOKENS
anchor: none
shape: walkthrough
timing: reference
lead_time: "none"
tier: core
trains: [design-lead, conversion-lead, design-quality, visual-review]
maps_to: [design-tokens, component-usage, design-handoff, color, typography, regression]
sources: ["https://www.w3.org/community/design-tokens/", "https://www.designtokens.org/tr/drafts/format/", "https://www.nngroup.com/articles/consistency-and-standards/", "https://www.nngroup.com/articles/ten-usability-heuristics/", "https://lawsofux.com/teslers-law/", "https://lawsofux.com/von-restorff-effect/", "https://refactoringui.com/", "https://overlayqa.com/blog/design-system-drift/"]
---

# Consistency, Design Systems & Tokens

**Consistency through a design system means every color, space, type size, radius, and elevation in the UI resolves to a *named token* (not an ad-hoc value), every interactive element is a *library primitive* (not a raw HTML element), the product speaks one visual language everywhere, and what ships in the build faithfully realizes the design spec.** This is the "use the system, don't fork it" discipline.

This guide is the primary owner of three of the six design-quality axes: **design-tokens**, **component-usage**, and **design-handoff**. Get these right and most other axes (color, typography, regression) inherit consistency for free.

---

## 1. What this governs

A design system is the single source of truth for *how the product looks and behaves*. It has three layers, and consistency is the property that all three stay in sync from design intent → token → component → rendered pixel:

1. **Tokens** — the atomic, named design decisions (a color, a spacing step, a type size). The truth layer.
2. **Components** — reusable primitives (Button, Card, Input) built *from* tokens, encoding every intended variant/state once.
3. **Handoff** — the guarantee that the build realizes the spec: the component the design called for exists as a real primitive, uses the real tokens, and matches the stated intent.

When any layer is bypassed — a hardcoded hex instead of a token, a raw `<button>` instead of the primitive, a built screen that quietly diverges from the brief — the system **drifts**, and consistency is lost one shortcut at a time.

---

## 2. Why it matters

**For the user and the product.** Consistency is not an aesthetic nicety; it is a cognitive cost reducer.

- **Jakob's Law** — users spend most of their time on *other* products, so they arrive with expectations. Adhering to internal and external consistency raises learnability and lowers confusion. Two flavors matter: **internal consistency** (the same pattern means the same thing everywhere *inside* your product) and **external consistency** (you follow conventions users already know). [NN/g #4; Laws of UX]
- **NN/g Heuristic #4 (Consistency & Standards)** — "the same words, situations, or actions [define] the same element or concept throughout a product." Inconsistency "increase[s] the users' cognitive load by forcing them to learn something new" — every unique-snowflake button is a tiny re-learning tax. [nngroup.com/articles/consistency-and-standards]
- **Theming and dark mode become possible.** When components reference *semantic* tokens, switching light↔dark or rebranding is a token-set swap, not a find-and-replace across hundreds of files. Hardcoded values make every theme a manual rewrite.

**For the designer agents.**
- **`design-lead`** owns the *consistency* lens — it must build app UI from the existing primitives and tokens, never inventing a one-off.
- **`conversion-lead`** must keep landing pages in the same visual language as the product so the ad→lander→app journey feels like one brand.
- **`design-quality`** approves/rejects on the **design-tokens**, **component-usage**, and **design-handoff** axes — this guide is its rulebook for those three.
- **`visual-review`** catches the *rendered* symptoms: color drift (`color`), wrong type (`typography`), and step-to-step inconsistency or regression (`regression`).

---

## 3. Core principles

### 3.1 Tokens are the single source of truth (the three-tier model)

A **design token** is "an indivisible piece of a design system such as colors, spacing, typography scale." The W3C Design Tokens Community Group (DTCG) standardizes them as JSON with a `$type` and `$value`, where a value can *alias* another token. Organize tokens in three tiers — this is the load-bearing idea:

| Tier | Also called | Holds | Example |
|---|---|---|---|
| **Reference / primitive** | raw, global | literal values | `--blue-500: oklch(0.6 0.2 250)` |
| **Semantic / system** | alias, intent | a *role*, pointing at a primitive | `--primary: var(--blue-500)` |
| **Component** | scoped | a component-specific role | `--button-bg: var(--primary)` |

**Why three tiers and not one:** the semantic tier *decouples intent from appearance*. A component references `--primary` and "doesn't know or care" whether that resolves to blue-500 (light) or blue-400 (dark). That indirection is what makes dark mode a token swap (`.dark { --primary: ... }`) instead of a rewrite.

**The substrate you build on.** In a Next.js + Tailwind v4 + shadcn/ui project, the token layer is **CSS custom properties** in `globals.css` (`--primary`, `--background`, `--destructive`, `--radius`, …, typically in `oklch`), exposed to utilities via `@theme inline` so `bg-primary`, `text-foreground`, `border-border` resolve to `var(--…)`. The `.dark` class re-binds the same variables. **A component must never contain a hex literal** — the whole point of the bridge is that color comes from `var(--…)` / the tokenized utility.

**Build a *scale*, not arbitrary values** (Refactoring UI):
- **Color:** 8–10 shades per hue across three families — greys (text, backgrounds, panels, controls), a primary, an accent.
- **Spacing:** a constrained scale (commonly a 4px grid). "Never use arbitrary spacing values — always pick from your scale." Ad-hoc `margin: 13px` is drift.
- **Type:** a constrained, hand-picked type scale in `rem`/`px` (not `em`); H1≠H2≠body comes from the scale, not one-off sizes.
- **Radius & elevation:** also tokens (`--radius`, an elevation/shadow set), not per-component magic numbers.

### 3.2 Semantic naming over raw naming

Name tokens by **role**, not by **value**. `--color-destructive` survives a brand change; `--color-red` becomes a lie the moment destructive turns orange. The semantic name is the contract; the primitive behind it is an implementation detail. This is why raw Tailwind theme utilities (`bg-blue-500`, `text-red-600`) are a violation in product UI — they hardcode the *value*, skip the *role*, and **do not swap in dark mode**.

### 3.3 Components are the unit of reuse (primitives over raw elements)

Encode each interactive element **once** as a variant-driven primitive, then reuse it. The scaffold's `Button` (built with `class-variance-authority`) defines `variant` (default / secondary / outline / ghost / destructive / link) and `size` (default / sm / lg / icon), plus the focus ring, disabled state, and transitions — *all in one place*. Every consumer gets the same behavior, accessibility, and tokens for free.

A raw `<button className="...">` re-implements a subset of that, drifts from it, and usually drops the focus-visible ring and the token-bound colors. The rule: **interactive elements (`button`, `input`, `select`, `textarea`) are the local `ui/` primitive**, unless the file *is* an accessibility-controlled primitive wrapper (i.e. lives under `src/components/ui/`).

Use the **intended variant** for the intended meaning: a destructive action is `variant="destructive"`, not the default button colored red by hand. The variant *is* the consistency.

### 3.4 One visual language across app and web

The product UI and the marketing/landing pages must share the same tokens and primitives. A landing page that uses `bg-blue-500` while the app uses `bg-primary` breaks the brand the moment a user crosses from ad → lander → app. `conversion-lead` output is held to the same token/component rules as `design-lead` output — the design-quality gauntlet is *builder-agnostic*.

### 3.5 Handoff fidelity (the build realizes the spec)

A faithful handoff means three things are true at render time:
1. **Tokens resolve.** Computed colors/spacing/type/radius trace back to `var(--…)` / the token set, not ad-hoc values.
2. **Spec'd components exist.** If the design brief / build spec calls for a component, a real `ui/` primitive realizes it. A spec'd component with **no source primitive** is a contract defect to flag, not to wave through.
3. **Intent matches.** What renders matches the brief's stated hierarchy/variant/copy. Silent divergence (the build "looks close" but uses a different variant or color) is handoff drift.

### 3.6 Typed contracts (props are part of the system)

A component's prop signature is part of the design contract. `any`-typed props (`Props extends ... any`, `React.FC<any>`) erode the contract — consumers can pass anything, variants stop being enforced, and drift creeps in through the type hole. Component props must be typed (e.g. via `VariantProps<typeof buttonVariants>`).

### 3.7 The system needs a documented source of truth

For a mature product, the design system is documented under `_requirements/01-design-system/` (`COMPONENT_LIBRARY.md`, `COLOR_SEMANTICS.md`, `UX_PRINCIPLES.md`, `FEEDBACK_PATTERNS.md`); for a greenfield scaffold it's the repo-root `DESIGN_SYSTEM.md` + `globals.css` + `src/components/ui/`. **No docs = nothing to be consistent *with*.** Missing required design docs is itself a failure: the system has no declared truth.

---

## 4. Concrete examples (do / don't, in build terms)

**Color — token vs hardcoded**
```tsx
// ❌ DON'T — hex literal; bypasses tokens, won't swap in dark mode, brand drift
<div className="border" style={{ background: "#1d4ed8", color: "#ffffff" }}>…</div>
// ❌ DON'T — raw Tailwind theme color; skips the semantic role, no dark-mode swap
<span className="text-blue-600 bg-red-500">…</span>

// ✅ DO — semantic tokenized utilities; swap automatically in .dark
<div className="bg-primary text-primary-foreground border-border">…</div>
<span className="text-destructive">…</span>
```

**Component — primitive vs raw element**
```tsx
// ❌ DON'T — raw element re-implements the button, drops focus ring + token colors + variants
<button className="px-4 py-2 rounded bg-primary text-white">Delete</button>

// ✅ DO — the library primitive with the intended variant
import { Button } from "@/components/ui/button";
<Button variant="destructive">Delete</Button>
```

**Spacing — scale vs arbitrary**
```tsx
// ❌ DON'T — arbitrary one-off values; not on the scale
<section className="mt-[13px] gap-[7px] p-[19px]">…</section>

// ✅ DO — values from the spacing scale
<section className="mt-4 gap-2 p-5">…</section>
```

**Props — typed vs any**
```tsx
// ❌ DON'T — untyped contract
const Card: React.FC<any> = (props) => <div {...props} />;

// ✅ DO — typed; variants enforced
interface CardProps extends React.HTMLAttributes<HTMLDivElement> { elevated?: boolean }
const Card = ({ elevated, className, ...props }: CardProps) => /* … */;
```

**Purposeful deviation done right (governed, not drift)**
```tsx
// ✅ The ONE primary CTA may break the visual rhythm on purpose (Von Restorff) —
//    but it does so via a token/variant, not a hardcoded one-off.
<Button size="lg" variant="default">Start free</Button>
// If a genuine exception to a rule is needed, it is DOCUMENTED in the allow-list
//    (file + rule + reason), never an undocumented hardcoded value.
```

---

## 5. Common failure modes

| Failure | How it reads to the user | How to detect |
|---|---|---|
| **Hardcoded hex/rgb** in `className`/`style` | brand color drift; broken/odd dark mode | hex/rgb literal in a color/bg/border context |
| **Raw Tailwind theme color** (`bg-blue-500`) | doesn't match brand; doesn't swap in dark mode | `(text\|bg\|border\|ring)-(blue\|red\|green\|…)-\d{2,3}` |
| **Raw `<button>/<input>/<select>/<textarea>`** | missing focus ring, inconsistent styling, a11y gaps | raw interactive tag outside `src/components/ui/` |
| **Arbitrary spacing/size** (`mt-[13px]`) | uneven rhythm; "off" layout | arbitrary `[…px]` values off the scale |
| **`any` props** | variants unenforced; silent contract erosion | `any` in a `Props`/`ComponentProps`/`React.FC` signature |
| **Token drift** (code value ≠ source of truth) | components slowly diverge; AI-generated variant drift | computed style not traceable to `var(--…)` |
| **Inconsistent terminology** | same concept named differently across screens | label/term mismatch for one concept |
| **Handoff drift** (build ≠ spec) | "looks close" but wrong variant/color/copy | rendered intent ≠ brief; spec'd component with no `ui/` source |
| **Missing design-system docs** | no declared source of truth | required docs absent under design-system root |

The deep cause is almost always the same: **someone went around the system instead of through it.** Drift "is especially common with AI-generated code" — which is exactly why these rules must be mechanically enforced on agent output.

---

## 6. ✅ Agent-applicable RULES (the payoff)

Each rule is a PASS/FAIL the **design-quality** (`design-tokens` / `component-usage` / `design-handoff`) and **visual-review** (`color` / `typography` / `regression`) gauntlets can mechanically apply. Format mirrors a gauntlet finding: `severity` · observed-vs-expected · how to detect. Static rules also name the `scripts/checks/design-system.js` rule id they correspond to.

### Axis: `design-tokens`
- **DT-1 — No hex/rgb color literals in component styling.** *(static rule `no-hex-literal`)* — FAIL (severity: **high**) if a `.tsx/.jsx` line in `src/components`/`src/app` contains `#[0-9a-fA-F]{3,8}` (or `rgb(`/`rgba(`) in a `className|style|color|background|border` context. *Observed:* `style={{background:"#1d4ed8"}}`. *Expected:* `bg-primary` / `var(--…)`. *Detect:* regex scan + computed-style trace to a `var(--…)`.
- **DT-2 — No raw Tailwind theme color utilities for theme colors.** *(static rule `no-tailwind-theme-color`)* — FAIL (**high**) on `(text|bg|border|ring)-(blue|red|green|amber|yellow|purple|pink|indigo|emerald|teal|cyan|sky|rose|violet|fuchsia)-\d{2,3}`. *Observed:* `bg-blue-500`. *Expected:* a semantic token utility (`bg-primary`, `text-destructive`). *Why:* raw colors skip the role and do not swap in dark mode.
- **DT-3 — Colors/spacing/type/radius resolve to tokens.** — FAIL (**high**) if a rendered element's computed color/spacing/radius cannot be traced to the token set (`var(--…)` / the documented scale). *Detect (judgment lane):* `getComputedStyle` on suspect elements; an off-scale value (e.g. `margin: 13px`, a color absent from the palette) is drift.
- **DT-4 — Spacing/size come from the scale.** — FAIL (**medium**) on arbitrary Tailwind values off the scale (`mt-[13px]`, `gap-[7px]`, `w-[341px]`) where a scale step exists. *Expected:* `mt-4`, `gap-2`. (Severity **low** if isolated and cosmetic.)
- **DT-5 — Dark mode swaps cleanly.** — FAIL (**high**) if toggling `.dark` leaves an element visibly unthemed (a hardcoded value didn't swap), e.g. white text on a still-white background. *Detect:* render light + dark, compare computed colors; an unchanged hardcoded color under `.dark` is the signature.

### Axis: `component-usage`
- **CU-1 — Interactive elements are library primitives.** *(static rule `use-ui-primitive`)* — FAIL (**high**) if a raw `<button|input|select|textarea>` appears in a feature file *outside* `src/components/ui/`. *Observed:* `<button className="…">`. *Expected:* `<Button …>` / the local primitive. *Detect:* regex `^.*<(button|input|select|textarea)\b` with the `inUiPrimitive` exemption.
- **CU-2 — Correct variant for the meaning.** — FAIL (**medium**) if an element's *intent* doesn't match its variant — e.g. a destructive action styled as the default button colored red by hand, instead of `variant="destructive"`. *Detect (judgment lane):* compare rendered role vs the primitive's intended variant.
- **CU-3 — No raw element re-implementing a primitive.** — FAIL (**high**) if a raw element manually reconstructs a primitive's look (padding + radius + bg) instead of using it — it will drift and usually drops the focus-visible ring. *Detect:* raw element carrying primitive-like styling.
- **CU-4 — Props are typed (no `any`).** *(static rule `no-any-props`)* — FAIL (**medium**) if `any` appears in a `Props`/`ComponentProps`/`React.FC` signature. *Expected:* explicit types (e.g. `VariantProps<typeof buttonVariants>`).

### Axis: `design-handoff`
- **DH-1 — Required design-system docs exist.** *(static rule `missing-design-doc`)* — FAIL (**high**) if the required docs are absent (mature: `_requirements/01-design-system/{COMPONENT_LIBRARY,COLOR_SEMANTICS,UX_PRINCIPLES,FEEDBACK_PATTERNS}.md`; greenfield: `DESIGN_SYSTEM.md` + `globals.css` + `src/components/ui/`). *Why:* no declared source of truth ⇒ nothing to be consistent with.
- **DH-2 — Spec'd components are realized by a real primitive.** — FAIL (**high**) if a `design_brief`/`build_spec` names a component with **no** corresponding `src/components/ui/` source. *Observed:* spec calls for `<Stepper>`, no `ui/stepper`. *Expected:* a real primitive. *Severity:* contract defect — do not wave through.
- **DH-3 — Rendered intent matches the brief.** — FAIL (**high**) if the rendered variant/color/copy diverges from the brief's stated intent (handoff drift), even if it "looks close." *Detect (judgment lane):* compare render to brief.
- **DH-4 — One visual language across domains.** — FAIL (**medium**) if web/landing UI uses different tokens/primitives than the app for the same role (e.g. lander `bg-blue-500` vs app `bg-primary`). Applies to both `design-lead` and `conversion-lead` output.

### Visual-review categories
- **CR-1 (`color`)** — FAIL (**high**) if a brand/semantic color renders as the wrong value (e.g. a primary button computed grey instead of the `--primary` token). *Detect:* computed `background-color`/`color` vs the token value.
- **CR-2 (`typography`)** — FAIL (**medium**) if type sizes/weights don't come from the type scale (one-off sizes, H2 same size as body). *Detect:* computed `font-size`/`font-weight` off the documented scale.
- **CR-3 (`regression`)** — FAIL (**medium**) if the same component renders inconsistently across screens/states (drift between two instances of the "same" element). *Detect:* compare computed styles of the same primitive across entry paths.

### Governed-exception clause (do not over-flag)
- **EX-1 — A legitimate exception is documented; drift is not.** A purposeful deviation (Von Restorff highlight on the single primary CTA; necessary complexity per Tesler's Law) is **PASS** *only* when it is achieved via a token/variant or recorded in the project's design-system allow-list (`scripts/checks/design-system.allowlist.json` entry: file + rule + reason). An undocumented hardcoded one-off is **FAIL** (drift), not a creative choice. This clause prevents flagging the intentional emphasis while still catching the shortcut.

---

## 7. Sources

Provenance/evidence only — the principles above are self-contained; do not treat any source as a "go use this tool" directive.

- W3C Design Tokens Community Group — https://www.w3.org/community/design-tokens/ ; DTCG Format Module — https://www.designtokens.org/tr/drafts/format/ (token tiers, `$type`/`$value`, aliasing)
- Nielsen Norman Group — Consistency & Standards (Heuristic #4) — https://www.nngroup.com/articles/consistency-and-standards/ ; 10 Usability Heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/
- Laws of UX — Jakob's Law, Tesler's Law (Conservation of Complexity), Von Restorff Effect — https://lawsofux.com/teslers-law/ , https://lawsofux.com/von-restorff-effect/
- Refactoring UI — color palette / spacing scale / type scale system — https://refactoringui.com/
- Design-system drift taxonomy (hardcoded values, token drift, variant drift in AI-generated code) — https://overlayqa.com/blog/design-system-drift/
- Substrate reference: Tailwind v4 + shadcn/ui token bridge (CSS custom properties + `@theme inline` + CVA variant primitives) — as a *principle* substrate, not a product recommendation.
