#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * Teeth for the security_claude_hunter PRODUCER (Unit H — ADR-0022, SP-20260718-003 completion).
 * The ADR's teeth are NORMATIVE: this proves the REAL registered producer end-to-end.
 *
 *   teeth-1 (writer-stamped, non-settable): record-inprocess produces a hunter record whose provider+shape+role
 *           are writer-stamped and pv.isHunterRecord ACCEPTS it; a record asserting the identity via a SETTABLE
 *           field (but wrong shape) is REJECTED. No synthetic-record acceptance path.
 *   teeth-3 (spawn-or-BLOCK): no evidence / 0-byte evidence → NO ok:true record (the in-process reap analog).
 *   teeth-5 (registration is a hypothesis): resolving the role in the registry proves NOTHING on its own — a
 *           real fallback:false record with a verdict is what the gate needs; registration alone writes nothing.
 *   SR-019 : the produced record carries the REVIEW verdict parsed from the evidence (pass/fail/warn); a
 *           non-JSON / verdict-less return leaves the verdict off → the panel gate BLOCKS the hunter lane.
 *
 *   node scripts/sprint/hunter-producer.test.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const rt = require("./epsilon-runtime.js");
const pv = require("../dispatch/provenance-verifier.js");
const hp = require("./hook-points.js");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

// The agentPlan exactly as the CLI builds it: resolveRoute reads the LIVE role-registry (Unit H registration).
const roles = hp.loadRoles();
const rr = rt.resolveRoute("security_claude_hunter", roles);
const hunterPlan = { role: "security_claude_hunter", step: "gauntlet", route: rr.route, provider: rr.provider, model: rr.model };

// teeth-5 (registration is a hypothesis): the registry resolves the hunter to an IN-PROCESS route — but that
// is all registration buys; it writes no record and asserts no green.
test("teeth-5: registration resolves the hunter to an in-process route (record-inprocess can accept it)", () => {
  assert.equal(rr.resolved, true, "security_claude_hunter must be a registered role");
  assert.equal(rr.provider, "claude");
  assert.ok(rr.route === "claude-agent" || rr.route === "agent-tool", `in-process route expected, got ${rr.route}`);
});

// The end-to-end PRODUCER, writing to an ISOLATED ledger (DISPATCH_LEDGER_DIR) — never the canonical file.
function withIsolatedLedger(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hunter-prod-"));
  const led = path.join(dir, "ledger");
  fs.mkdirSync(led, { recursive: true });
  const prev = process.env.DISPATCH_LEDGER_DIR;
  process.env.DISPATCH_LEDGER_DIR = led;
  try {
    return fn(dir, led);
  } finally {
    if (prev === undefined) delete process.env.DISPATCH_LEDGER_DIR;
    else process.env.DISPATCH_LEDGER_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function readLedger(led) {
  const f = path.join(led, "dispatch-completions.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// teeth-1 POSITIVE: record-inprocess produces a writer-stamped hunter record pv.isHunterRecord accepts.
test("teeth-1 (positive): record-inprocess PRODUCES a writer-stamped hunter record pv.isHunterRecord accepts", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "hunter.json");
    fs.writeFileSync(ev, JSON.stringify({ verdict: "pass", findings: [] }));
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-T", { evidenceFile: ev, elapsedMs: 4321 });
    assert.equal(out.recorded, true, `must record: ${out.reason}`);
    assert.equal(out.ok, true, "non-empty evidence → ok:true");
    const recs = readLedger(led);
    const rec = recs.find((r) => r.sprint_id === "SP-HUNTER-T");
    assert.ok(rec, "the hunter record landed on the (isolated) ledger");
    // WRITER-STAMPED identity — the exact fields the choke-point keys on.
    assert.equal(rec.provider, "claude");
    assert.equal(rec.shape, "in-process-agent");
    assert.equal(rec.role, "security_claude_hunter");
    assert.equal(pv.isHunterRecord(rec), true, "the produced record must satisfy the choke-point hunter predicate");
    // SR-019: the review verdict is stamped from the evidence.
    assert.equal(rec.verdict, "pass", "the produced record carries the parsed review verdict (SR-019)");
    assert.equal(rec.fallback, false);
    assert.ok(rec.evidence_sha, "in-process evidence binding present");
  });
});

// ACTIVATION same-run correlation: with a panel run active (WARPOS_PANEL_RUN_ID) the hunter record carries
// panel_run_id + code_sha, exactly as dispatch-agent stamps its CLI lanes — so attestPanelRun can same-run
// correlate the hunter into a panel-3lab attestation (ADR-0022 teeth-5).
test("activation: the hunter record carries panel_run_id + code_sha for same-run panel correlation", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "hunter.json");
    fs.writeFileSync(ev, JSON.stringify({ verdict: "pass", findings: [] }));
    const prevPanel = mcEnv.readEnv("PANEL_RUN_ID");
    mcEnv.setEnv("PANEL_RUN_ID", "panel-ACTIVATION-T");
    try {
      rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-PANEL", { evidenceFile: ev, elapsedMs: 100 });
    } finally {
      if (prevPanel === undefined) mcEnv.unsetEnv("PANEL_RUN_ID");
      else mcEnv.setEnv("PANEL_RUN_ID", prevPanel);
    }
    const rec = readLedger(led).find((r) => r.sprint_id === "SP-HUNTER-PANEL");
    assert.ok(rec, "hunter record landed");
    assert.equal(rec.panel_run_id, "panel-ACTIVATION-T", "panel_run_id stamped from WARPOS_PANEL_RUN_ID (same-run correlation)");
    assert.ok(rec.code_sha && /^[0-9a-f]{7,40}$/i.test(rec.code_sha), `code_sha stamped (git HEAD): ${rec.code_sha}`);
  });
});

// SR-019: a verdict-less (non-JSON) return still records liveness (ok) but stamps NO verdict → gate BLOCKS.
test("SR-019: a non-JSON hunter return records ok but NO verdict (the panel gate will BLOCK the hunter lane)", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "prose.txt");
    fs.writeFileSync(ev, "the hunter ran but returned prose, not a ReviewResult JSON");
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-NV", { evidenceFile: ev });
    assert.equal(out.recorded, true);
    const rec = readLedger(led).find((r) => r.sprint_id === "SP-HUNTER-NV");
    assert.ok(rec && pv.isHunterRecord(rec), "identity still writer-stamped (it DID run)");
    assert.equal(rec.verdict, undefined, "a verdict-less return stamps no verdict → the binding claude lane resolves BLOCK");
  });
});

// teeth-3 (spawn-or-BLOCK): 0-byte evidence → ok:false (in-process reap); NO evidence → REFUSE (no synthetic).
test("teeth-3: 0-byte evidence → ok:false record (in-process reap analog, never a synthetic pass)", () => {
  withIsolatedLedger((dir) => {
    const ev = path.join(dir, "empty.json");
    fs.writeFileSync(ev, "");
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-REAP", { evidenceFile: ev });
    assert.equal(out.ok, false, "a 0-byte hunter return is a reap, not a success");
  });
});
test("teeth-3: NO evidence file → REFUSE (no proof of a spawn → no synthetic hunter record)", () => {
  const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-NONE", { evidenceFile: path.join(os.tmpdir(), "does-not-exist-xyz.json") });
  assert.equal(out.recorded, false, "no evidence → no record");
  assert.ok(/without the Agent-tool return evidence/i.test(out.reason), out.reason);
});

// teeth-1 NEGATIVE (no settable-label acceptance): a record ASSERTING the hunter role via a settable field but
// with the WRONG (subprocess) shape is NOT the hunter — identity is the writer-stamped channel, never a label.
test("teeth-1 (negative): a subprocess record labeled with the hunter role is NOT a hunter (shape is writer-stamped)", () => {
  const spoof = { provider: "claude", shape: "subprocess-claude", role: "security_claude_hunter", sanctioned_lane_id: "security_claude_hunter", via: "epsilon-agent" };
  assert.equal(pv.isHunterRecord(spoof), false, "a subprocess-claude record can never be the in-process hunter");
});
test("teeth-1 (negative): an in-process record WITHOUT the hunter role is NOT a hunter", () => {
  assert.equal(pv.isHunterRecord({ provider: "claude", shape: "in-process-agent", role: "security-reviewer" }), false);
});

if (failures.length) {
  process.stderr.write(`FAIL [hunter-producer.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [hunter-producer.test] ${passed} passed (writer-stamped producer; SR-019 verdict; teeth-1/3/5; no synthetic path)\n`);
