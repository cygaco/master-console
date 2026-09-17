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
// (lane I6) a quarantined file whose ONLY cause line is its own test name (measured capture: ["vacant"], names ["vacant"]).
const VACANT_FAILING = 'const test = require("node:test");\ntest("vacant", () => { throw new Error("vacant"); });\n';

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

test(`${FALSIFIER_ID} (j) VACUITY (β row 473 §3): a non-empty observed capture derivable from the test names REFUSES, even when it equals the register`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/vacant.test.js": VACANT_FAILING };
  withRepo(files, { entries: [entry("tests/q/vacant.test.js", { firstFailingAssertion: "vacant" })] }, (dir) => {
    const r = runRunner(dir);
    assert.notStrictEqual(r.status, 0, `a vacuous cause lock equal to the register left the runner green\n${r.out}`);
    assert.match(r.out, /QUARANTINE VIOLATION — CAUSE-LOCK: tests\/q\/vacant\.test\.js fails, but the observed cause lines are vacuous/, r.out);
  });
});

// (lane I7) a quarantined file that writes one EXTRA stderr line only when an AMBIENT variable is set in the
// runner's own environment. The variable is not in the runner's declared child allow-list, so the hermetic
// scrub must keep it from the child: the capture stays the registered multiset. Without the scrub the ambient
// line joins the capture and the CAUSE-LOCK breaks: the capture would be a property of the machine.
const AMBIENT_VAR = "MC_I7_AMBIENT_STDERR_WRITER";
const AMBIENT_WRITER_FAILING =
  'const test = require("node:test");\nconst assert = require("node:assert");\n' +
  `test("dummy rotted", () => { if (process.env.${AMBIENT_VAR}) process.stderr.write("ambient writer: this line depends on the machine\\n"); assert.strictEqual(1, 2, "dummy rot: still failing"); });\n`;

test(`${FALSIFIER_ID} (k) HERMETIC SCRUB (β row 486): an ambient variable outside the declared allow-list never reaches a test child`, { timeout: RUNNER_TIMEOUT_MS + 60000 }, () => {
  const files = { "tests/ok/pass.test.js": PASSING, "tests/q/ambient.test.js": AMBIENT_WRITER_FAILING };
  withRepo(files, { entries: [entry("tests/q/ambient.test.js")] }, (dir) => {
    const r = spawnSync(process.execPath, [RUNNER, "--root", dir], { cwd: dir, env: { ...cleanEnv(), [AMBIENT_VAR]: "1" }, encoding: "utf8", timeout: RUNNER_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    assert.strictEqual(r.error, undefined, `runner did not run to an exit code: ${r.error && r.error.message}\n${out}`);
    assert.strictEqual(r.status, 0, `the ambient ${AMBIENT_VAR} reached the test child and changed the capture\n${out}`);
    assert.match(out, /run-tests: quarantine tests\/q\/ambient\.test\.js still fails \(exit 1\).*a multiset equal to the register/, out);
  });
});

// (lane I8, β a94f0d26 / b2c94e18, α R-71) COUNT-LOCK refuses, never skips. The plants go straight to the runner's own
// exported lock decision: `node --test` always prints its "# fail N" summary unless its own process dies, and that death
// lands in UNOBSERVED on POSIX but can exit with a code on win32, so an end-to-end plant would be platform-shaped.
// β plant form: every case asserts the EXACT rule list, so the plant trips its own rule and NO neighbouring one.
const LOCK_FILE = "tests/q/still-fails.test.js";
const LOCK_NAMES = ["dummy rotted"];
function verdictRules(over) {
  const v = RUNNER_DECL.lockVerdict(entry(LOCK_FILE), { observed: RUNNER_DECL.causeMultiset(FAILING_CAUSE_LINES), testNames: LOCK_NAMES, fc: 1, tv: [2, 0, 0], here: RUNNER_DECL.currentStamp(), ...over });
  return { rules: v.findings.map((f) => f.rule), messages: v.findings.map((f) => f.message).join("\n"), unobserved: v.unobserved };
}

test(`${FALSIFIER_ID} (l) COUNT-LOCK REFUSES (β a94f0d26): an unobservable failing-test count never renders as agreement`, () => {
  const control = verdictRules({});
  assert.deepStrictEqual(control.rules, [], `control: an equal cause multiset with an OBSERVED count of 1 must still-fail cleanly\n${control.messages}`);
  const plant = verdictRules({ fc: null });
  assert.deepStrictEqual(plant.rules, ["COUNT-UNOBSERVABLE"], `an unobservable count must trip COUNT-UNOBSERVABLE and nothing else (no NO-LOCK, INDETERMINATE, CAUSE-LOCK, COUNT-LOCK or EXPIRED)\n${plant.messages}`);
  assert.match(plant.messages, /^COUNT-LOCK UNOBSERVABLE: tests\/q\/still-fails\.test\.js fails/, plant.messages);
  assert.strictEqual(plant.unobserved, true, "an unobservable count is counted as unobserved");
});

test(`${FALSIFIER_ID} (m) NO LOCK (β b2c94e18, the CONJUNCTION): an entry whose EVERY layer is unobservable refuses loudly as having no lock at all`, () => {
  const control = verdictRules({ observed: [] });
  assert.deepStrictEqual(control.rules, ["INDETERMINATE"], `control: an EMPTY capture with an OBSERVED count is the cause layer's refusal alone (no NO-LOCK)\n${control.messages}`);
  const plant = verdictRules({ observed: [], fc: null });
  assert.deepStrictEqual(plant.rules, ["NO-LOCK"], `EMPTY capture AND unobservable count must trip NO-LOCK and nothing else (no INDETERMINATE, COUNT-UNOBSERVABLE, CAUSE-LOCK, COUNT-LOCK or EXPIRED)\n${plant.messages}`);
  assert.match(plant.messages, /^NO LOCK: tests\/q\/still-fails\.test\.js fails, but EVERY lock layer is unobservable/, plant.messages);
  assert.strictEqual(plant.unobserved, true, "an entry with no lock is counted as unobserved");
});

// (lane I8, β a2f74e09; per-platform by β a5c3e761 Q1) the OBSERVED FLOOR is a declared observation of the runtime, so it
// is re-measured here FOR THE PLATFORM THIS RUNS ON: a child spawned with an EMPTY env must receive only declared floor
// names, and every floor name the parent has. On a platform with NO declared floor this case REFUSES (fails); it never
// skips, because a skipped falsifier reads green at the exit gate while guarding nothing.
test(`${FALSIFIER_ID} (n) OBSERVED FLOOR (β a2f74e09, a5c3e761): an EMPTY child env is refilled with exactly the floor declared for THIS platform, and an undeclared platform REFUSES`, () => {
  // The refusal rule itself, planted on every platform (so it is proven where the floor IS declared too): an
  // undeclared platform and an inherited-property name both refuse. (The malformed-entry refusal is not planted here:
  // the declaration object is frozen.)
  for (const p of ["mc-no-such-platform", "__proto__", "constructor", "toString"]) {
    const v = RUNNER_DECL.observedFloorFor(p);
    assert.strictEqual(v.floor, undefined, `an undeclared platform "${p}" must not yield a floor`);
    assert.match(String(v.refused), /^OBSERVED FLOOR REFUSED: no floor is declared for platform/, `an undeclared platform "${p}" must REFUSE`);
  }
  const verdict = RUNNER_DECL.observedFloorFor(process.platform);
  assert.ok(verdict.floor, `${verdict.refused} (running on ${process.platform}/node${process.versions.node})`);
  const declared = verdict.floor;
  const floor = declared.names.map((n) => n.toUpperCase());
  assert.ok(RUNNER_DECL.NORMALIZER_DECLARATION[0].includes(`${declared.platform} (node ${declared.nodeMajor}): a child spawned with an EMPTY environment`), "the floor for this platform is not declared in the normalizer's element E");
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(Object.keys(process.env)))"], { env: {}, encoding: "utf8", windowsHide: true });
  assert.strictEqual(r.status, 0, `empty-env child did not run: ${r.error && r.error.message} ${r.stderr}`);
  const got = JSON.parse(r.stdout).map((k) => k.toUpperCase()).sort();
  const parentHas = floor.filter((n) => Object.keys(process.env).some((k) => k.toUpperCase() === n)).sort();
  assert.deepStrictEqual(got, parentHas, `the runtime refilled a set other than the declared floor: got [${got}], declared-and-present [${parentHas}]`);
});

test(`${FALSIFIER_ID}: the real tests/quarantine.json is never touched`, () => {
  const realAfter = fs.existsSync(REAL_QUARANTINE) ? fs.readFileSync(REAL_QUARANTINE) : null;
  assert.ok(realBefore === null ? realAfter === null : realAfter !== null && realBefore.equals(realAfter), "the real quarantine artifact changed during the falsifier");
});
