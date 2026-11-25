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

function env() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_") || k === "NODE_TEST_CONTEXT") delete e[k];
  return e;
}
function git(dir, args) {
  const g = spawnSync("git", args, { cwd: dir, env: env(), encoding: "utf8" });
  if (g.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${g.stderr || g.stdout}`);
  return g.stdout.trim();
}

function withRepo(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rtskp-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, ...rel.split("/"));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    git(dir, ["init", "-q"]);
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.name=f", "-c", "user.email=f@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "--allow-empty", "-m", "base"]);
    const base = git(dir, ["rev-parse", "HEAD"]);
    const q = { entries: [], $floor: 1, base, $normalizer: DECL.NORMALIZER_DECLARATION, $dropClass: DECL.DROP_CLASS_DECLARATION, $ceilings: DECL.CEILINGS };
    fs.writeFileSync(path.join(dir, "tests", "quarantine.json"), JSON.stringify(q, null, 2) + "\n", "utf8");
    git(dir, ["add", "-A"]);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [RUNNER, "--root", dir, ...args], { cwd: dir, env: env(), encoding: "utf8", timeout: 120000, windowsHide: true });
  assert.strictEqual(r.error, undefined, String(r.error));
  assert.notStrictEqual(r.status, null);
  return { status: r.status, out: `${r.stdout || ""}\n${r.stderr || ""}` };
}

const FILES = { "tests/ok/pass.test.js": PASSING, "tests/helper.js": "module.exports = 1;\n" };
const SKIP_LINE = "run-tests: SKIPPED requested file (not a discoverable test): tests/helper.js";

test("(a) an undiscoverable requested file is reported on its own line and counted; default exit stays 0", () => {
  withRepo(FILES, (dir) => {
    const r = run(dir, ["--files", "tests/ok/pass.test.js,tests/helper.js"]);
    assert.strictEqual(r.status, 0, r.out);
    assert.ok(r.out.includes(SKIP_LINE), r.out);
    assert.match(r.out, /skipped_requested: 1 /, r.out);
  });
});

test("(b) --fail-on-skip turns a skipped requested file into a non-zero exit", () => {
  withRepo(FILES, (dir) => {
    const r = run(dir, ["--files", "tests/ok/pass.test.js,tests/helper.js", "--fail-on-skip"]);
    assert.notStrictEqual(r.status, 0, r.out);
    assert.ok(r.out.includes(SKIP_LINE), r.out);
    assert.match(r.out, /run-tests: FAIL — /, r.out);
    assert.match(r.out, /--fail-on-skip: 1 requested file/, r.out);
  });
});

test("(c) when every requested file is discoverable nothing is skipped, with or without --fail-on-skip", () => {
  withRepo(FILES, (dir) => {
    for (const extra of [[], ["--fail-on-skip"]]) {
      const r = run(dir, ["--files", "tests/ok/pass.test.js", ...extra]);
      assert.strictEqual(r.status, 0, r.out);
      assert.ok(!r.out.includes("SKIPPED requested file"), r.out);
      assert.match(r.out, /skipped_requested: 0 /, r.out);
    }
  });
});
