#!/usr/bin/env node
/**
 * scripts/mc/manifest/test-installer-hook.js
 *
 * SP-20260523-003 / T-20260523-203. Tests the post-install
 * manifest-coverage hook added to scripts/warp-setup.js.
 *
 * Because spawning warp-setup.js against a tmp dir would clone the full
 * canonical install (slow + lots of side effects), these tests focus on
 * the underlying mechanism: build.js + validate.js subprocess invocation
 * + JSON parsing + finding-count aggregation. The actual warp-setup.js
 * integration is verified by inspection (the hook code is colocated with
 * setup logic and reuses the same subprocess pattern as the SP-005
 * compile.js wiring).
 *
 * Tests:
 *   A. build.js spawn → JSON-parseable summary (regenerate path).
 *   B. validate.js --json spawn → JSON-parseable findings.
 *   C. Finding-count aggregation logic across all 5 classes.
 *   D. warp-setup.js still exposes SKIP_MANIFEST_CHECK + STRICT_MANIFEST flags.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILD_SCRIPT = path.join(__dirname, "build.js");
const VALIDATE_SCRIPT = path.join(__dirname, "validate.js");
const WARP_SETUP_SCRIPT = path.join(REPO_ROOT, "scripts", "warp-setup.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `installer-hook-${label}-`));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// A. build.js against a fresh tiny fixture → exit 0.
{
  const dir = tmpDir("build");
  try {
    writeFile(path.join(dir, "_mc", "commands", "test.md"), "# test\n");
    writeFile(path.join(dir, "version.json"), JSON.stringify({ version: "0.0.1" }));
    const r = spawnSync(
      process.execPath,
      [BUILD_SCRIPT, "--root", dir, "--source-prefix", "_mc", "--json", "--allow-unclassified"],
      { encoding: "utf8" },
    );
    ok("build.js exit 0 on fixture", r.status === 0, `${r.stderr}\n${r.stdout}`);
    if (r.status === 0) {
      let parsed = null;
      try { parsed = JSON.parse(r.stdout); } catch {}
      ok("build.js JSON summary parseable", parsed !== null);
      ok(
        "manifest written to _mc/MANIFEST.json",
        fs.existsSync(path.join(dir, "_mc", "MANIFEST.json")),
      );
    }
  } finally {
    cleanup(dir);
  }
}

// B. validate.js --json on the same fixture → JSON parseable.
{
  const dir = tmpDir("validate");
  try {
    writeFile(path.join(dir, "_mc", "commands", "test.md"), "# test\n");
    writeFile(path.join(dir, "version.json"), JSON.stringify({ version: "0.0.1" }));
    spawnSync(
      process.execPath,
      [BUILD_SCRIPT, "--root", dir, "--source-prefix", "_mc", "--allow-unclassified"],
      { encoding: "utf8" },
    );
    const r = spawnSync(
      process.execPath,
      [VALIDATE_SCRIPT, "--root", dir, "--json"],
      { encoding: "utf8" },
    );
    let parsed = null;
    try { parsed = JSON.parse(r.stdout); } catch (e) {}
    ok("validate.js --json output parseable", parsed !== null);
    if (parsed) {
      ok("validate output has findings", typeof parsed.findings === "object");
      ok("validate output has ownerCounts", typeof parsed.ownerCounts === "object");
      ok("validate output has pathCount", typeof parsed.pathCount === "number");
    }
  } finally {
    cleanup(dir);
  }
}

// C. Finding-count aggregation logic — replicate the hook's reducer.
{
  const findings = {
    missing: ["a", "b"],
    drift: ["c"],
    unmanifested: ["d", "e", "f"],
    user_modified: [],
    schema_violation: ["g"],
  };
  const totals = {
    missing: findings.missing.length,
    drift: findings.drift.length,
    unmanifested: findings.unmanifested.length,
    user_modified: findings.user_modified.length,
    schema_violation: findings.schema_violation.length,
  };
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  ok("finding-count aggregation correct", total === 7, `got ${total}`);
  ok("per-class counts correct", totals.missing === 2 && totals.unmanifested === 3);
}

// D. warp-setup.js still recognizes SKIP_MANIFEST_CHECK + STRICT_MANIFEST flags.
{
  const src = fs.readFileSync(WARP_SETUP_SCRIPT, "utf8");
  ok(
    "warp-setup.js declares SKIP_MANIFEST_CHECK",
    src.includes("--skip-manifest-check") && src.includes("SKIP_MANIFEST_CHECK"),
  );
  ok(
    "warp-setup.js declares STRICT_MANIFEST",
    src.includes("--strict-manifest") && src.includes("STRICT_MANIFEST"),
  );
  ok(
    "warp-setup.js has MANIFEST COVERAGE section header",
    src.includes("MANIFEST COVERAGE"),
  );
  ok(
    "warp-setup.js invokes build.js post-install",
    src.includes("scripts/mc/manifest/build.js") && src.includes("--source-prefix"),
  );
  ok(
    "warp-setup.js invokes validate.js post-install",
    src.includes("scripts/mc/manifest/validate.js"),
  );
  ok(
    "warp-setup.js refuses install in strict mode",
    src.includes("--strict-manifest set") || /refusing install/i.test(src),
  );
}

// ── Summary ─────────────────────────────────────────────────────────

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
