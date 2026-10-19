"use strict";
// FALSIFIER: write-surface-delegation-completeness — record-trust gate. The integration surface inventory names FOUR normal main-write surfaces — `update-ref`,
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const HOOK = path.join(__dirname, "..", "..", "hooks", "protected-ref-transaction.js");

test("write-surface-delegation-completeness — update-ref / fast-forward merge / non-ff merge / push are ALL refused un-brokered", () => {
  const { git, makeScratchRepo, makeBareRemote, installHook, headSha, noFenceEnv, rmrf } = require("./_lib/git-scratch");

  {
    const dir = makeScratchRepo("delegcomplete-updateref");
    installHook(dir);
    const before = headSha(dir, "refs/heads/main");
    git(dir, ["checkout", "-q", "-b", "cand"], { env: noFenceEnv() });
    fs.writeFileSync(path.join(dir, "x.txt"), "1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "cand"], { env: noFenceEnv() });
    const cand = headSha(dir);
    const r = git(dir, ["update-ref", "refs/heads/main", cand], { env: noFenceEnv() });
    assert.notStrictEqual(r.status, 0, "MUST-BLOCK: un-brokered update-ref");
    assert.strictEqual(headSha(dir, "refs/heads/main"), before);
    rmrf(dir);
  }

  {
    const dir = makeScratchRepo("delegcomplete-ff");
    installHook(dir);
    const before = headSha(dir, "refs/heads/main");
    git(dir, ["checkout", "-q", "-b", "cand"], { env: noFenceEnv() });
    fs.writeFileSync(path.join(dir, "y.txt"), "1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "cand-ff"], { env: noFenceEnv() });
    git(dir, ["checkout", "-q", "main"], { env: noFenceEnv() });
    const r = git(dir, ["merge", "--ff-only", "cand"], { env: noFenceEnv() });
    assert.notStrictEqual(r.status, 0, "MUST-BLOCK: un-brokered fast-forward merge into main — " + r.stdout + r.stderr);
    assert.strictEqual(headSha(dir, "refs/heads/main"), before);
    rmrf(dir);
  }

  {
    const dir = makeScratchRepo("delegcomplete-nonff");
    installHook(dir);
    const lease = require("../conductor-lease");
    const { fenceEnv } = require("./_lib/git-scratch");
    const leaseRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "delegcomplete-lease-"));
    const spId = "SP-DELEGCOMPLETE-NONFF";
    const acquired = lease.acquire(spId, { root: leaseRoot, sessionId: "nonff" });

    git(dir, ["checkout", "-q", "-b", "side"], { env: noFenceEnv() });
    fs.writeFileSync(path.join(dir, "side.txt"), "1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "side-commit"], { env: noFenceEnv() });
    const sideSha = headSha(dir);

    git(dir, ["checkout", "-q", "main"], { env: noFenceEnv() });
    fs.writeFileSync(path.join(dir, "main-only.txt"), "1\n");
    git(dir, ["add", "."]);
    const mainCommit = git(dir, ["commit", "-q", "-m", "main-commit"], { env: fenceEnv(spId, acquired.token, leaseRoot, noFenceEnv()) });
    assert.strictEqual(mainCommit.status, 0, "a FENCED commit on main must succeed (establishing real divergence)");
    const before = headSha(dir, "refs/heads/main");

    const r = git(dir, ["merge", "-q", "-m", "merge side", "side"], { env: noFenceEnv() });
    assert.notStrictEqual(r.status, 0, "MUST-BLOCK: un-brokered non-ff merge into main — " + r.stdout + r.stderr);
    assert.strictEqual(headSha(dir, "refs/heads/main"), before);
    void sideSha;
    rmrf(dir);
    rmrf(leaseRoot);
  }

  {
    const remote = makeBareRemote("delegcomplete-push");
    installHook(remote);
    const clientDir = makeScratchRepo("delegcomplete-push-client");
    git(clientDir, ["remote", "add", "origin", remote.replace(/\\/g, "/")]);
    git(clientDir, ["push", "-q", "origin", "main"], { env: noFenceEnv() });
    const remoteHeadAfterSeed = headSha(remote, "refs/heads/main");

    fs.writeFileSync(path.join(clientDir, "push.txt"), "1\n");
    git(clientDir, ["add", "."]);
    git(clientDir, ["commit", "-q", "-m", "push-candidate"], { env: fenceEnvForSeed() });
    const r = git(clientDir, ["push", "-q", "origin", "main"], { env: noFenceEnv() });
    assert.notStrictEqual(r.status, 0, "MUST-BLOCK: an un-brokered push to the remote's main must be REFUSED by the remote's own hook — " + r.stdout + r.stderr);
    assert.strictEqual(headSha(remote, "refs/heads/main"), remoteHeadAfterSeed, "the remote's main must be unchanged by the refused push");

    rmrf(remote);
    rmrf(clientDir);

    function fenceEnvForSeed() {
      return noFenceEnv();
    }
  }

  const hookSrc = fs.readFileSync(HOOK, "utf8");
  for (const term of ["core.hooksPath", ".git/refs", "hostile"]) {
    assert.ok(hookSrc.includes(term), `the hook's own doc comment must NAME the uncovered ceiling term "${term}" (an honest, evidence-grounded ceiling, never a silent gap)`);
  }
});
