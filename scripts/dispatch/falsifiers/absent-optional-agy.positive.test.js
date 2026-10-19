"use strict";
const test = require("node:test");
const assert = require("node:assert");

test("absent-optional-agy POSITIVE — no agy lane at all on panel-2family still PASSES and drives exactly one integration", () => {
  const hr = require("../helm-runner");

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];

  let integrateCalls = 0;
  const integrateFn = (input, opts) => {
    integrateCalls++;
    assert.strictEqual(input.base_commit, "base-x");
    void opts;
    return { ok: true, decision: "INTEGRATED", receipt: { committed_head: "result-y" } };
  };

  const res = hr.runHelms(
    { profile: "panel-2family", lanes, integrate: { base_commit: "base-x", result_commit: "result-y", target_ref: "refs/heads/main" } },
    { integrateFn },
  );

  assert.strictEqual(res.status, "PASS", JSON.stringify(res.panel));
  assert.strictEqual(integrateCalls, 1, "exactly ONE integration must be driven on a PASS");
  assert.ok(res.integration && res.integration.ok === true);
});
