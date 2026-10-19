#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { panelStatus, STATUS } = require("./panel-lanes");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const PANEL_3LAB = { name: "panel-3lab", required: ["gpt", "claude", "agy"], min_families: 2, binding: true };
const PANEL_2FAM = { name: "panel-2family", required: ["gpt", "claude"], min_families: 2, binding: false };

const clean = (laneId, provider) => ({ laneId, contractedProvider: provider, observedProvider: provider, fallback: false, alive: true, verdict: "pass", hasEvidence: true });

test("CONTROL: all required lanes alive+clean+attested, 2 families → PASS", () => {
  const r = panelStatus(PANEL_2FAM, [clean("gpt", "openai"), clean("claude", "claude")]);
  assert.equal(r.status, STATUS.PASS, r.reason);
  assert.equal(r.families, 2);
});
test("CONTROL: full 3-lab all-attested → PASS", () => {
  const r = panelStatus(PANEL_3LAB, [clean("gpt", "openai"), clean("claude", "claude"), clean("agy", "antigravity")]);
  assert.equal(r.status, STATUS.PASS, r.reason);
});

test("CANARY kill-one-lane: gpt dead → BLOCKED-INCONCLUSIVE", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: false, verdict: "error", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
});

test("CANARY contracted-but-down agy (zero record) → panel-3lab BLOCKED-ON-OPERATOR", () => {
  const r = panelStatus(
    PANEL_3LAB,
    [clean("gpt", "openai"), clean("claude", "claude") ],
    { agyOperatorOwned: true },
  );
  assert.equal(r.status, STATUS.BLOCKED_ON_OPERATOR, r.reason);
  assert.notEqual(r.status, STATUS.PASS);
});
test("CANARY agy absent + gpt ALSO dead → BLOCKED-INCONCLUSIVE (not merely operator)", () => {
  const r = panelStatus(
    PANEL_3LAB,
    [{ laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: false, verdict: "error", hasEvidence: true }, clean("claude", "claude")],
    { agyOperatorOwned: true },
  );
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
});

test("CANARY masquerade: gpt+agy coerced to claude (fallback:true) labeled 3-lab → NOT PASS", () => {
  const r = panelStatus(PANEL_3LAB, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "claude", fallback: true, alive: true, verdict: "pass", hasEvidence: true },
    clean("claude", "claude"),
    { laneId: "agy", contractedProvider: "antigravity", observedProvider: "claude", fallback: true, alive: true, verdict: "pass", hasEvidence: true },
  ]);
  assert.notEqual(r.status, STATUS.PASS, "an all-Claude set must NEVER pass as cross-provider");
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
  assert.equal(r.laneStatus.gpt, "coerced");
  assert.equal(r.laneStatus.agy, "coerced");
});
test("CANARY diversity: all lanes observed-claude (1 family) → BLOCKED (observed count, not label)", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "claude", observedProvider: "claude", fallback: false, alive: true, verdict: "pass", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
  assert.equal(r.families, 1);
});

test("CANARY judge-refusal: a required lane verdict 'error' → BLOCKED-INCONCLUSIVE", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: true, verdict: "error", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
  assert.equal(r.laneStatus.gpt, "refused-or-malformed");
});
test("CANARY malformed: a required lane verdict '' → BLOCKED-INCONCLUSIVE", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: true, verdict: "", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
});
test("CANARY missing-evidence: a required lane hasEvidence:false → BLOCKED-INCONCLUSIVE", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", hasEvidence: false },
    clean("claude", "claude"),
  ]);
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
  assert.equal(r.laneStatus.gpt, "missing-evidence");
});
test("CANARY loader-failure: opts.loaderError → BLOCKED-INCONCLUSIVE (loader path, distinct)", () => {
  const r = panelStatus(PANEL_2FAM, [], { loaderError: true });
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
  assert.equal(r.loader, true, "loader path must be flagged distinctly from an evaluator block");
});

test("a required lane binding FAIL → FAIL", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: true, verdict: "fail", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.equal(r.status, STATUS.FAIL, r.reason);
});

test("INVARIANT: PASS only when every required lane is attested + diverse", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: true, alive: true, verdict: "pass", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.notEqual(r.status, STATUS.PASS, "fallback:true must never count as an attested lane");
});

test("omitted hasEvidence: a labels-only lane (no hasEvidence) → BLOCKED, not PASS", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: true, verdict: "pass" },
    clean("claude", "claude"),
  ]);
  assert.notEqual(r.status, STATUS.PASS, "omitted hasEvidence must never be treated as proof");
  assert.equal(r.status, STATUS.BLOCKED_INCONCLUSIVE, r.reason);
  assert.equal(r.laneStatus.gpt, "missing-evidence");
});
test("omitted alive: a lane with evidence but no liveness (alive omitted) → BLOCKED, not PASS", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, verdict: "pass", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.notEqual(r.status, STATUS.PASS, "omitted alive must never be treated as liveness");
  assert.equal(r.laneStatus.gpt, "dead");
});
test("omitted observedProvider: no proof of the contracted lab → coerced/BLOCKED, not PASS", () => {
  const r = panelStatus(PANEL_2FAM, [
    { laneId: "gpt", contractedProvider: "openai", fallback: false, alive: true, verdict: "pass", hasEvidence: true },
    clean("claude", "claude"),
  ]);
  assert.notEqual(r.status, STATUS.PASS, "no observed provider = no proof of the contracted lab");
  assert.equal(r.laneStatus.gpt, "coerced");
});

if (failures.length) {
  process.stderr.write(`FAIL [panel-status.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [panel-status.test] ${passed} passed (canary corpus: kill-lane/agy-down/masquerade/refusal/malformed/missing/loader; never PASS with a lane absent)\n`);
