"use strict";
// FALSIFIER: head-advanced-after-check — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");

test("head-advanced-after-check — a live head that moved between check and commit REFUSES via the controller (delegates to validation-to-merge-race)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("head-advanced");
  t.after(() => fx.cleanup());

  const movedHead = "d".repeat(40);
  const result = ctl.integrateForTest(standardInput(fx), standardOpts(fx), { liveHead: movedHead });

  assert.strictEqual(result.ok, false, "MUST-BLOCK: a moved live head must refuse the CAS");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "validation-to-merge-race");
  assert.ok(result.runManifest && result.runManifest.nonce, "reconcile + authorize must have been reached before the CAS refusal");

  const head = headSha(fx.dir, fx.targetRef);
  assert.strictEqual(head, fx.base);
});

test("CONTROL: an UNMOVED live head (the default — no liveHead override) integrates cleanly", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("head-unmoved");
  t.after(() => fx.cleanup());

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result);
});
