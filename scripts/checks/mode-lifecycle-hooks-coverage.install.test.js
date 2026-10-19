"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { readFrameworkVersion } = require("./mode-lifecycle-hooks-coverage.js");

const ROOT = path.resolve(__dirname, "..", "..");

function install(hostVersionJson) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mlc-install-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  if (hostVersionJson) fs.writeFileSync(path.join(dir, "version.json"), JSON.stringify(hostVersionJson, null, 2) + "\n");
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "mc-setup.js"), dir, "--yes"], { encoding: "utf8", timeout: 180_000 });
  assert.strictEqual(r.status, 0, `mc-setup exit ${r.status}: ${String(r.stderr || r.stdout).slice(-400)}`);
  return dir;
}
function enforceRun(dir) {
  const r = spawnSync(process.execPath, [path.join(dir, "scripts", "checks", "mode-lifecycle-hooks-coverage.js"), "--enforce", "--json"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { }
  return { status: r.status, out, raw: String(r.stdout || r.stderr).slice(0, 600) };
}
const installedVersion = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".claude", "framework-installed.json"), "utf8")).installedVersion;

test("a host project's own version.json never stands in for the installed framework version", () => {
  const dir = install({ name: "host-app", version: "9.9.9" });
  try {
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, "version.json"), "utf8")).name, "host-app", "precondition: the installer keeps the host's version.json");
    assert.strictEqual(readFrameworkVersion(dir), installedVersion(dir));
    const r = enforceRun(dir);
    assert.ok(r.out, `--json output: ${r.raw}`);
    assert.deepStrictEqual(r.out.allowlistFlagged, [], "no entry is due because of the host's version");
    assert.strictEqual(r.status, 0, `--enforce must stay green on a fresh install: ${r.raw}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an install with no version.json still reads the installed framework version", () => {
  const dir = install(null);
  try {
    fs.rmSync(path.join(dir, "version.json"), { force: true });
    assert.strictEqual(readFrameworkVersion(dir), installedVersion(dir));
    const r = enforceRun(dir);
    assert.ok(r.out, `--json output: ${r.raw}`);
    assert.deepStrictEqual(r.out.allowlistFlagged, []);
    assert.strictEqual(r.status, 0, `--enforce must stay green: ${r.raw}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
