# Pantry Pilot — Third-Party Integrations

> **v3 (2026-04-23)** — Four new integrations added for the backend split: Fly.io (hosting), Cloudflare (edge + WAF + R2 + AOP mTLS), Upstash QStash (job queue egress), Cloudflare R2 (blob store). Anthropic usage gains Prompt Caching requirements per research F14.

---

## Recipe Data Co (Recipe Catalog)

### Overview

| Field      | Value                                                  |
| ---------- | ------------------------------------------------------ |
| Service    | Recipe Data Co — Recipe & Grocery Catalog API          |
| Dataset ID | `rc_7k3np9v2hd4tqx1` (env: `RECIPEDATA_DATASET_ID`)    |
| Mode       | Discovery (keyword-based search)                       |
| Base URL   | `https://api.recipedata.example/datasets/v3`           |
| Auth       | Bearer token (`RECIPEDATA_API_KEY`)                    |

### API Flow

```
1. TRIGGER: POST /datasets/v3/trigger?dataset_id=...&type=discover_new&discover_by=keyword&limit_per_input=50&include_errors=true
   → Returns: { snapshot_id: "sd_..." }

2. POLL: GET /datasets/v3/snapshot/{snapshotId}?format=json
   → 202: Still processing
   → 200 (array): Results ready
   → 200 (object with status): Processing or failed
```

### Input Schema

```json
{
  "keyword": "search query",
  "store_region": "City, State",
  "country": "US",
  "time_range": "",
  "meal_type": "Weeknight",
  "difficulty": "",
  "diet": "Vegetarian",
  "source": "",
  "selective_search": false,
  "ingredients_to_exclude": "",
  "store_radius": ""
}
```

### Valid Values

| Field     | Valid Values (case-sensitive)                                                                  |
| --------- | ------------------------------------------------------------------------------------------------ |
| meal_type | `"Weeknight"`, `"Batch"`, `"Make-ahead"`, `"One-pot"`, `"Freezer"`, `"Slow-cooker"`, `"Other"` |
| diet      | `"Vegetarian"` (capital V) or `""` (empty for no diet filter)                                   |
| country   | `"US"`                                                                                          |

### Output Fields (Flexible Mapping)

RD returns inconsistent field names. Pantry Pilot maps flexibly:

| Our Field     | RD Field(s)                                                                     |
| ------------- | --------------------------------------------------------------------------------- |
| title         | `title` or `recipe_title`                                                         |
| source        | `source` or `source_name`                                                         |
| storeRegion   | `region` or `recipe_region`                                                       |
| description   | `recipe_summary` > `recipe_steps_formatted` (HTML stripped) > `description`       |
| cost          | `cost` (JSON stringified) > `recipe_cost_range` > `base_cost`                     |
| difficulty    | `recipe_difficulty_level`                                                         |
| mealType      | `meal_type` or `recipe_meal_type`                                                 |
| quickAdd      | `is_quick_add` or `quick_add`                                                     |
| url           | `recipe_link` > `recipe_url` > `url`                                              |
| cuisines      | `recipe_cuisines`                                                                 |
| course        | `recipe_course`                                                                   |
| ratingCount   | `recipe_num_ratings`                                                              |
| publishedDate | `recipe_published_date` (first 10 chars → YYYY-MM-DD)                             |

### Known Issues

1. **Whole-batch cost on single servings**: RD structured cost fields contain whole-batch totals even for single-serving recipes. Per-serving costs must be extracted from description text via regex.
2. **Thin non-weeknight data**: Batch, Make-ahead, Freezer, and other non-weeknight types yield significantly fewer results.
3. **Aggregator noise**: Content-farm aggregators publish high volumes across different queries, inflating category counts. Detected by: sources with 3+ listings across different queries.
4. **Rate limiting**: RD has its own rate limits beyond Pantry Pilot's budget. Very rare in practice with current usage levels.

### Per-Serving Cost Extraction

`extractServingCosts()` in `src/lib/utils.ts`:

```
Pattern: $X.XX–$Y.YY/serving (or per serving, /svg, /serving, etc.)
Range: $0.40–$40/serving (outside this range = filtered out)
Context: ±80 characters around match
```

Returns: `{ title, source, cost, context }[]`

---

## Anthropic Claude API (AI Processing)

### Overview

| Field      | Value                                            |
| ---------- | ------------------------------------------------ |
| Service    | Anthropic Messages API                           |
| Endpoint   | `https://api.anthropic.com/v1/messages`          |
| Model      | `claude-sonnet-4-20250514` (env: `CLAUDE_MODEL`) |
| Auth       | `x-api-key` header (`ANTHROPIC_API_KEY`)         |
| Max tokens | 4,096 default, 8,192 max                         |

### Request Format

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "system": "System prompt from PROMPTS[key]",
  "messages": [{ "role": "user", "content": "User message" }]
}
```

### Timeout & Retry

| Parameter               | Value                                |
| ----------------------- | ------------------------------------ |
| Server timeout          | 90 seconds                           |
| Vercel function timeout | 60 seconds (limiting factor)         |
| Client timeout          | 100 seconds                          |
| Client retries          | 2 (for transient: network, 502, 504) |
| Rate limit retry        | Wait `3000ms × (attempt + 1)`        |

### Error Codes

| Status | Meaning      | Pantry Pilot Handling |
| ------ | ------------ | --------------------- |
| 200    | Success      | Extract text content  |
| 429    | Rate limited | Retry with backoff    |
| 500    | Server error | Retry (transient)     |
| 502    | Bad gateway  | Retry (transient)     |
| 504    | Timeout      | Retry (transient)     |
| 400    | Bad request  | Fail (prompt issue)   |
| 401    | Auth error   | Fail (key issue)      |

---

## Upstash Redis (Rate Limiting & Sessions)

### Overview

| Field   | Value                                                 |
| ------- | ----------------------------------------------------- |
| Service | Upstash Redis                                         |
| SDK     | `@upstash/ratelimit`, `@upstash/redis`                |
| Auth    | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` |

### Usage

1. **Rate limiting**: Sliding window algorithm for per-IP and global limits
2. **Daily budgets**: Atomic increment/check for daily request and token counts
3. **Plan state**: `plan:{userId}` key for current tier + remaining weekly quota
4. **Usage tracking**: `usage:{userId}` key for operation counts
5. **Server sessions**: `session:{userId}` key for SessionData (authenticated users)

### Fallback

If Redis is unavailable:

- Rate limiting: In-memory fallback (Map-based, resets on deploy)
- Plan state: In-memory fallback (development only)
- Sessions: Falls back to localStorage only

---

## Stripe (Payments)

### Overview

Used for subscription billing. Integration details:

- Checkout flow: Server creates Stripe Checkout Session → redirect to Stripe → callback
- Return URL: `?plan=success` query param triggers plan-state reload
- Webhook: Verifies Stripe signature for payment confirmation; **three-state idempotency now in Postgres** (v3 — see ERROR_RECOVERY.md Stripe section)
- Products: Free ($0 — 3 planned meals/week, 1 list), Plus ($5/month — unlimited plans, pantry tracking), Family ($9/month — shared household, up to 6 members)
- **v3 staging policy:** production + test-mode keys are separated by the `ENVIRONMENT` flag (staging / production). CI enforces that production keys are never in staging secrets or GitHub Actions.

---

## Fly.io (Backend Hosting — v3)

### Overview

| Field      | Value                                                           |
| ---------- | --------------------------------------------------------------- |
| Service    | Fly Machines                                                    |
| Runtime    | Node 22 LTS                                                     |
| Image      | One multi-stage Dockerfile, two CMD entrypoints (`api`, `worker`) |
| Topology   | Single `fly.toml` with `[processes]` stanza: `api = "node dist/api.js"` + `worker = "node dist/worker.js"` |
| Region     | Primary region closest to user base; no multi-region in MVP     |
| Cost model | Per-active-minute for Machines; stopped machines ~$0/mo         |
| No free tier | Credit card required (as of late 2024)                        |

### Required fly.toml hardening (research F4)

```toml
kill_timeout = 300        # was default 5s — SIGTERM drain needs time
kill_signal = "SIGTERM"   # was default SIGINT
auto_stop_machines = false  # for worker process only — keep warm
```

**Dockerfile must use exec form:** `CMD ["node", "dist/api.js"]` (not `npm start`, not `./start.sh`). Shell wrappers swallow signals → deploy cuts in-flight Claude calls.

### Postgres (Fly)

- Separate Fly app `pantrypilot-pg` (Fly-managed Postgres).
- Connection string via `DATABASE_URL` Fly secret.
- Two DB roles: `api_role` (ledger/session/admin read-write), `worker_role` (tickets + audit write-only).
- Daily backups + point-in-time recovery.
- MVP cost: ~$15-30/mo.

### Cost at scale

| Tier        | API + Worker | Postgres | Notes                            |
| ----------- | ------------ | -------- | -------------------------------- |
| <1k DAU     | $5–15/mo     | $15-30/mo | Idle machines stop; $0 when stopped |
| 10k DAU     | $30–60/mo    | Same     | Egress $0.02/GB NA-EU; watch streaming |

### Origin pinning (AOP mTLS — research F2)

- Cloudflare presents a **per-zone custom client certificate** on every origin request.
- Fly accepts the connection via **Nginx sidecar** in the same image (no published all-Hono+Fly+AOP example as of April 2026).
- Nginx `ssl_verify_client on` + pinned certificate fingerprint → proxy plaintext to Hono on localhost:3000.
- Direct TCP connections to Fly origin (bypassing Cloudflare) → rejected by Nginx.

---

## Cloudflare (Edge, WAF, R2 — v3)

### Overview

| Feature         | Plan         | Notes                                                                      |
| --------------- | ------------ | -------------------------------------------------------------------------- |
| DNS             | Free         | Apex + obscure API subdomain (rotatable via admin-panel Ops)               |
| WAF             | Free         | Rule-based filtering on Bot Fight Mode + custom rules                      |
| DDoS protection | Free         | Unmetered at L3/L4/L7                                                      |
| Bot Fight Mode  | Free         | Blocks known bot signatures; configurable severity                         |
| Always Use HTTPS | Free        | HTTP→HTTPS upgrade at edge (no unencrypted leg reaches Fly)                |
| Turnstile       | Free         | Invisible CAPTCHA on anonymous `/claude` endpoints (PARSE, PROFILE)        |
| HSTS preload    | Free         | `pantrypilot.example` submitted to hstspreload.org                         |
| ASN blocklist   | Free         | Cloudflare firewall rules blocking Tor / residential-proxy / flagged ASNs  |
| Country blocklist | Free       | Rule-based (per-country block if needed)                                   |
| **AOP mTLS**    | Free         | Per-zone custom cert upload; origin verifies fingerprint (research F2)     |
| Geofencing (Pro) | $20/mo      | **Not active in MVP** — per-ASN blocklist on free tier is sufficient       |

### R2 (Blob Store)

| Field            | Value                                                                    |
| ---------------- | ------------------------------------------------------------------------ |
| Bucket           | Private (no public ACL)                                                  |
| Key format       | `{userId}/{ticketId}/result.{ext}` for per-user scoping                  |
| Signed URL TTL   | ≤15 min                                                                  |
| API key scope    | Scoped to single bucket with object read/write only (no account-level)   |
| Object Lock      | Enabled for audit-log archive prefix (`audit-log/YYYY/MM/*.jsonl.gz`)    |
| Egress           | **Free** — huge win vs S3 at scale                                       |

### Turnstile integration

- Frontend includes Turnstile widget (invisible) on AuthModal + recipe-upload page.
- On first anonymous `/claude` call, the frontend attaches the Turnstile token in a `CF-Turnstile-Response` header.
- Backend validates the token with Cloudflare's Siteverify API before processing.
- Upgrades v2's "accepted risk" on anonymous endpoint abuse → MVP requirement.

---

## Upstash QStash (Job Queue — v3)

### Overview

| Field      | Value                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| Purpose    | Egress job queue (internal job queue is Graphile Worker inside Postgres) |
| Delivery   | HTTP push to worker endpoint                                           |
| Signing    | HMAC via `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY`      |
| Free tier  | 500 msg/day                                                            |
| Paid       | Per-message pricing; cap via per-account daily limit                   |

### Worker signature verification (Layer 11)

Every inbound POST to the worker endpoint **MUST** verify `Upstash-Signature` header using `QSTASH_CURRENT_SIGNING_KEY` (and `QSTASH_NEXT_SIGNING_KEY` during rotation windows). Failure → 401, no state mutation. Per backend PRD §16 decision 3.

### Double-rotation lockout (research F5)

Verbatim from Upstash docs: "Rolling your keys twice without updating your applications will cause your apps to reject all requests, because both the current and next keys will have been replaced."

**Guard:** Redis flag `qstash:last_rotation_deployed_at` is set by the deploy pipeline after a rotation. The admin-panel rotate button returns 409 Conflict if the flag is missing or >24h old.

### Redelivery

- Min 30s delay between retries
- Max 3 retries before dead-letter
- Dead-letter lands in Redis stream `qstash:dlq` for admin-panel review

---

## Anthropic Claude API — v3 additions

### Prompt Caching (mandatory from day 1, research F14)

Every Claude call is wrapped in `packages/shared/prompt-caching.ts` which applies `cache_control: {type: "ephemeral"}` on the cached region:

- System prompt
- `PROMPT_RULES` preamble
- Canonical feature context (per prompt key)

Expected input-token cost reduction: ~90% on cached portions. Cache hit rate exposed via `/admin/status` cache_hit_rate; alert fires if <80% over 1 hour.

### Batch API (non-interactive chains)

Async jobs that are not user-interactive (plan generation chain, menu analysis chain) use Anthropic's Batch API for a further 50% discount.

### Security (research F7 — blast-radius containment)

- Worker gets a **scoped Upstash ACL token** that cannot touch ledger, scope cache, or admin keys.
- Claude output is parsed as **action proposals**, validated against Zod schemas, routed to main API for authorization — no direct Stripe writes / no direct ledger writes / no direct household-wide notifications from Claude output.
- All Claude inputs + outputs audit-logged to Postgres `audit_log`.
- Optional second-pass Haiku 4.5 classifier on output for high-privilege actions.
