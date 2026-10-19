#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { isSecurityPanelRole, applyPanelGate, panelLoaderFailClosed } = require("../dispatch-review");
const panelLanes = require("./panel-lanes");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const lane = (o) => ({ pass: o.laneId, model: null, hasEvidence: true, lane_out: null, ...o });
const gptClean = lane({ laneId: "gpt", provider: "openai", observedProvider: "openai", fallback: false, ok: true, verdict: "pass" });
const claudeClean = lane({ laneId: "claude", provider: "claude", observedProvider: "claude", fallback: false, ok: true, verdict: "pass" });
const agyDown = lane({ laneId: "agy", provider: "antigravity", observedProvider: null, fallback: false, ok: false, verdict: "error", hasEvidence: false });

const PRID = "panel-test-run-1";
const now = () => new Date().toISOString();
const ledgerClean = [
  { role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", ok: true, fallback: false, output_digest: "d-gpt", cmdline_checksum: "c-gpt", panel_run_id: PRID, completed_at: now() },
  { role: "security-reviewer", provider: "claude", tool_id: "claude", shape: "subprocess-claude", ok: true, fallback: false, output_digest: "d-cl", cmdline_checksum: "c-cl", panel_run_id: PRID, completed_at: now() },
];
const ctxClean = { readLedger: () => ledgerClean, sinceMs: 0, panelRunId: PRID };
const hunterRec = { role: "security_claude_hunter", provider: "claude", shape: "in-process-agent", ok: true, fallback: false, verdict: "pass", output_digest: "d-hunter", panel_run_id: PRID, completed_at: now() };

test("isSecurityPanelRole: only security-reviewer is the panel role", () => {
  assert.equal(isSecurityPanelRole("security-reviewer"), true);
  assert.equal(isSecurityPanelRole("frontend-reviewer"), false);
});

test("clean 2-family + subprocess-claude ledger → floor PASS, binding NOT PASS", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], ctxClean);
  assert.equal(g.manifest_valid, true);
  assert.equal(g.contract_evaluated, "panel-2family-floor", "the gate must record WHICH contract it evaluated");
  assert.equal(g.floor.claude_channel, "subprocess", "the floor's claude lane is honestly the subprocess channel");
  assert.equal(g.binding.claude_channel, "in-process-hunter");
  assert.notEqual(g.binding.status, "PASS", "panel-3lab must never PASS without the hunter + agy");
  assert.equal(g.floor_pass, true, `floor should pass on a clean, ledger-corroborated 2-family: ${g.floor.reason}`);
  assert.equal(g.floor.status, "PASS");
});

test("binding requires the in-process hunter — subprocess-claude alone → binding claude UNSATISFIED", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], ctxClean);
  assert.notEqual(g.binding.status, "PASS");
  assert.equal(g.binding.status.startsWith("BLOCKED"), true, g.binding.reason);
});
test("WITH a hunter record, the binding claude lane is alive → 3lab BLOCKED-ON-OPERATOR (only agy)", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => [...ledgerClean, hunterRec], sinceMs: 0, panelRunId: PRID });
  assert.equal(g.floor_pass, true, "floor still passes on the subprocess-claude lane");
  assert.equal(g.binding.status, "BLOCKED-ON-OPERATOR", `with the hunter present, only agy blocks 3lab: ${g.binding.reason}`);
});
test("a hunter record with NO verdict → binding claude BLOCKS (not only-agy) — missing verdict is not a pass", () => {
  const noVerdictHunter = { ...hunterRec }; delete noVerdictHunter.verdict;
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => [...ledgerClean, noVerdictHunter], sinceMs: 0, panelRunId: PRID });
  assert.notEqual(g.binding.status, "PASS");
  assert.ok(/claude/.test(g.binding.reason), `a verdict-less hunter must BLOCK the binding claude lane, not read as pass: ${g.binding.reason}`);
});
test("a hunter record with verdict:'fail' → binding claude BLOCKS (a hunter FAIL binds)", () => {
  const failHunter = { ...hunterRec, verdict: "fail" };
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => [...ledgerClean, failHunter], sinceMs: 0, panelRunId: PRID });
  assert.notEqual(g.binding.status, "PASS", "a hunter FAIL can never let the binding claude lane pass");
  assert.ok(/claude/.test(g.binding.reason), `hunter-fail must bind to the claude lane: ${g.binding.reason}`);
});
test("a subprocess-claude record LABELED as the hunter role does NOT satisfy the binding (shape mismatch)", () => {
  const fakeHunter = { ...ledgerClean[1], role: "security_claude_hunter" };
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => [ledgerClean[0], fakeHunter], sinceMs: 0, panelRunId: PRID });
  assert.notEqual(g.binding.status, "PASS", "a subprocess record claiming the hunter role must not satisfy the binding");
});

test("masquerade: gpt lane observed-claude/fallback:true → floor BLOCKED, not PASS", () => {
  const gptCoerced = lane({ laneId: "gpt", provider: "openai", observedProvider: "claude", fallback: true, ok: true, verdict: "pass" });
  const g = applyPanelGate(panelLanes, [gptCoerced, claudeClean, agyDown], ctxClean);
  assert.equal(g.floor_pass, false, "an all-Claude masquerade must NOT pass the floor");
});

test("envelope ok but NO ledger record → hasEvidence:false → floor BLOCKED (envelope != attestation)", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => [], sinceMs: 0 });
  assert.equal(g.floor_pass, false, "a lane with no durable ledger record must not count as attested");
  assert.equal(g.floor.laneStatus.gpt, "missing-evidence");
});
test("a ledger record WITHOUT output_digest (config echo) → not evidence → floor BLOCKED", () => {
  const echoLedger = [
    { role: "security-reviewer", provider: "openai", shape: "subprocess-cross-provider", ok: true, completed_at: new Date().toISOString() },
    ledgerClean[1],
  ];
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => echoLedger, sinceMs: 0 });
  assert.equal(g.floor_pass, false, "a config-echo record (no output_digest) is not durable evidence");
});

test("validatePanelManifest not-ok → gate fail-closed (manifest_valid:false, floor_pass:false)", () => {
  const badPanelLanes = { ...panelLanes, validatePanelManifest: () => ({ ok: false, errors: ["mutated panel-2family.required=[claude]"] }) };
  const g = applyPanelGate(badPanelLanes, [gptClean, claudeClean], ctxClean);
  assert.equal(g.manifest_valid, false);
  assert.equal(g.floor_pass, false, "a runner must not certify against an invalid/drifted manifest");
});
test("validatePanelManifest THROW → gate fail-closed", () => {
  const throwPanelLanes = { ...panelLanes, validatePanelManifest: () => { throw new Error("loader boom"); } };
  const g = applyPanelGate(throwPanelLanes, [gptClean, claudeClean], ctxClean);
  assert.equal(g.floor_pass, false);
  assert.ok(/fail-closed/.test(g.floor.reason));
});

test("gpt lane binding FAIL (with ledger) → floor not PASS", () => {
  const gptFail = lane({ laneId: "gpt", provider: "openai", observedProvider: "openai", fallback: false, ok: true, verdict: "fail" });
  const g = applyPanelGate(panelLanes, [gptFail, claudeClean, agyDown], ctxClean);
  assert.equal(g.floor_pass, false);
});

test("gpt record with OMITTED fallback → not corroborated (not coerced live) → floor BLOCKED", () => {
  const omitFallback = [{ ...ledgerClean[0], fallback: undefined }, ledgerClean[1]];
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => omitFallback, sinceMs: 0, panelRunId: PRID });
  assert.equal(g.floor_pass, false, "an omitted fallback must not be coerced to fallback:false");
});
test("gpt record with WRONG tool_id → not corroborated → floor BLOCKED", () => {
  const wrongTool = [{ ...ledgerClean[0], tool_id: "gemini" }, ledgerClean[1]];
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => wrongTool, sinceMs: 0, panelRunId: PRID });
  assert.equal(g.floor_pass, false, "a record on the wrong executable must not corroborate the lane");
});
test("gpt record with NO cmdline_checksum (no invocation) → floor BLOCKED", () => {
  const noInv = [{ ...ledgerClean[0], cmdline_checksum: undefined }, ledgerClean[1]];
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => noInv, sinceMs: 0, panelRunId: PRID });
  assert.equal(g.floor_pass, false);
});

test("records with a different panel_run_id → not same-run identity → floor BLOCKED", () => {
  const staleRun = ledgerClean.map((r) => ({ ...r, panel_run_id: "panel-OTHER-run" }));
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => staleRun, sinceMs: 0, panelRunId: PRID });
  assert.equal(g.floor_pass, false, "a concurrent/other-run record must not satisfy this run's gate");
});

test("security-reviewer + MODULE_NOT_FOUND (panel-lanes) → fail-closed", () => {
  const err = Object.assign(new Error("Cannot find module './dispatch/panel-lanes'"), { code: "MODULE_NOT_FOUND" });
  assert.equal(panelLoaderFailClosed("security-reviewer", err), true, "a missing panel gate must fail the SECURITY review closed");
});
test("non-security role + MODULE_NOT_FOUND → fail-open (additive contract)", () => {
  const err = Object.assign(new Error("Cannot find module './dispatch/panel-lanes'"), { code: "MODULE_NOT_FOUND" });
  assert.equal(panelLoaderFailClosed("frontend-reviewer", err), false, "the panel gate is optional for a non-security role");
});
test("ANY non-module-absent loader error (syntax/parse) → fail-closed, even non-security", () => {
  const parseErr = new SyntaxError("Unexpected token in panel-lanes.js");
  assert.equal(panelLoaderFailClosed("security-reviewer", parseErr), true);
  assert.equal(panelLoaderFailClosed("frontend-reviewer", parseErr), true, "a real loader error is not the additive-absent case");
});

{
  const dr = require("../dispatch-review");
  test("mergeLanes treats an unknown verdict ('banana') as NOT clean (merges to error)", () => {
    const m = dr.mergeLanes("security-reviewer", [
      { pass: "primary", provider: "antigravity", ok: true, verdict: "banana", laneId: "agy" },
      { pass: "second_pass", provider: "openai", ok: true, verdict: "banana", laneId: "gpt" },
    ]);
    assert.equal(m.ok, false, "an unrecognized verdict must not merge to clean/pass");
    assert.equal(m.mergedVerdict, "error", "an unrecognized verdict merges to error (fail-closed)");
  });
  test("no over-block: two real passes still merge clean", () => {
    const m = dr.mergeLanes("security-reviewer", [
      { provider: "openai", ok: true, verdict: "pass", laneId: "gpt" },
      { provider: "claude", ok: true, verdict: "pass", laneId: "claude" },
    ]);
    assert.equal(m.ok, true, "two clean passes must merge clean");
  });
  test("verdictOf allowlists the parsed verdict (unknown → error)", () => {
    assert.equal(dr.verdictOf({ parsed: { verdict: "banana" } }), "error", "an unknown parsed verdict must normalize to error");
    assert.equal(dr.verdictOf({ parsed: { verdict: "PASS" } }), "pass", "a real pass verdict is preserved");
    assert.equal(dr.verdictOf({ parsed: { verdict: "fail" } }), "fail", "a real fail verdict is preserved");
  });
}

const { signRecord } = require("./attest-signing");
test("requireSignature blocks the floor when lane records are UNSIGNED", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { ...ctxClean, requireSignature: true });
  assert.equal(g.floor_pass, false, "unsigned lane records must NOT corroborate the floor under requireSignature");
});
test("requireSignature PASSES the floor when the SAME lane records are validly SIGNED", () => {
  const signedLedger = ledgerClean.map((r) => ({ ...r, attest_sig: signRecord(r) }));
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { readLedger: () => signedLedger, sinceMs: 0, panelRunId: PRID, requireSignature: true });
  assert.equal(g.floor_pass, true, "validly-signed lane records must corroborate the floor");
});

const agyLive = lane({ laneId: "agy", provider: "antigravity", observedProvider: "antigravity", fallback: false, ok: true, verdict: "pass" });
const agyRecordCorroborated = { role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", ok: true, fallback: false, output_digest: "d-agy", cmdline_checksum: "c-agy", panel_run_id: PRID, completed_at: now(), served_default: true, attested_model_id: "Gemini 3.1 Pro (High)" };
test("a fully-corroborated agy record does NOT green the panel-3lab BINDING (served-model fail-close)", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyLive], { readLedger: () => [...ledgerClean, hunterRec, agyRecordCorroborated], sinceMs: 0, panelRunId: PRID });
  assert.notEqual(g.binding.status, "PASS", `a corroborated agy record must NOT green the binding — agy has no server-origin served-model receipt: ${g.binding.reason}`);
  assert.equal(g.binding.status, "BLOCKED-ON-OPERATOR", `agy is fail-closed (served-model unverifiable) so the binding blocks ONLY on agy (gpt+claude+hunter are clean): ${g.binding.reason}`);
  assert.ok(/agy/.test(g.binding.reason), `the block must name the agy lane: ${g.binding.reason}`);
  assert.equal(g.floor_pass, true, `the served-model fail-close must not touch the non-agy floor: ${g.floor.reason}`);
});
test("even a VALIDLY-SIGNED agy record on the LIVE path (requireSignature) does NOT green the BINDING", () => {
  const signedLedger = [...ledgerClean, hunterRec, agyRecordCorroborated].map((r) => ({ ...r, attest_sig: signRecord(r) }));
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyLive], { readLedger: () => signedLedger, sinceMs: 0, panelRunId: PRID, requireSignature: true });
  assert.notEqual(g.binding.status, "PASS", `a valid signature proves ORIGIN, not the served model — the agy lane must still fail-close: ${g.binding.reason}`);
  assert.equal(g.binding.status, "BLOCKED-ON-OPERATOR", `served-model fail-close holds on the live signed path: ${g.binding.reason}`);
});

if (failures.length) {
  process.stderr.write(`FAIL [dispatch-review-panel-gate.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [dispatch-review-panel-gate.test] ${passed} passed (masquerade blocks; validate-first fail-closed; ledger-bound; verdict allowlist)\n`);
