#!/usr/bin/env node
/**
 * scripts/mc/views/test-regenerate.js — regenerator coverage.
 *
 * A. Canonical (live repo): everything self-referential; would_copy=0;
 *    failed=0; exits 0 in --check.
 * B. Product fixture: source on disk + dest absent → copy creates dest
 *    byte-identical; --check on the same state surfaces would_copy=1.
 * C. Stale dest: dest content differs from source → apply copies; --check
 *    exits 1.
 * D. Up-to-date dest: source sha == dest sha → unchanged; --check exits 0.
 * E. Source missing: manifest references a source that doesn't exist →
 *    skipped_source_missing; exits 0 (caller decides).
 * F. Non-framework owners are skipped (counted in skipped_non_framework).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const REGEN_PATH = path.join(__dirname, "regenerate.js");
const { regenerate } = require(REGEN_PATH);

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
  const dir = path.join(
    REPO_ROOT,
    ".mc",
    "test-regenerate-fixtures",
    name,
  );
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
    generatedBy: "test-regenerate.js",
    mcVersion: "0.0.0-test",
    migrations: [],
    paths,
  };
  const mPath = path.join(dir, "_mc", "MANIFEST.json");
  fs.mkdirSync(path.dirname(mPath), { recursive: true });
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2));
  return mPath;
}

// A. Canonical (live repo)
process.stdout.write("A. Canonical (live repo) — all self-referential\n");
{
  const r = regenerate({ root: REPO_ROOT, check: true });
  ok("regenerate returns ok", r.ok);
  ok("0 would_copy in canonical", r.summary.would_copy === 0);
  ok("0 failed in canonical", r.summary.failed === 0);
  ok("0 skipped_source_missing in canonical", r.summary.skipped_source_missing === 0);
  ok(
    "many skipped_self_reference",
    r.summary.skipped_self_reference > 100,
    `count=${r.summary.skipped_self_reference}`,
  );
  ok("--check exits 0 when clean", r.code === 0);
}

// B. Product fixture: source on disk + dest absent → copy creates dest
process.stdout.write("B. Product fixture: dest absent → copy\n");
{
  const fxDir = makeFixture("dest-absent");
  const srcPath = path.join(fxDir, "_mc", "commands", "hello.md");
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, "# hello\n");
  writeManifest(fxDir, {
    ".claude/commands/hello.md": {
      owner: "framework",
      managed: true,
      source: "_mc/commands/hello.md",
      sha256: sha256Str("# hello\n"),
    },
    "_mc/commands/hello.md": {
      owner: "framework",
      managed: true,
      source: "_mc/commands/hello.md",
      sha256: sha256Str("# hello\n"),
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const rCheck = regenerate({ root: fxDir, check: true });
  ok("check surfaces 1 would_copy", rCheck.summary.would_copy === 1);
  ok("check exits 1 (stale)", rCheck.code === 1);
  const r = regenerate({ root: fxDir, check: false });
  ok("apply copies 1 file", r.summary.copied === 1);
  ok("apply exits 0", r.code === 0);
  const destPath = path.join(fxDir, ".claude", "commands", "hello.md");
  ok("dest now exists", fs.existsSync(destPath));
  ok(
    "dest is byte-identical to source",
    fs.readFileSync(destPath, "utf8") === "# hello\n",
  );
  cleanup(fxDir);
}

// C. Stale dest: dest content differs → apply copies; --check exits 1
process.stdout.write("C. Stale dest → apply overwrites\n");
{
  const fxDir = makeFixture("stale-dest");
  const srcPath = path.join(fxDir, "_mc", "commands", "hello.md");
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, "# v2 source\n");
  const destPath = path.join(fxDir, ".claude", "commands", "hello.md");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, "# v1 stale\n");
  writeManifest(fxDir, {
    ".claude/commands/hello.md": {
      owner: "framework",
      managed: true,
      source: "_mc/commands/hello.md",
      sha256: sha256Str("# v2 source\n"),
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const rCheck = regenerate({ root: fxDir, check: true });
  ok("stale: --check exits 1", rCheck.code === 1);
  ok("stale: would_copy === 1", rCheck.summary.would_copy === 1);
  const r = regenerate({ root: fxDir });
  ok("apply: copied === 1", r.summary.copied === 1);
  ok(
    "dest now matches source",
    fs.readFileSync(destPath, "utf8") === "# v2 source\n",
  );
  cleanup(fxDir);
}

// D. Up-to-date dest: source sha == dest sha → unchanged
process.stdout.write("D. Up-to-date dest → unchanged\n");
{
  const fxDir = makeFixture("up-to-date");
  const content = "# stable\n";
  const srcPath = path.join(fxDir, "_mc", "commands", "hello.md");
  fs.mkdirSync(path.dirname(srcPath), { recursive: true });
  fs.writeFileSync(srcPath, content);
  const destPath = path.join(fxDir, ".claude", "commands", "hello.md");
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, content);
  writeManifest(fxDir, {
    ".claude/commands/hello.md": {
      owner: "framework",
      managed: true,
      source: "_mc/commands/hello.md",
      sha256: sha256Str(content),
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const r = regenerate({ root: fxDir });
  ok("unchanged === 1", r.summary.unchanged === 1);
  ok("copied === 0", r.summary.copied === 0);
  ok("exits 0", r.code === 0);
  const rCheck = regenerate({ root: fxDir, check: true });
  ok("--check exits 0", rCheck.code === 0);
  ok("--check would_copy === 0", rCheck.summary.would_copy === 0);
  cleanup(fxDir);
}

// E. Source missing
process.stdout.write("E. Source missing → skipped_source_missing\n");
{
  const fxDir = makeFixture("source-missing");
  writeManifest(fxDir, {
    ".claude/commands/ghost.md": {
      owner: "framework",
      managed: true,
      source: "_mc/commands/ghost.md",
      sha256: sha256Str("x\n"),
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const r = regenerate({ root: fxDir });
  ok("skipped_source_missing === 1", r.summary.skipped_source_missing === 1);
  ok("copied === 0", r.summary.copied === 0);
  ok("exits 0 (caller decides)", r.code === 0);
  cleanup(fxDir);
}

// F. Non-framework owners are skipped
process.stdout.write("F. Non-framework owners skipped\n");
{
  const fxDir = makeFixture("non-framework");
  writeManifest(fxDir, {
    ".claude/runtime/log.jsonl": {
      owner: "runtime",
      managed: false,
    },
    "_mc/MANIFEST.json": {
      owner: "generated",
      compiled_from: ["framework/"],
    },
  });
  const r = regenerate({ root: fxDir });
  ok(
    "skipped_non_framework >= 2",
    r.summary.skipped_non_framework >= 2,
    `count=${r.summary.skipped_non_framework}`,
  );
  ok("copied === 0", r.summary.copied === 0);
  cleanup(fxDir);
}

process.stdout.write(`\nResults: ${pass} passed, ${fail} failed.\n`);
if (fail > 0) process.exit(1);
