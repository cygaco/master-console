#!/usr/bin/env node

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
  spawnSync("git", ["init", "-q"], { cwd: tmp, encoding: "utf8" });

  setup = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "mc-setup.js"), tmp, "--yes"],
    { encoding: "utf8", timeout: 180_000 },
  );
  ok("mc-setup into a fresh empty repo exits 0", setup.status === 0, `code=${setup.status} ${tail(setup.stderr || setup.stdout)}`);

  try {
    const fmSrc = path.join(REPO_ROOT, ".claude", "framework-manifest.json");
    const fmDst = path.join(tmp, ".claude", "framework-manifest.json");
    if (fs.existsSync(fmSrc) && !fs.existsSync(fmDst)) fs.copyFileSync(fmSrc, fmDst);
  } catch { }

  scan = spawnSync(
    process.execPath,
    [path.join(REPO_ROOT, "scripts", "check", "install.js")],
    { cwd: tmp, encoding: "utf8", timeout: 60_000 },
  );
  ok("scan:install certifies the fresh install (exit 0)", scan.status === 0, `code=${scan.status} ${tail(scan.stdout || scan.stderr)}`);

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
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
