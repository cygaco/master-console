"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
mcEnv.setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `ert-runbind-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`));
require("../lib/hermetic-events-home").pin({ realRoot: path.resolve(__dirname, "..", ".."), prefix: "ert-runbind-events-" });
const { test } = require("node:test");
const assert = require("node:assert");
const rt = require("./epsilon-runtime");
const { verifyGauntlet } = require("../dispatch/gauntlet-verify");
const { signRecord, verifyRecord } = require("../dispatch/attest-signing");

const SPRINT = "SP-20261031-RB";
const GO = "g-" + "a".repeat(32);
const GX = "g-" + "b".repeat(32);
const ROLES = { "backend-reviewer": { provider: "openai", model: "gpt-5.5", kind: "reviewer", binding_verdict: true, home: "engineering" } };
const REGISTRY = { rows: [{ role: "backend-reviewer", step: "gauntlet", condition: { unit_type: ["backend"] }, mode: "block", order: 20 }] };
const SEAMS = { registry: REGISTRY, roles: ROLES };
const COMP = { unit_types: ["backend"], max_risk: "low", domains: [] };
const decision = () => ({
  package: "combined-focused",
  focused: { files: ["scripts/sprint/x.js"], tests: ["scripts/sprint/x.test.js"] },
  touchpoint: { files: [] },
  trailer: { change: "bugfix", blast: "minor" },
  security: { hit: false, by: [] },
  stages: [
    { stage: 0, name: "trailer", kind: "mechanical" },
    { stage: 1, name: "sanity", kind: "tests", files: ["scripts/sprint/x.test.js"], stop_on_fail: true },
    { stage: 2, name: "smoke", kind: "tests", files: [], stop_on_fail: true },
    { stage: 3, name: "security-shallow", kind: "mechanical", cmds: ["scripts/checks/leak-gate.js"], stop_on_fail: true },
    { stage: 4, name: "review", kind: "agents", stop_on_fail: true, roster: [{ role: "backend-reviewer", passes: ["primary"], scope: "focused", files: ["scripts/sprint/x.js"] }] },
  ],
});
const run = () => ({ status: 0, stdout: "ok" });

function rec(overrides = {}) {
  return {
    role: "backend-reviewer", ok: true, provider: "openai", model: "gpt-5.5", completed_at: new Date().toISOString(),
    tool_id: "codex", cmdline_checksum: "abc123", sprint_id: SPRINT, ...overrides,
  };
}
function signed(o = {}) { const r = rec(o); r.attest_sig = signRecord(r); return r; }

test("(1) verify args carry sprintId/since/until/requireSignature/gauntletRunId; roles = dispatched ∪ scheduled", () => {
  let args = null;
  const spawn = () => ({ spawned: true, ok: true, recorded: true, route: "dispatch-agent" });
  const verifyGauntlet = (a) => { args = a; return { ok: true, roles: a.roles.map((role) => ({ role, satisfied: true, status: "ran" })) }; };
  const out = rt.conductGauntletStep(COMP, SPRINT, decision(), { ...SEAMS, run, dispatch: true, spawn, verifyGauntlet });
  assert.strictEqual(args.runId, SPRINT);
  assert.strictEqual(args.sprintId, SPRINT);
  assert.strictEqual(args.requireSignature, true);
  assert.strictEqual(args.gauntletRunId, out.gauntlet_run_id);
  assert.ok(typeof out.gauntlet_run_id === "string" && out.gauntlet_run_id.length === 34 && require("../dispatch/attest-signing").isValidGauntletRunId(out.gauntlet_run_id));
  assert.ok(!Number.isNaN(Date.parse(args.since)) && !Number.isNaN(Date.parse(args.until)));
  assert.deepStrictEqual(args.roles, ["backend-reviewer"]);
});

test("(2) RED seed — REAL verifyGauntlet: foreign-run / unstamped signed records leave the role no-record; control turns green", () => {
  const records = [];
  let spawnEnv = null;
  const spawn = (_plan, _sprint, opts) => {
    spawnEnv = opts.env;
    records.push(signed({ gauntlet_run_id: GO }), signed());
    return { spawned: true, ok: true, recorded: true, route: "dispatch-agent" };
  };
  const real = (a) => verifyGauntlet({ ...a, records });
  const red = rt.conductGauntletStep(COMP, SPRINT, decision(), { ...SEAMS, run, dispatch: true, spawn, verifyGauntlet: real });
  assert.strictEqual(red.halt_reason, "stage_without_record");
  assert.strictEqual(red.verify.roles.find((r) => r.role === "backend-reviewer").status, "no-record");
  assert.strictEqual(red.verify.foreignRunExcluded, 2);
  records.length = 0;
  const spawn2 = (_plan, _sprint, opts) => {
    const id = opts.env.MC_GAUNTLET_RUN_ID;
    records.push(signed({ gauntlet_run_id: GO }), signed(), signed({ gauntlet_run_id: id }));
    return { spawned: true, ok: true, recorded: true, route: "dispatch-agent" };
  };
  const green = rt.conductGauntletStep(COMP, SPRINT, decision(), { ...SEAMS, run, dispatch: true, spawn: spawn2, verifyGauntlet: real });
  assert.strictEqual(green.halt_reason, null, JSON.stringify(green.verify));
  assert.ok(spawnEnv && spawnEnv.MC_GAUNTLET_RUN_ID === red.gauntlet_run_id, "spawn opts.env carries the minted id");
});

test("(3) opts.gauntletRunId, decision.run_id, and pre-set MC_GAUNTLET_RUN_ID are ignored; env restored", () => {
  const snap = mcEnv.snapshotEnv("GAUNTLET_RUN_ID");
  mcEnv.setEnv("GAUNTLET_RUN_ID", "g-PRESET");
  try {
    let seenEnvDuring = null, args = null;
    const spawn = (_p, _s, opts) => { seenEnvDuring = mcEnv.readEnv("GAUNTLET_RUN_ID"); assert.notStrictEqual(opts.env.MC_GAUNTLET_RUN_ID, "g-FROM-OPTS-ENV"); return { spawned: true, ok: true, recorded: true, route: "dispatch-agent" }; };
    const verifyGauntlet = (a) => { args = a; return { ok: true, roles: a.roles.map((role) => ({ role, satisfied: true, status: "ran" })) }; };
    const d = { ...decision(), run_id: "g-FROM-DECISION" };
    const out = rt.conductGauntletStep(COMP, SPRINT, d, { ...SEAMS, run, dispatch: true, spawn, verifyGauntlet, gauntletRunId: "g-FROM-OPTS", env: { MC_GAUNTLET_RUN_ID: "g-FROM-OPTS-ENV" } });
    for (const bad of ["g-FROM-OPTS", "g-FROM-DECISION", "g-PRESET", "g-FROM-OPTS-ENV"]) assert.notStrictEqual(out.gauntlet_run_id, bad);
    assert.strictEqual(args.gauntletRunId, out.gauntlet_run_id);
    assert.strictEqual(seenEnvDuring, out.gauntlet_run_id);
    assert.strictEqual(mcEnv.readEnv("GAUNTLET_RUN_ID"), "g-PRESET", "prior value restored");
  } finally {
    mcEnv.restoreEnv(snap);
  }
  const snap2 = mcEnv.snapshotEnv("GAUNTLET_RUN_ID");
  mcEnv.unsetEnv("GAUNTLET_RUN_ID");
  try {
    rt.conductGauntletStep(COMP, SPRINT, decision(), { ...SEAMS, run, dispatch: false });
    assert.strictEqual(mcEnv.readEnv("GAUNTLET_RUN_ID"), undefined);
  } finally {
    mcEnv.restoreEnv(snap2);
  }
});

test("(4) two conducts of one sprint mint distinct ids", () => {
  const a = rt.conductGauntletStep(COMP, SPRINT, decision(), { ...SEAMS, run, dispatch: false });
  const b = rt.conductGauntletStep(COMP, SPRINT, decision(), { ...SEAMS, run, dispatch: false });
  assert.notStrictEqual(a.gauntlet_run_id, b.gauntlet_run_id);
});

test("(5) record-inprocess --gauntlet-run X writes a record carrying X that verifyRecord accepts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ert-runbind-ledger-"));
  try {
    const evidence = path.join(dir, "evidence.json");
    fs.writeFileSync(evidence, JSON.stringify({ verdict: "pass" }));
    const root = path.resolve(__dirname, "..", "..");
    const env = { ...process.env, CLAUDE_PROJECT_DIR: root, DISPATCH_LEDGER_DIR: dir };
    delete env.MC_GAUNTLET_RUN_ID; delete env.WARPOS_GAUNTLET_RUN_ID;
    const r = spawnSync(process.execPath, [path.join(__dirname, "epsilon-runtime.js"), "record-inprocess", "--sprint", SPRINT, "--role", "quality-lead", "--step", "gauntlet", "--evidence", evidence, "--gauntlet-run", GX], { encoding: "utf8", env });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const line = fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split("\n").pop();
    const rec2 = JSON.parse(line);
    assert.strictEqual(rec2.gauntlet_run_id, GX);
    assert.strictEqual(verifyRecord(rec2), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("(6) record-inprocess --gauntlet-run non-conforming exits 2, nothing written", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ri-bad-"));
  try {
    const evidence = path.join(dir, "ev.txt");
    fs.writeFileSync(evidence, "evidence\n");
    for (const bad of ["g-1", "run-S-LEAN-01-1730000000000"]) {
      const r = spawnSync(process.execPath, [path.join(__dirname, "epsilon-runtime.js"), "record-inprocess", "--sprint", SPRINT, "--role", "quality-lead", "--step", "gauntlet", "--evidence", evidence, "--gauntlet-run", bad], { encoding: "utf8", env: { ...process.env, DISPATCH_LEDGER_DIR: dir } });
      assert.strictEqual(r.status, 2, bad);
      assert.ok(!fs.existsSync(path.join(dir, "dispatch-completions.jsonl")));
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});
