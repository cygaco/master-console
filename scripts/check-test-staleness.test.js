"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

test("features come from _requirements/04-features and tests from _requirements/<feature>/tests", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "test-staleness-"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(__dirname, "check-test-staleness.js"), path.join(root, "scripts", "check-test-staleness.js"));
  for (const f of ["alpha", "beta"]) {
    fs.mkdirSync(path.join(root, "_requirements", "04-features", f), { recursive: true });
    fs.writeFileSync(path.join(root, "_requirements", "04-features", f, "PRD.md"), "# PRD\n");
  }
  fs.mkdirSync(path.join(root, "_requirements", "alpha", "tests"), { recursive: true });
  fs.writeFileSync(path.join(root, "_requirements", "alpha", "tests", "a.spec.ts"), "");
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "check-test-staleness.js")], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 features · 1 no-tests · 2 stale/);
  assert.match(r.stdout, /alpha .*tests never passed: npx playwright test _requirements\/alpha/);
  assert.match(r.stdout, /beta .*write tests in _requirements\/beta\/tests\//);
});
