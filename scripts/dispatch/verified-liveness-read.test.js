"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * verified-liveness-read.test.js — the same-session liveness choke-point (SP-20260718-004 R4).
 */
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
mcEnv.setEnv("ATTEST_SECRET_FILE", path.join(os.tmpdir(), `vlr-secret-${Date.now()}-${Math.random().toString(36).slice(2)}`));

const { test } = require("node:test");
const assert = require("node:assert");
const { isVerifiedLivenessRecord, filterVerifiedLiveness } = require("./verified-liveness-read");
const { signRecord } = require("./attest-signing");

const base = { role: "qa-reviewer", provider: "openai", completed_at: new Date().toISOString(), ok: true };
const signed = () => { const r = { ...base }; r.attest_sig = signRecord(r); return r; };

test("requireSignature default TRUE: an UNSIGNED ok:true record is NOT a verified liveness record", () => {
  assert.strictEqual(isVerifiedLivenessRecord({ ...base }), false);
});
test("a validly SIGNED ok:true record IS a verified liveness record", () => {
  assert.strictEqual(isVerifiedLivenessRecord(signed()), true);
});
test("ok:false is never live, signed or not", () => {
  const r = { ...base, ok: false }; r.attest_sig = signRecord(r);
  assert.strictEqual(isVerifiedLivenessRecord(r), false);
});
test("a tampered signed record (ok flipped) is rejected", () => {
  const r = signed(); r.ok = true; r.role = "qa-reviewer"; r.provider = "claude"; // provider is signed → tamper
  assert.strictEqual(isVerifiedLivenessRecord(r), false);
});
test("requireSignature:false accepts an unsigned ok:true record (cross-session/opt-out path)", () => {
  assert.strictEqual(isVerifiedLivenessRecord({ ...base }, { requireSignature: false }), true);
});
test("filterVerifiedLiveness keeps only the verified records", () => {
  const out = filterVerifiedLiveness([{ ...base }, signed(), { ...base, ok: false }]);
  assert.strictEqual(out.length, 1);
});
test("cleanup", () => { try { fs.unlinkSync(mcEnv.readEnv("ATTEST_SECRET_FILE")); } catch { /* ignore */ } });
