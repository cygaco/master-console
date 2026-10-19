"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

test("trusted-controller-git-identity — an unresolvable (malformed, not a real revision) base_commit BLOCKS (base-commit-unresolvable)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("git-identity-base-unresolvable");
  t.after(() => fx.cleanup());

  const input = standardInput(fx, { base_commit: "not-a-valid-revision-spec-zzz" });
  const result = ctl.integrate(input, standardOpts(fx));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "base-commit-unresolvable");
});

test("trusted-controller-git-identity — an unresolvable (malformed) result_commit BLOCKS (result-commit-unresolvable)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("git-identity-result-unresolvable");
  t.after(() => fx.cleanup());

  const input = standardInput(fx, { result_commit: "not-a-valid-revision-spec-zzz" });
  const result = ctl.integrate(input, standardOpts(fx));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "result-commit-unresolvable");
});

test("trusted-controller-git-identity — a well-formed but NONEXISTENT (never-committed) 40-hex result_commit BLOCKS downstream at real tree resolution (result-tree-unresolvable) — proving resolution checks the REAL object database, not just hex syntax", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("git-identity-nonexistent-sha");
  t.after(() => fx.cleanup());

  const input = standardInput(fx, { result_commit: "f".repeat(40) });
  const result = ctl.integrate(input, standardOpts(fx));
  assert.strictEqual(result.ok, false, "MUST-BLOCK: a syntactically-valid but never-committed SHA must never integrate");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "result-tree-unresolvable");
});

test("trusted-controller-git-identity — a REAL base commit that is NOT an ancestor of result_commit BLOCKS (non-ancestral value)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("git-identity-non-ancestral");
  t.after(() => fx.cleanup());

  const sh = (cmd, args) => execFileSync(cmd, args, { cwd: fx.dir, encoding: "utf8", windowsHide: true }).trim();
  sh("git", ["checkout", "-q", "--orphan", "unrelated"]);
  sh("git", ["rm", "-rf", "-q", "."]);
  fs.writeFileSync(path.join(fx.dir, "other.txt"), "unrelated\n");
  sh("git", ["add", "."]);
  sh("git", ["commit", "-q", "-m", "unrelated-root"]);
  const unrelated = sh("git", ["rev-parse", "HEAD"]);
  sh("git", ["checkout", "-q", "trunk"]);

  const input = standardInput(fx, { base_commit: unrelated });
  const result = ctl.integrate(input, standardOpts(fx));
  assert.strictEqual(result.ok, false, "MUST-BLOCK: a resolvable-but-non-ancestral base must never authorize");
  assert.strictEqual(result.decision, "BLOCKED");
  assert.strictEqual(result.reason, "not-authorized");
});

test("trusted-controller-git-identity — a malformed target_ref BLOCKS (invalid-target-ref)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const ctl = require("./trusted-controller");

  const fx = makeControllerFixture("git-identity-bad-target-ref");
  t.after(() => fx.cleanup());

  for (const badRef of [null, "", 42, undefined]) {
    const input = standardInput(fx, { target_ref: badRef });
    const result = ctl.integrate(input, standardOpts(fx));
    assert.strictEqual(result.ok, false, `target_ref=${JSON.stringify(badRef)}`);
    assert.strictEqual(result.reason, "invalid-target-ref");
  }
});

test("trusted-controller-git-identity — the RESOLVED result-tree hash is bound onto the produced record (real git objects, not a caller claim)", (t) => {
  const { makeControllerFixture, standardInput, standardOpts } = require("./falsifiers/_lib/controller-fixtures");
  const { headSha } = require("./falsifiers/_lib/git-scratch");
  const ctl = require("./trusted-controller");
  const acceptanceRecord = require("./acceptance-record");

  const fx = makeControllerFixture("git-identity-tree-bound");
  t.after(() => fx.cleanup());

  const realTree = acceptanceRecord.resolveTreeHash(fx.result, { gitRoot: fx.dir });
  assert.ok(realTree, "the fixture's own real result-tree hash must be resolvable");

  const result = ctl.integrate(standardInput(fx), standardOpts(fx));
  assert.strictEqual(result.ok, true, JSON.stringify(result));
  assert.strictEqual(headSha(fx.dir, fx.targetRef), fx.result, "the ref must have advanced to the REAL resolved result commit");
});
