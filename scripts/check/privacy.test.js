"use strict";
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
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--no-name-check"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function makeSeededRoot(fileCount, opts) {
  const o = opts || {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-seeded-"));
  const dir = path.join(root, "scripts", "check");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "privacy.js"));
  fs.copyFileSync(path.join(__dirname, "privacy.allowlist.json"), path.join(dir, "privacy.allowlist.json"));
  if (o.names) {
    const mem = path.join(root, ".claude", "project", "memory");
    fs.mkdirSync(mem, { recursive: true });
    fs.writeFileSync(path.join(mem, "known-names.json"), JSON.stringify({ names: o.names }));
  }
  const data = path.join(root, "data");
  fs.mkdirSync(data);
  for (let i = 0; i < fileCount; i++) fs.writeFileSync(path.join(data, `f${i}.txt`), `filler line ${i}\n`);
  const g = (a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
  g(["init", "-q"]);
  g(["config", "user.email", "test@test.invalid"]);
  g(["config", "user.name", "privacy-test"]);
  g(["add", "data"]);
  g(["commit", "-q", "-m", "seed"]);
  return { root, script: path.join(dir, "privacy.js") };
}
function runSeeded(seeded, args) {
  const r = spawnSync(process.execPath, [seeded.script, ...args], { cwd: seeded.root, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

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

test("--advisory keeps the earlier behaviour: a MED-only file exits 0", () => {
  const f = tmpFile(`contact: ${PERSONAL_EMAIL}\n`);
  assert.strictEqual(run(["--files", f, "--advisory"]).code, 0);
});

test("known-answer: a release tag / compare range is not an email finding", () => {
  const allow = loadAllowlist();
  assert.strictEqual(isAllowlistedEmail("mc@1.2.0", allow), true);
  assert.strictEqual(isAllowlistedEmail("mc@1.2.0...main", allow), true);
  assert.strictEqual(isAllowlistedEmail("someone@1and1." + "biz", allow), false);
  const f = tmpFile("[Unreleased]: https://github.com/example-org/example-repo/compare/mc@1.2.0...main\n");
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

test("homedir-mac-linux matches a real /home/<user> path, not a slash-joined prose list", () => {
  const empty = { emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] };
  const homes = (content) => scanFile(tmpFile(content), { knownNames: [], allow: empty }).filter((x) => x.pattern === "homedir-mac-linux");
  assert.strictEqual(homes("logs live in " + ["", "home", "someone", "notes.txt"].join("/") + "\n").length, 1, "a planted /home/<user>/ path must be flagged");
  assert.strictEqual(homes('cd "' + ["", "Users", "someone", "repo"].join("/") + '"\n').length, 1, "a quoted /Users/<user>/ path must be flagged");
  assert.strictEqual(homes("role rows carry a tier/home/kind triple\n").length, 0, "a slash-joined prose list is not a home directory");
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
  assert.ok(isAllowlistedEmail(["bot", "users.noreply.github.com"].join("@"), allow));
  assert.ok(isAllowlistedEmail(["founder", "admin-preview.local"].join("@"), allow));
  assert.strictEqual(isAllowlistedEmail(PERSONAL_EMAIL, allow), false);
});

test("fail-open regression: version-tag allowlist is POSITIONAL, not a bare 'contains N.N.N' match", () => {
  const allow = loadAllowlist();
  assert.strictEqual(isAllowlistedEmail("mc@1.2.0...main", allow), true);
  assert.strictEqual(isAllowlistedEmail(["mc", "2.0.0"].join("@"), allow), true);
  assert.strictEqual(isAllowlistedEmail("mc@0.14.0", allow), true);
  const hackerAddr = ["hacker", "1.2.3." + "com"].join("@");
  assert.strictEqual(isAllowlistedEmail(hackerAddr, allow), false);
  assert.strictEqual(isAllowlistedEmail(["user", "10.0.0." + "1"].join("@"), allow), false);
  const victimAddr = ["victim", "1.2.3.evil.co." + "uk"].join("@");
  assert.strictEqual(isAllowlistedEmail(victimAddr, allow), false);
  assert.strictEqual(isAllowlistedEmail(PERSONAL_EMAIL, allow), false);
});

test("a missing allowlist fails CLOSED (every email becomes a finding)", () => {
  const f = tmpFile(`contact: ${PLACEHOLDER_EMAIL}\n`);
  const empty = { emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] };
  const findings = scanFile(f, { knownNames: [], allow: empty });
  assert.strictEqual(findings.filter((x) => x.pattern === "email").length, 1);
});

test("seeded clean tree: a tracked tree with no findings passes the default gate (exit 0)", () => {
  const r = runSeeded(makeSeededRoot(1010), ["--no-name-check"]);
  assert.strictEqual(r.code, 0, r.out.split("\n").slice(0, 30).join("\n"));
});

const mkAllow = (o) => Object.assign({ emails: new Set(), emailDomains: new Set(), emailDomainSuffixes: [] }, o);

test("allowlist branch: an exact `emails` entry matches, a near-miss does not", () => {
  const allow = mkAllow({ emails: new Set(["git@github.com"]) });
  assert.strictEqual(isAllowlistedEmail("git@github.com", allow), true);
  assert.strictEqual(isAllowlistedEmail("git@github.com.evil.example", allow), false);
});

test("allowlist branch: `emailDomains` matches the WHOLE domain, never a subdomain of it", () => {
  const allow = mkAllow({ emailDomains: new Set(["example.com"]) });
  assert.strictEqual(isAllowlistedEmail("a@example.com", allow), true);
  const nearMiss = ["a", "evil-example." + "com"].join("@");
  assert.strictEqual(isAllowlistedEmail(nearMiss, allow), false);
});

test("allowlist branch: an EMPTY `emailDomainSuffixes` entry must NOT allowlist every address", () => {
  const allow = mkAllow({ emailDomainSuffixes: [""] });
  const victim = ["victim", "totally-real." + "com"].join("@");
  assert.strictEqual(
    isAllowlistedEmail(victim, allow),
    false,
    "an empty suffix entry allowlisted a real address — every email would be treated as non-personal",
  );
});

test("allowlist branch: a DOTLESS `emailDomainSuffixes` entry must NOT allowlist a whole TLD", () => {
  const allow = mkAllow({ emailDomainSuffixes: ["com"] });
  const victim = ["victim", "evil." + "com"].join("@");
  assert.strictEqual(
    isAllowlistedEmail(victim, allow),
    false,
    "a dotless suffix allowlisted an unrelated .com address — a suffix must be anchored at a label boundary",
  );
  assert.strictEqual(isAllowlistedEmail(["x", "host.local"].join("@"), mkAllow({ emailDomainSuffixes: [".local"] })), true);
});

test("fail-open regression: an absent known-names.json refuses (exit 2) WITHOUT --no-name-check", () => {
  const seeded = makeSeededRoot(1);
  const r = spawnSync(process.execPath, [seeded.script, "--files", seeded.script], { cwd: seeded.root, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 2, out);
  assert.match(out, /known-names: INACTIVE/);
  assert.doesNotMatch(out, /result: OK/);
});

test("fail-open regression: --no-name-check proceeds and still runs the other patterns", () => {
  const f = tmpFile("nothing interesting here\n");
  const seeded = makeSeededRoot(1);
  const r = spawnSync(
    process.execPath,
    [seeded.script, "--files", f, "--no-name-check"],
    { cwd: seeded.root, encoding: "utf8" },
  );
  const out = r.stdout + r.stderr;
  assert.match(out, /known-names: INACTIVE/);
  assert.strictEqual(r.status, 0, out);
});

test("fail-open regression: a git-listing failure must refuse (exit 2), never report a vacuous OK", () => {
  const noGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-nogit-"));
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: noGitDir, encoding: "utf8" });
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /refusing to read green/);
  assert.doesNotMatch(r.stdout, /result: OK/);
});

test("fail-open regression: a seeded tree at the committed minimum-file floor reads green and reports its count", () => {
  const r = runSeeded(makeSeededRoot(1000), ["--no-name-check"]);
  assert.strictEqual(r.code, 0, r.out.split("\n").slice(0, 10).join("\n"));
  const m = r.out.match(/# scanned (\d+) file\(s\)/);
  assert.ok(m, r.out);
  assert.strictEqual(Number(m[1]), 1000, `expected exactly the 1000 seeded files, saw ${m[1]}`);
});

test("fail-open regression: a seeded tree one file BELOW the floor refuses (exit 2)", () => {
  const r = runSeeded(makeSeededRoot(999), ["--no-name-check"]);
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.out, /below the floor/);
});

test("known-names seeded: an ACTIVE seeded known-names.json flags a planted name, with no INACTIVE notice", () => {
  const name = "Zzplaceholder Persona";
  const seeded = makeSeededRoot(1, { names: [name] });
  const f = tmpFile(`written by ${name} today\n`);
  const r = runSeeded(seeded, ["--files", f]);
  assert.doesNotMatch(r.out, /known-names: INACTIVE/);
  assert.strictEqual(r.code, 1, r.out);
});

test("fail-open regression: an allowlisted first match must not suppress a later real address on the SAME line", () => {
  const f = tmpFile(`contact: git@github.com and also ${PERSONAL_EMAIL} here\n`);
  const r = run(["--files", f]);
  assert.strictEqual(r.code, 1, r.out);
  assert.match(r.out, /MED/);
  const findings = scanFile(f, { knownNames: [], allow: loadAllowlist() });
  const emailFindings = findings.filter((x) => x.pattern === "email");
  assert.strictEqual(emailFindings.length, 1, JSON.stringify(findings));
  assert.strictEqual(emailFindings[0].match, PERSONAL_EMAIL);
});

function gitQuiet(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  }
  return r;
}

function makeScratchRepo(total, deleteCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-scratch-"));
  gitQuiet(["init", "-q"], dir);
  gitQuiet(["config", "user.email", "test@test.invalid"], dir);
  gitQuiet(["config", "user.name", "privacy-test"], dir);
  for (let i = 0; i < total; i++) {
    fs.writeFileSync(path.join(dir, `f${i}.txt`), `filler line ${i}\n`);
  }
  gitQuiet(["add", "-A"], dir);
  gitQuiet(["commit", "-q", "-m", "seed"], dir);
  for (let i = 0; i < deleteCount; i++) {
    fs.unlinkSync(path.join(dir, `f${i}.txt`));
  }
  return dir;
}

test("fail-open regression: a fully listed-but-unreadable tree must refuse (exit 2), never a vacuous OK", () => {
  const dir = makeScratchRepo(1005, 1005);
  const r = spawnSync(process.execPath, [SCRIPT, "--no-name-check"], { cwd: dir, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 2, out);
  assert.match(out, /refusing to read green on a tree it could not read/);
  assert.doesNotMatch(out, /result: OK/);
});

test("fail-open regression: partial unreadable beyond tolerance, still above the floor, must also refuse (exit 2)", () => {
  const dir = makeScratchRepo(1100, 50);
  const r = spawnSync(process.execPath, [SCRIPT, "--no-name-check"], { cwd: dir, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 2, out);
  assert.match(out, /exceeding the tolerance/);
  assert.doesNotMatch(out, /result: OK/);
});

test("a small number of listed-but-missing files within tolerance does not false-positive (exit 0)", () => {
  const dir = makeScratchRepo(1050, 5);
  const r = spawnSync(process.execPath, [SCRIPT, "--no-name-check"], { cwd: dir, encoding: "utf8" });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 0, out);
  const m = out.match(/# scanned (\d+) file\(s\)/);
  assert.ok(m, out);
  assert.strictEqual(Number(m[1]), 1045, out);
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

test("public-tree safety: a bare copy of privacy.js (no sibling modules) loads and still flags a credential", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-nopl-"));
  const dir = path.join(root, "scripts", "check");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, "privacy.js"));
  const allow = path.join(__dirname, "privacy.allowlist.json");
  if (fs.existsSync(allow)) fs.copyFileSync(allow, path.join(dir, "privacy.allowlist.json"));
  const planted = path.join(root, "planted.md");
  fs.writeFileSync(planted, `token=${CREDENTIAL}\n`);
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root });
  const r = spawnSync(process.execPath, [path.join(dir, "privacy.js"), "--files", planted, "--no-name-check"], { encoding: "utf8", env, cwd: root });
  assert.ok(!/Cannot find module/.test((r.stderr || "") + (r.stdout || "")), r.stderr);
  assert.strictEqual(r.status, 1, (r.stdout || "") + (r.stderr || ""));
});
