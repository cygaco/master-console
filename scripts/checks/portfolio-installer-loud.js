#!/usr/bin/env node
/**
 * scripts/checks/portfolio-installer-loud.js
 *
 * Regression detector for BC-29 — "Silent installer no-op in /portfolio:new
 * (created project has no MC engine)".
 *
 * WI-50 (fixed downstream in masterconsole 9451259; REINTRODUCED by the 0.15.0
 * step-driven rewrite, E-SPINUP-STEPS-001): createProductRepo installed MC
 * into a newly-created product by calling scripts/warp-setup.js — the canonical
 * installer that is INTENTIONALLY NEVER SHIPPED (release-build.js) — guarded by
 * fs.existsSync. On any CONSUMER install the file is absent → the guard is false
 * → the install step SILENTLY no-op'd → the created project got app files but no
 * MC engine (no .claude/, no scripts/ tree), dead on arrival.
 *
 * Contract this detector asserts (exits 0 only when ALL hold):
 *   A. createProductRepo installs via _installMC (not a bare existsSync skip).
 *   B. _installMC prefers the SHIPPED installer (install.ps1).
 *   C. The completeness gate references .claude/framework-installed.json and the
 *      WI-50 guard marker (so the intent can't be silently stripped).
 *   D. Behavioral (with an injected spawn, NO real install):
 *      - a "successful" install that produced NO engine record → ok:false (loud);
 *      - a failed install (status!=0) → ok:false (loud);
 *      - a successful install WITH an engine record → ok:true (positive control,
 *        so the detector is not trivially always-false).
 *
 * Exit codes:
 *   0  pass — the loud-install contract holds
 *   1  regression — the silent-no-op contract was reintroduced / broken
 *   2  detector error (never a clean pass)
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const NEW_LIB = path.join(ROOT, "scripts", "portfolio", "new-lib.js");

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

function main() {
  // ── static source contract ────────────────────────────────────────────────
  let src;
  try {
    src = fs.readFileSync(NEW_LIB, "utf8");
  } catch (e) {
    console.error(`[BC-29] detector error: cannot read ${NEW_LIB}: ${e.message}`);
    process.exit(2);
  }

  // A. createProductRepo wires the loud installer helper.
  check(/_installMC\s*\(\s*repoPath/.test(src),
    "A: createProductRepo no longer calls _installMC(repoPath) — the loud install path is gone.");

  // A'. the old silent pattern (existsSync-guarded warp-setup with no loud else)
  // must NOT be the install path. We forbid the specific reintroduction shape.
  check(!/const\s+setupScript\s*=\s*path\.resolve\([^)]*warp-setup\.js[^)]*\)\s*;\s*if\s*\(\s*fs\.existsSync\(\s*setupScript\s*\)\s*\)/.test(src),
    "A': the silent existsSync(setupScript)-guarded warp-setup.js install block was reintroduced (WI-50 shape).");

  // B. prefer the shipped installer.
  check(/install\.ps1/.test(src),
    "B: _installMC does not reference the shipped installer install.ps1.");

  // C. completeness gate + intent marker.
  check(/framework-installed\.json/.test(src),
    "C: the install completeness gate (.claude/framework-installed.json) is missing.");
  check(/WI-50/.test(src),
    "C: the WI-50 guard marker is missing — the silent-no-op intent could be silently stripped.");

  // ── behavioral contract (injected spawn — NO real install runs) ────────────
  let mod;
  try {
    mod = require(NEW_LIB);
  } catch (e) {
    console.error(`[BC-29] detector error: cannot require new-lib.js: ${e.message}`);
    process.exit(2);
  }
  if (typeof mod._installMC !== "function") {
    console.error("[BC-29] detector error: new-lib.js does not export _installMC for testing.");
    process.exit(2);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "bc29-"));
  try {
    // D1: install "succeeds" but produces no engine record → must fail loudly.
    const noEngine = path.join(tmpBase, "no-engine");
    fs.mkdirSync(noEngine, { recursive: true });
    const r1 = mod._installMC(noEngine, { spawn: () => ({ status: 0, stdout: "", stderr: "" }) });
    check(r1 && r1.ok === false,
      "D1: a 'successful' install that produced no .claude/framework-installed.json was NOT rejected (silent no-op survives).");

    // D2: install process fails → must fail loudly.
    const r2 = mod._installMC(noEngine, { spawn: () => ({ status: 1, stdout: "", stderr: "boom" }) });
    check(r2 && r2.ok === false,
      "D2: a failed install (status!=0) was NOT rejected.");

    // D3: positive control — engine record present + success → ok:true.
    const withEngine = path.join(tmpBase, "with-engine");
    fs.mkdirSync(path.join(withEngine, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(withEngine, ".claude", "framework-installed.json"),
      JSON.stringify({ installedVersion: "test" }) + "\n");
    const r3 = mod._installMC(withEngine, { spawn: () => ({ status: 0, stdout: "", stderr: "" }) });
    check(r3 && r3.ok === true,
      "D3: positive control failed — a complete install (engine record present) was rejected; the gate is over-strict / detector is trivially false.");
  } finally {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (failures.length) {
    console.error("[BC-29] FAIL — silent-installer-no-op contract broken:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("[BC-29] PASS — /portfolio:new installs via the shipped installer and fails loudly on a no-op (WI-50 guarded).");
  process.exit(0);
}

main();
