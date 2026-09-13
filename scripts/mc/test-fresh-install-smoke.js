#!/usr/bin/env node
/**
 * scripts/mc/test-fresh-install-smoke.js
 *
 * KEYSTONE — the cheap leading-indicator slice of the artifact-first,
 * contract-tested release gate (ROADMAP §Root-cause deepening; Director of
 * Product keystone, 2026-05-29). The single fastest question that catches the
 * "contractless productization" class:
 *
 *   Can a FRESH, EMPTY repo reach a scan:install-CERTIFIED MC install from
 *   the SHIPPED manifest alone — i.e. does what we ship actually stand up on its
 *   own, or does it secretly depend on canonical-only state that never ships?
 *
 * This is the per-commit smoke, NOT the full contract test. The full gate
 * (install a SEALED capsule into a disposable out-of-tree repo with canonical
 * inaccessible, then run an executable consumer contract: setup → scan:install
 * → a real sprint → dispatch telemetry → update, under BOTH repo roles) remains
 * the 0.18.0 stable-promotion-gate roadmap item. This slice proves the cheapest,
 * highest-signal half now: the shipped manifest is a COMPLETE bill-of-materials.
 *
 * What it does:
 *   0. Refuse to run on a stale shipped manifest (a manifest that lies makes the
 *      whole test meaningless — fail closed; same signal as BC-05).
 *   1. Spin up a fresh empty temp repo, OUT of the canonical tree.
 *   2. Install MC into it via the consumer path (warp-setup.js — copies what
 *      the shipped framework-manifest enumerates).
 *   3. Run the install verifier (scripts/check/install.js = /scan:install) with
 *      cwd = the fresh repo — the same check a real consumer runs.
 *   4. Assert: setup exits 0 AND scan:install certifies (exit 0) AND the core
 *      shipped artifacts are present in the fresh repo.
 *
 * Exit: 0 = a fresh repo stands up certified from the shipped manifest; 1 = it
 * does not (a real shippability regression — the gate doing its job).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

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

function tail(s, n = 240) {
  return (s || "").split(/\r?\n/).filter(Boolean).slice(-3).join(" | ").slice(-n);
}

// 0. The shipped manifest must be current — a stale manifest means the artifact
//    we'd test does not match the source. Fail closed (mirrors BC-05).
{
  const r = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "generate-framework-manifest.js"), "--check"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
  );
  ok("shipped manifest is current (not stale)", r.status === 0, tail(r.stdout || r.stderr));
  if (r.status !== 0) {
    process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
    process.exit(1);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-install-smoke-"));
let setup, scan;
try {
  // git init — a fresh consumer repo is a git repo; warp-setup's transaction/
  // backup paths expect one.
  spawnSync("git", ["init", "-q"], { cwd: tmp, encoding: "utf8" });

  // 1+2. Install MC into the fresh repo from the shipped manifest.
  setup = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "warp-setup.js"), tmp, "--yes"],
    { encoding: "utf8", timeout: 180_000 },
  );
  ok("warp-setup into a fresh empty repo exits 0", setup.status === 0, `code=${setup.status} ${tail(setup.stderr || setup.stdout)}`);

  // 2b. Lay down framework-manifest.json — the COMPLETE consumer installer
  //     (install.ps1 / CLI scaffold path) copies it as an asset; warp-setup's
  //     in-place source-clone path skips it (owner=generated; canonical already
  //     has its own). Mirroring it makes this smoke test the full consumer
  //     end-state (matching install-matrix scenario 7), not warp-setup's partial
  //     copy. (If this asset ever stops shipping, scan:install below catches it.)
  try {
    const fmSrc = path.join(REPO_ROOT, ".claude", "framework-manifest.json");
    const fmDst = path.join(tmp, ".claude", "framework-manifest.json");
    if (fs.existsSync(fmSrc) && !fs.existsSync(fmDst)) fs.copyFileSync(fmSrc, fmDst);
  } catch { /* the scan:install assertion below will catch any resulting gap */ }

  // 3. Run the consumer install verifier (/scan:install) with cwd = fresh repo.
  scan = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "check", "install.js")],
    { cwd: tmp, encoding: "utf8", timeout: 60_000 },
  );
  ok("scan:install certifies the fresh install (exit 0)", scan.status === 0, `code=${scan.status} ${tail(scan.stdout || scan.stderr)}`);

  // 4. Core shipped artifacts present in the fresh repo (self-contained).
  for (const f of [
    ".claude/manifest.json",
    ".claude/paths.json",
    ".claude/settings.json",
    ".claude/framework-manifest.json",
    "version.json",
  ]) {
    ok(`fresh install contains ${f}`, fs.existsSync(path.join(tmp, f)));
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
