"use strict";
// FALSIFIER: default-deny-skipped-required-check — record-trust gate. A `status:"skipped"` result on a REQUIRED check -> `required-check-skipped` (distinct reason).
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-skipped-required-check — a REQUIRED check skipped MUST-BLOCK; an OPTIONAL check skipped does not", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rmRequired = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });
  const outRequired = ctl.reconcileRunManifest(rmRequired, [result("alpha", { status: "skipped" })]);
  assert.strictEqual(outRequired.ok, false);
  assert.strictEqual(outRequired.reason, "required-check-skipped");
  assert.strictEqual(outRequired.offending, "alpha");

  const rmOptional = manifest({ expected_checks: ["alpha", "gamma"], required_checks: ["alpha"] });
  const outOptional = ctl.reconcileRunManifest(rmOptional, [result("alpha"), result("gamma", { status: "skipped" })]);
  assert.strictEqual(outOptional.ok, true, JSON.stringify(outOptional));
});
