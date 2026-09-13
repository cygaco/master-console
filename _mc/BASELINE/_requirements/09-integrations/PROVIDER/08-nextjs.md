# Next.js — App Router, Vercel, Security Headers

**Sources:**
- https://nextjs.org/docs/app
- https://nextjs.org/docs/app/api-reference/next-config-js
- https://vercel.com/docs/frameworks/nextjs

Last verified: 2026-04-28.

## Packages

| Package | Version | Purpose |
|---|---|---|
| `next` | `^16.2.3` | App Router framework, dev server, build pipeline |
| `react` | `19.2.3` | Required by Next 16 |
| `react-dom` | `19.2.3` | DOM renderer |
| `@tailwindcss/postcss` | `^4` | Tailwind v4 PostCSS plugin |
| `tailwindcss` | `^4` | Utility CSS framework |
| `typescript` | `^5` | TS toolchain |

## Where wired

| Site | File | Purpose |
|---|---|---|
| Config | `next.config.ts` | Security headers (CSP, HSTS, frame-options), serverExternalPackages for jspdf |
| App entrypoint | `src/app/page.tsx` | Single-page wizard owning SessionData via React useState |
| API routes | `src/app/api/*/route.ts` | Thin proxies to backend or local config probes |
| Auth pages (planned) | `src/app/(auth)/*/page.tsx` | signup, login, forgot-password, reset-password |
| Checkout success (planned) | `src/app/(checkout)/success/page.tsx` | Polling page for Stripe webhook completion |

## Scripts

```bash
npm run dev    # next dev (Turbopack)
npm run build  # next build
npm run start  # next start (prod runtime)
```

## Project conventions

- **App Router only.** No `pages/` directory. Server components by default; client components opt-in via `"use client"`.
- **No state library.** SessionData lives in root `page.tsx` `useState`, drilled through props to step components. No Redux, Zustand, Context API for wizard state. See `_requirements/03-architecture/DATA_FLOW.md`.
- **Security headers in next.config.ts** apply to all routes. CSP currently includes `'unsafe-inline'` script-src — TODO(run-9 redteam RT-NEW-601) to remove via nonce-based middleware.
- **API routes are thin proxies.** Heavy work lives in `services/backend/` (Hono on Fly.io). Frontend `/api/*` forwards to `${API_BASE_URL}/*` and passes through cookies + auth headers.
- **Turbopack for dev.** `serverExternalPackages: ["jspdf"]` works around a Node Worker SSR issue with Turbopack.
- **No middleware.ts yet.** Planned for nonce-based CSP and auth gate (see user-data plan).

## Vercel deployment

Auto-detected from project root. No `vercel.json` currently — defaults work.

| Concern | Status |
|---|---|
| Preview deploys per PR | Default-on for Next.js framework preset |
| Environment vars | Configured per scope (Production / Preview / Development) in Vercel dashboard |
| Edge runtime | Not used; we run Node runtime everywhere |
| ISR | Not used (app is dynamic per-user) |
| `BACKEND_URL` env | Per-scope: production points to `api.pantrypilot.example`, preview deploys point to per-PR Fly review apps (per user-data plan Phase 2) |

## Known issues

- CSP `unsafe-inline` for script-src — security debt, RT-NEW-601 in run-9 redteam.
- jspdf SSR via Turbopack required `serverExternalPackages` workaround. Re-test on each Next minor.
- Headed Playwright tests + Next dev server have occasional first-load slowness (~10s warmup).

## Failure modes

| Failure | Behavior |
|---|---|
| Build fails on type error | Vercel rejects deploy; PR check turns red |
| Runtime error in API route | Returns 500; logs to Vercel + Sentry (when wired) |
| ENV missing on Vercel | Graceful fallbacks via `/api/stripe/config` pattern (returns `configured: false`) |
| BACKEND_URL unreachable | API proxy returns 502; client retries with exponential backoff |
