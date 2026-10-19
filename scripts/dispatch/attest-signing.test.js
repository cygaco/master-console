"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
mcEnv.setEnv(
  "ATTEST_SECRET_FILE",
  path.join(os.tmpdir(), `attest-signing-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`),
);

const test = require("node:test");
const assert = require("node:assert");
const {
  sessionSecret,
  canonicalIdentityString,
  signRecord,
  verifyRecord,
  SIGNED_FIELDS,
} = require("./attest-signing");
const { workOrderDigest } = require("./workorder-schema");

const workorder = {
  schema_version: "1",
  correlation_id: "corr-workorder-001",
  role: "backend-builder",
  provider: "claude",
  model: "opus-4.8",
  base_commit: "base-sha-1",
  result_tree_hash: "tree-sha-1",
  allowed_capabilities: ["read", "write"],
  allowed_paths: ["scripts/dispatch/"],
};

function baseRecord(overrides = {}) {
  return {
    role: "backend-builder",
    shape: "subprocess-claude",
    provider: "claude",
    tool_id: "claude",
    panel_run_id: "panel-1",
    code_sha: "code-sha-1",
    output_digest: "out-1",
    evidence_sha: "ev-1",
    cmdline_checksum: "cmd-1",
    completed_at: "2026-07-19T00:00:00.000Z",
    verdict: "pass",
    ok: true,
    fallback: false,
    sprint_id: "SP-99999999-001",
    started_at: "2026-07-18T23:55:00.000Z",
    ...overrides,
  };
}

function signedRecord(overrides = {}) {
  const r = baseRecord(overrides);
  r.attest_sig = signRecord(r);
  return r;
}

test("SIGNED_FIELDS tail is [workorder_digest, dispatch_id] (dispatch_id appended at the END after workorder_digest, prior order untouched)", () => {
  assert.deepStrictEqual(SIGNED_FIELDS.slice(-2), ["workorder_digest", "dispatch_id"]);
});
test("SIGNED_FIELDS retains every pre-existing field in its original relative order", () => {
  const preExisting = [
    "role",
    "shape",
    "provider",
    "tool_id",
    "panel_run_id",
    "code_sha",
    "output_digest",
    "evidence_sha",
    "cmdline_checksum",
    "completed_at",
    "verdict",
    "ok",
    "fallback",
    "sprint_id",
    "started_at",
  ];
  const idxs = preExisting.map((f) => SIGNED_FIELDS.indexOf(f));
  assert.ok(idxs.every((i) => i !== -1), "every pre-existing field must still be present");
  for (let i = 1; i < idxs.length; i++) {
    assert.ok(idxs[i] > idxs[i - 1], `'${preExisting[i]}' must stay AFTER '${preExisting[i - 1]}' (no reorder)`);
  }
  assert.ok(SIGNED_FIELDS.indexOf("workorder_digest") > Math.max(...idxs));
});
test("sessionSecret() returns a usable Buffer under the isolated test secret file", () => {
  const s = sessionSecret();
  assert.ok(Buffer.isBuffer(s) && s.length > 0);
});
test("signRecord + verifyRecord round-trip a well-formed record", () => {
  const r = signedRecord();
  assert.strictEqual(verifyRecord(r), true);
});
test("a record with no attest_sig fails verification (fail-closed)", () => {
  const r = baseRecord();
  assert.strictEqual(verifyRecord(r), false);
});
test("a record with a malformed attest_sig fails verification", () => {
  const r = baseRecord();
  r.attest_sig = "not-hex";
  assert.strictEqual(verifyRecord(r), false);
});
test("tampering ANY pre-existing signed field after signing invalidates the signature", () => {
  const r = signedRecord();
  r.verdict = "fail";
  assert.strictEqual(verifyRecord(r), false);
});
test("KEYSTONE: a post-sign dispatch_id SWAP invalidates the signature — the correlation-key replay is closed", () => {
  const r = signedRecord({ dispatch_id: "d-A", ok: false });
  assert.strictEqual(verifyRecord(r), true, "the genuine signed record verifies");
  r.dispatch_id = "d-B";
  assert.strictEqual(verifyRecord(r), false, "a swapped dispatch_id must break the signature (verified===this-dispatch)");
});
test("dispatch_id is covered by canonicalIdentityString (distinct ids -> distinct canonical)", () => {
  const a = canonicalIdentityString(baseRecord({ dispatch_id: "d-A" }));
  const b = canonicalIdentityString(baseRecord({ dispatch_id: "d-B" }));
  assert.notStrictEqual(a, b, "distinct dispatch_ids must produce distinct canonical strings");
});
test("canonicalIdentityString is TYPE-PRESERVING — numeric 123 and string \"123\" differ", () => {
  const a = canonicalIdentityString(baseRecord({ dispatch_id: 123 }));
  const b = canonicalIdentityString(baseRecord({ dispatch_id: "123" }));
  assert.notStrictEqual(a, b, "String()-coercion aliased 123 and \"123\"; JSON.stringify must keep them distinct");
});
test("a signed NUMERIC field mutated to its STRING form fails verification", () => {
  const r = signedRecord({ dispatch_id: 123 });
  assert.strictEqual(verifyRecord(r), true, "the genuine numeric-signed record verifies");
  r.dispatch_id = "123";
  assert.strictEqual(verifyRecord(r), false, "String(123)===String(\"123\") must NOT let the numeric->string swap verify");
});
test("canonicalIdentityString is FIELD-BOUNDARY injective (a value cannot forge a field boundary)", () => {
  const a = canonicalIdentityString(baseRecord({ role: "ab", shape: "c" }));
  const b = canonicalIdentityString(baseRecord({ role: "a", shape: "bc" }));
  assert.notStrictEqual(a, b, "boundary-ambiguous field vectors must not collide");
  const forge = canonicalIdentityString(baseRecord({ role: "x" + String.fromCharCode(31) + "shape=INJECTED" }));
  const real = canonicalIdentityString(baseRecord({ role: "x", shape: "INJECTED" }));
  assert.notStrictEqual(forge, real, "a value embedding the raw \\x1f must not forge a real field split (JSON escapes it)");
});
test("canonicalIdentityString is stable for missing fields (serializes as empty)", () => {
  const s = canonicalIdentityString({});
  assert.strictEqual(typeof s, "string");
  assert.ok(s.includes("role="));
});

test("a record carrying workorder_digest signs + verifies", () => {
  const digest = workOrderDigest(workorder);
  const r = signedRecord({ workorder_digest: digest });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.strictEqual(verifyRecord(r), true, "a record with a correctly-signed workorder_digest must verify");
});
test("a post-hoc workorder_digest SWAP invalidates the signature", () => {
  const digest = workOrderDigest(workorder);
  const r = signedRecord({ workorder_digest: digest });
  assert.strictEqual(verifyRecord(r), true, "sanity: signs clean before tampering");
  const swappedDigest = workOrderDigest({ ...workorder, base_commit: "attacker-controlled-base" });
  assert.notStrictEqual(swappedDigest, digest, "sanity: the swapped digest really is different");
  r.workorder_digest = swappedDigest;
  assert.strictEqual(verifyRecord(r), false, "a post-hoc workorder_digest swap must invalidate the signature");
});
test("a record with NO workorder_digest still signs/verifies (additive — non-WorkOrder records unaffected)", () => {
  const r = signedRecord();
  assert.strictEqual(verifyRecord(r), true);
});
test("setting workorder_digest on an already-signed (undigested) record invalidates it (no free upgrade)", () => {
  const r = signedRecord();
  r.workorder_digest = workOrderDigest(workorder);
  assert.strictEqual(verifyRecord(r), false, "adding a workorder_digest post-hoc must not silently validate");
});
test("re-signing after legitimately adding workorder_digest verifies again (the correct writer path)", () => {
  const r = baseRecord({ workorder_digest: workOrderDigest(workorder) });
  r.attest_sig = signRecord(r);
  assert.strictEqual(verifyRecord(r), true);
});
