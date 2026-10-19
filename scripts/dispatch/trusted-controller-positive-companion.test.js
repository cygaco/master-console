"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

test("trusted-controller-positive-companion — reconcileRunManifest POSITIVE: every expected check present, correctly-nonced, and passing -> ok:true", () => {
  const ctl = require("./trusted-controller");

  const runManifest = {
    schema_version: "run-manifest/v1",
    nonce: "nonce-positive-1",
    minted_at: Date.now(),
    expected_checks: ["false-green-envelope", "no-nul-bytes", "suite-completeness"],
    required_checks: ["false-green-envelope", "no-nul-bytes", "suite-completeness"],
  };
  const results = runManifest.expected_checks.map((name) => ({
    name,
    status: "pass",
    digest: `digest-${name}`,
    nonce: runManifest.nonce,
  }));
  const out = ctl.reconcileRunManifest(runManifest, results);
  assert.deepStrictEqual(out, { ok: true });
});

test("trusted-controller-positive-companion — a FULL real end-to-end run (real bundle, real lease, real git) DOES integrate — a reject-everything integrate() stub is defeated by this control", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const { headSha } = require("./falsifiers/_lib/git-scratch");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("positive-companion-e2e");
  t.after(() => fx.cleanup());

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(result.decision, "INTEGRATED");
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result);

  assert.notStrictEqual(result.ok, false);
});

test("trusted-controller-positive-companion — helm-runner's own PASS path (a real controller call through runHelms) also integrates — proves the positive path holds through the aggregate entrypoint too", (t) => {
  const { makeControllerFixture, standardInput } = require("./falsifiers/_lib/controller-fixtures");
  const hr = require("./helm-runner");

  const fx = makeControllerFixture("positive-companion-helm");
  t.after(() => fx.cleanup());

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];
  const controllerOpts = {
    bundleManifestPath: fx.manifestPath,
    bundleRoot: fx.bundleRoot,
    candidateRoot: fx.dir,
    gitRoot: fx.dir,
    spId: fx.spId,
    leaseRoot: fx.leaseRoot,
  };
  const integrateInput = standardInput(fx);
  const res = hr.runHelms(
    {
      profile: "panel-2family",
      lanes,
      integrate: {
        base_commit: integrateInput.base_commit,
        result_commit: integrateInput.result_commit,
        target_ref: integrateInput.target_ref,
        workorder: integrateInput.workorder,
        result_envelope: integrateInput.result_envelope,
      },
    },
    { controllerOpts },
  );
  assert.strictEqual(res.status, "PASS", JSON.stringify(res.panel));
  assert.ok(res.integration && res.integration.ok === true);
});
