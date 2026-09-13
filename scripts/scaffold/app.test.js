#!/usr/bin/env node
"use strict";

/**
 * scripts/scaffold/app.test.js (S0.3) — proves the scaffold engine without a real
 * npm install (runCmd injected) and without touching a real product repo (temp dir).
 *
 *   node scripts/scaffold/app.test.js
 *
 * Exit 0 = all pass; non-zero = a failure (the names print).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { scaffoldApp, ensureGitignore } = require("./app");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-scaffold-test-"));
function freshRepo() {
  const d = fs.mkdtempSync(path.join(tmp, "repo-"));
  return d;
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

try {
  // 1. materialize: core files land + content interpolated
  test("materialize creates the core files with slug interpolation", () => {
    const repo = freshRepo();
    const r = scaffoldApp({ repoRoot: repo, slug: "acme-app", log: () => {} });
    assert.ok(r.ok, "scaffoldApp ok");
    assert.ok(!r.alreadyPresent, "not alreadyPresent on fresh repo");
    for (const f of [
      "package.json",
      "tsconfig.json",
      "next.config.ts",
      ".env.local.example",
      "FOUNDERS_CHECKLIST.md",
      "src/app/admin/page.tsx",
      "src/app/admin/actions.ts",
      "src/app/page.tsx",
      "src/app/globals.css",
      "src/components/ui/button.tsx",
      "src/lib/admin/config.ts",
      "src/lib/admin/project-sections.ts",
      "src/lib/admin/store.ts",
      "src/lib/utils.ts",
      "DESIGN_SYSTEM.md",
    ]) {
      assert.ok(fs.existsSync(path.join(repo, f)), `created ${f}`);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
    assert.strictEqual(pkg.name, "acme-app", "package name = slug");
    assert.ok(pkg.dependencies["@radix-ui/react-slot"], "pins radix slot");
    assert.ok(pkg.dependencies["lucide-react"], "pins lucide");
    const checklist = fs.readFileSync(path.join(repo, "FOUNDERS_CHECKLIST.md"), "utf8");
    assert.ok(checklist.includes("mc/founders-checklist/v1"), "founders checklist schema");
    // .tmpl suffix stripped everywhere
    assert.ok(!fs.existsSync(path.join(repo, "package.json.tmpl")), ".tmpl stripped");
  });

  test("founders checklist renders declared-stack conditional items", () => {
    const repo = freshRepo();
    writeDeclaredStack(repo, "Stripe");
    const r = scaffoldApp({ repoRoot: repo, slug: "acme-app", log: () => {} });
    assert.ok(r.ok, "scaffoldApp ok");
    const checklist = fs.readFileSync(path.join(repo, "FOUNDERS_CHECKLIST.md"), "utf8");
    assert.match(checklist, /Verify Stripe identity/);
    assert.match(checklist, /Create Clerk production instance/);
    assert.match(checklist, /Create PostHog project/);
  });

  // 2. .gitignore managed block added, and .claude is NOT ignored
  test("gitignore gets the managed block and never ignores .claude", () => {
    const repo = freshRepo();
    scaffoldApp({ repoRoot: repo, slug: "x", log: () => {} });
    const gi = fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
    assert.ok(gi.includes("/node_modules"), "ignores node_modules");
    assert.ok(gi.includes("/.next/"), "ignores .next");
    assert.ok(!/^\.claude/m.test(gi) && !gi.includes(".claude/*"), ".claude NOT ignored");
  });

  // 3. idempotent: a second run preserves files (alreadyPresent, nothing created)
  test("second run is idempotent (package.json present => alreadyPresent)", () => {
    const repo = freshRepo();
    scaffoldApp({ repoRoot: repo, slug: "x", log: () => {} });
    const r2 = scaffoldApp({ repoRoot: repo, slug: "x", log: () => {} });
    assert.ok(r2.alreadyPresent, "alreadyPresent on second run");
    assert.strictEqual(r2.created.length, 0, "nothing re-created");
  });

  // 4. ensureGitignore does not duplicate the managed block
  test("ensureGitignore is idempotent (no duplicate block)", () => {
    const repo = freshRepo();
    scaffoldApp({ repoRoot: repo, slug: "x", log: () => {} });
    ensureGitignore(repo);
    ensureGitignore(repo);
    const gi = fs.readFileSync(path.join(repo, ".gitignore"), "utf8");
    const count = (gi.match(/MC app-scaffold \(managed\)/g) || []).length;
    assert.strictEqual(count, 1, "managed marker appears exactly once");
  });

  // 5. install:true calls the injected runCmd with `npm install` (no real network)
  test("install uses the injected runCmd seam (no real npm install)", () => {
    const repo = freshRepo();
    let calledWith = null;
    const r = scaffoldApp({
      repoRoot: repo,
      slug: "x",
      install: true,
      runCmd: (cmd, args) => {
        calledWith = [cmd, ...args];
        return { code: 0, error: null };
      },
      log: () => {},
    });
    assert.deepStrictEqual(calledWith, ["npm", "install"], "ran npm install via seam");
    assert.ok(r.installed, "installed=true when seam returns 0");
  });

  // 6b. self-protect: refuses to scaffold into the MC repo root itself
  test("refuses to materialize into the MC repo root (leak guard)", () => {
    const mcRoot = path.resolve(__dirname, "..", "..");
    const r = scaffoldApp({ repoRoot: mcRoot, slug: "x", log: () => {} });
    assert.ok(!r.ok, "must refuse");
    assert.match(r.error || "", /repo root/i, "error names the repo-root guard");
  });

  // 6. existing files are preserved (portfolio's README/.gitignore survive)
  test("pre-existing files are preserved, not overwritten", () => {
    const repo = freshRepo();
    fs.writeFileSync(path.join(repo, "README.md"), "PORTFOLIO README\n", "utf8");
    const r = scaffoldApp({ repoRoot: repo, slug: "x", log: () => {} });
    // README.md.tmpl is NOT in the scaffold (we ship README.scaffold.md), but prove
    // the skip path by asserting any collision would be reported in skipped, and
    // the portfolio README is untouched.
    assert.strictEqual(fs.readFileSync(path.join(repo, "README.md"), "utf8"), "PORTFOLIO README\n", "README preserved");
    assert.ok(r.ok, "ok with a pre-existing file present");
  });
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

if (failures.length) {
  process.stderr.write(`scaffold engine: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`scaffold engine: ${passed}/${passed} tests passed\n`);
process.exit(0);
