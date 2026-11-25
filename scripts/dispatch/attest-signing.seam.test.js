"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const os = require("node:os");
const path = require("node:path");
mcEnv.setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `attest-seam-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`));
const crypto = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert");
const { SIGNED_FIELDS, canonicalIdentityString, signRecord, verifyRecord } = require("./attest-signing");

const SECRET = crypto.randomBytes(32);
const sigUnder = (rec, fields) => crypto.createHmac("sha256", SECRET).update(canonicalIdentityString(rec, fields)).digest("hex");
const rec = () => ({ role: "security-reviewer", shape: "cli", provider: "openai", tool_id: "codex", ok: true, verdict: "PASS", sprint_id: "SP-1", completed_at: "2026-10-31T00:00:00.000Z" });

test("seam (1) a record signed under the CURRENT list verifies under a FUTURE list appending auth_mode (record lacks it)", () => {
  const r = rec();
  const sig = sigUnder(r, SIGNED_FIELDS);
  assert.strictEqual(sigUnder(r, [...SIGNED_FIELDS, "auth_mode"]), sig, "appending ONE absent trailing field must not change the canonical");
  assert.strictEqual(sigUnder(r, [...SIGNED_FIELDS, "auth_mode", "provider_run_id"]), sig, "a RUN of absent trailing fields truncates to the same canonical");
});

test("seam (1b) truncation is TRAILING-ONLY: a present trailing field forces mid-list gaps to be encoded", () => {
  const rGap = { ...rec(), gauntlet_run_id: "g-" + "a".repeat(32) };
  assert.notStrictEqual(sigUnder(rGap, SIGNED_FIELDS), sigUnder(rec(), SIGNED_FIELDS), "a present trailing field encodes the mid-list gaps (not truncated)");
});

test("seam (2) a RENAMED signed field fails", () => {
  const r = rec(); r.attest_sig = signRecord(r, SECRET);
  assert.strictEqual(verifyRecord(r, SECRET), true, "sanity");
  const { verdict, ...rest } = r;
  assert.strictEqual(verifyRecord({ ...rest, verdict_renamed: verdict }, SECRET), false);
  assert.notStrictEqual(sigUnder(rec(), SIGNED_FIELDS), sigUnder(rec(), SIGNED_FIELDS.map((f) => (f === "verdict" ? "verdict_v2" : f))));
});

test("seam (3) VALUES SHIFTED between two fields fail", () => {
  const r = rec(); r.attest_sig = signRecord(r, SECRET);
  const shifted = { ...r, provider: r.tool_id, tool_id: r.provider };
  assert.strictEqual(verifyRecord(shifted, SECRET), false);
});

test("seam (control) an untouched record verifies", () => {
  const r = rec(); r.attest_sig = signRecord(r, SECRET);
  assert.strictEqual(verifyRecord(r, SECRET), true);
});

test("seam (4a) gauntlet_run_id: a record lacking the appended trailing field VERIFIES (truncation); bound exclusion is run-binding (3)", () => {
  const r = rec();
  r.attest_sig = signRecord(r, SECRET);
  assert.strictEqual(verifyRecord(r, SECRET), true, "old-era record missing the appended gauntlet_run_id verifies post-truncation");
});

test("seam (4b) auth_fallback: an old-era agy record VERIFIES by signature AND the agy close gate REFUSES it (absent auth_fallback)", () => {
  const { evaluateAgyLivenessClose } = require("../checks/agy-liveness-close-gate");
  const r = { role: "security-reviewer", shape: "cli", provider: "antigravity", tool_id: "agy", ok: true, fallback: false, verdict: "PASS", sprint_id: "SP-1", completed_at: "2026-10-31T00:00:00.000Z" };
  r.attest_sig = signRecord(r, SECRET);
  assert.strictEqual(verifyRecord(r, SECRET), true, "verifies: auth_fallback is a trailing appended field, truncated");
  const gate = evaluateAgyLivenessClose(r);
  assert.strictEqual(gate.closeable, false, "the agy close gate refuses a record with auth_fallback absent");
  assert.strictEqual(gate.checks.authProven, false);
});

test("seam (4c) workorder_digest: the acceptance reader REFUSES a record missing workorder_digest", () => {
  const { authorizesIntegration } = require("./acceptance-record");
  const base = { target_ref: "refs/heads/x", terminal_state: "success", result_tree_hash: "a".repeat(64), workorder_digest: "b".repeat(64), base_commit: "c".repeat(40), result_commit: "d".repeat(40) };
  const missing = { ...base }; delete missing.workorder_digest;
  assert.strictEqual(authorizesIntegration(missing, "refs/heads/x"), false, "a record missing workorder_digest never authorizes integration");
});
