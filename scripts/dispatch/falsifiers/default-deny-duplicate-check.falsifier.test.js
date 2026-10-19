"use strict";
// FALSIFIER: default-deny-duplicate-check — record-trust gate. More than one result for the SAME check name -> `duplicate-check-result` (distinct reason).
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-duplicate-check — >1 result for one check name MUST-BLOCK (duplicate-check-result)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });
  const results = [result("alpha"), result("alpha")];

  const out = ctl.reconcileRunManifest(rm, results);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "duplicate-check-result");
  assert.strictEqual(out.offending, "alpha");
});
