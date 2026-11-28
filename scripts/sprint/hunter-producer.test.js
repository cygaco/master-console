#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const assert = require("assert");
const crypto = require("crypto");
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

const roles = hp.loadRoles();
const rr = rt.resolveRoute("security_claude_hunter", roles);
const hunterPlan = { role: "security_claude_hunter", step: "gauntlet", route: rr.route, provider: rr.provider, model: rr.model };

test("teeth-5: registration resolves the hunter to an in-process route (record-inprocess can accept it)", () => {
  assert.equal(rr.resolved, true, "security_claude_hunter must be a registered role");
  assert.equal(rr.provider, "claude");
  assert.ok(rr.route === "claude-agent" || rr.route === "agent-tool", `in-process route expected, got ${rr.route}`);
});

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

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function writePacket(dir) {
  const file = path.join(dir, "packet.txt");
  fs.writeFileSync(file, "review packet: the change under security review");
  return file;
}

test("teeth-1 (positive): record-inprocess PRODUCES a writer-stamped hunter record pv.isHunterRecord accepts", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "hunter.json");
    fs.writeFileSync(ev, JSON.stringify({ verdict: "pass", findings: [] }));
    const packet = writePacket(dir);
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-T", { evidenceFile: ev, elapsedMs: 4321, packetFile: packet });
    assert.equal(out.recorded, true, `must record: ${out.reason}`);
    assert.equal(out.ok, true, "non-empty evidence → ok:true");
    const recs = readLedger(led);
    const rec = recs.find((r) => r.sprint_id === "SP-HUNTER-T");
    assert.ok(rec, "the hunter record landed on the (isolated) ledger");
    assert.equal(rec.provider, "claude");
    assert.equal(rec.shape, "in-process-agent");
    assert.equal(rec.role, "security_claude_hunter");
    assert.equal(pv.isHunterRecord(rec), true, "the produced record must satisfy the choke-point hunter predicate");
    assert.equal(rec.verdict, "pass", "the produced record carries the parsed review verdict");
    assert.equal(rec.fallback, false);
    assert.equal(rec.evidence_sha, sha256(ev), "in-process evidence binding present");
    assert.equal(rec.packet_sha256, sha256(packet), "the record names the packet it ran on");
    assert.equal(rec.output_digest, pv.hunterBindingDigest(sha256(packet), sha256(ev)), "output_digest binds the packet to the evidence");
  });
});

test("activation: the hunter record carries panel_run_id + code_sha for same-run panel correlation", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "hunter.json");
    fs.writeFileSync(ev, JSON.stringify({ verdict: "pass", findings: [] }));
    const prevPanel = mcEnv.readEnv("PANEL_RUN_ID");
    mcEnv.setEnv("PANEL_RUN_ID", "panel-ACTIVATION-T");
    try {
      rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-PANEL", { evidenceFile: ev, elapsedMs: 100, packetFile: writePacket(dir) });
    } finally {
      if (prevPanel === undefined) mcEnv.unsetEnv("PANEL_RUN_ID");
      else mcEnv.setEnv("PANEL_RUN_ID", prevPanel);
    }
    const rec = readLedger(led).find((r) => r.sprint_id === "SP-HUNTER-PANEL");
    assert.ok(rec, "hunter record landed");
    assert.equal(rec.panel_run_id, "panel-ACTIVATION-T", "panel_run_id stamped from MC_PANEL_RUN_ID (same-run correlation)");
    assert.ok(rec.code_sha && /^[0-9a-f]{7,40}$/i.test(rec.code_sha), `code_sha stamped (git HEAD): ${rec.code_sha}`);
  });
});

test("a non-JSON hunter return records ok with the explicit verdict error", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "prose.txt");
    fs.writeFileSync(ev, "the hunter ran but returned prose, not a ReviewResult JSON");
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-NV", { evidenceFile: ev, packetFile: writePacket(dir) });
    assert.equal(out.recorded, true, `must record: ${out.reason}`);
    assert.equal(out.ok, true, "the hunter did run");
    const rec = readLedger(led).find((r) => r.sprint_id === "SP-HUNTER-NV");
    assert.ok(rec && pv.isHunterRecord(rec), "identity still writer-stamped (it DID run)");
    assert.equal(rec.ok, true);
    assert.equal(rec.verdict, "error", "a verdict-less return is recorded as an error, never as a pass");
  });
});

test("teeth-3: 0-byte evidence → ok:false record (in-process reap analog, never a synthetic pass)", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "empty.json");
    fs.writeFileSync(ev, "");
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-REAP", { evidenceFile: ev, packetFile: writePacket(dir) });
    assert.equal(out.ok, false, "a 0-byte hunter return is a reap, not a success");
    const rec = readLedger(led).find((r) => r.sprint_id === "SP-HUNTER-REAP");
    assert.ok(rec, "the reap is recorded");
    assert.equal(rec.ok, false);
    assert.equal(rec.verdict, "error");
  });
});
test("teeth-3: NO evidence file → REFUSE (no proof of a spawn → no synthetic hunter record)", () => {
  withIsolatedLedger((dir, led) => {
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-NONE", { evidenceFile: path.join(dir, "does-not-exist.json"), packetFile: writePacket(dir) });
    assert.equal(out.recorded, false, "no evidence → no record");
    assert.ok(/without the Agent-tool return evidence/i.test(out.reason), out.reason);
    assert.deepEqual(readLedger(led), [], "nothing written");
  });
});

test("a hunter record without the review packet is refused and nothing is written", () => {
  withIsolatedLedger((dir, led) => {
    const ev = path.join(dir, "hunter.json");
    fs.writeFileSync(ev, JSON.stringify({ verdict: "pass", findings: [] }));
    const out = rt.recordInProcessCompletion(hunterPlan, "SP-HUNTER-NOPACKET", { evidenceFile: ev });
    assert.equal(out.recorded, false, "no packet → no record");
    assert.ok(/without the review packet/i.test(out.reason), out.reason);
    assert.deepEqual(readLedger(led), [], "nothing written");
  });
});

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
process.stdout.write(`OK   [hunter-producer.test] ${passed} passed (writer-stamped producer; verdict; teeth-1/3/5; no synthetic path)\n`);
