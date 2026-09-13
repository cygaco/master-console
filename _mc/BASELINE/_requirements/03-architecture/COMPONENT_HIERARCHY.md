# Pantry Pilot — Component Hierarchy

<!-- SPEC-AHEAD-OF-CODE: Target state relocates MiningAccordion (deep-dive) from OnboardingPage to the Dashboard as a tier-jump activity. Onboarding shrinks from 7 steps to 5 steps (deep-dive removed; ingredient placement retained pending follow-up). Shipped code still hosts deep-dive as onboarding Step 6. Both mappings are shown below. -->

---

## Step-to-Component Mapping

Canonical mapping from onboarding step number to actual component filename. Component filenames carry legacy numbering from refactoring — this table is the single source of truth.

### Onboarding Steps (Target State: 1–5; Shipped: 1–7)

| Step # | Component File | Screen | Status |
|---|---|---|---|
| 1 | Step1Recipes.tsx (IntroScreen) | OnboardingPage | Both |
| 2 | Step3Preferences.tsx | OnboardingPage | Both |
| 3 | Step4Profile.tsx | OnboardingPage | Both |
| 4 | StepCollect.tsx | PrepPage (hosted within OnboardingPage routing) | Both |
| 5 | Step6Analysis.tsx | PrepPage (hosted within OnboardingPage routing) | Both |
| ~~6~~ | ~~(inline MiningAccordion)~~ | Moved to Dashboard (target) | Shipped only |
| 7 | Step8Ingredients.tsx | OnboardingPage | Shipped; target placement TBD |

### Dashboard Sections & Activities (post-onboarding)

| Section / Activity | Component File | Notes |
|---|---|---|
| Command Console | Dashboard.tsx | Readiness meter + quick actions; surfaces "next unlock" hints |
| Deep-Dive Q&A (activity) | MiningAccordion (re-hosted from OnboardingPage) | Target state: optional tier-jump launched from Dashboard. Not present in shipped dashboard. |
| Meal Plans | Step10Plans.tsx | Hosted in Dashboard Meal Plans section |
| Grocery Export | Step11Export.tsx + Step12Download.tsx | Hosted in Dashboard Grocery Export section |
| Auto-Cart | Step13Cart.tsx | Hosted in Dashboard Auto-Cart section |

---

## Architecture Layers

**CRITICAL: `<KitchenConsole>` MUST be the outermost wrapper in the component tree. Do NOT refactor it into a sibling — it is a React context provider that any child can call via `useKC()`.**

```
App Shell (page.tsx)
  └── KitchenConsole (context provider — MUST be outermost)
       └── ToastProvider (notification context)
            ├── Overlays (modals, gates, celebrations)
            │   ├── AuthModal
            │   ├── AuthGate (replaces SoftGate — shown at dashboard entry)
            │   ├── PlanStore
            │   ├── ProfilePage
            │   ├── HubScreen
            │   ├── OnboardingCelebration
            │   └── ConfettiBurst
            │
            ├── Persistent UI
            │   ├── Header (logo, auth, progress pill)
            │   ├── PlanBar (dashboard, authenticated)
            │   └── KeyboardNav (backspace, "?" shortcuts)
            │
            └── Screen Router (by step)
                 ├── No session: IntroScreen
                 ├── Onboarding steps 1–3: OnboardingPage
                 ├── Onboarding steps 4–5: PrepPage (within OnboardingPage routing)
                 ├── Onboarding step 7 (shipped — Ingredients): OnboardingPage (Step8Ingredients)
                 │   // Shipped also routes step 6 here via MiningAccordion — removed in target state
                 └── Post-onboarding: Dashboard
                      ├── Command Console
                      ├── Deep-Dive Q&A activity (target state — MiningAccordion re-hosted)
                      ├── Meal Plans (Step10Plans)
                      ├── Grocery Export (Step11Export + Step12Download)
                      └── Auto-Cart (Step13Cart)
```

---

## Page Composites

Page composites host multiple steps within a single page. They manage sub-step navigation and shared state.

| Component          | Steps | Contains                                                                                                                     |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| **OnboardingPage** | 1–5 (target) / 1–7 (shipped)   | Step1Recipes, Step3Preferences, Step4Profile, PrepPage (4-5). Target state stops here. Shipped adds MiningAccordion (step 6 — relocated to Dashboard in target) and Step8Ingredients (step 7). Sub-steps for step 2: direction, mealtype, budget, store, quickcheck, dealbreakers |
| **PrepPage**       | 4–5   | StepCollect (query generation + Recipe Index trigger), Step6Analysis (menu intelligence). 3-substep architecture. |
| **Dashboard**      | —     | Command Console, Step10Plans, Step11Export + Step12Download, Step13Cart                                |

**Note**: `PlanPage.tsx` is deleted. `PrepPage.tsx` still has its legacy name ("Prep" despite hosting menu research steps).

---

## Step Components

Individual step implementations within page composites.

| Component             | Onboarding Step | Dashboard Section | Purpose                                                                                 |
| --------------------- | --------------- | ----------------- | --------------------------------------------------------------------------------------- |
| **Step1Recipes**      | 1               | —                 | Recipe/pantry import (drag-drop, file, paste), parsing, personal info, household, diet tags |
| **Step3Preferences**  | 2               | —                 | Cooking direction, store, meal types, weekly budget, deal breakers                       |
| **Step4Profile**      | 3               | —                 | AI-generated profile review: cuisine focus, skill level, staples, gaps, strengths        |
| **StepCollect**       | 4               | —                 | Search query generation, avoid terms, Recipe Index trigger                               |
| **Step6Analysis**     | 5               | —                 | Two-phase menu analysis display, category discovery, cost ranges                         |
| **MiningAccordion**   | 6 (shipped)     | Deep-Dive Q&A activity (target state) | Deep-dive Q&A accordion. Shipped: inline in OnboardingPage as step 6. Target: re-hosted as an opt-in Dashboard tier-jump activity. |
| **Step8Ingredients**  | 7               | —                 | Ingredient curation with include/exclude toggles, category grouping                      |
| **Step10Plans**       | —               | Meal Plans        | Master/general/targeted plan generation, DOCX download, diff view                        |
| **Step11Export**      | —               | Grocery Export    | Grocery list content, checkout form answers, copy buttons                                |
| **Step12Download**    | —               | Grocery Export    | Bulk download hub (ZIP + TXT) — thin pass-through                                        |
| **Step13Cart**        | —               | Auto-Cart         | Extension launch, Chrome prompt, heuristics display                                      |

**Note**: Step component numbers don't match wizard step numbers (historical artifact from refactoring).

---

## Atomic UI Components (src/components/ui/)

| Component         | Purpose                      | Props                                                     |
| ----------------- | ---------------------------- | --------------------------------------------------------- |
| **Btn**           | Button with variants         | variant (primary/ghost/outline/danger), loading, disabled |
| **Card**          | Container with border/shadow | className, style                                          |
| **Inp**           | Text input / textarea        | label, value, onChange, error, rows, required             |
| **Sel**           | Select dropdown              | label, value, onChange, options, required                 |
| **Spin**          | Loading spinner (SVG)        | size                                                      |
| **TabBar**        | Tab navigation               | tabs, active, onChange                                    |
| **ProgressSteps** | Step progress indicator      | steps, active                                             |
| **MultiSelect**   | Multi-option button group    | label, options, selected, onChange                        |
| **CopyBtn**       | Copy to clipboard            | text, label                                               |
| **CharCount**     | Character counter            | text, limit                                               |
| **AutoBadge**     | AI-generated indicator       | source                                                    |
| **MemberCard**    | Household member entry editor| entry, index, onChange, onRemove                          |
| **LocCombo**      | Store / location autocomplete| label, value, onChange                                    |
| **Toast**         | Toast notification system    | Provider + useToast() hook                                |
| **ErrorBoundary** | Error fallback wrapper       | children, fallback, onReset                               |
| **PrivacyModal**  | Data export/import/privacy   | onClose                                                   |

---

## Feature Components

| Component                 | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| **Dashboard**             | Post-onboarding command center with sidebar + four sections     |
| **PlanBar**               | Persistent header: readiness meter + weekly quota + CTA         |
| **ReadinessMeter**        | Arc visualization of 0–160+ score (compact + full)              |
| **GlazeToast**            | Score bracket transition celebration toast                      |
| **ConfettiBurst**         | Particle celebration animation                                  |
| **IntroScreen**           | Landing page with recipe import CTA                             |
| **HubScreen**             | Mission Control — returning user dashboard overlay              |
| **OnboardingProgress**    | Step header with title/subtitle/progress bar                    |
| **OnboardingCelebration** | Post-onboarding celebration overlay                             |
| **PlanDisplay**           | Meal plan preview renderer                                      |
| **AuthModal**             | Sign-in/sign-up overlay                                         |
| **AuthGate**              | Dashboard entry auth prompt (replaces SoftGate)                 |
| **PlanStore**             | Subscription upgrade modal (Free / Plus / Family)               |
| **ProfilePage**           | User profile viewer/editor                                      |
| **ProfileEditor**         | Profile field editor                                            |
| **KeyboardNav**           | Keyboard shortcut handler                                       |
| **KCBadge**               | Dev tools indicator badge                                       |

---

## Kitchen Console Modules (src/components/kc-modules/)

| Module                   | Purpose                                 |
| ------------------------ | --------------------------------------- |
| **PrepBowlModule**       | Fixture Profile CRUD, test data loading |
| **QAModule**             | Automated test suite runner          |
| **DataInspectorModule**  | Live session data field inspector    |
| **PipelineTracerModule** | Request timeline visualization       |
| **BillingModule**        | Auth, plan quota, Stripe debug       |
