#!/usr/bin/env node
"use strict";
/**
 * Bite-test for cert-attest.js attestPanelRun — same-run panel attestation (D8, AC-14,15 · qa-plan T5).
 *
 * THE FALSIFIABILITY FIXTURE (T5, load-bearing): a wrapper that CLAIMS agy but whose ledger record is
 * provider:claude/absent does NOT attest the agy lane → the panel attestation FAILS. Without this the
 * attestation surface is unfalsifiable = ship-blocker. Every positive has its negative control.
 *
 *   node scripts/checks/cert-attest-panel.test.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
// ORIGIN-PROOF (ED-231 / ADR-0025): a TEST secret so the signer + verifier share it without touching the real
// one; set BEFORE requiring cert-attest so attest-signing resolves it. A REAL record IS signed by the trusted
// writer — rec() signs; the forgery teeth build UNSIGNED/bad-MAC records to prove the fail-closed.
process.env.WARPOS_ATTEST_SECRET_FILE = path.join(os.tmpdir(), `attest-secret-panel-test-${process.pid}-${Date.now()}`);
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
const S = "SP-TEST-001", R = "panel-run-abc";
const SHA = "abc1234";

// same-run REAL records: bound to the run IDENTITY (panel_run_id, SR-011) + the code_sha executed (SR-013).
// rec builds a same-run record AND signs it (ED-231 origin-proof) — a REAL record is signed by the trusted
// writer. A record whose SIGNED field is later spread-mutated invalidates the sig (correct: a tampered record
// must not attest); tests that mutate a signed field then expect ATTEST must re-sign via reSign() below.
const rec = (o) => { const r = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, ...o }; r.attest_sig = signRecord(r); return r; };
const reSign = (r) => { const { attest_sig, ...rest } = r; return { ...rest, attest_sig: signRecord(rest) }; };
const gptOk = rec({ role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-gpt", cmdline_checksum: "c-gpt" });
const agyOk = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-agy", cmdline_checksum: "c-agy" });
// The hunter record carries the sanctioned ROLE identity (β#3/SR-005) — not a bare security-reviewer.
const claudeHunterOk = rec({ role: "security_claude_hunter", provider: "claude", via: "epsilon-agent", shape: "in-process-agent", evidence_sha: "e-cl", cmdline_checksum: "c-cl" });
// The panel-2family FLOOR's claude lane = a subprocess-claude security review (α option B; SR-018/QA-017).
const claudeFloorOk = rec({ role: "security-reviewer", provider: "claude", tool_id: "claude", shape: "subprocess-claude", output_digest: "d-fl", cmdline_checksum: "c-fl" });

// ── R2-CRITICAL-01 (β RIDER-1 "same class, DIFFERENT reader"): the panel-3lab BINDING is BLOCKED while agy
//    is down. attestLane hard-fails the antigravity lane (§7 honest-ceiling at the panel reader): a VALID
//    signed same-run agy record proves a dispatch ran but NOT a trustworthy served model (agy's only serve
//    marker is the client-side backend-label echo, never trusted). So the agy lane fails-closed → the
//    panel-3lab attestation FAILS. The ED-230 served-model predicate later REPLACES this interim hard-fail;
//    until then agy=down ⇒ no 3-lab green (correct + consistent with support-matrix agy=down). This is the
//    former "3-lab positive" fixture, FLIPPED — the load-bearing park-state ripple. ──
test("R2-CRITICAL-01: panel-3lab with a VALID signed agy record → BLOCKED (agy lane fail-closed at the panel reader)", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: [gptOk, agyOk, claudeHunterOk] });
  assert.equal(out.ok, false, "panel-3lab must NOT attest while the agy lane is present — agy is un-attestable from a record (§7 at the panel reader)");
  const agyLane = out.lanes.find((l) => l.laneId === "agy");
  assert.ok(agyLane && !agyLane.attested, "the agy lane must be unattested");
  assert.ok(/HONEST-CEILING|antigravity lane cannot be attested|panel reader|R2-CRITICAL-01/i.test(agyLane.reason), agyLane.reason);
  // the block is agy-SPECIFIC: the other two lanes still attest individually (not a blanket panel break).
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && l.attested), "gpt lane still attests");
  assert.ok(out.lanes.find((l) => l.laneId === "claude" && l.attested), "claude hunter lane still attests");
});

// NEGATIVE (must remain UNATTESTED): a signed UNAUTHENTICATED-default agy record. The hard-fail is
// provider-level, so even a would-be "valid" agy record whose serve was the CCPA default cannot attest —
// models the unauth-default serve that once false-greened (the 19-11 / 07-18 / 22:16 class).
const agyUnauthDefault = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-unauth", cmdline_checksum: "c-unauth", served_default: true, attested_model_id: "CCPA" });
test("R2-CRITICAL-01 neg: signed UNAUTH-default agy record → agy lane still unattested (provider-level fail-closed)", () => {
  const out = attestLane(LANES.agy, [agyUnauthDefault], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a signed unauth-default agy record must not attest the panel lane");
  assert.ok(/HONEST-CEILING|panel reader/i.test(out.reason), out.reason);
});

// NEGATIVE (must remain UNATTESTED): a NON-CATALOG agy model record. agy exposes non-Google models too; a
// record naming a non-contracted model must not attest — the hard-fail closes this at the panel reader
// regardless of model id (defense-in-depth vs the Axis-5 spawn-time refusal in evaluateAttestation).
const agyNonCatalog = rec({ role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-nc", cmdline_checksum: "c-nc", attested_model_id: "Claude Sonnet 4.6 (Thinking)" });
test("R2-CRITICAL-01 neg: non-catalog agy model record → agy lane unattested", () => {
  const out = attestLane(LANES.agy, [agyNonCatalog], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a non-catalog agy model record must not attest the panel lane");
});

// The panel-2family FLOOR (gpt + claude, agy OPTIONAL) is UNAFFECTED by the agy hard-fail — it never
// requires the agy lane, so the floor still attests. (Regression guard for the fixture flip: the flip must
// block ONLY the 3-lab binding, never the floor.) ──
test("R2-CRITICAL-01: panel-2family FLOOR still attests (agy hard-fail does not touch the non-agy floor)", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.ok(out.ok, out.reason);
});

// ── QA-017/SR-018 (α choke-point false-RED fix): the panel-2family FLOOR attests with a subprocess-claude
//    record under the PROFILE-AWARE resolver; the SAME record does NOT attest the panel-3lab binding hunter. ──
test("QA-017: panel-2family FLOOR (gpt CLI + claude subprocess) → ATTESTED via the profile-aware resolver", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.ok(out.ok, `the valid subprocess-claude floor must attest: ${out.reason}`);
});
test("QA-017: the SAME subprocess-claude floor record does NOT attest the panel-3lab binding hunter lane", () => {
  const out = attestLane(LANES.claude, [claudeFloorOk], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "the binding hunter lane requires the in-process hunter, not the floor's subprocess-claude");
});

// ── SR-017 (α choke-point): a subprocess record with sanctioned_lane_id='security_claude_hunter' must NOT
//    attest the binding hunter — sanctioned_lane_id is a SETTABLE per-record label, not the identity. ──
test("SR-017: role='security-reviewer' + sanctioned_lane_id='security_claude_hunter' + shape=in-process-agent → hunter unattested", () => {
  const labelSpoof = rec({ role: "security-reviewer", sanctioned_lane_id: "security_claude_hunter", provider: "claude", shape: "in-process-agent", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [labelSpoof], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "sanctioned_lane_id is a settable label — identity is the WRITER-STAMPED role (SR-017)");
});
test("SR-017: sanctioned_lane_id=hunter but shape FORGED-ABSENT (subprocess-claude) → hunter unattested", () => {
  const shapeForged = rec({ role: "security_claude_hunter", sanctioned_lane_id: "security_claude_hunter", provider: "claude", shape: "subprocess-claude", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [shapeForged], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a subprocess-claude record can never be the in-process hunter (shape is writer-stamped)");
});

// ── SR-004/QA-003: code_sha ABSENT → NOT ok even when every lane attests (AC-14 binding). Uses the
//    panel-2family FLOOR (gpt + claude) so code_sha is the SOLE not-ok reason — the agy lane is now
//    un-attestable by construction (R2-CRITICAL-01) and would otherwise mask the code_sha check. ──
test("SR-004: every lane attested but code_sha absent → NOT ok", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, /* codeSha omitted */ profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.equal(out.ok, false, "a binding attestation must bind to a code SHA");
  assert.ok(/code_sha/.test(out.reason), out.reason);
});

// ── SR-004: a record from a DIFFERENT sprint must NOT attest (same-run correlation). ──
test("SR-004: cross-sprint record for gpt → gpt unattested → panel FAILS", () => {
  const otherSprintGpt = { sprint_id: "SP-OTHER-999", run_id: R, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [otherSprintGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a cross-sprint record must not attest a lane in this run");
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
});

// ── SR-004: a record from a DIFFERENT run (same sprint) must NOT attest. ──
test("SR-004: cross-run record (same sprint) for gpt → gpt unattested", () => {
  const otherRunGpt = { sprint_id: S, run_id: "run-OTHER", ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestLane(LANES.gpt, [otherRunGpt], { runId: R, sprintId: S });
  assert.equal(out.attested, false, "a different-run record must not attest this run's lane");
});

// ── R2-A (SR-004-REOPEN/QA-003-R2): a NULL-run_id record must NOT attest when a runId is required. ──
test("R2-A: null-run_id record does NOT attest a required-runId lane (no null bypass)", () => {
  const nullRunGpt = { sprint_id: S, run_id: null, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestLane(LANES.gpt, [nullRunGpt], { runId: R, sprintId: S });
  assert.equal(out.attested, false, "a null-run_id record must not attest when a specific runId is required");
});
test("R2-A: null-run_id via attestPanelRun → panel FAILS (the reproduced bypass is closed)", () => {
  const nullRunGpt = { sprint_id: S, run_id: null, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-x" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [nullRunGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a null-run_id GPT record must not attest a required run");
});

// ── SR-005: an arbitrary claude in-process security-reviewer record (NO hunter role) → does NOT attest. ──
test("SR-005: claude in-process record without security_claude_hunter role → hunter unattested", () => {
  const notHunter = rec({ role: "security-reviewer", provider: "claude", via: "epsilon-agent", shape: "in-process-agent", evidence_sha: "e-x" });
  const out = attestLane(LANES.claude, [notHunter], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, false, "provider=claude alone must not attest the sanctioned hunter (β#3/SR-005)");
});

// ── SR-015 (option B, condition 2) / SR-016: a SUBPROCESS-claude record must NEVER satisfy the in-process
//    hunter lane — even claiming the hunter role AND setting the settable `via:"epsilon-agent"` label.
//    Identity is the STRUCTURAL shape (in-process-agent), NOT a settable via/record_via label. ──
test("SR-015 cond-2: subprocess-claude record claiming the hunter role → hunter (in-process) unattested", () => {
  const subprocessFakeHunter = rec({ role: "security_claude_hunter", provider: "claude", shape: "subprocess-claude", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [subprocessFakeHunter], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, false, "a subprocess-claude record must not satisfy the in-process hunter lane (shape mismatch)");
});
test("SR-016: subprocess-claude + via:'epsilon-agent' + hunter role → in-process hunter STILL unattested", () => {
  // The exact reopened case: a settable `via` label must NOT let a subprocess record ride the hunter lane.
  const viaSpoofHunter = rec({ role: "security_claude_hunter", provider: "claude", shape: "subprocess-claude", via: "epsilon-agent", record_via: "inprocess", output_digest: "d", cmdline_checksum: "c" });
  const out = attestLane(LANES.claude, [viaSpoofHunter], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, false, "a settable via/record_via label must not spoof the in-process hunter shape (SR-016)");
});

// ── T5a (THE fixture): wrapper CLAIMS agy but the record is provider:claude → agy NOT attested. ──
test("T5a: agy claimed but record is provider:claude → agy unattested → panel FAILS", () => {
  const fakeAgy = rec({ role: "security-reviewer", provider: "claude", tool_id: "claude", shape: "in-process-agent", evidence_sha: "e-fake" });
  const out = attestPanelRun({ runId: R, sprintId: S, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: [gptOk, claudeHunterOk, fakeAgy] });
  assert.equal(out.ok, false, "a Claude record must NOT attest the agy lane (the masquerade)");
  assert.ok(out.lanes.find((l) => l.laneId === "agy" && !l.attested));
});

// ── T5b: a record-inprocess/provider:claude record offered for the gpt lane → satisfies only claude. ──
test("T5b: provider:claude in-process record does NOT attest the gpt CLI lane", () => {
  const out = attestLane(LANES.gpt, [claudeHunterOk], { runId: R, codeSha: SHA });
  assert.equal(out.attested, false, "a claude in-process record satisfies only the claude hunter, not gpt");
});

// ── Liveness−: fallback:true → NOT attested (a Claude clone ran, not the contracted lab). ──
test("Liveness-: fallback:true record → NOT attested", () => {
  const fb = rec({ fallback: true, provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d", cmdline_checksum: "c" });
  assert.equal(attestLane(LANES.gpt, [fb], { runId: R, codeSha: SHA }).attested, false);
});

// ── Liveness−: a config echo (no output_digest) → NOT attested (a declaration is not a run). ──
test("Liveness-: CLI record without output_digest → NOT attested (config echo insufficient)", () => {
  const echo = rec({ provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", cmdline_checksum: "c" });
  assert.equal(attestLane(LANES.gpt, [echo], { runId: R, codeSha: SHA }).attested, false);
});

// ── Liveness−: wrong-run record → NOT correlated (same-run binding). ──
test("Liveness-: a record from a DIFFERENT run is not same-run correlated", () => {
  const other = { sprint_id: S, run_id: "run-OTHER", ok: true, fallback: false, provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d" };
  // readLedgerRecords does the run filter; here we prove attestLane won't match if the caller passed
  // only cross-run records (it received an empty same-run set).
  const out = attestPanelRun({ runId: R, sprintId: S, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [claudeHunterOk /* only claude; gpt absent this run */] });
  assert.equal(out.ok, false);
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
});

// ── missing required lane → panel FAILS (never a green with a lane absent). ──
test("missing required lane record → panel FAILS", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk /* claude hunter absent */] });
  assert.equal(out.ok, false);
});

// ── SR-012: an OMITTED runId → NOT ok, even with fully-attested records (certifying historical evidence). ──
test("SR-012: attestPanelRun with omitted runId → NOT ok (no historical certification)", () => {
  const out = attestPanelRun({ /* runId omitted */ sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeHunterOk] });
  assert.equal(out.ok, false, "a binding attestation must certify a SPECIFIC run");
  assert.ok(/runId|SR-012|specific run/i.test(out.reason), out.reason);
});

// ── SR-011: a record from a DIFFERENT panel_run_id (stale run) → NOT correlated → panel FAILS. ──
test("SR-011: a record with a different panel_run_id → not same-run → gpt unattested", () => {
  const staleGpt = { ...gptOk, panel_run_id: "panel-OTHER", run_id: "panel-OTHER" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [staleGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a stale-run record must not attest this run's lane");
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
});

// ── SR-014: THE reopened case — a DIFFERENT panel_run_id whose run_id happens to MATCH must NOT attest
//    (the dropped `|| r.run_id === runId` fallback). Correlation is by panel_run_id IDENTITY only. ──
test("SR-014: different panel_run_id but matching run_id → NOT attested (no run_id fallback)", () => {
  const otherPanelGpt = { ...gptOk, panel_run_id: "panel-OTHER", run_id: R /* run_id MATCHES the requested run */ };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [otherPanelGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a record from a different panel must not certify this panel via a matching run_id");
  assert.ok(out.lanes.find((l) => l.laneId === "gpt" && !l.attested));
  // and the direct lane check
  assert.equal(attestLane(LANES.gpt, [otherPanelGpt], { runId: R, sprintId: S, codeSha: SHA }).attested, false);
});

// ── QA-014: the panel identity is panel_run_id — a record with a DIFFERENT run_id (from WARPOS_RUN_ID)
//    but the matching panel_run_id must STILL correlate. The prior live filter keyed on run_id → real
//    runner records were discarded. Prove attestLane AND readLedgerRecords correlate by panel_run_id. ──
test("QA-014: a record with panel_run_id===run but a DIFFERENT run_id still attests (identity is panel_run_id)", () => {
  const runnerGpt = { ...gptOk, run_id: "sprint-run-XYZ" /* differs from panel_run_id */, panel_run_id: R };
  const out = attestLane(LANES.gpt, [runnerGpt], { runId: R, sprintId: S, codeSha: SHA });
  assert.equal(out.attested, true, "a real runner record must correlate by panel_run_id, not be discarded on run_id");
});
test("QA-014: readLedgerRecords filters by panel_run_id, not run_id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-qa014-"));
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

// ── SR-013: a record whose code_sha MISMATCHES the attested HEAD → NOT attested. ──
test("SR-013: record code_sha != attested codeSha → gpt unattested → panel FAILS", () => {
  const staleShaGpt = { ...gptOk, code_sha: "old-commit-999" };
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [staleShaGpt, claudeHunterOk] });
  assert.equal(out.ok, false, "a record from a different build must not attest the current HEAD");
});
test("SR-013: a record with NO persisted code_sha → NOT attested (provenance required)", () => {
  const noShaGpt = { ...gptOk, code_sha: undefined };
  assert.equal(attestLane(LANES.gpt, [noShaGpt], { runId: R, codeSha: SHA }).attested, false);
});
test("SR-013: a record with NO cmdline_checksum (no invocation digest) → NOT attested", () => {
  const noInvGpt = { ...gptOk, cmdline_checksum: undefined };
  assert.equal(attestLane(LANES.gpt, [noInvGpt], { runId: R, codeSha: SHA }).attested, false);
});

// ═══ ED-231 ORIGIN-PROOF forgery teeth (α ruling option A; ADR-0025) — the permanent negative fixtures that
//     replace the pre-ED-231 field-only trust. These are THE ship gate: a hand-authored/forged record must
//     FAIL-CLOSED; only a record SIGNED by the trusted per-session writer attests. ═══
// The exact reproduced attack: a COMPLETE forged 3-lab set with all the right fields but NO valid signature.
const forgedHunter = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, role: "security_claude_hunter", provider: "claude", shape: "in-process-agent", evidence_sha: "e-forge", cmdline_checksum: "c-forge", verdict: "pass" };
const forgedGpt = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, role: "security-reviewer", provider: "openai", tool_id: "codex", shape: "subprocess-cross-provider", output_digest: "d-forge", cmdline_checksum: "cc-forge" };
const forgedAgy = { sprint_id: S, run_id: R, panel_run_id: R, code_sha: SHA, ok: true, fallback: false, role: "security-reviewer", provider: "antigravity", tool_id: "agy", shape: "subprocess-cross-provider", output_digest: "d-forge2", cmdline_checksum: "cc-forge2" };
test("ED-231: an UNSIGNED forged 3-lab set (the reproduced attack) does NOT attest — fail-closed", () => {
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: [forgedGpt, forgedAgy, forgedHunter] });
  assert.equal(out.ok, false, "a hand-authored (unsigned) record set must NOT attest — origin-proof closes the forgery");
  // R3-HIGH-01: the agy lane fails-closed UNCONDITIONALLY (R2-CRITICAL-01), so out.ok===false ALONE is masked
  // (it would hold even if the signature check broke). Assert the NON-AGY lanes are INDIVIDUALLY unattested —
  // THAT is what proves origin-proof rejects the unsigned forgery, independent of the agy hard-fail.
  assert.equal(out.lanes.find((l) => l.laneId === "gpt").attested, false, "origin-proof must reject the unsigned forged gpt record (not masked by the agy hard-fail)");
  assert.equal(out.lanes.find((l) => l.laneId === "claude").attested, false, "origin-proof must reject the unsigned forged hunter record (not masked by the agy hard-fail)");
});
test("ED-231: a WRONG-MAC forged set does NOT attest — fail-closed", () => {
  const bad = [forgedGpt, forgedAgy, forgedHunter].map((r) => ({ ...r, attest_sig: "0".repeat(64) }));
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-3lab" }, lanes: [LANES.gpt, LANES.claude, LANES.agy], records: bad });
  assert.equal(out.ok, false, "an invalid signature must NOT attest");
  // R3-HIGH-01: assert the NON-AGY lanes are individually unattested so the wrong-MAC rejection is proven
  // independent of the agy hard-fail mask (a broken signature check would otherwise slip through un-caught).
  assert.equal(out.lanes.find((l) => l.laneId === "gpt").attested, false, "origin-proof must reject the wrong-MAC gpt record (not masked by the agy hard-fail)");
  assert.equal(out.lanes.find((l) => l.laneId === "claude").attested, false, "origin-proof must reject the wrong-MAC hunter record (not masked by the agy hard-fail)");
});
test("ED-231: a single hand-authored hunter record (right fields, no sig) does NOT attest its lane", () => {
  const out = attestLane(LANES.claude, [forgedHunter], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "an unsigned hunter record is a forgery — the in-process lane must reject it");
});
test("ED-231 no over-block: a REAL SIGNED panel-2family floor STILL attests (origin-proof is not a blanket block)", () => {
  // The 3-lab BINDING is now agy-blocked by construction (R2-CRITICAL-01), so the no-over-block property is
  // proven on the panel-2family FLOOR: properly signed gpt + claude records STILL attest (origin-proof
  // rejects forgeries, NOT valid signed records).
  const out = attestPanelRun({ runId: R, sprintId: S, codeSha: SHA, profile: { name: "panel-2family" }, lanes: [LANES.gpt, LANES.claude], records: [gptOk, claudeFloorOk] });
  assert.ok(out.ok, `a properly signed set must still attest: ${out.reason}`);
});
test("ED-231: tampering a SIGNED field (role) after signing invalidates the signature → not attested", () => {
  const tampered = { ...claudeHunterOk, role: "security-reviewer" }; // mutate a signed field, keep the old sig
  const out = attestLane(LANES.claude, [tampered], { runId: R, sprintId: S, codeSha: SHA, profileName: "panel-3lab" });
  assert.equal(out.attested, false, "a tampered signed field must break the signature and fail-closed");
});

if (failures.length) {
  process.stderr.write(`FAIL [cert-attest-panel.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [cert-attest-panel.test] ${passed} passed (T5 wrapper-claim != proof; ED-231 origin-proof: forged/unsigned/wrong-mac/tampered → fail-closed, signed → attests)\n`);
