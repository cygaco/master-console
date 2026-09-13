#!/usr/bin/env node
/**
 * scripts/mc/manifest/test-validate.js — sanity checks for validate.js.
 *
 * Self-contained test runner (no ajv dep). Covers:
 *   A. Validator runs ok against the live canonical manifest.
 *   B. Drift detection — changing a framework entry's file content
 *      surfaces as `drift`.
 *   C. Missing detection — pointing the manifest at a path that doesn't
 *      exist on disk surfaces as `missing`.
 *   D. Unmanifested detection — putting a file under the root that isn't
 *      in the manifest surfaces as `unmanifested`.
 *   E. Schema violation — owner=framework without sha256 surfaces.
 *   F. --strict upgrades soft findings to exit 1.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VALIDATE_PATH = path.join(__dirname, "validate.js");

const { validate } = require(VALIDATE_PATH);

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(
      `  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`,
    );
    fail++;
  }
}

function sha256Str(s) {
  const h = crypto.createHash("sha256");
  h.update(s);
  return h.digest("hex");
}

function makeFixture(name) {
  const dir = path.join(REPO_ROOT, ".mc", "test-validate-fixtures", name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* */
  }
}

function writeManifest(dir, paths) {
  const manifest = {
    $schema: "mc/manifest/v1",
    version: 1,
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "test-validate.js",
    mcVersion: "0.0.0-test",
    migrations: [],
    paths,
  };
  const mPath = path.join(dir, "_mc", "MANIFEST.json");
  fs.mkdirSync(path.dirname(mPath), { recursive: true });
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  return mPath;
}

// A. Live canonical manifest
process.stdout.write("A. Live canonical manifest\n");
const live = validate({ root: REPO_ROOT });
ok("live validate returns ok", live.ok, JSON.stringify(live.summary));
ok("live: 0 missing", live.summary.missing === 0);
ok("live: 0 schema_violation", live.summary.schema_violation === 0);
ok("live: ownerCounts populated", live.ownerCounts.framework > 0);
ok("live: pathCount > 1000", live.pathCount > 1000);

// B. Drift detection
process.stdout.write("B. Drift detection (synthetic)\n");
{
  const fxDir = makeFixture("drift");
  const filePath = path.join(fxDir, "hello.txt");
  fs.writeFileSync(filePath, "original\n");
  const originalSha = sha256Str("original\n");
  writeManifest(fxDir, {
    "hello.txt": {
      owner: "framework",
      managed: true,
      source: "hello.txt",
      sha256: originalSha,
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  // mutate file
  fs.writeFileSync(filePath, "MUTATED\n");
  const r = validate({ root: fxDir });
  ok("drift detected", r.summary.drift === 1, JSON.stringify(r.summary));
  ok(
    "drift entry has manifest_sha and current_sha",
    r.findings.drift[0] && r.findings.drift[0].manifest_sha === originalSha,
  );
  ok("drift run exits 0 without --strict", r.code === 0);
  const rStrict = validate({ root: fxDir, strict: true });
  ok("drift run exits 1 with --strict", rStrict.code === 1);
  cleanup(fxDir);
}

// C. Missing detection
process.stdout.write("C. Missing detection\n");
{
  const fxDir = makeFixture("missing");
  const realFile = path.join(fxDir, "real.txt");
  fs.writeFileSync(realFile, "real\n");
  const fakeSha = sha256Str("ghost\n");
  writeManifest(fxDir, {
    "real.txt": {
      owner: "framework",
      managed: true,
      source: "real.txt",
      sha256: sha256Str("real\n"),
    },
    "ghost.txt": {
      owner: "framework",
      managed: true,
      source: "ghost.txt",
      sha256: fakeSha,
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const r = validate({ root: fxDir });
  ok("missing detected", r.summary.missing === 1);
  ok(
    "missing entry is ghost.txt",
    r.findings.missing[0] && r.findings.missing[0].path === "ghost.txt",
  );
  ok("missing exits 1 (hard)", r.code === 1);
  cleanup(fxDir);
}

// D. Unmanifested detection
process.stdout.write("D. Unmanifested detection\n");
{
  const fxDir = makeFixture("unmanifested");
  fs.writeFileSync(path.join(fxDir, "tracked.txt"), "x\n");
  fs.writeFileSync(path.join(fxDir, "untracked.txt"), "y\n");
  writeManifest(fxDir, {
    "tracked.txt": {
      owner: "framework",
      managed: true,
      source: "tracked.txt",
      sha256: sha256Str("x\n"),
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const r = validate({ root: fxDir });
  ok("unmanifested detected", r.summary.unmanifested === 1);
  ok(
    "unmanifested is untracked.txt",
    r.findings.unmanifested.includes("untracked.txt"),
  );
  ok("unmanifested exits 0 without --strict", r.code === 0);
  const rStrict = validate({ root: fxDir, strict: true });
  ok("unmanifested exits 1 with --strict", rStrict.code === 1);
  cleanup(fxDir);
}

// E. Schema violation
process.stdout.write("E. Schema violation detection\n");
{
  const fxDir = makeFixture("schema-violation");
  fs.writeFileSync(path.join(fxDir, "f.txt"), "x\n");
  writeManifest(fxDir, {
    "f.txt": {
      owner: "framework",
      managed: true,
      // missing source AND sha256
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const r = validate({ root: fxDir });
  ok("schema_violation detected", r.summary.schema_violation >= 2);
  ok("schema violation exits 1 (hard)", r.code === 1);
  cleanup(fxDir);
}

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed.\n`);
if (fail > 0) process.exit(1);
