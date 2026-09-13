# Pantry Pilot — Core Brief

---

## One-Liner

Pantry Pilot turns your recipe box into a week of meals and a ready-to-shop grocery list — priced, aisle-ordered, and matched against what is already in your pantry.

---

## What It Is

A 10-step guided wizard that takes a household's recipe box and produces:

- Real-time price intelligence from partner grocery catalogs
- A master list, a weekly list, and store list variants per meal theme
- Printable recipe cards for everyone in the household
- Pre-filled answers for common substitution prompts
- An auto-cart workflow via our Chrome extension (Pantry Pilot Cart Assistant)

The user imports recipes and sets preferences. Pantry Pilot reads real store catalogs, analyzes prices and pack sizes, asks clarifying questions, and generates a plan and a list tailored to how the household actually eats.

---

## What It Is NOT

- **Not a grocery store.** Pantry Pilot does not sell food or fulfill orders. It uses Fresh Feed to read partner store catalogs and processes the data for price intelligence.
- **Not a recipe template tool.** Plans are generated from the household's own recipes, not templates. There is no drag-and-drop menu editor.
- **Not an AI chatbot.** There is no conversational interface. The wizard is structured and linear.
- **Not a black box.** The extension can fill a cart but the user sets the substitution rules that control what gets added and what gets skipped. Full transparency into every decision.

---

## Vision

Eliminate the nightly "what's for dinner" scramble. A household should be able to go from "here are the meals we like" to "the list is ready and the cart is filled" in a single focused session.

---

## Core Pillars

### 1. Catalog-Driven

Every output is grounded in real store catalog data, not generic advice. Pack sizes come from actual shelf listings. Meal themes reflect what is genuinely in season and in stock. Price ranges come from real listings.

### 2. Household-Specific, Not Generic

One meal plan does not fit all. Pantry Pilot generates theme-specific list variants that emphasize the ingredients, portions, and pack sizes each kind of cooking week actually needs.

### 3. User Control

The user reviews and approves everything. Taste profile data is editable. Ingredients can be included or excluded. Meal themes can be ranked. The extension pauses before every checkout.

### 4. Speed

The goal is a single session from recipe box to filled cart. The wizard is linear, each step feeds the next, and no step requires the user to leave the app.

### 5. Privacy-First

- Household data encrypted at rest (AES-GCM in localStorage)
- API keys never exposed to the client
- No data shared with third parties beyond catalog lookups
- User can export and delete all data at any time

---

## Core Tensions

### Automation vs Control

Pantry Pilot automates heavily (price analysis, list generation, cart pre-fill) but never removes the user from the loop. The tension: every automation must feel like a shortcut, not a loss of agency.

### Depth vs Speed

The wizard is thorough (10 steps, deep-dive Q&A, ingredient curation) but must feel fast. The tension: gathering enough data to produce a plan the household will actually cook without making the process feel like a chore.

### Free vs Paid

The Free tier (3 planned meals per week, 1 list) covers core value: price analysis plus a usable weekly list. Paid features (unlimited plans, pantry tracking, shared households) require Plus or Family. The tension: the Free tier must deliver real value without feeling crippled.

### Specificity vs Breadth

Catalog analysis produces up to 10 distinct meal themes. Store lists are per-theme. The tension: being specific enough to be useful without overwhelming users with too many options.

---

## Target Audience

Households who:

- Already have a handful of recipes they cook (even scribbled ones)
- Shop weekly and plan at least loosely
- Want their list to match what the store actually stocks
- Are comfortable with AI-assisted tools
- Value speed over hand-writing a list every week

**Default persona assumptions** (user confirms or overrides during onboarding):

- Cooks at home most weeknights, shops one primary store
- Owns a standard kitchen — oven, stovetop, one large pan
- Deal-breakers: weeknight recipes over 60 minutes, more than 12 ingredients, specialty equipment they do not own, ingredients sold only in bulk

See `USER_COHORTS.md` for detailed segmentation.

---

## Phase Model

The wizard uses a flight-plan three-phase model after onboarding:

| Phase    | Steps | Metaphor      | User Mindset                            |
| -------- | ----- | ------------- | --------------------------------------- |
| **PLAN** | 4–5   | Route mapping | "Show me what we could eat this week"   |
| **PREP** | 6–9   | Preparation   | "Help me get the list and cards ready"  |
| **SHOP** | 10    | Execution     | "Let's fill the cart"                   |

Onboarding (steps 1–3) is pre-phase — gathering the inputs the wizard needs to operate.

---

## Success Metrics

A successful Pantry Pilot session means the user:

1. Imported a recipe box and it was correctly parsed
2. Received price analysis grounded in real catalog data
3. Generated at least one store list variant
4. Has everything ready to shop (list + recipe cards + swap answers)
5. Optionally: launched auto-cart and filled a cart

---

## Current Limitations

- **Single-catalog data.** Fresh Feed covers one partner grocery chain. No cross-store comparison.
- **US-focused.** Pack sizes and price intelligence are US-centric (US stores, USD).
- **No real-time updates.** Catalog data is a snapshot at plan time. No alerts or price monitoring.
- **Single-session model.** No persistent trip history, receipt matching, or restock reminders.
- **Vercel Hobby plan.** 60-second function timeout limits complex operations.
- **Per-unit price data.** Fresh Feed returns pack prices for most items. Per-pound rates extracted via regex from descriptions — imprecise.
