"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
mcEnv.setEnv(
  "ATTEST_SECRET_FILE",
  path.join(os.tmpdir(), `gv-runbind-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`),
);
const { test } = require("node:test");
const assert = require("node:assert");
const { verifyGauntlet } = require("./gauntlet-verify");
const { signRecord } = require("./attest-signing");

const G1 = "g-" + "1".repeat(32);
const GO = "g-" + "a".repeat(32);
const GE = "g-" + "e".repeat(32);
const GF = "g-" + "f".repeat(32);
const NOW = new Date();
const SINCE = NOW.getTime() - 60_000;
const ROLE = "security-reviewer";
const SPRINT = "SP-20261031-001";

function rec(overrides = {}) {
  return {
    role: ROLE, ok: true, provider: "openai", model: "gpt-5.5",
    completed_at: NOW.toISOString(), tool_id: "codex", cmdline_checksum: "abc123",
    sprint_id: SPRINT, ...overrides,
  };
}
function signed(o = {}) { const r = rec(o); r.attest_sig = signRecord(r); return r; }
const base = { roles: [ROLE], since: SINCE, sprintId: SPRINT, requireSignature: true };
const status = (res) => res.roles[0].status;

test("(1) signed foreign-sprint in-window record -> no-record", () => {
  const res = verifyGauntlet({ ...base, gauntletRunId: G1, records: [signed({ sprint_id: "SP-OTHER", gauntlet_run_id: G1 })] });
  assert.strictEqual(status(res), "no-record");
  assert.strictEqual(res.ok, false);
});

test("(2) unsigned well-formed ok:true + requireSignature -> unsigned, ok:false", () => {
  const res = verifyGauntlet({ ...base, records: [rec({ gauntlet_run_id: G1 })] });
  assert.strictEqual(status(res), "unsigned");
  assert.strictEqual(res.ok, false);
});

test("(3) same-sprint signed records with another run id / none -> no-record, foreignRunExcluded === 2", () => {
  const res = verifyGauntlet({ ...base, gauntletRunId: G1, records: [signed({ gauntlet_run_id: GO }), signed()] });
  assert.strictEqual(status(res), "no-record");
  assert.strictEqual(res.foreignRunExcluded, 2);
  assert.strictEqual(res.gauntletRunId, G1);
  assert.strictEqual(res.ok, false);
});

test("(4) matching signed id -> ran", () => {
  const res = verifyGauntlet({ ...base, gauntletRunId: G1, records: [signed({ gauntlet_run_id: GO }), signed({ gauntlet_run_id: G1 })] });
  assert.strictEqual(status(res), "ran");
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.foreignRunExcluded, 1);
});

test("(5) gauntlet_run_id edited after signing -> unsigned (field is inside the signature)", () => {
  const r = signed({ gauntlet_run_id: GO });
  r.gauntlet_run_id = G1;
  const res = verifyGauntlet({ ...base, gauntletRunId: G1, records: [r] });
  assert.strictEqual(status(res), "unsigned");
  assert.strictEqual(res.ok, false);
});

test("(6) gauntletRunId without requireSignature === true THROWS", () => {
  assert.throws(() => verifyGauntlet({ roles: [ROLE], since: SINCE, gauntletRunId: G1, records: [rec()] }), /requireSignature/);
  assert.throws(() => verifyGauntlet({ roles: [ROLE], since: SINCE, gauntletRunId: G1, requireSignature: false, records: [rec()] }), /requireSignature/);
});

test("(6b) no gauntletRunId -> behaviour unchanged, no run-binding keys on result", () => {
  const res = verifyGauntlet({ ...base, records: [signed()] });
  assert.strictEqual(status(res), "ran");
  assert.ok(!("gauntletRunId" in res) && !("foreignRunExcluded" in res));
});

test("(7) recordCompletion stamps from env and flags a conflicting caller value", () => {
  const { recordCompletion } = require("../dispatch-agent");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ledger-"));
  const savedDir = process.env.DISPATCH_LEDGER_DIR;
  const snap = mcEnv.snapshotEnv("GAUNTLET_RUN_ID");
  process.env.DISPATCH_LEDGER_DIR = dir;
  const read = () => fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  try {
    mcEnv.setEnv("GAUNTLET_RUN_ID", GE);
    recordCompletion({ role: ROLE, provider: "openai", ok: true, output_digest: "d" });
    recordCompletion({ role: ROLE, provider: "openai", ok: true, output_digest: "d", gauntlet_run_id: GF });
    mcEnv.unsetEnv("GAUNTLET_RUN_ID");
    recordCompletion({ role: ROLE, provider: "openai", ok: true, output_digest: "d" });
    const [a, b, c] = read();
    assert.strictEqual(a.gauntlet_run_id, GE);
    assert.ok(a.attest_sig, "env-stamped record is signed");
    assert.strictEqual(b.provenance_mismatch, true);
    assert.ok(!b.attest_sig, "conflicting caller value -> written UNSIGNED");
    assert.strictEqual(c.gauntlet_run_id, null);
  } finally {
    if (savedDir === undefined) delete process.env.DISPATCH_LEDGER_DIR; else process.env.DISPATCH_LEDGER_DIR = savedDir;
    mcEnv.restoreEnv(snap);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

test("(8) CLI --gauntlet-run exits 1 on foreign/none, 0 on match", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-cli-"));
  const cli = path.join(__dirname, "gauntlet-verify.js");
  const run = (records, id) => {
    const f = path.join(dir, `l-${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return spawnSync(process.execPath, [cli, "--roles", ROLE, "--sprint", SPRINT, "--since", String(SINCE), "--gauntlet-run", id, "--completions", f, "--json"], { encoding: "utf8", env: process.env });
  };
  try {
    assert.strictEqual(run([signed({ gauntlet_run_id: GO }), signed()], G1).status, 1);
    assert.strictEqual(run([signed({ gauntlet_run_id: G1 })], G1).status, 0);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

test("(9) bound verify keeps malformed-line taint (foreign records before it must not narrow the span)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-taint-"));
  try {
    const f = path.join(dir, "l.jsonl");
    const lines = [
      JSON.stringify(signed({ gauntlet_run_id: GO })),
      "{MALFORMED",
      JSON.stringify(signed({ gauntlet_run_id: GO })),
      JSON.stringify(signed({ gauntlet_run_id: GO })),
      JSON.stringify(signed({ gauntlet_run_id: G1 })),
    ];
    fs.writeFileSync(f, lines.join("\n") + "\n");
    const unbound = verifyGauntlet({ ...base, completionsFile: f });
    const bound = verifyGauntlet({ ...base, completionsFile: f, gauntletRunId: G1 });
    assert.strictEqual(unbound.ok, false);
    assert.strictEqual(unbound.malformedTainted, true);
    assert.strictEqual(bound.malformedTainted, true);
    assert.strictEqual(bound.ok, false);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

test("(10) empty/whitespace gauntletRunId THROWS; undefined stays unbound", () => {
  assert.throws(() => verifyGauntlet({ ...base, gauntletRunId: "", records: [] }), /empty/);
  assert.throws(() => verifyGauntlet({ ...base, gauntletRunId: "   ", records: [] }), /empty/);
  assert.doesNotThrow(() => verifyGauntlet({ ...base, records: [] }));
});

test("(10a) a non-string/falsy gauntletRunId (false, 0, NaN, {}) THROWS — never silently null/unbound", () => {
  for (const bad of [false, 0, NaN, {}]) {
    assert.throws(
      () => verifyGauntlet({ ...base, gauntletRunId: bad, records: [] }),
      /not a string|UNBOUND/,
      `gauntletRunId: ${String(bad)} must THROW (explicit refusal), never run an unbound verify`,
    );
  }
  assert.doesNotThrow(() => verifyGauntlet({ ...base, gauntletRunId: undefined, records: [] }));
  assert.doesNotThrow(() => verifyGauntlet({ ...base, gauntletRunId: null, records: [] }));
});

test("(11) CLI --gauntlet-run bare/empty/whitespace exits 2", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-cli2-"));
  const cli = path.join(__dirname, "gauntlet-verify.js");
  try {
    const f = path.join(dir, "l.jsonl");
    fs.writeFileSync(f, JSON.stringify(signed({ gauntlet_run_id: G1 })) + "\n");
    const common = ["--roles", ROLE, "--sprint", SPRINT, "--since", String(SINCE), "--completions", f, "--json"];
    const run = (extra) => spawnSync(process.execPath, [cli, ...common, ...extra], { encoding: "utf8", env: process.env });
    assert.strictEqual(run(["--gauntlet-run"]).status, 2);
    assert.strictEqual(run(["--gauntlet-run", ""]).status, 2);
    assert.strictEqual(run(["--gauntlet-run", "  "]).status, 2);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

const { isValidGauntletRunId } = require("./attest-signing");

test("(12) isValidGauntletRunId: only g-<32 lowercase hex>", () => {
  assert.strictEqual(isValidGauntletRunId(G1), true);
  for (const bad of ["", "g-1", "g-OTHER", "run-S-LEAN-01-1730000000000", "g-S-LEAN-01-lq2x9k1a-0123456789ab", "g-" + "A".repeat(32), "g-" + "1".repeat(31), "g-" + "1".repeat(33), G1 + "\n", null, undefined, 5]) {
    assert.strictEqual(isValidGauntletRunId(bad), false, String(bad));
  }
});

test("(13) verifier THROWS on a non-conforming gauntletRunId", () => {
  for (const bad of ["g-1", "run-S-LEAN-01-1730000000000", "g-S-LEAN-01-lq2x9k1a-0123456789ab"]) {
    assert.throws(() => verifyGauntlet({ ...base, gauntletRunId: bad, records: [] }), /conforming run id/);
  }
});

test("(14) SEEDED REDs (real verifier, signed records): absent / foreign well-formed / timestamp-shaped -> no-record; control -> ran", () => {
  const cases = {
    absent: signed(),
    foreignWellFormed: signed({ gauntlet_run_id: GO }),
    timestampRun: signed({ gauntlet_run_id: "run-S-LEAN-01-1730000000000" }),
    oldShape: signed({ gauntlet_run_id: "g-S-LEAN-01-lq2x9k1a-0123456789ab" }),
  };
  for (const [name, r] of Object.entries(cases)) {
    const res = verifyGauntlet({ ...base, gauntletRunId: G1, records: [r] });
    assert.strictEqual(status(res), "no-record", name);
    assert.strictEqual(res.ok, false, name);
  }
  const ctl = verifyGauntlet({ ...base, gauntletRunId: G1, records: [signed({ gauntlet_run_id: G1 })] });
  assert.strictEqual(status(ctl), "ran");
  assert.strictEqual(ctl.ok, true);
});

test("(15) writer does not stamp a non-conforming env id and flags it like a provenance mismatch", () => {
  const { recordCompletion } = require("../dispatch-agent");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-ledger-"));
  const savedDir = process.env.DISPATCH_LEDGER_DIR;
  const snap = mcEnv.snapshotEnv("GAUNTLET_RUN_ID");
  process.env.DISPATCH_LEDGER_DIR = dir;
  try {
    mcEnv.setEnv("GAUNTLET_RUN_ID", "run-S-LEAN-01-1730000000000");
    recordCompletion({ role: ROLE, provider: "openai", ok: true, output_digest: "d" });
    const [a] = fs.readFileSync(path.join(dir, "dispatch-completions.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.strictEqual(a.gauntlet_run_id, null);
    assert.strictEqual(a.provenance_mismatch, true);
    assert.ok(!a.attest_sig, "written UNSIGNED");
  } finally {
    if (savedDir === undefined) delete process.env.DISPATCH_LEDGER_DIR; else process.env.DISPATCH_LEDGER_DIR = savedDir;
    mcEnv.restoreEnv(snap);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});

test("(16) CLI verify --gauntlet-run non-conforming exits non-zero (throws before verifying)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gv-cli3-"));
  const cli = path.join(__dirname, "gauntlet-verify.js");
  try {
    const f = path.join(dir, "l.jsonl");
    fs.writeFileSync(f, JSON.stringify(signed({ gauntlet_run_id: "g-1" })) + "\n");
    const r = spawnSync(process.execPath, [cli, "--roles", ROLE, "--sprint", SPRINT, "--since", String(SINCE), "--completions", f, "--gauntlet-run", "g-1", "--json"], { encoding: "utf8", env: process.env });
    assert.notStrictEqual(r.status, 0);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
  }
});
