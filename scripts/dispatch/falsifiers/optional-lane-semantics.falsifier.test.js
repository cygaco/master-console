"use strict";
// FALSIFIER: optional-lane-semantics — record-trust gate: the helm-runner exit proof. An OPTIONAL agy lane that RAN and FAILED binds a non-PASS result (`optional-lane-ran-and-
const test = require("node:test");
const assert = require("node:assert");

test("optional-lane-semantics — an agy lane that RAN and FAILED binds (on panel-3lab, where agy is required)", () => {
  const hr = require("../helm-runner");

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
    { laneId: "agy", provider: "antigravity", runResult: { hasEvidence: true, alive: true, verdict: "fail", observedProvider: "antigravity", fallback: false } },
  ];
  const res = hr.runHelms({ profile: "panel-3lab", lanes }, {});

  assert.notStrictEqual(res.status, "PASS", "MUST-BLOCK: an optional lane that RAN and FAILED must bind, never silently pass");
  assert.strictEqual(res.status, "FAIL");
  assert.strictEqual(res.panel.laneStatus.agy, "fail");
  assert.strictEqual(res.integration, undefined);
});
