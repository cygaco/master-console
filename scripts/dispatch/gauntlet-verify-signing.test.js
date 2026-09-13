"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * gauntlet-verify-signing.test.js — ED-231 whole-ledger signing (SP-20260718-004 Phase 2, β RIDER-1,
 * MISTAKE-CLASS priority). Proves the liveness reader (the release/WG-19 gate) rejects a FORGED
 * UNSIGNED ok:true record — the same mistake class ADR-0025 closed on the cert-attest binding surface,
 * one reader over. A regression here = a hand-authored ok:true liveness record fooling the release gate.
 *
 * Fixture (iv) from the qa-plan: forged UNSIGNED ok:true record must NOT pass the release gate.
 */
// Isolate the HMAC secret to a temp file so the test never touches the real one (must be set BEFORE
// requiring attest-signing, which computes SECRET_FILE from the env at load).
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
mcEnv.setEnv(
  "ATTEST_SECRET_FILE",
  path.join(os.tmpdir(), `gv-signing-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`),
);

const crypto = require("node:crypto");
const { test } = require("node:test");
const assert = require("node:assert");
const { verifyGauntlet } = require("./gauntlet-verify");
const { signRecord, verifyRecord, sessionSecret, canonicalIdentityString, SIGNED_FIELDS } = require("./attest-signing");

const NOW = new Date();
const SINCE = NOW.getTime() - 60_000;

function wellFormed(overrides = {}) {
  return {
    role: "security-reviewer",
    ok: true,
    provider: "openai",
    model: "gpt-5.5",
    completed_at: NOW.toISOString(),
    tool_id: "codex",
    cmdline_checksum: "abc123",
    ...overrides,
  };
}
function signed(overrides = {}) {
  const r = wellFormed(overrides);
  r.attest_sig = signRecord(r);
  return r;
}

test("requireSignature:false (legacy default) — an unsigned well-formed ok:true record still counts as ran", () => {
  const res = verifyGauntlet({ roles: ["security-reviewer"], since: SINCE, records: [wellFormed()] });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.roles[0].status, "ran");
});

test("FIXTURE (iv): requireSignature:true — a FORGED UNSIGNED ok:true record is rejected (fail-closed)", () => {
  const res = verifyGauntlet({
    roles: ["security-reviewer"],
    since: SINCE,
    requireSignature: true,
    records: [wellFormed()], // no attest_sig — the forged/unsigned liveness record
  });
  assert.strictEqual(res.ok, false, "an unsigned ok:true record must NOT green the gauntlet");
  assert.strictEqual(res.roles[0].status, "unsigned");
  assert.ok(res.missingRoles.includes("security-reviewer"));
});

test("requireSignature:true — a record with a BOGUS signature is rejected (fail-closed)", () => {
  const res = verifyGauntlet({
    roles: ["security-reviewer"],
    since: SINCE,
    requireSignature: true,
    records: [wellFormed({ attest_sig: "0".repeat(64) })],
  });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.roles[0].status, "unsigned");
});

test("requireSignature:true — a PROPERLY SIGNED record passes (no false-RED on real records)", () => {
  const res = verifyGauntlet({
    roles: ["security-reviewer"],
    since: SINCE,
    requireSignature: true,
    records: [signed()],
  });
  assert.strictEqual(res.ok, true, "a validly signed origin-proof record must green");
  assert.strictEqual(res.roles[0].status, "ran");
});

test("requireSignature:true — a signed record whose IDENTITY field was tampered after signing is rejected", () => {
  const r = signed();
  r.role = "security-reviewer"; // role is a SIGNED field; tampering the provider invalidates the sig
  r.provider = "claude"; // flip provider after signing → signature no longer matches
  const res = verifyGauntlet({ roles: ["security-reviewer"], since: SINCE, requireSignature: true, records: [r] });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.roles[0].status, "unsigned");
});

test("ED-231 RIDER-2 (sign-the-verdict): flipping a signed record's verdict FAIL→PASS invalidates the sig", () => {
  // A real signed record with verdict:fail; a same-user adversary flips it to pass. Because `verdict`
  // is now a SIGNED field, the flip no longer matches the signature → the record is rejected as unsigned.
  const r = signed({ verdict: "fail" });
  r.verdict = "pass"; // post-hoc flip of a signed record
  const res = verifyGauntlet({ roles: ["security-reviewer"], since: SINCE, requireSignature: true, records: [r] });
  assert.strictEqual(res.ok, false, "a tampered verdict must invalidate the origin-proof signature");
  assert.strictEqual(res.roles[0].status, "unsigned");
});

test("R2 SR-R2-003: a record signed with the LEGACY (pre-verdict) field set is REJECTED (no verdict-flip loophole)", () => {
  // A legacy signature (over the old field set, no verdict/ok/fallback) must NOT verify — the legacy
  // fallback was removed because it kept verdict/ok/fallback mutable for old records. Fail-CLOSED (safe).
  const secret = sessionSecret();
  const legacyFields = SIGNED_FIELDS.filter((f) => !["verdict", "ok", "fallback"].includes(f));
  const r = wellFormed({ verdict: "pass" });
  r.attest_sig = crypto.createHmac("sha256", secret).update(canonicalIdentityString(r, legacyFields)).digest("hex");
  assert.strictEqual(verifyRecord(r), false, "a legacy-signed record must NOT verify (fail-closed, no flip loophole)");
});

test("SR-R2-001: flipping a signed record's ok:false→ok:true invalidates the signature (ok is signed)", () => {
  const r = signed({ ok: false, verdict: "fail" });
  r.ok = true; // a real FAILURE record edited to passing
  assert.strictEqual(verifyRecord(r), false, "flipping the signed ok bit must invalidate the sig");
  const res = verifyGauntlet({ roles: ["security-reviewer"], since: SINCE, requireSignature: true, records: [r] });
  assert.strictEqual(res.ok, false);
});

test("SR-R2-001: flipping a signed record's fallback bit invalidates the signature", () => {
  const r = signed({ fallback: true });
  r.fallback = false; // ran-vs-fell-back tamper
  assert.strictEqual(verifyRecord(r), false);
});

test("SR-R3-002: flipping a signed record's sprint_id (correlation) invalidates the signature", () => {
  const r = signed({ sprint_id: "SP-A" });
  r.sprint_id = "SP-B"; // replay a signed record into a different sprint's correlation
  assert.strictEqual(verifyRecord(r), false, "sprint_id must be signed (no cross-sprint replay of a signed record)");
});

test("SR-R3-002: flipping a signed record's started_at (window) invalidates the signature", () => {
  const r = signed({ started_at: "2026-01-01T00:00:00.000Z" });
  r.started_at = "2030-01-01T00:00:00.000Z"; // shift window membership
  assert.strictEqual(verifyRecord(r), false);
});

test("a FORGED record with NO valid signature is still rejected (mistake-class intact)", () => {
  const r = wellFormed({ attest_sig: "a".repeat(64) });
  assert.strictEqual(verifyRecord(r), false);
});

// Clean up the temp secret file.
test("cleanup", () => {
  try { fs.unlinkSync(mcEnv.readEnv("ATTEST_SECRET_FILE")); } catch { /* ignore */ }
});
