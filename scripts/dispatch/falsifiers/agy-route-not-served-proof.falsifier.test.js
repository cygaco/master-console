"use strict";
// FALSIFIER: agy-route-not-served-proof — record-trust gate: the helm-runner exit proof. A bare agy `route`/default-provider STRING, with no `hasEvidence:true` dispatch
const test = require("node:test");
const assert = require("node:assert");

test("agy-route-not-served-proof — a route/default string + attested:true with NO hasEvidence proves nothing", () => {
  const hr = require("../helm-runner");

  const agyAttack = {
    route: "agy:gemini-3.1-pro-high",
    attested: true,
    observedProvider: "antigravity",
    fallback: false,
    alive: true,
    verdict: "pass",
  };
  const lane = hr.collectLaneEvidence({ laneId: "agy", provider: "antigravity" }, agyAttack);

  assert.strictEqual(lane.hasEvidence, false, "MUST-BLOCK: a route label + a self-asserted attested:true, with no hasEvidence, is NOT proof");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(lane, "attested"), false, "collectLaneEvidence must NEVER surface an 'attested' field at all (zero agy attested:true anywhere)");

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
    { laneId: "agy", provider: "antigravity", runResult: agyAttack },
  ];
  const res = hr.runHelms({ profile: "panel-3lab", lanes }, {});
  assert.notStrictEqual(res.status, "PASS", "MUST-BLOCK: a route-label-only agy claim must never satisfy the required lane on panel-3lab");
  assert.strictEqual(res.panel.laneStatus.agy, "operator-owned-absent");
  assert.strictEqual(res.status, "BLOCKED-ON-OPERATOR");
});

test("an agy lane resolved via 'fallback' (a Claude clone) is never counted as the agy lab either", () => {
  const hr = require("../helm-runner");

  const coercedAgy = {
    hasEvidence: true,
    alive: true,
    verdict: "pass",
    observedProvider: "openai",
    fallback: true,
    attested: true,
  };
  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
    { laneId: "agy", provider: "antigravity", runResult: coercedAgy },
  ];
  const res = hr.runHelms({ profile: "panel-3lab", lanes }, {});
  assert.notStrictEqual(res.status, "PASS");
  assert.strictEqual(res.panel.laneStatus.agy, "coerced");
});
