#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
mcEnv.setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `attest-secret-panel-test-${process.pid}-${Date.now()}`));
const { attestLane, attestPanelRun, readLedgerRecords } = require("./cert-attest");
const { signRecord } = require("../dispatch/attest-signing");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const LANES = {
  gpt: { laneId: "gpt", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider" },
  claude: { laneId: "claude", provider: "claude", tool_id: "claude", shape: "in-process-agent" },
  agy: { laneId: "agy", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider" },
};
const S = "SP-TEST-999999", R = "panel-run-abc";
const SHA = "abc1234";

const rec = (o) => { const r = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, ...o }; r.attest_sig = signRecord(r); return r; };
const reSign = (r) => { const { attest_sig, ...rest } = r; return { ...rest, attest_sig: signRecord(rest) }; };
const gptOk = rec({ role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-gpt", cmdline_checksum: "c-gpt" });
const agyOk = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-agy", cmdline_checksum: "c-agy" });
const claudeHunterOk = rec({ role: "security_claude_hunter", provider: "claude", via: "epsilon-agent", shape: "in-process-agent", evidence_sha: "e-cl", cmdline_checksum: "c-cl" });
const claudeFloorOk = rec({ role: "security-reviewer", provider: "claude", tool_id: "claude", shape: "subprocess-claude", output_digest: "d-fl", cmdline_checksum: "c-fl" });

test("panel-3lab with a VALID signed agy record → BLOCKED (agy lane fail-closed at the panel reader)", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: [gptOk, agyOk, claudeHunterOk] });
  assert.equal(out.ok, false, "panel-3lab must NOT attest while the agy lane is present — agy is un-attestable from a record");
  const agyLane = out.lanes.find((l) => l.laneId === "agy");
  assert.ok(agyLane && !agyLane.attested, "the agy lane must be unattested");
  assert.ok(/HONEST-CEILING|antigravity lane cannot be attested|panel reader/i.test(agyLane.reason), agyLane.reason);
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && l.attested), "gpt lane still attests");
  assert.ok(out.lanes.find((l) => l.laneId === "claude" && l.attested), "claude hunter lane still attests");
});

const agyUnauthDefault = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-unauth", cmdline_checksum: "c-unauth", served_default: true, attested_model_id: "CCPA" });
test("neg: signed UNAUTH-default agy record → agy lane still unattested (provider-level fail-closed)", () => {
  const out = attestLane(LANES.agy, [agyUnauthDefault], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a signed unauth-default agy record must not attest the panel lane");
  assert.ok(/HONEST-CEILING|panel reader/i.test(out.reason), out.reason);
});

const agyNonCatalog = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-nc", cmdline_checksum: "c-nc", attested_model_id: "Claude Sonnet 4.6 (Thinking)" });
test("neg: non-catalog agy model record → agy lane unattested", () => {
  const out = attestLane(LANES.agy, [agyNonCatalog], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a non-catalog agy model record must not attest the panel lane");
});

test("panel-2family FLOOR still attests (agy hard-fail does not touch the non-agy floor)", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.ok(out.ok, out.reason);
});

test("panel-2family FLOOR (gpt CLI + claude subprocess) → ATTESTED via the profile-aware resolver", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.ok(out.ok, `the valid subprocess-claude floor must attest: ${out.reason}`);
});
test("the SAME subprocess-claude floor record does NOT attest the panel-3lab binding hunter lane", () => {
  const out = attestLane(LANES.claude, [claudeFloorOk], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "the binding hunter lane requires the in-process hunter, not the floor's subprocess-claude");
});

test("role='security-reviewer' + sanctioned_lane_id='security_claude_hunter' + shape=in-process-agent → hunter unattested", () => {
  const labelSpoof = rec({ role: "security-reviewer", sanctioned_lane_id: "security_claude_hunter", provider: "claude", shape: "in-process-agent", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [labelSpoof], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "sanctioned_lane_id is a settable label — identity is the WRITER-STAMPED role");
});
test("sanctioned_lane_id=hunter but shape FORGED-ABSENT (subprocess-claude) → hunter unattested", () => {
  const shapeForged = rec({ role: "security_claude_hunter", sanctioned_lane_id: "security_claude_hunter", provider: "claude", shape: "subprocess-claude", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [shapeForged], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a subprocess-claude record can never be the in-process hunter (shape is writer-stamped)");
});

test("every lane attested but code_sha absent → NOT ok", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.equal(out.ok, false, "a binding attestation must bind to a code SHA");
  assert.ok(/code_sha/.test(out.reason), out.reason);
});

test("cross-sprint record for gpt → gpt unattested → panel FAILS", () => {
  const otherSprintGpt = { sprint_id: "SP-OTHER-999999", run_id: R, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [otherSprintGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a cross-sprint record must not attest a lane in this run");
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
});

test("cross-run record (same sprint) for gpt → gpt unattested", () => {
  const otherRunGpt = { sprint_id: S, run_id: "run-OTHER", ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestLane(LANES.gpt, [otherRunGpt], { runId: R, sprintId: S });
  assert.equal(out.attested, false, "a different-run record must not attest this run's lane");
});

test("null-run_id record does NOT attest a required-runId lane (no null bypass)", () => {
  const nullRunGpt = { sprint_id: S, run_id: null, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestLane(LANES.gpt, [nullRunGpt], { runId: R, sprintId: S });
  assert.equal(out.attested, false, "a null-run_id record must not attest when a specific runId is required");
});
test("null-run_id via attestPanelRun → panel FAILS", () => {
  const nullRunGpt = { sprint_id: S, run_id: null, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [nullRunGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a null-run_id GPT record must not attest a required run");
});

test("claude in-process record without security_claude_hunter role → hunter unattested", () => {
  const notHunter = rec({ role: "security-reviewer", provider: "claude", via: "epsilon-agent", shape: "in-process-agent", evidence_sha: "e-x" });
  const out = attestLane(LANES.claude, [notHunter], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, false, "provider=claude alone must not attest the sanctioned hunter");
});

test("subprocess-claude record claiming the hunter role → hunter (in-process) unattested", () => {
  const subprocessFakeHunter = rec({ role: "security_claude_hunter", provider: "claude", shape: "subprocess-claude", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [subprocessFakeHunter], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, false, "a subprocess-claude record must not satisfy the in-process hunter lane (shape mismatch)");
});
test("subprocess-claude + via:'epsilon-agent' + hunter role → in-process hunter STILL unattested", () => {
  const viaSpoofHunter = rec({ role: "security_claude_hunter", provider: "claude", shape: "subprocess-claude", via: "epsilon-agent", record_via: "inprocess", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [viaSpoofHunter], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, false, "a settable via/record_via label must not spoof the in-process hunter shape");
});

test("agy claimed but record is provider:claude → agy unattested → panel FAILS", () => {
  const fakeAgy = rec({ role: "security-reviewer", provider: "claude", tool_id: "claude", shape: "in-process-agent", evidence_sha: "e-fake" });
  const out = attestPanelRun({ runId: R, sprintId: S, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: [gptOk, claudeHunterOk, fakeAgy] });
  assert.equal(out.ok, false, "a Claude record must NOT attest the agy lane (the masquerade)");
  assert.ok(out.lanes.find((l) => l.laneId === "agy" && !l.attested));
});

test("provider:claude in-process record does NOT attest the gpt CLI lane", () => {
  const out = attestLane(LANES.gpt, [claudeHunterOk], { runId: R, codeSha: SHA });
  assert.equal(out.attested, false, "a claude in-process record satisfies only the claude hunter, not gpt");
});

test("Liveness-: fallback:true record → NOT attested", () => {
  const fb = rec({ fallback: true, provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d", cmdline_checksum: "c" });
  assert.equal(attestLane(LANES.gpt, [fb], { runId: R, codeSha: SHA }).attested, false);
});

test("Liveness-: CLI record without output_digest → NOT attested (config echo insufficient)", () => {
  const echo = rec({ provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", cmdline_checksum: "c" });
  assert.equal(attestLane(LANES.gpt, [echo], { runId: R, codeSha: SHA }).attested, false);
});

test("Liveness-: a record from a DIFFERENT run is not same-run correlated", () => {
  const other = { sprint_id: S, run_id: "run-OTHER", ok: true, fallback: false, provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d" };
  const out = attestPanelRun({ runId: R, sprintId: S, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [claudeHunterOk ] });
  assert.equal(out.ok, false);
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
});

test("missing required lane record → panel FAILS", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk ] });
  assert.equal(out.ok, false);
});

test("attestPanelRun with omitted runId → NOT ok (no historical certification)", () => {
  const out = attestPanelRun({ sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeHunterOk] });
  assert.equal(out.ok, false, "a binding attestation must certify a SPECIFIC run");
  assert.ok(/runId|specific run/i.test(out.reason), out.reason);
});

test("a record with a different panel_run_id → not same-run → gpt unattested", () => {
  const staleGpt = { ...gptOk, panel_run_id: "panel-OTHER", run_id: "panel-OTHER" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [staleGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a stale-run record must not attest this run's lane");
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
});

test("different panel_run_id but matching run_id → NOT attested (no run_id fallback)", () => {
  const otherPanelGpt = { ...gptOk, panel_run_id: "panel-OTHER", run_id: R };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [otherPanelGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a record from a different panel must not certify this panel via a matching run_id");
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
  assert.equal(attestLane(LANES.gpt, [otherPanelGpt], { runId: R, sprintId: S, codeSha: SHA }).attested, false);
});

test("a record with panel_run_id===run but a DIFFERENT run_id still attests (identity is panel_run_id)", () => {
  const runnerGpt = { ...gptOk, run_id: "sprint-run-XYZ" , panel_run_id: R };
  const out = attestLane(LANES.gpt, [runnerGpt], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, true, "a real runner record must correlate by panel_run_id, not be discarded on run_id");
});
test("readLedgerRecords filters by panel_run_id, not run_id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-panel-run-"));
  const ledger = path.join(dir, "l.jsonl");
  try {
    const recA = JSON.stringify({ sprint_id: S, run_id: "sprint-run-XYZ", panel_run_id: R, role: "security-reviewer", provider: "openai", ok: true });
    const recB = JSON.stringify({ sprint_id: S, run_id: R, panel_run_id: "panel-OTHER", role: "security-reviewer", provider: "openai", ok: true });
    fs.writeFileSync(ledger, recA + "\n" + recB + "\n");
    const got = readLedgerRecords(S, R, ledger);
    assert.equal(got.length, 1, "exactly the panel_run_id===R record is returned");
    assert.equal(got[0].panel_run_id, R);
    assert.equal(got[0].run_id, "sprint-run-XYZ", "correlated by panel_run_id despite a different run_id");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("record code_sha != attested codeSha → gpt unattested → panel FAILS", () => {
  const staleShaGpt = { ...gptOk, code_sha: "old-commit-999" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [staleShaGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a record from a different build must not attest the current HEAD");
});
test("a record with NO persisted code_sha → NOT attested (provenance required)", () => {
  const noShaGpt = { ...gptOk, code_sha: undefined };
  assert.equal(attestLane(LANES.gpt, [noShaGpt], { runId: R, codeSha: SHA }).attested, false);
});
test("a record with NO cmdline_checksum (no invocation digest) → NOT attested", () => {
  const noInvGpt = { ...gptOk, cmdline_checksum: undefined };
  assert.equal(attestLane(LANES.gpt, [noInvGpt], { runId: R, codeSha: SHA }).attested, false);
});

const forgedHunter = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, role: "security_claude_hunter", provider: "claude", shape: "in-process-agent", evidence_sha: "e-forge", cmdline_checksum: "c-forge", verdict: "pass" };
const forgedGpt = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-forge", cmdline_checksum: "cc-forge" };
const forgedAgy = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-forge2", cmdline_checksum: "cc-forge2" };
test("an UNSIGNED forged 3-lab set does NOT attest — fail-closed", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: [forgedGpt, forgedAgy, forgedHunter] });
  assert.equal(out.ok, false, "a hand-authored (unsigned) record set must NOT attest — origin-proof closes the forgery");
  assert.equal(out.lanes.find((l) => l.laneId === "gpt").attested, false, "origin-proof must reject the unsigned forged gpt record (not masked by the agy hard-fail)");
  assert.equal(out.lanes.find((l) => l.laneId === "claude").attested, false, "origin-proof must reject the unsigned forged hunter record (not masked by the agy hard-fail)");
});
test("a WRONG-MAC forged set does NOT attest — fail-closed", () => {
  const bad = [forgedGpt, forgedAgy, forgedHunter].map((r) => ({ ...r, attest_sig: "0".repeat(64) }));
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: bad });
  assert.equal(out.ok, false, "an invalid signature must NOT attest");
  assert.equal(out.lanes.find((l) => l.laneId === "gpt").attested, false, "origin-proof must reject the wrong-MAC gpt record (not masked by the agy hard-fail)");
  assert.equal(out.lanes.find((l) => l.laneId === "claude").attested, false, "origin-proof must reject the wrong-MAC hunter record (not masked by the agy hard-fail)");
});
test("a single hand-authored hunter record (right fields, no sig) does NOT attest its lane", () => {
  const out = attestLane(LANES.claude, [forgedHunter], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "an unsigned hunter record is a forgery — the in-process lane must reject it");
});
test("no over-block: a REAL SIGNED panel-2family floor STILL attests (origin-proof is not a blanket block)", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.ok(out.ok, `a properly signed set must still attest: ${out.reason}`);
});
test("tampering a SIGNED field (role) after signing invalidates the signature → not attested", () => {
  const tampered = { ...claudeHunterOk, role: "security-reviewer" };
  const out = attestLane(LANES.claude, [tampered], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a tampered signed field must break the signature and fail-closed");
});

if (failures.length) {
  process.stderr.write(`FAIL [cert-attest-panel.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [cert-attest-panel.test] ${passed} passed (wrapper-claim != proof; origin-proof: forged/unsigned/wrong-mac/tampered → fail-closed, signed → attests)\n`);
