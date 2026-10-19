#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const {
  _installMC,
  _resolveInstallerRoot,
  _isValidInstallSource,
} = require("./new-lib");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-newlib-test-"));
function freshDir() {
  return fs.mkdtempSync(path.join(tmp, "d-"));
}
function makeSource(dir, { manifest = true, installer = true } = {}) {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  if (manifest) fs.writeFileSync(path.join(dir, ".claude", "framework-manifest.json"), "{}");
  fs.writeFileSync(path.join(dir, ".claude", "paths.json"), "{}");
  fs.writeFileSync(path.join(dir, "version.json"), '{"version":"0.0.0"}');
  if (installer) fs.writeFileSync(path.join(dir, "install.ps1"), "# installer");
  return dir;
}

try {
  test("valid source = full contract + installer", () => {
    const d = makeSource(freshDir());
    assert.ok(_isValidInstallSource(d), "complete source is valid");
  });

  test("consumer without framework-manifest.json is NOT a valid source", () => {
    const d = makeSource(freshDir(), { manifest: false });
    assert.ok(!_isValidInstallSource(d), "missing manifest => invalid (the missing-manifest case)");
  });

  test("contract files present but no installer is NOT a valid source", () => {
    const d = makeSource(freshDir(), { installer: false });
    assert.ok(!_isValidInstallSource(d), "no install.ps1 / Node installer => invalid");
  });

  test("scripts/mc-setup.js counts as an installer", () => {
    const d = makeSource(freshDir(), { installer: false });
    fs.mkdirSync(path.join(d, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(d, "scripts", "mc-setup.js"), "// setup");
    assert.ok(_isValidInstallSource(d), "mc-setup.js satisfies the installer requirement");
  });

  test("legacy probe: an older source tree with only scripts/warp-setup.js still counts as an installer", () => {
    const d = makeSource(freshDir(), { installer: false });
    fs.mkdirSync(path.join(d, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(d, "scripts", "warp-setup.js"), "// setup");
    assert.ok(_isValidInstallSource(d), "an older tree with only the legacy installer name is a valid source");
  });

  test("running root wins when it is itself a valid source (canonical case)", () => {
    const d = makeSource(freshDir());
    assert.strictEqual(_resolveInstallerRoot(d), d, "valid startRoot resolves to itself");
  });

  test("consumer falls back to sibling ../MC engine", () => {
    const parent = freshDir();
    const consumer = path.join(parent, "consumer");
    fs.mkdirSync(consumer, { recursive: true });
    makeSource(consumer, { manifest: false });
    const engine = path.join(parent, "MC");
    fs.mkdirSync(engine, { recursive: true });
    makeSource(engine);
    assert.strictEqual(
      _resolveInstallerRoot(consumer),
      path.resolve(consumer, "..", "MC"),
      "consumer resolves to its sibling canonical engine",
    );
  });

  test("lowercase sibling ../mc is also accepted", () => {
    const parent = freshDir();
    const consumer = path.join(parent, "consumer");
    fs.mkdirSync(consumer, { recursive: true });
    makeSource(consumer, { manifest: false });
    const engine = path.join(parent, "mc");
    fs.mkdirSync(engine, { recursive: true });
    makeSource(engine);
    assert.ok(_resolveInstallerRoot(consumer), "lowercase sibling resolves to a valid engine");
  });

  test("no valid source anywhere => null", () => {
    const parent = freshDir();
    const consumer = path.join(parent, "consumer");
    fs.mkdirSync(consumer, { recursive: true });
    makeSource(consumer, { manifest: false });
    assert.strictEqual(_resolveInstallerRoot(consumer), null, "no engine => null");
  });

  test("fails LOUD (no silent no-op) when no valid engine source resolves", () => {
    const repo = freshDir();
    const r = _installMC(repo, { resolveRoot: () => null });
    assert.ok(!r.ok, "not ok when source unresolved");
    assert.ok(/No valid MC engine source/.test(r.error), "explains the missing source");
    assert.ok(/framework-manifest\.json/.test(r.error), "names the missing manifest");
    assert.ok(/sibling/i.test(r.error), "points at the sibling-clone remedy");
  });

  test("happy path: invokes installer from the RESOLVED root, asserts engine tree", () => {
    const engine = makeSource(freshDir());
    const repo = freshDir();
    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "framework-installed.json"), "{}");
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: "", stderr: "" };
    };
    const r = _installMC(repo, { spawn: fakeSpawn, resolveRoot: () => engine });
    assert.ok(r.ok, `ok install: ${r.error || ""}`);
    assert.strictEqual(calls.length, 1, "installer invoked once");
    assert.strictEqual(calls[0].opts.cwd, engine, "installer runs from the resolved engine root");
    assert.ok(
      calls[0].args.some((a) => String(a).endsWith("install.ps1")),
      "invokes the resolved root's install.ps1",
    );
  });

  function nodeInstallerRun(installerRel) {
    const engine = makeSource(freshDir(), { installer: false });
    fs.mkdirSync(path.join(engine, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(engine, ...installerRel.split("/")), "// setup");
    const repo = freshDir();
    fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "framework-installed.json"), "{}");
    const calls = [];
    const fakeSpawn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: "", stderr: "" };
    };
    const r = _installMC(repo, { spawn: fakeSpawn, resolveRoot: () => engine });
    return { r, calls, engine };
  }

  test("no install.ps1: runs the source's scripts/mc-setup.js with node", () => {
    const { r, calls, engine } = nodeInstallerRun("scripts/mc-setup.js");
    assert.ok(r.ok, `ok install: ${r.error || ""}`);
    assert.strictEqual(calls.length, 1, "installer invoked once");
    assert.strictEqual(calls[0].cmd, "node", "Node installer runs under node");
    assert.strictEqual(calls[0].args[0], path.resolve(engine, "scripts", "mc-setup.js"), "invokes scripts/mc-setup.js");
  });

  test("legacy probe: an older source tree with only scripts/warp-setup.js is still installed from", () => {
    const { r, calls, engine } = nodeInstallerRun("scripts/warp-setup.js");
    assert.ok(r.ok, `ok install: ${r.error || ""}`);
    assert.strictEqual(calls.length, 1, "installer invoked once");
    assert.strictEqual(calls[0].args[0], path.resolve(engine, "scripts", "warp-setup.js"), "invokes the legacy-named installer");
  });

  test("surfaces the real installer error (no punt) on non-zero exit", () => {
    const engine = makeSource(freshDir());
    const repo = freshDir();
    const fakeSpawn = () => ({ status: 1, stdout: "", stderr: "Source repo missing required file" });
    const r = _installMC(repo, { spawn: fakeSpawn, resolveRoot: () => engine });
    assert.ok(!r.ok, "not ok on installer failure");
    assert.ok(/Source repo missing required file/.test(r.error), "passes through the real stderr");
  });

  test("completeness gate: success-but-no-engine is refused (silent-no-op guard)", () => {
    const engine = makeSource(freshDir());
    const repo = freshDir();
    const fakeSpawn = () => ({ status: 0, stdout: "", stderr: "" });
    const r = _installMC(repo, { spawn: fakeSpawn, resolveRoot: () => engine });
    assert.ok(!r.ok, "not ok when no engine tree produced");
    assert.ok(/produced no engine/.test(r.error), "explains the empty-install refusal");
  });
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
}

if (failures.length) {
  console.error(`new-lib.test.js: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`new-lib.test.js: all ${passed} passed`);
