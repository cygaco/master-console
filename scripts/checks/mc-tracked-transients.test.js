"use strict";
/**
 * mc-tracked-transients.test.js — RED proof + known-answer (S-OS-04 / ED-417).
 *
 *   node --test scripts/checks/mc-tracked-transients.test.js
 *
 * (1) pure-core evaluate() on synthetic candidates, (2) the CLI against a throwaway
 * git repo with a PLANTED tracked runtime/*.jsonl (must exit 1), (3) the CLI against
 * the live tree (must exit 0).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "mc-tracked-transients.js");
const { evaluate, loadAllowlist, TRANSCRIPT_TXT_MIN_BYTES } = require("./mc-tracked-transients");

function c(files) {
  return files.map((f) => ({ file: f, staged: false }));
}

test("known-answer: ordinary tracked files are not violations", () => {
  const r = evaluate(c(["scripts/x.js", "runtime/prior-art/notes.md", "runtime/sp/report.txt", "docs/a.jsonl"]), {
    sizeOf: () => 10,
  });
  assert.deepStrictEqual(r.violations, []);
});

test("RED: runtime/*.jsonl, *.log, *.diff, *.err, *.out are violations (nested too)", () => {
  for (const f of ["runtime/a.jsonl", "runtime/x/y/z.log", "runtime/w0/w0.diff", "runtime/p.err", "runtime/p.out"]) {
    const r = evaluate(c([f]), { sizeOf: () => 10 });
    assert.strictEqual(r.violations.length, 1, f);
  }
});

test("RED: transcript-like runtime/*.txt over the size cap is a violation; a small one is not", () => {
  const big = evaluate(c(["runtime/gauntlet/transcript.txt"]), { sizeOf: () => TRANSCRIPT_TXT_MIN_BYTES + 1 });
  assert.strictEqual(big.violations.length, 1);
  const small = evaluate(c(["runtime/gauntlet/transcript.txt"]), { sizeOf: () => TRANSCRIPT_TXT_MIN_BYTES });
  assert.strictEqual(small.violations.length, 0);
});

test("RED: anything under the beta mining output dir is a violation", () => {
  const r = evaluate(c([".claude/agents/president/_system/beta/mined/2026-09-01.md"]), { sizeOf: () => 1 });
  assert.strictEqual(r.violations.length, 1);
  assert.match(r.violations[0].reason, /mining/);
});

test("allowlist: an exact path with a reason is honoured; loader fails CLOSED on a malformed file", () => {
  const allow = new Map([["runtime/keep/me.jsonl", "fixture consumed by a test"]]);
  const r = evaluate(c(["runtime/keep/me.jsonl", "runtime/other.jsonl"]), { sizeOf: () => 1, allow });
  assert.strictEqual(r.violations.length, 1);
  assert.strictEqual(r.allowed.length, 1);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-allow-"));
  const bad = path.join(dir, "allow.json");
  fs.writeFileSync(bad, JSON.stringify({ allow: [{ path: "runtime/x.jsonl" }] })); // no reason
  assert.strictEqual(loadAllowlist(bad), null);
  fs.writeFileSync(bad, "{not json");
  assert.strictEqual(loadAllowlist(bad), null);
  const good = path.join(dir, "good.json");
  fs.writeFileSync(good, JSON.stringify({ allow: [] }));
  assert.strictEqual(loadAllowlist(good).size, 0);
  // The shipped allowlist must itself be well-formed (and preferably empty).
  assert.ok(loadAllowlist() instanceof Map);
});

test("RED proof (CLI): a throwaway repo with a tracked runtime/*.jsonl exits 1", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tt-repo-"));
  const git = (a) => execSync(`git ${a}`, { cwd: repo, encoding: "utf8" });
  git("init -q");
  fs.mkdirSync(path.join(repo, "runtime"));
  fs.writeFileSync(path.join(repo, "runtime", "session.jsonl"), '{"x":1}\n');
  fs.writeFileSync(path.join(repo, "README.md"), "clean\n");
  git("add -A");
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /runtime\/session\.jsonl/);
});

test("live tree: the tracked repository passes (exit 0)", () => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
  });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
