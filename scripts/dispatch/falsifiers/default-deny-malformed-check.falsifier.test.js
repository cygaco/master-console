"use strict";
// FALSIFIER: default-deny-malformed-check — record-trust gate. A result missing status/digest or with the wrong shape -> `malformed-check-result` (distinct
const test = require("node:test");
const assert = require("node:assert");

test("default-deny-malformed-check — missing digest / missing status / non-string digest MUST-BLOCK (malformed-check-result)", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result, NONCE } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha"], required_checks: ["alpha"] });

  const malformations = [
    { ...result("alpha"), digest: undefined },
    { ...result("alpha"), status: undefined },
    { ...result("alpha"), digest: 12345 },
    { name: "alpha", status: "pass", nonce: NONCE },
  ];
  for (const m of malformations) {
    const out = ctl.reconcileRunManifest(rm, [m]);
    assert.strictEqual(out.ok, false, JSON.stringify(m));
    assert.strictEqual(out.reason, "malformed-check-result", JSON.stringify(m));
  }

  const out2 = ctl.reconcileRunManifest(rm, [result("alpha", { status: "banana" })]);
  assert.strictEqual(out2.ok, false);
  assert.strictEqual(out2.reason, "malformed-check-result");
  assert.strictEqual(out2.offending, "alpha");
});
