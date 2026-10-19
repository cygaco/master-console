#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
function resolveDefaultManifest() {
  const sprintsDir = path.join(ROOT, ".claude", "project", "sprint", "sprints");
  try {
    const ptr = fs.readFileSync(path.join(ROOT, ".claude", "project", "sprint", "current-sprint.yaml"), "utf8");
    const m = ptr.match(/(?:^|\n)\s*(?:id|sprint)\s*:\s*["']?([A-Za-z0-9][A-Za-z0-9-]*)/);
    if (m) return path.join(sprintsDir, m[1], "record-trust-gate.manifest.json");
  } catch { }
  return path.join(sprintsDir, "__no-current-sprint__", "record-trust-gate.manifest.json");
}
const DEFAULT_MANIFEST = resolveDefaultManifest();
const RECORD_TRUST_GATE = path.join(ROOT, "scripts", "checks", "record-trust-gate.js");

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

function collectFixtures(manifest) {
  const falsifiers = [];
  const companions = [];
  for (const s of manifest.surfaces || []) {
    for (const fx of s.falsifier_fixtures || []) if (!falsifiers.includes(fx)) falsifiers.push(fx);
    for (const pc of s.positive_companions || []) if (!companions.includes(pc)) companions.push(pc);
  }
  return { falsifiers, companions };
}

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
      `skipped === ${counts.skipped} (MUST be 0) — a skipped MUST-BLOCK falsifier is a fail-open: a deleted/renamed/mis-wired choke-point module makes its falsifier silently skip and read as green`,
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

function runFalsifierSuite(fixtureAbsPaths) {
  return spawnSync(process.execPath, ["--test", "--test-reporter", "tap", ...fixtureAbsPaths], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function runFalsifierFile(fixtureAbsPath) {
  return spawnSync(process.execPath, ["--test", "--test-reporter", "tap", fixtureAbsPath], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

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
  const runFile = opts.runFile || runFalsifierFile;

  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) return { code: 2, ok: false, error: loaded.error };

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

  const missing = fixtures.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length)
    return {
      code: 1,
      ok: false,
      violations: missing.map((m) => `enumerated fixture MISSING on disk: ${m}`),
      falsifiers,
      companions,
    };

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
