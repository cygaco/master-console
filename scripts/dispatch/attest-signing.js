"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * attest-signing.js — ORIGIN-PROOF for the binding security-panel attestation (SP-20260718-003, ED-231;
 * α RULING option (A) + (C)-honesty; ADR-0025).
 *
 * THE PROBLEM (gauntlet-caught, reproduced): cert-attest.attestLane/attestPanelRun validated record FIELDS
 * (shape/role/provider/panel_run_id/code_sha/digests) but NEVER proved WRITER ORIGIN — so a HAND-AUTHORED
 * ledger record with the right fields ATTESTED ok:true. In this system the primary actor is an AI agent with
 * NORMAL ledger-write access, so a mistaken/shortcut-taking component hand-writing a plausible record is the
 * exact mistake-class (feedback_never_claim_done_without_proof: the 2026-06 faked-ε-dispatch precedent). A
 * field-only attestor is a rubber-stamp of whatever is in the file.
 *
 * THE FIX: a per-session HMAC secret the FS-writer cannot forge WITHOUT deliberate intent. The TWO trusted
 * writers (dispatch-agent.recordCompletion — the single choke-point BOTH the CLI records AND epsilon-runtime's
 * in-process hunter go through) sign the canonical IDENTITY fields; cert-attest VERIFIES and FAILS-CLOSED on an
 * absent/invalid signature. A hand-authored record has no valid signature → it cannot attest.
 *
 * HONEST CEILING (named, accepted — ADR-0025): the secret lives in a gitignored runtime file, so a SAME-USER
 * FS-READ adversary can read it and forge a valid signature (or edit the attestor / read any local key). NO
 * local scheme beats a same-user adversary — that boundary is the machine/user account (the SP-001 raced-
 * hard-link honest-ceiling class). This converts forgery from MISTAKE-REACHABLE to REQUIRES-DELIBERATE-INTENT
 * (read the secret + re-sign), which is the design goal; the residual is the named account boundary, not a
 * silent hole.
 *
 * SCOPE (α): verification is REQUIRED on the BINDING attestation surface ONLY (the cert-attest path). The
 * broader gauntlet-verify ok:true liveness readers are UNTOUCHED this session — whole-ledger signing is a
 * Phase-2 identity/portability item (tracked). Signing every record is additive + harmless to those readers.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
// Gitignored runtime secret (same dir as the ledger — .claude/runtime/ is gitignored). Created once, reused by
// every process this session. A dedicated test secret path is honored so a bite-test never touches the real one.
const SECRET_FILE =
  mcEnv.readEnv("ATTEST_SECRET_FILE") || path.join(ROOT, ".claude", "runtime", ".attest-session-secret");

// The CANONICAL fields the signature covers — the fields the attestation AND the liveness readers key their
// trust on. Order is FIXED (signer + verifier must agree byte-for-byte). Binds IDENTITY + PROVENANCE + the
// TRUSTED DECISION FIELDS. SP-20260718-004 Phase 2:
//   - `verdict` (ED-231 RIDER-2): a post-hoc FAIL→PASS verdict flip invalidates the signature.
//   - `ok` + `fallback` (gauntlet R2 SR-R2-001, CRIT): the liveness readers (gauntlet-verify / dispatch-review
//     applyPanelGate) decide "ran" from `ok:true` (+ `fallback` for ran-vs-fell-back). Omitting them let a
//     signed FAIL/fallback record be edited into a passing record without invalidating the sig — the exact
//     forgery class this signing exists to close, on the fields the gate actually reads. They are now signed.
// A record with a field absent signs/verifies with the empty string for it consistently. NO legacy/multi-set
// fallback: a record signed under an OLDER field set simply fails verification and is treated as unsigned
// (fail-CLOSED — a false-RED, never a false-green). gauntlet-verify's time WINDOW scopes the reader to fresh
// records (signed under this set), so the transition is fail-safe, not a live gap. (Removing the earlier
// legacy fallback closes gauntlet R2 SR-R2-003/BE-R2-002: that fallback kept `verdict` mutable for old records.)
const SIGNED_FIELDS = Object.freeze([
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
  "verdict", // ED-231 RIDER-2
  "ok", // gauntlet R2 SR-R2-001 (CRIT) — the liveness "ran" bit the gates read
  "fallback", // gauntlet R2 SR-R2-001 — ran-vs-fell-back classification
  "sprint_id", // gauntlet R3 SR-R3-002 — the sprint-correlation field gauntlet-verify filters on
  "started_at", // gauntlet R3 SR-R3-002 — window-membership fallback (completed_at ?? started_at); un-signed → replayable
  "auth_fallback", // SP-20260723-002 / ADR-0037 (security r1 BINDING) — the agy auth-honesty bit; APPENDED at END (BE-3 byte-agree: never reorder). Unsigned, an unauthenticated agy serve's true/"indeterminate" could be edited to false with the sig still valid — the ED-225/227 settable-label class.
  // NAMED RESIDUAL (gauntlet R6 SR-R6-003 → ED-232): the BROADER correlation SELECTORS the converted readers
  // match on (run_id / phase_id / plan_item_id / skill / sprint / step) are NOT yet signed. Binding them
  // tamper-proofs re-correlation of a valid signed record — BUT `run_id` collides with the panel attestation's
  // design (cert-attest correlates by panel_run_id and MUST tolerate a different run_id — QA-014), so the
  // selector-signing set needs panel-semantics-aware design. Tracked as a bounded ED-232 refinement, not a
  // blind field-add. The CORE liveness-decision fields (ok, fallback, verdict) + identity + sprint_id +
  // started_at ARE signed — a forged/unsigned record is rejected; this residual is a same-user re-correlation
  // of an already-valid signed record (within the ADR-0025 account ceiling), lower severity than the closed class.
  //
  // APPENDED AT THE END ONLY (SP-20260718-005 BE-3, β directive: signer + verifier must byte-agree — never
  // reorder the fields above). `workorder_digest` (scripts/dispatch/workorder-schema.js#workOrderDigest) binds
  // the WorkOrder's immutable identity (schema_version/correlation_id/role/provider/model/base_commit/
  // result_tree_hash/allowed_capabilities/allowed_paths) into the same-session signature — a WorkOrder is a
  // SAME-SESSION artifact (build_spec.md "Session-scope partition" — SHARP-1), so per-session HMAC is the
  // correct trust anchor here (unlike the cross-session AcceptanceRecord/lease, which must NOT use it). A
  // post-hoc workorder_digest swap on an already-signed record invalidates the signature.
  "workorder_digest",
  // APPENDED (SP-20260723-003 r3e — qa QA-7G-007 CRITICAL / ED-273): dispatch_id is the SOLE correlation key
  // evaluatePairedWaiter groups+suppresses by (epsilon-liveness.js byId map). UNSIGNED, a validly-signed
  // ok:false death could be REPLAYED with a swapped dispatch_id to suppress a DIFFERENT dispatch's stall — the
  // signature proved "a real death happened" but NOT "THIS dispatch's death." Signing it binds the correlation
  // key so a dispatch_id swap invalidates the signature (verified===this-dispatch). END-only, byte-agree.
  "dispatch_id",
]);

let _cachedSecret;
/** The per-session HMAC secret — read from the gitignored file, created (0600-ish) on first use. Cached
 *  per-process. Same-user-readable by construction (the named ceiling). Returns a Buffer. */
function sessionSecret() {
  if (_cachedSecret !== undefined) return _cachedSecret;
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const hex = fs.readFileSync(SECRET_FILE, "utf8").trim();
      if (/^[0-9a-f]{64,}$/i.test(hex)) return (_cachedSecret = Buffer.from(hex, "hex"));
    }
    // create it
    const secret = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
    fs.writeFileSync(SECRET_FILE, secret.toString("hex"), { mode: 0o600 });
    return (_cachedSecret = secret);
  } catch (e) {
    // Fail-CLOSED at the caller: no secret → signRecord returns null (record unsigned → cannot attest);
    // verifyRecord returns false (an absent secret can never validate a signature).
    _cachedSecret = null;
    return _cachedSecret;
  }
}

/** The deterministic canonical string a record's signature covers, over `fields` (default = the current
 *  SIGNED_FIELDS). Missing fields → empty (stable). PURE. */
function canonicalIdentityString(record, fields = SIGNED_FIELDS) {
  // TYPE-PRESERVING encoding (QA-7G-012, r3g): String(123)===String("123") aliased numeric<->string on EVERY
  // signed field — a signed numeric value could be mutated to its string form (or vice versa) with the
  // signature STILL valid, and the paired-waiter's dispatch_id Map-correlation then flips to the string-keyed
  // started row and suppresses its stall. JSON.stringify encodes the TYPE (123 -> "123", "123" -> "\"123\"",
  // true -> "true"), so distinct types/values yield distinct canonical strings. Missing/null -> "" (a sentinel
  // no JSON.stringify output equals). This changes the canonical encoding, so records signed under the old
  // String() form fail verification and are treated as unsigned (fail-CLOSED in-window — the same fail-safe
  // transition as a SIGNED_FIELDS change).
  return fields.map((f) => `${f}=${record && record[f] != null ? JSON.stringify(record[f]) : ""}`).join("\x1f");
}

/** HMAC-SHA256(secret, canonicalIdentityString(record)) → hex, or null if the secret is unavailable
 *  (unsigned → the verifier fails it closed). Injectable secret for the bite-test. */
function signRecord(record, secret = sessionSecret()) {
  if (!secret) return null;
  return crypto.createHmac("sha256", secret).update(canonicalIdentityString(record)).digest("hex");
}

/** Verify record.attest_sig over the CURRENT canonical field set (identity + provenance + verdict + ok +
 *  fallback). FAIL-CLOSED: no secret, no/short sig, or a mismatch → false. Timing-safe compare. NO legacy/
 *  multi-set fallback (gauntlet R2 SR-R2-003/BE-R2-002/R2-SIGNED-FIELDS-LEGACY): a record signed under an
 *  older field set fails here and is treated as unsigned (fail-CLOSED — a false-RED, never a false-green),
 *  which is why a verdict/ok/fallback flip on ANY signed record now invalidates the signature. Injectable
 *  secret for the bite-test. */
function verifyRecord(record, secret = sessionSecret()) {
  if (!secret || !record) return false;
  const sig = record.attest_sig;
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/i.test(sig)) return false; // absent/malformed → fail-closed
  const expected = signRecord(record, secret);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

module.exports = { sessionSecret, canonicalIdentityString, signRecord, verifyRecord, SIGNED_FIELDS, SECRET_FILE };
