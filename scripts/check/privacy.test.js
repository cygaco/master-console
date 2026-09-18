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
// H3 (r6): known-names.json is gitignored, so it is ALWAYS absent in this checkout — every
// existing test here targets a DIFFERENT pattern (email/credential/homedir) and must not be
// drowned out by the (correct, by-design) known-name INACTIVE refusal. `run()` therefore always
// passes --no-name-check, matching what leak-gate.js does for the same reason. The two dedicated
// H3 tests below bypass run() and call spawnSync directly so they can assert the true bare/flagged
// behaviour precisely.
function run(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--no-name-check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
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

// S-OS-06 (β `4f81c60d` scope limit): the tag-predicate proof runs with an EMPTY allowlist, which is the
// strongest form for that predicate precisely BECAUSE it neutralises `emails` / `emailDomains` /
// `emailDomainSuffixes`. Measured consequence: those three branches had NO coverage anywhere in this file —
// its only construction of them was the empty object. All three return TRUE (= "not personal data"), so an
// error in any of them fails OPEN in a fail-closed PII gate. privacy.allowlist.json's own `_comment` names
// THIS file as its enforcer, so the claim was aspirational until now. Live exposure when written: NONE —
// the shipped allowlist's six suffixes are all dot-prefixed and none is empty. These are regression guards
// on a latent footgun, not a repair of a live leak.
const mkAllow = (o) => Object.assign({ emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] }, o);

test("allowlist branch: an exact `emails` entry matches, a near-miss does not", () => {
  const allow = mkAllow({ emails: new Set(["git@github.com"]) });
  assert.strictEqual(isAllowlistedEmail("git@github.com", allow), true);
  assert.strictEqual(isAllowlistedEmail("git@github.com.evil.example", allow), false);
});

test("allowlist branch: `emailDomains` matches the WHOLE domain, never a subdomain of it", () => {
  const allow = mkAllow({ emailDomains: new Set(["example.com"]) });
  assert.strictEqual(isAllowlistedEmail("a@example.com", allow), true);
  // split so this literal is not itself a live match — `evil-example.com` is NOT an allowlisted
  // domain, so an inline literal here would (correctly) be flagged by this file's own live-tree test
  const nearMiss = ["a", "evil-example." + "com"].join("@");
  assert.strictEqual(isAllowlistedEmail(nearMiss, allow), false);
});

test("allowlist branch: an EMPTY `emailDomainSuffixes` entry must NOT allowlist every address", () => {
  // `"anything".endsWith("")` is always true, so a stray "" entry silently allowlists the whole world.
  const allow = mkAllow({ emailDomainSuffixes: [""] });
  const victim = ["victim", "totally-real." + "com"].join("@"); // split so the literal is not itself a live match
  assert.strictEqual(
    isAllowlistedEmail(victim, allow),
    false,
    "an empty suffix entry allowlisted a real address — every email would be treated as non-personal",
  );
});

test("allowlist branch: a DOTLESS `emailDomainSuffixes` entry must NOT allowlist a whole TLD", () => {
  const allow = mkAllow({ emailDomainSuffixes: ["com"] });
  const victim = ["victim", "evil." + "com"].join("@"); // split so the literal is not itself a live match
  assert.strictEqual(
    isAllowlistedEmail(victim, allow),
    false,
    "a dotless suffix allowlisted an unrelated .com address — a suffix must be anchored at a label boundary",
  );
  // the legitimate, dot-prefixed form still works
  assert.strictEqual(isAllowlistedEmail("x@host.local", mkAllow({ emailDomainSuffixes: [".local"] })), true);
});

test("H3 fail-open regression (r6): an absent known-names.json refuses (exit 2) WITHOUT --no-name-check", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--files", SCRIPT], { cwd: ROOT, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 2, out);
  assert.match(out, /known-names: INACTIVE/);
  assert.doesNotMatch(out, /result: OK/);
});

test("H3 fail-open regression (r6): --no-name-check proceeds and still runs the other patterns", () => {
  const f = tmpFile("nothing interesting here\n");
  const r = spawnSync(
    process.execPath,
    [SCRIPT, "--files", f, "--no-name-check"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const out = r.stdout + r.stderr;
  assert.match(out, /known-names: INACTIVE/); // still printed loudly
  assert.strictEqual(r.status, 0, out); // but does not block — the clean file has 0 findings
});

test("H2 fail-open regression (r6): a git-listing failure must refuse (exit 2), never report a vacuous OK", () => {
  const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-nogit-"));
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: noGitDir, encoding: "utf8" });
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /refusing to read green/);
  assert.doesNotMatch(r.stdout, /result: OK/);
});

test("H2 fail-open regression (r6): the live tree clears the committed minimum-file floor", () => {
  const r = run([]);
  assert.strictEqual(r.code, 0, r.out.split("\n").slice(0, 10).join("\n"));
  const m = r.out.match(/# scanned (\d+) file\(s\)/);
  assert.ok(m, r.out);
  assert.ok(Number(m[1]) >= 1000, `expected >= 1000 tracked files after filtering, saw ${m[1]}`);
});

test("H1 fail-open regression (r6): an allowlisted first match must not suppress a later real address on the SAME line", () => {
  const f = tmpFile(`contact: git@github.com and also ${PERSONAL_EMAIL} here\n`);
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /MED/);
  const findings = scanFile(f, { knownNames: [], allow: loadAllowlist() });
  const emailFindings = findings.filter((x) => x.pattern === "email");
  assert.strictEqual(emailFindings.length, 1, JSON.stringify(findings));
  assert.strictEqual(emailFindings[0].match, PERSONAL_EMAIL);
});

test("the SHIPPED allowlist file carries no empty and no dotless suffix", () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, "privacy.allowlist.json"), "utf8"));
  const sufs = shipped.emailDomainSuffixes || [];
  assert.ok(sufs.length > 0, "the shipped allowlist should carry suffixes; an empty list makes this vacuous");
  for (const s of sufs) {
    assert.notStrictEqual(String(s), "", "an empty suffix entry allowlists every address");
    assert.ok(String(s).startsWith("."), `suffix ${JSON.stringify(s)} must start with "." or it matches a whole TLD`);
  }
});
