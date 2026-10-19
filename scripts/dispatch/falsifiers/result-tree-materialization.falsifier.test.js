"use strict";
// FALSIFIER: result-tree-materialization — record-trust gate. The controller must scan EXACTLY result_commit's tree, materialized into a
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

test("result-tree-materialization — gitRoot's working tree is clean-at-base, but result_commit's REAL tree is poisoned -> integration REFUSED (no-nul-bytes fires over the MATERIALIZED tree)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("materialization-poison");
  t.after(() => fx.cleanup());

  const poisonedResult = fx.poisonResultCommit();

  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: fx.dir, encoding: "utf8", windowsHide: true }).trim();
  sh("git", ["checkout", "-q", "trunk"]);
  sh("git", ["reset", "-q", "--hard", fx.base]);
  assert.strictEqual(fs.readFileSync(path.join(fx.dir, "f.txt"), "utf8").trim(), "base", "PRECONDITION: gitRoot's working tree is genuinely clean-at-base");
  assert.ok(!fs.existsSync(path.join(fx.dir, "scripts", "checks", "poison.js")), "PRECONDITION: the poison file does not exist in gitRoot's CURRENT working tree");

  const input = standardInput(fx, { result_commit: poisonedResult });
  const result = ctl.integrate(input, standardOpts(fx));

  assert.strictEqual(result.ok, false, "MUST-BLOCK: the REAL result_commit tree is poisoned, regardless of what gitRoot's working directory currently shows");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "check-failed");
  assert.strictEqual(result.offending, "no-nul-bytes");

  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.base, "the ref must never have advanced");
});

test("result-tree-materialization — CONTROL: the same clean-at-base working tree with a CLEAN result_commit integrates normally (proves the block above is about the poison, not an incidental side effect of the working-tree state)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const { headSha } = require("./_lib/git-scratch");
  const ctl = require("../trusted-controller");

  const fx = makeControllerFixture("materialization-control");
  t.after(() => fx.cleanup());

  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: fx.dir, encoding: "utf8", windowsHide: true }).trim();
  sh("git", ["checkout", "-q", "trunk"]);
  sh("git", ["reset", "-q", "--hard", fx.base]);

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result);
});
