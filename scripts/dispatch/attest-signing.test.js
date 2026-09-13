"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * attest-signing.test.js — origin-proof signing seam (ED-231/ADR-0025) + SP-20260718-005 BE-3
 * (workorder_digest appended to SIGNED_FIELDS, AC-12). This file did not previously exist; it is a fresh
 * general-purpose suite for signRecord/verifyRecord/canonicalIdentityString PLUS the new workorder_digest
 * coverage the build_spec calls for. Existing consumer regressions (cert-attest-panel.test.js,
 * verified-liveness-read.test.js, gauntlet-verify-signing.test.js, dispatch-review-panel-gate.test.js,
 * coverage-gate.test.js) are run separately to prove no regression on the signing seam — see the builder
 * envelope for their pass/fail status.
 *
 * Run: node --test scripts/dispatch/attest-signing.test.js
 */
// Isolate the HMAC secret to a temp file so this test never touches the real per-session secret — set
// BEFORE requiring attest-signing, which resolves SECRET_FILE from the env at load.
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
  correlation_id: "corr-be3-001",
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
    sprint_id: "SP-20260718-005",
    started_at: "2026-07-18T23:55:00.000Z",
    ...overrides,
  };
}

function signedRecord(overrides = {}) {
  const r = baseRecord(overrides);
  r.attest_sig = signRecord(r);
  return r;
}

// ── general signing seam sanity (round out this fresh file with the core contract) ────────────────
test("SIGNED_FIELDS tail is [workorder_digest, dispatch_id] (SP-20260723-003 r3e: dispatch_id appended at the END after workorder_digest, prior order untouched)", () => {
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
  // and workorder_digest is strictly after all of them
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
test("SP-20260723-003 r3e KEYSTONE (7G-011): a post-sign dispatch_id SWAP invalidates the signature — the QA-7G-007 correlation-key replay is closed", () => {
  // The replay: a validly-signed ok:false death for dispatch A, re-pointed to B by swapping the (previously
  // UNSIGNED) dispatch_id, must NO LONGER verify now that dispatch_id is in SIGNED_FIELDS.
  const r = signedRecord({ dispatch_id: "d-A", ok: false });
  assert.strictEqual(verifyRecord(r), true, "the genuine signed record verifies");
  r.dispatch_id = "d-B"; // re-point the death at a different outstanding dispatch
  assert.strictEqual(verifyRecord(r), false, "a swapped dispatch_id must break the signature (verified===this-dispatch)");
});
test("SP-20260723-003 r3e: dispatch_id is covered by canonicalIdentityString (distinct ids -> distinct canonical)", () => {
  const a = canonicalIdentityString(baseRecord({ dispatch_id: "d-A" }));
  const b = canonicalIdentityString(baseRecord({ dispatch_id: "d-B" }));
  assert.notStrictEqual(a, b, "distinct dispatch_ids must produce distinct canonical strings");
});
test("SP-20260723-003 r3g QA-7G-012: canonicalIdentityString is TYPE-PRESERVING — numeric 123 and string \"123\" differ", () => {
  const a = canonicalIdentityString(baseRecord({ dispatch_id: 123 }));   // number
  const b = canonicalIdentityString(baseRecord({ dispatch_id: "123" })); // string
  assert.notStrictEqual(a, b, "String()-coercion aliased 123 and \"123\"; JSON.stringify must keep them distinct");
});
test("SP-20260723-003 r3g QA-7G-012: a signed NUMERIC field mutated to its STRING form fails verification", () => {
  const r = signedRecord({ dispatch_id: 123 }); // signs with numeric 123
  assert.strictEqual(verifyRecord(r), true, "the genuine numeric-signed record verifies");
  r.dispatch_id = "123"; // mutate number -> string (the type-coercion alias attack)
  assert.strictEqual(verifyRecord(r), false, "String(123)===String(\"123\") must NOT let the numeric->string swap verify");
});
test("SP-20260723-003 r3g QA-7G-012: canonicalIdentityString is FIELD-BOUNDARY injective (a value cannot forge a field boundary)", () => {
  // The \x1f join is option (a): a control-char delimiter JSON.stringify always emits ESCAPED (as ),
  // never raw — so a value can neither move a field boundary nor forge one. (i) boundary-ambiguous vectors
  // that a NAIVE concat would collide must differ:
  const a = canonicalIdentityString(baseRecord({ role: "ab", shape: "c" }));
  const b = canonicalIdentityString(baseRecord({ role: "a", shape: "bc" }));
  assert.notStrictEqual(a, b, "boundary-ambiguous field vectors must not collide");
  // (ii) a value EMBEDDING the raw \x1f delimiter + a fake field prefix must NOT alias a real field split:
  const forge = canonicalIdentityString(baseRecord({ role: "x" + String.fromCharCode(31) + "shape=INJECTED" }));
  const real = canonicalIdentityString(baseRecord({ role: "x", shape: "INJECTED" }));
  assert.notStrictEqual(forge, real, "a value embedding the raw \\x1f must not forge a real field split (JSON escapes it)");
});
test("canonicalIdentityString is stable for missing fields (serializes as empty)", () => {
  const s = canonicalIdentityString({});
  assert.strictEqual(typeof s, "string");
  assert.ok(s.includes("role="));
});

// ── AC-12: workorder_digest rides the same-session signature ───────────────────────────────────────
test("AC-12: a record carrying workorder_digest signs + verifies", () => {
  const digest = workOrderDigest(workorder);
  const r = signedRecord({ workorder_digest: digest });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.strictEqual(verifyRecord(r), true, "a record with a correctly-signed workorder_digest must verify");
});
test("AC-12: a post-hoc workorder_digest SWAP invalidates the signature", () => {
  const digest = workOrderDigest(workorder);
  const r = signedRecord({ workorder_digest: digest });
  assert.strictEqual(verifyRecord(r), true, "sanity: signs clean before tampering");
  // swap in a digest for a DIFFERENT (tampered) WorkOrder identity, post-hoc — same trick as flipping
  // verdict/ok/fallback: mutate a signed field without re-signing.
  const swappedDigest = workOrderDigest({ ...workorder, base_commit: "attacker-controlled-base" });
  assert.notStrictEqual(swappedDigest, digest, "sanity: the swapped digest really is different");
  r.workorder_digest = swappedDigest;
  assert.strictEqual(verifyRecord(r), false, "a post-hoc workorder_digest swap must invalidate the signature");
});
test("AC-12: a record with NO workorder_digest still signs/verifies (additive — non-WorkOrder records unaffected)", () => {
  const r = signedRecord(); // no workorder_digest at all
  assert.strictEqual(verifyRecord(r), true);
});
test("AC-12: setting workorder_digest on an already-signed (undigested) record invalidates it (no free upgrade)", () => {
  const r = signedRecord(); // signed with workorder_digest implicitly "" (absent)
  r.workorder_digest = workOrderDigest(workorder); // add it post-hoc without re-signing
  assert.strictEqual(verifyRecord(r), false, "adding a workorder_digest post-hoc must not silently validate");
});
test("AC-12: re-signing after legitimately adding workorder_digest verifies again (the correct writer path)", () => {
  const r = baseRecord({ workorder_digest: workOrderDigest(workorder) });
  r.attest_sig = signRecord(r); // the trusted writer signs the FULL record including workorder_digest
  assert.strictEqual(verifyRecord(r), true);
});
