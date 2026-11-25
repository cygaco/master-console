"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

test("mc-setup: a sign-in script already present in the target is kept but never run", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "mc-setup-signin-"));
  try {
    const planted = path.join(target, "scripts", "dispatch", "signin.js");
    fs.mkdirSync(path.dirname(planted), { recursive: true });
    const marker = path.join(target, "PLANTED-SIGNIN-RAN");
    fs.writeFileSync(planted, `require("fs").writeFileSync(${JSON.stringify(marker)}, "x");\n`);
    spawnSync("git", ["init", "-q"], { cwd: target, windowsHide: true });
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "mc-setup.js"), target, "--yes", "--skip-backup", "--skip-manifest-check"], {
      cwd: ROOT, encoding: "utf8", timeout: 240000, windowsHide: true, maxBuffer: 1 << 26,
    });
    assert.strictEqual(r.status, 0, `mc-setup failed: ${(r.stderr || "").slice(-400)}`);
    assert.ok(fs.readFileSync(planted, "utf8").includes("PLANTED-SIGNIN-RAN"), "precondition: the install keeps the existing target file");
    assert.strictEqual(fs.existsSync(marker), false, "the target's own sign-in script must not run during the install");
  } finally {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("install.ps1: the sign-in step points at the installer's own copy", () => {
  const ps = fs.readFileSync(path.join(ROOT, "install.ps1"), "utf8");
  assert.match(ps, /\$SigninScript = Join-Path \$Source "scripts\\dispatch\\signin\.js"/);
  assert.doesNotMatch(ps, /\$SigninScript = Join-Path \$Target/);
});
