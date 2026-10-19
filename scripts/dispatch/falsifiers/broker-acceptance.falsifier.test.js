"use strict";
/**
 * FALSIFIER: broker-acceptance — the brokered-vs-un-brokered main-write pair.
 *
 * THE PAIRED CLAIM, proven end-to-end on a SCRATCH repo with the REAL `reference-transaction` hook:
 *   NEGATIVE — a NON-brokered main-write (a plain `git merge` / `git commit` / `git update-ref`, no lease,
 *              no fence) is REFUSED in the hook's PREPARED phase, so the ref NEVER MOVES.
 *   POSITIVE — a BROKERED write through the transport entrypoints (holding the lease, fence raised by
 *              `withControllerFence`) LANDS on that same repo, with that same hook installed.
 *
 * BOTH HALVES ARE REQUIRED. The negative alone is satisfied by a hook that refuses everything — which
 * would "secure" the ref by making it unwritable and would be caught only in production. The positive
 * alone proves nothing about un-brokered writes. Together they prove the fence discriminates on the ONE
 * property that matters: did this write come through the broker?
 *
 * PREPARED-PHASE MATTERS: `reference-transaction` fires `prepared` BEFORE the ref moves. A refusal there
 * means the write is rejected, not rolled back — no window in which main briefly holds an unverified head.
 *
 * HONEST CEILING (named, not papered over — this falsifier does NOT claim to close these): an attacker
 * who can redirect `core.hooksPath`, delete the hook file, write `.git/refs` directly, or forge the fence
 * env vars in their own process defeats this mechanism. Those are accepted risks, out of scope
 * for a repo-local hook, and are recorded as such rather than silently implied to be covered.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ctl = require("../trusted-controller");
const { makeTransportFixture } = require("./_lib/transport-fixtures");
const { git, noFenceEnv, hooksDirOf } = require("./_lib/git-scratch");

const HOOK = path.join(__dirname, "..", "..", "hooks", "protected-ref-transaction.js");

test("broker-acceptance — the REAL hook is genuinely installed in the scratch repo (precondition, not assumed)", (t) => {
  const fx = makeTransportFixture("broker-precond");
  t.after(() => fx.cleanup());
  const hookFile = path.join(hooksDirOf(fx.dir), "reference-transaction");
  assert.ok(fs.existsSync(HOOK), "the pinned hook module must exist in this repo");
  assert.ok(fs.existsSync(hookFile), "the scratch repo must carry a real reference-transaction hook");
  assert.match(fs.readFileSync(hookFile, "utf8"), /protected-ref-transaction/, "the installed hook must invoke the pinned module");
});

test("MUST-BLOCK — a NON-brokered `git update-ref` on refs/heads/main is REFUSED and the ref never moves", (t) => {
  const fx = makeTransportFixture("broker-neg-updateref");
  t.after(() => fx.cleanup());

  const before = fx.head("refs/heads/main");
  const attack = git(fx.dir, ["update-ref", "refs/heads/main", fx.candidate], { env: noFenceEnv() });

  assert.notStrictEqual(attack.status, 0, "MUST-BLOCK: an un-brokered update-ref must exit non-zero");
  assert.match(attack.stderr, /reference-transaction hook|REFUSED|no-current-controller-fence/i, "the hook's own refusal must surface");
  assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED (refused in `prepared`, not rolled back)");
});

test("MUST-BLOCK — a NON-brokered `git merge` into main is REFUSED and the ref never moves", (t) => {
  const fx = makeTransportFixture("broker-neg-merge");
  t.after(() => fx.cleanup());

  const before = fx.head("refs/heads/main");
  const attack = git(fx.dir, ["merge", "--no-ff", "-m", "un-brokered merge", "candidate"], { env: noFenceEnv() });

  assert.notStrictEqual(attack.status, 0, "MUST-BLOCK: an un-brokered merge into main must fail");
  assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED");
});

test("MUST-BLOCK — a NON-brokered `git commit` directly on main is REFUSED and the ref never moves", (t) => {
  const fx = makeTransportFixture("broker-neg-commit");
  t.after(() => fx.cleanup());

  const before = fx.head("refs/heads/main");
  fs.writeFileSync(path.join(fx.dir, "sneaky.txt"), "un-brokered content\n");
  git(fx.dir, ["add", "."], { env: noFenceEnv() });
  const attack = git(fx.dir, ["commit", "-q", "-m", "un-brokered commit on main"], { env: noFenceEnv() });

  assert.notStrictEqual(attack.status, 0, "MUST-BLOCK: an un-brokered commit on main must fail");
  assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED");
});

test("POSITIVE — a BROKERED merge through integrateBranchMerge LANDS on the same hook-fenced repo", (t) => {
  const fx = makeTransportFixture("broker-pos-merge");
  t.after(() => fx.cleanup());

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "brokered merge of candidate into main");
  const before = fx.head("refs/heads/main");

  const res = ctl.integrateBranchMerge({ merge_commit: merge, target_ref: fx.targetRef }, fx.opts());

  assert.strictEqual(res.ok, true, `the brokered write MUST land — got ${res.decision}/${res.reason} ${JSON.stringify(res.detail || "")}`);
  assert.strictEqual(res.decision, "LANDED");
  assert.notStrictEqual(fx.head("refs/heads/main"), before, "main must have moved");
  assert.strictEqual(fx.head("refs/heads/main"), merge, "main must point at the brokered merge commit");
  assert.strictEqual(res.receipt.hook_active, true, "the receipt must OBSERVE the live hook (observed, not gated — pre-flip dogfood)");
});

test("POSITIVE — a BROKERED release commit through integrateReleaseCommit LANDS on the same hook-fenced repo", (t) => {
  const fx = makeTransportFixture("broker-pos-release");
  t.after(() => fx.cleanup());

  const rel = fx.releaseCommit(fx.c1, "rel");
  const res = ctl.integrateReleaseCommit({ release_commit: rel, target_ref: fx.targetRef }, fx.opts());

  assert.strictEqual(res.ok, true, `the brokered release write MUST land — got ${res.decision}/${res.reason}`);
  assert.strictEqual(fx.head("refs/heads/main"), rel, "main must point at the brokered release commit");
});

test("DISCRIMINATION — on ONE repo, the un-brokered write is refused and the brokered write then lands", (t) => {
  const fx = makeTransportFixture("broker-discriminate");
  t.after(() => fx.cleanup());

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "candidate merge");
  const before = fx.head("refs/heads/main");

  const unbrokered = git(fx.dir, ["update-ref", "refs/heads/main", merge], { env: noFenceEnv() });
  assert.notStrictEqual(unbrokered.status, 0, "MUST-BLOCK: the un-brokered route is refused...");
  assert.strictEqual(fx.head("refs/heads/main"), before, "...and the ref did not move");

  const brokered = ctl.integrateBranchMerge({ merge_commit: merge, target_ref: fx.targetRef }, fx.opts());
  assert.strictEqual(brokered.ok, true, `...while the brokered route with the SAME commit lands — got ${brokered.reason}`);
  assert.strictEqual(fx.head("refs/heads/main"), merge, "the ref moved only via the broker");
});
