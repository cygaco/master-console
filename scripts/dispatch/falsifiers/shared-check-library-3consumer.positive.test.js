"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK = path.join(ROOT, "scripts", "hooks", "check-lib-prevention.js");
const PRECOMMIT = path.join(ROOT, "scripts", "hooks", "pre-commit-check-lib.js");
const CONTROLLER = path.join(ROOT, "scripts", "dispatch", "trusted-controller.js");

function fileMatches(p, re) {
  if (!fs.existsSync(p)) return false;
  let content;
  try {
    content = fs.readFileSync(p, "utf8");
  } catch {
    return false;
  }
  return re.test(content);
}
const fileRequiresCheckLib = (p) => fileMatches(p, /require\([^)]*check-lib[^)]*\)/);
const controllerRequiresPinnedBundle = (p) => fileMatches(p, /require\([^)]*pinned-checker-bundle[^)]*\)/);

test("shared check-library — POSITIVE: the hook consumer authorizes only after the shared REQUIRED checks ran clean", () => {
  delete require.cache[require.resolve(HOOK)];
  const hook = require(HOOK);
  const cleanResult = hook.runPrevention({ root: ROOT, envelope: { status: "passed", files: 3, commits: 1, tests: 5, evidence: 2 } });

  assert.strictEqual(cleanResult.blocked, false, "a clean envelope with real observable work must NOT block");
  assert.ok(cleanResult.results.length >= 3, "all 3 REQUIRED checks must have run (non-vacuous suite)");
  assert.ok(
    cleanResult.results.every((r) => ["pass", "skipped"].includes(r.status)),
    "every REQUIRED check must have concluded pass or (legitimately) skipped for a positive outcome — no silent fail counted as pass",
  );
  assert.strictEqual(cleanResult.missing.length, 0, "no registry drift on the golden path");

  assert.ok(fileRequiresCheckLib(PRECOMMIT), "pre-commit consumer require()s the check-lib source");
  assert.ok(controllerRequiresPinnedBundle(CONTROLLER), "controller consumer require()s the pinned bundle snapshot");
});
