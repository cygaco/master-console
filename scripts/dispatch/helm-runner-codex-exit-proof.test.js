"use strict";
const test = require("node:test");
const assert = require("node:assert");

test("helm-runner-codex-exit-proof — collectLaneEvidence forwards the codex lane's controlPlane portable-exit-proof fields VERBATIM", () => {
  const hr = require("./helm-runner");

  const codexControlPlane = {
    started: true,
    completed: true,
    died: false,
    timedOut: false,
    quota: { exceeded: false },
    approval: { required: false },
    resume: { attempted: false },
  };
  const lane = hr.collectLaneEvidence(
    { laneId: "gpt", provider: "openai" },
    { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false, controlPlane: codexControlPlane },
  );
  assert.deepStrictEqual(lane.controlPlane, codexControlPlane, "the portable exit-proof fields must be forwarded VERBATIM from the real control-plane record");
});

test("helm-runner-codex-exit-proof — a MISSING controlPlane on the record yields controlPlane:null (never a fabricated default shape)", () => {
  const hr = require("./helm-runner");

  const lane = hr.collectLaneEvidence({ laneId: "gpt", provider: "openai" }, { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai" });
  assert.strictEqual(lane.controlPlane, null);
});

test("helm-runner-codex-exit-proof — a REAL end-to-end GPT(codex)+Claude PASS drives exactly one controller-checked integration, and the GPT lane's control-plane evidence survives into perHelm unmodified", (t) => {
  const { makeControllerFixture, standardInput } = require("./falsifiers/_lib/controller-fixtures");
  const hr = require("./helm-runner");

  const fx = makeControllerFixture("codex-exit-proof-e2e");
  t.after(() => fx.cleanup());

  const codexControlPlane = { started: true, completed: true, died: false, timedOut: false, quota: { exceeded: false }, approval: { required: false }, resume: { attempted: false } };
  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false, controlPlane: codexControlPlane } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];
  const integrateInput = standardInput(fx);
  const controllerOpts = { bundleManifestPath: fx.manifestPath, bundleRoot: fx.bundleRoot, candidateRoot: fx.dir, gitRoot: fx.dir, spId: fx.spId, leaseRoot: fx.leaseRoot };

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
  const gptLane = res.perHelm.find((l) => l.laneId === "gpt");
  assert.deepStrictEqual(gptLane.controlPlane, codexControlPlane);
  assert.strictEqual(res.perHelm.find((l) => l.laneId === "agy"), undefined);
});
