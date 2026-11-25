"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

function fixture({ git = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paths-gate-test-"));
  fs.mkdirSync(path.join(dir, "scripts", "paths"), { recursive: true });
  fs.mkdirSync(path.join(dir, "framework"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "gate.js"), path.join(dir, "scripts", "paths", "gate.js"));
  fs.copyFileSync(path.join(ROOT, "framework", "paths.registry.json"), path.join(dir, "framework", "paths.registry.json"));
  fs.writeFileSync(path.join(dir, "good.md"), "Events go to paths.eventsFile.\n");
  if (git) {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A"], { cwd: dir });
  }
  return dir;
}

function gate(dir, ...args) {
  const r = spawnSync(process.execPath, [path.join(dir, "scripts", "paths", "gate.js"), "--check", "docs-tokens", "--json", ...args], {
    cwd: dir,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  let report = null;
  try {
    report = JSON.parse(r.stdout);
  } catch {
  }
  return { status: r.status, report, out: r.stdout + r.stderr };
}

test("an untracked stray with a bad token does not fail --tracked", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, "stray.md"), "Old note: paths.notARealKey here.\n");
  const r = gate(dir, "--tracked");
  assert.strictEqual(r.status, 0, r.out);
});

test("the same untracked stray still fails the standalone gate", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, "stray.md"), "Old note: paths.notARealKey here.\n");
  const r = gate(dir);
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.report.findings.some((f) => f.file === "stray.md"), r.out);
});

test("a tracked file with a bad token still fails --tracked", () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, "bad.md"), "See paths.notARealKey.\n");
  spawnSync("git", ["add", "bad.md"], { cwd: dir });
  const r = gate(dir, "--tracked");
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.report.findings.some((f) => f.file === "bad.md"), r.out);
});

test("--tracked outside a git repo fails closed", () => {
  const dir = fixture({ git: false });
  const r = gate(dir, "--tracked");
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(/git ls-files failed/.test(r.out), r.out);
});
