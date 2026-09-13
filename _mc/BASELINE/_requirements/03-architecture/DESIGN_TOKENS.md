# Pantry Pilot — Design Tokens (Regen Spec)

All visual design tokens are CSS custom properties defined in `src/app/globals.css`. The extension popup has a matching subset in `extension/popup.css`.

---

## Agent Instructions

> **How to use this file when building components:**
>
> 1. Reference tokens by CSS custom property name (e.g., `var(--primary)`) — never hardcode color, spacing, or shadow values
> 2. Use the semantic token for its intended purpose (e.g., `--error` for error states, `--success` for success states) — do not repurpose tokens outside their documented usage
> 3. Animation names and durations in the Animations table are canonical — do not invent new `@keyframes` unless no existing animation fits, and flag it in your output if you do
> 4. All color comes from CSS custom properties, not Tailwind utility classes — Tailwind is imported for base reset only (see Tailwind Integration section)
> 5. When a component needs a visual token that does not exist in this file, flag it in your builder output — do not create ad-hoc magic numbers or inline values
> 6. Extension popup tokens (in `extension/popup.css`) are a separate subset — use those when building extension UI, not the app tokens directly
> 7. There is one theme (dark, warm-tinted kitchen). There is no light mode or theme toggle — do not add conditional theming logic

---

## Color Palette

### Core

| Token            | Value     | Usage                             |
| ---------------- | --------- | --------------------------------- |
| `--bg`           | `#0b0303` | Page background                   |
| `--surface`      | `#141010` | Card / panel backgrounds          |
| `--surface-alt`  | `#1e1818` | Alternate surface (hover, nested) |
| `--surface-raised` | `#1e1818` | Raised panels / alias of alternate surface |
| `--bg-surface`   | `#1a1414` | Form and secondary surface backgrounds |
| `--bg-input`     | `#1a1414` | Input backgrounds                 |
| `--text`         | `#f0eded` | Primary text                      |
| `--text-muted`   | `#9a9494` | Secondary / label text            |
| `--text-inverse` | `#0b0303` | Text on light backgrounds         |

### Brand

| Token              | Value     | Usage                         |
| ------------------ | --------- | ----------------------------- |
| `--primary`        | `#ff5a17` | Buttons, links, active states |
| `--primary-text`   | `#ffffff` | Text on primary background    |
| `--primary-hover`  | `#e64e12` | Primary button hover          |
| `--primary-soft`   | `rgba(255, 90, 23, 0.05)` | Very subtle primary tint |
| `--secondary`      | `#d4a054` | Secondary accent (gold)       |
| `--secondary-text` | `#0b0303` | Text on secondary background  |
| `--accent`         | `#d4a054` | Alias for secondary           |
| `--accent-text`    | `#0b0303` | Text on accent background     |

### Borders

| Token            | Value     | Usage                   |
| ---------------- | --------- | ----------------------- |
| `--border`       | `#2a2424` | Default borders         |
| `--border-focus` | `#ff5a17` | Focus ring border color |

### Semantic Status

| Token              | Value                      | Usage                             |
| ------------------ | -------------------------- | --------------------------------- |
| `--success`        | `#acd229`                  | Success state (lime green)        |
| `--success-light`  | `rgba(172, 210, 41, 0.1)`  | Success background tint           |
| `--success-border` | `rgba(172, 210, 41, 0.25)` | Success border tint               |
| `--warning`        | `#eab308`                  | Warning state (amber)             |
| `--warning-light`  | `rgba(234, 179, 8, 0.1)`   | Warning background tint           |
| `--warning-border` | `rgba(234, 179, 8, 0.3)`   | Warning border tint               |
| `--error`          | `#ef4444`                  | Error state (red)                 |
| `--error-light`    | `rgba(239, 68, 68, 0.1)`   | Error background tint             |
| `--error-border`   | `rgba(239, 68, 68, 0.3)`   | Error border tint                 |
| `--info`           | `#d4a054`                  | Info state (gold, same as accent) |
| `--info-light`     | `rgba(212, 160, 84, 0.08)` | Info background tint              |
| `--info-border`    | `rgba(212, 160, 84, 0.25)` | Info border tint                  |

### Meal Plan Tag Colors

| Token               | Value                       | Usage                          |
| ------------------- | --------------------------- | ------------------------------ |
| `--tag-full`        | `#d4a054`                   | Full/master plan tag (gold)    |
| `--tag-full-bg`     | `rgba(212, 160, 84, 0.12)`  | Full plan tag background       |
| `--tag-general`     | `#4b8bf5`                   | General plan tag (blue)        |
| `--tag-general-bg`  | `rgba(75, 139, 245, 0.12)`  | General plan tag background    |
| `--tag-targeted`    | `#b06be8`                   | Targeted plan tag (purple)     |
| `--tag-targeted-bg` | `rgba(176, 107, 232, 0.12)` | Targeted plan tag background   |

### Special

| Token        | Value                       | Usage                          |
| ------------ | --------------------------- | ------------------------------ |
| `--magic`    | `#b06be8`                   | AI/magic action color (purple) |
| `--magic-bg` | `rgba(176, 107, 232, 0.08)` | Magic action background        |

---

## Spacing & Shape

### Typography Scale

| Token | Value |
| --- | --- |
| `--text-xs` | `11px` |
| `--text-sm` | `13px` |
| `--text-base` | `15px` |
| `--text-lg` | `18px` |
| `--text-xl` | `22px` |
| `--text-2xl` | `28px` |
| `--text-3xl` | `36px` |

### Spacing Scale

| Token | Value |
| --- | --- |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-7` | `32px` |
| `--space-8` | `48px` |

### Shape

| Token           | Value    | Usage                                 |
| --------------- | -------- | ------------------------------------- |
| `--radius`      | `4px`    | Default border radius (inputs, cards) |
| `--radius-lg`   | `8px`    | Large border radius (panels, modals)  |
| `--radius-full` | `9999px` | Pill shape (badges, tags)             |

---

## Elevation

| Token         | Value                           | Usage                 |
| ------------- | ------------------------------- | --------------------- |
| `--shadow`    | `0 1px 2px rgba(0, 0, 0, 0.3)`  | Default card shadow   |
| `--shadow-lg` | `0 4px 12px rgba(0, 0, 0, 0.4)` | Elevated panel shadow |
| `--shadow-card` | `0 2px 8px rgba(0, 0, 0, 0.25)` | Standard card elevation |
| `--shadow-card-hover` | `0 8px 24px rgba(0, 0, 0, 0.35)` | Hover elevation |
| `--shadow-glow-primary` | `0 0 20px rgba(255, 90, 23, 0.15)` | Primary glow affordance |

---

## Motion

| Token | Value | Usage |
| --- | --- | --- |
| `--ease-out-smooth` | `cubic-bezier(0.16, 1, 0.3, 1)` | Default entrance / hover easing |
| `--duration-fast` | `150ms` | Small affordance transitions |
| `--duration-normal` | `250ms` | Hover / card transitions |
| `--duration-slow` | `400ms` | Page and content reveal transitions |

---

## Typography

| Token            | Value                                           | Usage           |
| ---------------- | ----------------------------------------------- | --------------- |
| `--font-body`    | `"Inter", system-ui, sans-serif`                | Body text       |
| `--font-display` | `"Inter Tight", "Inter", system-ui, sans-serif` | Headings, brand |

---

## Tailwind Integration

Tailwind is imported for base reset only (`@import "tailwindcss"`). Theme overrides bridge CSS vars to Tailwind's `@theme`:

```css
@theme inline {
  --color-background: var(--bg);
  --color-foreground: var(--text);
}
```

No Tailwind utility classes are used for color — all color comes from CSS custom properties.

### shadcn/ui Aliases

`globals.css` also maps shadcn-style semantic tokens to Pantry Pilot tokens: `--background`, `--foreground`, `--card`, `--popover`, `--muted`, `--destructive`, `--input`, and `--ring`, plus the corresponding `--color-*` Tailwind theme aliases. When using shadcn/ui primitives, prefer these aliases through component variants instead of introducing parallel color systems.

---

## Animations (globals.css)

| Animation              | Duration             | Usage                               |
| ---------------------- | -------------------- | ----------------------------------- |
| `fade-in`              | 0.2s                 | Page transitions (`.page-enter`)    |
| `celebration-pop`      | component-controlled | Milestone celebration scale bounce  |
| `celebration-slide-up` | component-controlled | Celebration content slide           |
| `confetti-fall`        | 2.5s                 | Confetti particles                  |
| `skeleton-pulse`       | component-controlled | Loading skeleton shimmer            |
| `shimmer`              | component-controlled | Shimmer loading effect              |
| `card-fill`            | component-controlled | Progress card fill animation        |
| `score-pop`            | component-controlled | Readiness meter score bounce        |
| `delta-fade`           | component-controlled | Score delta fade-out                |
| `meter-glow-pulse`     | component-controlled | Readiness meter glow                |
| `cart-spin`            | component-controlled | Cart icon spin                      |
| `glaze-slide-in`       | component-controlled | Glaze notification slide in         |
| `glaze-fade-out`       | component-controlled | Glaze notification fade out         |
| `pulse-glow`           | component-controlled | Pulsing glow effect (active states) |
| `toast-in`             | component-controlled | Toast notification entrance         |

---

## Extension Popup Tokens

`extension/popup.css` defines a subset matching the brand:

| Token           | Value                      | Notes                             |
| --------------- | -------------------------- | --------------------------------- |
| `--bg`          | `#0B0303`                  | Same as app                       |
| `--bg-surface`  | `#1a1010`                  | Maps to app's `--surface`         |
| `--bg-elevated` | `#241818`                  | Maps to app's `--surface-alt`     |
| `--primary`     | `#FF5A17`                  | Same as app                       |
| `--primary-dim` | `rgba(255, 90, 23, 0.15)`  | Extension-only hover tint         |
| `--success`     | `#ACD229`                  | Same as app                       |
| `--success-dim` | `rgba(172, 210, 41, 0.15)` | Extension-only success tint       |
| `--danger`      | `#ff4444`                  | Slightly different from `--error` |
| `--danger-dim`  | `rgba(255, 68, 68, 0.15)`  | Extension-only danger tint        |
| `--text`        | `#f0eded`                  | Same as app                       |
| `--text-muted`  | `#999`                     | Slightly different from app       |
| `--text-dim`    | `#666`                     | Extension-only tertiary text      |
| `--border`      | `#2a1e1e`                  | Slightly different from app       |
| `--radius`      | `8px`                      | Larger than app default (4px)     |

Popup body: `width: 340px`, system font stack (not Inter), `font-size: 13px`.

---

## Global Styles

- Scrollbar: 6px wide, `--border` color thumb, transparent track
- Focus ring: `2px solid var(--primary)`, `2px offset`, `var(--radius)` border-radius
- Body: `var(--bg)` background, `var(--text)` color, `var(--font-body)` font
