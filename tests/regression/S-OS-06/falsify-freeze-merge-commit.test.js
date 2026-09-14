#!/usr/bin/env node
"use strict";
/**
 * SEC-F2 falsify-freeze-merge-commit (BLOCKING tier, beside F8) — S-OS-06 security fix-cycle r2, finding F2 (HIGH).
 *
 * The F8 freeze history must inspect MERGE commits. Before the fix checkFreeze ran `git log --no-merges`, and its
 * foreign-file check used `git diff-tree` (empty for a merge), so an allow-list entry introduced BY a merge commit —
 * one no non-merge commit ever carried (an evil merge / conflict resolution) — was never judged: the working-tree layer
 * only asks for a baseline key or an amendment record, both of which the merge can supply itself.
 *
 * RED:   an entry introduced by a --no-ff merge commit beside merged live code -> cutover exit 1 [F8] (folded +
 *        unmarked); the same merge carrying the marker in its message still reds on the foreign-file check.
 * GREEN: a --no-ff merge of a live-code-only branch, and a --no-ff merge of a branch whose own non-merge commit is a
 *        proper partition-only marked amendment -> exit 0.
 *
 *   node --test tests/regression/S-OS-06/falsify-freeze-merge-commit.test.js
 */
const FALSIFIER_ID = "SEC-F2";

const test = require("node:test");
const assert = require("node:assert");
const H = require("./falsifier-harness");

const VENDOR = { "vendor/lib.js": "module.exports = 1;\n" };
const NEW_KEY = "glob|vendor/**";
const SIDE = "side";

function addVendorGlob(p) {
  p.pathGlobs.push({ pattern: "vendor/**", class: 4, writeProtected: true, warrant: "fixture vendored third-party tree" });
  p.$freeze.amendments.push({ key: NEW_KEY, warrant: "vendored tree allowed after the freeze" });
}

function defaultBranch(fx) {
  return fx.git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
}

function sideBranchLiveCommit(fx) {
  fx.git(["checkout", "-q", "-b", SIDE]);
  fx.write("src/app.js", 'module.exports = { name: "fixture", side: true };\n');
  fx.commit("feat: side-branch live change", ["src/app.js"]);
}

function assertMergeCommit(fx) {
  const parents = fx.git(["rev-list", "--parents", "-n", "1", "HEAD"]).stdout.trim().split(/\s+/);
  assert.strictEqual(parents.length, 3, "HEAD must be a merge commit (sha + two parents)");
}

/** The entry lands via the merge commit ONLY: no non-merge commit after the freeze touches the partition. */
function evilMerge(fx, message) {
  const main = defaultBranch(fx);
  sideBranchLiveCommit(fx);
  fx.git(["checkout", "-q", main]);
  fx.git(["merge", "--no-ff", "--no-commit", SIDE]);
  const p = fx.readPartition();
  addVendorGlob(p);
  fx.writePartition(p);
  fx.git(["add", "--", H.REL.partition]);
  fx.git(["commit", "-q", "-m", message]);
  assertMergeCommit(fx);
  const nonMerge = fx.git(["log", "--no-merges", "--format=%H", "--", H.REL.partition]).stdout.split(/\r?\n/).filter(Boolean);
  assert.strictEqual(nonMerge.length, 1, "only the freeze commit is a non-merge partition commit — the merge is the addition point");
}

function f8Problems(fx) {
  const human = fx.runCutover([]);
  assert.strictEqual(human.status, 1, `a merge-introduced allow-list addition must be a NON-ZERO exit: ${human.out}`);
  assert.match(human.stderr, /\[F8\]/);
  const r = fx.runCutover(["--json"]);
  assert.strictEqual(r.status, 1, r.out);
  const probs = H.json(r).partition.problems;
  assert.deepStrictEqual([...new Set(probs.map((p) => p.id))], ["F8"], r.stdout.slice(0, 1200));
  return probs.map((p) => p.message).join("\n");
}

test(`${FALSIFIER_ID} GREEN: a --no-ff merge of a branch that changes only live code -> exit 0`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const main = defaultBranch(fx);
    sideBranchLiveCommit(fx);
    fx.git(["checkout", "-q", main]);
    fx.git(["merge", "--no-ff", "-q", "-m", `Merge branch '${SIDE}'`, SIDE]);
    assertMergeCommit(fx);
    const r = fx.runCutover([]);
    assert.strictEqual(r.status, 0, r.out);
  });
});

test(`${FALSIFIER_ID} GREEN: a --no-ff merge of a branch carrying its own proper partition-amendment commit -> exit 0`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    const main = defaultBranch(fx);
    fx.git(["checkout", "-q", "-b", SIDE]);
    const p = fx.readPartition();
    addVendorGlob(p);
    fx.writePartition(p);
    fx.commit("partition-amendment: allow vendor/** (vendored third-party tree)", [H.REL.partition]);
    fx.git(["checkout", "-q", main]);
    fx.git(["merge", "--no-ff", "-q", "-m", `Merge branch '${SIDE}'`, SIDE]);
    assertMergeCommit(fx);
    const r = fx.runCutover([]);
    assert.strictEqual(r.status, 0, r.out);
  });
});

test(`${FALSIFIER_ID} RED: an allow-list entry introduced BY a --no-ff merge commit beside merged live code -> cutover exit 1 [F8]`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    evilMerge(fx, `Merge branch '${SIDE}'`);
    const msgs = f8Problems(fx);
    assert.match(msgs, /must be its OWN warranted amendment commit, never folded into a gate-fixing commit/);
    assert.match(msgs, /src\/app\.js/, "the merge's first-parent diff names the merged live file");
    assert.match(msgs, /without the 'partition-amendment:' marker/);
  });
});

test(`${FALSIFIER_ID} RED: the same merge commit carrying the marker still reds — the first-parent foreign-file check sees merges`, () => {
  H.withFixture({ extraFiles: VENDOR }, (fx) => {
    evilMerge(fx, `partition-amendment: Merge branch '${SIDE}' and allow vendor/**`);
    const msgs = f8Problems(fx);
    assert.match(msgs, /never folded into a gate-fixing commit/);
    assert.doesNotMatch(msgs, /without the 'partition-amendment:' marker/);
  });
});
