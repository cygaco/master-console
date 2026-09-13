import { test, expect, Page } from "@playwright/test";
import { uploadRecipes, RECIPE_FIXTURES } from "../../_shared/helpers/upload";

// Full-flow E2E — exercises the 12-step user journey end-to-end.
// Generated 2026-05-02 alongside ISSUES.md as part of the QA sweep.
// Each test maps to one or more bugs (BUG-NNN) so regression-after-fix is
// auditable. Use `npm run test -- _requirements/full-flow` to run.

const STEP_TIMEOUT = 60_000;
const SCAN_TIMEOUT = 90_000;

async function uploadAndAdvanceFromIntro(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await uploadRecipes(page, RECIPE_FIXTURES.docxHappy);
  // After drop, page advances to step 2 (CONFIRM) automatically.
  await expect(page.getByText(/Recipes parsed/i)).toBeVisible({
    timeout: STEP_TIMEOUT,
  });
}

test.describe("Full E2E — happy path", () => {
  test.setTimeout(180_000);

  test("intro → import → search → catalog sweep → dashboard", async ({
    page,
  }) => {
    await uploadAndAdvanceFromIntro(page);

    // Step 2 sub-flow: direction → mealtype → budget → store → quick-check → dealbreakers → confirm.
    // Defaults are pre-selected; just hit Next through each.
    // The disabled "Next step" progress-bar arrow at the top has the same
    // role+name pattern as the page's actual "Next →" button. Filter to the
    // enabled one only — that's the one we click.
    const nextBtn = page.locator('button:has-text("Next →"):not([disabled])');

    // Direction page (Same or similar meals pre-selected)
    await nextBtn.first().click();
    // Meal type page (Dinners + This week pre-selected)
    await nextBtn.first().click();
    // Budget page (open to suggestions default)
    await nextBtn.first().click();
    // Store page (Any store default)
    await nextBtn.first().click();
    // Quick-check page
    await page.getByRole("button", { name: /Looks good, let's go/i }).click();
    // Dealbreakers page
    await page.getByRole("button", { name: /^Looks good$/ }).click();
    // Confirm profile page
    await expect(page.getByText(/Confirm your info/i)).toBeVisible({
      timeout: STEP_TIMEOUT,
    });
    await page
      .getByRole("button", { name: /Confirm profile and continue/i })
      .click();

    // Interstitial → menu mission
    await page
      .getByRole("button", { name: /Continue to recipe search/i })
      .click();
    await expect(page.getByText(/Menu Mission/i)).toBeVisible({
      timeout: STEP_TIMEOUT,
    });

    // Launch the catalog sweep
    await page.getByRole("button", { name: /Build My Week/i }).click();
    await expect(
      page.getByRole("heading", { name: /Analysis Complete/i }),
    ).toBeVisible({
      timeout: SCAN_TIMEOUT,
    });

    // Menu → lock → deep dive → skip → ingredients → dashboard
    await page.getByRole("button", { name: /View Your Menu/i }).click();
    await expect(
      page.getByRole("heading", { name: /Lock Your Menu/i }),
    ).toBeVisible({
      timeout: STEP_TIMEOUT,
    });
    await page.getByRole("button", { name: /Lock Menu/i }).click();

    await expect(page.getByText(/Deep Dive/i)).toBeVisible({
      timeout: STEP_TIMEOUT,
    });
    await page.getByRole("button", { name: /Skip all/i }).click();
    await page.getByRole("button", { name: /Skip & finish/i }).click();

    await expect(page.getByText(/Here are your ingredients/i)).toBeVisible({
      timeout: STEP_TIMEOUT,
    });
    await page
      .getByRole("button", {
        name: /Save ingredient selections and continue to dashboard/i,
      })
      .click();

    // Dashboard — Kitchen Console visible
    await expect(
      page.getByRole("heading", { name: /Kitchen Console/i }),
    ).toBeVisible({ timeout: STEP_TIMEOUT });
  });
});

test.describe("Regression — BUG-001 (toggle pill style shorthand)", () => {
  // Reproduces a React style-shorthand vs longhand console warning that
  // fires whenever a Btn pill toggles between selected/unselected.
  test.setTimeout(60_000);

  test("clicking a toggle pill produces no React style warning", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /shorthand/i.test(msg.text())) {
        errors.push(msg.text());
      }
    });

    await uploadAndAdvanceFromIntro(page);
    const next = page.locator('button:has-text("Next →"):not([disabled])');

    // Direction → Meal-type page → click "Vegetarian" pill (a known repro)
    await next.first().click();
    await page.getByRole("button", { name: /^Vegetarian$/ }).click();

    // BUG-001: this assertion fails on current (unfixed) code.
    // After fix, it passes.
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("Regression — BUG-004 (Dashboard vs Meal Plans pts mismatch)", () => {
  test.setTimeout(180_000);

  test("Dashboard Readiness == Meal Plans Readiness for same session", async ({
    page,
  }) => {
    await uploadAndAdvanceFromIntro(page);
    const next = page.locator('button:has-text("Next →"):not([disabled])');

    // Drive through onboarding with defaults, skip deep dive.
    await next.first().click();
    await next.first().click();
    await next.first().click();
    await next.first().click();
    await page.getByRole("button", { name: /Looks good, let's go/i }).click();
    await page.getByRole("button", { name: /^Looks good$/ }).click();
    await page
      .getByRole("button", { name: /Confirm profile and continue/i })
      .click();
    await page
      .getByRole("button", { name: /Continue to recipe search/i })
      .click();
    await page.getByRole("button", { name: /Build My Week/i }).click();
    await expect(
      page.getByRole("heading", { name: /Analysis Complete/i }),
    ).toBeVisible({
      timeout: SCAN_TIMEOUT,
    });
    await page.getByRole("button", { name: /View Your Menu/i }).click();
    await page.getByRole("button", { name: /Lock Menu/i }).click();
    await page.getByRole("button", { name: /Skip all/i }).click();
    await page.getByRole("button", { name: /Skip & finish/i }).click();
    await page
      .getByRole("button", {
        name: /Save ingredient selections and continue to dashboard/i,
      })
      .click();

    // Read the Dashboard pts value
    await expect(
      page.getByRole("heading", { name: /Kitchen Console/i }),
    ).toBeVisible({ timeout: STEP_TIMEOUT });
    // Locate the readiness number in Kitchen Console.
    const dashPts = await page
      .locator("text=/Readiness/i")
      .locator("..")
      .locator("..")
      .innerText();

    // Navigate to Meal Plans page
    await page.getByRole("button", { name: /Open Meal Plans section/i }).click();
    await expect(page.getByText(/Load Your Recipe Box/i)).toBeVisible({
      timeout: SCAN_TIMEOUT,
    });
    const plansPts = await page
      .locator('[role="status"][aria-label*="Readiness"]')
      .innerText()
      .catch(() => "");

    // BUG-004: Dashboard reads "0 pts Getting started", Meal Plans reads
    // "140 pts OVERSTOCKED". After fix: both should agree on the baseline number.
    const dashHas140 = /140/.test(dashPts);
    const plansHas140 = /140/.test(plansPts);

    expect(
      dashHas140 === plansHas140,
      `Dashboard pts text="${dashPts}", Meal Plans pts text="${plansPts}" — they disagree on whether 140 pts is the current score.`,
    ).toBe(true);
  });
});

test.describe("Regression — BUG-005 (ingredient miscategorization)", () => {
  test.setTimeout(180_000);

  test("Paprika is categorized as a Spice, not Pantry", async ({ page }) => {
    await uploadAndAdvanceFromIntro(page);
    const next = page.locator('button:has-text("Next →"):not([disabled])');
    // Skip onboarding fast
    for (let i = 0; i < 4; i++) {
      await next.first().click();
    }
    await page.getByRole("button", { name: /Looks good, let's go/i }).click();
    await page.getByRole("button", { name: /^Looks good$/ }).click();
    await page
      .getByRole("button", { name: /Confirm profile and continue/i })
      .click();
    await page
      .getByRole("button", { name: /Continue to recipe search/i })
      .click();
    await page.getByRole("button", { name: /Build My Week/i }).click();
    await expect(
      page.getByRole("heading", { name: /Analysis Complete/i }),
    ).toBeVisible({
      timeout: SCAN_TIMEOUT,
    });
    await page.getByRole("button", { name: /View Your Menu/i }).click();
    await page.getByRole("button", { name: /Lock Menu/i }).click();
    await page.getByRole("button", { name: /Skip all/i }).click();
    await page.getByRole("button", { name: /Skip & finish/i }).click();

    await expect(page.getByText(/Here are your ingredients/i)).toBeVisible({
      timeout: STEP_TIMEOUT,
    });

    // BUG-005: Paprika appears under "Pantry", should be under "Spices".
    const paprikaButton = page.getByRole("button", { name: /^Paprika/i });
    if ((await paprikaButton.count()) === 0) {
      // Recipe parser is non-deterministic (BUG-006); skip if Paprika didn't
      // show up this run.
      test.skip();
    }
    // Walk up the DOM to find the category heading sibling.
    const category = await paprikaButton.evaluate((el) => {
      // Find the closest container whose first child is a category label.
      let cur: HTMLElement | null = el;
      while (cur && cur.parentElement) {
        cur = cur.parentElement;
        const firstChild = cur.firstElementChild as HTMLElement | null;
        if (
          firstChild?.textContent &&
          /^(Produce|Dairy|Protein|Pantry|Spices|Other)$/i.test(
            firstChild.textContent.trim(),
          )
        ) {
          return firstChild.textContent.trim();
        }
      }
      return "";
    });

    expect(
      category.toLowerCase(),
      `Paprika was categorized under "${category}"`,
    ).toBe("spices");
  });
});
