# Pantry Pilot — Data Flow & State Management

> **v3 (2026-04-23)** — Aligned with `_requirements/04-features/backend/PRD.md` v3. Synchronous same-origin `/api/*` flows have moved to the dedicated backend at `${API_BASE_URL}/*`. Long-running operations (Recipe Index fetch, plan chain) use the **ticket model** — the client posts an enqueue request, receives a `ticketId`, and polls `GET /tickets/{id}` for progress/result. Usage ledger is **Postgres-authoritative**; Redis stream is ops-UI cache only.

> **Scope:** Session state structure, data flow between steps, persistence layers. For pipeline stages and error handling, see `PIPELINES.md`. For data contracts between features, see `DATA-CONTRACTS.md`.

> **Source of truth for step ordering:** `_requirements/00-canonical/STEPS.json`. This doc reflects shipped state. Forward-looking changes go in the **Roadmap** section at the bottom.

---

## Central State: SessionData

All user data across all 10 steps lives in a single `SessionData` object. This is the source of truth for the wizard.

### Key Properties

| Category         | Fields                                                          | Set By Step |
| ---------------- | --------------------------------------------------------------- | ----------- |
| **Navigation**   | currentStep, maxStep, schemaVersion                             | System      |
| **Import**       | importRaw, recipeStructured, personal, pantryItems              | 1           |
| **Context**      | context (cooking goal, household stage, etc.)                   | 1–2         |
| **Preferences**  | preferences (budget, store, meal types, deal breakers)          | 2           |
| **Household**    | household (size, diet tags, allergies, equipment)               | 1           |
| **Profile**      | profile (cuisine focus, skill level, staples, gaps, strengths)  | 3           |
| **Search**       | generatedQueries, catalogSource, catalogRaw, queryStats         | 4           |
| **Analysis**     | menuPrepReport, menuAnalysis                                    | 5           |
| **Q&A**          | miningQuestions, miningResults, miningChatMsgs                  | 6           |
| **Categories**   | mealTypes, rankedCategories                                     | 5–6         |
| **Ingredients**  | exclusions                                                      | 7           |
| **Plans**        | masterPlan, generalPlan, targetedPlans                          | 8           |
| **Export**       | groceryExport, formAnswers                                      | 9           |
| **Cart**         | cartData (heuristics, chromePrompt, manualGuide)                | 10          |
| **Tracking**     | exportedLists                                                   | 8           |

---

## State Management Pattern

### No State Library

Pantry Pilot uses React's built-in `useState` in the root `page.tsx` component. State is passed down via props (prop-drilling pattern). There is no Redux, Zustand, or Context API for wizard state.

### State Flow

```
page.tsx (owns SessionData)
  │
  ├─ passes session + callbacks to page composites
  │   ├─ OnboardingPage receives: session, complete(), go()
  │   ├─ PrepPage receives: session, complete(), go()
  │   ├─ PlanPage receives: session, complete(), go()
  │   └─ Step13Cart receives: session, complete(), go()
  │
  └─ page composites pass relevant slices to step components
      └─ Step10Plans receives: session.profile, session.menuAnalysis,
         session.exclusions, session.masterPlan, etc.
```

### State Updates

1. **complete(step, data)**: Merges partial data into SessionData, advances step, triggers save
2. **go(step)**: Navigates to step (snapshots before backward nav), no data merge
3. **reset()**: Clears all session data, returns to step 0

---

## Persistence

### Dual Storage

```
┌─────────────┐     save()      ┌──────────────────────┐
│  SessionData │ ──────────────► │ Encrypted localStorage │  (always)
│  (in memory) │                 └──────────────────────┘
│              │     save()      ┌──────────────────────────┐
│              │ ──────────────► │ POST ${API_BASE}/session │  (if authenticated)
└─────────────┘                 └──────────────────────────┘
```

### Load Priority

1. If authenticated: try server `GET ${API_BASE}/session` first
2. Fallback: decrypt from localStorage
3. If neither: start fresh (step 0)

### Save Triggers

- Every `complete()` call
- Every `go()` call (navigation)
- Explicit save after profile edit

See `PERSISTENCE.md` for encryption details.

---

## Data Flow Through the Wizard

### Step 1 → 3: Onboarding

```
Raw recipe text/file (recipe collection, receipt, or pantry list)
  → POST ${API_BASE_URL}/claude (PARSE prompt) — anonymous endpoint
     ↪ First call per browser triggers Cloudflare Turnstile (invisible; <100ms)
  → RecipeStructured (personal, recipes, pantry items, ingredients)
  → User edits personal info, household, pantry stock
  → POST ${API_BASE_URL}/claude (PROFILE prompt) — anonymous endpoint, Turnstile applies
  → Profile (cuisine focus, skill level, staples, gaps, strengths)
  → User reviews and confirms
```

### Step 4: Search (ticket-based — v3)

```
Profile + Preferences
  → POST ${API_BASE_URL}/claude (QUERY_GEN prompt) — synchronous
  → generatedQueries[] (4–6 recipe search strings)
  → POST ${API_BASE_URL}/recipes/search
     Headers: X-Idempotency-Key (UUID, generated by client; 5min dedup window)
     Body: { queries, store, mealTypes?, diet? }
  → { ticketId, status: "queued" }  — ticket is bound to userId at creation

  ─ (backend side: atomic transactional enqueue)
  ─   BEGIN;
  ─     INSERT INTO usage_ledger (MENU_PREP cost, ticket_id);
  ─     SELECT graphile_worker.add_job('recipes.trigger', {ticketId});
  ─   COMMIT;
  ─   (if Postgres rolls back, ledger + job both absent — no orphan)

  → Client polls GET ${API_BASE_URL}/tickets/{ticketId} every 5s
     (ownership: JWT.sub must match ticket.ownerUserId else 403)
  → Progress updates: stage=INDEX_TRIGGER → INDEX_POLL → INDEX_RESULTS
     step/total reflect worker progress
  → Final: { status: "done", result: { recipes, queryStats, warnings } }
     OR if >256KB: { status: "done", result: { signedUrl, expiresAt } }
  → catalogRaw (recipe results JSON)
```

### Step 5: Analyze (chain-based — v3)

```
catalogRaw + Profile + Preferences
  → preprocessCatalogData() — normalize, truncate to 30K chars (client-side)
  → buildMenuPrepPayload() — compact recipe records, wrap in <untrusted_recipe_data nonce="..."> (shared package)

  → POST ${API_BASE_URL}/claude/chain
     Headers: X-Idempotency-Key
     Body: { promptChain: [{key: "MENU_PREP", message}, {key: "MENU", message: "<uses prior output>"}] }
  → { ticketId, status: "queued" }

  ─ (backend side: Prompt Caching wraps both calls — system prompt + PROMPT_RULES + canonical context cached ephemerally per §8.16)

  → Client polls GET ${API_BASE_URL}/tickets/{ticketId} every 3s
  → Progress: stage=MENU_PREP_INPUT → MENU_PREP_OUTPUT → MENU_INPUT → MENU_OUTPUT
  → Final: { menuPrepReport, menuAnalysis }
  → MenuAnalysis (keywords, mealTypes, costRanges, miningQuestions)
```

### Step 6: Deep-Dive Q&A (Onboarding — shipped state)

```
miningQuestions (from MenuAnalysis, produced during step 5)
  → Step 6 mounts after step 5 completes
  → Presented one at a time in MiningAccordion
  → User answers in chat-like interface
  → miningResults (per-question: answered/unanswered/not-relevant + text)
  → Step 6 completes → advances to step 7 (Ingredients)
```

Per `_requirements/00-canonical/STEPS.json`, Step 6 lives in the onboarding phase. See **Roadmap** section below for planned dashboard relocation (data contract identical; only host surface changes).

### Step 7: Ingredients

```
Profile.staples + MenuAnalysis.keywords + RecipeStructured.ingredients
  → mergeIngredientSources() — deduplicate, stem-match, categorize
  → IngredientEntry[] with sources, frequency, category
  → User toggles include/exclude (allergies, dislikes, already-in-pantry)
  → exclusions (final ingredient selection)
```

### Step 8: Meal Plans (chain + R2 — v3)

```
Profile + MenuAnalysis + miningResults + exclusions
  → POST ${API_BASE_URL}/claude/chain (PLAN_GEN + per-category TARGETED as chained)
  → { ticketId, status: "queued" }

  ─ (backend: worker runs PLAN_GEN → N × TARGETED → N × DOCX build → N × PDF build)
  ─ Result bundle typically 1–5 MB; written to R2 at users/{userId}/tickets/{ticketId}/plans.zip

  → Client polls GET /tickets/{ticketId}
  → Progress: step 1/N (master) → 2/N (general) → 3/N..N+2/N (targeted) → N+3/N (DOCX) → N+4/N (PDF)
  → Final: { status: "done", result: { signedUrl, expiresAt } } — R2 signed URL, ≤15min TTL
  → Client fetches signed URL → binary ZIP → user downloads
```

### Step 9: Grocery Export

```
Profile + Preferences + Household + miningResults + #1 category
  → POST ${API_BASE_URL}/claude (EXPORT prompt) — synchronous, Prompt Caching active
  → groceryExport (list title, aisle sections, quantities, substitutions, staples)
  → formAnswers (household + delivery field/value pairs)
```

### Step 10: Auto-Cart

```
Profile + MealPlan + formAnswers + rankedCategories + exclusions + preferences
  → POST ${API_BASE_URL}/claude (CART prompt) — synchronous, Prompt Caching active
  → heuristics (addIf, skipIf, unknownFieldFramework, substitutionGuidance)
  → manualGuide (searchTerms, addIf, skipIf)

Code-assembled (not AI-generated):
  → buildCartPrompt(session, heuristics, exportedLists)
  → chromePrompt (markdown, ~3000 words)

Extension runtime (per item):
  → Extension fetches heuristics from SessionData (already generated)
  → Extension fills the store's cart form → pauses for user approval (compliance: never auto-checkout)
  → User clicks add → extension posts outcome:
     POST ${API_BASE_URL}/cart/outcomes
     Body: { outcomes: [{ itemId, itemUrl, itemName, store, status, reason?, heuristicVersion, addedAt, ticketId? }] }
  → Backend writes to Postgres cart_outcomes (authoritative) + audit_log + Redis stream (ops-UI)
  → Backend dedup: same {userId, itemUrl, status} within 24h collapses to one row
  → Readiness score reads from Postgres cart_outcomes for user's real add count
```

---

## Cross-Cutting Data Flows

### Readiness Score

Computed client-side from SessionData completeness. Not stored — derived on every render.

Inputs: profile existence, menu analysis, Q&A completion, ingredients curated, plans generated, grocery export generated.

### Plan Quota Economy (Postgres-authoritative — v3)

```
User action (e.g., generate targeted meal plan)
  → Client checks: is this billable? (BILLABLE_PROMPTS list)
  → POST ${API_BASE_URL}/claude includes auth token + X-Idempotency-Key
  → Server (api process): checks Postgres usage_balances for sufficient remaining quota
     If insufficient → 402 { error: "QUOTA_EXCEEDED", remaining, cost }
  → Transactional debit-before-run (for async jobs):
     BEGIN;
       INSERT INTO usage_ledger (user_id, delta: -cost, reason, ticket_id, request_id, stripe_event_id?);
       -- trigger updates usage_balances.balance
       (for async) SELECT graphile_worker.add_job('claude.chain', {ticketId});
     COMMIT;
  → Client updates displayed balance (from GET /usage → includes recentLedger[20])

On job failure (worker):
  → BEGIN;
      INSERT INTO usage_ledger (user_id, delta: +cost, reason: "REFUND:<original-reason>", ticket_id);
      -- trigger restores balance
    COMMIT;

Stripe webhook (subscription change):
  → POST /stripe/webhook → signature verified
  → Three-state idempotency via Postgres stripe_webhook_idempotency table:
     queued → processing → done (atomic transitions)
     ON CONFLICT (event_id) DO NOTHING — replay-safe
  → BEGIN;
       UPDATE stripe_webhook_idempotency SET state = 'processing' WHERE event_id = $1 AND state = 'queued';
       INSERT INTO usage_ledger (user_id, delta: +planQuota, reason: "STRIPE:<session_id>", stripe_event_id: $event_id);
       UPDATE stripe_webhook_idempotency SET state = 'done' WHERE event_id = $1;
     COMMIT;
  → (if crash between processing and done, cron.stuck-processing-sweep re-claims after 5 min)
```

**Note:** Redis is NOT the ledger (v3 change — research F1). Redis retains:
- Ops-UI live-tail stream `usage:ledger:{userId}` (synchronized from Postgres writes but not authoritative)
- Rate-limit counters
- Scope cache (read-through from Postgres admin_users)

**See §8.13 in backend PRD** for the full split rationale.

### Invalidation

```
User navigates backward to step N and changes data
  → System snapshots current data for step N fields
  → User completes step N with new data
  → Compare: did anything change?
  → If changed: clear all downstream fields per INVALIDATION_MAP
  → If unchanged: skip invalidation, re-advance
```

---

## Ticket Lifecycle (v3 — new)

Every async job is represented by a ticket. Lifecycle:

```
  ┌──────────┐      enqueue       ┌──────────┐   worker pulls   ┌──────────┐
  │ (no row) │ ────────────────▶ │  queued  │ ───────────────▶ │ running  │
  └──────────┘                    └──────────┘                  └────┬─────┘
                                                                     │
                                                          ┌──────────┴──────────┐
                                                          ▼                     ▼
                                                   ┌──────────┐         ┌──────────┐
                                                   │   done   │         │  failed  │
                                                   └──────────┘         └──────────┘
```

**Fields:**

```typescript
Ticket {
  id: string            // UUIDv4 external (never expose UUIDv7 timestamps to clients)
  internalId: string    // UUIDv7 for sortable internal audit
  ownerUserId: string   // JWT.sub must match this on every GET /tickets/{id}
  kind: "recipes.search" | "claude.chain" | "plan.build" | ...
  status: "queued" | "running" | "done" | "failed"
  progress: { step: number, total: number, stage: string }  // worker updates
  result?: any | { signedUrl: string, expiresAt: number }   // R2 if >256KB
  error?: { code: string, message: string, requestId: string }  // sanitized via safeErrorMessage()
  idempotencyKey: string  // X-Idempotency-Key from client
  createdAt: Date
  updatedAt: Date
  checkpointedStep?: number   // for crash recovery — worker resumes from here
}
```

**Ownership enforcement:** every poll validates `JWT.sub === ticket.ownerUserId`. Mismatch → 403 with no metadata in response (prevents enumeration).

**Crash recovery:**
- Worker checkpoints progress to Postgres (via Graphile Worker's built-in job state) on every step.
- On QStash redelivery after a crash, worker checks `ticket.checkpointedStep` and resumes from there rather than restarting.
- Tickets stuck in `running` for >2× expected duration → `cron.stuck-ticket-sweep` transitions to `failed` + emits refund ledger entry.

---

## Idempotency Key Handling (v3 — new)

Every ticket-creating endpoint accepts `X-Idempotency-Key: <uuid>` header. Same key within a 5-minute window returns the same ticketId, no second debit, no second enqueue.

**Client-side (src/lib/api.ts):**

```typescript
async function fetchRecipes(queries, store) {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(`${API_BASE}/recipes/search`, {
    method: "POST",
    headers: { "X-Idempotency-Key": idempotencyKey, "Content-Type": "application/json" },
    body: JSON.stringify({ queries, store })
  });
  // On network error retry, same idempotencyKey is reused — backend returns the original ticketId
}
```

**Server-side:**

- Lookup `idempotency:{userId}:{key}` in Redis (5-min TTL)
- If present → return stored ticketId (no debit, no enqueue)
- If absent → transactional insert of idempotency record + ledger debit + job enqueue

**Client abort (RT-017):** if the client closes the TCP connection after the server received the request but before the response was sent, the handler checks `c.req.raw.signal` at each step. If aborted and debit already happened, the handler emits a refund ledger entry and cancels the QStash message.

---

## Job Queue Flow (v3 — new)

```
  API process                    Postgres (Graphile Worker queue)                Worker process
  ───────────                    ─────────────────────────────────                ─────────────

  POST /recipes/search
  debit + add_job ──────────────▶ usage_ledger     graphile_worker.jobs
                                  (atomic)         (payload: {ticketId})

                                                                                 worker polls Graphile Worker
                                                                                 OR QStash HTTP push
                                                                                 (QStash verifies signature — layer 11)

                                                                                 ┌─ BEGIN
                                                                                 │   UPDATE tickets SET status='running', checkpointedStep=0
                                                                                 │   (execute job steps)
                                                                                 │   UPDATE tickets SET progress=..., checkpointedStep=N
                                                                                 │   (wrapUntrustedData for any Recipe Index data)
                                                                                 │   (Prompt Caching on Claude calls)
                                                                                 │   ... (on success) UPDATE tickets SET status='done', result=...
                                                                                 │   (on failure) UPDATE tickets SET status='failed', error=... + refund ledger
                                                                                 └─ COMMIT

  GET /tickets/{id} ◀──────────── poll every 3-10s ─────────────────────────────
  (ownership check)              
```

**Why Graphile Worker for internal enqueue:** the debit + job-add live in a single SQL transaction (`BEGIN; INSERT INTO usage_ledger; SELECT graphile_worker.add_job; COMMIT`), eliminating the dual-write hazard of "debited but never queued." QStash remains in the stack for **egress** (webhooks out to analytics / downstream services), not for internal job dispatch.

**QStash signature verification (Layer 11):** every HTTP push to the worker endpoint verifies Upstash-Signature HMAC using `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` before processing. Failure → 401, no state mutation. Double-rotation lockout guarded via `qstash:last_rotation_deployed_at` Redis flag.

---

## Ledger Updates (v3 — new)

Every movement in the plan-quota economy writes a Postgres row (authoritative) + a Redis stream entry (ops-UI cache):

```
Event                                       Postgres usage_ledger                         Redis stream
─────                                       ─────────────────────                         ────────────
Debit before job                            delta: -cost, reason: "TARGETED:plan-3"      XADD usage:ledger:{userId}
Refund on job failure                       delta: +cost, reason: "REFUND:<original>"   XADD usage:ledger:{userId}
Refund on client abort                      delta: +cost, reason: "ABORT:<original>"    XADD usage:ledger:{userId}
Subscription renewal / upgrade              delta: +planQuota, reason: "STRIPE:..."      XADD usage:ledger:{userId}
Admin grant                                 delta: +amount, reason: "ADMIN:<adminUid>"   XADD audit:events + usage:ledger
Admin reset                                 delta: setTo(amount), reason: "ADMIN_RESET"  XADD audit:events + usage:ledger
```

**Postgres is the source of truth.** GET /usage reads balance + recentLedger[20] from Postgres; if the Redis cache diverges (which it can during a Redis failover — research F1), Postgres wins on next sync.

**Audit visibility:** every admin action additionally writes to the global `audit_log` Postgres table (partitioned monthly) + nightly archive to R2 with Object Lock.

---

## Roadmap

> Forward-looking changes that haven't shipped yet. The sections above describe the **shipped state**.

### Step 6: Deep-Dive Q&A → Dashboard relocation

Currently Step 6 (Deep-Dive Q&A) runs as part of onboarding, immediately after Step 5 (Menu Analysis). The data contract — `miningQuestions` produced in Step 5 → `miningResults` produced in Step 6 — is identical. Planned change: move the host surface from onboarding to the Dashboard, where users can launch Deep-Dive Q&A as an optional tier-jump activity at any time.

**Target flow:**

```
miningQuestions (still produced during onboarding step 5)
  → User finishes onboarding and lands on the Dashboard
  → User clicks "Deep-Dive Q&A" Dashboard activity (optional)
  → Presented one at a time in MiningAccordion (same component)
  → User answers in chat-like interface
  → miningResults (per-question: answered/unanswered/not-relevant + text)
  → User returns to Dashboard at any time
```

**Why:** readiness scoring shouldn't gate on Q&A — it's an enhancement, not a blocker. Moving to Dashboard preserves the data flow while removing the onboarding chokepoint.

**STEPS.json change:** Step 6's `phase` field flips from `"onboarding"` to `"dashboard"`. The component file (`Step6QA.tsx`) stays the same — the host surface (where it's mounted) changes.

### Postgres-first user data (per `user-data-production-plan.md`)

Currently the SessionData JSONB blob lives in Upstash Redis. Phase 1 of the user-data plan migrates this to Postgres (Neon) with Redis as cache only. Auth/payments/quota all become Postgres-authoritative. See `user-data-production-plan.md` for full phasing.

### Per-branch preview deploys

Currently `.github/workflows/backend.yml` deploys only on `main` push. Phase 2 of user-data plan adds `.github/workflows/fly-review.yml` to spawn a Fly review app + Neon branch + Vercel preview env per PR. End-to-end testable previews without merging to main.
