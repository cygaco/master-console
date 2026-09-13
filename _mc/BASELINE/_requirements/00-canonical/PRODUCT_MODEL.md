# Pantry Pilot — Canonical Product Model

<!-- SPEC-AHEAD-OF-CODE: This document defines the TARGET product model the next skeleton build will realize. A key change: Deep-Dive Q&A moves from the onboarding phase (currently Step 6) to the dashboard phase as an optional tier-jump activity. Shipped code still positions deep-dive as a required onboarding step. See "Phase Vocabulary" below. -->

This document defines the structural primitives, Jobs to Be Done, and invariant truths of the product.

---

## Phase Vocabulary (Canonical)

- **Onboarding phase** = all steps before the dashboard. The required, no-skip sequence that captures household inputs: recipe import, parse, preferences, taste profile, catalog research, menu lock. The user cannot reach the dashboard until these complete.
- **Dashboard phase** = the dashboard itself + every optional activity users launch from there (on first arrival or on return visits). Includes: Deep-Dive Q&A (tier-jump unlock), master/weekly/store list generation, recipe cards, auto-cart, and any future score-boosting activities. All are opt-in after the user sees their baseline dashboard.

**Key invariant:** Deep-Dive Q&A is a dashboard activity, not an onboarding step. Users see a baseline readiness score on first dashboard entry; answering deep-dive questions is one of the optional ways to push the score into a higher tier.

---

## Product Primitives

These are the fundamental building blocks of Pantry Pilot. Every feature is composed of these primitives.

### 1. The Wizard

A 10-step linear flow organized into 3 phases (PLAN / PREP / SHOP) plus onboarding. Each step:

- Receives input from previous steps
- Produces output consumed by later steps
- Has explicit completion criteria (see PHASE_DISPLAY)
- Can be revisited, with downstream invalidation

**Structural truths:**

- Steps are strictly ordered. You cannot skip ahead.
- Going backward and changing data invalidates all downstream outputs per the INVALIDATION_MAP in `page.tsx`. Dirty tracking: if re-completing a step with no actual changes, invalidation is skipped.
- Each step has a `needsData` prerequisite (STEP_REQUIRES) — the sidebar enforces this.
- The wizard state is a single `SessionData` object holding the Household, its Members, Recipes, MealPlan, GroceryList, ListItems, and PantryItems, persisted in encrypted localStorage.

### 2. Catalog Intelligence

Real store catalog data powers every downstream output. The pipeline:

1. User sets preferences (store, diet, budget, household size)
2. AI generates 4–6 catalog search queries
3. Fresh Feed returns ~50 product listings per query
4. Two-phase model analysis: raw data → intelligence report → structured analysis
5. Output: staple keywords, meal themes, price ranges, taste questions

**Structural truths:**

- Catalog data is real, not synthetic. Everything downstream is grounded in actual shelf listings.
- Themes are cooking arrangements, not just cuisines (e.g., "Sunday Batch Cook — Freezer Portions" is distinct from "Weeknight Skillet").
- The intelligence report (PLAN_PREP) is an intermediate artifact — the user never sees it directly.
- If PLAN_PREP fails, the system falls back to single-phase analysis.

### 3. Subscription Tiers

Three tiers gate premium operations.

**Structural truths:**

- Free tier: 3 planned meals per week and 1 saved list.
- Plus ($5/month): unlimited plans and pantry tracking. Store lists and recipe card packs are Plus features.
- Family ($9/month): everything in Plus, plus a shared household of up to 6 Members.
- Auto-cart is free on every tier during launch phase. May become a paid feature later.
- Catalog analysis first run is free.
- A consumed Free-tier slot is never restored on failure — the operation is retried instead.

### 4. Readiness Scoring

A 0–100+ score reflecting how ready the household's week is. Score is **uncapped** — generating store lists for every theme pushes toward 100%, and bonus themes can exceed it.

**Structural truths:**

- Score increases as users complete steps and add data.
- Score is computed client-side from session data completeness + quality signals (`readiness.ts`).
- Visual thresholds: 40 (baseline), 70 (stocked), 90 (well stocked), 100 (maximum).
- Crossing a threshold triggers a celebration (GlazeToast + optional ConfettiBurst).
- The meter is always visible in the PilotBar (compact) and available in full-size.

**Weight breakdown (sums to 100% base):**

| Component              | Weight | Notes                                  |
| ---------------------- | ------ | -------------------------------------- |
| Deep-Dive QA (batch 1) | 5%     | First set of taste questions answered  |
| Deep-Dive QA (batch 2) | 10%    | Bonus batch answered                   |
| Themes selected        | 5%     | At least one ranked meal theme         |
| Ingredients curated    | 5%     | Exclusions/inclusions reviewed         |
| Master list            | 10%    | Generated                              |
| Weekly list            | 5%     | Generated                              |
| Store lists            | 25%    | Per-theme, proportional — UNCAPPED     |
| Recipe card pack       | 15%    | Generated                              |
| Auto-cart connected    | 10%    | Extension configured                   |
| Swap answers reviewed  | 10%    | Substitution answers ready             |

**Labels:** "Getting started" (0–39), "Building momentum" (40–69), "Well stocked" (70–89), "Fully provisioned" (90–100), "OVERSTOCKED" (>100)

### 5. List Generation

Three-tier list system: Master → Weekly → Store.

**Structural truths:**

- Master is generated once, contains everything. It is the source of truth.
- Weekly is a condensed version (~1 page). Only generated if the master exceeds one page; otherwise master serves as both.
- Store is a diff applied to the master for a specific meal theme. One per theme.
- Diffs never fabricate — they reorder, rewrite, and remove, but never add items no recipe calls for.
- Import safety: ASCII only, straight quotes, hyphens (not em-dashes).

---

## Jobs to Be Done

### Primary JTBD

> **When** I'm planning the week's meals, **I want to** quickly turn the food we actually like into a plan and a ready-to-shop list, **so that** I spend less time deciding and more time cooking — and with auto-cart, less time shopping too.

### Supporting JTBDs

| JTBD                                                                  | Where                                            |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| "I want to know what a week of meals actually costs"                  | Onboarding 4–5 (Search + Analyze)                |
| "I want my list to match the aisles of the store I actually shop"     | Dashboard activities: Deep-Dive QA + Ingredients + List Gen |
| "I want different lists for different kinds of cooking weeks"         | Dashboard: Store List Gen                        |
| "I want printable cards the rest of the household can follow"         | Dashboard: Recipes                               |
| "I want to fill the cart quickly without buying the wrong things"     | Dashboard: Auto-Cart                             |
| "I want to know what the pantry is missing so I can fill the gaps"    | Dashboard: Deep-Dive QA (tier-jump activity)     |
| "I want to see how ready our week is before I shop"                   | Cross-cutting (Readiness Score — visible starting at dashboard entry) |
| "I want to control which ingredients we never buy"                    | Dashboard: Ingredient Curation                   |

---

## The 10-Step Model (Target State)

<!-- SOURCE OF TRUTH: _requirements/00-canonical/STEPS.json — the step list, phase membership, positions, and requires_data/produces_data edges below must mirror the registry. Propagation is manual until /maps:steps regenerates this table automatically. -->

> **Spec-ahead-of-code:** In the target state, Deep Dive is not a wizard step — it is a dashboard activity. The table below uses the activity-ID shape for clarity. Shipped code currently positions Deep Dive as Step 6 inside onboarding.

<!-- maps:steps:START (region=product-model-onboarding) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->

**Onboarding phase (required, strictly linear):**

| # | Phase | Step ID | Component | Requires | Produces |
| - | ----- | ------- | --------- | -------- | -------- |
| 1 | Onboarding | IMPORT | Step1Import | — | recipesRaw |
| 2 | Onboarding | PREFERENCES | Step3Preferences | — | preferences |
| 3 | Onboarding | PROFILE | Step4Profile | recipesRaw | profile |
| 4 | Onboarding | SEARCH | StepCollect | profile | catalogRaw |
| 5 | Onboarding | CATALOG_ANALYSIS | Step6Analysis | catalogRaw | catalogAnalysis |

Completing the last onboarding step drops the user at the **Dashboard** with a baseline readiness score.

<!-- maps:steps:END (region=product-model-onboarding) -->

Historical-context columns (Name / Input / Output / Tier) live in feature PRDs — this table is the structural core only.

<!-- maps:steps:START (region=product-model-dashboard) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->

**Dashboard phase (optional activities, user opts in from dashboard):**

| Activity | Component | Requires | Produces |
| -------- | --------- | -------- | -------- |
| DEEP_DIVE | DeepDiveQA | catalogAnalysis | tasteResults |
| INGREDIENTS | Step8Ingredients | tasteResults | exclusions |
| LISTS | Step10Lists | profile | masterList |
| RECIPES | Step11Cards | masterList | recipeCards |
| AUTO_CART | Step13Cart | masterList | extension_runs |

Dashboard activities have dependency edges (see Requires column), but the user chooses the order. The dashboard surfaces a recommended "next unlock" based on highest point-gain, not a forced sequence.

<!-- maps:steps:END (region=product-model-dashboard) -->

**Tier signals (hand-maintained, reference only):** Store lists Plus (per theme); Recipe cards Plus; Deep Dive / Ingredients / Auto-Cart Free. See individual feature PRDs for authoritative gating.

**Note on Ingredients:** The position of Ingredient Curation (onboarding vs. dashboard activity) is NOT explicitly changed by this revision. The user scope for this spec change covered deep-dive only. Flagged as an open ambiguity — see the deep-dive-qa PRD and the Golden Paths doc for the interim "dashboard activity" placement used here.

---

## Data Dependency Chain

```
Recipe Box (1) → Taste Profile (3) → Queries (4) → Store Catalog (4)
                                              ↓
                                        Catalog Prep (5a)
                                              ↓
                                        Catalog Analysis (5b)
                                              ↓
                                    ┌─── Taste Questions (6)
                                    │         ↓
                                    │    Taste Answers (6)
                                    │         ↓
                                    ├─── Ingredient Curation (7)
                                    │         ↓
                                    ├─── Master + Weekly List (8)
                                    │         ↓
                                    ├─── Store Lists (8, per theme)
                                    │         ↓
                                    ├─── Recipe Cards + Swap Answers (9)
                                    │         ↓
                                    └─── Substitution Rules + Chrome Prompt (10)
```

---

## Invalidation Rules

Editing an earlier step clears all downstream data. The map:

| If You Edit Step...     | First Field Cleared | Through...     |
| ----------------------- | ------------------- | -------------- |
| 1 (Recipe Import)       | profile             | cartData       |
| 2 (Preferences)         | profile             | cartData       |
| 3 (Profile)             | generatedQueries    | cartData       |
| 4 (Search)              | catalogRaw          | cartData       |
| 5 (Analyze)             | tasteResults        | cartData       |
| Dashboard: Deep Dive    | exclusions          | cartData       |
| Dashboard: Ingredients  | masterList          | cartData       |

**Note:** Step 5 does NOT clear `tasteQuestions` (those come from catalog analysis itself). See `INVALIDATION_MAP` in `page.tsx` for the exact field list per step. In the target state, the "Deep Dive" invalidation row fires when the user re-enters the Deep-Dive Q&A dashboard activity and changes answers — not when re-visiting an onboarding step.

**Dirty tracking:** Before backward navigation, the system snapshots current data. If the user re-completes the step with no changes, invalidation is skipped.

---

## Phase System

### Phase Transitions

- **Onboarding → PLAN**: Automatic after step 3 completion. Celebration overlay shown.
- **PLAN → PREP**: Automatic after step 5 completion. Soft gate may appear (auth prompt).
- **PREP → SHOP**: Automatic after step 9 completion.

### Phase Bar Behavior

- Hidden during onboarding (steps 1–3)
- Shows PLAN / PREP / SHOP pills on steps 4+
- Each pill: Active (orange), Done (green), Disabled (gray)
- Step indicators within each phase: Done (checkmark), Active (highlighted), Pending (dot)
- On desktop (≥ 1024px), the SidePanel provides step-level navigation alongside the PhaseBar
- On mobile (< 1024px), the PhaseBar is the primary navigation (SidePanel hidden)

---

## Structural Invariants

These truths must hold in any implementation:

1. **The wizard is strictly linear.** No step can be entered without completing all prior steps.
2. **Catalog data is real.** No synthetic or placeholder prices in production.
3. **User controls the rules.** The extension can fill a cart, but the user defines the substitution rules (buy-if/skip-if signals) that govern every decision.
4. **No fabrication.** AI-generated content never invents ingredients, quantities, or prices.
5. **Encryption at rest.** All session data in localStorage is AES-GCM encrypted.
6. **API keys are server-side only.** Model and Fresh Feed keys never reach the client.
7. **External data is untrusted.** Store catalog content is wrapped in injection-defense tags.
8. **Backward navigation triggers invalidation.** Changed inputs always clear stale downstream outputs.
9. **Free tier delivers real value.** 3 planned meals per week + 1 list = a usable week minimum.
10. **TestKitchen wraps the entire app tree.** It is the outermost React context provider.
