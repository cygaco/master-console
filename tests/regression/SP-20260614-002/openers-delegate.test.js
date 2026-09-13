#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// openers-delegate.test.js — SP-20260614-002 R-2 (AC-R2a/b).
// The /admin:readiness and /admin:guides openers are THIN one-row delegators to
// the canonical scripts/admin/preview.js harness:
//   - each opener body shells `node scripts/admin/preview.js --route <subroute>`
//   - the correct sub-route threads through (/admin/readiness | /admin/guides)
//   - NO duplicated boot/scaffold/ready-poll/browser-open logic lives in the
//     opener (a copy of the harness FAILS AC-R2a)
// Static assertions over the skill .md files — no real npm run dev.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ADMIN_CMD = path.join(ROOT, ".claude", "commands", "admin");

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ADMIN_CMD, rel), "utf8");
}

// Tokens that would betray a COPY of the keystone harness logic in an opener.
// A thin delegator must not re-implement boot/scaffold/ready-poll/browser-open.
const HARNESS_LEAK_TOKENS = [
  "spawn(",
  "npm install",
  "npm\",\"run\",\"dev",
  "npm run dev", // only acceptable inside the keystone, never duplicated in an opener
  "scaffoldProductApp",
  "openInBrowser",
  "started server on",
  "refuseIfTargetIsMC",
  "child.stdout",
  "setTimeout",
];

const cases = [
  { file: "readiness.md", route: "/admin/readiness" },
  { file: "guides.md", route: "/admin/guides" },
];

for (const c of cases) {
  ok(`sub-route-opener-delegates-no-duplicated-logic:${c.file}`, () => {
    const body = read(c.file);
    // (1) delegates to the canonical keystone with the route arg.
    assert.ok(
      /node\s+scripts\/admin\/preview\.js\s+--route\s+\/admin\/(readiness|guides)/.test(body),
      `${c.file} must shell preview.js --route <subroute>`
    );
    // (2) carries no duplicated harness logic.
    for (const tok of HARNESS_LEAK_TOKENS) {
      assert.ok(
        !body.includes(tok),
        `${c.file} contains harness-logic token "${tok}" — opener must be a thin delegator, not a copy`
      );
    }
    // (3) a one-row delegation — exactly one `node scripts/admin/preview.js` shell line.
    const shellLines = body
      .split(/\r?\n/)
      .filter((l) => /node\s+scripts\/admin\/preview\.js/.test(l));
    assert.strictEqual(
      shellLines.length,
      1,
      `${c.file} must delegate in exactly ONE row (found ${shellLines.length})`
    );
  });

  ok(`route-arg-threads-to-opened-url:${c.file}`, () => {
    const body = read(c.file);
    // The exact sub-route the keystone will open must appear in the delegation.
    assert.ok(
      body.includes(`--route ${c.route}`),
      `${c.file} must pass --route ${c.route} so the opened URL carries that sub-route`
    );
  });
}

ok("both-openers-have-admin-namespace-frontmatter", () => {
  for (const c of cases) {
    const body = read(c.file);
    assert.ok(/^namespace:\s*admin\s*$/m.test(body), `${c.file} must declare namespace: admin`);
    assert.ok(/^user-invocable:\s*true\s*$/m.test(body), `${c.file} must be user-invocable`);
  }
});

console.log(`\nopeners-delegate: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
