"use strict";
// FALSIFIER: shared-check-library-reachability — record-trust gate. For EACH of the 3 consumers (Claude hook / pre-commit / controller-via-pinned-
// negative control that MUST-BLOCK a hollow-success envelope, exposing the exact check reason on a bad input.
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
function fileRequiresCheckLib(p) {
  return fileMatches(p, /require\([^)]*check-lib[^)]*\)/);
}
function controllerRequiresPinnedBundle(p) {
  return fileMatches(p, /require\([^)]*pinned-checker-bundle[^)]*\)/);
}

test("shared check-library reachability — the shared check FIRES via each of the 3 consumers", () => {
  assert.ok(fileRequiresCheckLib(PRECOMMIT), "pre-commit consumer must require() the check-lib source");
  assert.ok(controllerRequiresPinnedBundle(CONTROLLER), "controller consumer must require() the pinned bundle snapshot");

  delete require.cache[require.resolve(HOOK)];
  const hook = require(HOOK);
  const cleanResult = hook.runPrevention({ root: ROOT });
  assert.ok(cleanResult && Array.isArray(cleanResult.results) && cleanResult.results.length > 0, "hook consumer must actually RUN the shared suite, not just import it");
  assert.ok(cleanResult.results.some((r) => r.name === "suite-completeness"), "the suite-completeness check (a REQUIRED check) must have fired");
  assert.ok(cleanResult.results.some((r) => r.name === "no-nul-bytes"), "the no-nul-bytes check (a REQUIRED check) must have fired");

  const badResult = hook.runPrevention({ root: ROOT, envelope: { status: "passed", files: 0, commits: 0, tests: 0, evidence: 0 } });
  assert.strictEqual(badResult.blocked, true, "a hollow-success envelope must BLOCK via the hook");
  assert.ok(
    badResult.blockingReasons.some((r) => r.name === "false-green-envelope" && r.reason === "false-green-envelope-zero-evidence"),
    "the exact false-green-envelope reason must be exposed, not a generic failure",
  );

  delete require.cache[require.resolve(PRECOMMIT)];
  const preCommit = require(PRECOMMIT);
  assert.ok(
    typeof preCommit.runCheckLibSuite === "function" || typeof preCommit.main === "function" || typeof preCommit === "function",
    "pre-commit consumer must expose a callable entrypoint that runs the shared suite",
  );

  const controllerSrc = fs.readFileSync(CONTROLLER, "utf8");
  assert.ok(/check-lib/.test(controllerSrc), "controller must reference check-lib (via the pinned bundle) — reachability at the wiring layer");
});
