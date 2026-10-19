#!/usr/bin/env node
"use strict";
const assert = require("assert");
const {
  loadManifest,
  requiredLanes,
  isSanctionedInProcessLane,
  assertCliOnlyPanel,
  validatePanelManifest,
} = require("./panel-lanes");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const PASSES = [
  { provider: "antigravity", model: "gemini-3.1-pro-high", key: "primary" },
  { provider: "openai", model: "gpt-5.6-sol", key: "second_pass" },
  { provider: "claude", model: "claude-opus-4-8", key: "third_pass" },
];
const passesOf = () => PASSES;
const toolIdOf = (p) => ({ openai: "codex", gemini: "gemini", antigravity: "agy" }[p] ?? p);
const supportMatrix = { rows: { "agy-antigravity": { status: "down", proven: false, evidence_ref: "ADR-0031" } } };

test("LIVE manifest validates against live passesOf + support-matrix", () => {
  const out = validatePanelManifest();
  assert.ok(out.ok, `live manifest drift: ${(out.errors || []).join(" | ")}`);
});

test("panel-3lab requires [gpt,claude,agy]; panel-2family requires [gpt,claude], agy optional", () => {
  const m = loadManifest();
  assert.deepEqual(m.profiles["panel-3lab"].required, ["gpt", "claude", "agy"]);
  assert.equal(m.profiles["panel-3lab"].binding, true);
  assert.deepEqual(m.profiles["panel-2family"].required, ["gpt", "claude"]);
  assert.equal(m.profiles["panel-2family"].binding, false);
  assert.ok((m.profiles["panel-2family"].optional || []).includes("agy"));
  assert.equal(requiredLanes(m, "panel-3lab").length, 3);
});

test("phantom lane (provider not a pass) → fail-closed", () => {
  const manifest = {
    profiles: { "panel-3lab": { binding: true, required: ["gpt", "claude", "agy"] }, "panel-2family": { binding: false, required: ["gpt", "claude"], optional: ["agy"] } },
    sunset: { ref: "ADR-0031" },
    lanes: {
      gpt: { provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider" },
      claude: { provider: "claude", tool_id: "claude", shape: "in-process-agent" },
      agy: { provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", sunset_ref: "ADR-0031" },
      phantom: { provider: "mistral", tool_id: "mi", shape: "subprocess-cross-provider" },
    },
  };
  const out = validatePanelManifest({ manifest, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok && out.errors.some((e) => /phantom/i.test(e)));
});
test("tool_id drift (agy lane mislabeled 'gemini') → fail-closed", () => {
  const manifest = {
    profiles: { "panel-3lab": { binding: true, required: ["gpt", "claude", "agy"] }, "panel-2family": { binding: false, required: ["gpt", "claude"], optional: ["agy"] } },
    sunset: { ref: "ADR-0031" },
    lanes: {
      gpt: { provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider" },
      claude: { provider: "claude", tool_id: "claude", shape: "in-process-agent" },
      agy: { provider: "antigravity", tool_id: "gemini", shape: "subprocess-cross-provider", sunset_ref: "ADR-0031" },
    },
  };
  const out = validatePanelManifest({ manifest, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok && out.errors.some((e) => /tool_id/.test(e)));
});
test("wrong shape (cross-provider lane declared in-process) → fail-closed", () => {
  const manifest = {
    profiles: { "panel-3lab": { binding: true, required: ["gpt", "claude", "agy"] }, "panel-2family": { binding: false, required: ["gpt", "claude"], optional: ["agy"] } },
    sunset: { ref: "ADR-0031" },
    lanes: {
      gpt: { provider: "openai", tool_id: "codex", shape: "in-process-agent" },
      claude: { provider: "claude", tool_id: "claude", shape: "in-process-agent" },
      agy: { provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", sunset_ref: "ADR-0031" },
    },
  };
  const out = validatePanelManifest({ manifest, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok && out.errors.some((e) => /shape/.test(e)));
});
test("wrong sunset ref (stale ED-999060, not ADR-0031) → fail-closed", () => {
  const manifest = {
    profiles: { "panel-3lab": { binding: true, required: ["gpt", "claude", "agy"] }, "panel-2family": { binding: false, required: ["gpt", "claude"], optional: ["agy"] } },
    sunset: { ref: "ED-999060" },
    lanes: {
      gpt: { provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider" },
      claude: { provider: "claude", tool_id: "claude", shape: "in-process-agent" },
      agy: { provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", sunset_ref: "ED-999060" },
    },
  };
  const out = validatePanelManifest({ manifest, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok && out.errors.some((e) => /sunset ref to ADR-0031/.test(e)), out.errors.join(" | "));
});
test("missing sunset ref entirely → fail-closed", () => {
  const manifest = {
    profiles: { "panel-3lab": { binding: true, required: ["gpt", "claude", "agy"] }, "panel-2family": { binding: false, required: ["gpt", "claude"], optional: ["agy"] } },
    lanes: {
      gpt: { provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider" },
      claude: { provider: "claude", tool_id: "claude", shape: "in-process-agent" },
      agy: { provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider" },
    },
  };
  const out = validatePanelManifest({ manifest, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok && out.errors.some((e) => /sunset ref to ADR-0031/.test(e)), out.errors.join(" | "));
});

test("registry loader throw → loaderError (fail-closed, not swallowed)", () => {
  const out = validatePanelManifest({
    manifest: loadManifest(),
    passesOf: () => { throw new Error("registry unreadable"); },
    toolIdOf,
    supportMatrix,
  });
  assert.ok(!out.ok && out.loaderError === true);
});

test("CLI-only: a gpt lane resolved in-process → REFUSED", () => {
  const out = assertCliOnlyPanel([{ laneId: "gpt", provider: "openai", shape: "in-process-agent" }]);
  assert.ok(!out.ok && out.violations.some((v) => /gpt/.test(v)));
});
test("CLI-only: an agy lane resolved in-process → REFUSED", () => {
  const out = assertCliOnlyPanel([{ laneId: "agy", provider: "antigravity", shape: "in-process-agent" }]);
  assert.ok(!out.ok);
});
test("CLI-only negative (the false-green): a gpt lane ASSERTING lane id 'claude' but provider openai → REFUSED", () => {
  assert.equal(isSanctionedInProcessLane("claude", { provider: "openai" }), false);
  const out = assertCliOnlyPanel([{ laneId: "claude", provider: "openai", shape: "in-process-agent" }]);
  assert.ok(!out.ok, "a non-claude-provider lane must NOT be exempted even if it labels itself 'claude'");
});
test("CLI-only sanctioned (must PASS): the genuine claude hunter in-process (structural: claude+claude+in-process) → accepted", () => {
  assert.equal(isSanctionedInProcessLane("claude", { provider: "claude", shape: "in-process-agent" }), true);
  const out = assertCliOnlyPanel([
    { laneId: "gpt", provider: "openai", shape: "subprocess-cross-provider" },
    { laneId: "agy", provider: "antigravity", shape: "subprocess-cross-provider" },
    { laneId: "claude", provider: "claude", shape: "in-process-agent" },
  ]);
  assert.ok(out.ok, `sanctioned hunter over-rejected: ${out.violations.join(" | ")}`);
});
test("CLI-only: the settable sanctioned_lane_id/role LABEL does NOT grant the exemption — structure does", () => {
  assert.equal(isSanctionedInProcessLane("claude", { provider: "openai", sanctioned_lane_id: "security_claude_hunter", shape: "in-process-agent" }), false, "provider must be claude — a gpt lane can't ride the settable label");
  assert.equal(isSanctionedInProcessLane("gpt", { provider: "claude", shape: "in-process-agent" }), false, "only laneId 'claude' can be the sanctioned lane");
  assert.equal(isSanctionedInProcessLane("claude", { provider: "claude" }), false, "no in-process shape → not the sanctioned in-process lane");
  assert.equal(isSanctionedInProcessLane("claude", { provider: "claude", shape: "subprocess-claude" }), false, "a subprocess-claude lane is not the in-process hunter lane (it does not need the exemption)");
  const out = assertCliOnlyPanel([{ laneId: "gpt", provider: "openai", shape: "in-process-agent", sanctioned_lane_id: "security_claude_hunter" }]);
  assert.ok(!out.ok, "a gpt lane resolved in-process must be refused even if it sets the sanctioned label");
});

test("panel-3lab.required=[agy] (gpt,claude dropped) → validation FAILS", () => {
  const mutated = JSON.parse(JSON.stringify(loadManifest()));
  mutated.profiles["panel-3lab"].required = ["agy"];
  const out = validatePanelManifest({ manifest: mutated, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok, "a panel-3lab that silently drops gpt+claude must not validate");
  assert.ok(out.errors.some((e) => /EXACTLY the full lab set/.test(e)), out.errors.join(" | "));
});
test("panel-2family.required=[gpt] (claude dropped) → validation FAILS", () => {
  const mutated = JSON.parse(JSON.stringify(loadManifest()));
  mutated.profiles["panel-2family"].required = ["gpt"];
  const out = validatePanelManifest({ manifest: mutated, passesOf, toolIdOf, supportMatrix });
  assert.ok(!out.ok, "a panel-2family that silently drops claude must not validate");
});
test("negative control: the REAL manifest (exact sets) still validates ok", () => {
  const out = validatePanelManifest({ manifest: loadManifest(), passesOf, toolIdOf, supportMatrix });
  assert.ok(out.ok, `real manifest must validate: ${(out.errors || []).join(" | ")}`);
});

{
  const pl2 = require("./panel-lanes");
  const twoFam = { name: "panel-2family", required: ["gpt", "claude"], min_families: 2, binding: false };
  const laneEvidence = (verdict) => [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: true, verdict, hasEvidence: true },
    { laneId: "claude", contractedProvider: "claude", observedProvider: "claude", fallback: false, alive: true, verdict, hasEvidence: true },
  ];
  test("panelStatus treats an unknown verdict ('banana') as BLOCKED, never PASS", () => {
    assert.notEqual(pl2.panelStatus(twoFam, laneEvidence("banana")).status, "PASS");
  });
  test("no over-block: a clean pass 2-family panel still PASSes", () => {
    assert.equal(pl2.panelStatus(twoFam, laneEvidence("pass")).status, "PASS");
  });
  test("min_families: a mutated profile with min_families:1 fails validation", () => {
    const manifest = pl2.loadManifest();
    manifest.profiles["panel-3lab"].min_families = 1;
    const out = pl2.validatePanelManifest({ manifest });
    assert.equal(out.ok, false, "min_families:1 must be rejected");
    assert.ok(out.errors.some((e) => /min_families/.test(e)), "the error must name min_families");
  });
  test("min_families no over-block: the real manifest (min_families:2) still validates", () => {
    assert.equal(pl2.validatePanelManifest().ok, true, "the shipped manifest must still validate clean");
  });
  const agyRow = (status, proven) => ({ rows: { "agy-antigravity": { status, required: true, proven, evidence_ref: "x" } } });
  test("agyLive: a not-verified agy row is NOT live, exactly like a down row", () => {
    assert.equal(pl2.agyLive(agyRow("not-verified", false)), false);
    assert.equal(pl2.agyLive(agyRow("down", false)), false);
    assert.equal(pl2.agyLive(agyRow("not-verified", true)), false, "proven:true never lifts a not-verified status");
  });
  test("agyLive: the REAL support-matrix agy row is NOT live; supported+proven is the only live reading", () => {
    assert.equal(pl2.agyLive(pl2.loadSupportMatrix()), false);
    assert.equal(pl2.agyLive(agyRow("supported", true)), true);
  });
  test("LIVE manifest validates against a support-matrix whose agy row is not-verified", () => {
    const out = validatePanelManifest({ manifest: loadManifest(), passesOf, toolIdOf, supportMatrix: agyRow("not-verified", false) });
    assert.ok(out.ok, `must validate: ${(out.errors || []).join(" | ")}`);
  });
}

if (failures.length) {
  process.stderr.write(`FAIL [panel-lanes.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [panel-lanes.test] ${passed} passed (single-source drift + CLI-only tooth + verdict allowlist + min_families)\n`);
