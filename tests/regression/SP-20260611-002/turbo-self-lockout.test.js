#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// turbo-self-lockout.test.js — SP-20260611-002 WS-G2, R-3 / AC-3.5.
//   TOP RISK (β #1, Hard AC #1): LIVE-SESSION SELF-LOCKOUT.
//
//   The R-3/R-4 fixes govern FUTURE applies only. Landing them must NOT
//   retroactively invalidate or lock out an in-flight session's EXISTING
//   authorization — the prior grant's scopes AND its spend-window anchor stay
//   UNCHANGED.
//
// EVERY operation here runs on a THROWAWAY auth FIXTURE (a temp file). This test
// NEVER reads, writes, re-applies against, or even resolves the live ~/.claude or
// repo auth.json. If this file ever touched a live auth path it would be the
// self-lockout itself — so the fixture is constructed locally and asserted to be
// under the OS temp dir before any write.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const apply = require(path.join(ROOT, "scripts", "turbo", "apply.js"));
const ledger = require(path.join(ROOT, "scripts", "turbo", "spend-ledger.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.stack || e.message}`);
  }
}

// Build a THROWAWAY auth fixture shaped like a CURRENT live grant (the kind an
// in-flight session would already have on disk). Asserts the path is under the OS
// temp dir — a guard so this test can never operate on a live auth.json.
function throwawayLiveGrant(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp002-lockout-"));
  const tmpRoot = path.resolve(os.tmpdir());
  assert.ok(
    path.resolve(dir).startsWith(tmpRoot),
    "SAFETY: the auth fixture MUST live under the OS temp dir, never a live auth.json",
  );
  const authPath = path.join(dir, "authorization.json");
  const grantedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90m ago
  const grant = {
    schema: "mc/auth/v1",
    scopes: ["manifest-edit", "write-jsonl", "node-e-fs"],
    ttl_min: 180,
    granted_at: grantedAt,
    session_started_at: grantedAt,
    expires_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    reason: "in-flight build session",
    spend_ceiling_usd: 500,
    ...extra,
  };
  fs.writeFileSync(authPath, JSON.stringify(grant, null, 2) + "\n");
  return { authPath, grant };
}

// ── AC-3.5: the prior grant's scopes + anchor survive landing the fixes ───────
ok("AC-3.5: reading the prior grant under the new code returns its EXACT scopes + anchor", () => {
  const { authPath, grant } = throwawayLiveGrant();
  // Read it the way the new spend-ledger does (anchor resolution path).
  const led = ledger.computeLedger({
    completionsFile: authPath + ".no-completions.jsonl", // none → $0, just exercise anchor read
    authFile: authPath,
  });
  assert.strictEqual(led.ceilingUsd, 500, "the prior $500 ceiling is unchanged");
  assert.strictEqual(led.ceilingSource, "runtime-override");
  assert.strictEqual(led.sinceIso, grant.session_started_at, "the prior spend-window anchor is unchanged");
  // The file on disk is byte-identical — reading it did not mutate it.
  const onDisk = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.deepStrictEqual(onDisk.scopes, grant.scopes, "scopes unchanged on disk");
  assert.strictEqual(onDisk.session_started_at, grant.session_started_at, "anchor unchanged on disk");
});

ok("AC-3.5: a legacy live grant (NO session_started_at) is NOT locked out — anchor falls back to granted_at", () => {
  // An in-flight session that predates this sprint has granted_at but no anchor.
  // The fix must NOT drop its spend window to zero or refuse its reads.
  const { authPath, grant } = throwawayLiveGrant({ session_started_at: undefined });
  delete JSON.parse(fs.readFileSync(authPath, "utf8")).session_started_at; // sanity
  // Re-write without the anchor field to simulate a true legacy record.
  const legacy = JSON.parse(fs.readFileSync(authPath, "utf8"));
  delete legacy.session_started_at;
  fs.writeFileSync(authPath, JSON.stringify(legacy, null, 2) + "\n");

  const led = ledger.computeLedger({
    completionsFile: authPath + ".none.jsonl",
    authFile: authPath,
  });
  assert.strictEqual(led.ceilingUsd, 500, "legacy grant ceiling preserved");
  assert.strictEqual(led.sinceIso, grant.granted_at, "legacy grant window falls back to granted_at — no lockout");
  assert.ok(!led.error, "no fault reading a legacy grant");
});

ok("AC-3.5: a NON-widening re-apply against the prior grant succeeds + PRESERVES the anchor", () => {
  // Simulate the operator re-confirming the SAME (or narrower) grant mid-session.
  // This is the most common in-session action; it must never require attestation
  // and must preserve the existing session anchor (no spend reset, no lockout).
  const { authPath, grant } = throwawayLiveGrant();
  const prior = JSON.parse(fs.readFileSync(authPath, "utf8"));

  // Re-apply the same scopes, same ceiling — not a widening.
  const next = apply.writeAuthorization(
    grant.scopes, // identical scopes
    180,
    "re-confirm",
    500, // same ceiling
    { authPath, prior },
  );
  assert.strictEqual(next.session_started_at, grant.session_started_at, "the session anchor is PRESERVED across the re-confirm");
  assert.deepStrictEqual(next.scopes, grant.scopes, "scopes unchanged");
  assert.strictEqual(next.spend_ceiling_usd, 500, "ceiling unchanged");
  // granted_at refreshes (latest grant time) but the ANCHOR — what spend keys off — does not.
  assert.notStrictEqual(next.granted_at, grant.granted_at, "granted_at refreshes (expected)");
  assert.strictEqual(next.session_started_at, prior.session_started_at, "anchor identity is the invariant that prevents lockout");
});

ok("AC-3.5: the new safety floor does NOT block the prior grant's existing approved scope (write/mkdir)", () => {
  const gate = require(path.join(ROOT, "scripts", "hooks", "authorization-gate.js"));
  // A legitimate node-e-fs WRITE (the kind the in-flight session relies on) is
  // still matched + approvable — the narrowing only dropped rm/unlink.
  const writeMatch = gate.matchNodeEFs("Bash", { command: 'node -e "fs.writeFileSync(\'x.txt\',\'hi\')"' });
  assert.ok(writeMatch && writeMatch.scope === "node-e-fs", "a legitimate write is still scope-matched (no lockout of normal work)");
});

console.log(`\nSP-20260611-002 turbo-self-lockout: ${pass} passed, ${fail} failed`);
console.log("  [SAFETY] all auth writes targeted throwaway temp fixtures — no live auth.json touched.");
process.exit(fail ? 1 : 0);
