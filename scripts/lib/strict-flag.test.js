"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const mcEnv = require("../hooks/lib/mc-env");
mcEnv.setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `sf-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const { test } = require("node:test");
const assert = require("node:assert");
const { parseRequiredFlag } = require("./strict-flag");
const { signRecord, verifyRecord } = require("../dispatch/attest-signing");

const G1 = "g-" + "1".repeat(32), G2 = "g-" + "2".repeat(32), GO = "g-" + "a".repeat(32), GS = "g-" + "5".repeat(32);
const F = "--gauntlet-run";
const TABLE = [
  ["space form", [F, "g-1"], { present: true, value: "g-1" }],
  ["equals form", [`${F}=g-1`], { present: true, value: "g-1" }],
  ["bare", [F], { error: true }],
  ["bare then other flag", [F, "--roles", "x"], { error: true }],
  ["empty string", [F, ""], { error: true }],
  ["whitespace", [F, "   "], { error: true }],
  ["equals empty", [`${F}=`], { error: true }],
  ["equals flag-like", [`${F}=--roles`], { error: true }],
  ["conflicting occurrences", [F, "g-1", `${F}=g-2`], { error: true }],
  ["conflicting space occurrences", [F, "g-1", F, "g-2"], { error: true }],
  ["identical repeats ok", [F, "g-1", `${F}=g-1`], { present: true, value: "g-1" }],
  ["absent", ["--roles", "x"], { present: false, value: undefined }],
  ["prefix-collision flag ignored", ["--gauntlet-runner", "x"], { present: false, value: undefined }],
];

for (const [label, argv, exp] of TABLE) {
  test(`helper: ${label}`, () => {
    const r = parseRequiredFlag(argv, "gauntlet-run");
    if (exp.error) {
      assert.strictEqual(r.present, true);
      assert.ok(r.error, "error expected");
      assert.strictEqual(r.value, undefined);
    } else {
      assert.strictEqual(r.error, null);
      assert.strictEqual(r.present, exp.present);
      assert.strictEqual(r.value, exp.value);
    }
  });
}

const ROLE = "security-reviewer";
const SPRINT = "SP-20261031-SF";
const SINCE = Date.now() - 60_000;
function ledger(dir, runId) {
  const r = { role: ROLE, ok: true, provider: "openai", model: "gpt-5.5", completed_at: new Date().toISOString(), tool_id: "codex", cmdline_checksum: "abc123", sprint_id: SPRINT, gauntlet_run_id: runId };
  r.attest_sig = signRecord(r);
  const f = path.join(dir, "l.jsonl");
  fs.writeFileSync(f, JSON.stringify(r) + "\n");
  return f;
}
const GV = [
  ["--gauntlet-run g-1 (reviewer probe)", [F, G1], 1],
  ["--gauntlet-run=g-1 (reviewer probe)", [`${F}=${G1}`], 1],
  ["--gauntlet-run g-OTHER", [F, GO], 0],
  ["--gauntlet-run=g-OTHER", [`${F}=${GO}`], 0],
  ["bare", [F], 2],
  ["empty", [F, ""], 2],
  ["whitespace", [F, "   "], 2],
  ["equals empty", [`${F}=`], 2],
  ["flag-like value", [F, "--roles", "x"], 2],
  ["conflicting", [F, G1, `${F}=${GO}`], 2],
  ["absent -> unbound", [], 0],
];
for (const [label, extra, rc] of GV) {
  test(`gauntlet-verify CLI: ${label} -> rc ${rc}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-gv-"));
    try {
      const f = ledger(dir, GO);
      const argv = [path.join(__dirname, "..", "dispatch", "gauntlet-verify.js"), "--roles", ROLE, "--sprint", SPRINT, "--since", String(SINCE), "--completions", f, "--json", ...extra];
      const r = spawnSync(process.execPath, argv, { encoding: "utf8", env: process.env });
      assert.strictEqual(r.status, rc, r.stdout + r.stderr);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

const RI = [
  ["space form wins over env", [F, G1], 0, G1],
  ["equals form wins over env", [`${F}=${G1}`], 0, G1],
  ["bare", [F], 2, null],
  ["empty (reviewer probe)", [F, ""], 2, null],
  ["whitespace", [F, "   "], 2, null],
  ["equals empty", [`${F}=`], 2, null],
  ["flag-like value", [F, "--elapsed-ms", "5"], 2, null],
  ["conflicting", [F, G1, `${F}=${G2}`], 2, null],
  ["absent -> inherited env unchanged", [], 0, GS],
];
for (const [label, extra, rc, stamped] of RI) {
  test(`record-inprocess CLI: ${label} -> rc ${rc}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-ri-"));
    try {
      const evidence = path.join(dir, "evidence.json");
      fs.writeFileSync(evidence, JSON.stringify({ verdict: "pass" }));
      const root = path.resolve(__dirname, "..", "..");
      const env = { ...process.env, CLAUDE_PROJECT_DIR: root, DISPATCH_LEDGER_DIR: dir, MC_GAUNTLET_RUN_ID: GS };
      delete env.WARPOS_GAUNTLET_RUN_ID;
      const argv = [path.join(__dirname, "..", "sprint", "epsilon-runtime.js"), "record-inprocess", "--sprint", SPRINT, "--role", "quality-lead", "--step", "gauntlet", "--evidence", evidence, ...extra];
      const r = spawnSync(process.execPath, argv, { encoding: "utf8", env });
      assert.strictEqual(r.status, rc, r.stdout + r.stderr);
      const led = path.join(dir, "dispatch-completions.jsonl");
      if (stamped === null) {
        assert.strictEqual(fs.existsSync(led), false, "nothing may be written on refusal");
      } else {
        const rec = JSON.parse(fs.readFileSync(led, "utf8").trim().split("\n").pop());
        assert.strictEqual(rec.gauntlet_run_id, stamped);
        assert.strictEqual(verifyRecord(rec), true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
