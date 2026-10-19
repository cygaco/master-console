"use strict";
// FALSIFIER: default-deny-missing-check — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-missing-check — an expected check with no result MUST-BLOCK (missing-required-check)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha", "beta"], required_checks: ["alpha", "beta"] });
  const results = [result("alpha")];

  const out = ctl.reconcileRunManifest(rm, results);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "missing-required-check");
  assert.strictEqual(out.offending, "beta");
});
