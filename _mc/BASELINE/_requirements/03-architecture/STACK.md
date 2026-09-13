# Pantry Pilot — Stack & Deployment

> **v3 (2026-04-23)** — Aligned with `_requirements/04-features/backend/PRD.md` v3. The v1 stack was Vercel-only with a hard 60s function-timeout constraint; v3 splits into **Vercel frontend + Fly backend (API + worker) + Fly Postgres** behind Cloudflare, which removes the 60s cap entirely.

---

## Core Stack

### Frontend (Vercel)

| Layer         | Technology            | Version                  | Notes                                                                                  |
| ------------- | --------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| Framework     | Next.js               | 16.2.1                   | App Router, Turbopack dev server                                                       |
| UI Library    | React                 | 19                       | Server and client components                                                           |
| Language      | TypeScript            | Strict mode              | All source files                                                                       |
| Hosting       | Vercel                | Hobby plan               | Host for UI + `/.well-known/api-config` (deprecation-banner-only) + legacy `/api/*` during rollback window |
| Encryption    | Web Crypto API        | AES-GCM                  | Client-side localStorage encryption                                                    |
| Styling       | CSS Custom Properties | —                        | Tailwind imported for base reset; components use CSS vars + inline styles              |

### Backend (Fly.io)

| Layer              | Technology                       | Version      | Notes                                                                                 |
| ------------------ | -------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| Framework          | Hono                             | latest       | TypeScript, runs on Node. Two Fly processes: `api` + `worker` in one image.           |
| Runtime            | Node                             | 22 LTS       | Exec-form Dockerfile (`CMD ["node", ...]`) — shell wrappers swallow SIGTERM (F4).     |
| TLS termination    | Nginx sidecar                    | 1.28         | Terminates Cloudflare Authenticated Origin Pulls (mTLS); proxies plaintext to Hono on localhost:3000. Required because no all-Hono+Fly+AOP example exists as of April 2026. |
| Database           | Postgres (Fly Postgres)          | 16           | Authoritative for financial state: ledger, Stripe idempotency, admin users, recovery codes, shopping outcomes, audit log. Added in v3 per research F1 (Upstash is eventually-consistent only). |
| Job queue (internal) | Graphile Worker                | latest       | Runs inside Postgres — enables transactional enqueue (`BEGIN; INSERT INTO ledger; ADD JOB; COMMIT;`).                                                   |
| Job queue (egress) | Upstash QStash                   | —            | For webhooks + cross-service job dispatch. HMAC-signed; double-rotation lockout guarded via `qstash:last_rotation_deployed_at` flag. |
| Cache / scratch    | Upstash Redis                    | —            | Rate limit, WebAuthn challenges, scope cache (read-through), ticket scratch, ops-UI audit live-tail. Not financial-state authoritative. |
| Blob store         | Cloudflare R2                    | —            | Signed URLs ≤15 min TTL, private bucket, object-key `{userId}/{ticketId}/result.{ext}`, Object Lock for audit-log archives. Free egress. |
| AI                 | Anthropic Claude                 | claude-sonnet-4-6 / claude-opus-4-7 | Prompt Caching mandatory from day 1 (research F14 — ~90% input cost reduction). Batch API for non-interactive chains. |
| Recipe catalog     | Recipe Data Co                   | Recipe & Grocery Catalog API | Dataset: `rc_7k3np9v2hd4tqx1`. Called from worker, not API.             |
| Auth               | JWT + OAuth + WebAuthn           | `arctic` ^3.7.0, `@simplewebauthn/server` latest | Google/Apple OAuth, email/password, cookie-based JWT on apex (`__Host-` prefix preferred), WebAuthn for admin (≥2 passkeys + 10 Argon2id recovery codes). |
| Payments           | Stripe                           | `stripe-js` ^8.11.0 | Three-state idempotency in Postgres `stripe_webhook_idempotency`; Free / Plus / Family subscription tiers. |
| Rate limiting      | `@upstash/ratelimit`             | latest       | Sliding window; per-IP, per-user, per-ASN (CF), global, daily budget.                 |

### Edge (Cloudflare)

| Layer              | Technology                       | Notes                                                                                                                   |
| ------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| DNS                | Cloudflare DNS                   | Apex + obscure API subdomain (rotatable via admin-panel Ops).                                                           |
| WAF + DDoS         | Cloudflare (free tier)           | Bot Fight Mode, Always Use HTTPS at edge, HSTS, ASN + country blocklist.                                                |
| CAPTCHA            | Cloudflare Turnstile (free)      | Invisible challenge on anonymous PARSE/PROFILE; upgrade from v2 "accepted risk".                                        |
| mTLS               | Authenticated Origin Pulls       | **Per-zone custom cert** (NOT the shared CF cert — shared cert is vulnerable to CF-bypass-CF attack per research F2).   |
| Rate limiting      | Cloudflare edge rules            | Per-ASN + per-country pre-filter; reduces load before Fly's in-app rate limiter.                                        |

**Geofencing (Pro tier, $20/mo)** is explicitly **out of MVP** — per-ASN blocklist on the free tier covers the main abuse vectors.

---

## Build & Dev

| Command               | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `npm run dev`         | Frontend dev server (Next.js + Turbopack, port 3000)            |
| `npm run build`       | Frontend production build                                       |
| `npm run backend:dev` | Backend dev server (Hono on port 3001)                          |
| `npm run backend:build` | Backend production build (outputs `services/backend/dist/`)   |
| `npm run worker:dev`  | Worker process in dev mode (QStash consumer + Graphile Worker)  |
| `npm run test`        | Playwright E2E tests                                            |
| `npm run db:migrate`  | Apply Postgres migrations                                       |
| `npm run db:seed`     | Seed local Postgres from `packages/shared/db/seed.sql`          |

---

## Deployment Topology

```
                         ┌───────────────────────────────────────┐
  User browser    ───▶  │ Vercel (static HTML, /.well-known)    │
  (HTML + app)          └───────────┬───────────────────────────┘
                                    │ XHR to ${API_BASE_URL}
                                    ▼
                         ┌───────────────────────────────────────┐
                         │ Cloudflare (WAF, DDoS, Bot Fight,    │
                         │ Turnstile, ASN blocklist, HSTS edge,  │
                         │ AOP mTLS with per-zone cert)          │
                         └───────────┬───────────────────────────┘
                                     │ mutual TLS
                                     ▼
                         ┌───────────────────────────────────────┐
                         │ Fly.io — one image, two processes:   │
                         │   [api]    → Nginx ▸ Hono HTTP        │
                         │   [worker] → QStash consumer + Graphile Worker + drain handler │
                         └──┬──────────────────────────┬─────────┘
                            ▼                          ▼
                ┌──────────────────────┐  ┌──────────────────────────────┐
                │ Fly Postgres         │  │ Upstash QStash (egress queue)│
                │ (financial state,    │  └──────────────────────────────┘
                │  audit log)          │
                └──────────────────────┘            │
                            │                       ▼
                            │          ┌──────────────────────────────┐
                            │          │ Upstash Redis (rate, cache,  │
                            └─────────▶│ scope, ticket scratch, audit │
                                       │ live-tail stream)            │
                                       └──────────────────────────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────────────────┐
                                       │ Cloudflare R2 (blobs >256KB, │
                                       │ audit archive w/ Object Lock)│
                                       └──────────────────────────────┘
```

### Staging vs Production

**Required** per research F18 / backend PRD §9:

- Separate Fly app (`pantrypilot-backend-staging`)
- Separate Upstash Redis + QStash projects
- Separate Fly Postgres cluster
- Stripe **test-mode keys** (production keys never in staging; CI enforces)
- `ENVIRONMENT=staging` required in CI secrets before integration tests run
- Production Stripe keys live only in production Fly secrets, never in GitHub Actions

---

## Key Constraints

1. **60-second timeout is no longer a hard cap** (v2 was Vercel-bound; v3 moves long-running operations to the Fly worker process group where they can run for minutes or hours). The natural duration of the job is the cap, not infra.
2. **No direct origin access.** Fly rejects any connection that doesn't present Cloudflare's per-zone mTLS cert (Layer 0 in SECURITY.md). Staging origin is similarly pinned.
3. **Worker SIGTERM drain is mandatory.** `fly.toml` sets `kill_timeout=300`, `kill_signal=SIGTERM`, `auto_stop_machines=false` on the worker. Dockerfile uses exec-form `CMD ["node", ...]`. Explicit drain handler checkpoints in-flight Claude calls to Postgres + Redis before exit.
4. **Prompt Caching is mandatory** on every Claude call. System prompt + PROMPT_RULES + canonical context wrapped in `cache_control: {type: "ephemeral"}`. Alert if cache hit rate <80%.
5. **Single-page app behavior retained** — Next.js App Router, client-side state, `src/lib/api.ts` is the single boundary to the backend.
6. **No Tailwind utility classes in components** — components use CSS custom properties + inline styles. `@import "tailwindcss"` in globals.css provides base reset only.

---

## Cost Model (research F13, F14, F15)

| Component                  | MVP (<1k DAU) | At 10k DAU           | First bottleneck                                           |
| -------------------------- | ------------- | -------------------- | ---------------------------------------------------------- |
| Fly.io API + Worker        | $5–15/mo      | $30–60/mo            | Egress at $0.02/GB NA-EU (mitigated by R2 free egress)     |
| Fly Postgres               | $15–30/mo     | Same                 | Trivial load at 10k DAU / 100k txns/day                    |
| Upstash Redis + QStash     | Free tier     | **$200/mo (Prod Pack)** — required for SLA + SOC-2 if taking payments | SLA/compliance |
| Cloudflare (WAF, R2, Turnstile, AOP) | Free tier | $5–20/mo for R2 storage | R2 egress is FREE (big vs S3)                    |
| Anthropic Claude           | $3-15 / 1M tokens | **Mandatory: Prompt Caching (90% input savings) + Batch API (50% off async)** | Without caching, Claude dominates the bill by 1k DAU |

**Headline:** without Prompt Caching + Batch API enabled, Anthropic spend at 10k DAU is ~10× what it needs to be. R2 is unusually cheap (free egress). Vendor-lockin moat is low — each component has a clear migration path off (Fly→Render/Cloud Run, Upstash→Redis Cloud, QStash→SQS+Lambda, Postgres→RDS).

---

## File Structure

```
.
├── src/                           # Next.js frontend
│   ├── app/
│   │   ├── page.tsx               # Main wizard orchestrator
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── api/                   # Legacy routes — kept during 7-day rollback window with full new-backend security parity; 410 Gone after
│   │   └── .well-known/
│   │       └── api-config/route.ts  # Deprecation banner only (not primary discovery)
│   ├── components/ …              # unchanged — UI components
│   └── lib/                       # Client-side helpers
│       ├── api.ts                 # Boundary — every fetch uses ${API_BASE_URL} prefix
│       ├── storage.ts             # Client AES-GCM encrypted localStorage
│       ├── pipeline.ts            # Pipeline tracer
│       ├── basket-score.ts        # Client-side scoring (reads shopping outcomes)
│       └── …                      # dummy data, test harness, share-link helpers
├── packages/
│   └── shared/                    # NEW in v3 — shared across Next.js + backend
│       ├── plans.ts               # PLAN_TIERS, PLAN_LIMITS (migrated from src/lib/)
│       ├── prompts.ts             # PROMPTS, wrapUntrustedData()
│       ├── types.ts               # Server-relevant types
│       ├── errors.ts              # safeErrorMessage(), error code enum
│       ├── redaction.ts           # pino redaction list
│       └── db/
│           ├── schema.ts          # Drizzle/Prisma Postgres schema
│           └── migrations/
├── services/
│   └── backend/                   # NEW in v3 — the backend service
│       ├── src/
│       │   ├── api.ts             # Hono entrypoint
│       │   ├── worker.ts          # QStash + Graphile consumer + drain handler
│       │   ├── routes/            # auth, plans, stripe, claude, recipes, tickets, shopping, extension, admin, health
│       │   ├── middleware/        # origin-pin, qstash-verify, scope, idempotency
│       │   ├── ledger.ts          # Postgres-backed atomic ledger
│       │   ├── tickets.ts         # Ticket lifecycle + ownership check
│       │   ├── drain.ts           # SIGTERM drain
│       │   ├── prompt-caching.ts  # cache_control wrapper + hit-rate metrics
│       │   ├── r2.ts              # Signed URL generation
│       │   ├── webauthn/          # Passkey enrollment + assertion + recovery codes
│       │   └── admin/             # Static HTML + vanilla JS panel
│       ├── docker/
│       │   ├── Dockerfile         # Multi-stage, exec-form CMDs
│       │   └── Dockerfile.nginx   # Nginx sidecar for AOP mTLS
│       ├── nginx.conf             # ssl_verify_client on + proxy_pass
│       ├── fly.toml               # [processes] api + worker; kill_timeout=300
│       └── scripts/
│           └── seed-admin.js      # One-time admin-scope provisioning
├── extension/                     # Chrome extension (Manifest V3)
├── ops/
│   └── runbooks/
│       ├── rotate-slug.md         # Slug rotation procedure
│       └── rotate-aop-cert.md     # AOP per-zone cert rotation
└── _docs/                          # This doc suite
```

---

## See also

- **Source of truth:** `_requirements/04-features/backend/PRD.md` (v3)
- **Per-route contracts:** `_requirements/03-architecture/API_SURFACE.md`
- **Security model:** `_requirements/03-architecture/SECURITY.md`
- **Persistence split (Postgres vs Redis):** `_requirements/03-architecture/PERSISTENCE.md`
- **Environment variables:** `_requirements/03-architecture/ENV_VARS.md`
- **Third-party services:** `_requirements/03-architecture/THIRD_PARTY.md`
