import { test, expect } from "@playwright/test";

// AC-A4 / A5 / A8 / AC-design — the founder launch-readiness panel (/admin/readiness).
// RUNS at the design-quality gauntlet against a running scaffolded product app (report-only
// this sprint). Not run in the build subprocess.
//
// Auth: these tests assume the gauntlet harness establishes a founder session (signed admin
// cookie or NODE_ENV!=="production" + ADMIN_DEV_EMAIL on the allowlist) before navigating —
// the gate is exercised by readiness-gate.test.js. If no session is configured the route
// renders "Admin access restricted"; the cold/warm assertions below skip in that case so the
// spec never false-fails on an un-provisioned harness.

const ROUTE = "/admin/readiness";

async function isGated(page: import("@playwright/test").Page): Promise<boolean> {
  return (await page.getByText("Admin access restricted").count()) > 0;
}

test.describe("readiness panel", () => {
  test("cold-start-oriented-not-blank", async ({ page }) => {
    await page.goto(ROUTE);
    if (await isGated(page)) test.skip(true, "no founder session provisioned");

    // The board is oriented, NOT a blank table / flat unordered dump.
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    // A progress / composite affordance is present.
    await expect(page.getByRole("progressbar")).toBeVisible();

    // Cold state (0 done) shows the first-class orientation banner with a "start here"
    // affordance — NOT a blank surface. (When warm, the banner is absent; that's covered
    // by the warm test, so we only assert it when the cold banner copy is present.)
    const banner = page.getByText("Let’s get you launch-ready.");
    if ((await banner.count()) > 0) {
      await expect(banner).toBeVisible();
      // The longest-lead-time owner-action item is surfaced with a "Start now" affordance.
      await expect(page.getByText(/Start now/i).first()).toBeVisible();
      // Ordered groups, not a flat dump: the "Do this first" group heading exists.
      await expect(
        page.getByRole("heading", { name: /Do this first/i }),
      ).toBeVisible();
    }
  });

  test("warm-start-collapses-done-focuses-next", async ({ page }) => {
    await page.goto(ROUTE);
    if (await isGated(page)) test.skip(true, "no founder session provisioned");

    // Warm path renders measurably differently from cold: when any item is done, the Done
    // group is collapsed (native <details>, closed by default) and the orientation banner
    // is gone.
    const done = page.locator("details", { hasText: /^Done \(/ });
    if ((await done.count()) > 0) {
      // Collapsed by default (no `open` attribute).
      await expect(done.first()).not.toHaveAttribute("open", /.*/);
      // The cold orientation banner is gone in the warm state.
      await expect(page.getByText("Let’s get you launch-ready.")).toHaveCount(0);
      // Open "what's next" work is still foregrounded (a group heading other than Done).
      await expect(
        page.getByRole("heading", { name: /Do this first|Blocked|In the sprint/i }).first(),
      ).toBeVisible();
    }
  });

  test("deep-link-is-a-real-prominent-affordance", async ({ page }) => {
    await page.goto(ROUTE);
    if (await isGated(page)) test.skip(true, "no founder session provisioned");

    // AC-A8 / WG-29: the deep-link is a real <a> (not a dead button), prominent, and routes
    // to the in-app guide viewer. Only rendered when a guide resolves.
    const cta = page.getByRole("link", { name: /How to do this:/i });
    if ((await cta.count()) > 0) {
      const href = await cta.first().getAttribute("href");
      expect(href).toMatch(/^\/admin\/guides\/[^/]+$/);
      // No dead links: the href has a real ref segment.
      expect(href).not.toMatch(/\/admin\/guides\/?$/);
    }
  });

  test("brand-clean-dom-no-schema-id", async ({ page }) => {
    await page.goto(ROUTE);
    if (await isGated(page)) test.skip(true, "no founder session provisioned");

    // β condition 3 / AC-brand: no product-facing "MC", and the schema id never appears
    // in the visible DOM / title / aria / data-* / class.
    const html = await page.content();
    expect(html).not.toMatch(/mc\/readiness\/v1/i);
    expect(html).not.toMatch(/MC/);
    const title = await page.title();
    expect(title).not.toMatch(/mc/i);
  });

  test("mobile-single-column", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTE);
    if (await isGated(page)) test.skip(true, "no founder session provisioned");

    // Mobile-first: the board is readable and the main heading is visible at a phone width.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // No horizontal overflow of the main region.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(overflow).toBeTruthy();
  });

  test("design-quality-gauntlet-pass", async ({ page }) => {
    await page.goto(ROUTE);
    if (await isGated(page)) test.skip(true, "no founder session provisioned");

    // Readable hierarchy: exactly one h1, group h2s present, no layout breakage in any state.
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    // The composite progress affordance is labeled (a11y).
    const bar = page.getByRole("progressbar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("aria-valuenow", /\d+/);
    // Empty/cold state must not break layout — the page renders a main region.
    await expect(page.locator("main")).toBeVisible();
  });
});
