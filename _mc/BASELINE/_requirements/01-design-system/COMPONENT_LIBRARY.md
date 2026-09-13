# Component Library

Shared UI primitives used across the application. This documents current state, variants, and known issues.

---

## Btn (Button)

### Variants

| Variant | Background  | Text             | Border               | Hover             |
| ------- | ----------- | ---------------- | -------------------- | ----------------- |
| primary | `--primary` | `--primary-text` | none                 | `--primary-hover` |
| ghost   | transparent | `--text-muted`   | none                 | bg: `--surface`   |
| outline | transparent | `--text`         | `1px solid --border` | bg: `--surface`   |
| danger  | `--error`   | `--text-inverse` | none                 | `#dc2626`         |

### Base Styling

- Padding: `px-4 py-2`
- Font: `text-sm font-semibold`
- Border radius: `--radius-lg` (8px)
- Transition: `transition-all`
- Disabled: `opacity-40`, `cursor-not-allowed`

### Loading State

- Shows `<Spin>` spinner alongside text
- Button remains disabled during loading

### Hover Implementation

- Uses `onMouseEnter`/`onMouseLeave` with `Object.assign(el.style, ...)`
- **Known issue:** JS-based hover conflicts with CSS transitions. Should use CSS `:hover` instead.

### Missing (Flagged for Regen)

- No `small` variant (Step10 uses `!px-2 !py-1 text-xs` hack)
- No `icon-only` variant
- No `secondary` variant (even though `--secondary` color exists)

---

## Card (Container)

### Base Styling

- Background: `--bg`
- Border: `1px solid --border`
- Border radius: `--radius-lg` (8px)
- Box shadow: `--shadow`

### Usage

- Accepts `className` and `style` overrides
- Commonly combined with Tailwind padding: `p-4` or `p-5`

### Known Issue

- **Inconsistent padding**: Some steps use `p-4` (16px), others `p-5` (20px). No standard.

---

## Inp (Input / Textarea)

### Styling

- Border: `1px solid --border` (error: `--border` → `--error`)
- Border radius: `--radius-lg`
- Focus ring: `--border-focus` (orange)
- Required marker: `--error` color asterisk

### Props

| Prop        | Type                  | Notes                           |
| ----------- | --------------------- | ------------------------------- |
| label       | string                | Required, displayed above input |
| value       | string                | Controlled input                |
| onChange    | (val: string) => void | Value callback                  |
| placeholder | string                | Optional hint                   |
| required    | boolean               | Shows red asterisk              |
| type        | string                | Default: "text"                 |
| rows        | number                | If set, renders as `<textarea>` |
| error       | string                | Error message below input       |

---

## Sel (Select Dropdown)

### Styling

- Matches Inp (same border, radius, focus ring)
- Native `<select>` element

### Props

| Prop     | Type                  | Notes              |
| -------- | --------------------- | ------------------ |
| label    | string                | Required           |
| value    | string                | Controlled         |
| onChange | (val: string) => void | Value callback     |
| options  | string[]              | Dropdown options   |
| required | boolean               | Shows red asterisk |

---

## TabBar (Tab Navigation)

### Active Tab

- Border bottom: `2px solid --primary`
- Color: `--primary`

### Inactive Tab

- Border bottom: `2px solid transparent`
- Color: `--text-muted`

---

## ProgressSteps (Progress Indicator)

### Step States

| State   | Visual                       |
| ------- | ---------------------------- |
| Done    | Checkmark (✓) in `--success` |
| Current | `<Spin>` spinner             |
| Pending | 2×2px dot in `--border`      |

---

## MultiSelect (Button Group)

### Selected

- Background: `--primary`
- Color: `--primary-text`
- Border: `1px solid --primary`
- Border radius: `--radius-full` (pill shape)

### Unselected

- Background: `--bg`
- Color: `--text-muted`
- Border: `1px solid --border`
- Border radius: `--radius-full`

### Features

- "Clear All" button appears when items selected

---

## CopyBtn (Copy to Clipboard)

### States

| State  | Background        | Color          | Duration          |
| ------ | ----------------- | -------------- | ----------------- |
| Normal | `--surface`       | `--text-muted` | —                 |
| Copied | `--success-light` | `--success`    | 1500ms auto-reset |

### Integration

- Inline `copied` state flips back to "Copy" after 2 s; no toast used today (sonner is mounted globally if a future variant wants one)

---

## AutoBadge (AI-Generated Indicator)

**Status: DONE — wraps `Badge` (shadcn)**

- Variants: `info | success | warning | error` (default `info`)
- Colors applied via inline CSS-var style (`--{variant}-light` / `--{variant}` / `--{variant}-border`)
- Structural classes (`text-[11px] font-semibold`) layered via `cva` + `cn` on top of `Badge`
- Inherits shadcn `Badge` focus-ring and ARIA semantics
- Props: `children`, `variant`, `className`, `style`

---

## Toast (Notification System)

**Status: DONE — replaced by shadcn Sonner.** `<Toaster />` from `@/components/ui/sonner` is mounted globally in `src/app/layout.tsx`. Consumers call `toast.success("…")` / `toast.error("…")` / `toast.warning("…")` / `toast.info("…")` from the `sonner` package — no provider context needed. The bespoke `ToastProvider` and `useToast()` hook have been deleted. Sonner's default duration (≈4 s) and bottom-right position are kept.

> See `src/components/ui/sonner.tsx` for the configured Toaster (brand-color CSS-vars wired via `--normal-bg` / `--normal-text` / `--normal-border`).

---

## ErrorBoundary (Error Fallback)

- Wraps children components
- On error: shows error card with "Try Again" button
- Border: `--error-border`
- Error text: `--error`

---

## Card Row Toggle (Inline Pattern)

Used for boolean lists (quick check, deal breakers, skill toggles). NOT a separate component — this is an inline pattern used directly in step components.

### Visual

- Full-width tappable box: `padding: 12px 16px`, `border-radius: var(--radius)`, `border: 1px solid`
- **Active:** orange tinted background (`rgba(255,90,23,0.1)`), orange border, bold text
- **Inactive:** `var(--surface)` background, `var(--border)` border, normal weight text
- 18×18px indicator box at left with `border-radius: var(--radius)`

### Indicator States

The 18×18px indicator box has exactly 3 visual states:

| State | Background | Border | Symbol | When |
|-------|-----------|--------|--------|------|
| **Active (positive)** | `var(--primary)` filled | `var(--primary)` | ✓ | Item is selected/enabled (quick check, skills) |
| **Active (negative)** | `var(--primary)` filled | `var(--primary)` | ✕ | Item is selected for rejection (deal breakers, exclusions) |
| **Inactive** | `transparent` | `var(--border)` | *empty — no symbol* | Item is deselected |

### Indicator Variant Rules

| Context | Active symbol | Rationale |
|---------|--------------|-----------|
| Positive selection (quick check, skills) | ✓ (checkmark) | "Yes, this applies to me" |
| Negative selection (deal breakers, exclusions) | ✕ (cross) | "Skip/reject this thing" |

When deselected, BOTH variants show the same empty bordered box — no symbol, no fill.

### Anti-pattern

**Do NOT use iOS-style toggle switches** (44×24px pill with sliding circle). These regressed during agent builds and are not part of the the product design system. All boolean lists use the card row pattern above.

---

## Other Components

| Component    | Purpose                                                |
| ------------ | ------------------------------------------------------ |
| Spin         | SVG loading spinner with `animate-spin`                |
| CharCount    | Character counter (`{len}/{limit}`, red at limit)      |
| EduCard      | Education entry editor with degree/school/field inputs |
| LocCombo     | Location autocomplete from `US_LOCATIONS` constant — **DONE — wraps `Command` + `Popover` (shadcn)**. Trigger = `PopoverTrigger` (styled to match form inputs). List = `Command` with `shouldFilter={false}`, capped at 12 results. Fires `onChange` on both keystroke (free-text fallback) and item select. |
| PrivacyModal | Data export/import/delete modal                        |

---

## App Chrome Layout (Viewport Pattern)

The app shell uses a fixed viewport layout where chrome (RocketBar, PhaseBar, SidePanel) stays pinned and only the main content area scrolls.

### Pattern

```jsx
<div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
  <RocketBar />    {/* fixed top */}
  <PhaseBar />     {/* fixed top, below RocketBar */}
  <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
    <SidePanel />  {/* fixed left, height: 100% */}
    <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
      {content}    {/* scrolls independently */}
    </main>
  </div>
</div>
```

### Key Rules

- Outer wrapper: `height: 100vh` + `overflow: hidden` — viewport is the boundary
- Content flex child: `minHeight: 0` — allows flex children to shrink below content height
- Main: `overflowY: auto` — only the content area scrolls
- SidePanel: `height: 100%` (NOT `minHeight: 100vh` or `position: sticky`)

### Anti-pattern

**Do NOT use `minHeight: 100vh`** on the flex container. This makes content growth push chrome off-screen. The chrome must stay fixed while content scrolls independently. (HYGIENE Rule 58, BUG-065)

---

## Consistency Standards (For Regen)

Based on audit findings, the regen should enforce:

1. **All buttons use Btn component** — no raw `<button>` with inline styles
2. **Card padding standardized** — pick `p-4` or `p-5`, not both
3. **Icon + text alignment** — always `flex items-center gap-2`, never `ml-1` or manual `verticalAlign`
4. **Hover via CSS** — use `:hover` pseudo-class, not JS `onMouseEnter`/`onMouseLeave`
5. **Btn variants cover all needs** — add `small`, `icon-only`, `secondary` variants
6. **Typography standardized** — `h3` always `text-sm font-bold`, labels always `text-xs font-semibold`

---

## shadcn/ui Adoption Status (2026-04-28)

### Why

We're adopting shadcn/ui (built on Radix primitives) for accessibility and consistency. Bespoke components keep growing custom variants we have to maintain ourselves; shadcn primitives ship ARIA + keyboard nav + focus management for free. See `_requirements/09-integrations/PROVIDER/09-radix.md` and `10-shadcn.md`.

### Phase A — Pilot (DONE)

shadcn init complete with style `new-york`, base color `neutral`, Tailwind v4. CSS vars in `globals.css` alias shadcn-named tokens (`--primary`, `--background`, `--foreground`, etc.) to existing the product brand vars — no visual change to the app.

**Installed primitives:**

| Component | File | Source |
|---|---|---|
| Button | `src/components/ui/button.tsx` | Radix Slot |
| Badge | `src/components/ui/badge.tsx` | — (via cva) |
| Dialog | `src/components/ui/dialog.tsx` | radix-ui Dialog |
| Popover | `src/components/ui/popover.tsx` | radix-ui Popover |
| Tooltip | `src/components/ui/tooltip.tsx` | radix-ui Tooltip |
| Command | `src/components/ui/command.tsx` | cmdk + radix-ui Dialog |
| Sonner (Toaster) | `src/components/ui/sonner.tsx` | sonner |

**Layout wiring:** `TooltipProvider` wraps the app at `src/app/layout.tsx`.

**First conversion:** `PrivacyModal` (in `src/components/ui/PrivacyModal.tsx`) now renders shadcn `Dialog` internally. API preserved — call sites unchanged.

### Phase B — Component-by-component migration (IN PROGRESS — gradual)

Migration strategy: rewrite each bespoke file to wrap the shadcn primitive while preserving the existing exported API. Call sites don't change. After all wrappers are in place, an optional cleanup pass converts call sites to use shadcn primitives directly.

| Bespoke | Status | Action | shadcn target |
|---|---|---|---|
| Btn | **DONE** | wraps shadcn `Button`; preserves 6-variant prop API byte-identically (`primary`→`default`, `secondary`→`outline`, `ghost`→`ghost`, `danger`→`destructive`, `icon`→`ghost`+square, `chip`→`outline`+pill+`aria-pressed`); 3-size prop (`sm`/`md`/`lg`) via inline-style overrides (shadcn Tailwind heights ignored); `loading` spinner (CSS-keyframe, renders before children); `selected` chip toggle; hover managed via `useState` mouseEnter/Leave (shadcn hover: classes don't apply over inline-style background); no hex literals — all colors via CSS custom properties; 92 call sites across 17 files unchanged | button.tsx |
| Card | **DONE** | wraps `Card` from `cardprim.tsx` (inline shadcn Card primitives — `npx shadcn add card` skipped to avoid Windows case-insensitive FS collision with `Card.tsx`); inline style overrides Tailwind defaults with the product tokens (`--surface`, `--border`, `--radius-lg`, `--shadow`); `padding` prop maps sm/md/lg → 12px/20px/32px; `onClick` adds `cursor: pointer`; API (`children`, `className`, `padding`, `onClick`, `style`) unchanged; 24 call sites untouched | cardprim.tsx |
| Spin | Keep custom | inline as Loader-2 from lucide | (no primitive) |
| CopyBtn | **DONE** | wraps `Button variant="outline" size="sm"`; clipboard logic inlined (no custom hook); `execCommand` fallback preserved; copied-state colors via CSS-vars (`--success-light`, `--success`, `--success-border`); API (`text`, `label`, `className`, `style`) unchanged | button.tsx |
| Inp | **DONE** | wraps `Input`; preserves label, error msg, char-count hint, focus border, required `*`, `maxLength`, disabled state, full `InputHTMLAttributes` pass-through | input.tsx |
| Sel | **DONE** | wraps `Select`+`SelectTrigger`+`SelectContent`+`SelectItem`; maps `options[]` to children; preserves label, error msg, disabled, placeholder, `aria-label` forwarded to trigger; `SelProps` base relaxed from `SelectHTMLAttributes<HTMLSelectElement>` → `React.HTMLAttributes<HTMLElement>` (documented in Sel.tsx comment) | select.tsx |
| ProgressSteps | **Keep custom** | app-specific stepper UX | — |
| TabBar | **DONE** | wraps `Tabs`+`TabsList variant="line"`+`TabsTrigger`; tablist-only (no `TabsContent`); active indicator via `borderBottom`+`marginBottom` inline override; `after:!opacity-0` disables shadcn line-variant pseudo-element; CSS-var colors (`--primary`, `--text-muted`); API (`tabs`, `activeTab`, `onChange`, `className`, `style`) unchanged | tabs.tsx |
| MultiSelect | **DONE** | wraps `Command` + `Popover`; trigger shows `label` or `"{label} ({n})"` count; `onMouseDown={e => e.preventDefault()}` on each `CommandItem` keeps popover open for multi-select; checkbox indicator via inline `<span>` with CSS-var colors (`--primary`, `--border`, `--surface`); `CommandInput` for keyboard search; API (`options`, `selected`, `onChange`, `label`, `className`, `style`) unchanged; 0 active call sites | command.tsx + popover.tsx |
| LocCombo | **DONE** | wraps `Command` + `Popover` | command.tsx + popover.tsx |
| EduCard | **Keep custom** | composed Card with feature layout | — |
| CharCount | **Keep custom** | tiny utility, not a primitive | — |
| AutoBadge | **DONE** | wraps `Badge` with cva variants | badge.tsx |
| PrivacyModal | **DONE** | wraps Dialog | dialog.tsx |
| ErrorBoundary | **Keep custom** | React error boundary, not UI | — |
| Toast (custom) | **DONE** | bespoke `ToastProvider` deleted (zero call sites); `<Toaster />` from `sonner.tsx` mounted in `layout.tsx` for any future `toast()` consumers | sonner.tsx |
| GlazeToast | **Keep custom** | feature-specific milestone tracker for GS-SH-009 (score-crossing logic, localStorage dedup) and GS-SH-010 (permanent `jz-glaze-toast` class hook) — not a generic toast; sonner does not replace its semantics | — |

### When migrating

- Use `npx shadcn@latest add <name>` to install the shadcn primitive first
- Rewrite the bespoke file to render the shadcn primitive while keeping exported function names and prop interfaces stable
- Run Playwright MCP visual-diff before/after (see `_requirements/09-integrations/PROVIDER/06-playwright.md`)
- Use `/scan:design-system` to catch hex literals or raw HTML primitives that snuck in
- Update this table once a component flips to "DONE"

### Tokens

shadcn aliases map to the product brand tokens in `src/app/globals.css`:

| shadcn var | the product source |
|---|---|
| `--background` | `--bg` |
| `--foreground` | `--text` |
| `--primary` | `--primary` (orange #ff5a17, kept) |
| `--primary-foreground` | `--primary-text` |
| `--secondary` | `--secondary` (gold #d4a054) |
| `--accent` | `--accent` |
| `--muted` | `--surface-alt` |
| `--muted-foreground` | `--text-muted` |
| `--destructive` | `--error` |
| `--border` | `--border` |
| `--input` | `--bg-input` |
| `--ring` | `--primary` |

Brand colors remain authoritative — shadcn vars are aliases that resolve to them.
