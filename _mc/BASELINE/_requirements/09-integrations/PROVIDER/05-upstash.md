# Upstash — Redis + Rate Limit

**Sources:**
- https://upstash.com/docs/redis/overall/getstarted
- https://upstash.com/docs/oss/sdks/ts/ratelimit/gettingstarted

Last verified: 2026-04-28.

## Packages

| Package | Version | Purpose |
|---|---|---|
| `@upstash/redis` | `^1.37.0` | Serverless Redis HTTP client |
| `@upstash/ratelimit` | `^2.0.8` | Sliding window / token bucket rate limiting on top of Redis |

## Where wired

| Site | File | Purpose |
|---|---|---|
| Session sync | `src/lib/storage.ts` (lines ~274-300) | `GET /api/session` and `POST /api/session` — sync encrypted SessionData blob between localStorage and Redis (last-write-wins via timestamps line 354) |
| Rate limit fallback | `src/lib/rate-limit-fallback.ts` | Local fallback if Redis is unreachable (fail-open with audit log) |
| API rate limit | `src/lib/api-rate-limit.ts` | Per-user / per-route rate limiting for `/api/*` routes |
| Ops UI cache (planned) | `services/backend/src/lib/redis.ts` | Live-tail usage ledger stream, OAuth state nonces |

## Env vars

| Var | Surface | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Frontend + Backend | HTTP endpoint for Redis |
| `UPSTASH_REDIS_REST_TOKEN` | Frontend + Backend | Auth token (read+write) |

Optional separate read-only token if needed for client-side reads without write privileges (not currently used).

## Project conventions

- **Redis is NOT the ledger** (per `_requirements/04-features/backend/PRD.md` v3 §8.13 split rationale). Postgres is the source of truth for the usage economy. Redis carries:
  - `usage:ledger:{userId}` live-tail stream (ops UI only, eventually consistent with Postgres)
  - Rate-limit counters
  - Scope cache (read-through from Postgres `admin_users`)
  - OAuth state nonces (CSRF)
  - Idempotency-Key dedup (5-minute TTL: `idempotency:{userId}:{key}`)
- **Last-write-wins** for session sync: timestamp comparison in `storage.ts:354-356`.
- **Fail-open** for rate limits when Redis unreachable: log to audit, allow request. Better UX than blocking on a transient outage.
- **Migration path:** anonymous users keep operating local-only. First successful auth triggers `migrateToRedis()` (rename to `migrateToServer()` once Postgres lands per user-data plan) which moves localStorage data to server.

## Known issues

- Rate-limit fallback (`rate-limit-fallback.ts`) is fail-open — confirm CI smokes the Redis-down code path so the fallback isn't silently broken.
- Upstash REST has higher latency than direct TCP Redis (extra HTTP overhead per call) — fine for our usage pattern (low QPS per user) but not suitable for high-throughput hot loops.

## Failure modes

| Failure | Behavior |
|---|---|
| Redis down | Rate limit fails open + audit log. OAuth state falls back to signed-cookie nonce. Session sync returns 503; client retains localStorage and retries with exponential backoff. |
| Token leak | Rotate via Upstash console → update env on Fly + Vercel → restart. |
| TTL expired before idempotency check | Rare (5-min window); if it happens, second request creates a new ticket — debit-twice protection then comes from Postgres unique constraint on (user_id, request_id). |
