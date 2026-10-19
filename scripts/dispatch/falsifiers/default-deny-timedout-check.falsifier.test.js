"use strict";
// FALSIFIER: default-deny-timedout-check — record-trust gate. A `status:"timeout"` result -> `check-timed-out` (distinct reason). MUST-BLOCK.
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-timedout-check — status:timeout MUST-BLOCK (check-timed-out)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });
  const out = ctl.reconcileRunManifest(rm, [result("alpha", { status: "timeout" })]);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "check-timed-out");
  assert.strictEqual(out.offending, "alpha");
});
