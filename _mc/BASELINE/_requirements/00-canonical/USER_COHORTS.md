# Pantry Pilot — User Cohorts

This document defines the user segments Pantry Pilot serves, their needs, behaviors, and what success looks like for each.

---

## Primary Audience

Households with a handful of recipes they already cook who want AI-assisted, catalog-driven meal plans and grocery lists.

**Common traits:**

- Have at least a rough recipe box (even a few screenshots)
- Shop at US grocery stores (or stores with US-style pack sizes)
- Are comfortable using web-based tools
- Want speed and quality over writing a list by hand
- Value real shelf prices over guesswork

---

## Cohort 1: Family Planners

### Who They Are

Running a household of 3–6 on a shared list. Cooking most nights, coordinating with a partner or older kids. High urgency, every week.

### Needs

- Speed: "I need the list ready before the store closes"
- Volume: "I'm feeding five people seven nights a week"
- Targeting: "Each trip should match the store I'm actually going to"
- Price awareness: "What is this week going to cost us?"

### Behaviors

- Will complete the full wizard in one session if the flow is smooth
- Most likely to upgrade (need store lists for multiple themes and a shared household)
- Most likely to use auto-cart (step 10)
- Will revisit to re-run catalog analysis as prices and seasons change

### Success

- Completed wizard in under 60 minutes
- Generated 3+ store list variants
- Launched auto-cart or shopped manually with the generated list
- Feels confident the week is planned and the budget holds

### Pain Points

- "I plan the same six meals over and over"
- "I don't know which pack size is the better deal"
- "Building the list takes forever — an hour every Sunday"
- "I have no idea if we're overspending on groceries"

---

## Cohort 2: Diet Switchers

### Who They Are

Households changing how they eat — a new medical restriction, a budget cut, a shift to plant-forward cooking. Medium urgency. Often unsure the change is sustainable.

### Needs

- Positioning: "How do I rebuild our meals around this restriction?"
- Validation: "Is this change realistic for a household like ours?"
- Gap analysis: "What am I missing in the pantry for this new way of cooking?"
- Confidence: "Can we actually afford to eat this way?"

### Behaviors

- Spend more time in onboarding (the new eating direction is the key decision)
- Engage deeply with Deep-Dive QA (step 6) — their answers bridge the gap between old and new cooking
- Value discovery recipes highly (non-obvious pivots)
- May generate fewer store lists but spend more time curating ingredients

### Success

- Catalog analysis reveals viable meal themes they hadn't considered
- Readiness score shows the switch is more manageable than expected
- Store list successfully rebuilds the week around the new constraint
- Taste Q&A surfaced meals they already cook that fit the new direction

### Pain Points

- "I don't know how to translate our old meals to this new diet"
- "Every recipe I find assumes ingredients we don't keep"
- "I feel like I'm starting over even though I've cooked for ten years"
- "Is this sustainable, or am I dreaming?"

---

## Cohort 3: Casual Browsers

### Who They Are

Cooking already, not urgently planning, but curious what a structured week would cost. Low urgency. Exploratory mindset.

### Needs

- Price intelligence: "What does a week like ours run right now?"
- Benchmarking: "Are we spending more than we should?"
- Preparedness: "I want a list ready in case a busy week hits"
- Low commitment: "I don't want to spend hours on this"

### Behaviors

- May complete onboarding + PLAN phase and stop
- Engage with catalog analysis and readiness scoring more than list generation
- Less likely to use auto-cart
- May return weeks later to continue the wizard
- Free tier is often sufficient for their needs

### Success

- Got price intelligence in under 15 minutes
- Understands their weekly grocery position
- Has a weekly list ready if needed
- Didn't feel pressured to upgrade

### Pain Points

- "I haven't planned a real week of meals in years"
- "I have no idea what our normal grocery run actually costs"
- "I want to be ready when the week gets busy"
- "I don't want to commit to a whole planning system right now"

---

## Cohort 4: Meal-Preppers

### Who They Are

Batch cooks who spend Sunday making the week. Precise about portions, macros, containers, and exact ingredient matches.

### Needs

- Ingredient precision: "Generic swaps won't work — I need the exact cut and the exact grain"
- Portion accuracy: "Don't round my quantities"
- Theme clarity: "Freezer batch cooking is NOT the same as weeknight skillet cooking"
- Import safety: "My list has to load cleanly into the store app"

### Behaviors

- Spend significant time in Ingredient Curation (step 7) — toggling specific items
- Value the staple-frequency data from catalog analysis
- Generate more store list variants (different batch themes = different variants)
- Most likely to re-run catalog analysis with refined queries

### Success

- Staples match actual shelf products, not generic grocery terms
- Each store list emphasizes the right ingredients for that batch theme
- Import-safe formatting loads cleanly into the store app
- Ingredients they excluded don't appear in generated lists

### Pain Points

- "AI planning tools make everything sound interchangeable"
- "They keep adding ingredients I don't actually keep"
- "My list should say 'chicken thighs, bone-in' not 'protein'"
- "I need different versions for different batch weeks"

---

## Cohort 5: Solo Cooks

### Who They Are

Cooking for one. Small recipe box, fast weeknight meals, tight budget. May not know what a full week of planning looks like.

### Needs

- Content amplification: "I only cook five things — help me make the most of them"
- Cost education: "What should I actually be spending on myself?"
- Guidance: "What should I even be planning?"
- Confidence: "Is planning worth it for one person?"

### Behaviors

- Smaller recipe boxes mean faster parsing and simpler taste profiles
- Discovery recipes are highly valuable (they don't know what else is easy)
- Taste Q&A is crucial — surfaces meals, equipment, and shortcuts they undervalue
- Less likely to need many store variants (narrower focus)
- Most price-sensitive — the Free tier matters most to this cohort

### Success

- Discovered meal themes they didn't know were quick
- Taste Q&A surfaced the pantry staples worth building around
- The list scales down cleanly to single portions without waste
- Readiness score gave them confidence to start planning weekly

### Pain Points

- "I only cook a handful of things and I'm bored of all of them"
- "Every recipe serves four and I throw half of it away"
- "I don't know what a sensible grocery budget is for one person"
- "My recipe box is basically three index cards"

---

## Cross-Cohort Design Principles

1. **The wizard must work for all cohorts.** No cohort-specific branching in the flow.
2. **Speed scales with urgency.** Family planners should be able to blast through. Casual browsers can stop after PLAN.
3. **Free tier is meaningful.** Every cohort gets real value from 3 planned meals and 1 list. The gate is on volume, not core functionality.
4. **No patronizing.** Meal-preppers know their kitchen. Don't over-explain. Don't suggest irrelevant swaps.
5. **Taste Q&A is the equalizer.** It surfaces hidden staples for diet switchers and solo cooks. It refines precision for meal-preppers. It's optional for those who don't need it.
