# Pantry Pilot — Data Pipelines

> **Scope:** Pipeline stages, inputs, outputs, fallback logic, and error handling. For session state structure and data flow between steps, see `DATA_FLOW.md`. For retry strategies, see `ERROR_RECOVERY.md`.

This document describes every data pipeline in the application: stages, inputs, outputs, fallback logic, and error handling.

---

## Pipeline 1: Query Generation

**Trigger:** User completes profile (step 3) and enters Search (step 4)

```
Profile + Preferences + avoidIngredients
  → QUERY_GEN prompt
  → 4–6 recipe-catalog search query strings
```

**Fallback:** None — if query generation fails, user is shown error and can retry.

**Pipeline trace stages:** `USER_INPUT` → `QUERY_GEN`

---

## Pipeline 2: Recipe Catalog Fetch (Recipe Data Co)

**Trigger:** User confirms search queries in step 4

```
Queries + Store Region + Meal Types + Diet flag
  → POST /api/recipes (trigger)
  → RD creates snapshot per query × meal type
  → Client polls POST /api/recipes (poll) every 10 seconds
  → RD processes listings (~30–120 seconds)
  → Deduplicated, normalized RecipeListing[] returned
```

**Timing:**

- Poll interval: 10 seconds
- Max wait: 6 minutes (360,000ms)
- Force partial results: after 3 minutes (180,000ms)

**Normalization:**

- HTML stripped from descriptions
- Descriptions truncated to 2,000 chars
- Deduplication by title + source (case-insensitive)
- Flexible field mapping (handles RD's inconsistent field names)
- Error records separated from recipe records

**Fallback:** If all snapshots fail, user sees warning with specific error messages.

**Pipeline trace stages:** `RD_TRIGGER` → `RD_POLL` → `RD_RESULTS`

---

## Pipeline 3: Two-Phase Menu Analysis

**Trigger:** Catalog fetch completes in step 4, analysis begins in step 5

### Phase 1: MENU_PREP (Raw → Intelligence Report)

```
RecipeListing[] + Profile (slim) + Meal Types + Query Stats
  → preprocessCatalogData() → normalized, truncated text (max 30K chars)
  → buildMenuPrepPayload() → compact recipe records in <untrusted_recipe_data> tags
  → extractServingCosts() → per-serving cost matches from descriptions
  → buildCatalogSummary() → markdown summary (top sources, difficulty, cuisine)
  → POST /api/claude (MENU_PREP prompt)
  → menuPrepReport (structured intelligence)
```

**Payload Assembly (`buildMenuPrepPayload`):**

- Recipes compacted to minimal schema: `{ t, s, reg, mt, cost, sq, qa, dif, desc }`
- Description excerpt: first 300 chars (trimmed to 150 if payload > 35KB)
- High-volume sources flagged (2+ listings)
- Profile slimmed: first 5 cuisines, 15 staple ingredients
- Wrapped in `<untrusted_recipe_data nonce="...">` tags
- Max payload: 35,000 chars

### Phase 2: MENU (Report → Final Analysis)

```
menuPrepReport (preferred) OR raw catalog data (fallback)
  → POST /api/claude (MENU prompt)
  → MenuAnalysis JSON
    ├── keywords[] (top 20–30 by frequency)
    ├── costRanges (per-serving + weekly basket data)
    ├── mealTypes[] (up to 10 categories, ranked)
    ├── miningQuestions[] (5–8 questions)
    ├── discoveryRecs[] (1–3 pivots)
    ├── exclusionTags[]
    └── pantryVisibility
```

**Fallback Logic:**

1. If MENU_PREP fails → skip to single-phase MENU with raw data
2. If MENU detects old single-phase output (no categories, stale format) → auto-rerun full pipeline
3. If both fail → user sees error with retry option

**Pipeline trace stages:** `MENU_PREP_INPUT` → `MENU_PREP_OUTPUT` → `MENU_INPUT` → `MENU_OUTPUT`

---

## Pipeline 4: Meal Plan Generation

**Trigger:** User initiates plan generation in step 8

### Master + Weekly (Single Call)

```
Profile + MenuAnalysis + miningResults (optional) + exclusions
  → POST /api/claude (PLAN_GEN prompt)
  → { master: PlanOutput, weekly: PlanOutput }
```

> **Spec-ahead-of-code note:** In the target state, `miningResults` is optional. Deep-Dive Q&A is a dashboard activity the user may or may not have completed before generating plans. The PLAN_GEN prompt must handle an empty/partial `miningResults` gracefully. Shipped code treats it as a required input.

### Tailored (Per Category, User-Triggered)

```
For each selected category:
  masterPlan + category details (from mealTypes)
    → POST /api/claude (TAILORED prompt)
    → PlanDiff
    → applyDiff(masterPlan, diff)
    → Tailored PlanOutput
```

**applyDiff safety:**

- Deep clones master (frozen)
- Blocks prototype pollution (`__proto__`, `constructor`, `prototype`)
- Only allows known diff keys
- Normalizes ingredient matching (lowercase, alphanumeric)

**Cost:**

- Master + Weekly: included on Free (capped at 3 planned meals/week)
- Tailored: Plus ($5/month) or Family ($9/month) only — unlimited plans

**Pipeline trace stages:** `PLAN_INPUT` → `PLAN_OUTPUT`

---

## Pipeline 5: Grocery List Generation

**Trigger:** User initiates grocery list generation in step 9

```
Profile + Preferences + Household details + miningResults + #1 ranked category
  → POST /api/claude (GROCERY prompt)
  → { listName, overview, sections, pantryAdds, staples, formAnswers }
```

**Cost:** Plus ($5/month) or Family ($9/month) — Free is capped at 1 list

**No fallback** — failure shows error with retry option.

---

## Pipeline 6: Shopping Heuristics Generation

**Trigger:** User enters step 10

```
Profile + MealPlan + formAnswers + rankedCategories + exclusions + preferences + household details
  → POST /api/claude (SHOP prompt)
  → { heuristics, manualGuide }

Code-assembled (not AI):
  → buildShopPrompt(session, heuristics, uploadedPlans)
  → chromePrompt (markdown text)
```

**Cost:** Free

---

## Pipeline Tracing

All pipelines are traced via `src/lib/pipeline.ts`.

### Stages

```typescript
type PipelineStage =
  | "USER_INPUT"
  | "QUERY_GEN"
  | "RD_TRIGGER"
  | "RD_POLL"
  | "RD_RESULTS"
  | "MENU_PREP_INPUT"
  | "MENU_PREP_OUTPUT"
  | "MENU_INPUT"
  | "MENU_OUTPUT"
  | "PLAN_INPUT"
  | "PLAN_OUTPUT";
```

### Trace Buffer

- In-memory array, max 50 entries
- Console logged with `[PIPELINE]` prefix
- Auto-truncates large fields (arrays >10 items, strings >200 chars)
- Available in the ops-console Pipeline Tracer module
- Not persisted — cleared on page reload

---

## Error Handling Summary

| Pipeline         | On Failure              | Retry        | Fallback                   |
| ---------------- | ----------------------- | ------------ | -------------------------- |
| Query Generation | Show error              | Manual retry | None                       |
| Catalog Fetch    | Show warnings per query | Manual retry | Partial results after 3min |
| MENU_PREP        | Skip to single-phase    | Automatic    | MENU with raw data         |
| MENU             | Show error              | Manual retry | None                       |
| Plan Gen         | Show error              | Manual retry | None                       |
| Tailored Diff    | Show error per category | Manual retry | None                       |
| Grocery List     | Show error              | Manual retry | None                       |
| Shop Heuristics  | Show error              | Manual retry | None                       |
