"use strict";
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

test("brokered-merge POSITIVE — the SAME direct update-ref on main, carrying a current controller fence, succeeds (CAS ok)", (t) => {
  const { git, makeScratchRepo, installHook, headSha, fenceEnv, noFenceEnv, rmrf } = require("./_lib/git-scratch");
  const lease = require("../conductor-lease");

  const dir = makeScratchRepo("brokered");
  installHook(dir);
  t.after(() => rmrf(dir));

  git(dir, ["checkout", "-q", "-b", "candidate"], { env: noFenceEnv() });
  fs.writeFileSync(path.join(dir, "candidate.txt"), "brokered write\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "candidate on a side ref"], { env: noFenceEnv() });
  const candidate = headSha(dir);

  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brokered-lease-"));
  const spId = "SP-BROKERED-POSITIVE";
  const acquired = lease.acquire(spId, { root: leaseRoot, sessionId: "brokered" });
  t.after(() => rmrf(leaseRoot));

  const result = git(dir, ["update-ref", "refs/heads/main", candidate], { env: fenceEnv(spId, acquired.token, leaseRoot, noFenceEnv()) });

  assert.strictEqual(result.status, 0, "a FENCED direct update-ref on main must succeed — " + result.stderr);
  assert.strictEqual(headSha(dir, "refs/heads/main"), candidate, "refs/heads/main must now point at the candidate");
});
