#!/usr/bin/env node
"use strict";

/**
 * SP-20260611-002 FIX1-G3a (finding 5) — coverage-gate-scan LIVE CLI external
 * expected-source wiring. Surface: scripts/checks/coverage-gate-scan.js CLI path.
 *
 * EXPLOIT FIXTURE — drives the REAL CLI (node coverage-gate-scan.js), NOT the
 * pure module seam (auditLedger() with injected expectedSource). The source-suite
 * (coverage-gate-scan-source.test.js) already proves the pure seam works; THIS
 * test proves the live CLI path resolves and passes the external source so that
 * production /scan catches the omitted-role slip, not only tests with injection.
 *
 * AC-5.3 finding 5 — the live CLI called auditLedger(records) with NO expectedSource,
 * so production /scan remained self-derived: a role that produced NO record was never
 * expected and its omission read clean. This fixture:
 *
 *   (A) REDs without the fix (self-derive path — no gap for the missing role), and
 *   (B) GREENs with the fix (external source resolves via --expected-source — the
 *       missing role is reported as a gap in the real CLI output).
 *
 * Mutation-verify: revert the live wiring (remove the expectedSource pass in main())
 * → case (B) REDs (the CLI no longer reports the gap).
 *
 *   node tests/regression/SP-20260611-002/coverage-gate-scan-live-cli.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const { harness } = require(path.join(ROOT, "scripts", "checks", "lib", "fixture-harness"));
const CLI = path.join(ROOT, "scripts", "checks", "coverage-gate-scan.js");
const { ARGV_SCHEMA_VERSION } = require(path.join(ROOT, "scripts", "dispatch", "dispatch-contract"));

const h = harness("SP-002-FIX1-G3a/coverage-gate-scan-live-cli");

const RUN_ID = "run-live-cli-exploit-g3a";
// A post-cutoff timestamp so legacy scoping does NOT exempt this run.
const TS_POST = "2026-06-11T14:00:00Z";

// A realistic BACKED dispatch-completions record (same shape as the source-suite uses).
function makeRecord(role, provider, over = {}) {
  return JSON.stringify({
    dispatch_id: `d-${role}-live`,
    cmdline_checksum: "sha256:deadbeef00001",
    run_id: RUN_ID,
    role,
    provider,
    ok: true,
    argv_schema_version: ARGV_SCHEMA_VERSION,
    output_digest: "sha256:feedface00000000000000000001",
    ts: TS_POST,
    ...over,
  });
}

/**
 * Run the REAL CLI via spawnSync. Returns { status, out, raw, stderr }.
 * `out` is the parsed JSON (or null if parse fails).
 */
function runCLI(ledgerPath, extraArgs = [], extraEnv = {}) {
  const r = spawnSync(
    process.execPath,
    [CLI, "--json", "--ledger", ledgerPath, ...extraArgs],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...extraEnv } },
  );
  let out = null;
  try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch { /* raw below */ }
  return { status: r.status, out, raw: r.stdout || "", stderr: r.stderr || "" };
}

function makeSealedSprintProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "mc-livecli-prod-"));
  fs.mkdirSync(path.join(project, ".claude", "agents", "_org"), { recursive: true });
  fs.mkdirSync(path.join(project, ".claude", "project", "sprint", "tickets"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".claude", "agents", "_org", "sprint-hook-points.json"),
    JSON.stringify({
      schema: "mc/sprint-hook-points/test",
      lifecycle: ["plan", "design", "build", "gauntlet", "release", "retro"],
      phase_map: { plan: "plan", design: "design", build: "execute", gauntlet: "execute", release: "release-prep", retro: "retro" },
      rows: [
        { role: "backend-builder", step: "build", condition: { unit_type: ["backend"] }, mode: "block", order: 10 },
        { role: "backend-reviewer", step: "gauntlet", condition: { unit_type: ["backend"] }, mode: "block", order: 20 },
        { role: "qa-reviewer", step: "gauntlet", condition: "always", mode: "block", order: 30 },
        { role: "security-reviewer", step: "gauntlet", condition: "always", mode: "block", order: 40 },
      ],
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(project, ".claude", "project", "sprint", "tickets", "T-FIX2.json"),
    JSON.stringify({ id: "T-FIX2", sprint: "SP-FIX2", unit_type: "backend", risk_level: "high" }),
    "utf8",
  );
  return project;
}

// ── Set up temp fixture files ────────────────────────────────────────────────
// These are reused across all test cases (setup is not teardown-sensitive for
// read-only temp files — they are named in OS temp and cleaned below).

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-livecli-g3a-"));

// Ledger: ONLY frontend-builder produced a record; security-reviewer is absent.
const LEDGER_PATH = path.join(tmpDir, "dispatch-completions.jsonl");
fs.writeFileSync(LEDGER_PATH, makeRecord("frontend-builder", "claude") + "\n", "utf8");

// Expected-source JSON: names BOTH roles the run was composed to require.
// Per-run map format — the same shape as what the composition / registry would supply.
const EXPECTED_SOURCE_PATH = path.join(tmpDir, "expected-source.json");
fs.writeFileSync(
  EXPECTED_SOURCE_PATH,
  JSON.stringify({ [RUN_ID]: ["frontend-builder", "security-reviewer"] }),
  "utf8",
);

// ── Test cases ───────────────────────────────────────────────────────────────

// EXPLOIT / RED path: without --expected-source, the LIVE CLI self-derives from
// the ledger — only frontend-builder is expected (it produced a record), so the
// missing security-reviewer is INVISIBLE. This is the bug the fix closes.
h.test("MUTATION-VERIFY — without --expected-source, the LIVE CLI self-derives and does NOT report the missing role (this is the bug that was fixed)", () => {
  const r = runCLI(LEDGER_PATH /* no --expected-source */);
  // Self-derive path: security-reviewer never expected → no gap → CLI says ok:true.
  assert.ok(r.out !== null, `CLI produced non-JSON output:\n${r.raw}\n${r.stderr}`);
  assert.strictEqual(
    r.out.ok, true,
    `Self-derive (no external source) should show ok:true (no gap) — if this fails, the self-derive changed:\n${JSON.stringify(r.out, null, 2)}`,
  );
  const gapCount = r.out.counts ? r.out.counts.gaps : null;
  assert.strictEqual(gapCount, 0,
    `Expected 0 gaps from self-derive, got ${gapCount}:\n${JSON.stringify(r.out, null, 2)}`,
  );
});

// EXPLOIT / GREEN path (after the fix): WITH --expected-source, the LIVE CLI
// resolves the external set, finds security-reviewer expected but absent, and
// reports a gap. This is the core assertion: the live CLI now catches the slip.
h.violation("LIVE CLI with --expected-source reports the gap for the omitted role (omitted-role slip caught in production /scan)", () => {
  const r = runCLI(LEDGER_PATH, ["--expected-source", EXPECTED_SOURCE_PATH]);
  // The gap is in the output — ok:false and counts.gaps > 0.
  // violation() checks that the result is NOT a pass (gap = !ok = not-pass → caught).
  return r.out || { ok: true }; // fallback to ok:true (=pass=false-green) if out is null
});

// Specificity: the violation names the missing role explicitly.
h.test("LIVE CLI gap output explicitly names security-reviewer as the missing role", () => {
  const r = runCLI(LEDGER_PATH, ["--expected-source", EXPECTED_SOURCE_PATH]);
  assert.ok(r.out !== null, `CLI produced non-JSON:\n${r.raw}\n${r.stderr}`);
  assert.strictEqual(r.out.ok, false,
    `Expected ok:false (gap) from LIVE CLI with external source:\n${JSON.stringify(r.out, null, 2)}`);
  const gapCount = r.out.counts ? r.out.counts.gaps : 0;
  assert.ok(gapCount > 0,
    `Expected counts.gaps > 0 from LIVE CLI with external source:\n${JSON.stringify(r.out, null, 2)}`);
  // The run's violation list must mention security-reviewer.
  const violationText = JSON.stringify(r.out.runs || []);
  assert.ok(
    /security-reviewer/.test(violationText),
    `Expected the violation to name security-reviewer; got runs:\n${violationText}`,
  );
});

// PRODUCTION SHAPE (FIX2): no manual --expected-source flag. The scanner must
// derive expected roles from sprint_id + phase_id in the ledger and the sealed
// sprint hook registry/tickets under CLAUDE_PROJECT_DIR. This is the exact gap the
// re-review caught: /scan:full invoked coverage-gate-scan.js with no flag.
h.test("FIX2 production /scan shape with no --expected-source still catches omitted hook-point roles", () => {
  const project = makeSealedSprintProject();
  const prodDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-livecli-prod-ledger-"));
  const ledger = path.join(prodDir, "prod.jsonl");
  fs.writeFileSync(
    ledger,
    makeRecord("backend-builder", "claude", {
      run_id: "run-prod-default-g3a",
      sprint_id: "SP-FIX2",
      phase_id: "execute",
      dispatch_id: "d-backend-builder-prod",
    }) + "\n",
    "utf8",
  );
  try {
    const r = runCLI(ledger, [], { CLAUDE_PROJECT_DIR: project });
    assert.ok(r.out !== null, `CLI produced non-JSON:\n${r.raw}\n${r.stderr}`);
    assert.strictEqual(r.out.ok, false, `expected production default source to report gaps:\n${JSON.stringify(r.out, null, 2)}`);
    const text = JSON.stringify(r.out.runs || []);
    assert.ok(/backend-reviewer/.test(text), `expected missing backend-reviewer in production default gaps:\n${text}`);
    assert.ok(/security-reviewer/.test(text), `expected missing security-reviewer in production default gaps:\n${text}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(prodDir, { recursive: true, force: true });
  }
});

h.pass("FIX2 production /scan shape with no --expected-source reports no gap when all block roles have records", () => {
  const project = makeSealedSprintProject();
  const prodDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-livecli-prod-clean-"));
  const ledger = path.join(prodDir, "prod-clean.jsonl");
  const base = { run_id: "run-prod-clean-g3a", sprint_id: "SP-FIX2", phase_id: "execute" };
  fs.writeFileSync(
    ledger,
    [
      makeRecord("backend-builder", "claude", { ...base, dispatch_id: "d-backend-builder-clean" }),
      makeRecord("backend-reviewer", "openai", { ...base, dispatch_id: "d-backend-reviewer-clean" }),
      makeRecord("qa-reviewer", "openai", { ...base, dispatch_id: "d-qa-reviewer-clean" }),
      makeRecord("security-reviewer", "openai", { ...base, dispatch_id: "d-security-reviewer-clean" }),
    ].join("\n") + "\n",
    "utf8",
  );
  try {
    const r = runCLI(ledger, [], { CLAUDE_PROJECT_DIR: project });
    return r.out || { ok: false };
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(prodDir, { recursive: true, force: true });
  }
});

// No false positive: when the ledger has records for BOTH roles, the live CLI
// with the same --expected-source reports ok:true (no gap).
h.pass("LIVE CLI with --expected-source reports no gap when BOTH expected roles have records", () => {
  const bothDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-livecli-g3a-both-"));
  const bothLedger = path.join(bothDir, "both.jsonl");
  fs.writeFileSync(
    bothLedger,
    makeRecord("frontend-builder", "claude") + "\n" + makeRecord("security-reviewer", "gemini") + "\n",
    "utf8",
  );
  try {
    const r = runCLI(bothLedger, ["--expected-source", EXPECTED_SOURCE_PATH]);
    return r.out || { ok: false };
  } finally {
    fs.rmSync(bothDir, { recursive: true, force: true });
  }
});

// FAIL-OPEN: a malformed (non-JSON) --expected-source file must NOT crash the CLI —
// it falls back to self-derive and exits 0 (the audit must never break /scan:full).
h.pass("LIVE CLI with a malformed --expected-source falls back to self-derive (fail-open, exit 0)", () => {
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-livecli-g3a-bad-"));
  const badSource = path.join(badDir, "bad.json");
  fs.writeFileSync(badSource, "not json {{{{ bad", "utf8");
  try {
    const r = runCLI(LEDGER_PATH, ["--expected-source", badSource]);
    // Fail-open: exit 0 (report-only mode, and unreadable source → self-derive fallback).
    return r.status === 0 ? { ok: true } : { ok: false };
  } finally {
    fs.rmSync(badDir, { recursive: true, force: true });
  }
});

// ── Cleanup and done ────────────────────────────────────────────────────────
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }

h.done();
