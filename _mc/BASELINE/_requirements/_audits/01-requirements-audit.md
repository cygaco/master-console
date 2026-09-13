# Requirements Audit Report

**Date:** 2026-03-30
**Scope:** All 14 features
**Features audited:** 14 (auth, extension, household, meal-discovery, onboarding, plan-generation, plan-tiers, recipe-curation, recipe-import, shell, shopping-mode, sous-chef, taste-qa, week-readiness)

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 9 |
| HIGH | 17 |
| MEDIUM | 18 |
| LOW | 15 |

*Post-verification: 5 "missing Entry State" findings downgraded (week-readiness, sous-chef, extension, household, plan-tiers are cross-cutting/overlay — Entry State only required for step components per GRANULAR_STORIES.md). Button text, PROMPTS.md refs, RecipeEntry type, AGENTS.md list, extension platform language all FIXED.*

## Agent Risk Assessment

If we ran builders now, the top risks are:

1. **Missing Entry State metadata** in meal-discovery (28 stories for Steps 4-5) — builders will implement only happy paths.
2. **Week-readiness scoring formula ambiguity** (plan-generation) — two features will implement contradictory scoring math.
3. **Button text / copy mismatches** across stories, COPY, and INPUTS files (taste-qa, onboarding) — builders will implement wrong labels.
4. **Missing TypeScript field** (`priority` on `RecipeEntry`) — recipe-curation builder will fail type checking immediately.

## Findings by Category

### 1. Standards Compliance

#### Missing Entry State Metadata (step-component features only)

*Per GRANULAR_STORIES.md: Entry State required only for step/screen component stories. Cross-cutting features (week-readiness, sous-chef, extension, household, plan-tiers) correctly omit it — their stories are utility/overlay, not wizard steps.*

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 1 | HIGH | No `Entry state:` on any of 28 stories for Steps 4-5 | meal-discovery/STORIES.md | Add Entry state per FLOW_SPEC.md Step 4-5 tables |
| 2 | MEDIUM | auth has only 1 Entry state across 28 stories — auth modal stories could benefit from entry context | auth/STORIES.md | Add Entry state where auth modal entry conditions vary |

#### Systemic: Sparse CS-XXX Inheritance
| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 8 | MEDIUM | 22/27 stories missing Inherits field | recipe-import/STORIES.md | Add CS-001, CS-005, CS-006 where applicable |
| 9 | MEDIUM | 13/28 stories missing Inherits field | meal-discovery/STORIES.md | Add CS-008, CS-009 for API call stories |
| 10 | MEDIUM | Only 1/28 stories has Inherits | week-readiness/STORIES.md | Review all for CS-001 applicability |
| 11 | MEDIUM | Only 1/29 stories has Inherits | extension/STORIES.md | Add CS-003 where validation occurs |

#### PRD Section Issues
| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 12 | HIGH | JTBD uses platform-specific "browser extension", "popup" | extension/PRD.md §4 | Reword to "automation agent" |
| 13 | HIGH | Goals use "Extension"/"Popup" | extension/PRD.md §6 | Reword to platform-neutral |
| 14 | HIGH | HL-EXT-06 uses "popup" in title and AC | extension/HL-STORIES.md | Rename to "Agent Status Interface" |
| 15 | MEDIUM | "heartbeat" is implementation detail in HL story | extension/HL-STORIES.md HL-EXT-07 | Replace with "connectivity monitoring" |

#### Onboarding-Specific Standards Issues
| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 16 | CRITICAL | Exit gates vacuous due to pre-selected defaults | onboarding/INPUTS.md (4 sections) | Reframe to reflect user agency |
| 17 | CRITICAL | Missing prevention/boundary rules across stories | onboarding/STORIES.md (most stories) | Add explicit boundary rules per story |
| 18 | CRITICAL | GS-ONB-14 merge not formally archived | onboarding/STORIES.md | Mark as ARCHIVED |
| 19 | HIGH | 3 HL stories classified Post-MVP but PRD says MVP | onboarding/HL-STORIES.md (03, 06, 07) | Reclassify to MVP |
| 20 | HIGH | HL-ONB-08 uses "Product Manager" as actor | onboarding/HL-STORIES.md | Reframe as User story |

### 2. Vertical Consistency

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 21 | CRITICAL | Button text mismatch: "Continue taste check"/"Skip to recipes" vs "Keep going"/"Skip & finish" | taste-qa/STORIES.md vs COPY.md & INPUTS.md | Reconcile — INPUTS/COPY is source of truth |
| 22 | CRITICAL | PRD UI mock button text also differs from COPY | taste-qa/PRD.md §12 | Update to match COPY.md |
| 23 | HIGH | Missing INPUTS controls for substitution rules / budget cap review pre-shop | shopping-mode/INPUTS.md | Add read-only review sections |
| 24 | HIGH | Missing copy for auto-import, edit recipe text, re-import flows | onboarding/COPY.md | Add missing copy entries |
| 25 | MEDIUM | HL-IMP-06 (Preview) scope conflict: Post-MVP in HL but MVP in GS stories | recipe-import/HL-STORIES.md vs STORIES.md | Decide and align |
| 26 | MEDIUM | Missing OAuth "coming soon" copy | auth/COPY.md | Add OAuth unavailability section |
| 27 | MEDIUM | Missing empty/initial state copy | auth/COPY.md | Add initial modal state strings |
| 28 | MEDIUM | Missing "Great match"/"Worth a try" badge copy | plan-generation/COPY.md | Add 2 missing badge labels |
| 29 | MEDIUM | FOMO copy discrepancy (positive vs negative framing) | week-readiness/COPY.md vs STORIES.md | Pick one framing, align |
| 30 | LOW | COPY template variables not documented | recipe-import/COPY.md | Add Parameters table |

### 3. Horizontal Consistency (Cross-Feature)

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 31 | CRITICAL | Week-readiness scoring formula internally inconsistent — denominator ambiguous | plan-generation/PRD.md §11, GS-PLN-15 | Clarify: total_planned vs total_slots |
| 32 | CRITICAL | Parallel build ordering comment inaccurate (GS-PLN-08/09/11 deps) | plan-generation/STORIES.md | Fix dependency comment |
| 33 | HIGH | Step exit gate for targeted week plans unspecified (required or optional?) | plan-generation/INPUTS.md | Clarify step progression rules |
| 34 | HIGH | Downstream data contract wires incomplete (rankedRecipes, importedRecipes) | plan-generation/INPUTS.md | Expand downstream table |
| 35 | HIGH | PlanPage.tsx listed in shell PRD but owned by meal-discovery | shell/PRD.md §13 | Remove PlanPage from shell impl map |
| 36 | MEDIUM | Cross-feature story inheritance missing — downstream features don't reference TIR stories | plan-tiers (systemic) | Add Inherits: GS-TIR-06 to consuming features |
| 37 | MEDIUM | Goal clarity gap — Free tier "success" scenario ambiguous | plan-tiers/PRD.md §6 | Clarify the 3-planned-meals week as baseline |
| 38 | MEDIUM | GS-TIR-11 idempotency dependency implicit | plan-tiers/STORIES.md | Make AC explicit about Redis check |

### 4. Agent-Readability

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 39 | CRITICAL | Missing `priority` field on RecipeEntry TypeScript interface | src/lib/types.ts line 183-191 | Add `priority?: number` |
| 40 | HIGH | GS-ONB-03 AC references household size/diet flags but unclear if PARSE produces them | onboarding/STORIES.md | Clarify which fields come from PARSE vs user |
| 41 | HIGH | GS-ONB-18 "all preferences saved" gate undefined — which substeps? | onboarding/STORIES.md | List all 6 prerequisite substep story IDs |
| 42 | HIGH | GS-TAS-15 example answers build process under-specified | taste-qa/STORIES.md | Add storage location, count, generation method |
| 43 | HIGH | GS-TAS-20 chat message storage — dismissed questions unclear | taste-qa/STORIES.md | Clarify: dismissed = no chat entry |
| 44 | HIGH | Step 2 vs Step 3 boundary unclear (Quick Check vs Recipe Confirm) | onboarding/STORIES.md GS-ONB-23/24 | Clarify data ownership per step |
| 45 | MEDIUM | Import confidence badge UI treatment unspecified | recipe-import/INPUTS.md | Add color/icon spec |
| 46 | MEDIUM | Shop mode entry state should be "List-complete" not "Any" | shopping-mode/STORIES.md GS-SHP-12-14 | Update entry state |
| 47 | MEDIUM | "Finish" button exit gate contradicts week-readiness bonus requirement | shopping-mode/INPUTS.md | Clarify bonus vs no-bonus finish paths |
| 48 | LOW | GS-ONB-12 AC embeds TypeScript hygiene rule | onboarding/STORIES.md | Move to developer note |
| 49 | LOW | COPY.md "page refreshes" should be "session restore" | week-readiness/STORIES.md GS-RDY-27 | Replace platform term |

### 5. Agent Failure Modes

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 50 | HIGH | Diet preset enum in stories not auto-validated against prompts.ts | onboarding/STORIES.md GS-ONB-19 | Reference prompts.ts as source of truth |
| 51 | HIGH | Component naming debt (Step3Preferences = Step 2, Step4Household = Step 3) | onboarding/PRD.md §2 | Add explicit mapping table |
| 52 | MEDIUM | Platform terminology inconsistency in COPY ("Pantry Pilot Clipper" vs "Chrome extension") | shopping-mode/COPY.md | Standardize to "Pantry Pilot Clipper" in generic text |
| 53 | MEDIUM | Circular/unclear dependency on substitution rules in extension payload assembly | shopping-mode/STORIES.md GS-SHP-20/31 | Add explicit data availability note |
| 54 | LOW | Missing loading states for extension connection and prompt generation | shopping-mode/COPY.md | Add 3 loading copy entries |

### 6. Standards Cross-Check

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 55 | MEDIUM | PRD_TEMPLATE says "Open Questions" but CLAUDE.md says "Decisions" also accepted | PRD_TEMPLATE.md §16 vs CLAUDE.md | Both names accepted — document in template |
| 56 | LOW | Agent Instructions header format inconsistent (HTML comment vs block quote) | Varies across HL-STORIES files | Standardize — HTML comment is the correct format per HIGH_LEVEL_STORIES.md |
| 57 | LOW | Story ID format varies (2-digit GS-ONB-01 vs 3-digit GS-HH-001) | Cross-feature | Pick one convention and standardize |

### 7. Completeness Gaps

| # | Severity | Finding | Location | Suggested Fix |
|---|---|---|---|---|
| 58 | HIGH | Missing loading states in COPY for 3 features | shopping-mode, onboarding COPY.md | Add loading copy |
| 59 | HIGH | Celebration screen referenced but not detailed | onboarding/STORIES.md GS-ONB-21 | Add celebration screen spec |
| 60 | HIGH | Store picker missing tablet breakpoint | onboarding/INPUTS.md | Add 641-1024px guidance |
| 61 | HIGH | Diet "Avoid" vs "Dislike" purpose unclear | onboarding/INPUTS.md | Clarify relationship |
| 62 | MEDIUM | Diet dropdown missing Pescatarian/Halal/Kosher | onboarding/INPUTS.md | Expand options |
| 63 | MEDIUM | Deal-breaker "Nut-free only" visibility rule ambiguous | onboarding/INPUTS.md | Clarify: exclusive selection or any inclusion |
| 64 | MEDIUM | Meal-style presets copy doesn't clarify control type or selection model | onboarding/COPY.md | Expand with card/single-select note |
| 65 | LOW | Quick Check toggle interaction model (opt-in vs state) ambiguous | onboarding/COPY.md | Clarify default behavior |
| 66 | LOW | Button text inconsistent tense/arrow usage across onboarding | onboarding/COPY.md | Standardize pattern |
| 67 | LOW | GS-ONB-25 concurrent save safety not specified | onboarding/STORIES.md | Add debounce/serialization rule |
| 68 | LOW | Weekly budget label clarity (primary vs helper) | onboarding/INPUTS.md | Clarify which is primary |
| 69 | LOW | Store picker fallback interaction unclear (free-text validation, return to list) | onboarding/INPUTS.md | Detail fallback UX |

## Top 10 Actions Before Next Run

1. **Add Entry State metadata to meal-discovery** (28 stories for Steps 4-5) — only step-component feature missing it (1 finding)
2. **Fix week-readiness scoring formula** in plan-generation PRD §11 — clarify denominator, cap behavior, OVERSTOCK threshold (2 findings)
3. **Reconcile button text mismatches** in taste-qa (stories vs COPY/INPUTS) and onboarding (PRD UI ref vs COPY) (3 findings)
4. **Add `priority?: number` to RecipeEntry** in types.ts — type blocker for recipe-curation builder (1 finding)
5. **Fix extension platform-neutrality violations** — JTBD, Goals, and HL story "popup" references (4 findings)
6. **Reclassify 3 onboarding HL stories** from Post-MVP to MVP to match PRD (3 findings)
7. **Add missing INPUTS controls** for shopping-mode substitution rules / budget cap review (1 finding)
8. **Complete CS-XXX inheritance audit** across recipe-import (22 stories), meal-discovery (13), week-readiness (27), extension (28) (4 findings)
9. **Fix onboarding exit gates** that are vacuous due to pre-selected defaults (1 finding, 4 sections)
10. **Add missing COPY entries** across auth (OAuth "coming soon"), plan-generation (2 badges), shopping-mode (3 loading states), onboarding (re-edit flow) (5 findings)
