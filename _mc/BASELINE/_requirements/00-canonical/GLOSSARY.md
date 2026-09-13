# Pantry Pilot — Glossary

Canonical terminology dictionary. Every product term used across all documentation is defined here. If a term is not listed, it is not a product term and should not be used without adding it here first.

---

## Product Identity

| Term         | Definition                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pantry Pilot** | The product. A meal-planning assistant that transforms a household's recipe box into store lists, recipe cards, swap answers, and auto-cart capabilities. |
| **Onboarding phase** | (Target state) The required, no-skip sequence before the dashboard: recipe import, parse, preferences, taste profile, catalog research, theme lock. Captures the household inputs that unlock the dashboard. Spec-ahead-of-code: shipped code still includes Deep Dive + Ingredients inside onboarding. |
| **Dashboard phase** | (Target state) The dashboard itself + every optional activity users opt into after completing onboarding: Deep-Dive Q&A (tier-jump), Ingredients, Lists, Recipes, Auto-Cart. Activities can be launched in any order based on the dashboard's "next unlock" guidance. |
| **Dashboard** | The post-onboarding command center. Hosts the readiness meter, optional tier-jump activities (including Deep-Dive Q&A), and the core sections: Kitchen Console, Lists, Recipes, Auto-Cart. |

---

## Onboarding Steps (Target State)

<!-- SOURCE OF TRUTH: _requirements/00-canonical/STEPS.json — the onboarding-steps table and any dashboard-activities table below must mirror the registry. Propagation is manual until /maps:steps regenerates these tables automatically. -->


<!-- SPEC-AHEAD-OF-CODE: The target state moves Deep Dive out of onboarding into a dashboard activity. The table below reflects the target onboarding phase. Shipped code currently hosts 7 onboarding steps (including Deep Dive as Step 6 and Ingredients as Step 7). See the "Dashboard Activities" table below for the relocated/post-dashboard activities. -->

The target-state onboarding is 5 steps (recipe import → preferences → taste profile → search → catalog analysis). After the last onboarding step, the user enters the dashboard with a baseline readiness score.

**Runtime constants note:** `src/lib/constants.ts` still defines the shipped router as `ONBOARDING_TOTAL = 7` with `Import`, `Preferences`, `Profile`, `Search`, `Analysis`, `Deep Dive`, and `Ingredients`. The tables below describe the target-state registry from `_requirements/00-canonical/STEPS.json`; do not use them to infer the current shipped step count until the next skeleton rebuild lands the phase move.

<!-- maps:steps:START (region=glossary-onboarding) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->

| Position | Step ID | Component | File |
| -------- | ------- | --------- | ---- |
| 1 | IMPORT | Step1Import | src/components/steps/Step1Import.tsx |
| 2 | PREFERENCES | Step3Preferences | src/components/steps/Step3Preferences.tsx |
| 3 | PROFILE | Step4Profile | src/components/steps/Step4Profile.tsx |
| 4 | SEARCH | StepCollect | src/components/steps/StepCollect.tsx |
| 5 | CATALOG_ANALYSIS | Step6Analysis | src/components/steps/Step6Analysis.tsx |

<!-- maps:steps:END (region=glossary-onboarding) -->

Component filenames carry legacy numbering that does NOT match logical step numbers. See **Naming Debt** below.

### Dashboard Activities (relocated / post-dashboard)

<!-- maps:steps:START (region=glossary-dashboard) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->

| Activity | Component | File | Feature |
| -------- | --------- | ---- | ------- |
| DEEP_DIVE | DeepDiveQA | src/components/DeepDiveQA.tsx | deep-dive-qa |
| INGREDIENTS | Step8Ingredients | src/components/steps/Step8Ingredients.tsx | ingredient-curation |
| LISTS | Step10Lists | src/components/steps/Step10Lists.tsx | list-generation |
| RECIPES | Step11Cards | src/components/steps/Step11Cards.tsx | recipe-cards |
| AUTO_CART | Step13Cart | src/components/steps/Step13Cart.tsx | auto-cart |

<!-- maps:steps:END (region=glossary-dashboard) -->

**Spec-ahead-of-code:** Deep Dive's placement is the only phase move confirmed by the current spec revision. Ingredients' position (still-in-onboarding vs. relocated-to-dashboard) is marked as an open ambiguity — see "Outstanding Ambiguities" in the skeleton-build plan.

---

## Dashboard Sections

Post-onboarding. All sections are accessible from the dashboard sidebar.

| Section              | What it hosts                                        | Auth required |
| -------------------- | ---------------------------------------------------- | ------------- |
| **Kitchen Console**  | Readiness meter, score breakdown, quick-launch       | Yes (auth gate on entry) |
| **Lists**            | Master/weekly/store list generation + export         | Yes           |
| **Recipes**          | Recipe cards + swap answers                          | Yes           |
| **Auto-Cart**        | Extension setup, substitution rules, launch          | Yes           |

---

## Screens

Composite page components that host multiple steps.

| Term               | Steps | Component File       | Hosts                                   |
| ------------------ | ----- | -------------------- | --------------------------------------- |
| **OnboardingPage** | 1–7   | `OnboardingPage.tsx` | Recipe import, preferences, taste profile, catalog research, deep-dive, ingredients |
| **PrepPage**       | 4–5   | `PrepPage.tsx`       | Search queries + catalog analysis (3-substep: fetch → analysis → themes) |
| **Dashboard**      | —     | `Dashboard.tsx`      | Kitchen Console, Lists, Recipes, Auto-Cart |
| **Step13Cart**     | —     | `Step13Cart.tsx`     | Auto-cart launch (hosted in Dashboard Auto-Cart section) |

See **Naming Debt** section below for why component names don't match structure.

---

## Catalog Sweep — Key Terminology

Onboarding steps 4-5 use flight-plan naming. These terms have specific meanings:

| Term | Scope | What It Means |
|------|-------|---------------|
| **Menu Mission** | Screen name | The entire PrepPage experience (onboarding steps 4-5). User-facing heading for the search/fetch screen. |
| **Catalog Sweep** | Execution phase | Everything that happens after "Build My Week": Fresh Feed fetch → PLAN_PREP → PLAN analysis → CTA. One continuous loading sequence, no user interaction. |
| **Build My Week** | CTA button | Triggers the catalog sweep. User sees fetch phases then analysis phases on the same screen. |
| **Analysis** | API calls only | Specifically the PLAN_PREP + PLAN model API calls. A subset of the catalog sweep. |
| **Analysis Complete** | CTA bridge | The "menu ready" message + "View Your Menu" button that appears after the catalog sweep finishes. |
| **Lock Your Menu** | Screen name | The meal-theme selection screen (onboarding step 5, PrepPage substep 2). User toggles themes on/off, then locks. |
| **Lock Menu** | CTA button | Confirms theme selection and advances to Deep Dive QA (onboarding step 6). Writes `rankedThemes`. |

**Why this matters:** "Analysis" is ambiguous. When the user says "analysis," they usually mean the whole catalog sweep. When specs say "analysis," they mean the PLAN API calls. Use "catalog sweep" for the full execution and "analysis" for the API calls specifically.

---

## Naming Debt

Known inversions — do NOT rename files, fix references to match reality.

| Debt                       | Details                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Legacy step numbers**    | Component filenames don't match logical steps (e.g., `Step3Preferences.tsx` = step 2, `Step13Cart.tsx` = auto-cart). The numbering reflects an earlier step sequence that was consolidated. |
| **PrepPage name**          | `PrepPage.tsx` hosts onboarding steps 4-5, which belong to the PLAN phase. The name was assigned before the current architecture existed.                                                   |
| **PlanPage target-state debt** | `PlanPage.tsx` still exists as the shipped Step 6 router host. Target-state specs move Deep-Dive Q&A to the dashboard and should delete or retire this page in the next skeleton rebuild. |
| **getScreen() routing**    | `getScreen()` in `constants.ts` returns `"onboarding"` for steps 1-7 and `"dashboard"` for post-onboarding. The old `"plan"` / `"prep"` / `"shop"` values are removed.                    |

---

## Build Phases

(from `.claude/manifest.json` build.phases, agent execution order):

| Phase | Name                  | Features                                                                         |
| ----- | --------------------- | -------------------------------------------------------------------------------- |
| 0     | Foundation            | types, constants, storage, validators, pipeline, api, utils, prompts, ui, layout |
| 1     | Auth + Subscription   | auth, subscription                                                               |
| 2     | Onboarding            | onboarding (steps 1-7)                                                           |
| 3     | Catalog Research      | catalog-research (steps 4-5 within onboarding)                                   |
| 4     | Deep Dive + Ingredients + Scoring | deep-dive-qa, ingredient-curation, readiness                         |
| 5     | Content Generation    | list-generation, recipe-cards                                                    |
| 6     | Auto-Cart             | auto-cart, extension                                                             |
| 7     | Dev Tools             | test-kitchen                                                                     |

---

## Feature IDs

Kebab-case identifiers used in `store.json`, task manifest, and PRD folder names.

| Feature ID            | PRD Folder            | Task ID                     | Where                              |
| --------------------- | --------------------- | --------------------------- | ---------------------------------- |
| `auth`                | `auth`                | `build-auth`                | Dashboard entry (auth gate)        |
| `subscription`        | `subscription-tiers`  | `build-subscription`        | Cross-cut (dashboard header)       |
| `onboarding`          | `onboarding`          | `build-onboarding`          | Onboarding steps 1–7               |
| `catalog-research`    | `catalog-research`    | `build-catalog-research`    | Onboarding steps 4–5               |
| `deep-dive-qa`        | `deep-dive-qa`        | `build-deep-dive-qa`        | Dashboard — optional tier-jump activity (target state). Currently shipped as onboarding step 6. |
| `ingredient-curation` | `ingredient-curation` | `build-ingredient-curation` | Onboarding step 7 (shipped). Relocation to dashboard is an open ambiguity. |
| `readiness`           | `readiness`           | `build-readiness`           | Cross-cut (dashboard + deep-dive)  |
| `list-generation`     | `list-generation`     | `build-list-generation`     | Dashboard — Lists section          |
| `recipe-cards`        | `recipe-cards`        | `build-recipe-cards`        | Dashboard — Recipes section        |
| `auto-cart`           | `auto-cart`           | `build-auto-cart`           | Dashboard — Auto-Cart section      |
| `extension`           | `extension`           | `build-extension`           | Dashboard — Auto-Cart (infra)      |
| `test-kitchen`        | `test-kitchen`        | `build-test-kitchen`        | Dev overlay                        |
| `shell`               | `shell`               | `build-shell`               | Cross-cut (IntroScreen + Dashboard)|
| `profile`             | `profile`             | `build-profile`             | Cross-cut (dashboard sidebar)      |

**Note:** Feature ID `subscription` maps to PRD folder `subscription-tiers`. All other IDs match their folder name.

---

## List Types

| Term              | Definition                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Master List**   | The full, unabridged list containing every ingredient across the whole plan, at full quantity. Generated once from taste profile + catalog data + Q&A insights. Not taken to the store directly. |
| **Weekly List**   | A condensed ~1-page version of the master. Items already tracked in the pantry are removed, staples are grouped. Used when no store variant exists for a theme.             |
| **Store List**    | A master list modified with theme-specific diffs: reordered by aisle, adjusted pack sizes, rewritten item names to match shelf labels. One per meal theme. Plus tier.       |
| **List Diff**     | The delta between a master list and a store variant. Includes: header replacement, aisle reorder, item rewrites/removals, section reorder, top-of-list staples.             |

---

## Catalog Intelligence

| Term                         | Definition                                                                                                                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catalog Analysis**         | The final structured output of the two-phase catalog pipeline. Contains: staple keywords, price ranges, meal themes, taste questions, discovery recipes, exclusion tags, nutrition visibility.                                                                          |
| **Catalog Prep Report**      | The intermediate intelligence report from phase 1 (PLAN_PREP prompt). Raw catalog data transformed into structured themes, price intelligence, store-brand detection, and seasonality signals.                                                                          |
| **Meal Theme** (MealTheme)   | A distinct cooking arrangement discovered in catalog and recipe data. Defined by: name, description, why it fits, price range, item count, match strength, search terms. NOT just a cuisine — includes the cooking arrangement (e.g., "20-Minute Skillet — One Pan, Weeknight"). |
| **Discovery Recipe**         | A non-obvious recipe pivot suggested by catalog analysis. 1–3 per analysis, with strong rationale for why the household should consider it.                                                                                                                             |
| **Taste Questions**          | 5–8 questions generated by catalog analysis to surface information not already in the recipe box. Consumed by the Deep-Dive QA dashboard activity (target state) — currently consumed by onboarding Step 6 in shipped code.                                              |

---

## Scoring & Plans

| Term                  | Definition                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Readiness Score**   | A flat-point score (0–160+ base) representing how ready the household's week is. Brackets: Snacker (0-40), Cook (41-80), Chef (81-120), Head Chef (121-160), FULL PANTRY (161+). |
| **Readiness Meter**   | The arc-shaped visual component displaying the readiness score. Compact (in PilotBar) and full-size variants. Glows at higher brackets.                            |
| **PilotBar**          | The persistent header bar visible on the dashboard for authenticated users. Shows readiness meter + current tier + upgrade CTA.                                    |
| **Auth Gate**         | The authentication prompt shown when the user first enters the dashboard after completing onboarding. Required to access tier-gated features.                      |
| **Tier Gate**         | The upgrade prompt shown when a Free-tier household triggers a Plus or Family feature.                                                                             |
| **Free Tier**         | 3 planned meals per week and 1 saved list. Enough for: catalog analysis (free first run) + a usable weekly list + some buffer.                                    |
| **Household**         | The billing and sharing unit. One Household owns Members, Recipes, MealPlans, GroceryLists, and PantryItems. Family tier allows up to 6 Members per Household.    |

---

## Tier Gating

| Operation                    | Tier | Code Key (`tiers.ts`)          | Notes                               |
| ---------------------------- | ---- | ------------------------------ | ----------------------------------- |
| Catalog analysis (first run) | Free | `PLAN` / `planFirst`           | Subsequent re-runs: Plus            |
| Catalog re-run               | Plus | `rerunCatalog` / `PLAN_PREP`   | After first free run                |
| Store list                   | Plus | `STORE` / `storeList`          | Per meal theme                      |
| Recipe card pack             | Plus | `CARDS` / `cardPack`           | Full cards + swap answers           |
| Auto-cart session            | Free | `CART` / `autoCart`            | Free                                |

---

## Subscription Tiers

| Tier   | Included                                  | Price     | Note         |
| ------ | ----------------------------------------- | --------- | ------------ |
| Free   | 3 planned meals/week, 1 list              | $0        | —            |
| Plus   | Unlimited plans, pantry tracking          | $5/month  | "Popular"    |
| Family | Shared household, up to 6 members         | $9/month  | "Best Value" |

---

## Data & Pipeline

| Term                   | Definition                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SessionData**        | The central state object containing all household data across all 10 steps — Household, Members, Recipes, MealPlan, GroceryList, ListItems, PantryItems. Persisted in encrypted localStorage and optionally synced to server.        |
| **Fresh Feed (FF)**    | Third-party grocery catalog API. Dataset: `ff_us_grocery_catalog_v3`. Provides store product listings via trigger → poll → snapshot flow.                                                                                            |
| **Two-Phase Pipeline** | The catalog analysis flow: PLAN_PREP (raw catalog → intelligence report) → PLAN (report → final analysis). Fallback: skip PLAN_PREP if it fails.                                                                                     |
| **Pipeline Trace**     | In-memory log of data flow stages. Prefix: `[PIPELINE]`. Stages: USER_INPUT → QUERY_GEN → FF_TRIGGER → FF_POLL → FF_RESULTS → PLAN_PREP_INPUT → PLAN_PREP_OUTPUT → PLAN_INPUT → PLAN_OUTPUT → LIST_INPUT → LIST_OUTPUT.             |
| **Invalidation Map**   | Rules for which downstream data must be cleared when a user edits an earlier step. E.g., editing step 1 (recipe import) clears everything from taste profile through cartData.                                                       |

---

## UI Components

| Term              | Definition                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| **Dashboard**     | Post-onboarding command center. Sidebar navigation + four sections (Kitchen Console, Lists, Recipes, Auto-Cart). |
| **GlazeToast**    | Celebration toast shown when the readiness score crosses a bracket threshold (Cook, Chef, Head Chef, FULL PANTRY). |
| **ConfettiBurst** | Particle animation shown on major celebrations (onboarding completion, score bracket transitions).       |
| **HubScreen**     | Overlay component shown to returning users with session data. Displays session summary and plan options. |
| **AuthGate**      | Auth prompt modal shown on first dashboard entry for unauthenticated users. Replaces old "SoftGate".    |
| **Btn**           | Shared button component. Variants: primary, ghost, outline, danger.                                     |
| **Card**          | Shared container component with border, shadow, and radius.                                             |

---

## Authentication

| Term           | Definition                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Auth Gate**  | Auth prompt shown at dashboard entry after completing onboarding. Tier-gated dashboard features require authentication.       |
| **JWT**        | JSON Web Token used for server-side session verification. Cookie-based.                                                       |
| **Auth Modal** | The sign-in/sign-up overlay. Supports OAuth flows.                                                                            |

---

## Developer Tools

| Term                | Definition                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Test Kitchen**    | Dev tools hub accessible via `/?testkitchen`. Protected by env var. Line-kitchen themed.           |
| **Prep Bowl**       | Test data system. Allows fast-forwarding to any step with synthetic data via `/?prepbowl&step=N`.  |
| **QA Suite**        | Automated test runner within Test Kitchen. Server + client tests.                                  |
| **Fixture Profiles**| Saved test data snapshots for Prep Bowl. Named, saveable, loadable.                                |

---

## Chrome Extension

| Term                  | Definition                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cart Assistant**    | The Chrome extension (Manifest V3) that automates one-click cart fill at partner grocery sites. Located in `extension/` directory.                         |
| **Auto-Cart**         | The automation flow: scan store catalog → match items against substitution rules → fill cart → pause for user review. Never checks out without approval.   |
| **Substitution Rules**| Buy-if / skip-if signal lists generated by the CART prompt. Used by the extension and the browser agent to decide which products to add and which to skip. |
| **Chrome Prompt**     | A code-assembled markdown prompt (not AI-generated) containing all household data, substitution rules, and instructions. Used with the browser agent extension. |

---

## Security

| Term                         | Definition                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Rate Limiting**            | Per-IP (20/min model API, 10/min FF), global (60/min model API), daily budget caps. Powered by Upstash Redis.   |
| **Prompt Injection Defense** | External catalog data wrapped in `<untrusted_catalog_data>` tags with nonce to prevent injection attacks.        |
| **Session Nonce**            | UUID generated once per page load, sent as `X-Session-Nonce` header on every API call. Prevents replay attacks. |
| **Encrypted localStorage**   | AES-GCM encryption via Web Crypto API. PBKDF2 key derivation with 100K iterations and device fingerprint.       |
