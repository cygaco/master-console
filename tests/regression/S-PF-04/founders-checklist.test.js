#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { scaffoldApp } = require("../../../scripts/scaffold/app");
const {
  parseFoundersChecklist,
  renderFoundersChecklist,
} = require("../../../scripts/scaffold/founders-checklist");
const { evaluateScaffold } = require("../../../scripts/checks/scaffold-coverage-scan");
const { detectRepoState } = require("../../../scripts/bootstrap/lastmile/lib/detect");
const { scoreReadiness } = require("../../../scripts/bootstrap/lastmile/lib/score");
const audit = require("../../../scripts/bootstrap/lastmile/phases/audit");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REAL_SCAFFOLD = path.join(REPO_ROOT, "_mc", "templates", "app-scaffold");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function tempRepo(prefix = "mc-spf04-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeDeclaredStack(repo, paymentsChoice = "Stripe") {
  const dir = path.join(repo, "_requirements", "00-canonical");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "DATA_AND_ACCOUNTS.md"),
    [
      "# Acme - Data & Accounts",
      "",
      "## Tech Stack",
      "| Layer | Declared Choice | Rationale |",
      "| --- | --- | --- |",
      "| Framework | Next.js | intake |",
      "| Database | Supabase | intake |",
      "| Authentication | Clerk | intake |",
      `| Payments | ${paymentsChoice} | intake |`,
      "| Hosting | Vercel | intake |",
      "| Analytics | PostHog | intake |",
      "",
    ].join("\n"),
    "utf8",
  );
}

function fixture(mutator) {
  const dir = tempRepo("mc-spf04-scaffold-");
  fs.cpSync(REAL_SCAFFOLD, dir, { recursive: true });
  if (mutator) mutator(dir);
  return dir;
}

function expectError(dir, pattern) {
  const result = evaluateScaffold(dir);
  assert.strictEqual(result.ok, false, "fixture unexpectedly passed");
  assert(
    result.errors.some((error) => pattern.test(error)),
    `missing error ${pattern}; got ${JSON.stringify(result.errors)}`,
  );
}

test("real-scaffold-founders-checklist-contract-passes", () => {
  const result = evaluateScaffold(REAL_SCAFFOLD);
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.ok, true);
});

test("renderer-includes-stripe-conditional-item-and-machine-readable-state", () => {
  const markdown = renderFoundersChecklist({
    declaredStack: {
      source: "_requirements/00-canonical/DATA_AND_ACCOUNTS.md",
      values: {
        framework: "Next.js",
        database: "Supabase",
        auth: "Clerk",
        payments: "Stripe",
        hosting: "Vercel",
        analytics: "PostHog",
      },
    },
  });
  assert.match(markdown, /Verify Stripe identity/);
  const parsed = parseFoundersChecklist(markdown);
  assert.strictEqual(parsed.ok, true);
  assert.ok(parsed.items.some((item) => item.id === "payments.stripe.identity"));
  assert.ok(parsed.items.every((item) => typeof item.checked === "boolean"));
});

test("scaffold-renders-founders-checklist-from-declared-stack", () => {
  const repo = tempRepo();
  try {
    writeDeclaredStack(repo, "Stripe");
    const result = scaffoldApp({ repoRoot: repo, slug: "acme-app", log: () => {} });
    assert.strictEqual(result.ok, true);
    const checklist = fs.readFileSync(path.join(repo, "FOUNDERS_CHECKLIST.md"), "utf8");
    assert.match(checklist, /payments\.stripe\.identity/);
    assert.match(checklist, /Create Clerk production instance/);
    assert.match(checklist, /Create PostHog project/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("missing-template-fixture-fails-scaffold-coverage", () => {
  const dir = fixture((fx) => {
    fs.rmSync(path.join(fx, "FOUNDERS_CHECKLIST.md.tmpl"));
  });
  try {
    expectError(dir, /missing required file: FOUNDERS_CHECKLIST\.md\.tmpl/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lastmile-detect-and-score-consume-checklist-state", () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ dependencies: { next: "latest" } }), "utf8");
    const checklist = renderFoundersChecklist({
      declaredStack: { values: { payments: "Stripe", auth: "Clerk" } },
    });
    fs.writeFileSync(path.join(repo, "FOUNDERS_CHECKLIST.md"), checklist, "utf8");
    const state = detectRepoState(repo);
    assert.strictEqual(state.foundersChecklist.present, true);
    assert.ok(state.foundersChecklist.open.some((item) => item.id === "payments.stripe.identity"));
    const score = scoreReadiness(state);
    assert.ok(score.gaps.some((gap) => /payments\.stripe\.identity/.test(gap.gap)));

    fs.writeFileSync(
      path.join(repo, "FOUNDERS_CHECKLIST.md"),
      checklist.replace("- [ ] id=payments.stripe.identity", "- [x] id=payments.stripe.identity"),
      "utf8",
    );
    const checkedScore = scoreReadiness(detectRepoState(repo));
    assert.ok(!checkedScore.gaps.some((gap) => /payments\.stripe\.identity/.test(gap.gap)));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("lastmile-audit-renders-founders-checklist-section", async () => {
  const repo = tempRepo();
  try {
    fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ dependencies: { next: "latest" } }), "utf8");
    fs.writeFileSync(
      path.join(repo, "FOUNDERS_CHECKLIST.md"),
      renderFoundersChecklist({ declaredStack: { values: { payments: "Stripe" } } }),
      "utf8",
    );
    const result = await audit.run({
      repoRoot: repo,
      outDir: "_docs/last-mile",
      dryRun: false,
      profile: null,
      log: () => {},
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.foundersChecklist.present, true);
    const report = fs.readFileSync(path.join(repo, "_docs", "last-mile", "gap-report.md"), "utf8");
    assert.match(report, /Founders checklist/);
    assert.match(report, /Checklist state:/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

(async () => {
  let passed = 0;
  const failures = [];
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (e) {
      failures.push(`${t.name}: ${e.message}`);
    }
  }

  if (failures.length) {
    process.stderr.write(`S-PF-04 founders checklist: ${passed} passed, ${failures.length} FAILED\n`);
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    process.exit(1);
  }
  process.stdout.write(`S-PF-04 founders checklist: ${passed}/${tests.length} passed\n`);
})();
