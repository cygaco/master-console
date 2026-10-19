# Skeleton Repo Checklist

The skeleton is the instrumented starting point that all agents build against. It compiles and runs with zero features. Agents fill in implementation; the skeleton tells them if they got it wrong.

> **The shipped scaffold.** The config, dependencies, folder structure and env-var set below are those of the app scaffold MC ships (`_mc/templates/app-scaffold`, materialized by `scripts/scaffold/app.js`). A product adds its own stack, step sequence and primitives on top, from its canon/manifest (`_requirements/00-canonical/STEPS.json` and the product manifest) — keep the SHAPE of this checklist (config → deps → structure → env → instrumentation).

---

## Config Files

### tsconfig.json

- `strict: true` — all strict checks active
- `isolatedModules: true`
- `noEmit: true`
- Path alias: `@/*` maps to `./src/*`
- Target: ES2017, module: esnext, moduleResolution: bundler, jsx: preserve
- Plugins: `[{ name: "next" }]`
- Excludes: `node_modules`

### next.config.ts

- `outputFileTracingRoot: __dirname` — anchors file tracing to the app's own directory
- Security headers on all routes:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `X-DNS-Prefetch-Control: off`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
  - HSTS: `max-age=31536000; includeSubDomains`
- No CSP in the static list: a correct CSP needs a per-route nonce, so it belongs in middleware (see `DESIGN_SYSTEM.md`)

### postcss.config.mjs

- Plugin: `@tailwindcss/postcss`

### components.json

- shadcn/ui config (style `new-york`, lucide icons), so `npx shadcn add <x>` lands in `src/components/ui/`

### playwright.config.ts

- Test dir: `./tests`
- Fully parallel; 2 retries on CI
- Projects: chromium (Desktop Chrome), mobile (iPhone 13)
- Web server: `npm run dev` on port 3000
- Base URL: `http://localhost:3000`

### .gitignore

- `scripts/scaffold/app.js` adds a managed block: `/node_modules`, `/.next/`, `/out/`, `/build`, `next-env.d.ts`, `*.tsbuildinfo`, `.env*.local`, `/test-results/`, `/playwright-report/`, `/blob-report/`, `.DS_Store`

---

## Dependencies (package.json)

### Framework

- `next` 16.2.1
- `react` 19.2.3
- `react-dom` 19.2.3

### Auth / data

- `@supabase/supabase-js` ^2.47.0
- `@supabase/ssr` ^0.5.2

### UI

- `lucide-react` ^0.577.0
- `@radix-ui/react-slot`, `@radix-ui/react-dialog`, `@radix-ui/react-label`
- `class-variance-authority`, `clsx`, `tailwind-merge`

### Dev

- `typescript` ^5.7.0, `@types/node`, `@types/react`, `@types/react-dom`
- `tailwindcss` ^4, `@tailwindcss/postcss` ^4
- `@playwright/test` ^1.58.2, `vitest` ^3.2.4
- `pg` ^8.13.0 (the auth hard-block verifier's live mode)

### Scripts

- `dev` / `build` / `start` / `lint` — next
- `test` — playwright test
- `test:unit` — vitest run tests/unit
- `test:auth-hardblock`, `test:auth-redirect` — node --test the auth checks
- `verify:auth` — node scripts/verify-auth-hardblock.mjs
- `check:auth-seam` — node scripts/check-auth-seam.mjs

---

## Folder Structure

```
src/
  app/
    page.tsx              (home)
    layout.tsx
    not-found.tsx
    globals.css           (design tokens)
    auth/                 (page.tsx — sign-in; callback/route.ts — the auth callback)
    account/              (page.tsx)
    admin/                (page.tsx, actions.ts; readiness/ — the launch-readiness board;
                           guides/[ref]/ — the launch guides)
  components/
    composer/             (Composer, RecordingBar — the input composer)
    ui/                   (button, card, dialog, input, label, textarea)
  hooks/                  (useAutosize, useVoiceInput)
  lib/
    supabase/             — client, server, middleware, config, safe-next (the auth seam)
    telemetry/            — events, track, sink, chain
    admin/                — config, store, project-sections (the admin gate)
    readiness/            — types, group, writeback
    composer/             — autosize, dedup, terminus, voice-errors
    utils.ts              — cn(), the class-merge helper
  middleware.ts           — refreshes the auth session on each request (static assets excluded)

scripts/                  — check-auth-seam.mjs, verify-auth-hardblock.mjs (+ its test)
supabase/migrations/      — 0001_password_hardblock.sql
tests/                    — smoke.spec.ts, composer.spec.ts, unit/*.test.ts
```

Top-level docs: `DESIGN_SYSTEM.md`, `FOUNDERS_CHECKLIST.md`, `README.scaffold.md`.

---

## Environment Variables

The skeleton ships a `.env.local.example` listing env var NAMES (no values). `ENV-SETUP.md` explains each one.

**App:** public app name.

**Analytics (optional):** PostHog key and host; the telemetry seam no-ops when the key is unset.

**Admin gate:** founder email allowlist, session secret, session cookie name, session version, a dev-only admin email.

**Auth (Supabase, passwordless):** project URL and anon key (the auth seam no-ops without them), service-role key, access token, database URL (for the hard-block verifier's live mode), Google OAuth client ID and secret, Resend API key.

**Voice input (optional):** the transcription endpoint URL, a documented seam; the route itself is product-owned.

---

## Instrumentation (what the skeleton enforces)

1. **TypeScript strict mode** — type mismatches caught at compile time with exact file and line
2. **Security headers** — X-Frame-Options, HSTS, Referrer-Policy and Permissions-Policy baked into next.config.ts
3. **Auth seam guard** — `check:auth-seam` asserts every symbol the auth UI imports from `@/lib/supabase/*` is exported
4. **Auth hard-block verifier** — `verify:auth` checks the password hard-block migration, fail-closed
5. **Tests** — Playwright smoke and composer specs (desktop + mobile); vitest unit tests

### Missing (to be added)

- ESLint with architectural rules
- Build-time structural checks
- Placeholder tests per feature (acceptance criteria as test stubs)
