#!/usr/bin/env node
"use strict";

/**
 * scripts/portfolio/new-lib.test.js — proves the MC engine-source resolution
 * in _installMC without spawning a real PowerShell installer (spawn injected)
 * and without touching a real MC tree (temp dirs).
 *
 *   node scripts/portfolio/new-lib.test.js
 *
 * Regression target: WI-50 round 3 (2026-06-07). new-lib.js ran
 * MC_ROOT/install.ps1 blindly; when a CONSUMER product (e.g. a cockpit)
 * drives the engine, MC_ROOT has no .claude/framework-manifest.json so
 * install.ps1 refuses it as a source ("Source repo missing required file").
 * The fix resolves a VALID engine source (running root if it qualifies, else a
 * sibling canonical clone) before invoking the installer.
 *
 * Exit 0 = all pass; non-zero = a failure (the names print).
 */

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
// Build a dir that satisfies (or, with manifest:false, fails) install.ps1's
// source contract: .claude/framework-manifest.json + .claude/paths.json +
// version.json, plus an installer.
function makeSource(dir, { manifest = true, installer = true } = {}) {
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  if (manifest) fs.writeFileSync(path.join(dir, ".claude", "framework-manifest.json"), "{}");
  fs.writeFileSync(path.join(dir, ".claude", "paths.json"), "{}");
  fs.writeFileSync(path.join(dir, "version.json"), '{"version":"0.0.0"}');
  if (installer) fs.writeFileSync(path.join(dir, "install.ps1"), "# installer");
  return dir;
}

try {
  // ── _isValidInstallSource ──────────────────────────────────────────────
  test("valid source = full contract + installer", () => {
    const d = makeSource(freshDir());
    assert.ok(_isValidInstallSource(d), "complete source is valid");
  });

  test("consumer without framework-manifest.json is NOT a valid source", () => {
    const d = makeSource(freshDir(), { manifest: false });
    assert.ok(!_isValidInstallSource(d), "missing manifest => invalid (the WI-50-r3 case)");
  });

  test("contract files present but no installer is NOT a valid source", () => {
    const d = makeSource(freshDir(), { installer: false });
    // remove the warp-setup.js path possibility too (makeSource never creates it)
    assert.ok(!_isValidInstallSource(d), "no install.ps1 / warp-setup.js => invalid");
  });

  test("scripts/warp-setup.js counts as an installer", () => {
    const d = makeSource(freshDir(), { installer: false });
    fs.mkdirSync(path.join(d, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(d, "scripts", "warp-setup.js"), "// setup");
    assert.ok(_isValidInstallSource(d), "warp-setup.js satisfies the installer requirement");
  });

  // ── _resolveInstallerRoot ──────────────────────────────────────────────
  test("running root wins when it is itself a valid source (canonical case)", () => {
    const d = makeSource(freshDir());
    assert.strictEqual(_resolveInstallerRoot(d), d, "valid startRoot resolves to itself");
  });

  test("consumer falls back to sibling ../MC engine (the fix)", () => {
    const parent = freshDir();
    const consumer = path.join(parent, "consumer");
    fs.mkdirSync(consumer, { recursive: true });
    makeSource(consumer, { manifest: false }); // consumer: no manifest => invalid source
    const engine = path.join(parent, "MC");
    fs.mkdirSync(engine, { recursive: true });
    makeSource(engine); // valid sibling canonical engine
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
    // On case-insensitive filesystems (Windows/macOS) ../MC resolves first to
    // the same dir; either way a valid engine must be returned, never null.
    assert.ok(_resolveInstallerRoot(consumer), "lowercase sibling resolves to a valid engine");
  });

  test("no valid source anywhere => null", () => {
    const parent = freshDir();
    const consumer = path.join(parent, "consumer");
    fs.mkdirSync(consumer, { recursive: true });
    makeSource(consumer, { manifest: false }); // invalid, and no sibling engine
    assert.strictEqual(_resolveInstallerRoot(consumer), null, "no engine => null");
  });

  // ── _installMC ─────────────────────────────────────────────────────
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
    // simulate a successful install producing the completeness marker
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

  test("surfaces the real installer error (no punt) on non-zero exit", () => {
    const engine = makeSource(freshDir());
    const repo = freshDir();
    const fakeSpawn = () => ({ status: 1, stdout: "", stderr: "Source repo missing required file" });
    const r = _installMC(repo, { spawn: fakeSpawn, resolveRoot: () => engine });
    assert.ok(!r.ok, "not ok on installer failure");
    assert.ok(/Source repo missing required file/.test(r.error), "passes through the real stderr");
  });

  test("completeness gate: success-but-no-engine is refused (WI-50 silent-no-op guard)", () => {
    const engine = makeSource(freshDir());
    const repo = freshDir(); // NO framework-installed.json written
    const fakeSpawn = () => ({ status: 0, stdout: "", stderr: "" });
    const r = _installMC(repo, { spawn: fakeSpawn, resolveRoot: () => engine });
    assert.ok(!r.ok, "not ok when no engine tree produced");
    assert.ok(/produced no engine/.test(r.error), "explains the empty-install refusal");
  });
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (failures.length) {
  console.error(`new-lib.test.js: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`new-lib.test.js: all ${passed} passed`);
