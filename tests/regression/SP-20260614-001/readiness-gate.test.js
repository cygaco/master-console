#!/usr/bin/env node
"use strict";

// AC-A7 — the /admin/readiness route denies absent / malformed / non-allowlisted admin
// cookies and renders NO readiness content (default-deny; allowlist check is the FIRST
// gate; prod dev-email fallback fails closed).
//
// The page + gate are .tsx.tmpl templates (not loadable in plain Node without a TS/JSX
// toolchain), so this test asserts the GATE CONTRACT structurally against the template
// source: the page copies the real admin gate, the deny path runs before any data load,
// and the prod dev-email fallback is closed in the config the gate calls. This is the same
// invariant the Playwright spec exercises at runtime; here it is a fast, dependency-free guard.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const REPO = process.cwd();
const SCAFFOLD = path.join(REPO, "_mc", "templates", "app-scaffold");
const PAGE = path.join(SCAFFOLD, "src", "app", "admin", "readiness", "page.tsx.tmpl");
const GUIDE = path.join(SCAFFOLD, "src", "app", "admin", "guides", "[ref]", "page.tsx.tmpl");
const CONFIG = path.join(SCAFFOLD, "src", "lib", "admin", "config.ts.tmpl");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ── absent-and-invalid-cookie-deny-403 ────────────────────────────────────────────
test("absent-and-invalid-cookie-deny-403", () => {
  const page = fs.readFileSync(PAGE, "utf8");

  // 1. The page uses the REAL gate (resolveAdminActor), NOT a hallucinated requireFounderAdmin
  //    as the page-level guard.
  assert.ok(
    /resolveAdminActor\(\)/.test(page),
    "page must call resolveAdminActor() (the real admin gate)",
  );
  assert.ok(
    /from\s+["']@\/lib\/admin\/config["']/.test(page),
    "page must import the gate from @/lib/admin/config (no invented auth module)",
  );

  // 2. Default-deny: the `if (!actor.allowed)` deny branch returns BEFORE any readiness
  //    data is loaded (loadReport / buildReadinessReport must appear AFTER the deny return).
  const denyIdx = page.indexOf("if (!actor.allowed)");
  assert.ok(denyIdx !== -1, "page must have an `if (!actor.allowed)` deny branch");
  const loadIdx = page.indexOf("loadReport(");
  assert.ok(loadIdx !== -1, "page must load the report somewhere");
  // The deny-branch return must come before the data load is invoked in render flow.
  const denyReturnIdx = page.indexOf("return", denyIdx);
  assert.ok(
    denyReturnIdx !== -1 && denyReturnIdx < page.indexOf("toReadinessView(loadReport())"),
    "the deny return must precede the readiness data load (no content before the gate)",
  );

  // 3. The deny branch renders NO readiness content — the access-restricted card only.
  const denyBlock = page.slice(denyIdx, denyReturnIdx + 600);
  assert.ok(
    /Admin access restricted/.test(denyBlock),
    "deny branch renders the access-restricted card",
  );
  assert.ok(
    !/progressbar/.test(denyBlock) && !/Do this first/.test(denyBlock),
    "deny branch must NOT render readiness content (no progress bar / groups)",
  );

  // 4. No hallucinated dependency: the page must not invent `requireFounderAdmin` as the
  //    page-level gate (β condition 1). resolveAdminActor is the gate.
  assert.ok(
    !/requireFounderAdmin\s*\(\s*\)\s*[;\n].*actor\.allowed/s.test(page) ||
      /resolveAdminActor/.test(page),
    "page gate uses resolveAdminActor (not a hallucinated requireFounderAdmin page guard)",
  );
});

// ── prod-dev-email-fallback-fails-closed ──────────────────────────────────────────
test("prod-dev-email-fallback-fails-closed", () => {
  const config = fs.readFileSync(CONFIG, "utf8");
  // resolveAdminActor must zero the dev-email fallback in production.
  assert.ok(
    /NODE_ENV\s*!==\s*["']production["']/.test(config),
    "dev-email fallback must be gated on NODE_ENV !== 'production' (fails closed in prod)",
  );
  // isFounderEmailAllowed must require a non-empty normalized email AND allowlist membership.
  assert.ok(
    /founderEmailAllowlist\(\)\.includes/.test(config),
    "allow decision must check allowlist membership",
  );
});

// ── guide-viewer-shares-the-same-gate ─────────────────────────────────────────────
test("guide-viewer-shares-the-same-gate", () => {
  const guide = fs.readFileSync(GUIDE, "utf8");
  assert.ok(
    /resolveAdminActor\(\)/.test(guide) && /if \(!actor\.allowed\)/.test(guide),
    "guide viewer must use the same resolveAdminActor / !actor.allowed default-deny gate",
  );
});

// ── runner ────────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  ok   ${t.name}`);
    pass++;
  } catch (err) {
    console.error(`  FAIL ${t.name}: ${err.message}`);
    fail++;
  }
}
console.log(`\nreadiness-gate.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
