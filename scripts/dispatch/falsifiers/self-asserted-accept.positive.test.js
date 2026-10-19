"use strict";
const test = require("node:test");
const assert = require("node:assert");

test("self-asserted-accept POSITIVE — the same self-asserting envelope over a CLEAN tree authorizes + integrates", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("self-asserted-pos");
  t.after(() => fx.cleanup());

  const input = standardInput(fx, {
    result_envelope: { success: true, verdict: "accept", checks_passed: true },
  });
  const result = ctl.integrate(input, standardOpts(fx));

  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.decision, "INTEGRATED");
  assert.ok(result.receipt && result.receipt.committed_head === fx.result);

  const head = headSha(fx.dir, fx.targetRef);
  assert.strictEqual(head, fx.result, "refs/heads/integ must have advanced to the accepted result commit");
});
