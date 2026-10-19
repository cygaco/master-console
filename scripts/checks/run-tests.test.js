#!/usr/bin/env node
"use strict";

const FALSIFIER_ID = "RUN-TESTS-FOCUSED";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(REAL_ROOT, "scripts", "checks", "run-tests.js");
const RUNNER_TIMEOUT_MS = 2 * 60 * 1000;

const RUNNER_DECL = require(RUNNER);
const PASSING = 'const test = require("node:test");\ntest("dummy passes", () => {});\n';
const FAILING = 'const test = require("node:test");\nconst assert = require("node:assert");\ntest("dummy rotted", () => { assert.strictEqual(1, 2, "dummy rot: still failing"); });\n';

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_") || k === "NODE_TEST_CONTEXT") delete env[k];
  return env;
}

function entry(file, over) {
  return {
    file,
    causeLines: ["1 !== 2", "dummy rot: still failing"],
    failCount: 1,
    cause: "falsifier-dummy",
    filedUnder: "FIXTURE-TICKET-1",
    expiry: "a later test-rot cleanup sprint",
    expiryVersion: "99.0.0",
    observedOn: RUNNER_DECL.currentStamp(),
    ...(over || {}),
  };
}

function fixtureCommit(dir) {
  const c = spawnSync("git", ["-c", "user.name=falsifier-fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "--allow-empty", "-m", "fixture base"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  if (c.status !== 0) throw new Error(`git commit failed: ${c.stderr || c.stdout}`);
  const h = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  if (h.status !== 0) throw new Error(`git rev-parse HEAD failed: ${h.stderr || h.stdout}`);
  return h.stdout.trim();
}

function withRepo(files, quarantineEntries, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtflt-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    for (const args of [["init", "-q"], ["add", "-A"]]) {
      const g = spawnSync("git", args, { cwd: dir, env: cleanEnv(), encoding: "utf8" });
      if (g.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${g.stderr || g.stdout}`);
    }
    const base = fixtureCommit(dir);
    const q = {
      entries: quarantineEntries || [],
      $floor: 1,
      base,
      $normalizer: RUNNER_DECL.NORMALIZER_DECLARATION,
      $dropClass: RUNNER_DECL.DROP_CLASS_DECLARATION,
      $ceilings: RUNNER_DECL.CEILINGS,
    };
    fs.writeFileSync(path.join(dir, "tests", "quarantine.json"), JSON.stringify(q, null, 2) + "\n", "utf8");
    const g = spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    if (g.status !== 0) throw new Error(`git add -A failed: ${g.stderr || g.stdout}`);
    return fn(dir);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
    }
  }
}

function runRunner(dir, args) {
  const r = spawnSync(process.execPath, [RUNNER, "--root", dir, ...(args || [])], {
    cwd: dir,
    env: cleanEnv(),
    encoding: "utf8",
    timeout: RUNNER_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  assert.strictEqual(r.error, undefined, `runner did not run to an exit code (spawn error / timeout): ${r.error && r.error.message}\n${out}`);
  assert.notStrictEqual(r.status, null, `runner was killed by ${r.signal} — not an observed exit code\n${out}`);
  return { status: r.status, out };
}

const FILES = {
  "tests/ok/pass.test.js": PASSING,
  "tests/ok/fails.test.js": FAILING,
  "tests/q/still-fails.test.js": FAILING,
};

test(`${FALSIFIER_ID} (a): --files restricts the primary run to exactly the named test file`, () => {
  withRepo(FILES, [], (dir) => {
    const r = runRunner(dir, ["--files", "tests/ok/pass.test.js"]);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /run-tests: PASS — focused \(1 requested\): primary: 1 file\(s\)/, r.out);
  });
});

test(`${FALSIFIER_ID} (b): --files resolving to ZERO files exits 3, distinct from both 0 and the full run's 1`, () => {
  withRepo(FILES, [], (dir) => {
    const r = runRunner(dir, ["--files", "tests/does/not/exist.test.js"]);
    assert.strictEqual(r.status, 3, `expected exit 3 ("no focused tests"), got ${r.status}\n${r.out}`);
    assert.match(r.out, /zero focused test files resolved from --files\/--files-from \(no focused tests\)/, r.out);
    assert.doesNotMatch(r.out, /zero non-quarantined test files/, "the focused-mode zero-files message must not be the full-run one\n" + r.out);
  });
});

test(`${FALSIFIER_ID} (c): a focused file that exists but FAILS propagates the primary's real exit code, not 3`, () => {
  withRepo(FILES, [], (dir) => {
    const r = runRunner(dir, ["--files", "tests/ok/fails.test.js"]);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.out, /run-tests: FAIL — focused \(1 requested\): primary: 1 file\(s\).*exit 1/, r.out);
  });
});

test(`${FALSIFIER_ID} (base-generic): a register naming a base that is NOT a commit in THIS repo → FAIL — the generic base-validity check`, () => {
  withRepo({ "tests/ok/pass.test.js": PASSING }, [], (dir) => {
    const qf = path.join(dir, "tests", "quarantine.json");
    const q = JSON.parse(fs.readFileSync(qf, "utf8"));
    q.base = "cccccccccccccccccccccccccccccccccccccccc";
    fs.writeFileSync(qf, JSON.stringify(q, null, 2) + "\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    const r = runRunner(dir, []);
    assert.strictEqual(r.status, 1, `a register whose base is not a real commit must FAIL the run\n${r.out}`);
    assert.match(r.out, /is not a commit available/, r.out);
  });
});

test(`${FALSIFIER_ID} (absent-register): an ABSENT quarantine register is an EMPTY register — the runner proceeds to run the discovered tests, it is NOT a hard error`, () => {
  withRepo({ "tests/ok/pass.test.js": PASSING }, [], (dir) => {
    fs.rmSync(path.join(dir, "tests", "quarantine.json"), { force: true });
    spawnSync("git", ["add", "-A"], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
    const r = runRunner(dir, []);
    assert.strictEqual(r.status, 0, `an absent register must be an empty register (run the discovered tests), not a hard error\n${r.out}`);
    assert.doesNotMatch(r.out, /cannot read quarantine artifact/, r.out);
    assert.match(r.out, /empty register, fresh install/, r.out);
  });
});

test(`${FALSIFIER_ID} (d): quarantine TEETH are SKIPPED in focused mode by default — a passing focused file stays green even though an unrelated quarantine entry would otherwise fail the run`, () => {
  withRepo(FILES, [entry("tests/q/still-fails.test.js")], (dir) => {
    const r = runRunner(dir, ["--files", "tests/ok/pass.test.js"]);
    assert.strictEqual(r.status, 0, `focused mode must not pay for the quarantine teeth by default\n${r.out}`);
    assert.match(r.out, /quarantine teeth SKIPPED \(focused mode/, r.out);
    assert.match(r.out, /quarantine: SKIPPED \(focused mode\)/, r.out);
  });
});

test(`${FALSIFIER_ID} (e): --with-quarantine additively RE-ENABLES the teeth in focused mode`, () => {
  withRepo(FILES, [entry("tests/q/still-fails.test.js")], (dir) => {
    const r = runRunner(dir, ["--files", "tests/ok/pass.test.js", "--with-quarantine"]);
    assert.strictEqual(r.status, 0, `the still-failing quarantine entry should hold (teeth re-enabled, but it IS still failing)\n${r.out}`);
    assert.match(r.out, /run-tests: quarantine tests\/q\/still-fails\.test\.js still fails/, r.out);
    assert.match(r.out, /quarantine: 1 entry, 1 still failing/, r.out);
  });
});

test(`${FALSIFIER_ID} (f): a quarantined file named in --files is still subtracted from the primary run (same subtraction as the full run)`, () => {
  withRepo(FILES, [entry("tests/q/still-fails.test.js")], (dir) => {
    const r = runRunner(dir, ["--files", "tests/q/still-fails.test.js"]);
    assert.strictEqual(r.status, 3, `a focused request for only a quarantined file must resolve to zero primary files\n${r.out}`);
  });
});

test(`${FALSIFIER_ID} (g): --files-from reads a JSON array file and behaves identically to --files`, () => {
  withRepo(FILES, [], (dir) => {
    const listFile = path.join(dir, "focused-list.json");
    fs.writeFileSync(listFile, JSON.stringify(["tests/ok/pass.test.js"]), "utf8");
    const r = runRunner(dir, ["--files-from", listFile]);
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /run-tests: PASS — focused \(1 requested\): primary: 1 file\(s\)/, r.out);
  });
});

test(`${FALSIFIER_ID} (h): --files-from also accepts {"files":[...]}`, () => {
  withRepo(FILES, [], (dir) => {
    const listFile = path.join(dir, "focused-list.json");
    fs.writeFileSync(listFile, JSON.stringify({ files: ["tests/ok/pass.test.js"] }), "utf8");
    const r = runRunner(dir, ["--files-from", listFile]);
    assert.strictEqual(r.status, 0, r.out);
  });
});

test(`${FALSIFIER_ID} (i): --files and --files-from are mutually exclusive (usage error, exit 2)`, () => {
  withRepo(FILES, [], (dir) => {
    const listFile = path.join(dir, "focused-list.json");
    fs.writeFileSync(listFile, JSON.stringify(["tests/ok/pass.test.js"]), "utf8");
    const r = runRunner(dir, ["--files", "tests/ok/pass.test.js", "--files-from", listFile]);
    assert.strictEqual(r.status, 2, r.out);
  });
});

test(`${FALSIFIER_ID} (j): a malformed --files-from file is a usage-level failure (exit 2), distinct from a focused run finding nothing (exit 3)`, () => {
  withRepo(FILES, [], (dir) => {
    const listFile = path.join(dir, "focused-list.json");
    fs.writeFileSync(listFile, "{ not json", "utf8");
    const r = runRunner(dir, ["--files-from", listFile]);
    assert.strictEqual(r.status, 2, r.out);
  });
});

test(`${FALSIFIER_ID} (k) CONTROL: the full run (no new flags) prints the full-run summary with no focused-mode prefix — proof the additive flags change nothing when absent`, () => {
  withRepo(FILES, [entry("tests/q/still-fails.test.js")], (dir) => {
    const r = runRunner(dir, []);
    assert.strictEqual(r.status, 1, r.out);
    assert.match(r.out, /run-tests: FAIL — primary: 2 file\(s\) in 1 batch\(es\), exit 1 /, `the full-run summary line must carry NO focused-mode prefix\n${r.out}`);
    assert.match(r.out, /quarantine: 1 entry, 1 still failing, 0 unexpectedly passed, 0 missing\/undiscovered, 0 unobserved/, r.out);
    assert.doesNotMatch(r.out, /run-tests:.*— focused/, `the full-run summary line must never carry a focused-mode prefix\n${r.out}`);
  });
});

test(`${FALSIFIER_ID} (l): normalizeFocusedFile strips a leading ./ and converts an absolute path under root to repo-relative, forward-slash form`, () => {
  const { normalizeFocusedFile } = RUNNER_DECL;
  assert.strictEqual(normalizeFocusedFile("./tests/ok/pass.test.js", REAL_ROOT), "tests/ok/pass.test.js");
  assert.strictEqual(normalizeFocusedFile("tests\\ok\\pass.test.js", REAL_ROOT), "tests/ok/pass.test.js");
  assert.strictEqual(normalizeFocusedFile(path.join(REAL_ROOT, "tests", "ok", "pass.test.js"), REAL_ROOT), "tests/ok/pass.test.js");
});

test(`${FALSIFIER_ID} (m): a test file that spawns gauntlet-package.js into an isolated --root fixture without ever pinning CLAUDE_PROJECT_DIR is flagged`, () => {
  const { checkCliRootPinning } = RUNNER_DECL;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtpin-bad-"));
  try {
    fs.writeFileSync(
      path.join(dir, "bad.test.js"),
      [
        'const { spawnSync } = require("child_process");',
        'const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "x-"));',
        'spawnSync(process.execPath, [CLI_PATH_TO_gauntlet-package.js, "select", "--root", dir]);',
      ].join("\n"),
    );
    const problems = checkCliRootPinning(dir, ["bad.test.js"]);
    assert.strictEqual(problems.length, 1, JSON.stringify(problems));
    assert.match(problems[0], /bad\.test\.js.*never pins CLAUDE_PROJECT_DIR/, problems[0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} (n) regression guard: the same shape WITH a CLAUDE_PROJECT_DIR pin is not flagged`, () => {
  const { checkCliRootPinning } = RUNNER_DECL;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtpin-good-"));
  try {
    fs.writeFileSync(
      path.join(dir, "good.test.js"),
      [
        'const { spawnSync } = require("child_process");',
        'const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "x-"));',
        'spawnSync(process.execPath, [CLI_PATH_TO_gauntlet-package.js, "select", "--root", dir], { env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });',
      ].join("\n"),
    );
    const problems = checkCliRootPinning(dir, ["good.test.js"]);
    assert.deepStrictEqual(problems, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} (o) regression guard: a file that spawns the CLI WITHOUT an isolated --root fixture (ambient-by-design) is never flagged`, () => {
  const { checkCliRootPinning } = RUNNER_DECL;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtpin-ambient-"));
  try {
    fs.writeFileSync(
      path.join(dir, "ambient.test.js"),
      [
        'const { spawnSync } = require("child_process");',
        'spawnSync(process.execPath, [CLI_PATH_TO_full.js, "a new feature"], { env: { ...process.env, MC_SPRINT_ID: "SP-x" } });',
      ].join("\n"),
    );
    const problems = checkCliRootPinning(dir, ["ambient.test.js"]);
    assert.deepStrictEqual(problems, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} (p): the real run-tests.js main() refuses before running anything when the guard finds a violation`, () => {
  const badPinFile = [
    'const test = require("node:test");',
    'test("dummy passes", () => {});',
    '// const dir = fs.mkdtempSync(path.join(os.tmpdir(), "x-"));',
    '// spawnSync(process.execPath, [CLI_PATH_TO_gauntlet-package.js, "select", "--root", dir]);',
  ].join("\n");
  withRepo({ ...FILES, "tests/ok/bad-pin.test.js": badPinFile }, [], (dir) => {
    const r = runRunner(dir, []);
    assert.notStrictEqual(r.status, 0, r.out);
    assert.match(r.out, /CLI root-pinning guard/, r.out);
    assert.match(r.out, /never pins CLAUDE_PROJECT_DIR/, r.out);
  });
});
