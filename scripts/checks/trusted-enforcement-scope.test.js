"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CONTRACT_DOC = path.join(__dirname, "..", "..", ".claude", "kernel", "top-level-runtime-contract.md");
const CONTROLLER = path.join(__dirname, "..", "dispatch", "trusted-controller.js");
const { assertScopedHonestly } = require(path.join(__dirname, "..", "dispatch", "falsifiers", "_lib", "honest-promise-scope-evaluator"));

test("trusted-enforcement-scope — the shipped P1.2 honest-promise block is scoped honestly (verification + integration-to-main ONLY, capability-grant/protected-mutation explicitly excluded)", () => {
  assert.ok(fs.existsSync(CONTRACT_DOC), "top-level-runtime-contract.md must exist");
  const doc = fs.readFileSync(CONTRACT_DOC, "utf8");
  const p12Match = doc.match(/#### P1\.2[\s\S]*?(?=\n---|\n## §)/);
  assert.ok(p12Match, "the P1.2 honest-promise block must be extractable from the contract doc");
  const result = assertScopedHonestly(p12Match[0]);
  assert.strictEqual(result.ok, true, JSON.stringify(result));
});

test("trusted-enforcement-scope — trusted-controller.js's own module doc POINTS AT the canonical honest-promise block (never silently re-states or omits the scope)", () => {
  assert.ok(fs.existsSync(CONTROLLER), "trusted-controller.js must exist");
  const src = fs.readFileSync(CONTROLLER, "utf8");
  const headMatch = src.match(/\/\*\*[\s\S]*?\*\//);
  assert.ok(headMatch, "trusted-controller.js must open with a module doc comment");
  const head = headMatch[0];
  assert.ok(/top-level-runtime-contract\.md/.test(head), "the module doc must reference top-level-runtime-contract.md");
  assert.ok(/P1\.2/.test(head), "the module doc must reference the P1.2 honest-promise block specifically");
  assert.ok(
    /verification and integration-to-main/i.test(head) || /artifact-verification\+integration/i.test(head),
    "the module doc must itself name the TWO scoped powers (verification, integration-to-main)",
  );
  assert.ok(
    /capability grants?[,)]? protected mutation|Capability grants and protected mutation/i.test(head),
    "the module doc must itself name the TWO excluded powers (capability grants, protected mutation) — never a silent omission",
  );
});
