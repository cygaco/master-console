# Pantry Pilot — Product Evolution Spec

Future ideas and post-MVP vision. Nothing in this document is canonical — these are possibilities, not commitments.

---

## Status: Non-Canonical

This document captures ideas that have been discussed or considered. They are NOT approved, planned, or prioritized. They exist to prevent good ideas from being forgotten and to provide context for future planning sessions.

### Implementation Status

Some items listed below have already been implemented. This table distinguishes DONE from FUTURE:

| Item | Status | Evidence |
|---|---|---|
| PDF export | DONE | `src/lib/pdf-generator.ts` |
| DOCX export | DONE | `src/lib/docx-generator.ts` |
| Mobile responsive | FUTURE | Desktop-first per FLOW_SPEC |
| Nutrition summaries | FUTURE | Not in current feature backlog |
| Multi-store catalogs | FUTURE | Only one partner chain via Fresh Feed |
| Shopping-trip tracking | FUTURE | No tracking beyond cart history |

---

## Near-Term Improvements (Enhance What Exists)

### Multi-Store Catalog Lookups

- Add a second and third partner chain alongside the current one
- Normalize pack sizes and units across sources
- Richer price intelligence from a broader catalog set

### Shopping-Trip Tracking

- Track which lists were actually shopped (from auto-cart logs)
- Status tracking: planned → shopped → cooked → restocked
- Restock reminders for staples

### List Format Options

- Multiple printable layouts (aisle order, category order, compact)
- PDF export alongside DOCX
- Custom formatting controls (font, spacing, sections)

### Improved Catalog Re-Runs

- Show diff between old and new price analysis
- Track how prices have changed over time
- Alert when a staple drops below its usual range

### Mobile Responsive

- Full mobile support for the wizard
- Touch-optimized interactions, built for use in the aisle
- Mobile-first onboarding flow

---

## Medium-Term Features (Expand Scope)

### Nutrition Summaries

- Per-meal and per-week nutrition rollups from the plan
- Templated sections with household-specific targets
- Detail control (simple, standard, full macros)

### Leftover Planning

- Suggested second-day meals from the week's surplus portions
- Portion math that accounts for pack sizes bought
- Freezer-batch recommendations for the meal-prep cohort

### Household Sharing Recommendations

- Identify which household members can own which prep tasks
- Generate assignment message templates
- Shared-list invitation copy

### Multi-Language Support

- Recipe cards and lists in multiple languages
- Price analysis for non-US stores
- Localized units (metric pack sizes)

---

## Long-Term Vision (Transform the Product)

### Continuous Price Intelligence

- Ongoing catalog monitoring (not just one-time analysis)
- Alerts when a planned ingredient goes on sale
- Price trend reports over time

### Team / Small-Business Features

- Caterer-side view for small meal businesses
- Batch plan processing across many households
- Household analytics and reporting

### API / Integration Layer

- Pantry Pilot as a service (API access to list generation, price analysis)
- Integration with grocery delivery platforms
- Webhook notifications for price drops

### AI Agent Improvements

- Smarter auto-cart with learning from user substitutions
- A/B testing of list variants (track which gets shopped fully)
- Autonomous restocking with user-defined criteria

---

## Technical Debt to Address

### Architecture

- Replace prop-drilling with proper state management (Zustand or Context)
- Fix component naming inconsistencies (PrepPage ↔ PlanPage mismatch)
- Standardize styling approach (one system: CSS custom properties OR Tailwind, not both)
- Add proper error boundaries at the step level

### Performance

- Upgrade from Vercel Hobby to Pro (longer function timeouts)
- Implement proper caching for catalog data
- Optimize large component re-renders (Step10Lists is very large)

### Quality

- Add proper TypeScript strict mode enforcement
- Comprehensive test coverage (unit + integration)
- Accessibility audit and remediation
- Performance monitoring and alerting

---

## Ideas Explicitly NOT Pursuing

For clarity, these ideas have been considered and rejected:

1. **Social features** — Pantry Pilot is a household tool, not a social platform
2. **Gamification beyond the readiness score** — No achievements, streaks, or leaderboards
3. **Recipe photo editor / visual layout tool** — Content-first, not design-first
4. **Free unlimited access** — Subscription tiers are fundamental to sustainability
5. **B2B enterprise play** — Focus on individual households first
