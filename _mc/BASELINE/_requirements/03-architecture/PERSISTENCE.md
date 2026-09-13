# Pantry Pilot — Persistence Model

> **v3 (2026-04-23)** — Aligned with `_requirements/04-features/backend/PRD.md` v3. Storage is **three-tier**: client-side encrypted localStorage, Postgres (financial + audit + admin, authoritative), and Redis (cache + scratch + rate limits, eventually-consistent). The v2 statement "no traditional database" is overturned in v3 per research F1 — Postgres is now in MVP for any state that must survive a Redis failover.

---

## Overview

- **Encrypted client-side localStorage** — always. Survives offline. Device-fingerprint-derived key. Full SessionData.
- **Postgres (Fly)** — authoritative for financial state, admin identity, durable audit, shopping outcomes. Failover-durable. ACID.
- **Redis (Upstash)** — cache, ticket scratch, rate-limit counters, WebAuthn challenges, scope cache (read-through). Eventually-consistent only — **never the authoritative store for payment-bearing state**.
- **Cloudflare R2** — blob store for oversized results (>256KB) and nightly audit-log archive with Object Lock.

---

## Client-Side: Encrypted localStorage

### Encryption

| Parameter      | Value                                |
| -------------- | ------------------------------------ |
| Algorithm      | AES-GCM                              |
| Key derivation | PBKDF2                               |
| Iterations     | 100,000                              |
| Hash           | SHA-256                              |
| IV             | 12 random bytes (per encryption)     |
| Key material   | Device fingerprint + persistent salt |

### Device Fingerprint

Derived from:

- `navigator.userAgent`
- `navigator.language`
- Screen resolution (`screen.width × screen.height`)
- Color depth
- Timezone
- Hardware concurrency

### Storage Format

```
base64(iv) + "." + base64(ciphertext)
```

Each save generates a fresh IV. The ciphertext contains the JSON-serialized SessionData.

### Size Limits

- localStorage max: ~5MB per origin
- Practical limit for SessionData: well under 5MB (typical session: 200KB–1MB)

---

## Server-Side: Redis Sessions

### When Used

Only for authenticated users. Server sessions are:

- **Saved**: Non-blocking POST to `${API_BASE_URL}/session` after every `complete()` and `go()`
- **Loaded**: On page load, before falling back to localStorage

### Endpoints

| Method | Route                      | Purpose                                   |
| ------ | -------------------------- | ----------------------------------------- |
| GET    | `${API_BASE_URL}/session`  | Load session (requires JWT)               |
| POST   | `${API_BASE_URL}/session`  | Save session (requires JWT, max 2MB body) |
| DELETE | `${API_BASE_URL}/session`  | Clear session (requires JWT)              |

### Storage

Sessions stored in Upstash Redis. Key format: `session:{userId}`. TTL: 30 days (2,592,000 seconds), refreshed on each save. **Session data is UI state — eventual consistency is acceptable.** Financial/audit state lives in Postgres (see below).

---

## Save Triggers

SessionData is persisted to storage after:

1. **Every `complete(step, data)` call** — step completion merges data and saves
2. **Every `go(step)` call** — navigation triggers save (captures current state)
3. **Profile edit** — explicit save after user modifies profile fields
4. **Invalidation** — after clearing downstream data, save the cleaned state

Saves are synchronous to localStorage, non-blocking (fire-and-forget) to server.

---

## Load Sequence

On app initialization:

```
1. Check authentication: GET /api/auth/me
2. If authenticated:
   a. Try GET /api/session (server-side session)
   b. If found: use server data, update localStorage
   c. If not found: fall back to localStorage
3. If not authenticated:
   a. Decrypt and load from localStorage
4. If neither source has data:
   a. Start fresh (step 0, empty SessionData)
5. Validate loaded data: validateSession()
6. Apply schema migrations if needed
```

---

## Session Validation

`validateSession(data)` checks:

| Field             | Validation          |
| ----------------- | ------------------- |
| currentStep       | Integer, 0–10       |
| maxStep           | Integer, 0–10       |
| household         | Object (if present) |
| recipesStructured | Object (if present) |
| profile           | Object (if present) |
| generatedQueries  | Array (if present)  |
| rankedCategories  | Array (if present)  |
| formAnswers       | Array (if present)  |
| recipesRaw        | String, max 500KB   |
| catalogRaw        | String, max 1MB     |

Invalid data is rejected — falls back to the next source or starts fresh.

---

## Schema Migrations

| From → To | Change                                 | Migration                     |
| --------- | -------------------------------------- | ----------------------------- |
| v1 → v2   | Research phase split from 2 to 3 steps | Steps 5+ shifted to 6+        |
| v2 → v3   | Removed StepReport (was step 5)        | Steps 6–12 shift down to 5–11 |

Migrations run automatically on load if `schemaVersion` is outdated.

---

## What Survives a Refresh

Everything. The entire SessionData is persisted after every state change. A page refresh loads from localStorage (instant) or server (if authenticated, slightly delayed).

### What Does NOT Persist

- In-memory pipeline trace buffer (debug only)
- AbortController instances (active API calls)
- UI state: modal open/closed, scroll position, animation state
- Session nonce (regenerated per page load)

---

## Data Export & Import

Via PrivacyModal:

- **Export**: Downloads decrypted SessionData as JSON file
- **Import**: Uploads JSON file, validates, encrypts, saves to localStorage
- **Clear**: Deletes localStorage entry + server session (if authenticated)

---

## Backend Persistence (v3 — new)

Three-store split. **Every value that must survive a Redis failover lives in Postgres.** Redis is for ephemeral/cacheable state only.

### Postgres — authoritative store

| Table                           | Purpose                                                                  | Partitioning       |
| ------------------------------- | ------------------------------------------------------------------------ | ------------------ |
| `billing_ledger`                | Append-only ledger entries: charge, refund, quota grant, Stripe payment  | Monthly            |
| `plan_state`                    | Denormalized current tier + seat count per household; kept in sync by trigger | —              |
| `stripe_webhook_idempotency`    | Three-state (queued / processing / done) for Stripe event replay safety  | —                  |
| `admin_users`                   | User IDs with `admin` scope, plus who granted and when                   | —                  |
| `passkey_credentials`           | WebAuthn credentials: credential_id, public_key, counter, device_name    | —                  |
| `admin_recovery_codes`          | Argon2id-hashed one-time recovery codes (10 per admin)                   | —                  |
| `shopping_outcomes`             | Per-household purchased/skipped/unavailable item records from the extension | Monthly         |
| `audit_log`                     | All auth, billing, admin, Stripe events (durable, compliance-grade)      | Monthly + R2 archive |
| `graphile_worker.jobs`          | Transactional job queue (internal; Graphile Worker library-managed)      | —                  |

**Key guarantees:**
- Every quota consume + job enqueue happens in one `BEGIN; ... COMMIT;` transaction — no dual-write hazards.
- Stripe webhooks use `ON CONFLICT (event_id) DO NOTHING` for replay idempotency.
- Monthly partitions on append-only tables keep index depth manageable; `audit_log` is archived nightly to R2 with Object Lock for tamper-evidence.

### Redis — cache / scratch only

| Key pattern                       | Purpose                                                  | TTL                |
| --------------------------------- | -------------------------------------------------------- | ------------------ |
| `session:{userId}`                | UI SessionData (eventual-consistency acceptable)         | 30 days            |
| `rl:ip:{ip}`, `rl:user:{userId}`  | Sliding-window rate-limit counters                       | window TTL         |
| `budget:{YYYY-MM-DD}`             | Daily request/token budget counters                      | 2 days             |
| `scope:{userId}`                  | Read-through cache of Postgres `admin_users.scope`       | 30 sec             |
| `webauthn:challenge:{userId}`     | Active WebAuthn challenges                               | 5 min              |
| `ticket:{id}`                     | Ticket progress scratch (authoritative is Postgres)      | 24 hours           |
| `idempotency:{userId}:{key}`      | `X-Idempotency-Key` dedup window                         | 5 min              |
| `qstash:last_rotation_deployed_at`| Guard flag for QStash signing-key rotation (F5)          | —                  |
| `billing:ledger:{userId}` (stream)| Ops-UI live-tail cache (Postgres is authoritative)       | `XADD MAXLEN ~ 500000` |
| `audit:events` (stream)           | Ops-UI live-tail of `audit_log` (Postgres authoritative) | `XADD MAXLEN ~ 500000` |

### R2 — blob storage

- Ticket results >256KB: `{userId}/{ticketId}/result.{ext}`, signed URLs ≤15-min TTL, private bucket
- Audit-log archive: `audit-log/YYYY/MM/*.jsonl.gz`, Object Lock enabled (tamper-evidence for compliance)
- Extension ZIP cache: built on demand, not stored

---

## Admin Scope Storage (v3 — new)

**Not in the JWT payload.** Embedded scope in the JWT would mean 7-day revocation lag (JWT expiry).

- Authoritative: Postgres `admin_users(user_id UUID PK, granted_at TIMESTAMPTZ, granted_by UUID)`.
- Cache: Redis `scope:{userId}` with 30-second TTL, read-through on every authenticated request.
- Revocation is immediate: `DELETE FROM admin_users WHERE user_id = $1`, then `DEL scope:{userId}`.
- Bootstrap: one-time `fly ssh console -C "node scripts/seed-admin.js <userId>"` inserts the first row. No API endpoint grants admin scope.

---

## WebAuthn Recovery Codes (v3 — new)

Per research F9, admin lockout is a documented failure class. Every admin has:

- **≥ 2 passkeys enrolled.** Second admin write action blocked until both are registered.
- **10 one-time recovery codes.** Generated at first enrollment, displayed once, stored in Postgres `admin_recovery_codes` as **Argon2id hashes** (not Redis — must survive Redis failover).
- Each code is one-time: redemption marks it consumed + audit-logged.
- No email magic-link fallback (would undo WebAuthn's phishing resistance).

---

## Ticket State Model (v3 — new)

Ticket identity is dual:

- **External id (UUIDv4)** exposed to clients. Never leaks timestamp information.
- **Internal id (UUIDv7)** for sortable audit/admin views only. Never exposed to clients.

Ticket state machine: `queued → running → (done | failed)`. State + progress + checkpoint lives in Postgres (durable); a Redis cache copy exists for fast admin-panel polling. On QStash redelivery after a worker crash, the worker reads `checkpointedStep` from Postgres and resumes rather than restarting.

**Ownership:** `ticket.owner_user_id` is checked on every `GET /tickets/{id}` — mismatch → 403 with no metadata.

**Stuck recovery:** `cron.stuck-ticket-sweep` (every minute) transitions tickets in `running` for >2× expected duration to `failed` + emits a quota-restore ledger entry.

---

## See also

- **Durability rationale (why Postgres was added in v3):** `_requirements/04-features/backend/PRD.md` §8.13
- **Ledger schema details:** `_requirements/04-features/backend/PRD.md` §8.6 (superseded) + §8.13 (canonical)
- **Audit log retention + archival:** `_requirements/04-features/backend/PRD.md` §8.2 layer 9 + §16 decision 29
