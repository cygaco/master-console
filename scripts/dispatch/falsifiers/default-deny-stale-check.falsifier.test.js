"use strict";
// FALSIFIER: default-deny-stale-check — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-stale-check — a result whose nonce != the manifest's nonce MUST-BLOCK (stale-check-result)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });
  const results = [result("alpha", { nonce: "a-different-stale-nonce" })];

  const out = ctl.reconcileRunManifest(rm, results);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, "stale-check-result");
  assert.strictEqual(out.offending, "alpha");
});
