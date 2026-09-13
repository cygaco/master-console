# Pantry Pilot — Golden Paths

<!-- SPEC-AHEAD-OF-CODE: The Primary Path below reflects the target state the next skeleton build will realize. Deep-Dive Q&A moves from an onboarding step into the dashboard as an optional tier-jump activity. Shipped code still sequences deep-dive inside onboarding (between catalog analysis and ingredients). -->

Critical user journeys end-to-end. These are the paths that MUST work flawlessly. If any golden path breaks, the product is broken.

---

## Golden Path 1: Full Journey (Recipe Box → Dashboard → Filled Cart)

**The primary journey.** An active weekly planner completes onboarding and then opts into dashboard activities to reach maximum readiness.

### Flow (Target State)

<!-- SOURCE OF TRUTH: _requirements/00-canonical/STEPS.json — the flow diagram below reflects the registry's phase ordering + step positions. Propagation is manual until /maps:steps regenerates this section automatically. -->


<!-- maps:steps:START (region=golden-paths-flow) --- auto-generated from _requirements/00-canonical/STEPS.json; do not edit manually. Regenerate: /maps:steps or node scripts/generate-steps-maps.js -->

**Onboarding phase (linear, required):**

```
IMPORT → PREFERENCES → PROFILE → SEARCH → CATALOG_ANALYSIS → [ENTER DASHBOARD]
```

**Dashboard phase (optional, user-ordered):**

```
dashboard → {DEEP_DIVE, INGREDIENTS, LISTS, RECIPES, AUTO_CART}
```

The user enters the dashboard after completing 5 onboarding steps. From the dashboard they opt into any of 5 optional activities in any order — each contributes to the readiness score.

<!-- maps:steps:END (region=golden-paths-flow) -->

The primary path changes from a linear `import → parse → catalog → deep-dive → list → cards → auto-cart` to `import → parse → catalog → dashboard → (dashboard activities)`. Deep-Dive Q&A is no longer a forced gate before list generation — users see their baseline dashboard first, then opt into deep-dive (and other activities) to tier-jump.

### Emotional Arc

| Phase      | Step / Activity | Emotion         | What Happens                           |
| ---------- | --------------- | --------------- | -------------------------------------- |
| Onboarding | 1               | Trust           | "It read my recipes correctly"         |
| Onboarding | 2               | Control         | "I'm setting our rules"                |
| Onboarding | 3               | Validation      | "It understood how we eat"             |
| Onboarding | 4 (prep)        | Anticipation    | "Let's see what a week could look like" |
| Onboarding | 4 (sweep)       | Momentum        | Catalog sweep runs — fetch + analysis, one screen |
| Onboarding | 4→5 (CTA)       | Satisfaction    | "Analysis complete — menu ready"       |
| Onboarding | 5 (select)      | Discovery       | "I didn't think of cooking it that way" |
| —          | Dashboard entry | Orientation     | Baseline score visible, clear next unlocks |
| —          | Auth Gate       | Pause           | Auth prompt at dashboard entry (dismissible) |
| Dashboard  | Deep-Dive QA    | Depth           | "Now it really knows us" — optional tier-jump |
| Dashboard  | Ingredients     | Control → Trust | "These are our ingredients" → "It caught the ones we hate" → "I'll add what we keep" |
| Dashboard  | Lists           | Tangible output | "I have a real, printable grocery list" |
| Dashboard  | Recipes         | Completeness    | "The cards are done too"               |
| Dashboard  | Auto-Cart       | Momentum        | "Everything is ready. Let's shop."     |

### Catalog Sweep Detail (Steps 4-5) — LOCKED FLOW

This flow took weeks to get right. **Do NOT restructure without user approval.**

```
MENU MISSION SCREEN (PrepPage substep 0)
├── Query editor: 3-6 editable search vectors
├── No-buy zones: avoid ingredients as removable tags
└── [Build My Week] button
        │
        ▼
CATALOG SWEEP (PrepPage substep 0→1, same screen)
├── Fetch phases:
│   ├── "Walking the aisles..."
│   ├── "Reading shelf labels..."
│   ├── "Collecting prices and pack sizes..."
│   ├── "Sweeping remaining departments..."
│   └── "Compiling the catalog report..."
├── Analysis phases (seamless continuation, no screen change):
│   ├── "Finding staple ingredients..."
│   ├── "Mapping price ranges..."
│   ├── "Grouping meal themes..."
│   └── "Building your menu..."
└── "Analysis complete — menu ready"
    ├── N meal themes identified
    ├── Weekly price range summary
    └── [View Your Menu] CTA
            │
            ▼
LOCK YOUR MENU SCREEN (PrepPage substep 2)
├── Theme cards: name, price range, item count, match badge
├── Toggle on/off (NO ranking/reordering)
├── Discovery recipes (add up to 10 total)
├── FOMO warning for deselected themes
├── [Refresh Analysis] re-runs without re-fetching the catalog
└── [Lock menu (N) →] writes rankedThemes, ends onboarding, enters dashboard
            │
            ▼
DASHBOARD (baseline readiness score visible)
├── Deep-Dive Q&A (optional tier-jump activity)
├── Ingredients / Lists / Recipes / Auto-Cart (opt-in)
```

> **Target-state note:** Locking the menu now advances directly to the **Dashboard** (with a baseline readiness score shown), not to a forced Deep Dive step. Deep-Dive Q&A is launchable from the dashboard as an optional tier-jump activity. Shipped code still routes the user directly into Deep Dive after menu lock.

**Implementation:** PrepPage uses 3-substep architecture with a single Step6Analysis instance (display:none toggle, NOT conditional mount). See FLOW_SPEC.md for the substep table and HYGIENE Rule 53 for why.

### Critical Moments

1. **Recipe parsing must succeed** — if it fails, user has no path forward
2. **Catalog sweep must feel continuous** — fetch → analysis → CTA on ONE screen, no flash
3. **Catalog analysis must return themes** — empty results = dead end
4. **Theme selection must NOT include ranking** — toggle only, no reorder UI (HYGIENE Rule 52)
5. **List generation must produce a valid PDF** — this is the tangible deliverable
6. **Readiness score must increase** — flat score = no sense of progress

---

## Golden Path 2: Price Intelligence Only

**Casual browser or explorer.** User wants to understand what a week of meals costs without committing to full planning.

### Flow

```
Import recipes → Set preferences → Generate taste profile
  → Generate queries → Fetch store catalog → Catalog analysis
  → Review themes, price ranges, staple keywords
  → [STOP or continue to PREP]
```

### Emotional Arc

| Step | Emotion                                          |
| ---- | ------------------------------------------------ |
| 1–3  | Quick setup, low commitment                      |
| 4    | Curiosity                                        |
| 5    | Insight ("So THAT'S what a week actually costs") |

### Critical Moments

1. **Must deliver value by step 5** — user may not go further
2. **Price data must feel real** — this is what casual browsers care about most
3. **Themes must feel actionable** — not abstract cuisine groupings
4. **Free tier must cover this path** — catalog analysis first run is free

---

## Golden Path 3: List Generation Sprint

**User who already knows what they're cooking.** Skips deep analysis, focuses on generating store lists as fast as possible.

### Flow

```
Import recipes → Quick preferences → Taste profile
  → Generate queries → Quick catalog scan → Lock menu
  → Skip or fast Deep Dive → Quick ingredient review (4-substep flow) → Generate all lists
  → Download PDF files
```

**Current status:** The app supports this flow — all steps can be completed quickly with minimal input. Deep-Dive QA can be answered briefly or skipped (accordion collapse). Bulk list generation with ZIP download is implemented.

### Critical Moments

1. **Bulk generation must work** — user wants 5+ store variants in one pass
2. **PDF downloads must work** — the primary deliverable
3. **Tier limits must be clear** — user upgrading to cover multiple themes
4. **Download All must bundle correctly** — ZIP with all variants

---

## Golden Path 4: Returning User

**User who started a session, left, and came back.** Data must persist and the experience must be seamless.

### Flow

```
Open app → Session loads from localStorage (or server)
  → HubScreen shows progress summary
  → User navigates to where they left off (or any completed step)
  → Continues wizard
```

### Critical Moments

1. **Session must load correctly** — encrypted localStorage decryption must succeed
2. **HubScreen must show accurate state** — which steps are done, current progress
3. **Backward navigation must work** — user may want to revisit earlier steps
4. **No data loss** — everything they entered must be there
5. **Schema migration must work** — if the app was updated since their last visit

---

## Golden Path 5: Upgrade to Plus

**User hits a paid feature and needs to upgrade.**

### Flow

```
User triggers a Plus operation (store list, recipe cards, catalog re-run)
  → Free tier exhausted → Soft prompt or modal
  → User clicks "Upgrade" → Tier picker opens
  → Selects tier (Plus/Family) → Stripe checkout
  → Returns with ?upgrade=success → Tier unlocked
  → Retries original operation
```

### Critical Moments

1. **Cost must be clear BEFORE the action** — never surprise with a charge
2. **Stripe redirect must return cleanly** — `?upgrade=success` must trigger a tier reload
3. **Tier must unlock immediately** — no stale cache showing the old tier
4. **Original operation must be retryable** — user shouldn't have to redo steps

---

## Golden Path 6: Auto-Cart via Extension

**User launches the Chrome extension for one-click cart fill at a partner store.**

### Flow

```
User reaches step 10 → Reviews substitution rules → Installs extension (if needed)
  → Launches auto-cart → Extension scans the store catalog
  → For each item: evaluate substitution rules → add to cart → PAUSE for review
  → User approves or skips → Extension adds or moves on
  → Running log of added items
```

### Critical Moments

1. **Extension must detect correctly** — clear message if not installed
2. **Substitution rules must be sensible** — buy-if/skip-if signals must match real shelf products
3. **NEVER auto-checkout** — always pause for user approval
4. **Swap answers must be accurate** — pack size, brand tolerance, delivery slot
5. **List selection must match the theme** — right store variant for each trip

---

## Anti-Patterns (What Must NOT Happen)

1. **Dead ends** — User reaches a state where no action is possible and no guidance is given
2. **Silent failures** — Operation fails but UI doesn't update or show error
3. **Data loss** — Session data disappears or corrupts without warning
4. **Stale outputs** — List generated from old catalog prices after user re-ran analysis
5. **Invisible limits** — Free-tier allowance consumed without clear prior notification
6. **Forced commitment** — User feels trapped in a step they can't exit
7. **Broken downloads** — PDF file is corrupted or contains wrong content
8. **Dishonest defaults** — Ingredients the household doesn't want included by default (catalog-only staples must default to excluded)
9. **iOS toggle switches** — Not part of the design system. All boolean lists use card-row boxes (COMPONENT_LIBRARY.md)
10. **Colored source dots / star priorities** — Removed in Run 007. Must not reappear in any form
