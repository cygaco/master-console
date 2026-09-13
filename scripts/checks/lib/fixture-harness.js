#!/usr/bin/env node
"use strict";

/**
 * fixture-harness.js — the P5 isolated-testing substrate (PLAN §12 P5 / §17.2.2).
 *
 * The recurring MC bug class is the FALSE-GREEN: an enforcer that passes
 * against the live dev-repo (which happens to be clean) but would also pass a
 * real violation, because it was never run against a KNOWN-bad input. P5 makes
 * that structurally impossible by requiring every enforcer to ship with:
 *
 *   (1) a SEALED fixture (known inputs, isolated from the live repo),
 *   (2) a KNOWN-ANSWER assertion (clean input ⇒ pass),
 *   (3) a PLANTED-VIOLATION case that MUST fail it (no false-green),
 *   (4) FAIL-CLOSED behavior on a runner error / malformed input.
 *
 * This module gives every enforcer test those four for free, AND meta-enforces
 * (3): a test that never asserts a planted violation actually FAILS exits
 * non-zero — so "I wrote a test" can never mean "I wrote a test that only proves
 * the happy path." The §11 `tooltest/` fixture is the reference pattern; this is
 * its reusable form.
 *
 * Zero dependencies (Node stdlib only) so it loads in any enforcer test without
 * an npm install. Usage:
 *
 *   const { harness, sealedDir } = require("./lib/fixture-harness"); // path-relative
 *   const h = harness("my-enforcer");
 *   h.pass("clean input passes", () => evaluate(clean));            // known-answer
 *   h.violation("planted bad input fails", () => evaluate(bad));    // MUST fail (P5.3)
 *   h.failClosed("malformed input fails closed", () => evaluate(null));
 *   h.done(); // prints summary, exits non-zero if any test failed OR no violation asserted
 *
 * A "result" passed to pass()/violation()/failClosed() is interpreted leniently
 * so it works with every enforcer shape in this repo:
 *   - boolean              → true = pass, false = fail
 *   - number (exit code)   → 0 = pass, non-0 = fail
 *   - { ok: boolean }      → ok
 *   - { exitCode: number } → exitCode === 0
 *   - { result: "PASS"|"REJECT"|"ARBITRATION"|... } → PASS-like = pass
 *   - { violations: [...] }/{ findings: [...] }/{ errors: [...] } → empty = pass
 * The interpreter is exported as `isPass(result)` so a test can assert custom
 * shapes explicitly when the leniency is wrong for it.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Result interpreter ──────────────────────────────────────
// Leniently decide whether an enforcer result represents a PASS. Conservative on
// ambiguity: an unrecognized shape is treated as NOT-pass so a malformed result
// can never read green (fail-closed bias — the whole point of P5).
function isPass(result) {
  if (result === true) return true;
  if (result === false) return false;
  if (typeof result === "number") return result === 0;
  if (result == null || typeof result !== "object") return false;
  // Explicit verdict strings (design-quality-gate style).
  if (typeof result.result === "string") {
    return /^(pass|ok|clean|green)$/i.test(result.result);
  }
  // Count-bearing shapes — empty = pass.
  for (const key of ["violations", "findings", "errors"]) {
    if (Array.isArray(result[key])) {
      // A `false` ok overrides an empty list (an enforcer can be not-ok with no
      // itemized findings, e.g. a runner error).
      if (result.ok === false) return false;
      return result[key].length === 0;
    }
  }
  if (typeof result.exitCode === "number") return result.exitCode === 0;
  if (typeof result.ok === "boolean") return result.ok;
  // Unknown object shape → not a recognized pass. Fail-closed.
  return false;
}

// ── Sealed fixture dir ──────────────────────────────────────
/**
 * Materialize a SEALED fixture directory under the OS temp dir, isolated from the
 * live repo. `spec` is a flat map of POSIX-style relative paths → string content;
 * intermediate dirs (including dot-dirs) are created. Returns:
 *   { dir, file(rel), read(rel), cleanup() }
 * Always pair with `try { ... } finally { fx.cleanup(); }` so a failing test
 * never leaves a sealed dir behind.
 *
 * Example:
 *   const fx = sealedDir({ "a/x.md": "MARKER", ".hidden/y.md": "MARKER" });
 */
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
        /* best effort — temp dir */
      }
    },
  };
}

// ── Test harness ────────────────────────────────────────────
/**
 * A tiny, dependency-free test runner that also meta-enforces P5.3.
 *
 *   h.pass(name, fn)        — known-answer: fn's result MUST be a pass.
 *   h.violation(name, fn)   — planted violation: fn's result MUST be a fail.
 *   h.failClosed(name, fn)  — fn (malformed/error input) MUST be a fail, even if
 *                             fn throws (a throw counts as fail-closed here, since
 *                             a runner that throws-and-the-caller-treats-it-as-red
 *                             is acceptable; a runner that returns a green on bad
 *                             input is the bug). Use raw `test` if your enforcer
 *                             must NOT throw.
 *   h.test(name, fn)        — generic: fn asserts internally (throw = fail).
 *   h.done()                — summary + exit. Exits non-zero if any test failed OR
 *                             if zero violation()/failClosed() assertions ran (a
 *                             happy-path-only enforcer test is itself a P5 fail).
 */
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
        // violation / failClosed: must NOT be a pass.
        if (!pass) passed++;
        else
          failures.push(
            `${name}: expected the enforcer to FAIL the planted violation, but it PASSED (${render(out)}) — FALSE-GREEN`,
          );
        violationAsserts++;
      }
    } catch (e) {
      if (mode === "failClosed") {
        // A throw on malformed input is an acceptable fail-closed outcome.
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
          `[P5] ${label}: NO planted-violation assertion ran — a test that only proves the happy path is a false-green waiting to happen. Add at least one h.violation(...) or h.failClosed(...).`,
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

// Self-test: `node scripts/checks/lib/fixture-harness.js --selftest`
if (require.main === module && process.argv.includes("--selftest")) {
  const assert = require("assert");
  // isPass interpreter
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
  // sealedDir incl. dot-dir
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
