"use strict";
// FALSIFIER: honest-promise-scope — record-trust gate. The shipped honest-promise statement (top-level-runtime-contract.md §1 P1.2) MUST name the
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CONTRACT_DOC = path.join(__dirname, "..", "..", "..", ".claude", "kernel", "top-level-runtime-contract.md");

const { assertScopedHonestly } = require("./_lib/honest-promise-scope-evaluator");

test("honest-promise-scope — the REAL shipped statement is honestly scoped (verification + integration-to-main ONLY)", () => {
  const doc = fs.readFileSync(CONTRACT_DOC, "utf8");
  assert.ok(/P1\.2/.test(doc) && /[Hh]onest-promise/.test(doc), "the honest-promise block (P1.2) must exist in the contract");

  const p12Match = doc.match(/#### P1\.2[\s\S]*?(?=\n---|\n## §)/);
  assert.ok(p12Match, "the P1.2 block body must be extractable");
  const p12 = p12Match[0];

  const result = assertScopedHonestly(p12);
  assert.strictEqual(result.ok, true, JSON.stringify(result) + "\n\n" + p12);
});

test("honest-promise-scope — MUST-BLOCK a synthetic statement that overclaims all four CORE-2 powers", () => {
  const overclaim = "This adapter enforces all four CORE-2 powers: capability grants and protected mutation are now enforced, along with artifact-verification and integration-to-main.";
  const result = assertScopedHonestly(overclaim);
  assert.strictEqual(result.ok, false, "MUST-BLOCK: an overclaiming statement must be rejected");
  assert.strictEqual(result.reason, "promise-overclaims-beyond-artifact-verification+integration-slice");
});

test("honest-promise-scope — MUST-BLOCK a statement that silently omits the uncovered powers (no exclusion marker at all)", () => {
  const silent = "This adapter provides artifact-verification and integration-to-main.";
  const result = assertScopedHonestly(silent);
  assert.strictEqual(result.ok, false, "MUST-BLOCK: silently never mentioning capability-grants/protected-mutation at all is not an honest, explicit scope statement");
  assert.strictEqual(result.reason, "promise-silently-omits-uncovered-power");
});

test("honest-promise-scope — a correctly-scoped POSITIVE control passes", () => {
  const good =
    "This adapter enforces artifact-verification and integration-to-main. Capability grants and protected " +
    "mutation are NOT covered by this adapter and remain open.";
  const result = assertScopedHonestly(good);
  assert.deepStrictEqual(result, { ok: true });
});

module.exports = { assertScopedHonestly };
