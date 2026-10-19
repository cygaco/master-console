#!/usr/bin/env node
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
  let src;
  try {
    src = fs.readFileSync(NEW_LIB, "utf8");
  } catch (e) {
    console.error(`[portfolio-installer-loud] detector error: cannot read ${NEW_LIB}: ${e.message}`);
    process.exit(2);
  }

  check(/_installMC\s*\(\s*repoPath/.test(src),
    "A: createProductRepo no longer calls _installMC(repoPath) — the loud install path is gone.");

  check(!/const\s+setupScript\s*=\s*path\.resolve\([^)]*-setup\.js[^)]*\)\s*;\s*if\s*\(\s*fs\.existsSync\(\s*setupScript\s*\)\s*\)/.test(src),
    "new-lib.js contains the silent install shape: an existsSync(setupScript)-guarded Node installer block with no loud failure path.");

  check(/install\.ps1/.test(src),
    "B: _installMC does not reference the shipped installer install.ps1.");

  check(/framework-installed\.json/.test(src),
    "C: the install completeness gate (.claude/framework-installed.json) is missing.");
  check(/silent-install-guard/.test(src),
    "C: the silent-install-guard marker is missing — the silent-no-op intent could be silently stripped.");

  let mod;
  try {
    mod = require(NEW_LIB);
  } catch (e) {
    console.error(`[portfolio-installer-loud] detector error: cannot require new-lib.js: ${e.message}`);
    process.exit(2);
  }
  if (typeof mod._installMC !== "function") {
    console.error("[portfolio-installer-loud] detector error: new-lib.js does not export _installMC for testing.");
    process.exit(2);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "bc29-"));
  try {
    const noEngine = path.join(tmpBase, "no-engine");
    fs.mkdirSync(noEngine, { recursive: true });
    const r1 = mod._installMC(noEngine, { spawn: () => ({ status: 0, stdout: "", stderr: "" }) });
    check(r1 && r1.ok === false,
      "D1: a 'successful' install that produced no .claude/framework-installed.json was NOT rejected (silent no-op survives).");

    const r2 = mod._installMC(noEngine, { spawn: () => ({ status: 1, stdout: "", stderr: "boom" }) });
    check(r2 && r2.ok === false,
      "D2: a failed install (status!=0) was NOT rejected.");

    const withEngine = path.join(tmpBase, "with-engine");
    fs.mkdirSync(path.join(withEngine, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(withEngine, ".claude", "framework-installed.json"),
      JSON.stringify({ installedVersion: "test" }) + "\n");
    const r3 = mod._installMC(withEngine, { spawn: () => ({ status: 0, stdout: "", stderr: "" }) });
    check(r3 && r3.ok === true,
      "D3: positive control failed — a complete install (engine record present) was rejected; the gate is over-strict / detector is trivially false.");
  } finally {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch { }
  }

  if (failures.length) {
    console.error("[portfolio-installer-loud] FAIL — silent-installer-no-op contract broken:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("[portfolio-installer-loud] PASS — /portfolio:new installs via the shipped installer and fails loudly on a no-op (guarded).");
  process.exit(0);
}

main();
