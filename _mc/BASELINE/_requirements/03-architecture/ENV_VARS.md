# Pantry Pilot — Environment Variables

> **v3 (2026-04-23)** — Aligned with `_requirements/04-features/backend/PRD.md` v3. Backend env vars now live on Fly (secrets), not Vercel. Frontend keeps only `NEXT_PUBLIC_*` and OAuth callback URLs. The v2 `NEXT_PUBLIC_DUMMY_PLUG_CODE` gate is **deprecated and removed** per backend PRD §16 decision 16.

---

## Where variables live

- **Vercel (frontend):** `NEXT_PUBLIC_*` vars + `NEXT_PUBLIC_API_BASE_URL`. That's it. Everything else has moved to Fly secrets.
- **Fly (backend):** All backend secrets — API keys, DB connection, AOP cert, QStash signing keys, R2 credentials, etc.
- **Fly (staging app):** Same variables, different values. Stripe test-mode keys always in staging; production keys never.

**CI enforcement:** GitHub Actions reads `ENVIRONMENT=staging` or `=production` and fails the deploy if production secrets (Stripe live key, prod DATABASE_URL) are accessible from the wrong environment.

---

## Required — Frontend (Vercel)

| Variable                      | Purpose                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`    | Backend origin (e.g. `https://<slug>.pantrypilot.example`). Empty string = legacy `/api/*` same-origin routes during rollback window. |
| `NEXT_PUBLIC_APP_URL`         | App URL for OAuth callback construction                                         |
| `NEXT_PUBLIC_OAUTH_GOOGLE`    | Show Google OAuth button in auth modals (any truthy value)                      |
| `NEXT_PUBLIC_OAUTH_APPLE`     | Show Apple OAuth button in auth modals (any truthy value)                       |

**Client bundle rule:** only `NEXT_PUBLIC_*` vars ship to the client. All secrets remain server-side only. The v2 `NEXT_PUBLIC_DUMMY_PLUG_CODE` bypass is **gone** — admin/dev access is gated server-side via `ENABLE_DEV_TOOLS` + admin-scope JWT.

---

## Required — Backend (Fly secrets)

### Core services

| Variable                       | Purpose                                          | Used By                                |
| ------------------------------ | ------------------------------------------------ | -------------------------------------- |
| `ANTHROPIC_API_KEY`            | Claude API authentication                        | `/claude`, `/claude/chain`, worker     |
| `RECIPE_INDEX_API_KEY`         | Recipe Index provider authentication             | `/recipes/search` (worker-side)        |
| `UPSTASH_REDIS_REST_URL`       | Redis connection URL                             | Rate limits, cache, scope cache        |
| `UPSTASH_REDIS_REST_TOKEN`     | Redis master token (API process)                 | `/claude`, `/usage/*`, `/session`      |
| `UPSTASH_REDIS_WORKER_TOKEN`   | **Scoped ACL token for worker (research F7)**    | Worker process only; cannot touch ledger/scope/admin keys |
| `DATABASE_URL`                 | Postgres connection string                       | Ledger, Stripe idempotency, audit log  |
| `DATABASE_URL_WORKER`          | Worker-scoped Postgres role (tickets + audit only) | Worker process                       |
| `ALLOWED_ORIGINS`              | Comma-separated allowed origins for CSRF         | All backend routes                     |
| `JWT_SECRET`                   | JWT signing key (current)                        | `/auth/*`, session management          |
| `JWT_SECRET_PREVIOUS`          | Rotating: accept JWTs signed with previous key   | JWT verification during rotation window |
| `ENVIRONMENT`                  | `staging` or `production`                        | CI + runtime environment gating        |

### Cloudflare + AOP

| Variable                       | Purpose                                          | Used By                                |
| ------------------------------ | ------------------------------------------------ | -------------------------------------- |
| `CF_AOP_CERT_FINGERPRINT`      | SHA-256 fingerprint of per-zone client cert      | Nginx sidecar ssl_verify_client        |
| `CF_ORIGIN_CERT_PATH`          | Path to mounted AOP cert (`/secrets/cf-zone-cert.pem`) | Nginx config                     |
| `CLOUDFLARE_ORIGIN_SECRET`     | Shared secret header (layer 0b / defense-in-depth only) | Hono middleware post-Nginx       |
| `CF_TURNSTILE_SECRET_KEY`      | Server-side Turnstile siteverify                 | `/claude` PARSE / PROFILE paths        |
| `NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY` | Client-side Turnstile widget (frontend)     | Frontend only                           |

### QStash

| Variable                         | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `QSTASH_URL`                     | Upstash QStash publish endpoint                         |
| `QSTASH_TOKEN`                   | Publish-side token                                      |
| `QSTASH_CURRENT_SIGNING_KEY`     | HMAC verification key (current)                         |
| `QSTASH_NEXT_SIGNING_KEY`        | HMAC verification key (next, during rotation)           |

### R2 (blob store)

| Variable                      | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `R2_ACCOUNT_ID`               | Cloudflare account ID                         |
| `R2_ACCESS_KEY_ID`            | R2 API key (scoped to single bucket)          |
| `R2_SECRET_ACCESS_KEY`        | R2 API secret                                 |
| `R2_BUCKET_NAME`              | Bucket name (e.g., `pantrypilot-results`)     |
| `R2_SIGNED_URL_TTL_SECONDS`   | Signed URL TTL (default 900 = 15 min)         |

### WebAuthn + admin

| Variable                                 | Purpose                                            |
| ---------------------------------------- | -------------------------------------------------- |
| `WEBAUTHN_RP_ID`                         | Relying Party ID (`pantrypilot.example`)           |
| `WEBAUTHN_RP_NAME`                       | Relying Party display name                         |
| `WEBAUTHN_ORIGIN`                        | Expected origin (`https://<slug>.pantrypilot.example`) |
| `ADMIN_RECOVERY_CODE_ARGON2_MEMORY`      | Argon2id memory parameter (default 64MB)           |
| `GRAPHILE_WORKER_CONCURRENCY`            | Worker concurrency (default 5)                     |
| `LEGACY_ROUTES_ENABLED`                  | Boolean (default false). Gates 7-day rollback window on legacy `/api/*` routes. |
| `ENABLE_DEV_TOOLS`                       | Boolean (default false). Replaces `NEXT_PUBLIC_DUMMY_PLUG_CODE` as the DM/test gate. Server-only; never in client bundle. |

---

## Auth OAuth (Optional — OAuth buttons hidden if vars not set)

| Variable                 | Purpose                      | Used By                        |
| ------------------------ | ---------------------------- | ------------------------------ |
| `GOOGLE_CLIENT_ID`       | Google OAuth client ID       | `/auth/oauth/google`            |
| `GOOGLE_CLIENT_SECRET`   | Google OAuth client secret   | `/auth/oauth/google`, callback  |
| `APPLE_CLIENT_ID`        | Apple OAuth client ID        | `/auth/oauth/apple`             |
| `APPLE_CLIENT_SECRET`    | Apple OAuth client secret    | `/auth/oauth/apple`, callback   |

---

## Stripe (Optional — plan upgrades disabled if not set)

| Variable                        | Purpose                                 | Used By                         |
| ------------------------------- | --------------------------------------- | ------------------------------- |
| `STRIPE_SECRET_KEY`             | Stripe API authentication (test or live, per `ENVIRONMENT`) | `/stripe/checkout`, webhook |
| `STRIPE_WEBHOOK_SECRET`         | Stripe webhook signature verify         | `/stripe/webhook`               |
| `STRIPE_PRICE_PLUS_MONTHLY`     | Price ID for the Plus plan ($5/month)   | `/stripe/checkout`              |
| `STRIPE_PRICE_FAMILY_MONTHLY`   | Price ID for the Family plan ($9/month) | `/stripe/checkout`              |
| `STRIPE_PORTAL_CONFIG_ID`       | Billing-portal configuration for plan changes / cancellation | `/stripe/checkout` |

**Staging enforcement:** `STRIPE_SECRET_KEY` in staging Fly secrets must begin with `sk_test_`; CI deploy step asserts this.

---

## Optional — Backend defaults

| Variable                       | Purpose                               | Default                    |
| ------------------------------ | ------------------------------------- | -------------------------- |
| `RECIPE_INDEX_DATASET_ID`      | Recipe Index dataset identifier       | `ri_lpfll7v5hcqtkxl6l`     |
| `CLAUDE_MODEL`                 | Claude model                          | `claude-sonnet-4-6`        |
| `CLAUDE_MODEL_CLASSIFIER`      | Optional second-pass classifier model | `claude-haiku-4-5-20251001`|
| `ANTHROPIC_PROMPT_CACHE_ENABLED` | Enable cache_control block in calls | `true`                     |
| `DAILY_INDEX_REQUEST_LIMIT`    | Max Recipe Index triggers per day     | `100`                      |
| `DAILY_REQUEST_LIMIT`          | Max Claude requests per day           | `500`                      |
| `DAILY_TOKEN_LIMIT`            | Max Claude output tokens per day      | `2,000,000`                |
| `DAILY_QSTASH_MESSAGES_PER_ACCOUNT` | Per-account QStash cap           | `100`                      |
| `FREE_TIER_WEEKLY_MEALS`       | Planned meals per week on the Free plan | `3`                      |

**Removed:** `NEXT_PUBLIC_DUMMY_PLUG_CODE` and `ENABLE_TEST_API` are deprecated. Replaced by server-only `ENABLE_DEV_TOOLS`. `ADMIN_SECRET` is replaced by admin-scope JWT + WebAuthn.

---

## Staging vs Production

Both environments run the same Fly image; only secret values differ.

| Concern                      | Staging                                    | Production                                      |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `ENVIRONMENT`                | `staging`                                  | `production`                                    |
| Stripe keys                  | `sk_test_*` / `whsec_test_*`               | `sk_live_*` / `whsec_live_*`                    |
| Upstash Redis                | Separate project                           | Production project                              |
| Fly Postgres                 | Separate app `pantrypilot-pg-staging`      | `pantrypilot-pg`                                |
| QStash signing keys          | Separate pair                              | Production pair                                 |
| CF AOP cert                  | Separate per-zone cert                     | Production per-zone cert                        |
| GitHub Actions access        | Production secrets never in staging runners| Production runners separate                      |

**CI gate:** every deploy step reads `ENVIRONMENT` and asserts secret prefixes match (`sk_test_*` for staging, `sk_live_*` for production). Cross-contamination fails the deploy.

---

## Rotation

| Secret                          | Rotation cadence        | Procedure                                                                   |
| ------------------------------- | ----------------------- | --------------------------------------------------------------------------- |
| JWT_SECRET                      | 90 days                 | Keep 2 keys live (current + previous); rotate by issuing with new key for 48h, then retire previous |
| QSTASH_CURRENT/NEXT_SIGNING_KEY | 90 days                 | Rotate one at a time. **`qstash:last_rotation_deployed_at` flag required** to guard against double-rotation lockout (F5) |
| CF AOP cert                     | Annual (pre-expiry)     | Runbook at `ops/runbooks/rotate-aop-cert.md`                                |
| Obscure subdomain slug          | On breach signals       | Runbook at `ops/runbooks/rotate-slug.md`; triggered from admin-panel Ops    |
| R2 access key                   | 90 days                 | Generate new key → update Fly secret → redeploy → revoke old key            |
| Upstash master tokens           | 90 days                 | Rotate in Upstash dashboard → update Fly secret                             |
| Stripe webhook secret           | On signing cert rotation| Rotate in Stripe dashboard → update Fly secret                              |

---

## See also

- **Source of truth for contracts using these vars:** `_requirements/04-features/backend/PRD.md` (v3)
- **Where each secret gets applied (route-by-route):** `_requirements/03-architecture/API_SURFACE.md`
- **Third-party service details:** `_requirements/03-architecture/THIRD_PARTY.md`
- **Rotation runbooks:** `ops/runbooks/` (rotate-slug.md, rotate-aop-cert.md)
