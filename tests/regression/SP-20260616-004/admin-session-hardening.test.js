#!/usr/bin/env node
"use strict";

/**
 * admin-session-hardening.test.js — E-MC-READINESS Track-2 security finding (2 HIGH).
 *
 * The admin session cookie was `base64url(email).hmac(email)` — NO expiry, NO revocation:
 * a leaked cookie was a permanent skeleton key, and no secure set-path shipped. Hardened to
 * bind the signature to email|iat|version with a 7-day expiry + a version revocation lever,
 * plus a reference setAdminSessionCookie() with HttpOnly/Secure/SameSite/Max-Age.
 *
 * The logic lives in a .tmpl (TS, not node-runnable), so this (a) replicates the EXACT token
 * algorithm and proves the security PROPERTIES hold, and (b) structurally asserts the template
 * implements that exact design (so a divergence is caught).
 *
 *   node tests/regression/SP-20260616-004/admin-session-hardening.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { createHmac, timingSafeEqual } = require("node:crypto");

const ROOT = path.resolve(__dirname, "../../..");
const TMPL = path.join(ROOT, "_mc/templates/app-scaffold/src/lib/admin/config.ts.tmpl");

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; fails.push(`${name}: ${e.message}`); console.log(`  FAIL ${name} — ${e.message}`); }
}

// ── Replica of the template's token algorithm (kept byte-aligned with config.ts.tmpl) ──
// hmacKey is a throwaway unit-test fixture (env-overridable), NOT a credential.
const hmacKey = process.env.TEST_HMAC_KEY || "x".repeat(24);
const MAX_AGE = 60 * 60 * 24 * 7, SKEW = 300;
const norm = (e) => String(e || "").trim().toLowerCase();
const sign = (email, iat, version, key) => createHmac("sha256", key).update(`${email}|${iat}|${version}`).digest("base64url");
function safeEq(a, b) { const l = Buffer.from(a), r = Buffer.from(b); return l.length === r.length && timingSafeEqual(l, r); }
function issue(email, version = "1", nowSec = Math.floor(Date.now() / 1000)) {
  const e = norm(email);
  return `${Buffer.from(e).toString("base64url")}.${nowSec}.${version}.${sign(e, nowSec, version, hmacKey)}`;
}
function verify(value, version = "1", nowSec = Math.floor(Date.now() / 1000)) {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [enc, iatRaw, ver, sig] = parts;
  const email = norm(Buffer.from(enc, "base64url").toString("utf8"));
  if (!email || !sig || !/^\d+$/.test(iatRaw)) return null;
  const iat = Number.parseInt(iatRaw, 10);
  if (!Number.isFinite(iat)) return null;
  if (ver !== version) return null;
  if (nowSec - iat > MAX_AGE) return null;
  if (iat - nowSec > SKEW) return null;
  return safeEq(sig, sign(email, iat, ver, hmacKey)) ? email : null;
}

const NOW = 1_700_000_000;
test("roundtrip: a freshly issued token verifies to the (normalized) email", () => {
  assert.strictEqual(verify(issue("Founder@X.io", "1", NOW), "1", NOW), "founder@x.io");
});
test("EXPIRY: a token older than the max-age is rejected (the leaked-cookie-is-forever fix)", () => {
  assert.strictEqual(verify(issue("f@x.io", "1", NOW - MAX_AGE - 1), "1", NOW), null);
});
test("expiry boundary: a token at exactly max-age still verifies", () => {
  assert.strictEqual(verify(issue("f@x.io", "1", NOW - MAX_AGE), "1", NOW), "f@x.io");
});
test("REVOCATION: a token signed under a retired version is rejected", () => {
  assert.strictEqual(verify(issue("f@x.io", "1", NOW), "2", NOW), null); // founder bumped ADMIN_SESSION_VERSION
});
test("future-dated: a token issued beyond the clock skew is rejected (can't extend the window)", () => {
  assert.strictEqual(verify(issue("f@x.io", "1", NOW + SKEW + 60), "1", NOW), null);
});
test("tamper: flipping the email segment breaks the signature", () => {
  const parts = issue("f@x.io", "1", NOW).split(".");
  parts[0] = Buffer.from("attacker@x.io").toString("base64url");
  assert.strictEqual(verify(parts.join("."), "1", NOW), null);
});
test("tamper: forging a fresh iat (to dodge expiry) breaks the signature", () => {
  const parts = issue("f@x.io", "1", NOW - MAX_AGE - 100).split(".");
  parts[1] = String(NOW);
  assert.strictEqual(verify(parts.join("."), "1", NOW), null);
});
test("legacy 2-part token (pre-hardening format) is rejected", () => {
  const enc = Buffer.from("f@x.io").toString("base64url");
  const legacy = `${enc}.${createHmac("sha256", hmacKey).update("f@x.io").digest("base64url")}`;
  assert.strictEqual(verify(legacy, "1", NOW), null);
});
test("non-canonical iat ('NOWabc') is rejected up front (GPT review hardening)", () => {
  const parts = issue("f@x.io", "1", NOW).split(".");
  parts[1] = NOW + "abc";
  assert.strictEqual(verify(parts.join("."), "1", NOW), null);
});

// ── Structural: the template implements this exact hardened design ──
const tmpl = fs.readFileSync(TMPL, "utf8");
test("template binds the signature to email|iat|version", () => {
  assert.ok(/update\(`\$\{email\}\|\$\{iat\}\|\$\{version\}`\)/.test(tmpl), "HMAC over email|iat|version");
});
test("template enforces expiry + version-revocation + 4-part parse", () => {
  assert.ok(/now - iat > ADMIN_SESSION_MAX_AGE_SECONDS/.test(tmpl), "expiry check");
  assert.ok(/version !== adminSessionVersion\(\)/.test(tmpl), "version revocation check");
  assert.ok(/parts\.length !== 4/.test(tmpl), "4-part format");
  assert.ok(/test\(iatRaw\)/.test(tmpl), "canonical iat validation");
});
test("template ships setAdminSessionCookie with the secure flags", () => {
  assert.ok(/export async function setAdminSessionCookie/.test(tmpl), "set helper exported");
  assert.ok(/httpOnly:\s*true/.test(tmpl) && /sameSite:/.test(tmpl) && /maxAge:/.test(tmpl) && /secure:\s*process\.env\.NODE_ENV/.test(tmpl), "secure cookie flags");
});

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — admin-session-hardening: ${passed} passed, ${failed} failed`);
if (failed) { console.error("\n" + fails.join("\n")); process.exit(1); }
