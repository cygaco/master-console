"use strict";
// FALSIFIER: self-asserted-accept-over-failing-tree — record-trust gate. Adversarial: `input.result_envelope` SELF-ASSERTS `checks_passed:true` /
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const CONTROLLER = path.join(__dirname, "..", "trusted-controller.js");

test("self-asserted-accept-over-failing-tree — an envelope claiming accept over a FAILING tree is REFUSED (reachability: bundle ran + check-failed FIRED)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("self-asserted");
  t.after(() => fx.cleanup());

  const poisonedResult = fx.poisonResultCommit();
  const input = standardInput(fx, {
    result_commit: poisonedResult,
    result_envelope: {
      success: true,
      verdict: "accept",
      checks_passed: true,
      status: "passed",
      files: ["fake-evidence.txt"],
    },
  });
  const opts = standardOpts(fx);

  const result = ctl.integrate(input, opts);

  assert.strictEqual(result.ok, false, "MUST-BLOCK: a self-asserted accept over a failing tree must be refused");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "check-failed", "the fresh pinned run's REQUIRED check must have genuinely FAILED and been the refusal reason");
  assert.strictEqual(result.offending, "no-nul-bytes", "the offending check must be the one the poisoned ctx actually failed");
  assert.ok(result.runManifest && result.runManifest.nonce, "a nonce-bound run manifest must have been minted (the reconcile gate was reached)");

  const { git, headSha } = require("./_lib/git-scratch");
  const head = headSha(fx.dir, fx.targetRef);
  assert.strictEqual(head, fx.base, "MUST-BLOCK: refs/heads/integ must NOT have advanced — commitIntegration was never reached");
  void git;
});
