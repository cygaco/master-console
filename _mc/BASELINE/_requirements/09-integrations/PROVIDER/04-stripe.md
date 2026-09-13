# Stripe — Payments, Webhooks, Idempotency

**Sources** (re-fetch when API changes):
- https://stripe.com/docs/api
- https://stripe.com/docs/payments/checkout
- https://stripe.com/docs/webhooks/best-practices

Last verified: 2026-04-28.

## Package

`stripe@^20.4.1` — server-side Node SDK.
Frontend: no `@stripe/stripe-js` yet (Hosted Checkout doesn't require it for the redirect flow).

## Where wired

| Site | File | Purpose |
|---|---|---|
| Config probe | `src/app/api/stripe/config/route.ts` | `GET /api/stripe/config` returns `{ configured: boolean }` based on env presence — never exposes secrets |
| Checkout (planned) | `src/app/api/stripe/checkout/route.ts` | Proxy to backend `/stripe/checkout` for hosted Checkout session creation |
| Webhook (planned) | `services/backend/src/routes/stripe.ts` | `POST /stripe/webhook` — signature verify + 3-state idempotency + transactional ledger insert |
| Backend client | `services/backend/src/lib/stripe.ts` (planned) | Single Stripe SDK instance |

## Env vars

| Var | Surface | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | Backend (Fly) | Server-side API auth |
| `STRIPE_WEBHOOK_SECRET` | Backend (Fly) | HMAC verification for incoming webhook |
| `STRIPE_PRICE_PLUS_MONTHLY` | Backend (Fly) | Price ID for the Plus plan ($5/month) |
| `STRIPE_PRICE_FAMILY_MONTHLY` | Backend (Fly) | Price ID for the Family plan ($9/month) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Frontend (Vercel) | Only if/when Elements is added; not required for Hosted Checkout |

The `/api/stripe/config` endpoint reports `configured: true` only when all required vars are present — keeps the UI from showing pay buttons that would 500.

## Project conventions

- **Hosted Checkout, not Elements.** Zero PCI-DSS surface. Stripe-hosted UI handles 3DS, wallets, disputes. The frontend only redirects.
- **3-state webhook idempotency** via Postgres `stripe_events` table: `pending → applied → failed`, gated by `ON CONFLICT (event_id) DO NOTHING`. See `_requirements/03-architecture/DATA_FLOW.md` (Plan Quota Economy section).
- **Single transaction** for webhook → ledger: `UPDATE stripe_events SET status='applied' WHERE id=$1 AND status='pending' RETURNING *; INSERT INTO usage_ledger; UPDATE usage_balances`. If the UPDATE returns no rows, the event was already processed — return 200 (replay-safe).
- **Metadata convention:** every Checkout session carries `metadata: { userId, planId }` so webhooks can map the event back to a user.
- **Test-mode keys for all preview deploys.** Live keys never leave production environment.

## Plan tiers

| Tier | Weekly quota | Price |
|---|---|---|
| Free | 3 planned meals, 1 list | $0 |
| Plus | Unlimited plans, store lists | $5/month |
| Family | Everything in Plus + shared household | $9/month |

Defined in product code (search for `BILLABLE_PROMPTS` and the `PLAN_TIERS` constants in `src/lib/plans.ts`).

## Known issues

- `STRIPE_WEBHOOK_SECRET` per environment: dev, staging, production all need separate webhook endpoints in the Stripe dashboard. Each generates its own secret. Document in env-vars table per Fly app.
- Stripe Customer Portal (self-serve plan changes and cancellation) is **post-MVP** — current model is Hosted Checkout subscription creation only.

## Failure modes

| Failure | Behavior |
|---|---|
| Webhook signature mismatch | 400 + log + alert. No state mutation. |
| Webhook delayed | Success page polls `GET /api/usage` for ~30s. Ledger is source of truth. |
| Replay (same event_id) | UPDATE returns 0 rows → 200, no double-credit |
| Network error post-Checkout, pre-redirect | User stays on Stripe page; Stripe retries internally. No client-side retry needed. |
