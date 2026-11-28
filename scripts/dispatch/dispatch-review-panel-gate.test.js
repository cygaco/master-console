#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { isSecurityPanelRole, applyPanelGate, panelLoaderFailClosed, snapshotPacket } = require("../dispatch-review");
const panelLanes = require("./panel-lanes");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const lane = (o) => ({ pass: o.laneId, model: null, hasEvidence: true, lane_out: null, ...o });
const gptClean = lane({ laneId: "gpt", provider: "openai", observedProvider: "openai", fallback: false, ok: true, verdict: "pass", dispatch_id: "d-gpt-own" });
const claudeClean = lane({ laneId: "claude", provider: "claude", observedProvider: "claude", fallback: false, ok: true, verdict: "pass" });
const agyDown = lane({ laneId: "agy", provider: "antigravity", observedProvider: null, fallback: false, ok: false, verdict: "error", hasEvidence: false });

const crypto = require("crypto");
const os = require("os");
const path = require("path");
require("../hooks/lib/mc-env").setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `gate-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const { signRecord } = require("./attest-signing");
const pv = require("./provenance-verifier");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const PRID = "panel-test-run-1";
const now = () => new Date().toISOString();
const PACKET_SHA = sha("the review packet bytes");
const EVID = JSON.stringify({ verdict: "pass" });
function mkHunter(over = {}, { sign = true } = {}) {
  const evidence_sha = sha(EVID);
  const r = { role: "security_claude_hunter", provider: "claude", shape: "in-process-agent", ok: true, fallback: false, verdict: "pass",
    evidence_sha, packet_sha256: PACKET_SHA, output_digest: pv.hunterBindingDigest(PACKET_SHA, evidence_sha), panel_run_id: PRID, completed_at: now(), ...over };
  if (sign) r.attest_sig = signRecord(r);
  return r;
}
const gptRec = { dispatch_id: "d-gpt-own", role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", ok: true, fallback: false, output_digest: "d-gpt", cmdline_checksum: "c-gpt", packet_sha256: PACKET_SHA, panel_run_id: PRID, completed_at: now() };
const hunterRec = mkHunter();
const ledgerClean = [gptRec, hunterRec];
const ctxClean = { readLedger: () => ledgerClean, sinceMs: 0, panelRunId: PRID, packetSha: PACKET_SHA };
const ctxWith = (records, extra = {}) => ({ readLedger: () => records, sinceMs: 0, panelRunId: PRID, packetSha: PACKET_SHA, ...extra });
const floorOf = (records, extra) => applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], ctxWith(records, extra));

test("isSecurityPanelRole: only security-reviewer is the panel role", () => {
  assert.equal(isSecurityPanelRole("security-reviewer"), true);
  assert.equal(isSecurityPanelRole("frontend-reviewer"), false);
});

test("gpt lane + same-run same-packet signed hunter pass → floor PASS; binding NOT PASS (agy down)", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], ctxClean);
  assert.equal(g.manifest_valid, true);
  assert.equal(g.contract_evaluated, "panel-2family-floor", "the gate must record WHICH contract it evaluated");
  assert.equal(g.floor.claude_channel, "in-process-hunter");
  assert.equal(g.binding.claude_channel, "in-process-hunter");
  assert.equal(g.floor_pass, true, `floor should pass: ${g.floor.reason}`);
  assert.equal(g.floor.status, "PASS");
  assert.notEqual(g.binding.status, "PASS", "panel-3lab must never PASS while agy is down");
  assert.equal(g.binding.status, "BLOCKED-ON-OPERATOR", `only agy blocks 3lab: ${g.binding.reason}`);
});
test("the same positive holds on the live signed path (requireSignature)", () => {
  const g = floorOf([{ ...gptRec, attest_sig: signRecord(gptRec) }, hunterRec], { requireSignature: true });
  assert.equal(g.floor_pass, true, g.floor.reason);
});

test("(1) hunter record ABSENT → floor BLOCKED (unprovable claude lane)", () => {
  const g = floorOf([gptRec]);
  assert.equal(g.floor_pass, false);
  assert.equal(g.floor.status, "BLOCKED-INCONCLUSIVE");
  assert.equal(g.floor.laneStatus.claude, "missing-evidence");
});
test("(2) hunter verdict FAIL → the panel FAILS (not merely blocked)", () => {
  const g = floorOf([gptRec, mkHunter({ verdict: "fail" })]);
  assert.equal(g.floor_pass, false);
  assert.equal(g.floor.status, "FAIL");
  assert.equal(g.floor.laneStatus.claude, "fail");
});
test("(2b) a hunter FAIL turns an otherwise clean merged review into a fail verdict", () => {
  const { applyGateOutcome } = require("../dispatch-review");
  const g = floorOf([gptRec, mkHunter({ verdict: "fail" })]);
  const merged = { ok: true, verdict: "pass", mergedVerdict: "pass", parsed: { verdict: "pass" } };
  applyGateOutcome(merged, g);
  assert.equal(merged.ok, false);
  assert.equal(merged.verdict, "fail");
  assert.equal(merged.parsed.verdict, "fail");
});
test("(3) hunter verdict ERROR / missing / odd → never a pass", () => {
  for (const v of ["error", undefined, "", "banana", "PASS "]) {
    const rec = mkHunter(v === undefined ? {} : { verdict: v });
    if (v === undefined) { delete rec.verdict; rec.attest_sig = signRecord(rec); }
    const g = floorOf([gptRec, rec]);
    assert.equal(g.floor_pass, false, `verdict ${JSON.stringify(v)} must not pass`);
    assert.notEqual(g.floor.status, "PASS");
  }
});
test("(4) a hunter record from ANOTHER panel run → floor BLOCKED", () => {
  const g = floorOf([gptRec, mkHunter({ panel_run_id: "panel-other-run" })]);
  assert.equal(g.floor_pass, false);
  assert.equal(g.floor.laneStatus.claude, "missing-evidence");
});
test("(5) hunter packet-digest MISMATCH (a review of another packet) → floor BLOCKED", () => {
  const other = sha("a different packet");
  const g = floorOf([gptRec, mkHunter({ packet_sha256: other, output_digest: pv.hunterBindingDigest(other, sha(EVID)) })]);
  assert.equal(g.floor_pass, false);
  assert.equal(g.floor.laneStatus.claude, "missing-evidence");
});
test("(5b) no packet digest on the record, or no expected digest from the runner → floor BLOCKED", () => {
  const noPacket = mkHunter({}, { sign: false }); delete noPacket.packet_sha256; noPacket.attest_sig = signRecord(noPacket);
  assert.equal(floorOf([gptRec, noPacket]).floor_pass, false);
  assert.equal(floorOf([gptRec, hunterRec], { packetSha: null }).floor_pass, false);
});
test("(6) TAMPERED digest or signature → floor BLOCKED", () => {
  const evil = sha("evil packet");
  const signedForOther = mkHunter({ packet_sha256: evil, output_digest: pv.hunterBindingDigest(evil, sha(EVID)) });
  const cases = {
    "packet digest edited to the expected value on a record signed for another packet": { ...signedForOther, packet_sha256: PACKET_SHA },
    "output_digest edited after signing": { ...hunterRec, output_digest: pv.hunterBindingDigest(evil, sha(EVID)) },
    "evidence digest edited after signing": { ...hunterRec, evidence_sha: sha("swapped evidence") },
    "verdict edited after signing": { ...mkHunter({ verdict: "fail" }), verdict: "pass" },
    "bogus signature": { ...hunterRec, attest_sig: "0".repeat(64) },
    "unsigned": mkHunter({}, { sign: false }),
  };
  for (const [name, rec] of Object.entries(cases)) {
    const g = floorOf([gptRec, rec]);
    assert.equal(g.floor_pass, false, name);
    assert.notEqual(g.floor.status, "PASS", name);
  }
});

test("a subprocess-claude record LABELED as the hunter role does NOT satisfy the claude lane (shape mismatch)", () => {
  const fake = { ...hunterRec, shape: "subprocess-claude" }; fake.attest_sig = signRecord(fake);
  assert.equal(floorOf([gptRec, fake]).floor_pass, false);
});
test("a subprocess-claude security-reviewer record no longer satisfies the floor", () => {
  const sub = { role: "security-reviewer", provider: "claude", tool_id: "claude", shape: "subprocess-claude", ok: true, fallback: false, output_digest: "d-cl", cmdline_checksum: "c-cl", panel_run_id: PRID, completed_at: now() };
  assert.equal(floorOf([gptRec, sub]).floor_pass, false);
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

test("requireSignature blocks the floor when lane records are UNSIGNED", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyDown], { ...ctxClean, requireSignature: true });
  assert.equal(g.floor_pass, false, "an unsigned gpt record must NOT corroborate the floor under requireSignature");
});
test("requireSignature PASSES the floor when the SAME lane records are validly SIGNED", () => {
  const signedLedger = ledgerClean.map((r) => (r.attest_sig ? r : { ...r, attest_sig: signRecord(r) }));
  const g = floorOf(signedLedger, { requireSignature: true });
  assert.equal(g.floor_pass, true, "validly-signed lane records must corroborate the floor");
});

const agyLive = lane({ laneId: "agy", provider: "antigravity", observedProvider: "antigravity", fallback: false, ok: true, verdict: "pass" });
const agyRecordCorroborated = { role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", ok: true, fallback: false, output_digest: "d-agy", cmdline_checksum: "c-agy", panel_run_id: PRID, completed_at: now(), served_default: true, attested_model_id: "Gemini 3.1 Pro (High)" };
test("a fully-corroborated agy record does NOT green the panel-3lab BINDING (served-model fail-close)", () => {
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyLive], ctxWith([...ledgerClean, agyRecordCorroborated]));
  assert.notEqual(g.binding.status, "PASS", `a corroborated agy record must NOT green the binding — agy has no server-origin served-model receipt: ${g.binding.reason}`);
  assert.equal(g.binding.status, "BLOCKED-ON-OPERATOR", `agy is fail-closed (served-model unverifiable) so the binding blocks ONLY on agy (gpt+claude+hunter are clean): ${g.binding.reason}`);
  assert.ok(/agy/.test(g.binding.reason), `the block must name the agy lane: ${g.binding.reason}`);
  assert.equal(g.floor_pass, true, `the served-model fail-close must not touch the non-agy floor: ${g.floor.reason}`);
});
test("even a VALIDLY-SIGNED agy record on the LIVE path (requireSignature) does NOT green the BINDING", () => {
  const signedLedger = [...ledgerClean, agyRecordCorroborated].map((r) => (r.attest_sig ? r : { ...r, attest_sig: signRecord(r) }));
  const g = applyPanelGate(panelLanes, [gptClean, claudeClean, agyLive], ctxWith(signedLedger, { requireSignature: true }));
  assert.notEqual(g.binding.status, "PASS", `a valid signature proves ORIGIN, not the served model — the agy lane must still fail-close: ${g.binding.reason}`);
  assert.equal(g.binding.status, "BLOCKED-ON-OPERATOR", `served-model fail-close holds on the live signed path: ${g.binding.reason}`);
});

test("a hunter recorded before the runner start passes the floor; one outside the hunter window does not", () => {
  const runnerStart = Date.now();
  const before = (ms) => new Date(runnerStart - ms).toISOString();
  const gptNow = { ...gptRec, completed_at: new Date(runnerStart + 1000).toISOString() };
  const ctx = { sinceMs: runnerStart };
  const inWindow = floorOf([gptNow, mkHunter({ completed_at: before(5 * 60 * 1000) })], ctx);
  assert.equal(inWindow.floor_pass, true, inWindow.floor.reason);
  const outside = floorOf([gptNow, mkHunter({ completed_at: before(2 * 60 * 60 * 1000) })], ctx);
  assert.equal(outside.floor_pass, false, "a hunter record older than the window must not count");
  const cliOld = floorOf([{ ...gptRec, completed_at: before(5 * 60 * 1000) }, mkHunter({ completed_at: before(5 * 60 * 1000) })], ctx);
  assert.equal(cliOld.floor.laneStatus.gpt === "pass", false, "CLI completions keep the runner-start cutoff");
  assert.equal(cliOld.floor_pass, false);
});
test("an earlier signed pass cannot mask a later signed fail for the same run and packet", () => {
  const pass = mkHunter({ completed_at: new Date(Date.now() - 2000).toISOString() });
  const fail = mkHunter({ verdict: "fail", completed_at: new Date().toISOString() });
  for (const order of [[pass, fail], [fail, pass]]) {
    const g = floorOf([gptRec, ...order]);
    assert.equal(g.floor_pass, false);
    assert.equal(g.floor.laneStatus.claude, "fail");
  }
  const err = floorOf([gptRec, pass, mkHunter({ verdict: "error" })]);
  assert.equal(err.floor_pass, false, "a signed error alongside a pass holds the review");
});

const signed = (r) => { const out = { ...r }; delete out.attest_sig; out.attest_sig = signRecord(out); return out; };
const live = { requireSignature: true };
test("live path: a CLI completion that signed another packet digest does not count", () => {
  const g = floorOf([signed({ ...gptRec, packet_sha256: sha("a replaced packet copy") }), hunterRec], live);
  assert.equal(g.floor_pass, false);
  assert.equal(g.floor.laneStatus.gpt, "missing-evidence");
});
test("live path: a CLI completion with no packet digest, or a run with none expected, does not count", () => {
  const none = { ...gptRec }; delete none.packet_sha256;
  assert.equal(floorOf([signed(none), hunterRec], live).floor.laneStatus.gpt, "missing-evidence");
  for (const packetSha of [null, undefined, "short"]) {
    const g = floorOf([signed({ ...gptRec, packet_sha256: packetSha }), hunterRec], { ...live, packetSha });
    assert.equal(g.floor.laneStatus.gpt, "missing-evidence", `expected digest ${JSON.stringify(packetSha)}`);
  }
});
test("live path: a CLI completion with the matching packet digest counts", () => {
  const g = floorOf([signed(gptRec), hunterRec], live);
  assert.equal(g.floor.laneStatus.gpt, "alive-clean");
  assert.equal(g.floor_pass, true, g.floor.reason);
});

test("a signed not-ok hunter error beside a separate live pass holds the floor", () => {
  const error = mkHunter({ ok: false, verdict: "error" });
  for (const order of [[hunterRec, error], [error, hunterRec]]) {
    const g = floorOf([signed(gptRec), ...order], live);
    assert.equal(g.floor_pass, false);
    assert.equal(g.floor.laneStatus.claude, "refused-or-malformed");
  }
});
test("a hunter completed after the runner start cannot carry the floor", () => {
  const runnerStart = Date.now();
  const ctx = { ...live, sinceMs: runnerStart };
  const gptLater = signed({ ...gptRec, completed_at: new Date(runnerStart + 1000).toISOString() });
  const g = floorOf([gptLater, mkHunter({ completed_at: new Date(runnerStart + 500).toISOString() })], ctx);
  assert.equal(g.floor_pass, false);
  assert.equal(g.floor.laneStatus.claude, "missing-evidence");
});
test("a signed hunter error or fail outside the time window still binds a pass inside it", () => {
  const runnerStart = Date.now();
  const iso = (ms) => new Date(runnerStart + ms).toISOString();
  const ctx = { ...live, sinceMs: runnerStart };
  const gptLater = signed({ ...gptRec, completed_at: iso(1000) });
  const pass = mkHunter({ completed_at: iso(-5000) });
  for (const t of [iso(500), iso(-2 * 60 * 60 * 1000)]) {
    assert.equal(floorOf([gptLater, pass, mkHunter({ ok: false, verdict: "error", completed_at: t })], ctx).floor_pass, false, t);
    const failed = floorOf([gptLater, pass, mkHunter({ verdict: "fail", completed_at: t })], ctx);
    assert.equal(failed.floor.laneStatus.claude, "fail", t);
  }
});

test("the live gate's hunter window ends at the runner start; the release attestation's ends at the CLI start", () => {
  const { attestLane } = require("../checks/cert-attest");
  const HOUR = 60 * 60 * 1000;
  const runnerStart = Date.now();
  const iso = (ms) => new Date(runnerStart + ms).toISOString();
  const scope = { sprint_id: "sprint-a", code_sha: "abc1234" };
  const cliStart = 10000;
  const gpt = signed({ ...gptRec, ...scope, started_at: iso(cliStart), completed_at: iso(cliStart + 1000) });
  const claudeSpec = { laneId: "claude", provider: "claude", tool_id: "claude" };
  const cases = [
    [-5000, true, true], [0, true, true], [1, false, true], [1000, false, true], [cliStart, false, true],
    [cliStart + 1, false, false], [-HOUR, true, false], [-HOUR - 1, false, false], [cliStart - HOUR, true, true],
  ];
  for (const [ms, gateCounts, releaseCounts] of cases) {
    const records = [gpt, mkHunter({ ...scope, cmdline_checksum: "c-cl", completed_at: iso(ms) })];
    const gate = floorOf(records, { ...live, sinceMs: runnerStart, sprintId: "sprint-a" });
    const release = attestLane(claudeSpec, records, { runId: PRID, sprintId: "sprint-a", codeSha: "abc1234", profileName: "panel-2family" });
    assert.deepEqual([gate.floor.laneStatus.claude === "alive-clean", release.attested], [gateCounts, releaseCounts], `hunter completed at ${ms}`);
  }
});
test("only this invocation's own signed, successful CLI records of this packet move the live window earlier", () => {
  const runnerStart = Date.now();
  const iso = (ms) => new Date(runnerStart + ms).toISOString();
  const pass = mkHunter({ completed_at: iso(-5000) });
  const own = { ...gptRec, started_at: iso(-10000), completed_at: iso(11000) };
  const ctx = { ...live, sinceMs: runnerStart };
  const claude = (records) => floorOf(records, ctx).floor.laneStatus.claude;
  assert.equal(claude([pass]), "alive-clean", "with no CLI record the window ends at the runner start");
  assert.equal(claude([signed(own), pass]), "missing-evidence", "a qualifying earlier start moves the end earlier");
  const strays = {
    "another dispatch": signed({ ...own, dispatch_id: "d-gpt-other" }),
    "a bad signature": { ...own, attest_sig: "0".repeat(64) },
    "a failed completion": signed({ ...own, ok: false }),
    "another packet": signed({ ...own, packet_sha256: sha("another packet") }),
    "no packet digest": signed({ ...own, packet_sha256: undefined }),
  };
  for (const [name, stray] of Object.entries(strays)) {
    assert.equal(claude([stray, pass]), "alive-clean", `${name} does not move the cutoff`);
  }
});

test("live path: a matching-digest completion from another dispatch does not carry a lane", () => {
  const g = floorOf([signed({ ...gptRec, dispatch_id: "d-gpt-other" }), hunterRec], live);
  assert.equal(g.floor.laneStatus.gpt, "missing-evidence");
  assert.equal(g.floor_pass, false);
});
test("live path: the lane's own completion carries it, beside another dispatch's completion", () => {
  const g = floorOf([signed({ ...gptRec, dispatch_id: "d-gpt-other" }), signed(gptRec), hunterRec], live);
  assert.equal(g.floor.laneStatus.gpt, "alive-clean");
  assert.equal(g.floor_pass, true, g.floor.reason);
});
test("live path: a lane whose envelope carries no dispatch id does not count, even beside a record with none", () => {
  const noId = { ...gptRec };
  delete noId.dispatch_id;
  for (const dispatch_id of [undefined, null, ""]) {
    for (const record of [signed(gptRec), signed(noId)]) {
      const g = applyPanelGate(panelLanes, [{ ...gptClean, dispatch_id }, claudeClean, agyDown], ctxWith([record, hunterRec], live));
      assert.equal(g.floor.laneStatus.gpt, "missing-evidence", JSON.stringify(dispatch_id));
      assert.equal(g.floor_pass, false);
    }
  }
});
test("the runner keeps each child's dispatch id on its lane", () => {
  const { laneFromSettled } = require("../dispatch-review");
  const pass = { key: "second_pass", provider: "openai", model: "m" };
  assert.equal(laneFromSettled({ pass, result: { ok: true, provider: "openai", dispatch_id: "d-abc", parsed: { verdict: "pass" } } }).dispatch_id, "d-abc");
  assert.equal(laneFromSettled({ pass, result: { ok: true, provider: "openai" } }).dispatch_id, null);
  assert.equal(laneFromSettled({ pass, result: null }).dispatch_id, null);
});

test("the snapshot is an immutable copy, and its digest does not follow later edits of the original", () => {
  const fs = require("fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  const orig = path.join(dir, "packet.md");
  fs.writeFileSync(orig, "the packet as reviewed");
  const snap = snapshotPacket(orig, path.join(dir, "lanes"));
  const want = sha(Buffer.from("the packet as reviewed"));
  assert.equal(snap.sha, want);
  assert.notEqual(snap.file, orig);
  fs.writeFileSync(orig, "the packet after a later edit");
  assert.equal(sha(fs.readFileSync(snap.file)), want, "the copy the children read is unchanged");
  assert.equal(snap.sha, want, "the digest the gate uses is unchanged");
  assert.throws(() => snapshotPacket(path.join(dir, "missing.md"), path.join(dir, "lanes")), "an unreadable packet refuses");
  const second = snapshotPacket(orig, path.join(dir, "lanes"));
  assert.notEqual(second.file, snap.file, "a second run in the same folder does not overwrite the first copy");
});

if (failures.length) {
  process.stderr.write(`FAIL [dispatch-review-panel-gate.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [dispatch-review-panel-gate.test] ${passed} passed (masquerade blocks; validate-first fail-closed; ledger-bound; verdict allowlist)\n`);
