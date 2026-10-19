"use strict";
const test = require("node:test");
const assert = require("node:assert");

test("run-manifest-satisfied POSITIVE (pure) — every expected check present + correct nonce + passing -> ok:true", () => {
  const ctl = require("../trusted-controller");
  const { manifest, result } = require("./_lib/run-manifest-fixtures");

  const rm = manifest({ expected_checks: ["alpha", "beta"], required_checks: ["alpha", "beta"] });
  const out = ctl.reconcileRunManifest(rm, [result("alpha"), result("beta")]);
  assert.deepStrictEqual(out, { ok: true });
});

test("run-manifest-satisfied POSITIVE (end-to-end) — a real controller + real pinned bundle run over a clean tree authorizes + integrates", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("run-manifest-satisfied-e2e");
  t.after(() => fx.cleanup());

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result);
});
