#!/usr/bin/env node
"use strict";

/**
 * falsifier-liveness.js — the AC-18 GAUNTLET exit gate (SP-20260718-005).
 *
 * THE FAIL-OPEN LOOPHOLE THIS CLOSES: the record-trust falsifiers (AC-F1..F12) are written to
 * `t.skip(...)` when their target choke-point module is absent — that is CORRECT at design-exit
 * (RED-until-built). But at the GAUNTLET it is a fail-open: a deleted / renamed / mis-wired
 * choke-point module makes its falsifier SILENTLY SKIP, and a skipped MUST-BLOCK test reads as
 * green. "8 falsifiers, 4 skipped, 0 failed" is NOT a pass — it is four un-guarded irreversible
 * actions. This gate asserts the falsifier suite actually EXECUTED end-to-end.
 *
 * WHAT IT ASSERTS (AC-18):
 *   (a) EXACTLY the enumerated F1..F12 falsifiers EXECUTED with `skipped === 0` — every MUST-BLOCK
 *       actually ran (a skip = a mis-wired/absent choke-point module = fail-open → BLOCK).
 *   (b) every reject-falsifier's POSITIVE COMPANION ran and PASSED — a constant-false stub
 *       (`authorizesIntegration = () => false`) passes the reject-only corpus while authorizing
 *       NOTHING; the positive companion (a valid record DOES authorize) defeats it.
 *   (c) `record-trust-gate.js --built` passes — every named choke-point MODULE exists on disk.
 *
 * The fixture set is DERIVED from the record-trust-gate manifest (the single source of truth the
 * design->build gate already enforces), never hardcoded — adding a falsifier row to the manifest
 * extends this gate automatically. A fixture file the manifest names but that is ABSENT is a BLOCK
 * (fail-closed), as is any un-parseable test summary (never certify liveness on ambiguous output).
 *
 * Exit: 0 = liveness proven · 1 = BLOCK (a skip / fail / missing fixture / --built red) ·
 *       2 = usage / manifest unreadable / harness error (fail-closed — an infra failure is NEVER green).
 *
 *   node scripts/checks/falsifier-liveness.js [--manifest <path>] [--json]
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const DEFAULT_MANIFEST = path.join(
  ROOT,
  ".claude",
  "project",
  "sprint",
  "sprints",
  "SP-20260718-005",
  "record-trust-gate.manifest.json",
);
const RECORD_TRUST_GATE = path.join(ROOT, "scripts", "checks", "record-trust-gate.js");

/** Load + parse the record-trust manifest. Fail-closed: a missing/malformed manifest is a hard error. */
function loadManifest(manifestPath) {
  let text;
  try {
    text = fs.readFileSync(manifestPath, "utf8");
  } catch (e) {
    return { ok: false, error: `manifest unreadable: ${e.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    return { ok: false, error: `manifest not valid JSON: ${e.message}` };
  }
  if (!parsed || !Array.isArray(parsed.surfaces)) {
    return { ok: false, error: "manifest missing 'surfaces' array (fail-closed)" };
  }
  return { ok: true, manifest: parsed };
}

/**
 * Collect the falsifier fixtures + positive companions the manifest enumerates, de-duplicated and
 * in a stable order. This is the EXACT set the liveness run must execute — derived, not hardcoded.
 */
function collectFixtures(manifest) {
  const falsifiers = [];
  const companions = [];
  for (const s of manifest.surfaces || []) {
    for (const fx of s.falsifier_fixtures || []) if (!falsifiers.includes(fx)) falsifiers.push(fx);
    for (const pc of s.positive_companions || []) if (!companions.includes(pc)) companions.push(pc);
  }
  return { falsifiers, companions };
}

/**
 * Parse the node:test TAP summary counts from stdout. Returns null (→ fail-closed at the caller)
 * if any required count line is absent — an un-parseable summary must never certify liveness.
 */
function parseTapCounts(stdout) {
  const grab = (key) => {
    const m = new RegExp(`^#\\s*${key}\\s+(\\d+)\\s*$`, "m").exec(String(stdout || ""));
    return m ? parseInt(m[1], 10) : null;
  };
  const tests = grab("tests");
  const pass = grab("pass");
  const fail = grab("fail");
  const skipped = grab("skipped");
  if (tests === null || pass === null || fail === null || skipped === null) return null;
  return { tests, pass, fail, skipped };
}

/**
 * PURE evaluation of the liveness counts against the enumerated fixture set. `expectedFileCount` =
 * the number of test files that were handed to the runner (every one must contribute >=1 executed
 * test). Returns { ok, violations[] }. Fail-closed on null counts (un-parseable summary).
 */
function evaluateCounts(counts, expectedFileCount) {
  const violations = [];
  if (!counts) {
    return {
      ok: false,
      violations: [
        "node:test summary counts un-parseable (fail-closed — cannot certify liveness on ambiguous runner output)",
      ],
    };
  }
  if (counts.skipped !== 0)
    violations.push(
      `skipped === ${counts.skipped} (MUST be 0) — a skipped MUST-BLOCK falsifier is the AC-18 fail-open: a deleted/renamed/mis-wired choke-point module makes its falsifier silently skip and read as green`,
    );
  if (counts.fail !== 0)
    violations.push(`fail === ${counts.fail} (MUST be 0) — a falsifier FAILED: a MUST-BLOCK path did not block`);
  if (counts.tests < expectedFileCount)
    violations.push(
      `only ${counts.tests} tests executed but ${expectedFileCount} fixture files were enumerated — a falsifier/companion file did not run (missing or errored on load)`,
    );
  if (counts.pass !== counts.tests)
    violations.push(
      `pass (${counts.pass}) !== tests (${counts.tests}) — not every executed falsifier/companion passed (skips/failures unaccounted)`,
    );
  return { ok: violations.length === 0, violations };
}

/** Run the enumerated fixtures under node:test with the TAP reporter. Returns the spawn result. */
function runFalsifierSuite(fixtureAbsPaths) {
  return spawnSync(process.execPath, ["--test", "--test-reporter", "tap", ...fixtureAbsPaths], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Run ONE fixture file under node:test/TAP. Per-file execution is what proves EACH falsifier ran
 *  (H1 gauntlet fix — an aggregate count cannot tell a 0-test file from a 2-test file). */
function runFalsifierFile(fixtureAbsPath) {
  return spawnSync(process.execPath, ["--test", "--test-reporter", "tap", fixtureAbsPath], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/**
 * PER-FILE liveness assertion (H1 gauntlet fix): one enumerated fixture file must have EXECUTED — >=1
 * test, 0 skipped, 0 fail, all-pass. A file that ran ZERO tests (deleted body, load error swallowed,
 * an empty describe) would be invisible in an aggregate `tests >= fileCount` check when a SIBLING file
 * ran extra tests. Returns a violations[] for this file (empty = the file proved live).
 */
function evaluateFileCounts(fileRel, counts) {
  const v = [];
  if (!counts) {
    v.push(`${fileRel}: node:test summary un-parseable (fail-closed — cannot certify this file executed)`);
    return v;
  }
  if (counts.tests < 1)
    v.push(`${fileRel}: ZERO tests executed — a falsifier file that runs nothing is a fail-open the aggregate count would mask`);
  if (counts.skipped !== 0)
    v.push(`${fileRel}: skipped=${counts.skipped} (a MUST-BLOCK falsifier skipped — a mis-wired/absent choke-point module reads as green)`);
  if (counts.fail !== 0) v.push(`${fileRel}: fail=${counts.fail} (a falsifier FAILED — a MUST-BLOCK path did not block)`);
  if (counts.pass !== counts.tests)
    v.push(`${fileRel}: pass(${counts.pass}) !== tests(${counts.tests}) — not every executed test in this file passed`);
  return v;
}

/** Run `record-trust-gate.js --built` and return { ok, detail }. Fail-closed if it can't run. */
function runRecordTrustGateBuilt(manifestPath) {
  if (!fs.existsSync(RECORD_TRUST_GATE))
    return { ok: false, detail: `record-trust-gate.js missing at ${RECORD_TRUST_GATE} (fail-closed)` };
  const r = spawnSync(process.execPath, [RECORD_TRUST_GATE, "--manifest", manifestPath, "--built"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) return { ok: false, detail: `record-trust-gate --built failed to run: ${r.error.message}` };
  const detail = (r.stdout || r.stderr || "").trim().split("\n").pop() || `exit ${r.status}`;
  return { ok: r.status === 0, detail };
}

function evaluate(manifestPath, opts = {}) {
  // H1 gauntlet fix: run EACH fixture file individually and prove it executed. `opts.runFile(absPath)`
  // is the injectable seam (defaults to a real per-file node:test run); tests drive it deterministically.
  const runFile = opts.runFile || runFalsifierFile;

  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) return { code: 2, ok: false, error: loaded.error };

  // record-trust-gate --built applies ONLY to a record-trust manifest; other falsifier manifests
  // (e.g. the Seam-E fence suite, schema mc/fence-falsifier-suite) reuse the per-file liveness
  // CORE (presence + per-file execution + skipped===0/fail===0) WITHOUT the record-trust --built step.
  const isRecordTrust = /record-trust-gate/.test(loaded.manifest.schema || "");
  const runBuilt =
    opts.runBuilt ||
    (isRecordTrust
      ? () => runRecordTrustGateBuilt(manifestPath)
      : () => ({ ok: true, detail: "non-record-trust manifest — record-trust-gate --built not applicable" }));

  const { falsifiers, companions } = collectFixtures(loaded.manifest);
  const fixtures = [...falsifiers, ...companions];
  if (fixtures.length === 0)
    return { code: 2, ok: false, error: "manifest enumerates ZERO falsifier fixtures (fail-closed — nothing to prove live)" };

  // Fail-closed presence check BEFORE running: a fixture the manifest names but that is absent is a
  // BLOCK, not a silent under-count (defense-in-depth with record-trust-gate's own presence check).
  const missing = fixtures.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length)
    return {
      code: 1,
      ok: false,
      violations: missing.map((m) => `enumerated fixture MISSING on disk: ${m}`),
      falsifiers,
      companions,
    };

  // PER-FILE execution proof — the H1 fix. Each file must run >=1 test with 0 skipped/0 fail, so a
  // 0-test file can never be masked by a sibling that ran extra tests.
  const violations = [];
  const perFile = [];
  let totalTests = 0;
  for (const f of fixtures) {
    const res = runFile(path.join(ROOT, f));
    if (!res || res.error) {
      violations.push(`${f}: node:test failed to run (fail-closed): ${(res && res.error && res.error.message) || "no result"}`);
      perFile.push({ file: f, counts: null });
      continue;
    }
    const counts = parseTapCounts(res.stdout);
    perFile.push({ file: f, counts });
    if (counts && typeof counts.tests === "number") totalTests += counts.tests;
    violations.push(...evaluateFileCounts(f, counts));
  }

  const built = runBuilt();
  if (!built.ok) violations.push(`record-trust-gate --built: ${built.detail}`);

  return {
    code: violations.length === 0 ? 0 : 1,
    ok: violations.length === 0,
    counts: { tests: totalTests, files: fixtures.length },
    perFile,
    falsifiers,
    companions,
    built,
    violations,
  };
}

function main(argv) {
  const json = argv.includes("--json");
  const mi = argv.indexOf("--manifest");
  const manifestPath = mi !== -1 && argv[mi + 1] ? path.resolve(argv[mi + 1]) : DEFAULT_MANIFEST;

  const res = evaluate(manifestPath);

  if (json) {
    process.stdout.write(JSON.stringify({ manifest: manifestPath, ...res }, null, 2) + "\n");
    return res.code;
  }

  if (res.code === 2) {
    process.stderr.write(`falsifier-liveness: ERROR (fail-closed) — ${res.error}\n`);
    return 2;
  }
  if (res.ok) {
    process.stdout.write(
      `falsifier-liveness: PASS — ${res.falsifiers.length} falsifiers + ${res.companions.length} positive companion(s) each EXECUTED PER-FILE ` +
        `(>=1 test, 0 skipped, 0 fail); ${res.counts.files} files, ${res.counts.tests} tests total; ${(res.built && res.built.detail) || "record-trust-gate --built green"}.\n`,
    );
    return 0;
  }
  process.stdout.write(`falsifier-liveness: BLOCK — ${res.violations.length} violation(s):\n`);
  for (const v of res.violations) process.stdout.write(`  - ${v}\n`);
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  loadManifest,
  collectFixtures,
  parseTapCounts,
  evaluateCounts,
  evaluateFileCounts,
  runFalsifierSuite,
  runFalsifierFile,
  runRecordTrustGateBuilt,
  evaluate,
  DEFAULT_MANIFEST,
};
