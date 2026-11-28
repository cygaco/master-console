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
const { hunterBindingDigest } = require("../dispatch/provenance-verifier");
const crypto = require("crypto");
const sha = (x) => crypto.createHash("sha256").update(x).digest("hex");
const PACKET = sha("review-packet-bytes");
const EVID = sha("reviewer-returned-bytes");

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

const T0 = Date.parse("2000-01-01T12:00:00.000Z");
const at = (ms) => new Date(T0 + ms).toISOString();
const rec = (o) => { const r = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, ...o }; r.attest_sig = signRecord(r); return r; };
const reSign = (r) => { const { attest_sig, ...rest } = r; return { ...rest, attest_sig: signRecord(rest) }; };
const gptOk = rec({ role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-gpt", cmdline_checksum: "c-gpt", started_at: at(0), prompt_digest: "sha256:" + PACKET.slice(0, 32), packet_sha256: PACKET });
const agyOk = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-agy", cmdline_checksum: "c-agy" });
const hunterRec = (o = {}) => { const packet = o.packet_sha256 || PACKET; return rec({ role: "security_claude_hunter", provider: "claude", via: "epsilon-agent", shape: "in-process-agent", verdict: "pass", completed_at: at(-60000), evidence_sha: EVID, packet_sha256: packet, output_digest: hunterBindingDigest(packet, EVID), cmdline_checksum: "c-cl", ...o }); };
const claudeHunterOk = hunterRec();
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
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeHunterOk] });
  assert.ok(out.ok, out.reason);
});

test("panel-2family FLOOR (gpt CLI + packet-bound claude hunter) → ATTESTED via the profile-aware resolver", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeHunterOk] });
  assert.ok(out.ok, `the hunter-shaped, packet-bound floor must attest: ${out.reason}`);
});
test("the SAME subprocess-claude floor record does NOT attest the panel-3lab binding hunter lane", () => {
  const out = attestLane(LANES.claude, [claudeFloorOk], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "the binding hunter lane requires the in-process hunter, not the floor's subprocess-claude");
});

test("RED: hunter record bound to a DIFFERENT packet than the run's CLI lanes reviewed → not attested", () => {
  const other = sha("some-other-packet");
  const out = attestLane(LANES.claude, [gptOk, hunterRec({ packet_sha256: other })], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" });
  assert.equal(out.attested, false);
});
test("RED: hunter record whose packet_sha256 was edited after signing → not attested", () => {
  const { attest_sig, ...rest } = claudeHunterOk;
  const out = attestLane(LANES.claude, [gptOk, { ...rest, packet_sha256: sha("x"), attest_sig }], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" });
  assert.equal(out.attested, false);
});
test("RED: hunter record with output_digest not the binding digest → not attested", () => {
  const out = attestLane(LANES.claude, [gptOk, hunterRec({ output_digest: "d-plain" })], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" });
  assert.equal(out.attested, false);
});
test("RED: unsigned hunter record (otherwise perfectly bound) → not attested", () => {
  const { attest_sig, ...unsigned } = claudeHunterOk;
  assert.equal(attestLane(LANES.claude, [gptOk, unsigned], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" }).attested, false);
});
test("RED: other-run hunter record → not attested", () => {
  const out = attestLane(LANES.claude, [gptOk, hunterRec({ panel_run_id: "other-run", run_id: "other-run" })], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" });
  assert.equal(out.attested, false);
});
const ctxAttest = { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" };
test("a hunter whose signed verdict is error or fail does not attest the Claude lane; warn does", () => {
  assert.equal(attestLane(LANES.claude, [gptOk, hunterRec({ verdict: "error" })], ctxAttest).attested, false);
  assert.equal(attestLane(LANES.claude, [gptOk, hunterRec({ verdict: "fail" })], ctxAttest).attested, false);
  assert.equal(attestLane(LANES.claude, [gptOk, hunterRec({ verdict: "warn" })], ctxAttest).attested, true);
});
test("an earlier signed hunter pass does not mask a signed fail for the same packet", () => {
  assert.equal(attestLane(LANES.claude, [gptOk, hunterRec(), hunterRec({ verdict: "fail" })], ctxAttest).attested, false);
});
test("a signed not-ok hunter error beside a signed pass (same run, same packet) does not attest, in either order", () => {
  const error = hunterRec({ ok: false, verdict: "error" });
  for (const hunters of [[claudeHunterOk, error], [error, claudeHunterOk]]) {
    assert.equal(attestLane(LANES.claude, [gptOk, ...hunters], ctxAttest).attested, false);
  }
});
test("a signed hunter record marked as a fallback, or a not-ok fail, beside a signed pass also holds", () => {
  for (const contrary of [hunterRec({ fallback: true }), hunterRec({ ok: false, verdict: "fail" })]) {
    assert.equal(attestLane(LANES.claude, [gptOk, claudeHunterOk, contrary], ctxAttest).attested, false);
  }
});
test("an error from another run or packet, or without a valid signature, does not hold a signed pass", () => {
  const error = { ok: false, verdict: "error" };
  const strays = [
    hunterRec({ ...error, panel_run_id: "other-run" }),
    hunterRec({ ...error, packet_sha256: sha("another packet") }),
    { ...hunterRec(error), attest_sig: "0".repeat(64) },
  ];
  assert.equal(attestLane(LANES.claude, [gptOk, claudeHunterOk, ...strays], ctxAttest).attested, true);
});
test("a CLI completion with only the unsigned prefix digest (no packet_sha256) attests nothing for the Claude lane", () => {
  const { attest_sig, packet_sha256, ...rest } = gptOk;
  const prefixOnly = reSign(rest);
  assert.equal(attestLane(LANES.claude, [prefixOnly, claudeHunterOk], ctxAttest).attested, false);
});
test("every attesting CLI completion must carry the hunter's packet digest; one that differs holds", () => {
  const other = rec({ ...gptOk, attest_sig: undefined, packet_sha256: sha("another packet"), tool_id: "codex2", provider: "openai2" });
  assert.equal(attestLane(LANES.claude, [gptOk, other, claudeHunterOk], ctxAttest).attested, false);
});
test("a same-run CLI row that is not on the security-reviewer contract is not used and does not block", () => {
  const stray = rec({ role: "other-role", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x", cmdline_checksum: "c-x", packet_sha256: sha("stray") });
  assert.equal(attestLane(LANES.claude, [gptOk, stray, claudeHunterOk], ctxAttest).attested, true);
});

const claudeLane = (records) => attestLane(LANES.claude, records, ctxAttest).attested;
const HOUR = 60 * 60 * 1000;
test("a hunter pass completed after the earliest CLI started_at does not attest", () => {
  assert.equal(claudeLane([gptOk, hunterRec({ completed_at: at(1) })]), false);
  const later = reSign({ ...gptOk, started_at: at(10 * 60000) });
  assert.equal(claudeLane([later, gptOk, hunterRec({ completed_at: at(5 * 60000) })]), false, "the EARLIEST start bounds the window");
  assert.equal(claudeLane([gptOk, later, hunterRec({ completed_at: at(5 * 60000) })]), false, "in either order");
});
test("a hunter pass completed inside the window attests; both edges count, older does not", () => {
  for (const ms of [-1, 0, -HOUR]) assert.equal(claudeLane([gptOk, hunterRec({ completed_at: at(ms) })]), true, String(ms));
  assert.equal(claudeLane([gptOk, hunterRec({ completed_at: at(-HOUR - 1) })]), false);
});
test("an attesting CLI completion with no signed start time leaves no window: nothing attests", () => {
  const { attest_sig, started_at, ...rest } = gptOk;
  assert.equal(claudeLane([reSign(rest), claudeHunterOk]), false);
  assert.equal(claudeLane([gptOk, reSign({ ...rest, started_at: "not a time" }), claudeHunterOk]), false);
});
test("a signed hunter fail outside the window still holds a pass inside it", () => {
  assert.equal(claudeLane([gptOk, claudeHunterOk, hunterRec({ verdict: "fail", completed_at: at(HOUR) })]), false);
});
test("the gate and the attestation read one exported window length", () => {
  assert.equal(require("../dispatch/provenance-verifier").HUNTER_WINDOW_MS, HOUR);
});

const deadLab = (provider, tool_id) => rec({ role: "security-reviewer", provider, tool_id, shape: "subprocess-cross-provider", ok: false, output_digest: null, cmdline_checksum: "c", started_at: at(0), packet_sha256: PACKET });
const claudeOnlyRun = () => [deadLab("openai", "codex"), deadLab("antigravity", "agy"), claudeHunterOk];
const attestRun = (profile, lanes, records) => attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: profile }, lanes, records });
test("a Claude-only run never attests panel-2family or panel-3lab, and the report carries the claude-only label", () => {
  for (const [profile, lanes] of [["panel-2family", [LANES.gpt, LANES.claude]], ["panel-3lab", [LANES.gpt, LANES.claude, LANES.agy]]]) {
    const out = attestRun(profile, lanes, claudeOnlyRun());
    assert.equal(out.ok, false, profile);
    assert.equal(out.lanes.some((l) => l.attested), false, "no lane of it attests, the Claude lane included");
    assert.equal(out.diversity, "claude-only", profile);
    assert.match(out.reason, /reviewed by Claude only — no second lab/);
  }
});
test("the claude-only label comes from verified stamps only: not on a two-lab run, and no claim field changes it", () => {
  assert.equal("diversity" in attestRun("panel-2family", [LANES.gpt, LANES.claude], [gptOk, claudeHunterOk]), false);
  const claimed = attestRun("panel-2family", [LANES.gpt, LANES.claude], [...claudeOnlyRun(), { ...gptOk, attest_sig: "0".repeat(64), diversity: "multi-lab" }]);
  assert.equal(claimed.diversity, "claude-only", "an unverifiable other-lab record does not remove the label");
  const stray = attestRun("panel-2family", [LANES.gpt, LANES.claude], [hunterRec({ panel_run_id: "other-run" })]);
  assert.equal("diversity" in stray, false, "another run's records say nothing about this one");
});

test("RED: no same-run CLI lane record to corroborate the packet → hunter not attested", () => {
  assert.equal(attestLane(LANES.claude, [claudeHunterOk], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" }).attested, false);
});
test("GREEN: signed, same-run, bound hunter + matching CLI packet → attested", () => {
  assert.equal(attestLane(LANES.claude, [gptOk, claudeHunterOk], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-2family" }).attested, true);
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
  const out = attestPanelRun({ runId: R, sprintId: S, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeHunterOk] });
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
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeHunterOk] });
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
