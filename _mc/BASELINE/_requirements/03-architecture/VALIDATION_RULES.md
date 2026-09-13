# Pantry Pilot — Validation Rules (Regen Spec)

Field constraints, input sanitization, and output validation scattered across components and lib files. A regen agent needs these to reproduce the same guardrails.

---

## File Upload (src/lib/upload.ts)

### Allowed Types

| Extension | MIME Types                                                                                   | Magic Bytes          |
| --------- | -------------------------------------------------------------------------------------------- | -------------------- |
| `.pdf`    | `application/pdf`                                                                            | `%PDF` (25 50 44 46) |
| `.docx`   | `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/zip` | `PK` (50 4B 03 04)   |
| `.txt`    | `text/plain`                                                                                 | None                 |
| `.md`     | `text/plain`, `text/markdown`                                                                | None                 |

### Limits

| Constraint         | Value         | Location                             |
| ------------------ | ------------- | ------------------------------------ |
| Max file size      | 10 MB         | `upload.ts:25`, `Step1Recipes.tsx:60` |
| Max PDF pages      | 50            | `upload.ts:26`                       |
| Max extracted text | 500,000 chars | `upload.ts:27`                       |
| Parse timeout      | 15,000 ms     | `upload.ts:28`                       |

### Validation Pipeline

1. **Basic** (`validateFile`): size > 0, size <= 10MB, extension in allowed list, MIME matches
2. **Deep** (`validateFileDeep`): basic + magic byte header check
3. **Extract** (`extractText`): deep validate, then parse with timeout

---

## Household Info (Step1Recipes.tsx)

| Field          | Rule                                                      | Error Message                                                     |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Household name | Required, non-empty                                       | "Household name is required"                                      |
| Email          | Required, non-empty                                       | "Email is required"                                               |
| Phone          | Required, non-empty                                       | "Phone is required"                                               |
| Location       | Required, non-empty                                       | "Location is required"                                            |
| Store link     | Optional; if set, must parse as valid URL with http/https | "Store link must be a valid URL (e.g. https://yourstore.example)" |

---

## Password (src/app/api/auth/register/route.ts)

| Constraint | Value | Rationale |
|---|---|---|
| Minimum length | 8 characters | Industry standard minimum |
| Maximum length | 128 characters | Prevents PBKDF2 DoS (long inputs cause excessive hashing time) |
| Complexity | None required (MVP) | Reduces friction; may add in future |

---

## Search Queries (src/lib/validators.ts)

### sanitizeQueries()

- Strips Boolean operators (`AND`, `OR`, `NOT` — case-insensitive)
- Removes parentheses
- Collapses multi-space to single space
- Truncates 3+ quoted phrases to the first 2
- Filters out empty strings

---

## Export Output Sanitization (src/lib/validators.ts)

### sanitizeExport()

Applied to all Claude plan/grocery-list output before use:

| Input Character           | Replacement |
| ------------------------- | ----------- |
| Smart single quotes `''‚` | `'`         |
| Smart double quotes `""„` | `"`         |
| En-dash `–`, em-dash `—`  | `-`         |
| Ellipsis `…`              | `...`       |
| Bullet `•`                | `-`         |
| Non-breaking space        | ` `         |
| Zero-width chars          | (removed)   |

---

## CSRF / Origin Validation (src/lib/csrf.ts)

### validateOrigin()

Shared utility imported by all mutation API routes. Checks `Origin` header (primary) and `Referer` header (fallback) against `ALLOWED_ORIGINS` env var + same-origin host.

**Applied to these routes:**

| Route                | Method            | Since                             |
| -------------------- | ----------------- | --------------------------------- |
| `/api/claude`        | POST              | Original (inline, same logic)     |
| `/api/recipes`       | POST              | Original (inline, same logic)     |
| `/api/quota/consume` | POST              | Security fix                      |
| `/api/subscription/grant` | POST         | Security fix                      |
| `/api/session`       | GET, POST, DELETE | Security fix (DELETE was missing) |
| `/api/auth/login`    | POST              | Security fix                      |
| `/api/auth/logout`   | POST              | Security fix                      |
| `/api/auth/register` | POST              | Security fix                      |

**Not applied to:** `/api/stripe/webhook` (legitimately cross-origin — Stripe calls our endpoint, verified by signature), `/api/extension` (public GET), `/api/test` (gated by env var).

**Behavior:** Returns `false` if neither `Origin` nor `Referer` matches an allowed origin. Route responds with HTTP 403. Check runs BEFORE auth, rate limiting, or body parsing.

---

## Exclusion Validation (src/lib/validators.ts)

### validateExclusions()

Checks that ingredients the user marked as "exclude" do not appear in any output. Scanned areas:

- Master plan: summary, staples, meal steps
- Weekly plan: summary, staples, meal steps
- Tailored plans: summary, staples, meal steps, diff fields (summary_replacement, staples_reorder, steps_rewrite replacements)
- Grocery list: list name, overview, staples
- Chrome shop prompt
- Form answers

Uses both `ingredientMatch()` and case-insensitive `includes()`.

**`ingredientMatch()` algorithm:** Normalizes both strings by lowercasing and stripping all non-alphanumeric characters (`/[^a-z0-9]/g`), then compares for exact equality. No fuzzy matching for MVP.

---

## Output Fidelity (src/lib/validators.ts)

### validateOutputFidelity()

| Check                    | Pass Condition              | Fail Condition                |
| ------------------------ | --------------------------- | ----------------------------- |
| Search queries in prompt | All queries appear verbatim | None appear                   |
| Excluded ingredients     | Zero violations             | Any excluded ingredient found |
| Form answers populated   | All populated               | 4+ empty                      |

### validateContracts()

Checks that required session fields exist and are non-null before each prompt call. See PROMPT_TEMPLATES.md § Prompt Contracts for the full table.

### validateAliases()

Checks common abbreviations (tbsp, tsp, oz, lb, qt, pt, gal, ml, g, kg, EVOO, AP flour, etc.) — if an abbreviation appears in the recipe collection, either it or its expansion should appear in the output.

---

## Smoke Test (src/lib/validators.ts)

### runSmokeTest()

Full end-to-end session validation:

| Check                | Expected                                  |
| -------------------- | ----------------------------------------- |
| Recipes parsed       | `recipesStructured` exists                |
| Household data       | `household.name` non-empty                |
| Profile generated    | `profile` exists                          |
| Catalog data         | `catalogRaw` exists                       |
| Menu analysis        | `menuAnalysis` exists                     |
| Categories ranked    | `rankedCategories.length > 0`             |
| Master plan          | Exists, has summary and meals             |
| Weekly plan          | `weeklyPlan` exists                       |
| Tailored plans       | `tailoredPlans` has 1+ entries            |
| Grocery list         | `grocery.listName` exists                 |
| Form answers         | `formAnswers.length > 0`                  |
| Shopping data        | `shopData.chromePrompt` exists (SKIP ok)  |
| Exclusion compliance | Zero violations                           |
| Data contracts       | All prompt contracts satisfied (WARN ok)  |

---

## Catalog Data Limits (src/lib/utils.ts)

| Constraint              | Value                                     | Location                   |
| ----------------------- | ----------------------------------------- | -------------------------- |
| Max catalog text        | 30,000 chars                              | `preprocessCatalogData()`  |
| Max MENU_PREP payload   | 35,000 chars                              | `buildMenuPrepPayload()`   |
| Description excerpt     | 300 chars (default), 150 chars (fallback) | `buildMenuPrepPayload()`   |
| High-volume source flag | 2+ listings                               | `buildMenuPrepPayload()`   |

---

## Rate Limits (src/app/api/claude/route.ts, src/app/api/recipes/route.ts)

| Limit                 | Value               | Scope        |
| --------------------- | ------------------- | ------------ |
| Claude per-IP         | 20/min              | Per IP       |
| RD per-IP             | 10/min              | Per IP       |
| Global Claude         | 60/min              | All users    |
| Daily Claude requests | 500 (default)       | ENV override |
| Daily Claude tokens   | 2,000,000 (default) | ENV override |
| Daily RD requests     | 100 (default)       | ENV override |

---

## Plan Length Heuristic (Step10Plans.tsx)

```typescript
function isLongPlan(plan: PlanOutput): boolean {
  return (plan.meals || []).length > 3 || totalSteps > 20;
}
```

If the master plan is "long", a separate trimmed weekly plan is used. Otherwise, the master serves as both.

---

## Ingredient Exclusion Warning (Step8Ingredients.tsx)

If > 50% of ingredients in a category are excluded, a warning is shown to the user. Minimum 3 ingredients in a category before this check fires.
