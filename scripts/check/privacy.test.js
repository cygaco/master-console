"use strict";
/**
 * privacy.test.js — RED proof + known-answer for scripts/check/privacy.js (S-OS-04 / ED-417).
 *
 *   node --test scripts/check/privacy.test.js
 *
 * Fixtures are BUILT AT RUNTIME (string concatenation) so this file never carries a
 * credential-shaped token or a non-placeholder email literally — the gate scans this
 * file too.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "privacy.js");
const { shouldFail, isAllowlistedEmail, loadAllowlist, scanFile } = require("./privacy");

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-test-"));
  const f = path.join(dir, "planted.md");
  fs.writeFileSync(f, content);
  return f;
}
function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

// Runtime-built fixtures.
const PERSONAL_EMAIL = ["leaky", "operator"].join(".") + "@" + "gmail" + ".com";
const PLACEHOLDER_EMAIL = "founder@" + "example.com";
const CREDENTIAL = "sk-" + "a1b2c3d4e5f6g7h8i9j0".repeat(2);

test("RED proof: a planted non-placeholder email FAILS by default (exit 1)", () => {
  const f = tmpFile(`contact: ${PERSONAL_EMAIL}\n`);
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /MED/);
});

test("RED proof: a planted credential marker FAILS even in --advisory (exit 1)", () => {
  const f = tmpFile(`token=${CREDENTIAL}\n`);
  assert.strictEqual(run(["--files", f]).code, 1);
  assert.strictEqual(run(["--files", f, "--advisory"]).code, 1);
});

test("--advisory keeps the pre-S-OS-04 behaviour: a MED-only file exits 0", () => {
  const f = tmpFile(`contact: ${PERSONAL_EMAIL}\n`);
  assert.strictEqual(run(["--files", f, "--advisory"]).code, 0);
});

test("known-answer: a release tag / compare range is not an email finding", () => {
  const allow = loadAllowlist();
  assert.strictEqual(isAllowlistedEmail("warpos@1.2.0", allow), true);
  assert.strictEqual(isAllowlistedEmail("warpos@1.2.0...main", allow), true);
  assert.strictEqual(isAllowlistedEmail("someone@1and1." + "biz", allow), false); // split so the live scan never sees an address literal
  const f = tmpFile("[Unreleased]: https://github.com/cygaco/MC/compare/warpos@1.2.0...main\n");
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 0, r.out);
});

test("known-answer: an allowlisted placeholder email is not a finding (exit 0)", () => {
  const f = tmpFile(`contact: ${PLACEHOLDER_EMAIL}\n`);
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /0 finding\(s\)/);
});

test("LOW homedir paths are report-only by default, failing only under --strict", () => {
  const f = tmpFile("see " + ["C:", "Users", "someone", "x.txt"].join("\\") + "\n");
  assert.strictEqual(run(["--files", f]).code, 0);
  assert.strictEqual(run(["--files", f, "--strict"]).code, 1);
});

test("shouldFail() mode table", () => {
  const low = [{ severity: "LOW" }];
  const med = [{ severity: "MED" }];
  const high = [{ severity: "HIGH" }];
  assert.strictEqual(shouldFail(low, "default"), false);
  assert.strictEqual(shouldFail(med, "default"), true);
  assert.strictEqual(shouldFail(high, "default"), true);
  assert.strictEqual(shouldFail(low, "strict"), true);
  assert.strictEqual(shouldFail(med, "advisory"), false);
  assert.strictEqual(shouldFail(high, "advisory"), true);
  assert.strictEqual(shouldFail([], "strict"), false);
});

test("allowlist semantics: exact, domain, suffix — and a real-looking address is NOT allowlisted", () => {
  const allow = loadAllowlist();
  assert.ok(isAllowlistedEmail("git@github.com", allow));
  assert.ok(isAllowlistedEmail("Anyone@Example.COM", allow));
  assert.ok(isAllowlistedEmail("bot@users.noreply.github.com", allow));
  assert.ok(isAllowlistedEmail("founder@admin-preview.local", allow));
  assert.strictEqual(isAllowlistedEmail(PERSONAL_EMAIL, allow), false);
});

test("H2 fail-open regression (r5): version-tag allowlist is POSITIONAL, not a bare 'contains N.N.N' match", () => {
  const allow = loadAllowlist();
  // Legitimate release tags / compare ranges — must stay allowlisted.
  assert.strictEqual(isAllowlistedEmail("warpos@1.2.0...main", allow), true);
  assert.strictEqual(isAllowlistedEmail("mc@2.0.0", allow), true);
  assert.strictEqual(isAllowlistedEmail("warpos@0.14.0", allow), true);
  // IP-literal / version-shaped-domain bypasses — must be FLAGGED, not allowlisted.
  const hackerAddr = ["hacker", "1.2.3." + "com"].join("@"); // split so this literal isn't itself a live match elsewhere
  assert.strictEqual(isAllowlistedEmail(hackerAddr, allow), false);
  assert.strictEqual(isAllowlistedEmail("user@10.0.0.1", allow), false);
  const victimAddr = ["victim", "1.2.3.evil.co." + "uk"].join("@"); // split so this literal isn't itself a live match elsewhere
  assert.strictEqual(isAllowlistedEmail(victimAddr, allow), false);
  assert.strictEqual(isAllowlistedEmail(PERSONAL_EMAIL, allow), false); // real gmail-shaped address
});

test("a missing allowlist fails CLOSED (every email becomes a finding)", () => {
  const f = tmpFile(`contact: ${PLACEHOLDER_EMAIL}\n`);
  const empty = { emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] };
  const findings = scanFile(f, { knownNames: [], allow: empty });
  assert.strictEqual(findings.filter((x) => x.pattern === "email").length, 1);
});

test("live tree: the tracked repository passes the default gate (exit 0)", () => {
  const r = run([]);
  assert.strictEqual(r.code, 0, r.out.split("\n").slice(0, 30).join("\n"));
});
