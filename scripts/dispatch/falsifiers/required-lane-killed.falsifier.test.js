"use strict";
// FALSIFIER: required-lane-killed — record-trust gate: the helm-runner exit proof. Killing EITHER required lane (GPT or Claude) yields BLOCKED, never PASS — and, on
const test = require("node:test");
const assert = require("node:assert");

test("required-lane-killed — killing the GPT required lane MUST-BLOCK (never PASS), and no integration is attempted", () => {
  const hr = require("../helm-runner");

  let integrateCalls = 0;
  const integrateFn = () => {
    integrateCalls++;
    return { ok: true, decision: "INTEGRATED" };
  };

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "fail", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];
  const res = hr.runHelms({ profile: "panel-2family", lanes, integrate: { base_commit: "x", result_commit: "y", target_ref: "refs/heads/integ" } }, { integrateFn });

  assert.notStrictEqual(res.status, "PASS", "MUST-BLOCK: a required lane FAILED, the panel must never read PASS");
  assert.strictEqual(res.status, "FAIL");
  assert.strictEqual(res.integration, undefined, "no integration may be driven when the panel is not PASS");
  assert.strictEqual(integrateCalls, 0, "trusted-controller.integrate() must NEVER be reached when a required lane failed");
});

test("required-lane-killed — killing the Claude required lane MUST-BLOCK (never PASS)", () => {
  const hr = require("../helm-runner");

  let integrateCalls = 0;
  const integrateFn = () => {
    integrateCalls++;
    return { ok: true, decision: "INTEGRATED" };
  };

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: false, verdict: "", observedProvider: "claude", fallback: false } },
  ];
  const res = hr.runHelms({ profile: "panel-2family", lanes, integrate: { base_commit: "x", result_commit: "y", target_ref: "refs/heads/integ" } }, { integrateFn });

  assert.notStrictEqual(res.status, "PASS");
  assert.strictEqual(res.integration, undefined);
  assert.strictEqual(integrateCalls, 0);
});
