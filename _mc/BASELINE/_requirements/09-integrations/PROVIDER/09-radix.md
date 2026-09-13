# Radix UI — Headless Primitives

**Sources:**
- https://www.radix-ui.com/primitives/docs/overview/introduction
- https://www.radix-ui.com/primitives/docs/components

Last verified: 2026-04-28.

> See `10-shadcn.md` — we adopt Radix **transitively via shadcn/ui**, not directly. Radix primitives ship as `@radix-ui/react-<component>` packages; shadcn pulls in the ones it needs and styles them with Tailwind. We don't import `@radix-ui/*` directly except where shadcn doesn't ship the primitive we need.

## Why Radix

- **Headless** — Radix ships behavior + ARIA + keyboard nav, no styles. We ship the styles via Tailwind / shadcn.
- **Accessibility for free** — focus management, screen-reader labels, keyboard trap escape, all baked in. The hardest parts of bespoke UI to get right.
- **Server components compatible** — primitives work in Next.js App Router with `"use client"` directives at leaf components.

## Primitives in active use (post Phase A)

| Primitive | Source package | Where used in the product |
|---|---|---|
| `Dialog` | `@radix-ui/react-dialog` (via shadcn) | `src/components/PrivacyModal.tsx`, future settings/confirmation modals |
| `Popover` | `@radix-ui/react-popover` (via shadcn) | Auto-fill confidence badges, date-picker dropdowns |
| `Tooltip` | `@radix-ui/react-tooltip` (via shadcn) | Field hints, badge explanations |
| `Combobox` (via Command) | `cmdk` + `@radix-ui/react-popover` (via shadcn) | LocCombo replacement, MultiSelect base |
| `Select` | `@radix-ui/react-select` (via shadcn) | Form selects (employment type, currency, etc.) |
| `Tabs` | `@radix-ui/react-tabs` (via shadcn) | TabBar replacement |

## Direct imports (when shadcn doesn't suffice)

shadcn ships ~50 components on Radix primitives + a few non-Radix utilities. When we need a Radix primitive shadcn hasn't shipped:

- **Stay in `@radix-ui/react-<x>`** — install directly, style with Tailwind utilities + tokens.
- **Compose into `src/components/ui/`** — file naming follows shadcn convention (lowercase, kebab) so the directory is uniform.
- Document in this file under a "Direct primitives" subsection.

Currently no direct imports needed.

## Project conventions

- **All UI primitives go through `src/components/ui/`.** Don't import `@radix-ui/*` from feature components — go through the shadcn / project wrapper.
- **Composition over wrapping.** When extending a primitive, compose with `asChild` slot pattern instead of wrapping in a `<div>` that breaks ARIA.
- **Style with tokens.** Color / spacing / radius come from CSS vars in `globals.css`, derived from `_requirements/03-architecture/DESIGN_TOKENS.md`. Don't hardcode hex — `/scan:design-system` will catch it.

## Known issues / quirks

- **React 19 + Radix:** Radix is on the React 19 train; verify each primitive after a Next major bump.
- **SSR hydration warnings:** rare with Dialog when content is computed (use `useId` + stable refs).
- **Tailwind v4:** shadcn shipped v4 support late 2025; some components have minor adjustments — see `10-shadcn.md` for migration notes.

## Failure modes

| Failure | Behavior |
|---|---|
| Missing primitive (shadcn doesn't ship) | Add `@radix-ui/react-<x>`, build wrapper in `src/components/ui/`, document here |
| ARIA regression | Caught by `/scan:design-system` + Playwright MCP `browser_snapshot` accessibility tree assertions |
| Bundle size | Radix is tree-shakable per-primitive; total impact for our usage <50kb gzip |
