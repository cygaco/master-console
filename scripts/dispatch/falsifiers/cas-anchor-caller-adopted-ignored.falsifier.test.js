"use strict";
/**
 * FALSIFIER: cas-anchor-caller-adopted-ignored.
 *
 * THE ATTACK: a caller supplies its OWN CAS anchor — `base_commit` / `expectedHead` — on the input object
 * and through `opts`. If the transport ADOPTED it, the compare-and-swap would be performed against a head
 * the CALLER chose rather than the head that is actually live. That is the classic TOCTOU land: a merge
 * built on an old base gets swapped onto a ref that has since advanced, silently discarding the
 * intervening commit(s), with git's own CAS none the wiser because it was handed the stale value as
 * "expected".
 *
 * MUST HOLD: the caller's anchor is IGNORED — not validated, not preferred, never read. The CAS
 * `expectedHead` is ALWAYS the RE-RESOLVED live tip of the target ref.
 *
 * WHY THIS IS SHARPER THAN THE ENTRYPOINT UNIT TEST: the unit test asserts the RECEIPT reports the
 * live head. A receipt is a REPORT — a transport could report one anchor and pass another to git. Here we
 * intercept the ACTUAL `refUpdater` call and read the expectedHead argument that git would receive. What
 * is claimed and what is used are checked to be the same value. MUST-BLOCK on the stale-anchor variant.
 */
const test = require("node:test");
const assert = require("node:assert");

const ctl = require("../trusted-controller");
const { makeTransportFixture } = require("./_lib/transport-fixtures");

test("the CAS expectedHead handed to git is the RE-RESOLVED live head, NEVER the caller's supplied base_commit", (t) => {
  const fx = makeTransportFixture("anchor-spy");
  t.after(() => fx.cleanup());

  const merge = fx.commitTree("candidate", [fx.c1, fx.candidate], "merge candidate into main");
  assert.strictEqual(fx.head("refs/heads/main"), fx.c1, "precondition: main is live at c1");

  const seen = [];
  const res = ctl.integrateBranchMergeForTest(
    { merge_commit: merge, target_ref: fx.targetRef, base_commit: fx.c0, expectedHead: fx.c0 },
    fx.opts({ base_commit: fx.c0, expectedHead: fx.c0, anchor: fx.c0 }),
    {
      refUpdater: (targetRef, newHead, expectedHead, gitRoot) => {
        seen.push({ targetRef, newHead, expectedHead, gitRoot });
        return { ok: true };
      },
    },
  );

  assert.strictEqual(res.ok, true, `the bogus anchor must be IGNORED (not adopted, not fatal) — got ${res.decision}/${res.reason}`);
  assert.strictEqual(seen.length, 1, "the CAS must be invoked exactly once");

  const call = seen[0];
  assert.strictEqual(call.expectedHead, fx.c1, "MUST: git receives the RE-RESOLVED live head (c1) as the expected value");
  assert.notStrictEqual(call.expectedHead, fx.c0, "MUST-BLOCK: the caller-supplied base_commit (c0) must NEVER become the CAS anchor");
  assert.strictEqual(call.newHead, merge, "the landing commit is the merge commit itself");
  assert.strictEqual(call.targetRef, fx.targetRef);

  assert.strictEqual(res.receipt.previous_head, call.expectedHead, "the receipt must not report an anchor different from the one used");
});

test("a caller anchor cannot be smuggled through opts: sanitizeTransportOpts drops every anchor key", () => {
  const clean = ctl.sanitizeTransportOpts({
    bundleManifestPath: "m",
    bundleRoot: "b",
    gitRoot: "g",
    spId: "s",
    leaseRoot: "l",
    base_commit: "deadbeef",
    expectedHead: "deadbeef",
    anchor: "deadbeef",
  });
  for (const k of ["base_commit", "expectedHead", "anchor"]) {
    assert.ok(!(k in clean), `MUST-BLOCK: \`${k}\` must not survive sanitizeTransportOpts — an anchor must be UNPASSABLE, not merely unread`);
  }
  assert.ok(!ctl.TRANSPORT_OPT_KEYS.includes("base_commit"), "TRANSPORT_OPT_KEYS must not admit base_commit");
});

test("MUST-BLOCK — a merge built on the caller's claimed (stale) base is REFUSED once main advances", (t) => {
  const fx = makeTransportFixture("anchor-stale");
  t.after(() => fx.cleanup());

  const staleMerge = fx.commitTree("candidate", [fx.c0, fx.candidate], "merge built on a stale base");
  const before = fx.head("refs/heads/main");

  const res = ctl.integrateBranchMerge({ merge_commit: staleMerge, target_ref: fx.targetRef, base_commit: fx.c0 }, fx.opts({ base_commit: fx.c0 }));

  assert.strictEqual(res.ok, false, "MUST-BLOCK: a merge parented on a stale base must be refused");
  assert.strictEqual(res.decision, "BLOCKED");
  assert.strictEqual(res.reason, "merge-first-parent-not-live-head", "refused for the RIGHT, machine-checkable reason");
  assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED — c1 is not discarded");
});
