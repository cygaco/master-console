# Test Coverage Roadmap

Sources of truth:
- Patterns: `_requirements/PATTERNS.md`
- Helpers: `_requirements/_shared/helpers/{dummy-plug,assertions,upload}.ts`
- Fixtures: `_requirements/_shared/fixtures/files/`
- Live status: `npm run test:stale-check`

✓ = file exists and tests pass · ⚠ = file exists, tests pending or partial · ✗ = file not yet written

## P0 (production-critical surfaces)

| Feature | Spec file | Status | Notes |
|---|---|---|---|
| onboarding | `onboarding/tests/smoke.spec.ts` | ✓ | App loads, intro renders, health check |
| onboarding | `onboarding/tests/step-walk.spec.ts` | ✓ | Dummy-plug walks all 10 steps + dark theme + persistence |
| onboarding | `onboarding/tests/step1-recipes.spec.ts` | ✓ | Import PDF/DOCX/corrupt/empty/PNG/drop-zone — 7 tests |
| onboarding | `onboarding/tests/step2-preferences.spec.ts` | ✗ | Store, meal type, budget filters |
| onboarding | `onboarding/tests/step3-profile.spec.ts` | ✗ | Parsed-recipe editing |
| onboarding | `onboarding/tests/step4-search.spec.ts` | ✗ | StepCollect — recipe catalog collection |
| onboarding | `onboarding/tests/step5-analysis.spec.ts` | ✗ | Step6Analysis — catalog analysis |
| onboarding | `onboarding/tests/step6-deep-dive.spec.ts` | ✗ | DeepDiveQA |
| onboarding | `onboarding/tests/step7-ingredients.spec.ts` | ✗ | Step8Ingredients — exclusions |
| onboarding | `onboarding/tests/step8-plans.spec.ts` | ✗ | Step10Plans — generation |
| onboarding | `onboarding/tests/step9-export.spec.ts` | ✗ | Step11Export |
| onboarding | `onboarding/tests/step10-cart.spec.ts` | ✗ | Step13Cart — extension setup |
| backend | `backend/tests/gate-dodger.spec.ts` | ✓ | API security; 13 tests including BUG-009 regression |
| auth | `auth/tests/login.spec.ts` | ✓ | Login API + intro CTA — 5 tests including non-leak |
| auth | `auth/tests/register.spec.ts` | ✗ | Email/password registration + initial Free-tier quota |
| auth | `auth/tests/oauth.spec.ts` | ✗ | Google + Apple OAuth round-trip |
| auth | `auth/tests/logout.spec.ts` | ✗ | Cookie clear + Redis session delete |
| auth | `auth/tests/session-persist.spec.ts` | ✗ | Cookie survives reload |
| usage-economy | `usage-economy/tests/plan-bar.spec.ts` | ✓ | Bar renders + API auth surface — 5 tests |
| usage-economy | `usage-economy/tests/plan-store-modal.spec.ts` | ✗ | Pricing modal opens, tier selection |
| usage-economy | `usage-economy/tests/grant-debit.spec.ts` | ✗ | Granting on signup, debit on Claude call |
| stripe | `stripe/tests/checkout.spec.ts` | ✗ | Tier-redirect + success callback (Redis-gated) |
| shell | `shell/tests/nav.spec.ts` | ✗ | Header nav + dashboard mount |
| shell | `shell/tests/theme-toggle.spec.ts` | ✗ | Dark/light theme switch + no flash |

## P1 (post-onboarding feature surfaces)

| Feature | Spec file | Status |
|---|---|---|
| catalog-research | `catalog-research/tests/recipe-collection.spec.ts` | ✗ |
| catalog-research | `catalog-research/tests/results-display.spec.ts` | ✗ |
| catalog-research | `catalog-research/tests/filters.spec.ts` | ✗ |
| deep-dive-qa | `deep-dive-qa/tests/qa-mining.spec.ts` | ✗ |
| ingredient-curation | `ingredient-curation/tests/exclusions.spec.ts` | ✗ |
| ingredient-curation | `ingredient-curation/tests/lock-propagation.spec.ts` | ✗ |
| week-readiness | `week-readiness/tests/score-display.spec.ts` | ✗ |
| week-readiness | `week-readiness/tests/glaze-toast.spec.ts` | ✗ |
| meal-plans | `meal-plans/tests/master-plan.spec.ts` | ✗ |
| meal-plans | `meal-plans/tests/targeted-plan.spec.ts` | ✗ |
| meal-plans | `meal-plans/tests/download.spec.ts` | ✗ |
| grocery-export | `grocery-export/tests/content-package.spec.ts` | ✗ |
| grocery-export | `grocery-export/tests/copy-buttons.spec.ts` | ✗ |
| profile | `profile/tests/edit-fields.spec.ts` | ✗ |

## P2 (extension + debug surfaces)

| Feature | Spec file | Status |
|---|---|---|
| auto-cart | `auto-cart/tests/extension-handshake.spec.ts` | ✗ |
| auto-cart | `auto-cart/tests/queue-render.spec.ts` | ✗ |
| extension | `extension/tests/manifest-load.spec.ts` | ✗ |
| extension | `extension/tests/popup-render.spec.ts` | ✗ |
| kitchen-console | `kitchen-console/tests/kc-modules.spec.ts` | ✗ |

## Coverage at Phase D close

- ✓ done: 5 spec files, 37 tests passing
- ✗ remaining: ~38 spec files, est. ~150 tests
- Foundation: PATTERNS.md, upload helpers (4 patterns), 7 fixture files, `test:stale-check`

The infrastructure is in place. Each remaining spec file is a focused 30-60 minute task: read the corresponding `_requirements/04-features/<feature>/{PRD,STORIES,COPY,INPUTS}.md`, follow PATTERNS.md, write the tests. Skeleton-state tolerance (404/410/501) keeps every test forward-compatible with run-12's incomplete API namespace.

## How to add a new spec file

1. Open `_requirements/04-features/<feature>/STORIES.md` — pick one HL-STORY
2. Open `_requirements/PATTERNS.md` — pick the pattern that matches (form / nav / upload / API)
3. Create `_requirements/<feature>/tests/<story>.spec.ts`
4. `npm run test:<feature>` — should be green
5. `npm run test:stale-check` — should now show ✓ for that feature
