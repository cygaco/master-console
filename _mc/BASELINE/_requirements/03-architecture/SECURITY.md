# Pantry Pilot — Security Model

> **v3 (2026-04-23)** — Aligned with `_requirements/04-features/backend/PRD.md` v3. Single-layer thinking is retired; the canonical model is **12-layer defense-in-depth (layers 0–11)**. Obscurity (layer 1) is one layer of many, never standalone. Research findings from the 4-engine deep-research synthesis (2026-04-23) have reshaped layers 0 and 9–11; see per-layer "research" callouts.

---

## Defense-in-depth — the 12 layers

| # | Layer | What it does | Enforcement |
|---|-------|-------------|-------------|
| **0** | **Authenticated Origin Pulls (mTLS)** | Cloudflare presents a **per-zone custom client certificate** on every origin request. Fly (via Nginx sidecar) verifies the cert fingerprint before routing to Hono. Defeats the "CF-bypass-CF" attack (Certitude / HackerOne #1536299) — an attacker's own CF zone cannot present our per-zone cert. The `Cloudflare-Origin-Secret` header survives as **layer 0b / defense-in-depth secondary**. | Nginx `ssl_verify_client on; ssl_client_certificate /secrets/cf-zone-cert.pem;` |
| **1** | **Obscure hostname** | API lives at `<slug>.<apex>` — not at the predictable `api.pantrypilot.example`. Cosmetic only — slug leaks in CT logs + DevTools by design. Rotation is operationally cheap via the admin-panel Ops section. | DNS + Cloudflare |
| **2** | **Cloudflare edge** | WAF, DDoS, Bot Fight Mode, Always Use HTTPS at edge, Turnstile challenge on anonymous endpoints (PARSE, PROFILE), per-ASN rate limits, **ASN + country blocklist** (Tor exits, known residential-proxy ASNs, flagged datacenter ASNs, configurable country list). **Satellite-ISP ASNs are implicitly allowed** — the team's own origin IP is dynamic, so IP allowlists were infeasible; the blocklist approach is stronger. | Cloudflare rules + Workers |
| **3** | **TLS + HSTS preload** | HTTP→HTTPS upgrade happens at the Cloudflare edge (no unencrypted leg reaches Fly). HSTS max-age ≥1 year + `includeSubDomains` + `preload`; `pantrypilot.example` submitted to hstspreload.org. | Cloudflare "Always Use HTTPS" + response headers |
| **4** | **Origin / Referer allowlist** | Every request validated against `ALLOWED_ORIGINS`. | Hono middleware |
| **5** | **Session nonce + CSRF** | `X-Session-Nonce` UUID **bound to a server-side session record** — tightened from v2's format-only check. | Hono middleware + Redis |
| **6** | **Auth + scopes** | JWT on every non-public route. Scopes: `user`, `admin`, `webhook`, `dev`. **Scopes authoritative in Postgres `admin_users`**, cached in Redis (30s TTL) for lookup speed — **not** embedded in JWT payload. Revocation is immediate. | Hono middleware + Postgres |
| **7** | **Schema validation** | Every body parsed with `zod`; unknown fields rejected; size caps; sanitized error messages (§error handling). | Hono middleware + Zod |
| **8** | **Rate limits, layered** | Per-IP, per-user, per-route, per-ASN (Cloudflare), global, daily budget, **per-account daily QStash message cap** to stop a single account from eating queue capacity. | Upstash `@upstash/ratelimit` |
| **9** | **Audit log (durable)** | Every auth event, billing movement, admin action, Stripe event → **Postgres `audit_log` (authoritative, monthly partitioned, nightly R2 archive with Object Lock)** + Redis `audit:events` stream (ops-UI live-tail only). | Postgres INSERT + Redis XADD in one handler |
| **10** | **Least-surface responses** | Generic error messages; health endpoint returns `{ok:true}` only (no version, no SHA, no build time); **secrets never in logs** (enforced by pino redaction list in CI — §Redaction). | pino config + CI test |
| **11** | **Worker origin verification** | Worker endpoint verifies Upstash-Signature HMAC using `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` on every inbound POST before processing. Signature failure → 401, no Redis/Postgres mutation. Double-rotation lockout guarded by `qstash:last_rotation_deployed_at` Redis flag. | `@upstash/qstash` verify + admin-panel guard |

**Rule:** every new route declares its applicable layers in a JSDoc comment (`@security-layers: [0,2,3,...]`); CI fails the build if the annotation is missing or references an invalid layer ID. Waivers require a `reason` string.

---

## Research-driven hardening notes

### Layer 0 (AOP) — why it replaced the header

**Research finding (F2, verified):** The `Cloudflare-Origin-Secret` header + CF-IP-range allowlist pattern is defeatable by the "CF-bypass-CF" attack (Certitude post; HackerOne #1536299). An attacker registers their own Cloudflare zone pointing at our Fly origin IP, exfiltrates our secret header from a build log or leaked artifact, and their requests now arrive from CF IPs carrying the right header — **the IP allowlist + bearer header both pass**. AOP with a **per-zone custom cert** (NOT the shared Cloudflare origin cert — also vulnerable) is the only mechanism that provides real origin identity.

**Practical note:** no published all-Hono + Fly + AOP example exists as of April 2026. Most production setups use an **Nginx sidecar** in the Fly image that terminates the mTLS handshake, then proxies plaintext to Hono on localhost. See `services/backend/docker/Dockerfile.nginx` + `services/backend/nginx.conf`. The `Cloudflare-Origin-Secret` header survives as layer 0b (defense-in-depth) but is not the gate.

### Layer 9 (Audit log) — why Postgres, not Redis stream

**Research finding (F1, F11):** Upstash Redis explicitly documents Eventual Consistency as the only guarantee and has deprecated Strong Consistency. The Redis stream is **not compliance-grade**; the last stream entries can vanish in a leader failover. For Stripe, auth, billing, and admin events — any event touching money, PII, or audit/compliance scrutiny — the authoritative log is Postgres `audit_log` (append-only, partitioned monthly, nightly R2 archive with Object Lock for tamper-evidence). The Redis `audit:events` stream remains only for the admin-panel live-tail UI.

### Layer 11 (Worker origin verification) — why QStash CURRENT/NEXT + lockout guard

**Research finding (F5, verified, verbatim Upstash docs):** "Rolling your keys twice without updating your applications will cause your apps to reject all requests, because both the current and next keys will have been replaced." The admin-panel "Rotate QStash key" button is gated by a `qstash:last_rotation_deployed_at` Redis flag; if missing or >24h old, rotation returns 409 Conflict.

---

## Rate Limiting

Powered by Upstash Redis with sliding window algorithm.

| Endpoint          | Scope              | Limit                 | Key Pattern                |
| ----------------- | ------------------ | --------------------- | -------------------------- |
| `/claude`         | Per-IP             | 20/min                | `rl:ip:{ip}`               |
| `/claude`         | Per-user           | 60/min (if auth'd)    | `rl:user:{userId}`         |
| `/claude`         | Global             | 60/min                | `rl:global`                |
| `/claude` (anon)  | Per-ASN (CF)       | 100/min               | Cloudflare rule            |
| `/recipes/fetch`  | Per-IP             | 10/min                | `rl:recipes:ip:{ip}`       |
| `/shopping/outcomes` | Per-user        | 100/min               | `rl:outcomes:user:{userId}`|
| `/extension`      | Per-IP             | 5/hr                  | `rl:ext:ip:{ip}`           |
| All endpoints     | Daily requests     | 500                   | `budget:{YYYY-MM-DD}`      |
| All endpoints     | Daily tokens       | 2,000,000             | `budget:{YYYY-MM-DD}`      |
| `/recipes/fetch`  | Daily triggers     | 100                   | `budget:recipes:{YYYY-MM-DD}` |
| QStash messages   | Per-account        | 500/day (configurable)| `budget:qstash:{userId}:{YYYY-MM-DD}` |

---

## CSRF / Origin Validation

Layer 4. Every API request's `Origin` and `Referer` headers are validated against `ALLOWED_ORIGINS`. Requests without valid origin are rejected. Development mode may relax this.

---

## Session Nonce

Layer 5. UUID generated once per page load on the client, sent as `X-Session-Nonce` on every `/claude` call. **v3 change:** the server now **binds the nonce to a session record in Redis** (tightened from v2's format-only check). Unknown nonces (valid format but no server-side binding) are rejected 401.

---

## Authentication

### JWT-based (Layer 6)

- Session tokens stored in **HTTP-only cookies on the apex** (`.pantrypilot.example`), with **`__Host-` prefix preferred** where subdomain sharing isn't required.
- SameSite=Lax (Strict breaks OAuth callback flows).
- `verifyJWT(token)` validates signature + expiry; returns `{ sub: userId, ... }` — **no scope embedded**. Scope is fetched from Postgres `admin_users` + Redis cache.
- Rotation: two HMAC keys live (current + previous), accept JWTs signed with either, rotate by issuing new JWTs with the new key for 24–48h, then retire previous key.

### Auth Flow

1. User clicks Sign In → AuthModal opens
2. OAuth redirect to provider (Google/Apple) — state cookie, 10min TTL, PKCE for Google
3. Callback → server validates state → issues JWT cookie on apex
4. `?auth=success` URL param → client re-checks `/auth/me`
5. JWT cookie sent automatically on all subsequent requests

### Admin auth (WebAuthn — §8.9 backend PRD)

**Three independent controls, all required:**

1. **Scope gate** — JWT carries session, scope fetched from Postgres on every request.
2. **WebAuthn passkey** — admin routes require a recent assertion (30 min read freshness, <2 min write freshness bound to action digest).
3. **Cloudflare ASN/country blocklist** — edge-layer filter; blocks known-bad ASNs.

**Recovery (mandatory):**

- Minimum 2 passkeys per admin, enforced at write-action level.
- 10 Argon2id-hashed one-time recovery codes in Postgres `admin_recovery_codes` (NOT Redis — needs to survive a Redis failover per F1).
- No email magic-link fallback (would undo phishing resistance).
- Full break-glass: Shamir-shared secret with trusted contacts → post-MVP.

### Bootstrap

Admin scope is granted via one-time Fly SSH seed script. No API endpoint sets admin scope. First passkey + recovery codes enroll via a bootstrap flow that requires the admin row to already exist in Postgres.

---

## Prompt Injection Defense (§8.17 backend PRD)

### External data tagging (unchanged)

All recipe listing data from Recipe Data Co is wrapped in `<untrusted_recipe_data nonce="...">...</untrusted_recipe_data>` before reaching Claude. 16-character random hex nonce per prompt; Claude prompts include `PROMPT_RULES` preamble instructing it to treat this data as untrusted.

### Blast-radius containment (v3 addition — F7)

**Research finding:** Even with nonce wrapping, Anthropic's Gray Swan benchmarks show 1.4% direct-injection success on Claude Opus 4.5, 10.8% on Sonnet 4.5, ~50% on indirect via user-uploaded documents. `wrapUntrustedData()` is necessary but not sufficient.

Additional controls:

- **Scoped Redis token for the worker.** Worker gets Upstash per-key ACL token — cannot touch ledger (Postgres), scope cache, or admin keys.
- **Claude output = action proposals, not direct execution.** Worker parses Claude response, validates against Zod schemas, routes to main API for authorization. No direct Stripe writes / ledger writes / household-wide notifications from Claude output.
- **Audit every Claude input + output** to Postgres `audit_log` (for forensics when injection succeeds).
- **Optional second-pass classifier (Haiku 4.5)** on Claude's output for high-privilege actions (meal-plan generation, shared-list publish).

### `wrapUntrustedData()` contract

Lives in `packages/shared/prompts.ts` (v3 — migrated from `src/lib/prompts.ts`). CI lint rejects direct `anthropic.messages.create()` calls in worker code that are not preceded by `wrapUntrustedData()` on the external-data path.

---

## API Key Security

| Key                        | Location        | Client Access | Scope |
| -------------------------- | --------------- | ------------- | ----- |
| `ANTHROPIC_API_KEY`        | Fly secret only | Never         | Account |
| `RECIPEDATA_API_KEY`       | Fly secret only | Never         | Account |
| `UPSTASH_REDIS_REST_TOKEN` | Fly secret only | Never         | **Master — API process only** |
| Worker Upstash token       | Fly secret only | Never         | **Scoped per-key ACL (F7)** — cannot touch ledger/scope/admin keys |
| `DATABASE_URL`             | Fly secret only | Never         | Role-scoped (api role: ledger, worker role: tickets + audit) |
| `STRIPE_SECRET_KEY`        | Fly secret only | Never         | Account (production vs test mode enforced by `ENVIRONMENT` flag) |
| `CF_ORIGIN_CERT`           | Fly secret only | Never         | Mounted into Nginx sidecar for AOP mTLS |
| `QSTASH_CURRENT_SIGNING_KEY` / `NEXT` | Fly secret only | Never | Double-rotation lockout guarded |
| `R2_ACCESS_KEY_ID` / `SECRET` | Fly secret only | Never        | Scoped to single bucket, object read/write only (no account-level perms) |

API keys are only used in the Hono backend. The client calls `${API_BASE_URL}/*` — backend adds the keys.

---

## Data Encryption

### Client-Side (localStorage)

Unchanged from v2: AES-GCM via Web Crypto API, PBKDF2 100k iterations SHA-256, device-fingerprint-derived key, fresh 12-byte IV per encryption.

### Server-Side

- **Postgres** (financial state + audit): TLS in transit, Fly-managed at-rest encryption.
- **Upstash Redis** (ops cache): TLS in transit, Upstash-managed at-rest encryption. **No additional application-level encryption.**
- **Cloudflare R2** (blob store): TLS in transit, R2-managed at-rest. Signed URLs with ≤15-min TTL delivered only to the authenticated ticket owner. Bucket is private; no public ACL.

---

## Input Validation

Layer 7. Every request body parsed with Zod. Unknown fields rejected. Size caps:

- `/claude` message: max 50,000 chars
- `/session` body: max 2MB
- `/shopping/outcomes`: max 100 outcomes per request
- `/claude/chain` prompt chain: max 10 steps
- Error responses via `safeErrorMessage()`: code + short message + requestId only. No stack, no file path, no internal ID.

---

## Anonymous Endpoint Hardening (v3 — F10)

**v2 flagged** anonymous PARSE/PROFILE endpoints as "accepted risk" (rate-limit only). **v3 upgrades to MVP requirement:**

- **Cloudflare Turnstile** (invisible CAPTCHA, free tier) on first anonymous call per browser session.
- **Per-ASN rate limit** at Cloudflare (groups by Autonomous System Number, not IP — a botnet of 10k residential proxies can't trivially dodge this).
- **Proof-of-work challenge fallback** if ASN is flagged as datacenter/proxy.
- **ASN blocklist** for known-bad sources (see Layer 2 above).

**Net effect:** a 10k-IP residential-proxy botnet that could previously drain the daily token budget in ~8 minutes is now challenged at the edge on first anonymous hit and rate-limited per-ASN.

---

## Stripe Webhook Idempotency (v3 — three-state, Postgres-backed)

Lua-CAS pattern in Redis replaced by Postgres transactional semantics (F1):

- Three-state: `queued → processing → done` stored in Postgres `stripe_webhook_idempotency` table.
- Stale-claim steal at 60s: if a row has been in `processing` for >60s, next delivery steals the claim (attacker cannot lock us out permanently via a crash).
- Side-effects (ledger insert, `applyPlanChange()`) happen **inside the same Postgres transaction** — guarantees atomicity across the rows.
- `cron.stuck-processing-sweep` runs every minute; any row stuck in `processing` >5 min (e.g., after a worker crash) is re-processed.
- Every Stripe event and its handling is audit-logged (type `STRIPE_WEBHOOK`).

---

## Redaction Contract

Pino is configured with a redaction list scrubbing:

- Headers: `authorization`, `cookie`, `x-session-nonce`, `stripe-signature`, `upstash-signature`
- JWT strings (regex: three base64url segments separated by dots)
- Signed URLs (regex: `*.r2.cloudflarestorage.com` paths with signature params)
- Any field named `key`, `token`, `secret`, `password`, `apiKey`

CI test asserts: a synthetic request containing each pattern produces log output with `[Redacted]` in place of the value.

In production, `/admin/*` and `/stripe/webhook` log at `WARN` or higher to prevent raw-body logging.

---

## Plan Usage Limits

Daily usage cap: **200 catalog fetches/day per authenticated household**, enforced server-side via Postgres counter with 24h window reset. Prevents automation or compromised sessions from consuming a household's whole monthly allowance in an afternoon.

---

## Compliance Rules

1. **Never auto-place grocery orders** — extension pauses for user approval before every checkout. Compliance-critical.
2. **API keys server-side only** — never exposed to client bundle. (The v2 `NEXT_PUBLIC_DUMMY_PLUG_CODE` gate is **removed** in v3 per backend PRD §16 decision 16.)
3. **Rate limiting on all endpoints** — per-IP, per-user, per-ASN, global, daily budget.
4. **Encrypted at rest** — client localStorage AES-GCM; server TLS + managed at-rest.
5. **User data control** — export, import, delete via `/session` DELETE + PrivacyModal.
6. **No third-party data sharing** — only Recipe Data Co (catalog) and Anthropic (AI).
7. **Prompt injection defense** — nonce-tagged containers + blast-radius containment (§8.17).
8. **Durable audit log** — Stripe, auth, billing, admin events written to Postgres authoritative store + nightly R2 archive with Object Lock.

---

## See also

- **Source of truth for all contracts above:** `_requirements/04-features/backend/PRD.md` (v3, §8.2 for layer details, §8.13–8.18 for research-driven hardening)
- **Route-by-route layer annotations:** `_requirements/03-architecture/API_SURFACE.md`
- **Error recovery patterns:** `_requirements/03-architecture/ERROR_RECOVERY.md`
- **Persistence split (Postgres vs Redis):** `_requirements/03-architecture/PERSISTENCE.md`
