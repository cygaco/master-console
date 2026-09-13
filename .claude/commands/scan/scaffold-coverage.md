---
description: Verify the MC app scaffold (Next+Tailwind v4+shadcn/ui+Radix+Lucide) is complete and coherent — fail-closed enforcer for S0.3, so every scaffolded product ships a real component library, not vibe-coded raw elements.
---

# /scan:scaffold-coverage — App-scaffold completeness + coherence audit

The standing, **fail-closed** enforcer behind S0.3 (component-library scaffold wiring).
It guarantees the pinned app scaffold at `paths.appScaffoldTemplates`
(`_mc/templates/app-scaffold`) stays complete and internally coherent, so the
scaffold engine (`scripts/scaffold/app.js`) can never materialize a half-wired
("vibe-coded") app into a product.

## What it does

Audits `_mc/templates/app-scaffold` and REJECTS (exit 1) when ANY:
- a **required scaffold file** is missing (configs, `src/app/*`, `src/lib/utils`, the core
  `src/components/ui/` set: button · card · input · label · dialog);
- `package.json.tmpl` lacks a **required stack dependency** (next, react, tailwindcss v4,
  shadcn deps: class-variance-authority / clsx / tailwind-merge / lucide-react /
  `@radix-ui/react-{slot,dialog,label}`);
- **import↔dep drift** — a `.ts`/`.tsx` template imports an external package that is NOT
  declared in `package.json.tmpl` (the #1 broken-on-arrival failure: a component importing
  a lib nobody installs);
- `tsconfig` is missing the `@/*` alias; `next.config` is missing the security-header
  baseline; `globals.css` is missing the Tailwind-v4 `@theme inline` token bridge;
  `lib/utils` is missing the `cn` export.

Internal error → exit 2 (fail-closed — a scan that errors must never read as pass).

```
node scripts/checks/scaffold-coverage-scan.js [--json]
```

## On a finding

- **Missing file / dep** → the scaffold is incomplete; add the file or pin the dep in
  `_mc/templates/app-scaffold/`.
- **import↔dep drift** → either add the missing dependency to `package.json.tmpl`, or
  remove the import. This is the check that keeps "deps match what the components actually
  import" true over time.

## Pairs with
- `scripts/scaffold/app.js` — the engine that materializes the scaffold into a product
  (wired into `/portfolio:new` by default and `/bootstrap:spinup` on-screen).
- `_mc/templates/app-scaffold/DESIGN_SYSTEM.md` — the scaffold's design-system doc +
  the S0.2 `design_brief` / `build_spec` contract linkage.
