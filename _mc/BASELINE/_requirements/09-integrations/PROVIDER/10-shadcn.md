# shadcn/ui — Component System

**Sources:**
- https://ui.shadcn.com/docs
- https://ui.shadcn.com/docs/installation/next
- https://ui.shadcn.com/docs/tailwind-v4

Last verified: 2026-04-28.

## What it is

shadcn/ui is **not a package** — it's a CLI that copies React components into your repo. You own the source. Built on Radix primitives + Tailwind. Each component is a small file you can edit freely.

## Setup

```bash
npx shadcn@latest init
```

Generates:
- `components.json` (config: style, base color, paths, Tailwind/CSS file refs)
- `src/lib/utils.ts` (`cn()` helper for conditional classnames via clsx + tailwind-merge)
- Tailwind config additions (CSS vars for colors, radius, etc.)

Then per-component:

```bash
npx shadcn@latest add button input dialog
```

## Project config

`components.json` decisions:

| Field | Value | Why |
|---|---|---|
| `style` | `default` | Rounded, soft — matches the existing product aesthetic |
| `baseColor` | `slate` | Neutral; we override via tokens from DESIGN_TOKENS.md |
| `cssVariables` | `true` | All theme tokens go through CSS vars, easier to swap themes |
| `tailwind.config` | n/a (Tailwind v4 uses CSS-first config) | v4 doesn't use `tailwind.config.ts` for theme |
| `tailwind.css` | `src/app/globals.css` | Where we declare `@theme` block + CSS vars |
| `aliases.components` | `@/components/ui` | shadcn drops files here |
| `aliases.utils` | `@/lib/utils` | `cn()` helper location |

## Where wired

After Phase A + B migration:

| Component | File | Replaces (legacy) |
|---|---|---|
| Button | `src/components/ui/button.tsx` | `Btn.tsx` |
| Input | `src/components/ui/input.tsx` | `Inp.tsx` |
| Select | `src/components/ui/select.tsx` | `Sel.tsx` |
| Card | `src/components/ui/card.tsx` | `Card.tsx` |
| Tabs | `src/components/ui/tabs.tsx` | `TabBar.tsx` |
| Dialog | `src/components/ui/dialog.tsx` | inline modal in `PrivacyModal.tsx` |
| Popover | `src/components/ui/popover.tsx` | (new — no prior bespoke equivalent) |
| Tooltip | `src/components/ui/tooltip.tsx` | (new) |
| Command | `src/components/ui/command.tsx` | basis for `LocCombo` + `MultiSelect` rewrites |
| Badge | `src/components/ui/badge.tsx` | `AutoBadge.tsx` |
| Sonner | `src/components/ui/sonner.tsx` | `Toast.tsx` + `GlazeToast.tsx` |

Components kept bespoke (not migrated):
- `ProgressSteps` — app-specific stepper UX, no shadcn equivalent
- `EduCard` — composed Card with feature layout (uses shadcn Card under hood)
- `CharCount` — tiny utility, not a primitive
- `ErrorBoundary` — React error boundary, not UI
- `Spin` — inlined as Loader-2 from lucide

## Project conventions

- **Theme tokens come from `_requirements/03-architecture/DESIGN_TOKENS.md`** — declared as CSS vars in `src/app/globals.css` `@theme` block. shadcn components reference `--primary`, `--secondary`, `--accent`, `--destructive`, `--muted`, `--card`, `--background`, `--foreground`, `--border`, `--ring`, `--radius`.
- **Edit shadcn components freely.** They're our code now. Add new variants to `Button` via `cva()` instead of wrapping.
- **`cn()` everywhere.** Don't string-concat class names — `cn(base, conditional && 'extra', overrides)` ensures Tailwind merge handles conflicting utilities.
- **Migration uses a `legacy/` holding pen.** Old bespoke components move to `src/components/ui/legacy/<name>.tsx`, callers update imports temporarily, then we delete each legacy file after migration verifies clean. Delete `legacy/` directory entirely once Phase B done.
- **Sonner replaces both Toast and GlazeToast.** One feedback system to maintain. `FEEDBACK_PATTERNS.md` updates to describe Sonner behavior.

## Tailwind v4 compat

shadcn announced v4 support in late 2025. Differences from v3:
- No `tailwind.config.ts` — theme is declared in CSS via `@theme {...}` block
- shadcn `init` writes the CSS directly into `globals.css` (or wherever you point it)
- `cssVariables: true` is the default and recommended path

Some components published before v4 GA may need light adjustment — re-run `npx shadcn@latest add <component>` to fetch the v4-compatible version.

## Known issues

- **Sonner replaces 2 systems in one swap.** Phase B step 8 needs care: re-test all toast call sites after migration. FEEDBACK_PATTERNS.md may need timing updates if Sonner defaults differ.
- **`useFormStatus` + Server Actions:** shadcn forms work with React 19 Server Actions out of the box, but custom `useFormStatus` hooks may need adjustment when we wire auth (see user-data plan).
- **`asChild` slot pattern** can cause bugs if a wrapper element strips children — use sparingly and test ARIA.

## Failure modes

| Failure | Behavior |
|---|---|
| Tailwind v4 incompatibility | Re-run `npx shadcn@latest add <name>` to refresh |
| `cn()` miss → conflicting Tailwind classes | tailwind-merge resolves at runtime; no build error |
| Theme token drift | `/scan:design-system` flags hex literals + raw color utilities |
| Shadcn API change | Components are local — we own them. Cherry-pick upstream changes manually. |
