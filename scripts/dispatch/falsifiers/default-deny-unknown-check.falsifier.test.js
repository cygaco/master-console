"use strict";
// FALSIFIER: default-deny-unknown-check — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-unknown-check — a result name not in expected_checks MUST-BLOCK (unknown-check-result)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });
  const results = [result("not-a-real-check")];

  const out = ctl.reconcileRunManifest(rm, results);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "unknown-check-result");
  assert.strictEqual(out.offending, "not-a-real-check");
});
