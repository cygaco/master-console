"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(REAL_ROOT, "scripts", "checks", "run-tests.js");
const DECL = require(RUNNER);
const PASSING = 'const test = require("node:test");\ntest("dummy passes", () => {});\n';
const FAILING = 'const test = require("node:test");\nconst assert = require("node:assert");\ntest("dummy rotted", () => { assert.strictEqual(1, 2, "dummy rot: still failing"); });\n';

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_") || k === "NODE_TEST_CONTEXT") delete env[k];
  return env;
}

function git(dir, args) {
  const g = spawnSync("git", ["-c", "user.name=golden-fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  if (g.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${g.stderr || g.stdout}`);
  return g.stdout.trim();
}

function entry(file) {
  return {
    file,
    causeLines: ["1 !== 2", "dummy rot: still failing"],
    failCount: 1,
    cause: "golden-fixture",
    filedUnder: "FIXTURE-TICKET-1",
    expiry: "a later test-rot cleanup sprint",
    expiryVersion: "99.0.0",
    observedOn: DECL.currentStamp(),
  };
}

function withRepo({ files, quarantined = [], baseOverride }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtgld-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    git(dir, ["init", "-q"]);
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--no-verify", "--allow-empty", "-m", "fixture base"]);
    const base = git(dir, ["rev-parse", "HEAD"]);
    const q = {
      entries: quarantined.map(entry),
      $floor: 1,
      base: baseOverride || base,
      $normalizer: DECL.NORMALIZER_DECLARATION,
      $dropClass: DECL.DROP_CLASS_DECLARATION,
      $ceilings: DECL.CEILINGS,
    };
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tests", "quarantine.json"), JSON.stringify(q, null, 2) + "\n", "utf8");
    git(dir, ["add", "-A"]);
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { }
  }
}

function runRunner(dir, args) {
  const r = spawnSync(process.execPath, [RUNNER, "--root", dir, ...(args || [])], {
    cwd: dir, env: cleanEnv(), encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  assert.strictEqual(r.error, undefined, `runner did not run to an exit code: ${r.error && r.error.message}\n${out}`);
  assert.notStrictEqual(r.status, null, `runner killed by ${r.signal}\n${out}`);
  return { status: r.status, out };
}

test("GOLDEN test-runner-quarantine: a green suite exits 0 (full run, empty register)", () => {
  withRepo({ files: { "tests/ok/pass.test.js": PASSING } }, (dir) => {
    const r = runRunner(dir);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /run-tests: PASS/, r.out);
  });
});

test("GOLDEN test-runner-quarantine: control - a quarantined file that still fails keeps the run green", () => {
  withRepo({ files: { "tests/ok/pass.test.js": PASSING, "tests/q/rot.test.js": FAILING }, quarantined: ["tests/q/rot.test.js"] }, (dir) => {
    const r = runRunner(dir);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /1 still failing, 0 unexpectedly passed/, r.out);
  });
});

test("GOLDEN test-runner-quarantine: a quarantined file that now PASSES fails the run", () => {
  withRepo({ files: { "tests/ok/pass.test.js": PASSING, "tests/q/healed.test.js": PASSING }, quarantined: ["tests/q/healed.test.js"] }, (dir) => {
    const r = runRunner(dir);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.out, /UNEXPECTEDLY PASSED: quarantined file tests\/q\/healed\.test\.js/, r.out);
    assert.match(r.out, /run-tests: FAIL/, r.out);
  });
});

test("GOLDEN test-runner-quarantine: a quarantine base that is not a real commit fails the run", () => {
  const fake = "0123456789abcdef0123456789abcdef01234567";
  withRepo({ files: { "tests/ok/pass.test.js": PASSING }, baseOverride: fake }, (dir) => {
    const r = runRunner(dir);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.out, /register's base 0123456789abcdef0123456789abcdef01234567 is not a commit/, r.out);
  });
});

test("GOLDEN test-runner-quarantine: a focused run resolving zero files exits 3", () => {
  withRepo({ files: { "tests/ok/pass.test.js": PASSING } }, (dir) => {
    const r = runRunner(dir, ["--files", "tests/does/not/exist.test.js"]);
    assert.strictEqual(r.status, 3, r.out);
    assert.match(r.out, /zero focused test files resolved/, r.out);
  });
});
