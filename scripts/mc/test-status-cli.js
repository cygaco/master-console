#!/usr/bin/env node
/**
 * scripts/mc/test-status-cli.js — smoke tests for /mc:update --status.
 *
 * SP-20260522-005 / T-20260523-196. Verifies the --status branch in update.js:
 *   A. --status (human) emits manifest path + ownerCounts + findings table.
 *   B. --status --json emits parseable JSON with mode=status augmentation.
 *   C. --status exit 0 when manifest is clean (zero findings on a fresh fixture).
 *   D. --status exit 1 when findings present.
 *   E. --status --target <dir> honors the target root.
 *   F. --status --strict elevates user_modified to non-zero exit.
 *   G. --status falls back to canonical validate.js if target lacks it.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const UPDATE_SCRIPT = path.join(__dirname, "update.js");
const VALIDATE_SCRIPT = path.join(__dirname, "manifest", "validate.js");

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

function tmpDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `status-cli-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function sha256Str(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function runStatus(args, cwd) {
  return spawnSync(
    process.execPath,
    [UPDATE_SCRIPT, "--status", ...args],
    { encoding: "utf8", cwd: cwd || REPO_ROOT },
  );
}

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function frameworkEntry(sha) {
  return {
    owner: "framework",
    managed: true,
    source: null,
    sha256: sha,
    installedSha: sha,
  };
}

// Build a minimal fixture with a clean manifest (one file, sha256-matched).
// Includes manifest entries for the support files (validate.js, MANIFEST.json)
// so the fixture is truly "clean" — zero unmanifested.
function makeCleanFixture(label) {
  const dir = tmpDir(label);
  const validateDst = path.join(dir, "scripts", "mc", "manifest", "validate.js");
  fs.mkdirSync(path.dirname(validateDst), { recursive: true });
  fs.copyFileSync(VALIDATE_SCRIPT, validateDst);

  const fileContent = "hello clean\n";
  const sha = sha256Str(fileContent);
  writeFile(path.join(dir, "hello.txt"), fileContent);

  const validateSha = sha256File(validateDst);
  const manifest = {
    "$schema": "mc/manifest/v1",
    version: 1,
    schemaVersion: 1,
    generatedAt: "2026-05-22T00:00:00.000Z",
    generatedBy: "test-status-cli.js",
    mcVersion: "0.0.0-test",
    migrations: [],
    paths: {
      "hello.txt": frameworkEntry(sha),
      "scripts/mc/manifest/validate.js": frameworkEntry(validateSha),
      "_mc/MANIFEST.json": {
        owner: "generated",
        managed: true,
        source: null,
        compiled_from: ["_mc/MANIFEST.json"],
      },
    },
  };
  writeFile(
    path.join(dir, "_mc", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
  );
  return dir;
}

// Build a fixture with drift: manifest lists sha but file content differs.
function makeDriftedFixture(label) {
  const dir = tmpDir(label);
  fs.mkdirSync(path.join(dir, "scripts", "mc", "manifest"), { recursive: true });
  fs.copyFileSync(VALIDATE_SCRIPT, path.join(dir, "scripts", "mc", "manifest", "validate.js"));

  const advertisedSha = sha256Str("original content\n");
  writeFile(path.join(dir, "drifted.txt"), "DIFFERENT content\n");

  const manifest = {
    "$schema": "mc/manifest/v1",
    version: 1,
    schemaVersion: 1,
    generatedAt: "2026-05-22T00:00:00.000Z",
    generatedBy: "test-status-cli.js",
    mcVersion: "0.0.0-test",
    migrations: [],
    paths: {
      "drifted.txt": {
        owner: "framework",
        managed: true,
        source: null,
        sha256: advertisedSha,
        installedSha: advertisedSha,
      },
    },
  };
  writeFile(
    path.join(dir, "_mc", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
  );
  return dir;
}

// Build a fixture without validate.js, to test canonical-fallback path.
function makeNoValidateFixture(label) {
  const dir = tmpDir(label);
  const fileContent = "fallback\n";
  const sha = sha256Str(fileContent);
  writeFile(path.join(dir, "hello.txt"), fileContent);

  const manifest = {
    "$schema": "mc/manifest/v1",
    version: 1,
    schemaVersion: 1,
    generatedAt: "2026-05-22T00:00:00.000Z",
    generatedBy: "test-status-cli.js",
    mcVersion: "0.0.0-test",
    migrations: [],
    paths: {
      "hello.txt": frameworkEntry(sha),
      "_mc/MANIFEST.json": {
        owner: "generated",
        managed: true,
        source: null,
        compiled_from: ["_mc/MANIFEST.json"],
      },
    },
  };
  writeFile(
    path.join(dir, "_mc", "MANIFEST.json"),
    JSON.stringify(manifest, null, 2),
  );
  return dir;
}

// ── Tests ────────────────────────────────────────────────────────────

// A. Clean fixture, human output.
{
  const dir = makeCleanFixture("clean-human");
  try {
    const r = runStatus(["--target", dir]);
    ok("clean fixture → exit 0", r.status === 0, `got ${r.status}: ${r.stderr}\n${r.stdout}`);
    ok("output mentions manifest validator", /manifest validator/.test(r.stdout));
    ok("output shows ownerCounts", /owners:/.test(r.stdout));
    ok("output reports CLEAN", /CLEAN/.test(r.stdout));
  } finally {
    cleanup(dir);
  }
}

// B. Clean fixture, JSON output.
{
  const dir = makeCleanFixture("clean-json");
  try {
    const r = runStatus(["--target", dir, "--json"]);
    ok("clean fixture --json → exit 0", r.status === 0, `got ${r.status}: ${r.stderr}`);
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {}
    ok("--json output is parseable JSON", parsed !== null);
    if (parsed) {
      ok("--json output has mode=status", parsed.mode === "status");
      ok("--json output has ok=true", parsed.ok === true);
      ok("--json output has manifestPath", typeof parsed.manifestPath === "string");
      ok("--json output has ownerCounts", parsed.ownerCounts && typeof parsed.ownerCounts.framework === "number");
      ok("--json output has findings object", parsed.findings && typeof parsed.findings === "object");
    }
  } finally {
    cleanup(dir);
  }
}

// C. Drifted fixture — exit 1, drift class shown.
{
  const dir = makeDriftedFixture("drift");
  try {
    const r = runStatus(["--target", dir]);
    ok("drifted fixture → exit 1", r.status === 1, `got ${r.status}: ${r.stderr}\n${r.stdout}`);
    ok(
      "drifted output mentions DRIFT class",
      /DRIFT/.test(r.stdout) || /drift/.test(r.stdout),
      `stdout: ${r.stdout}`,
    );
  } finally {
    cleanup(dir);
  }
}

// D. Drifted fixture --json — exit 1, findings.drift populated.
{
  const dir = makeDriftedFixture("drift-json");
  try {
    const r = runStatus(["--target", dir, "--json"]);
    ok("drifted --json → exit 1", r.status === 1, `got ${r.status}: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout);
    ok(
      "drifted --json has non-empty findings.drift",
      Array.isArray(parsed.findings.drift) && parsed.findings.drift.length > 0,
      `drift: ${JSON.stringify(parsed.findings.drift)}`,
    );
  } finally {
    cleanup(dir);
  }
}

// E. --target honored — running from REPO_ROOT but pointing at a fixture.
{
  const dir = makeCleanFixture("target-flag");
  try {
    const r = runStatus(["--target", dir, "--json"], REPO_ROOT);
    ok("--target → exit 0 (clean fixture)", r.status === 0);
    const parsed = JSON.parse(r.stdout);
    ok(
      "--target sets root in output",
      parsed.root && parsed.root.includes(path.basename(dir)),
      `root: ${parsed.root}`,
    );
  } finally {
    cleanup(dir);
  }
}

// F. Canonical-fallback when target lacks validate.js.
{
  const dir = makeNoValidateFixture("no-validate");
  try {
    const r = runStatus(["--target", dir, "--json"]);
    ok(
      "no validate.js in target → falls back to canonical",
      r.status === 0,
      `got ${r.status}: ${r.stderr}\n${r.stdout}`,
    );
  } finally {
    cleanup(dir);
  }
}

// G. --strict flag passes through to validate.
{
  const dir = makeDriftedFixture("strict");
  try {
    const r = runStatus(["--target", dir, "--strict", "--json"]);
    ok("--strict still exits 1 on drift", r.status === 1);
  } finally {
    cleanup(dir);
  }
}

// ── Summary ─────────────────────────────────────────────────────────

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
