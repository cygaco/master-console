"use strict";
// FALSIFIER: precommit-bypass-harmless — record-trust gate. Proves the BOUNDARY is the controller (Seam A/E), not pre-commit: a candidate created with
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const CONTROLLER = path.join(__dirname, "..", "trusted-controller.js");

test("precommit-bypass-harmless — a --no-verify candidate (skipping pre-commit-check-lib.js) still cannot land on main without the controller", (t) => {
  const { git, makeScratchRepo, installHook, headSha, noFenceEnv, rmrf } = require("./_lib/git-scratch");
  const { runCheckLibSuite } = require("../../hooks/pre-commit-check-lib");

  const dir = makeScratchRepo("precommit-bypass");
  installHook(dir);
  t.after(() => rmrf(dir));

  git(dir, ["checkout", "-q", "-b", "cand"], { env: noFenceEnv() });
  const poisonedRel = "scripts/checks/precommit-bypass-poison.js";
  fs.mkdirSync(path.join(dir, "scripts", "checks"), { recursive: true });
  fs.writeFileSync(path.join(dir, poisonedRel), Buffer.from([0x2f, 0x2f, 0x00, 0x0a]));
  git(dir, ["add", "."]);

  const localCheck = runCheckLibSuite({ root: dir });
  assert.strictEqual(localCheck.blocked, true, "the poisoned file must genuinely trip local check-lib feedback (a real, non-trivial poison)");

  const commitRes = git(dir, ["commit", "-q", "-m", "poisoned candidate", "--no-verify"], { env: noFenceEnv() });
  assert.strictEqual(commitRes.status, 0, "the --no-verify candidate commit itself succeeds (a side branch, not main)");
  const candidate = headSha(dir);

  const before = headSha(dir, "refs/heads/main");
  const attack1 = git(dir, ["update-ref", "refs/heads/main", candidate], { env: noFenceEnv() });
  assert.notStrictEqual(attack1.status, 0, "MUST-BLOCK: --no-verify does not bypass the reference-transaction fence (Seam E)");
  assert.strictEqual(headSha(dir, "refs/heads/main"), before);

  const { makeControllerFixture, standardInput, standardOpts } = require("./_lib/controller-fixtures");
  const ctl = require("../trusted-controller");
  const fx = makeControllerFixture("precommit-bypass-ctl");
  t.after(() => fx.cleanup());
  fs.mkdirSync(path.join(fx.dir, "scripts", "checks"), { recursive: true });
  fs.writeFileSync(path.join(fx.dir, poisonedRel), Buffer.from([0x2f, 0x2f, 0x00, 0x0a]));
  git(fx.dir, ["add", "."]);
  git(fx.dir, ["commit", "-q", "-m", "poisoned candidate", "--no-verify"], { env: noFenceEnv() });
  const poisonedResult = headSha(fx.dir);

  const ctlResult = ctl.integrate(standardInput(fx, { result_commit: poisonedResult }), standardOpts(fx));
  assert.strictEqual(ctlResult.ok, false, "MUST-BLOCK: the controller's OWN fresh pinned run must re-derive and catch the poison — a --no-verify commit authorizes NOTHING");
  assert.strictEqual(ctlResult.decision, "BLOCKED");
  assert.strictEqual(ctlResult.reason, "check-failed");
  assert.strictEqual(ctlResult.offending, "no-nul-bytes");
});
