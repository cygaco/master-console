# Integration Map (Template)

> **Product-neutral template.** This file documents the SHAPE of an integration map, not any one product. Replace every `<placeholder>`, `<entity>`, `<core-action>`, and `Step N: <step-name>` below with the real values from the product's canon/manifest (`_requirements/00-canonical/STEPS.json`, the product's `SessionData`/types, and the product manifest). Keep the STRUCTURE — per-step writes/reads, the producer/consumer contract table, the cross-cutting integration blocks, the cost table — and parameterize the domain nouns. The worked example uses generic names (`<primary-entity>`, `<core-action>()`, `chargeCredits()`); they are illustrations, never literals to copy verbatim.

Every data dependency between features is documented here. Features communicate through `SessionData` fields, NOT through each other's code. Producer defines the shape. Consumer adapts. Never the reverse.

---

## SessionData Flow — What Each Step Writes and Reads

Enumerate the product's steps in order. For each step list the `SessionData` fields it WRITES, the fields it READS, and any model/API call it makes (with cost). The example below shows two representative steps; mirror this shape for the product's actual step sequence.

### Step 1: `<ingest-step>` (parse the primary input)

**Writes:**

- `<primaryInputRaw>: string` (the raw ingested artifact)
- `<primaryInputStructured>: <PrimaryInputStructured>`
- `<entityA>: <EntityA>`
- `<entityB>: <EntityB>[]`

**Reads:** Previous session (if resuming)

**Model call:** `callModel("<PARSE_TASK>", <primaryInputRaw>)` → cost: `<n>`

---

### Step N: `<derive-step>` (derive structured output)

**Writes:**

- `<derivedEntity>: <DerivedEntity>` (the step's primary output object)

**Reads:** `<primaryInputStructured>`, `<entityA>`, `<entityB>`

**Model call:** `callModel("<DERIVE_TASK>", { <inputs...> })` → cost: `<n>`
**API call (if any):** `<fetchExternalData>(<args>)` → external provider

---

> Continue for each remaining step. A step that hands off to an external surface (browser extension, third-party automation) should be marked "prepare and hand off" — the orchestrator prepares the data but cannot observe or control what happens downstream.

---

## Producer/Consumer Contracts

One row per cross-feature contract. The PRODUCER step writes the field; the CONSUMER steps read it. Every consumer adapts to the producer's shape — never the reverse.

| #   | Producer            | Consumer              | Contract Field            | Type                       |
| --- | ------------------- | --------------------- | ------------------------- | -------------------------- |
| 1   | Step 1 (`<ingest>`) | Steps 2..N            | `<primaryInputStructured>`| `<PrimaryInputStructured>` |
| 2   | Step 1 (`<ingest>`) | `<consumer steps>`    | `<entityA>`               | `<EntityA>`                |
| 3   | Step k (`<derive>`) | `<consumer steps>`    | `<derivedEntity>`         | `<DerivedEntity>`          |
| ... | ...                 | ...                   | ...                       | ...                        |

**CRITICAL:** Every `complete(step, data)` call must include ALL fields listed in the WRITES column for that step. Omitting a field (even one not displayed on screen) breaks downstream steps — this is a recurring P0 class.

---

## Cross-Cutting Integration

### Auth → All API Routes

```
Contract: requireAuth() middleware, verifyJWT(), getSession()
Producer: auth feature
Consumer: every API route that accesses user data
Rule: All billable API routes MUST call requireAuth(). Auth exports, others import.
```

### Billing → Model API Route

```
Contract: chargeCredits(userId, operation) — the product's billing pre-flight —
          called before billable model calls
Producer: billing feature (the product's billing/credit module)
Consumer: the model-call API route
Rule: API route checks balance, charges, then calls the model. Returns 402 if insufficient.
```

### `<derived-score>` → Step UIs (read-only consumption)

```
Contract: <computeScore>(sessionData) → numeric score
Producer: <scoring> feature
Consumer: the step UIs that display the score
Rule: Read-only consumption. Step UIs display the score, never modify scoring logic.
```

> Add one block per cross-cutting concern in the product (auth, billing, scoring, search/indexing, notifications, etc.). Each names a Contract, Producer, Consumer, and Rule.

### Foundation Utilities Used By Multiple Features

**Wire format:** The server model-call route returns a JSON envelope (e.g. `{ text: "..." }`); the client helper (e.g. `callModel()`) already handles extraction. Builders MUST use the shared helper — do NOT call the API route directly or parse the response yourself.

| Utility            | File         | Used by                                   |
| ------------------ | ------------ | ----------------------------------------- |
| `callModel()`      | `api.ts`     | `<features that call the model>`          |
| `<fetchExternal>()`| `api.ts`     | `<features needing external data>`        |
| `<sharedHelpers>`  | `utils.ts`   | `<consuming features>`                    |
| `tracePipeline()`  | `pipeline.ts`| `<features needing step tracing>`         |
| `chargeCredits()`  | billing module | billing, the model-call API route       |

---

## Cost Summary

One row per billable operation: the operation, the model task/prompt key it maps to, its cost, and the owning feature. Pull the real cost allocation from the product's config (e.g. `.mc/config.json` or the product manifest) rather than hardcoding it here.

| Operation        | Task Key       | Cost  | Feature        |
| ---------------- | -------------- | ----- | -------------- |
| `<ingest>`       | `<PARSE_TASK>` | `<n>` | `<feature>`    |
| `<derive>`       | `<DERIVE_TASK>`| `<n>` | `<feature>`    |
| ...              | ...            | ...   | ...            |

Free tier: `<m>` credits per new user (from product config).
