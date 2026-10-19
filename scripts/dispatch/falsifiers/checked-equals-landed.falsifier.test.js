"use strict";
/**
 * FALSIFIER: checked-equals-landed.
 *
 * THE ATTACK: the caller asks the transport to land a commit whose OWN tree FAILS the pinned suite, while
 * supplying a CLEAN tree alongside it (a `candidateRoot` pointing at a pristine directory, a clean working
 * directory on disk, a clean sibling commit). If the transport checked the tree it was HANDED rather than
 * the tree it will LAND, the suite would pass over the clean tree and the poisoned tree would land. That
 * is the checked ≠ landed false-green: the artifact that was verified is not the artifact that ships.
 *
 * MUST HOLD: the suite runs over the tree materialized from the landing commit's EXACT SHA, out of
 * the object store. A separately-supplied tree/working-dir/candidateRoot cannot be substituted. A failing
 * tree is REFUSED — main never moves.
 *
 * THE FAILURE IS REAL, NOT STUBBED: the poisoned commit carries a genuine NUL-byte file, which the pinned
 * `no-nul-bytes` check genuinely fails. No mocked verdict; a mocked failure would prove only that the code
 * propagates a mock.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ctl = require("../trusted-controller");
const { makeTransportFixture } = require("./_lib/transport-fixtures");
const { rmrf } = require("./_lib/git-scratch");

test("MUST-BLOCK — a merge whose OWN tree fails the suite is REFUSED even with a CLEAN tree supplied alongside", (t) => {
  const fx = makeTransportFixture("checked-landed");
  t.after(() => fx.cleanup());

  const poisonedTip = fx.poisonedBranch("poisoned");
  const poisonedMerge = fx.commitTree("poisoned", [fx.c1, poisonedTip], "merge poisoned work into main");

  const cleanTree = fs.mkdtempSync(path.join(os.tmpdir(), "checked-landed-clean-tree-"));
  fs.writeFileSync(path.join(cleanTree, "README.md"), "perfectly clean\n");
  t.after(() => rmrf(cleanTree));

  const before = fx.head("refs/heads/main");
  const res = ctl.integrateBranchMerge(
    { merge_commit: poisonedMerge, target_ref: fx.targetRef, tree: cleanTree, candidateRoot: cleanTree },
    fx.opts({ candidateRoot: cleanTree, root: cleanTree, treeRoot: cleanTree }),
  );

  assert.strictEqual(res.ok, false, "MUST-BLOCK: a commit whose landed tree fails the suite must be refused");
  assert.strictEqual(res.decision, "BLOCKED");
  assert.match(
    String(res.reason),
    /check-failed|pinned-suite-failed/,
    `refusal must come from the SUITE over the landed tree (got ${res.reason})`,
  );
  assert.strictEqual(fx.head("refs/heads/main"), before, "MUST-BLOCK: refs/heads/main must be UNCHANGED");
});

test("candidateRoot is UNPASSABLE: the candidate zone is always the materialized tree, never a caller's choice", () => {
  const clean = ctl.sanitizeTransportOpts({ bundleManifestPath: "m", bundleRoot: "b", gitRoot: "g", spId: "s", leaseRoot: "l", candidateRoot: "/tmp/clean" });
  assert.ok(!("candidateRoot" in clean), "MUST-BLOCK: candidateRoot must not survive sanitizeTransportOpts");
  assert.ok(!ctl.TRANSPORT_OPT_KEYS.includes("candidateRoot"), "TRANSPORT_OPT_KEYS must not admit candidateRoot");
});

test("the SAME poisoned tree fails while its clean sibling lands (the check is tree-specific, not a constant-reject)", (t) => {
  const fx = makeTransportFixture("checked-landed-pos");
  t.after(() => fx.cleanup());

  const cleanMerge = fx.commitTree("candidate", [fx.c1, fx.candidate], "clean merge");
  const ok = ctl.integrateBranchMerge({ merge_commit: cleanMerge, target_ref: fx.targetRef }, fx.opts());
  assert.strictEqual(ok.ok, true, `the clean sibling must LAND — got ${ok.decision}/${ok.reason}`);
  assert.strictEqual(fx.head("refs/heads/main"), cleanMerge, "main advanced to the clean merge");

  const poisonedTip = fx.poisonedBranch("poisoned2");
  const poisonedMerge = fx.commitTree("poisoned2", [cleanMerge, poisonedTip], "merge poison after a clean land");
  const bad = ctl.integrateBranchMerge({ merge_commit: poisonedMerge, target_ref: fx.targetRef }, fx.opts());
  assert.strictEqual(bad.ok, false, "MUST-BLOCK: the poisoned tree is refused even right after a successful land");
  assert.strictEqual(fx.head("refs/heads/main"), cleanMerge, "main must remain at the clean merge");
});
