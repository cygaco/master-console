"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const HELM_RUNNER = path.join(__dirname, "helm-runner.js");

test("helm-runner-panel-2family — the profile is obtained via panel-lanes.getProfile (structural: helm-runner.js requires panel-lanes, never re-declares required/min_families locally)", () => {
  const src = fs.readFileSync(HELM_RUNNER, "utf8");
  assert.ok(/require\(["']\.\/panel-lanes["']\)/.test(src), "helm-runner.js must require('./panel-lanes') — the single lane-reduction authority");
  assert.ok(!/required\s*:\s*\[["']gpt["']/.test(src), "helm-runner.js must not hand-declare a bespoke required-lane list — that authority lives in panel-lanes.js's manifest");
});

test("helm-runner-panel-2family — GPT+Claude both alive+clean+attested -> PASS with exactly 2 observed families", () => {
  const hr = require("./helm-runner");

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];
  const res = hr.runHelms({ profile: "panel-2family", lanes }, {});
  assert.strictEqual(res.status, "PASS", JSON.stringify(res.panel));
  assert.strictEqual(res.panel.families, 2);
  assert.strictEqual(res.panel.binding, false, "panel-2family is the non-binding degraded floor per the manifest");
});

test("helm-runner-panel-2family — GPT missing entirely -> BLOCKED (never PASS on a single family)", () => {
  const hr = require("./helm-runner");

  const lanes = [{ laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } }];
  const res = hr.runHelms({ profile: "panel-2family", lanes }, {});
  assert.notStrictEqual(res.status, "PASS");
});

test("helm-runner-panel-2family — an UNKNOWN profile name throws/blocks rather than silently falling back to a default that could mask a required lane", () => {
  const hr = require("./helm-runner");

  const res = hr.runHelms({ profile: "panel-does-not-exist", lanes: [] }, {});
  assert.notStrictEqual(res.status, "PASS");
  assert.strictEqual(res.integration, undefined);
});
