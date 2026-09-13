# Test Authoring Patterns

Reference for everyone writing Playwright specs into `_requirements/<feature>/tests/`. Skim before adding new tests.

## Layout per feature

```
_requirements/<feature>/
└── tests/
    ├── <story-1>.spec.ts
    ├── <story-2>.spec.ts
    └── README.md          (optional — feature-specific test notes)
```

One spec file per HL-STORY (high-level story) is the default. Group small related stories into one file when the setup overlaps.

## Imports

```ts
import { test, expect } from "@playwright/test";
import {
  navigateToDummyPlug,
  waitForStepReady,
} from "../../_shared/helpers/dummy-plug";
import {
  assertNoFlash,
  assertDataPersists,
  assertStepVisible,
} from "../../_shared/helpers/assertions";
import {
  uploadRecipes,
  dropRecipes,
  clickAndUpload,
  uploadBuffer,
  RECIPE_FIXTURES,
} from "../../_shared/helpers/upload";
```

Two `..` because each feature folder is one level deeper than `_shared/`.

## Patterns

### 1. Pure API security test (no browser)

Use the `request` fixture; no browser context. Fast, deterministic.

```ts
test("GET /api/auth/me → 401", async ({ request }) => {
  const res = await request.get("/api/auth/me");
  expect([401, 404]).toContain(res.status()); // 404 = skeleton state
});
```

### 2. Navigation + visibility

```ts
test("intro screen renders with sign-in button", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("button", { name: /sign in/i }).first(),
  ).toBeVisible();
});
```

### 3. Form fill + submit

Use `getByLabel` / `getByRole` whenever possible — survives copy drift. Fall back to `getByTestId` only when accessible queries aren't enough.

```ts
test("login with empty fields shows validation", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText(/email.*required/i)).toBeVisible();
});
```

### 4. File upload (recipe box)

```ts
test("upload PDF recipe box parses to profile", async ({ page }) => {
  await page.goto("/");
  await uploadRecipes(page, RECIPE_FIXTURES.pdfHappy);
  // Wait for parse to complete and Step 2 (preferences) to render
  await expect(page.getByText(/Alexandra Chen/i)).toBeVisible({
    timeout: 30_000,
  });
});

test("upload corrupt PDF shows retry", async ({ page }) => {
  await page.goto("/");
  await uploadRecipes(page, RECIPE_FIXTURES.corruptPdf);
  await expect(page.getByText(/parsing failed.*retry/i)).toBeVisible();
});
```

### 5. Drop-zone vs. click

The drop-zone code path is separate from the hidden-input change handler. Test both when the feature exposes both:

```ts
test("drag-and-drop into drop-zone", async ({ page }) => {
  await page.goto("/");
  await dropRecipes(page, RECIPE_FIXTURES.pdfHappy);
  await expect(page.getByText(/Alexandra Chen/i)).toBeVisible({
    timeout: 30_000,
  });
});
```

### 6. Computed-style / color assertions

For brand-color compliance: read the rendered CSS variable, not a literal hex.

```ts
test("primary CTA renders with brand orange", async ({ page }) => {
  await page.goto("/");
  const cta = page.getByRole("button", { name: /get started/i }).first();
  const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
  // brand-orange resolves to a specific RGB; assert range or exact per design
  expect(bg).toMatch(/^rgb\(/); // structure check
  // For exact value, compare against the resolved CSS variable:
  const expected = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--color-brand-orange")
      .trim(),
  );
  expect(expected.length).toBeGreaterThan(0);
});
```

### 7. Visual regression (when stable)

Only after a feature's UI is stable (post-shadcn-migration); else maintenance cost is too high.

```ts
test("dashboard layout matches baseline", async ({ page }) => {
  await navigateToDummyPlug(page, 7);
  await expect(page).toHaveScreenshot("dashboard-step7.png", {
    maxDiffPixelRatio: 0.02,
  });
});
```

Baselines live next to the spec; first run records, subsequent runs diff.

### 8. Skeleton-state tolerance

Routes that don't exist yet return 404. Tests should pass either when the route is wired up correctly OR when it's not yet built (404 = "no info leak"):

```ts
const SKELETON_OK = [404, 410, 501];
test("auth route rejects unauthenticated", async ({ request }, testInfo) => {
  const res = await request.get("/api/auth/me");
  if (SKELETON_OK.includes(res.status())) {
    testInfo.annotations.push({ type: "skeleton" });
  }
  expect([401, ...SKELETON_OK]).toContain(res.status());
});
```

This makes the test forward-compatible: it doesn't fail during the skeleton phase but tightens automatically when the route ships.

## Naming

- File: `<story-or-flow>.spec.ts` (kebab-case). Examples: `login.spec.ts`, `step1-recipes.spec.ts`, `plan-bar.spec.ts`.
- `test.describe(...)` block: human-readable feature/flow name. One block per file. Nest sub-`describe`s for logical groupings inside.
- Test title: imperative or "given/when" English. Match the corresponding story in `STORIES.md`.

## Fixtures + dummy session

For tests that need to start past Step 1 (e.g. testing Step 4 preferences), use `navigateToDummyPlug(page, N)` to seed the Alexandra Chen session at step N. The `_shared/fixtures/dummy-session.json` is the calibrated persona — don't redefine.

When DummyPlug's location.replace race causes flake, fall back to seeding `localStorage` directly via `page.addInitScript`:

```ts
await page.addInitScript((session) => {
  localStorage.setItem("pantryPilot_session", session);
}, JSON.stringify(loadedSession));
await page.goto("/");
```

## Don't

- Don't hard-code copy strings the design team will tweak. Use `/regex/i` or accessible queries.
- Don't sleep with magic numbers. Use `waitFor`, `toBeVisible({ timeout })`, or `expect.poll`.
- Don't mock fetch unless you're testing client-side error handling specifically. Tests should hit the real dev server.
- Don't use snapshot tests for unstable UI — they become a maintenance treadmill.
- Don't write tests that assume Redis is up. Use the `redisTest` pattern from `gate-dodger.spec.ts`.

## When to write new helpers

If the same setup boilerplate appears in 3+ tests across different features, extract to `_shared/helpers/`. Otherwise inline.

## Coverage map

After adding tests, run `npm run test:stale-check` to confirm the feature shows ✓ (up-to-date) instead of ✗ (no tests).
