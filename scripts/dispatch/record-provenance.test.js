#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
mcEnv.setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `attest-secret-recprov-${process.pid}-${Date.now()}`));
const { recordCompletion } = require("../dispatch-agent");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

function withLedger(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ledger-"));
  const saved = {};
  const panelSnap = mcEnv.snapshotEnv("PANEL_RUN_ID");
  const { PANEL_RUN_ID: panelRunId, ...rest } = env;
  const setEnv = { DISPATCH_LEDGER_DIR: dir, ...rest };
  for (const k of Object.keys(setEnv)) { saved[k] = process.env[k]; process.env[k] = setEnv[k]; }
  if (panelRunId === undefined) mcEnv.unsetEnv("PANEL_RUN_ID"); else mcEnv.setEnv("PANEL_RUN_ID", panelRunId);
  try {
    recordCompletion({ role: "security-reviewer", provider: "openai", ok: true, output_digest: "d" });
    const line = fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split("\n").pop();
    return fn(JSON.parse(line));
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    mcEnv.restoreEnv(panelSnap);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
}

test("recordCompletion stamps panel_run_id from MC_PANEL_RUN_ID", () => {
  withLedger({ PANEL_RUN_ID: "panel-injected-42" }, (rec) => {
    assert.equal(rec.panel_run_id, "panel-injected-42", "the minted panel_run_id must reach the record");
  });
});
test("no MC_PANEL_RUN_ID → panel_run_id is null (not a stale value)", () => {
  withLedger({}, (rec) => {
    assert.equal(rec.panel_run_id, null);
  });
});

test("recordCompletion persists a non-empty code_sha (git HEAD)", () => {
  withLedger({ PANEL_RUN_ID: "p" }, (rec) => {
    assert.ok(typeof rec.code_sha === "string" && rec.code_sha.length >= 7, `code_sha must be persisted, got ${JSON.stringify(rec.code_sha)}`);
  });
});

test("a caller code_sha that CONFLICTS with the writer-derived HEAD → overridden + provenance_mismatch + UNSIGNED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ledger-"));
  const savedDir = process.env.DISPATCH_LEDGER_DIR, savedRun = mcEnv.readEnv("PANEL_RUN_ID");
  process.env.DISPATCH_LEDGER_DIR = dir; mcEnv.setEnv("PANEL_RUN_ID", "panel-real");
  try {
    recordCompletion({ role: "security-reviewer", provider: "openai", ok: true, output_digest: "d", code_sha: "FORGED-SHA" });
    const rec = JSON.parse(fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split("\n").pop());
    assert.notEqual(rec.code_sha, "FORGED-SHA", "a conflicting caller code_sha must be OVERRIDDEN by the writer-derived HEAD");
    assert.equal(rec.provenance_mismatch, true, "a conflicting caller code_sha must flag provenance_mismatch");
    assert.ok(!rec.attest_sig, "a provenance-mismatch record must be UNSIGNED (it can never attest)");
  } finally {
    if (savedDir === undefined) delete process.env.DISPATCH_LEDGER_DIR; else process.env.DISPATCH_LEDGER_DIR = savedDir;
    if (savedRun === undefined) mcEnv.unsetEnv("PANEL_RUN_ID"); else mcEnv.setEnv("PANEL_RUN_ID", savedRun);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});
test("a clean record (no caller/derived conflict) is SIGNED (origin-proof attest_sig present)", () => {
  withLedger({ PANEL_RUN_ID: "panel-real" }, (rec) => {
    assert.equal(rec.panel_run_id, "panel-real", "the writer-derived panel_run_id is authoritative");
    assert.ok(typeof rec.attest_sig === "string" && /^[0-9a-f]{64}$/i.test(rec.attest_sig), "a clean record must carry a valid-shaped origin-proof signature");
    assert.ok(!rec.provenance_mismatch, "a clean record must NOT be flagged provenance_mismatch");
  });
});

if (failures.length) {
  process.stderr.write(`FAIL [record-provenance.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [record-provenance.test] ${passed} passed (panel_run_id + code_sha reach every completion record; the cross-cutting propagation is proven)\n`);
