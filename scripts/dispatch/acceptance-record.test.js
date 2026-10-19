"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test } = require("node:test");
const assert = require("node:assert");

const acc = require("./acceptance-record");
const lease = require("./conductor-lease");
const { workOrderDigest } = require("./workorder-schema");

function makeTempRepo() {
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acc-gitrepo-"));
  const git = (...a) => {
    const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8", windowsHide: true });
    assert.strictEqual(r.status, 0, "git " + a.join(" ") + ": " + r.stderr);
    return String(r.stdout || "").trim();
  };
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "c1");
  const c1 = git("rev-parse", "HEAD");
  git("checkout", "-q", "-b", "other");
  fs.writeFileSync(path.join(dir, "b.txt"), "other\n");
  git("add", "b.txt");
  git("commit", "-q", "-m", "other");
  const other = git("rev-parse", "HEAD");
  git("checkout", "-q", "-");
  fs.writeFileSync(path.join(dir, "a.txt"), "two\n");
  git("commit", "-q", "-am", "c2");
  const c2 = git("rev-parse", "HEAD");
  return { dir, c1, c2, other };
}

function tmpLeaseRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `acc-lease-${tag}-`));
}

test("produce() binds workorder_digest + base/tree/target + digests + route/fallback + lease token", () => {
  const workorder = {
    schema_version: "workorder-min/v1",
    correlation_id: "corr-1",
    role: "backend-builder",
    provider: "claude",
    model: "opus",
    base_commit: "base-1",
    result_tree_hash: "tree-1",
    allowed_capabilities: ["build"],
    allowed_paths: ["scripts/"],
    retry_lineage: [],
    evidence_refs: [],
    terminal_state: "success",
  };
  const record = acc.produce({
    workorder,
    base_commit: acc.TEST_BASE_SHA,
    result_commit: acc.TEST_CAND_SHA,
    result_tree_hash: "tree-1",
    target_ref: "refs/heads/integration",
    checker_digests: { lint: "d1" },
    policy_digest: "p1",
    evidence_digests: { ev: "e1" },
    route: "claude:opus",
    fallback: false,
    lease_fencing_token: 3,
  });
  assert.strictEqual(record.workorder_digest, workOrderDigest(workorder));
  assert.strictEqual(record.base_commit, acc.TEST_BASE_SHA);
  assert.strictEqual(record.result_commit, acc.TEST_CAND_SHA);
  assert.strictEqual(record.result_tree_hash, "tree-1");
  assert.strictEqual(record.target_ref, "refs/heads/integration");
  assert.strictEqual(record.terminal_state, "success");
  assert.deepStrictEqual(record.checker_digests, { lint: "d1" });
  assert.strictEqual(record.policy_digest, "p1");
  assert.deepStrictEqual(record.evidence_digests, { ev: "e1" });
  assert.strictEqual(record.route, "claude:opus");
  assert.strictEqual(record.fallback, false);
  assert.strictEqual(record.lease_fencing_token, 3);
  assert.strictEqual(typeof record.record_digest, "string");
  assert.strictEqual(record.record_digest.length, 64);
});

test("produce() accepts a pre-computed workorder_digest string directly (no workorder object required)", () => {
  const record = acc.produce({
    workorder: "digest-precomputed",
    terminal_state: "success",
    target_ref: "refs/heads/x",
    base_commit: acc.TEST_BASE_SHA,
    result_commit: acc.TEST_CAND_SHA,
  });
  assert.strictEqual(record.workorder_digest, "digest-precomputed");
});

test("TEETH: produce() THROWS on a mutable / short / non-hex / wrong-length / absent base_commit or result_commit", () => {
  const good = { workorder: "wo", terminal_state: "success", target_ref: "refs/heads/x", base_commit: acc.TEST_BASE_SHA, result_commit: acc.TEST_CAND_SHA };
  assert.ok(acc.produce(good), "a full-SHA base+candidate produces a record");
  const bads = [
    { base_commit: "refs/heads/mutable" }, { base_commit: "abc1234" }, { base_commit: "" }, { base_commit: undefined },
    { base_commit: "b".repeat(41) }, { base_commit: "g".repeat(40) }, { base_commit: [acc.TEST_BASE_SHA] },
    { result_commit: "refs/heads/mutable" }, { result_commit: "abc1234" }, { result_commit: "" }, { result_commit: undefined },
    { result_commit: "c".repeat(39) }, { result_commit: { toString: () => acc.TEST_CAND_SHA } },
  ];
  for (const bad of bads) {
    assert.throws(() => acc.produce(Object.assign({}, good, bad)), /immutable full 40-hex commit SHA/, "produce must reject: " + JSON.stringify(bad));
  }
});

test("produceForTest() yields a record acceptable to the golden path (positive companion contract)", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration" });
  assert.strictEqual(record.target_ref, "refs/heads/integration");
  assert.strictEqual(record.terminal_state, "success");
  assert.ok(record.result_tree_hash && record.base_commit && record.workorder_digest);
});

test("TEETH: produceForTest routes overrides into produce() input — a schema-invalid override THROWS (post-validation-override CLOSED) + the digest is FRESH", () => {
  assert.throws(() => acc.produceForTest({ result_commit: "" }), /40-hex commit SHA/, "produceForTest must reject an invalid result_commit override at produce()");
  assert.throws(() => acc.produceForTest({ base_commit: "refs/heads/mutable" }), /40-hex commit SHA/, "produceForTest must reject a mutable base_commit override");
  const rec = acc.produceForTest({ target_ref: "refs/heads/integration", result_tree_hash: "tree-XYZ", lease_fencing_token: 7 });
  const { record_digest, ...body } = rec;
  assert.strictEqual(record_digest, acc.stableDigest(body), "record_digest must equal stableDigest of the final record (fresh, not stale)");
});

test("TEETH: forgeInvalidRecordForTest self-guard — throws UNLESS its output FAILS validateCommitIdentity (construction invariant)", () => {
  assert.throws(() => acc.forgeInvalidRecordForTest({ target_ref: "refs/heads/x" }), /construction invariant/, "self-guard must throw on a non-invalidating override");
  const forged = acc.forgeInvalidRecordForTest({ result_commit: "" });
  assert.strictEqual(acc.validateCommitIdentity(forged), false, "forged record must fail validateCommitIdentity");
});

test("TEETH: the forged record is FROZEN — it cannot be mutated back to schema-valid post-return", () => {
  const forged = acc.forgeInvalidRecordForTest({ result_commit: "" });
  assert.ok(Object.isFrozen(forged), "the forged record must be FROZEN (invalid state immutable by construction)");
  try {
    forged.result_commit = acc.TEST_CAND_SHA;
  } catch (_) {
  }
  assert.strictEqual(forged.result_commit, "", "result_commit must remain empty — the mutable-return bypass is closed");
  assert.strictEqual(acc.validateCommitIdentity(forged), false, "a forged fixture can NEVER become schema-valid after return");
});

const okTree = () => "tree-OK";
const BASE = acc.TEST_BASE_SHA;
const OTHER_SHA = "dddddddddddddddddddddddddddddddddddddddd";

function validCtx(tag) {
  const root = tmpLeaseRoot(tag);
  const spId = "SP-" + String(tag).toUpperCase();
  const a = lease.acquire(spId, { root, sessionId: "sess-" + tag });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a.token });
  const opts = { integrationHead: BASE, spId, leaseRoot: root, treeResolver: okTree, ancestryResolver: () => true };
  return { root, spId, token: a.token, record, opts };
}

test("HAPPY: a fully-valid record with fresh base + current lease + confirmed recompute authorizes", () => {
  const { record, opts } = validCtx("happy4");
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", opts), true);
});

test("FAIL-CLOSED: omitting the MANDATORY freshness head BLOCKS even an otherwise-valid record", () => {
  const { record, opts } = validCtx("happy4b");
  const { integrationHead, ...noHead } = opts;
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", noHead), false);
});

test("FAIL-CLOSED: omitting the MANDATORY lease coordinates BLOCKS even an otherwise-valid record", () => {
  const { record, opts } = validCtx("happy4c");
  const { spId, leaseRoot, ...noLease } = opts;
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", noLease), false);
});

test("FAIL-CLOSED: a record missing the checker/policy/evidence identity digests BLOCKS", () => {
  const { record, opts } = validCtx("happy4d");
  for (const missing of [{ checker_digests: {} }, { policy_digest: "" }, { evidence_digests: {} }]) {
    const bad = Object.assign({}, record, missing);
    assert.strictEqual(acc.authorizesIntegration(bad, "refs/heads/integration", opts), false, JSON.stringify(missing));
  }
});

test("FAIL-CLOSED (prerequisite): authorizesIntegration with NO opts blocks at the FIRST mandatory coordinate (the freshness head is absent) — a valid record cannot authorize without the mandatory context", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration" });
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration"), false);
});

test("ADVERSARIAL: null/undefined/non-object record never authorizes", () => {
  assert.strictEqual(acc.authorizesIntegration(null, "refs/heads/x"), false);
  assert.strictEqual(acc.authorizesIntegration(undefined, "refs/heads/x"), false);
  assert.strictEqual(acc.authorizesIntegration("a string", "refs/heads/x"), false);
  assert.strictEqual(acc.authorizesIntegration(42, "refs/heads/x"), false);
});

test("ADVERSARIAL: a bare ResultEnvelope (success:true, no target_ref/terminal_state) never authorizes", () => {
  const envelope = { success: true, provider: "openai", role: "backend-builder" };
  assert.strictEqual(acc.authorizesIntegration(envelope, "refs/heads/integration"), false);
});

test("ADVERSARIAL: target mismatch blocks even a well-formed record", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/feature-A" });
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/feature-B"), false);
});

test("ADVERSARIAL: non-empty targetRef required (empty string / non-string never authorizes)", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration" });
  assert.strictEqual(acc.authorizesIntegration(record, ""), false);
  assert.strictEqual(acc.authorizesIntegration(record, null), false);
});

for (const nonSuccess of ["partial", "blocked", "failed", "cancelled"]) {
  test(`ADVERSARIAL: terminal_state=${nonSuccess} never authorizes even with matching target`, () => {
    const record = acc.produceForTest({ target_ref: "refs/heads/integration", terminal_state: nonSuccess });
    assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration"), false);
  });
}

test("ADVERSARIAL: an unrecognized terminal_state string never authorizes (not in the 5-state enum)", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", terminal_state: "done-ish" });
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration"), false);
});

for (const missing of ["result_tree_hash", "base_commit", "workorder_digest"]) {
  test(`ADVERSARIAL: a record missing ${missing} never authorizes (incomplete content-addressed identity)`, () => {
    const record = acc.produceForTest({ target_ref: "refs/heads/integration" });
    record[missing] = "";
    assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration"), false);
  });
}

test("ADVERSARIAL: stale base against a supplied integrationHead blocks (TOCTOU)", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", base_commit: OTHER_SHA });
  assert.strictEqual(
    acc.authorizesIntegration(record, "refs/heads/integration", { integrationHead: BASE }),
    false,
  );
});

test("ADVERSARIAL (recompute REACHABLE): a forged result_tree_hash is caught AT the recompute gate — the resolver IS invoked (not short-circuited at an earlier prereq)", () => {
  const { record, opts } = validCtx("forged-reach");
  const forged = Object.assign({}, record, { result_tree_hash: "f".repeat(40) });
  let treeCalls = 0;
  const spyResolver = (ref, o) => { treeCalls++; return okTree(ref, o); };
  const res = acc.authorizesIntegration(forged, "refs/heads/integration", Object.assign({}, opts, { treeResolver: spyResolver }));
  assert.strictEqual(res, false, "the forged tree must BLOCK at recompute");
  assert.ok(treeCalls > 0, "the recompute resolver MUST be reached — treeCalls=" + treeCalls);
});

test("ADVERSARIAL (recompute REACHABLE): a candidate whose tree cannot be resolved fails closed AT the recompute gate (resolver returns null → block)", () => {
  const { record, opts } = validCtx("unresolvable-reach");
  let treeCalls = 0;
  const nullResolver = () => { treeCalls++; return null; };
  const res = acc.authorizesIntegration(record, "refs/heads/integration", Object.assign({}, opts, { treeResolver: nullResolver }));
  assert.strictEqual(res, false, "an unresolvable candidate tree must fail closed");
  assert.ok(treeCalls > 0, "the recompute resolver IS reached and its null result fails closed — treeCalls=" + treeCalls);
});

test("ADVERSARIAL (lease-gate REACHABLE): a record under a SUPERSEDED lease blocks AT the lease-fencing gate — the SAME record with the CURRENT token authorizes (only the lease gate distinguishes them)", () => {
  const root = tmpLeaseRoot("acc-lease-reach");
  const spId = "SP-ACC-LEASE-REACH";
  const a1 = lease.acquire(spId, { root, sessionId: "sess-stale" });
  lease.release(spId, { root, token: a1.token });
  lease.acquire(spId, { root, sessionId: "sess-current" });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a1.token });
  const fullOpts = { integrationHead: BASE, spId, leaseRoot: root, treeResolver: okTree, ancestryResolver: () => true };
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", fullOpts), false, "the superseded-token record must block");
  const cur = lease.status(spId, { root }).token;
  const okRec = Object.assign({}, record, { lease_fencing_token: cur });
  assert.strictEqual(acc.authorizesIntegration(okRec, "refs/heads/integration", fullOpts), true, "the SAME record with the CURRENT token authorizes — the lease-fencing gate was reached and decisive");
});

test("HAPPY: lease-fencing seam — a record minted under the CURRENT lease token authorizes", () => {
  const root = tmpLeaseRoot("acc-lease-happy");
  const spId = "SP-ACC-UNIT-HAPPY";
  const a1 = lease.acquire(spId, { root, sessionId: "sess-current" });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a1.token });
  assert.strictEqual(
    acc.authorizesIntegration(record, "refs/heads/integration", { integrationHead: BASE, spId, leaseRoot: root, treeResolver: okTree, ancestryResolver: () => true }),
    true,
  );
});

test("TEETH: a digest MAP with an empty / whitespace / null / non-string VALUE does NOT authorize", () => {
  const { record, opts } = validCtx("digest-map");
  const badMaps = [
    { checker_digests: { lint: "" } },
    { checker_digests: { lint: "   " } },
    { checker_digests: { lint: null } },
    { checker_digests: { lint: 123 } },
    { checker_digests: { lint: {} } },
    { checker_digests: { lint: "digest-ok", tests: "" } },
    { evidence_digests: { ev: "" } },
    { evidence_digests: { ev: null } },
    { evidence_digests: { ev: 0 } },
    { evidence_digests: { ev: "digest-ok", ev2: "  " } },
  ];
  for (const bad of badMaps) {
    const rec = Object.assign({}, record, bad);
    assert.strictEqual(
      acc.authorizesIntegration(rec, "refs/heads/integration", opts),
      false,
      "a contentless digest value must fail closed: " + JSON.stringify(bad),
    );
  }
});

test("TEETH: the positive companion still authorizes — a map whose values are ALL non-empty digest strings", () => {
  const { record, opts } = validCtx("digest-map-pos");
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", opts), true);
});

const CAND_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function refAwareCtx(tag, { resultTree = "RESULT-TREE", claimTree = "RESULT-TREE" } = {}) {
  const root = tmpLeaseRoot(tag);
  const spId = "SP-" + String(tag).toUpperCase();
  const a = lease.acquire(spId, { root, sessionId: "sess-" + tag });
  const record = acc.produceForTest({
    target_ref: "refs/heads/integration",
    lease_fencing_token: a.token,
    base_commit: BASE,
    result_tree_hash: claimTree,
    result_commit: CAND_SHA,
  });
  const refAware = (ref) => {
    if (ref === CAND_SHA) return resultTree;
    if (ref === "refs/heads/integration") return "BASE-TREE";
    return null;
  };
  const opts = { integrationHead: BASE, spId, leaseRoot: root, treeResolver: refAware, ancestryResolver: () => true };
  return { root, spId, token: a.token, record, opts };
}

test("TEETH: a REAL integration AUTHORIZES — recompute reads the CANDIDATE commit's tree, not the destination's base tree", () => {
  const { record, opts } = refAwareCtx("cand-real");
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", opts), true);
});

test("TEETH: a record whose result_tree_hash matches only the DESTINATION base tree does NOT authorize", () => {
  const { record, opts } = refAwareCtx("cand-destmatch", { resultTree: "RESULT-TREE", claimTree: "BASE-TREE" });
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", opts), false);
});

test("TEETH: full authorize-then-CAS DETERMINATION on the real-integration shape returns ok (end-to-end, no real git mutation)", () => {
  const { record, opts } = refAwareCtx("cand-cas");
  const result = acc.commitIntegration(record, "refs/heads/integration", {
    ...opts,
    expectedHead: BASE,
    liveHead: BASE,
  });
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.receipt.committed_head, BASE);
});

test("TEETH: with NO bound candidate (empty result_commit) authorization FAILS CLOSED", () => {
  const root = tmpLeaseRoot("cand-nocand");
  const spId = "SP-CAND-NOCAND";
  const a = lease.acquire(spId, { root, sessionId: "sess-nocand" });
  const record = acc.forgeInvalidRecordForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a.token, result_commit: "" });
  const opts = { integrationHead: BASE, spId, leaseRoot: root, treeResolver: okTree, ancestryResolver: () => true };
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", opts), false);
});

test("TEETH: a caller passing the DESTINATION targetRef via opts.resultRef does NOT authorize (exact-SHA guard, not a recompute override)", () => {
  const { record, opts } = refAwareCtx("override-dest");
  const attack = {
    ...opts,
    resultRef: "refs/heads/integration",
    commitResolver: (ref) => (ref === "refs/heads/integration" ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" : null),
  };
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", attack), false);
});

test("TEETH: a caller passing a DIFFERENT SAME-TREE commit via opts.newHead does NOT authorize — exact-SHA equality, TREE equality is insufficient", () => {
  const { record, opts } = refAwareCtx("override-sametree");
  const OTHER = "dddddddddddddddddddddddddddddddddddddddd";
  const attack = {
    ...opts,
    newHead: OTHER,
    commitResolver: (ref) => ref,
    treeResolver: (ref) => (ref === OTHER || ref === CAND_SHA ? "RESULT-TREE" : "BASE-TREE"),
  };
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", attack), false);
});

test("TEETH: a caller ref that EXACTLY equals record.result_commit still authorizes (the guard rejects substitution, not use)", () => {
  const { record, opts } = refAwareCtx("override-happy");
  const ok = { ...opts, newHead: CAND_SHA, commitResolver: (ref) => ref };
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", ok), true);
});

test("TEETH (CAS-reachability): commitIntegration performRefUpdate BLOCKS a DIFFERENT same-tree newHead with EXACTLY new-head-not-bound-candidate (the guard is independently reachable — deleting it would fail this test)", () => {
  const { record, opts } = refAwareCtx("override-cas");
  const result = acc.commitIntegration(record, "refs/heads/integration", {
    ...opts,
    expectedHead: BASE,
    liveHead: BASE,
    performRefUpdate: true,
    newHead: OTHER_SHA,
    commitResolver: (ref) => ref,
    treeResolver: (ref) => (ref === OTHER_SHA || ref === CAND_SHA ? "RESULT-TREE" : "BASE-TREE"),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "new-head-not-bound-candidate");
});

test("TEETH: a result_commit that is NOT an immutable 40-hex SHA (ref name / short sha / empty / non-hex / wrong length) does NOT authorize", () => {
  const { record, opts } = validCtx("sha-candidate");
  const badCommits = [
    "refs/heads/candidate",
    "abc1234",
    "",
    "cccccccccccccccccccccccccccccccccccccccg",
    "cccccccccccccccccccccccccccccccccccccc",
    "ccccccccccccccccccccccccccccccccccccccccc",
  ];
  for (const bad of badCommits) {
    const rec = Object.assign({}, record, { result_commit: bad });
    assert.strictEqual(acc.authorizesIntegration(rec, "refs/heads/integration", opts), false, "non-SHA result_commit must fail closed: " + JSON.stringify(bad));
  }
});

test("TEETH: a candidate UNRELATED to base_commit (base is NOT an ancestor) does NOT authorize even with a valid tree recompute", () => {
  const { record, opts } = refAwareCtx("ancestry");
  const noAncestry = { ...opts, ancestryResolver: () => false };
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", noAncestry), false);
});

test("defaultIsAncestor: real git — HEAD~1 IS an ancestor of HEAD; HEAD is NOT an ancestor of HEAD~1", () => {
  const repo = makeTempRepo();
  const o = { gitRoot: repo.dir };
  const parent = acc.resolveCommitSha("HEAD~1", o);
  const child = acc.resolveCommitSha("HEAD", o);
  assert.ok(parent && child, "temp repo must have 2 commits");
  assert.strictEqual(parent, repo.c1);
  assert.strictEqual(child, repo.c2);
  assert.strictEqual(acc.defaultIsAncestor(parent, child, o), true);
  assert.strictEqual(acc.defaultIsAncestor(child, parent, o), false);
  assert.strictEqual(acc.defaultIsAncestor(repo.other, child, o), false);
  assert.strictEqual(acc.defaultIsAncestor("", child, o), false);
});

test("validateCommitIdentity: TRUE only when BOTH base_commit AND result_commit are immutable full 40-hex SHAs", () => {
  const ok = { base_commit: acc.TEST_BASE_SHA, result_commit: acc.TEST_CAND_SHA };
  assert.strictEqual(acc.validateCommitIdentity(ok), true);
  for (const bad of [
    { base_commit: "refs/heads/x", result_commit: acc.TEST_CAND_SHA },
    { base_commit: "abc1234", result_commit: acc.TEST_CAND_SHA },
    { base_commit: "", result_commit: acc.TEST_CAND_SHA },
    { base_commit: acc.TEST_BASE_SHA, result_commit: "refs/heads/y" },
    { base_commit: "g".repeat(40), result_commit: acc.TEST_CAND_SHA },
    { base_commit: acc.TEST_BASE_SHA, result_commit: "c".repeat(41) },
    { base_commit: [acc.TEST_BASE_SHA], result_commit: acc.TEST_CAND_SHA },
    { base_commit: acc.TEST_BASE_SHA, result_commit: [acc.TEST_CAND_SHA] },
    { base_commit: new String(acc.TEST_BASE_SHA), result_commit: acc.TEST_CAND_SHA },
    { base_commit: acc.TEST_BASE_SHA, result_commit: { toString: () => acc.TEST_CAND_SHA } },
    { base_commit: 123, result_commit: acc.TEST_CAND_SHA },
    { base_commit: acc.TEST_BASE_SHA, result_commit: null },
    null, undefined, "not-an-object",
  ]) {
    assert.strictEqual(acc.validateCommitIdentity(bad), false, "must reject: " + JSON.stringify(bad));
  }
});

test("TEETH: a MUTABLE / malformed base_commit does NOT authorize — routed through the ONE validator", () => {
  const { record, opts } = validCtx("identity-base");
  for (const bad of ["refs/heads/integration", "abc1234", "", "b".repeat(39), "b".repeat(41), "g".repeat(40)]) {
    const rec = Object.assign({}, record, { base_commit: bad });
    const o = Object.assign({}, opts, { integrationHead: bad });
    assert.strictEqual(acc.authorizesIntegration(rec, "refs/heads/integration", o), false, "mutable/malformed base must fail closed: " + JSON.stringify(bad));
  }
});

test("TEETH (head-coord): a non-SHA integrationHead does NOT authorize even if it string-equals a (would-be) base", () => {
  const { record, opts } = validCtx("identity-inthead");
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", Object.assign({}, opts, { integrationHead: "refs/heads/integration" })), false);
  assert.strictEqual(acc.authorizesIntegration(record, "refs/heads/integration", Object.assign({}, opts, { integrationHead: "b".repeat(39) })), false);
});

test("TEETH (head-coord): commitIntegration BLOCKS a non-SHA expectedHead / liveHead", () => {
  const { record, opts } = validCtx("identity-commithead");
  const bad1 = acc.commitIntegration(record, "refs/heads/integration", { ...opts, expectedHead: "refs/heads/integration", liveHead: BASE });
  assert.strictEqual(bad1.ok, false);
  assert.strictEqual(bad1.reason, "expected-head-not-sha");
  const bad2 = acc.commitIntegration(record, "refs/heads/integration", { ...opts, expectedHead: BASE, liveHead: "refs/heads/integration" });
  assert.strictEqual(bad2.ok, false);
  assert.strictEqual(bad2.reason, "live-head-not-sha");
});

test("ADVERSARIAL: lease coordinates given but the conductor-lease module can't be resolved -> fails closed", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: 1 });
  const root = tmpLeaseRoot("acc-empty");
  assert.strictEqual(
    acc.authorizesIntegration(record, "refs/heads/integration", { spId: "SP-NEVER-ACQUIRED", leaseRoot: root }),
    false,
  );
});

test("HAPPY: commitIntegration succeeds when the live head matches the validated head (bound to base_commit)", () => {
  const { record, opts } = validCtx("commit-happy");
  const result = acc.commitIntegration(record, "refs/heads/integration", { ...opts, expectedHead: BASE, liveHead: BASE });
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(result.receipt.target_ref, "refs/heads/integration");
  assert.strictEqual(result.receipt.committed_head, BASE);
});

test("ADVERSARIAL: commitIntegration blocks when expectedHead !== the record's base_commit (CAS not bound to accepted base)", () => {
  const { record, opts } = validCtx("commit-basebind");
  const result = acc.commitIntegration(record, "refs/heads/integration", { ...opts, expectedHead: OTHER_SHA, liveHead: OTHER_SHA });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "expected-head-base-mismatch");
});

test("ADVERSARIAL: commitIntegration blocks when the live head moved since validation (CAS race)", () => {
  const { record, opts } = validCtx("commit-race");
  const result = acc.commitIntegration(record, "refs/heads/integration", { ...opts, expectedHead: BASE, liveHead: OTHER_SHA });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "validation-to-merge-race");
});

test("ADVERSARIAL: commitIntegration blocks on a target-ref mismatch", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/feature-A" });
  const result = acc.commitIntegration(record, "refs/heads/feature-B", { expectedHead: "H1", liveHead: "H1", treeResolver: okTree });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "target-mismatch");
});

test("ADVERSARIAL: commitIntegration requires an expectedHead (no implicit trust-the-record shortcut)", () => {
  const record = acc.produceForTest({ target_ref: "refs/heads/integration" });
  const result = acc.commitIntegration(record, "refs/heads/integration", { liveHead: "H1" });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "missing-expected-head");
});

test("ADVERSARIAL: commitIntegration honors the lease-fencing seam too (a superseded lease blocks the CAS receipt)", () => {
  const root = tmpLeaseRoot("acc-commit-lease");
  const spId = "SP-ACC-COMMIT";
  const a1 = lease.acquire(spId, { root, sessionId: "sess-stale" });
  lease.release(spId, { root, token: a1.token });
  lease.acquire(spId, { root, sessionId: "sess-current" });
  const record = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: a1.token });
  const result = acc.commitIntegration(record, "refs/heads/integration", {
    expectedHead: BASE,
    liveHead: BASE,
    spId,
    leaseRoot: root,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "superseded-lease");
});

test("TEETH: commitIntegration BLOCKS a forged-tree record even with matching heads + a VALID lease — recompute inside authorization catches it", () => {
  const { opts, token } = validCtx("commit-forged");
  const forged = acc.produceForTest({ target_ref: "refs/heads/integration", lease_fencing_token: token, result_tree_hash: "f".repeat(40) });
  const result = acc.commitIntegration(forged, "refs/heads/integration", {
    ...opts,
    expectedHead: BASE,
    liveHead: BASE,
    newHead: acc.TEST_CAND_SHA,
    performRefUpdate: true,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "not-authorized");
});

test("commitIntegration never mutates git by default (no performRefUpdate opt-in)", () => {
  const root = tmpLeaseRoot("commit-noop");
  const spId = "SP-COMMIT-NOOP";
  const a = lease.acquire(spId, { root, sessionId: "sess-noop" });
  const record = acc.produceForTest({ target_ref: "refs/heads/acc-record-noop-test-ref", lease_fencing_token: a.token });
  const result = acc.commitIntegration(record, "refs/heads/acc-record-noop-test-ref", {
    integrationHead: BASE,
    spId,
    leaseRoot: root,
    expectedHead: BASE,
    liveHead: BASE,
    treeResolver: okTree,
    ancestryResolver: () => true,
  });
  assert.strictEqual(result.ok, true, result.reason);
  assert.strictEqual(acc.resolveCommitSha("refs/heads/acc-record-noop-test-ref"), null);
});

test("falsifier: a no-op-lexical-choke-point bypass is defeated IN-PRIMITIVE — commitIntegration + authorizesIntegration refuse an under-authorized record regardless of any nearby no-op authorizesIntegration() call", () => {
  const bareEnvelope = { success: true, target_ref: "refs/heads/integration", terminal_state: "success" };
  const runtime = acc.commitIntegration(bareEnvelope, "refs/heads/integration", {
    expectedHead: BASE,
    liveHead: BASE,
    treeResolver: okTree,
    performRefUpdate: true,
  });
  assert.strictEqual(runtime.ok, false, "the mutation primitive must refuse an under-authorized record even if the lexical guard was fooled");
  assert.strictEqual(
    acc.authorizesIntegration(bareEnvelope, "refs/heads/integration", { integrationHead: BASE, treeResolver: okTree }),
    false,
  );
});

test("resolveTreeHash/resolveCommitSha resolve a REAL ref in a temp repo to real hex identities", () => {
  const o = { gitRoot: makeTempRepo().dir };
  const sha = acc.resolveCommitSha("HEAD", o);
  assert.ok(sha && /^[0-9a-f]{7,40}$/i.test(sha));
  const tree = acc.resolveTreeHash("HEAD", o);
  assert.ok(tree && /^[0-9a-f]{40}$/i.test(tree));
});

test("resolveTreeHash/resolveCommitSha return null (never throw) for a ref that does not exist", () => {
  assert.strictEqual(acc.resolveTreeHash("refs/heads/definitely-does-not-exist-xyz"), null);
  assert.strictEqual(acc.resolveCommitSha("refs/heads/definitely-does-not-exist-xyz"), null);
});

test("resolveTreeHash/resolveCommitSha return null for non-string/empty input without throwing", () => {
  assert.strictEqual(acc.resolveTreeHash(""), null);
  assert.strictEqual(acc.resolveTreeHash(null), null);
  assert.strictEqual(acc.resolveCommitSha(undefined), null);
});

test("stableDigest is deterministic and independent of key insertion order", () => {
  const a = acc.stableDigest({ x: 1, y: 2 });
  const b = acc.stableDigest({ y: 2, x: 1 });
  assert.strictEqual(a, b);
});
