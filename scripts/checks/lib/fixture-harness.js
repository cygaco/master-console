#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function isPass(result) {
  if (result === true) return true;
  if (result === false) return false;
  if (typeof result === "number") return result === 0;
  if (result == null || typeof result !== "object") return false;
  if (typeof result.result === "string") {
    return /^(pass|ok|clean|green)$/i.test(result.result);
  }
  for (const key of ["violations", "findings", "errors"]) {
    if (Array.isArray(result[key])) {
      if (result.ok === false) return false;
      return result[key].length === 0;
    }
  }
  if (typeof result.exitCode === "number") return result.exitCode === 0;
  if (typeof result.ok === "boolean") return result.ok;
  return false;
}

function sealedDir(spec, label = "fixture") {
  const base = fs.mkdtempSync(
    path.join(os.tmpdir(), `mc-${label.replace(/[^a-z0-9_-]/gi, "")}-`),
  );
  for (const [rel, content] of Object.entries(spec || {})) {
    const full = path.join(base, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content == null ? "" : String(content), "utf8");
  }
  return {
    dir: base,
    file: (rel) => path.join(base, rel),
    read: (rel) => fs.readFileSync(path.join(base, rel), "utf8"),
    cleanup() {
      try {
        fs.rmSync(base, { recursive: true, force: true });
      } catch {
      }
    },
  };
}

function harness(label) {
  let passed = 0;
  let violationAsserts = 0;
  const failures = [];

  function record(name, fn, mode) {
    try {
      const out = fn();
      const pass = isPass(out);
      if (mode === "pass") {
        if (pass) passed++;
        else failures.push(`${name}: expected PASS, got ${render(out)}`);
      } else {
        if (!pass) passed++;
        else
          failures.push(
            `${name}: expected the enforcer to FAIL the planted violation, but it PASSED (${render(out)}) — FALSE-GREEN`,
          );
        violationAsserts++;
      }
    } catch (e) {
      if (mode === "failClosed") {
        passed++;
        violationAsserts++;
      } else {
        failures.push(`${name}: threw ${e && e.message ? e.message : e}`);
        if (mode === "violation") violationAsserts++;
      }
    }
  }

  function render(v) {
    try {
      return typeof v === "object" ? JSON.stringify(v).slice(0, 240) : String(v);
    } catch {
      return String(v);
    }
  }

  return {
    isPass,
    sealedDir,
    pass: (name, fn) => record(name, fn, "pass"),
    violation: (name, fn) => record(name, fn, "violation"),
    failClosed: (name, fn) => record(name, fn, "failClosed"),
    test(name, fn) {
      try {
        fn();
        passed++;
      } catch (e) {
        failures.push(`${name}: ${e && e.message ? e.message : e}`);
      }
    },
    done() {
      const total = passed + failures.length;
      if (violationAsserts === 0) {
        failures.push(
          `${label}: NO planted-violation assertion ran — a test that only proves the happy path is a false-green waiting to happen. Add at least one h.violation(...) or h.failClosed(...).`,
        );
      }
      if (failures.length) {
        process.stderr.write(
          `${label} fixture-test: ${passed}/${total} passed, ${failures.length} FAILED\n`,
        );
        for (const f of failures) process.stderr.write(`  - ${f}\n`);
        process.exit(1);
      }
      process.stdout.write(
        `${label} fixture-test: ${passed}/${passed} passed (incl. ${violationAsserts} planted-violation/fail-closed assertion(s))\n`,
      );
      process.exit(0);
    },
  };
}

module.exports = { harness, sealedDir, isPass };

if (require.main === module && process.argv.includes("--selftest")) {
  const assert = require("assert");
  assert.strictEqual(isPass(true), true);
  assert.strictEqual(isPass(false), false);
  assert.strictEqual(isPass(0), true);
  assert.strictEqual(isPass(2), false);
  assert.strictEqual(isPass({ ok: true }), true);
  assert.strictEqual(isPass({ ok: false }), false);
  assert.strictEqual(isPass({ exitCode: 0 }), true);
  assert.strictEqual(isPass({ result: "PASS" }), true);
  assert.strictEqual(isPass({ result: "REJECT" }), false);
  assert.strictEqual(isPass({ violations: [] }), true);
  assert.strictEqual(isPass({ violations: ["x"] }), false);
  assert.strictEqual(isPass({ findings: [], ok: false }), false, "ok:false overrides empty findings");
  assert.strictEqual(isPass(null), false, "null fails closed");
  assert.strictEqual(isPass({ weird: 1 }), false, "unknown shape fails closed");
  const fx = sealedDir({ "a/x.md": "M", ".hidden/y.md": "M" }, "selftest");
  try {
    assert.ok(fs.existsSync(fx.file("a/x.md")));
    assert.ok(fs.existsSync(fx.file(".hidden/y.md")));
    assert.strictEqual(fx.read("a/x.md"), "M");
  } finally {
    fx.cleanup();
  }
  assert.ok(!fs.existsSync(fx.dir), "cleanup removed the sealed dir");
  process.stdout.write("fixture-harness selftest: all assertions passed\n");
  process.exit(0);
}
