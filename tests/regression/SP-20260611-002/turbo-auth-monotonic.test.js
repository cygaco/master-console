#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// turbo-auth-monotonic.test.js — SP-20260611-002 WS-G2, R-3 / AC-3.1 + AC-3.2.
//
//   AC-3.1: a same-session WIDENING re-apply (more scope / higher ceiling /
//           extended expiry) is REFUSED unless it carries fresh operator
//           provenance (--attest); the provenance is persisted on the auth record.
//   AC-3.2: a legitimate operator re-grant WITH fresh provenance SUCCEEDS and the
//           granted_at / session anchor are preserved (attested widening stays
//           possible).
//
// SAFETY (β #1 / Hard AC #1): every apply/auth write here targets a THROWAWAY
// auth fixture path injected via the `authPath` seam — NEVER the live auth.json.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const apply = require(path.join(ROOT, "scripts", "turbo", "apply.js"));

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

function throwawayAuthPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp002-monotonic-"));
  return path.join(dir, "authorization.json");
}

const hourFromNow = () => new Date(Date.now() + 3600 * 1000).toISOString();

// ── diffWidening: the monotonic core (pure, no I/O) ──────────────────────────
ok("diffWidening: first apply (no prior) is never a widening", () => {
  const d = apply.diffWidening(null, {
    scopes: ["manifest-edit", "node-e-fs"],
    ceilingUsd: 500,
    expiresAtMs: Date.now() + 3600 * 1000,
  });
  assert.strictEqual(d.widening, false);
  assert.deepStrictEqual(d.reasons, []);
});

ok("diffWidening: adding a NEW scope is a widening", () => {
  const prior = { scopes: ["manifest-edit"], expires_at: hourFromNow() };
  const d = apply.diffWidening(prior, {
    scopes: ["manifest-edit", "node-e-fs"],
    ceilingUsd: null,
    expiresAtMs: Date.now() + 1800 * 1000,
  });
  assert.strictEqual(d.widening, true, "new scope widens");
  assert.ok(d.reasons.some((r) => /node-e-fs/.test(r)));
});

ok("diffWidening: raising the spend ceiling is a widening", () => {
  const prior = {
    scopes: ["manifest-edit"],
    spend_ceiling_usd: 100,
    expires_at: hourFromNow(),
  };
  const d = apply.diffWidening(prior, {
    scopes: ["manifest-edit"],
    ceilingUsd: 500,
    expiresAtMs: Date.now() + 1800 * 1000,
  });
  assert.strictEqual(d.widening, true);
  assert.ok(d.reasons.some((r) => /ceiling/i.test(r)));
});

ok("diffWidening: extending expiry beyond the prior grant is a widening", () => {
  const prior = {
    scopes: ["manifest-edit"],
    expires_at: new Date(Date.now() + 600 * 1000).toISOString(),
  };
  const d = apply.diffWidening(prior, {
    scopes: ["manifest-edit"],
    ceilingUsd: null,
    expiresAtMs: Date.now() + 7200 * 1000,
  });
  assert.strictEqual(d.widening, true);
  assert.ok(d.reasons.some((r) => /expiry|ttl/i.test(r)));
});

ok("diffWidening: a NARROWING re-apply (subset, lower ceiling, shorter) is NOT a widening", () => {
  const prior = {
    scopes: ["manifest-edit", "node-e-fs", "write-jsonl"],
    spend_ceiling_usd: 500,
    expires_at: new Date(Date.now() + 7200 * 1000).toISOString(),
  };
  const d = apply.diffWidening(prior, {
    scopes: ["manifest-edit"], // subset
    ceilingUsd: 100, // lower
    expiresAtMs: Date.now() + 600 * 1000, // shorter
  });
  assert.strictEqual(d.widening, false, "narrowing must not require attestation");
  assert.deepStrictEqual(d.reasons, []);
});

ok("diffWidening: an EQUAL re-apply (same scopes, omitted ceiling) is NOT a widening", () => {
  const prior = {
    scopes: ["manifest-edit", "node-e-fs"],
    spend_ceiling_usd: 500,
    expires_at: hourFromNow(),
  };
  const d = apply.diffWidening(prior, {
    scopes: ["manifest-edit", "node-e-fs"],
    ceilingUsd: null, // omitted → keeps prior, not a raise
    expiresAtMs: Date.now() + 600 * 1000, // shorter, not extended
  });
  assert.strictEqual(d.widening, false);
});

// ── AC-3.1: provenance is persisted on an attested widening write ─────────────
ok("AC-3.1: writeAuthorization persists provenance for an attested widening", () => {
  const authPath = throwawayAuthPath();
  // Prior grant on the throwaway fixture.
  apply.writeAuthorization(["manifest-edit"], 60, "initial", 100, { authPath });
  const prior = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.ok(!prior.provenance, "first grant carries no provenance");

  // Attested widening re-grant.
  const next = apply.writeAuthorization(
    ["manifest-edit", "node-e-fs"],
    60,
    "widen",
    500,
    { authPath, prior, attest: "operator Vlad approved node-e-fs + $500 for the build" },
  );
  assert.ok(Array.isArray(next.provenance), "provenance array is persisted");
  assert.strictEqual(next.provenance.length, 1);
  assert.ok(/operator Vlad/.test(next.provenance[0].note));
  assert.ok(next.provenance[0].attested_at, "attestation carries a timestamp");
  // Persisted on disk, not just returned.
  const onDisk = JSON.parse(fs.readFileSync(authPath, "utf8"));
  assert.strictEqual(onDisk.provenance.length, 1);
});

ok("AC-3.1: end-to-end — a widening re-apply WITHOUT --attest is REFUSED (exit 4)", () => {
  // Drive the real CLI against a throwaway project so we never touch live state.
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "sp002-cli-refuse-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: [] } }, null, 2),
  );
  const { spawnSync } = require("child_process");
  const APPLY = path.join(ROOT, "scripts", "turbo", "apply.js");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, MC_AUTO_MODE: "0" };

  // First apply — narrow grant, succeeds.
  const first = spawnSync(process.execPath, [APPLY, "--scope", "manifest-edit", "--ttl", "60m"], { env, encoding: "utf8" });
  assert.strictEqual(first.status, 0, "first apply succeeds");

  // Widening re-apply (adds node-e-fs) WITHOUT --attest — refused.
  const widen = spawnSync(process.execPath, [APPLY, "--scope", "manifest-edit,node-e-fs", "--ttl", "60m"], { env, encoding: "utf8" });
  assert.strictEqual(widen.status, 4, `widening without provenance must exit 4, got ${widen.status}`);
  assert.ok(/REFUSED/.test(widen.stderr), "refusal is surfaced on stderr");

  // The on-disk auth was NOT widened by the refused call.
  const auth = JSON.parse(fs.readFileSync(path.join(proj, ".claude", "runtime", "authorization.json"), "utf8"));
  assert.ok(!auth.scopes.includes("node-e-fs"), "refused widening did not leak the new scope onto disk");
});

// ── AC-3.2: attested widening succeeds, anchor + granted_at preserved ─────────
ok("AC-3.2: an attested widening SUCCEEDS and preserves the session anchor", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "sp002-cli-attest-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, ".claude", "settings.json"),
    JSON.stringify({ permissions: { allow: [] } }, null, 2),
  );
  const { spawnSync } = require("child_process");
  const APPLY = path.join(ROOT, "scripts", "turbo", "apply.js");
  const authFile = path.join(proj, ".claude", "runtime", "authorization.json");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj, MC_AUTO_MODE: "0" };

  const first = spawnSync(process.execPath, [APPLY, "--scope", "manifest-edit", "--ttl", "60m", "--spend-ceiling", "100"], { env, encoding: "utf8" });
  assert.strictEqual(first.status, 0);
  const before = JSON.parse(fs.readFileSync(authFile, "utf8"));
  const anchorBefore = before.session_started_at;
  assert.ok(anchorBefore, "first apply persisted a session anchor");

  const attest = spawnSync(
    process.execPath,
    [APPLY, "--scope", "manifest-edit,node-e-fs", "--ttl", "60m", "--spend-ceiling", "500", "--attest", "operator approved widening"],
    { env, encoding: "utf8" },
  );
  assert.strictEqual(attest.status, 0, `attested widening must succeed, got ${attest.status}: ${attest.stderr}`);
  const after = JSON.parse(fs.readFileSync(authFile, "utf8"));
  assert.ok(after.scopes.includes("node-e-fs"), "widened scope landed");
  assert.strictEqual(after.spend_ceiling_usd, 500, "raised ceiling landed");
  assert.strictEqual(after.session_started_at, anchorBefore, "the session anchor is PRESERVED across the re-grant");
  assert.ok(Array.isArray(after.provenance) && after.provenance.length === 1, "fresh provenance recorded");
});

console.log(`\nSP-20260611-002 turbo-auth-monotonic: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
