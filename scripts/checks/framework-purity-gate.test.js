"use strict";
/**
 * framework-purity-gate.test.js — RED proof for the S-OS-04 fail-closed, full-tree
 * default of scripts/checks/framework-purity.js, against a throwaway git repo
 * (WARPOS_PURITY_ROOT seam). Companion to framework-purity.test.js (detector units)
 * and test-framework-purity-staged.js (WI-23 staged/diff scoping).
 *
 *   node --test scripts/checks/framework-purity-gate.test.js
 *
 * Planted strings are built at runtime so this file never carries a private slug
 * or a home path literally (the gate scans this file too).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "framework-purity.js");
const { CLIENT_SLUGS, inAbsPathScope } = require("./framework-purity");

const SLUG = CLIENT_SLUGS[0];
const HOME_PATH_NEW = ["C:", "Users", "Vlad", "Desktop", "x"].join("\\"); // current home form
const HOME_PATH_OLD = ["C:", "Users", "Vladislav", "Desktop", "x"].join("\\"); // old home form

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-gate-"));
  const git = (a) => execSync(`git ${a}`, { cwd: dir, encoding: "utf8" });
  git("init -q");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "README.md"), "clean framework text\n");
  fs.writeFileSync(path.join(dir, "scripts", "ok.js"), "module.exports = 1;\n");
  git("add -A");
  git('-c user.name=t -c user.email=t@example.com commit -q -m init');
  return { dir, git };
}
function run(repo, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--json"], {
    encoding: "utf8",
    env: { ...process.env, WARPOS_PURITY_ROOT: repo },
  });
  return { code: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}

test("known-answer: a clean tracked tree exits 0 in the DEFAULT (full) mode", () => {
  const { dir } = makeRepo();
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.json.mode, "full");
  assert.strictEqual(r.json.scanned, 2);
});

test("RED proof: a tracked doc carrying a private slug fails the default mode (exit 1)", () => {
  const { dir, git } = makeRepo();
  fs.writeFileSync(path.join(dir, "docs", "leak.md"), `mentions ${SLUG} here\n`);
  git("add -A"); // staged adds count as tracked — the gate must see them before the commit
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.summary.client_slug, 1);
  assert.strictEqual(r.json.findings.client_slug[0].path, "docs/leak.md");
});

test("RED proof: the NEW home path in a scripts/*.js fails; the OLD one too; the same path in docs/*.md does not", () => {
  const { dir, git } = makeRepo();
  fs.writeFileSync(path.join(dir, "scripts", "bad.js"), `const p = ${JSON.stringify(HOME_PATH_NEW)};\n`);
  fs.writeFileSync(path.join(dir, "scripts", "old.js"), `const p = ${JSON.stringify(HOME_PATH_OLD)};\n`);
  fs.writeFileSync(path.join(dir, "docs", "history.md"), `the old checkout lived at ${HOME_PATH_NEW}\n`);
  git("add -A");
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  const flagged = r.json.findings.abs_path.map((f) => f.path).sort();
  assert.deepStrictEqual(flagged, ["scripts/bad.js", "scripts/old.js"]);
});

test("scope table: abs-path rule applies only to executable/config files under scripts/ and .claude/", () => {
  assert.strictEqual(inAbsPathScope("scripts/x.js"), true);
  assert.strictEqual(inAbsPathScope("scripts/a/b.ps1"), true);
  assert.strictEqual(inAbsPathScope(".claude/settings.json"), true);
  assert.strictEqual(inAbsPathScope(".claude/hooks/x.sh"), true);
  assert.strictEqual(inAbsPathScope("scripts/notes.md"), false);
  assert.strictEqual(inAbsPathScope("docs/x.js"), false);
  assert.strictEqual(inAbsPathScope("runtime/log.json"), false);
});

test("untracked files are NOT scanned in full mode (gitignored local state cannot false-RED the gate)", () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "docs", "local-scratch.md"), `${SLUG}\n`); // never added
  const r = run(dir);
  assert.strictEqual(r.code, 0, JSON.stringify(r.json && r.json.summary));
});

test("fail-closed: a non-git root exits 2, never 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-nogit-"));
  const r = run(dir);
  assert.strictEqual(r.code, 2);
});

test("live tree: the tracked repository passes the default gate (exit 0)", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--quiet"], { cwd: ROOT, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
