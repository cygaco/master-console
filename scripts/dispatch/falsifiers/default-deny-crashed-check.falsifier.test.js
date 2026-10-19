"use strict";
// FALSIFIER: default-deny-crashed-check — record-trust gate. A `status:"fail"` result (a check that ran and genuinely failed / crashed-to-fail per check-lib's
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-crashed-check — status:fail MUST-BLOCK (check-failed)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });
  const out = ctl.reconcileRunManifest(rm, [result("alpha", { status: "fail", reason: "check-threw" })]);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "check-failed");
  assert.strictEqual(out.offending, "alpha");
});
