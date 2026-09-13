# Pantry Pilot — Copy Surface Map

This document defines **every copy surface** in the Pantry Pilot product and the rules that apply to each.

Its purpose is to:

- Eliminate ambiguity about tone and structure per surface
- Prevent inconsistent writing across surfaces
- Encode "stakes" so the correct tone is applied automatically

This document works in combination with:

- Master Copy Strategy
- Copy Mechanics & Grammar Rules
- Surface-Specific Writing Rules

If a surface is not listed here, it must be added before copy is written.

---

## How to Read This Document

Each surface includes:

- **Intent**: what the copy is trying to do
- **Stakes**: low / medium / high
- **Structure**: fragment vs sentence, layout expectations
- **Tone range**: how expressive the copy may be

---

## TIER 0 — SYSTEM, TRUST & SAFETY (Highest Stakes)

These surfaces prioritize trust, clarity, and user safety. Personality must never override seriousness here.

### Payment & Subscription Changes

- **Intent:** Confirm cost, execute upgrade or downgrade
- **Stakes:** High
- **Structure:** Full sentences, explicit amounts and billing period
- **Tone range:** Neutral, factual

### Authentication & Account Access

- **Intent:** Build trust, enable secure access
- **Stakes:** High
- **Structure:** Full sentences, 1–2 lines max
- **Tone range:** Reassuring, transparent

### Allergen & Dietary Warnings

- **Intent:** Flag an ingredient that violates a declared restriction
- **Stakes:** High
- **Structure:** Explicit statement of the ingredient and the restriction it breaks
- **Tone range:** Neutral, unambiguous, never softened

### Data Privacy & Export

- **Intent:** Explain data handling, enable control
- **Stakes:** High
- **Structure:** Full sentences, bullet points allowed
- **Tone range:** Neutral, respectful

### Destructive Actions (Data Clearing, Reset)

- **Intent:** Prevent accidental loss
- **Stakes:** High
- **Structure:** Clear title + one sentence body + explicit action buttons
- **Tone range:** Serious, neutral

### Rate Limiting & Budget Exhaustion

- **Intent:** Explain limitation without frustration
- **Stakes:** High
- **Structure:** Short sentence
- **Tone range:** Calm, factual

---

## TIER 1 — CORE PRODUCT UI (Medium Stakes, High Frequency)

These surfaces make up most of the app. Clarity and consistency matter more than personality.

### Phase Pills (PLAN / PREP / SHOP)

- **Intent:** Orient the user in the flow
- **Stakes:** Medium
- **Structure:** Single word, ALL CAPS (structural convention)
- **Tone range:** Neutral

### Step Labels (Search, Analyze, Deep Dive, Ingredients, Lists, Recipes, Shop)

- **Intent:** Name the current activity
- **Stakes:** Medium
- **Structure:** 1–2 words, sentence case
- **Tone range:** Neutral

### Section Headers (within steps)

- **Intent:** Set context for a section
- **Stakes:** Medium
- **Structure:** Fragment, 2–5 words
- **Tone range:** Neutral to lightly direct

### Button CTAs (Primary & Secondary)

- **Intent:** Trigger action
- **Stakes:** Medium
- **Structure:** Verb phrase, 1–3 words
- **Tone range:** Neutral, inviting

Notes:

- No personality flourishes
- No punctuation
- Verb-forward always

### Toggle Labels & Inline Controls

- **Intent:** Describe state or option
- **Stakes:** Medium
- **Structure:** Fragment
- **Tone range:** Neutral

### Progress Labels

- **Intent:** Show where the user is
- **Stakes:** Medium
- **Structure:** Fragment ("3 of 8", "Step 2 of 3")
- **Tone range:** Neutral

### Loading States

- **Intent:** Indicate progress, reduce anxiety
- **Stakes:** Medium
- **Structure:** Fragment + ellipsis
- **Tone range:** Calm, factual

Examples:

- "Reading shelf prices..."
- "Building your list..."
- "Walking the aisles..."

### Success Messages (Toasts, Inline)

- **Intent:** Confirm completion
- **Stakes:** Low
- **Structure:** Short sentence or fragment
- **Tone range:** Positive, restrained

### Error Messages (Non-Critical)

- **Intent:** Recover from failure
- **Stakes:** Medium
- **Structure:** Short sentence, stacked lines allowed
- **Tone range:** Calm, non-blaming

---

## TIER 2 — STATES & DISCOVERY (Lower Stakes, Emotional Impact)

These surfaces influence perception of progress and momentum.

### Empty States

- **Intent:** Acknowledge absence, suggest next step
- **Stakes:** Low
- **Structure:** Fragment header + 1 sentence body
- **Tone range:** Calm, honest, encouraging

### Readiness Score Labels

- **Intent:** Contextualize the score
- **Stakes:** Medium
- **Structure:** 1–3 words
- **Tone range:** Neutral to encouraging
- **Labels (from code):** "Getting started" (0–39), "Building momentum" (40–69), "Well stocked" (70–89), "Fully provisioned" (90–100), "OVERSTOCKED" (>100)

### Celebration Messages (GlazeToast, ConfettiBurst)

- **Intent:** Acknowledge achievement
- **Stakes:** Low
- **Structure:** Short fragment or sentence
- **Tone range:** Positive, energetic (the ONE place for enthusiasm)

### Discovery Recipes

- **Intent:** Suggest non-obvious meals worth trying
- **Stakes:** Medium
- **Structure:** Title + short explanation
- **Tone range:** Informative, intriguing

### Price Intelligence Summaries

- **Intent:** Present catalog data insights
- **Stakes:** Medium
- **Structure:** Structured data with labels
- **Tone range:** Factual, authoritative

### Readiness Gain Indicators

- **Intent:** Show score impact of pending actions (e.g., "+12%" next to a theme toggle)
- **Stakes:** Low
- **Structure:** Fragment with delta indicator ("+X%")
- **Tone range:** Neutral, motivating

### Meal Theme Selection & Ranking

- **Intent:** Let user prioritize meal themes
- **Stakes:** Medium
- **Structure:** Theme name + short descriptor + toggle controls
- **Tone range:** Neutral, informative

### Deep-Dive QA (Taste Accordion)

- **Intent:** Surface household tastes and constraints through targeted questions
- **Stakes:** Medium
- **Structure:** Question (1–2 sentences) + text area for answer
- **Tone range:** Conversational, curious

---

## TIER 3 — ONBOARDING & EDUCATION

These surfaces teach without overwhelming.

### Onboarding Step Titles

- **Intent:** Orient users quickly
- **Stakes:** Medium
- **Structure:** Short fragment, 2–4 words
- **Tone range:** Friendly, simple

### Onboarding Subtitles / Helper Text

- **Intent:** Explain value or reassure
- **Stakes:** Medium
- **Structure:** One short sentence, ≤ 15 words
- **Tone range:** Encouraging, reassuring

### Tooltips & Helper Hints

- **Intent:** Explain non-obvious UI
- **Stakes:** Low
- **Structure:** Fragment or very short sentence
- **Tone range:** Neutral, helpful

Notes:

- Just-in-time only
- No personality unless it improves clarity

### Placeholder Text (Inputs)

- **Intent:** Guide input format
- **Stakes:** Low
- **Structure:** Example value or short instruction
- **Tone range:** Neutral

---

## TIER 4 — CHROME EXTENSION & AUTO-CART

### Extension Status Messages

- **Intent:** Communicate automation state
- **Stakes:** High
- **Structure:** Short status fragment
- **Tone range:** Neutral, factual

### Substitution Rules Display

- **Intent:** Show buy/skip reasoning
- **Stakes:** Medium
- **Structure:** Bullet list, short fragments
- **Tone range:** Factual, direct

### Chrome Prompt (Generated)

- **Intent:** Instruct the browser agent
- **Stakes:** High
- **Structure:** Structured markdown, explicit instructions
- **Tone range:** Technical, precise (not user-facing)

---

## TIER 5 — DEV TOOLS (Test Kitchen)

### Dev Tool Labels & Status

- **Intent:** Developer information
- **Stakes:** Low
- **Structure:** Technical labels
- **Tone range:** Line-kitchen themed (tickets, mise en place, 86'd — allowed ONLY in Test Kitchen context)

Notes:

- Test Kitchen is the only surface where themed personality is unrestricted
- These are never shown to end users

---

## Hard Rules Across All Surfaces

1. No copy surface may contradict the Master Copy Strategy
2. Higher-stakes surfaces always take precedence over lower-stakes
3. If unsure which surface applies, default to the higher-stakes rule
4. New surfaces must be added to this map before copy is written
