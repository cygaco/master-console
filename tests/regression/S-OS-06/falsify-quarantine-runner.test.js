#!/usr/bin/env node
"use strict";
/**
 * falsify-quarantine-runner.test.js — S-OS-06 fix2 Lane D (ED-434).
 *
 * Falsifies scripts/checks/run-tests.js, the `npm test` runner that runs the full test glob minus a
 * self-policing quarantine. Every case builds a throwaway git repo with dummy tests and a STUB
 * tests/quarantine.json, and runs the REAL runner with `--root <temp repo>` — the real quarantine
 * artifact is never read or written (asserted byte-for-byte).
 *
 *   (a) a quarantined dummy that PASSES          -> runner exits non-zero (teeth fire)
 *   (b) a genuinely-failing quarantined dummy    -> runner exits 0 (the quarantine subtracts it)
 *   (c) a quarantined file listed but MISSING    -> runner exits non-zero
 *   (d) control: the same failing dummy NOT quarantined -> runner exits non-zero (primary propagates)
 *   (e) a malformed quarantine artifact          -> runner exits non-zero (fail-closed)
 *
 * A spawn error, a timeout or a kill of the runner is never an observation — only an exit code is.
 *
 *   node --test tests/regression/S-OS-06/falsify-quarantine-runner.test.js
 */
const FALSIFIER_ID = "QUARANTINE-RUNNER";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..", "..");
const RUNNER = path.join(REAL_ROOT, "scripts", "checks", "run-tests.js");
const REAL_QUARANTINE = path.join(REAL_ROOT, "tests", "quarantine.json");
const RUNNER_TIMEOUT_MS = 5 * 60 * 1000;

const PASSING = 'const test = require("node:test");\ntest("dummy passes", () => {});\n';
const FAILING =
  'const test = require("node:test");\nconst assert = require("node:assert");\n' +
  'test("dummy rotted", () => { assert.strictEqual(1, 2, "dummy rot: still failing"); });\n';

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_") || k === "NODE_TEST_CONTEXT") delete env[k];
  return env;
}

// Register-format declarations the runner requires its artifact to carry verbatim (declared = actual).
// Imported, not copied: the fixture must not fork the runner's own declarations. (S-OS-06 r4 lane I5)
const RUNNER_DECL = require(RUNNER);
const FAILING_DEFAULT_ASSERTION = "dummy rot: still failing";
const FAILING_CAUSE_LINES = ["1 !== 2", "dummy rot: still failing"];
// (lane I6) a quarantined file that FAILS while emitting no author cause at all: a file-level exit code, no test,
// no output. Its observed cause capture is EMPTY (the whole-file block carries exitCode and is not authored).
const SILENT_FAILING = "process.exitCode = 1;\n";

function entry(file, over) {
  const e = {
    file,
    firstFailingAssertion: "dummy rot: still failing",
    failCount: 1,
    cause: "falsifier-dummy",
    filedUnder: "ED-434",
    expiry: "S-OS-08 (test-rot cleanup sprint)",
    expiryVersion: "3.0.0",
    ...(over || {}),
  };
  // FIXTURE CONSTRUCTION ONLY (lane I5): the register format replaced the single "firstFailingAssertion"
  // with a "causeLines" multiset and requires an "observedOn" provenance stamp. The registered cause is
  // carried over unchanged as a one-line multiset; the stamp is this platform/node/pinned reporter.
  // (lane I6) The default is the FAILING dummy's MEASURED cause multiset under the key-indent-fixed capture
  // (node 24.16.0, tap: the authored error value carries the assertion's own "1 !== 2" line), canonical order.
  if (e.causeLines === undefined && e.firstFailingAssertion !== undefined) e.causeLines = e.firstFailingAssertion === FAILING_DEFAULT_ASSERTION ? FAILING_CAUSE_LINES : [e.firstFailingAssertion];
  delete e.firstFailingAssertion;
  if (e.observedOn === undefined) e.observedOn = RUNNER_DECL.currentStamp();
  return e;
}

/** The fixture repo's HEAD commit (the register's base: every fixture test file exists there). */
function fixtureCommit(dir) {
  const c = spawnSync("git", ["-c", "user.name=falsifier-fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "--allow-empty", "-m", "fixture base"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  if (c.status !== 0) throw new Error(`git commit failed: ${c.stderr || c.stdout}`);
  const h = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  if (h.status !== 0) throw new Error(`git rev-parse HEAD failed: ${h.stderr || h.stdout}`);
  return h.stdout.trim();
}

/** Throwaway git repo with `files` (rel -> content) and a stub quarantine (object, or raw string). */
function withRepo(files, quarantine, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sos06-quarantine-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    const q = path.join(dir, "tests", "quarantine.json");
    fs.mkdirSync(path.dirname(q), { recursive: true });
    for (const args of [["init", "-q"], ["add", "-A"]]) {
      const g = spawnSync("git", args, { cwd: dir, env: cleanEnv(), encoding: "utf8" });
      if (g.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${g.stderr || g.stdout}`);
    }
    // FIXTURE CONSTRUCTION ONLY (lane I5): the runner verifies base identity, so the fixture's test files
    // are committed and that commit is the register's base. The register itself is written after it.
    const baseCommit = fixtureCommit(dir);
    if (quarantine && typeof quarantine === "object") {
      // Default the EMPTY-SUBJECT floor to 1 for fixtures (few dummy test files) unless a case sets its own.
      if (quarantine.$floor === undefined) quarantine.$floor = 1;
      // Required register header fields, unless a case sets its own.
      if (quarantine.base === undefined) quarantine.base = baseCommit;
      if (quarantine.$normalizer === undefined) quarantine.$normalizer = RUNNER_DECL.NORMALIZER_DECLARATION;
      if (quarantine.$dropClass === undefined) quarantine.$dropClass = RUNNER_DECL.DROP_CLASS_DECLARATION;
      if (quarantine.$ceilings === undefined) quarantine.$ceilings = RUNNER_DECL.CEILINGS;
    }
    fs.writeFileSync(q, typeof quarantine === "string" ? quarantine : JSON.stringify(quarantine, null, 2) + "\n", "utf8");
    const g = spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    if (g.status !== 0) throw new Error(`git add -A failed: ${g.stderr || g.stdout}`);
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* temp dir; best effort on Windows file locks */
    }
  }
}

function runRunner(dir) {
  const r = spawnSync(process.execPath, [RUNNER, "--root", dir], {
    cwd: dir,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: RUNNER_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  assert.strictEqual(r.error, undefined, `runner did not run to an exit code (spawn error / timeout): ${r.error && r.error.message}\n${out}`);
  assert.notStrictEqual(r.status, null, `runner was killed by ${r.signal} — not an observed exit code\n${out}`);
  return { status: r.status, out };
}

const realBefore = fs.existsSync(REAL_QUARANTINE) ? fs.readFileSync(REAL_QUARANTINE) : null;

test(`${FALSIFIER_ID} (a): a quarantined test that PASSES makes the runner exit non-zero`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/now-passes.test.js": PASSING };
  withRepo(files, { entries: [entry("tests/q/now-passes.test.js")] }, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `teeth did not fire: a passing quarantined test left the runner green\n${r.out}`);
    assert.match(r.out, /QUARANTINE VIOLATION — UNEXPECTEDLY PASSED: quarantined file tests\/q\/now-passes\.test\.js/, r.out);
    assert.match(r.out, /primary: 1 file\(s\) in 1 batch\(es\), exit 0 /, `the non-zero exit must come from the teeth, not the primary run\n${r.out}`);
  });
});

test(`${FALSIFIER_ID} (b): a genuinely failing quarantined test is subtracted and the runner exits 0`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/still-fails.test.js": FAILING };
  withRepo(files, { entries: [entry("tests/q/still-fails.test.js")] }, (dir) => {
    const r = runRunner(dir);
    assert.strictEqual(r.status, 0, `quarantine did not hold: runner exited ${r.status}\n${r.out}`);
    assert.match(r.out, /run-tests: quarantine tests\/q\/still-fails\.test\.js still fails \(exit 1\)/, r.out);
    assert.match(r.out, /run-tests: PASS — primary: 1 file\(s\)/, r.out);
    assert.match(r.out, /quarantine: 1 entry, 1 still failing, 0 unexpectedly passed, 0 missing\/undiscovered, 0 unobserved/, r.out);
  });
});

test(`${FALSIFIER_ID} (c): a quarantined file that is listed but MISSING makes the runner exit non-zero`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/still-fails.test.js": FAILING };
  const q = { entries: [entry("tests/q/still-fails.test.js"), entry("tests/q/gone.test.js")] };
  withRepo(files, q, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `a missing quarantined file left the runner green\n${r.out}`);
    assert.match(r.out, /QUARANTINE VIOLATION — MISSING: quarantined file tests\/q\/gone\.test\.js no longer exists on disk/, r.out);
  });
});

test(`${FALSIFIER_ID} (d) control: the same failing test NOT quarantined makes the runner exit non-zero`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/still-fails.test.js": FAILING };
  withRepo(files, { entries: [] }, (dir) => {
    const r = runRunner(dir);
    assert.strictEqual(r.status, 1, `the primary node --test exit code (1) must propagate; got ${r.status}\n${r.out}`);
    assert.match(r.out, /primary: 2 file\(s\) in 1 batch\(es\), exit 1 /, r.out);
  });
});

test(`${FALSIFIER_ID} (e): a malformed quarantine artifact fails closed`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING };
  withRepo(files, "{ not json", (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `a malformed quarantine artifact left the runner green\n${r.out}`);
    assert.match(r.out, /is not valid JSON/, r.out);
  });
  const noFields = { entries: [{ file: "tests/ok/pass.test.js" }] };
  withRepo(files, noFields, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `an entry without its disposition fields left the runner green\n${r.out}`);
    assert.match(r.out, /missing a non-empty "causeLines"/, r.out);
  });
  // INVERSE (lane I6, β row 488): the same entry CARRYING its fields is not refused on that field.
  withRepo(files, { entries: [entry("tests/ok/pass.test.js")] }, (dir) => {
    const r = runRunner(dir);
    assert.doesNotMatch(r.out, /missing a non-empty "causeLines"/, r.out);
    assert.doesNotMatch(r.out, /is malformed/, r.out);
  });
});

test(`${FALSIFIER_ID} (f) CAUSE-LOCK (β): a quarantined file failing with a DIFFERENT assertion than registered -> non-zero`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/still-fails.test.js": FAILING };
  withRepo(files, { entries: [entry("tests/q/still-fails.test.js", { firstFailingAssertion: "a DIFFERENT assertion that never appears" })] }, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `CAUSE-LOCK did not fire: a new/different failure was absolved by the register\n${r.out}`);
    assert.match(r.out, /QUARANTINE VIOLATION — CAUSE-LOCK: tests\/q\/still-fails\.test\.js/, r.out);
  });
});

test(`${FALSIFIER_ID} (g) EMPTY-SUBJECT floor (β): discovery below $floor is a FAILURE, not a pass`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING };
  withRepo(files, { entries: [], $floor: 99 }, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `a broken/near-empty glob passed the floor\n${r.out}`);
    assert.match(r.out, /below the committed floor of 99/, r.out);
  });
});

test(`${FALSIFIER_ID} (h) per-entry version EXPIRY (β): a quarantine past its tree-version expiry -> non-zero`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/still-fails.test.js": FAILING, "package.json": '{ "name": "fx", "version": "3.0.0", "private": true }\n' };
  withRepo(files, { entries: [entry("tests/q/still-fails.test.js", { expiryVersion: "3.0.0" })] }, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `an expired quarantine (tree 3.0.0 >= expiry 3.0.0) stayed green\n${r.out}`);
    assert.match(r.out, /QUARANTINE VIOLATION — EXPIRED: tests\/q\/still-fails\.test\.js quarantine expired at 3\.0\.0/, r.out);
  });
});

test(`${FALSIFIER_ID} (i) INDETERMINATE (β row 490): an EMPTY observed cause capture REFUSES, it never passes`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/silent.test.js": SILENT_FAILING };
  withRepo(files, { entries: [entry("tests/q/silent.test.js")] }, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `an empty cause capture left the runner green\n${r.out}`);
    assert.match(r.out, /QUARANTINE VIOLATION — INDETERMINATE: tests\/q\/silent\.test\.js fails, but the observed cause capture is EMPTY/, r.out);
    assert.match(r.out, /0 still failing, 0 unexpectedly passed, 0 missing\/undiscovered, 1 unobserved/, r.out);
  });
});

test(`${FALSIFIER_ID}: the real tests/quarantine.json is never touched`, () => {
  const realAfter = fs.existsSync(REAL_QUARANTINE) ? fs.readFileSync(REAL_QUARANTINE) : null;
  assert.ok(realBefore === null ? realAfter === null : realAfter !== null && realBefore.equals(realAfter), "the real quarantine artifact changed during the falsifier");
});
