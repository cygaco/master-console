"use strict";
// FALSIFIER: unbrokered-merge-bypass — record-trust gate.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

test("unbrokered-merge-bypass — a direct `git update-ref` on refs/heads/main with NO controller fence is REFUSED", (t) => {
  const { git, makeScratchRepo, installHook, headSha, noFenceEnv, rmrf } = require("./_lib/git-scratch");

  const dir = makeScratchRepo("unbrokered");
  installHook(dir);
  t.after(() => rmrf(dir));

  const before = headSha(dir, "refs/heads/main");

  const co = git(dir, ["checkout", "-q", "-b", "candidate"], { env: noFenceEnv() });
  assert.strictEqual(co.status, 0, "checking out a side branch must succeed (not a protected ref)");
  fs.writeFileSync(path.join(dir, "candidate.txt"), "un-brokered write\n");
  git(dir, ["add", "."]);
  const commitRes = git(dir, ["commit", "-q", "-m", "candidate on a side ref"], { env: noFenceEnv() });
  assert.strictEqual(commitRes.status, 0, "the candidate commit itself (on the SIDE branch, not main) must succeed");
  const candidate = headSha(dir);

  const attack = git(dir, ["update-ref", "refs/heads/main", candidate], { env: noFenceEnv() });

  assert.notStrictEqual(attack.status, 0, "MUST-BLOCK: an un-brokered update-ref on refs/heads/main must be REFUSED (exit non-zero)");
  assert.match(attack.stderr, /reference-transaction hook|REFUSED|no-current-controller-fence/i, "the hook's own refusal must be surfaced");

  const after = headSha(dir, "refs/heads/main");
  assert.strictEqual(after, before, "MUST-BLOCK: refs/heads/main must be UNCHANGED after the refused attack");
});
