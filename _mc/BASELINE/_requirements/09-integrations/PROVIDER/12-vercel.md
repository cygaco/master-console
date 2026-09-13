# Vercel — Frontend Hosting + Preview Deploys

**Sources:**
- https://vercel.com/docs
- https://vercel.com/docs/deployments/preview-deployments
- https://vercel.com/docs/projects/environment-variables

Last verified: 2026-04-28.

## What runs on Vercel

The Next.js frontend (`src/app/*`). Backend lives separately on Fly.io — see `11-fly-io.md`.

## Setup

Vercel auto-detects the Next.js framework from `package.json`. No `vercel.json` currently — defaults work.

### Project link (manual setup)

```bash
vercel link
vercel env pull .env.local      # syncs Production/Preview env vars to local
```

## Environments (Vercel scopes)

| Scope | Branch | URL pattern | Purpose |
|---|---|---|---|
| Production | `main` | pantrypilot.example | Live users |
| Preview | every other branch | `pantrypilot-<hash>-vercel.app` | Auto per push |
| Development | local | localhost:3000 | `npm run dev` |

## Env vars

Set per scope in Vercel dashboard or via `vercel env add`:

| Var | Production | Preview | Dev |
|---|---|---|---|
| `BACKEND_URL` | `https://api.pantrypilot.example` | per-PR Fly review app (planned) | `http://localhost:4000` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | live key | test key | test key |
| `UPSTASH_REDIS_REST_URL` | prod Upstash | dev Upstash | dev Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | prod token | dev token | dev token |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | live | test | test |

## Project conventions

- **Framework preset auto-detected.** No `vercel.json` unless we need a redirect or custom build command — keep config minimal.
- **API routes are thin proxies.** Next.js `/api/*` routes forward to `BACKEND_URL/*`. Heavy lifting on Fly.
- **Preview deploys per branch are default-on.** Every PR gets a unique URL. After user-data plan Phase 2, each preview deploy will pair with a per-PR Fly review app + Neon branch.
- **Don't deploy from local.** Vercel deploys from Git. `vercel deploy --prod` on local is allowed for hotfixes but should be rare.
- **CSP from `next.config.ts`** — security headers ride along with every deploy.

## Build settings

| Setting | Value |
|---|---|
| Framework Preset | Next.js (auto) |
| Build Command | `next build` (default) |
| Output Directory | `.next` (default) |
| Install Command | `npm install` (default) |
| Node Version | 20.x or latest LTS |

## Deployment flow

```bash
# Manual
vercel deploy --prod    # production
vercel deploy           # preview

# Automatic (default)
git push origin <branch>    # triggers preview deploy
git push origin main        # triggers production deploy after CI checks pass
```

## Vercel Analytics + Speed Insights

CSP `connect-src` allowlists `https://va.vercel-scripts.com` and `https://vitals.vercel-insights.com` — Web Vitals + page-view tracking enabled by default if Vercel Analytics is on.

## Per-PR review app integration (planned, user-data plan Phase 2)

Workflow `.github/workflows/fly-review.yml` will:
1. Spawn a Fly review app per PR (`pantrypilot-backend-pr-<N>`)
2. Create a Neon Postgres branch per PR
3. Set `BACKEND_URL=https://pantrypilot-backend-pr-<N>.fly.dev` on the Vercel preview env via `vercel env add`
4. Tear down all three on PR close

This gives end-to-end testable previews — Vercel preview frontend + Fly preview backend + Neon preview DB + Stripe test mode.

## Known issues

- **First preview deploy after a long idle is cold** (~30s). Subsequent are warm.
- **Edge runtime not used** — we use Node runtime everywhere. Edge would block dependency on Node-only libs (jspdf, mammoth, pdfjs-dist).
- **ISR not used** — app is fully dynamic per-user.

## Failure modes

| Failure | Behavior |
|---|---|
| Build fails | Vercel rejects deploy; PR check turns red; previous deploy stays live |
| Runtime error in API route | 500 logged to Vercel runtime logs + Sentry (when wired) |
| BACKEND_URL unreachable | Frontend `/api/*` proxy returns 502; client retries with exponential backoff |
| Env var missing | Graceful fallback (e.g., `/api/stripe/config` returns `configured: false`) |
| Preview deploy URL leak | Acceptable — preview URLs don't have production env vars or live Stripe keys |
