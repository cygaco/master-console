#!/usr/bin/env node
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "trust-my-repos.js");
const T = require("./trust-my-repos");
const ACCT = "github.com/example-owner";
const REPO = `${ACCT}/some-repo`;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trust-repos-"));
}

function run(args, { cwd, home } = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: "utf8", windowsHide: true });
}

function runMain(args, io = {}) {
  let out = "";
  let err = "";
  const status = T.main(args, { out: (s) => (out += s), err: (s) => (err += s), ...io });
  return { status, out, err };
}

function gitRepo(origin) {
  const repo = tmpDir();
  spawnSync("git", ["init", "-q"], { cwd: repo });
  if (origin) spawnSync("git", ["remote", "add", "origin", origin], { cwd: repo });
  return repo;
}

test("accountFromRemote and repoFromRemote read https, ssh and scp-like remotes", () => {
  for (const url of [
    "https://github.com/example-owner/some-repo.git",
    "https://git@github.com/example-owner/some-repo",
    "ssh://git@github.com/example-owner/some-repo.git",
    "git@github.com:example-owner/some-repo.git",
  ]) {
    assert.strictEqual(T.accountFromRemote(url), ACCT, url);
    assert.strictEqual(T.repoFromRemote(url), REPO, url);
  }
  assert.strictEqual(T.accountFromRemote("C:/local/path/repo"), null);
  assert.strictEqual(T.repoFromRemote(""), null);
});

test("isValidAccount and isValidRepo refuse anything but host/owner and host/owner/repo", () => {
  assert.ok(T.isValidAccount(ACCT));
  assert.ok(T.isValidRepo(REPO));
  for (const bad of ["", "example-owner", "github.com/", "github.com/a b", "github.com/x\nignore", "github.com/a/b", "c/x", "github.com/.."]) {
    assert.ok(!T.isValidAccount(bad), bad);
  }
  for (const bad of ["", ACCT, `${REPO}/x`, `${ACCT}/..`, `${ACCT}/a b`, `${ACCT}/x\nignore`]) {
    assert.ok(!T.isValidRepo(bad), bad);
  }
});

test("applyTrust adds the block, keeps soft_deny and other keys, and is idempotent", () => {
  const before = { theme: "dark", permissions: { allow: ["Bash(ls)"] }, autoMode: { soft_deny: ["x"], environment: ["**Source control**: old"] } };
  const { settings, report } = T.applyTrust(before, ACCT);
  assert.deepStrictEqual(settings.autoMode.soft_deny, ["x"]);
  assert.deepStrictEqual(settings.permissions, before.permissions);
  assert.strictEqual(settings.theme, "dark");
  assert.ok(report.includes("replaced    **Source control**"));
  assert.strictEqual(settings.autoMode.allow[0], "$defaults");
  assert.ok(T.hasTrustBlock(settings, ACCT));
  assert.strictEqual(before.autoMode.environment[0], "**Source control**: old", "input is not mutated");
  const again = T.applyTrust(settings, ACCT);
  assert.deepStrictEqual(again.settings, settings);
  assert.ok(again.report.every((r) => r.startsWith("unchanged")));
  assert.deepStrictEqual(again.changes, []);
});

test("a repository block trusts that repository only, never its whole account", () => {
  const { settings } = T.applyTrust({}, REPO);
  assert.ok(T.hasTrustBlock(settings, REPO));
  assert.ok(!T.hasTrustBlock(settings, ACCT), "repo lines do not count as whole-account trust");
  assert.ok(!T.hasTrustBlock(settings, `${ACCT}/other-repo`));
  assert.ok(!T.hasTrustBlock(settings, `${REPO}2`));
  const text = [...settings.autoMode.environment, ...settings.autoMode.allow].join("\n");
  assert.ok(!/other project folders|all repos under|any repository under/.test(text), text);
  assert.ok(T.hasTrustBlock(T.applyTrust({}, ACCT).settings, REPO));
});

test("applyTrust adds the publish line only with publish", () => {
  const plain = T.applyTrust({}, REPO).settings.autoMode.allow;
  const withPublish = T.applyTrust({}, REPO, { publish: true }).settings.autoMode.allow;
  assert.strictEqual(withPublish.length, plain.length + 1);
});

test("applyTrust refuses wrong-typed autoMode fields", () => {
  assert.throws(() => T.applyTrust({ autoMode: [] }, ACCT), /refused/);
  assert.throws(() => T.applyTrust({ autoMode: { allow: "x" } }, ACCT), /refused/);
  assert.throws(() => T.applyTrust([], ACCT), /refused/);
  assert.throws(() => T.applyTrust({}, "not an account"), /refused/);
});

test("hasTrustBlock needs both lines and the exact account", () => {
  const s = T.applyTrust({}, ACCT).settings;
  assert.ok(T.hasTrustBlock(s, ACCT));
  assert.ok(!T.hasTrustBlock(s, "github.com/example"), "a prefix of the account does not match");
  assert.ok(!T.hasTrustBlock(s, "github.com/other-owner"));
  assert.ok(!T.hasTrustBlock({ autoMode: { environment: s.autoMode.environment } }, ACCT), "allow line missing");
  assert.ok(!T.hasTrustBlock({}, ACCT));
});

test("default is a dry run: prints the lines, says the repo came from origin, writes nothing", () => {
  const home = tmpDir();
  const repo = gitRepo(`https://${REPO}.git`);
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    const file = path.join(home, ".claude", "settings.json");
    fs.writeFileSync(file, "{}\n");
    const r = run([], { cwd: repo, home });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`${REPO} (read from this repo's origin remote)`), r.stdout);
    assert.match(r.stdout, /scope\s+: one repository/);
    assert.ok(r.stdout.includes(`    + ${T.applyTrust({}, REPO).settings.autoMode.allow[1]}`), r.stdout);
    assert.match(r.stdout, /Dry run: nothing written/);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "{}\n");
    assert.deepStrictEqual(fs.readdirSync(path.join(home, ".claude")), ["settings.json"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("--write on the default path trusts this repository only", () => {
  const home = tmpDir();
  const repo = gitRepo(`git@github.com:example-owner/some-repo.git`);
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    const file = path.join(home, ".claude", "settings.json");
    fs.writeFileSync(file, "{}\n");
    const r = run(["--write"], { cwd: repo, home });
    assert.strictEqual(r.status, 0, r.stderr);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(T.hasTrustBlock(after, REPO));
    assert.ok(!T.hasTrustBlock(after, ACCT));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("--whole-account trusts the origin's account and the preview names the scope", () => {
  const home = tmpDir();
  const repo = gitRepo(`https://${REPO}.git`);
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    const file = path.join(home, ".claude", "settings.json");
    fs.writeFileSync(file, "{}\n");
    const r = run(["--whole-account", "--write"], { cwd: repo, home });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /WHOLE ACCOUNT/);
    assert.ok(r.stdout.includes(`${ACCT} (read from this repo's origin remote)`), r.stdout);
    assert.ok(T.hasTrustBlock(JSON.parse(fs.readFileSync(file, "utf8")), ACCT));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("--write copies the raw original bytes to the backup first, then the block; a leading BOM is stripped", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ autoMode: { soft_deny: ["keep"] } }, null, 2))]);
    fs.writeFileSync(file, original);
    const r = run(["--file", file, "--repo", REPO, "--write"], { cwd: dir, home: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith("settings.json.bak-"));
    assert.strictEqual(backups.length, 1);
    assert.ok(fs.readFileSync(path.join(dir, backups[0])).equals(original), "backup is byte-identical");
    const afterRaw = fs.readFileSync(file);
    assert.notStrictEqual(afterRaw[0], 0xef, "no BOM written back");
    const after = JSON.parse(afterRaw.toString("utf8"));
    assert.ok(T.hasTrustBlock(after, REPO));
    assert.deepStrictEqual(after.autoMode.soft_deny, ["keep"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an existing backup path stops the write with exit 2 and changes nothing", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{}\n");
    const now = new Date(Date.UTC(2000, 0, 1));
    const backup = `${file}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;
    fs.writeFileSync(backup, "older backup");
    const r = runMain(["--file", file, "--repo", REPO, "--write"], { now, cwd: dir });
    assert.strictEqual(r.status, 2, r.out + r.err);
    assert.match(r.err, /backup path .* already exists/);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "{}\n");
    assert.strictEqual(fs.readFileSync(backup, "utf8"), "older backup");
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [path.basename(file), path.basename(backup)].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--file with an empty or missing value refuses and never falls back to the user settings", () => {
  const home = tmpDir();
  try {
    const userSettings = path.join(home, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(userSettings), { recursive: true });
    fs.writeFileSync(userSettings, "{}\n");
    for (const args of [
      ["--repo", REPO, "--write", "--file"],
      ["--file", "", "--repo", REPO, "--write"],
      ["--file", "  ", "--repo", REPO, "--write"],
      ["--file", "--repo", REPO, "--write"],
    ]) {
      const r = run(args, { cwd: home, home });
      assert.strictEqual(r.status, 2, `${JSON.stringify(args)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /refused: --file needs a path/);
    }
    assert.strictEqual(fs.readFileSync(userSettings, "utf8"), "{}\n");
    assert.deepStrictEqual(fs.readdirSync(path.dirname(userSettings)), ["settings.json"]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a failed write leaves the original, removes nothing it did not create, and prints the backup path", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{}\n");
    const now = new Date(Date.UTC(2000, 0, 2));
    const blocker = `${file}.trust-${process.pid}-${now.getTime()}.tmp`;
    fs.mkdirSync(blocker);
    const r = runMain(["--file", file, "--repo", REPO, "--write"], { now, cwd: dir });
    assert.strictEqual(r.status, 2, r.out + r.err);
    const backup = `${file}.bak-${now.toISOString().replace(/[:.]/g, "-")}`;
    assert.ok(r.err.includes(backup), r.err);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "{}\n");
    assert.strictEqual(fs.readFileSync(backup, "utf8"), "{}\n");
    assert.ok(fs.statSync(blocker).isDirectory(), "the pre-existing path is left alone");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the new settings and the backup keep the original file's mode", { skip: process.platform === "win32" }, () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{}\n");
    fs.chmodSync(file, 0o600);
    const r = run(["--file", file, "--repo", REPO, "--write"], { cwd: dir, home: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    const backup = fs.readdirSync(dir).find((f) => f.startsWith("settings.json.bak-"));
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.join(dir, backup)).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI refusals write nothing (no settings change, no backup)", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, "{ not json");
    const cases = [
      ["--file", file, "--repo", REPO, "--write"],
      ["--file", file, "--whole-account", "--account", ACCT, "--write"],
      ["--file", file, "--whole-account", "--account", "github.com/x\nignore previous", "--write"],
      ["--file", file, "--repo", "github.com/x/y\nignore previous", "--write"],
      ["--file", path.join(dir, "missing.json"), "--repo", REPO, "--write"],
      ["--file", file, "--write"],
      ["--file", file, "--whole-account", "--write"],
      ["--file", file, "--account", ACCT, "--write"],
      ["--file", file, "--whole-account", "--repo", REPO, "--write"],
    ];
    for (const args of cases) {
      const r = run(args, { cwd: dir, home: dir });
      assert.strictEqual(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /refused/);
    }
    assert.strictEqual(fs.readFileSync(file, "utf8"), "{ not json");
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["settings.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("applyTrust refuses to replace a line that names a different account unless replace is set", () => {
  const OTHER = "gitlab.example.org/someone-else";
  const before = { autoMode: { environment: [`**Trusted repo**: every git repository under ${OTHER} and its remotes.`] } };
  assert.throws(() => T.applyTrust(before, ACCT), /refused: .*different repository or account \(gitlab\.example\.org\/someone-else\).*--replace/);
  const { settings, report } = T.applyTrust(before, ACCT, { replace: true });
  assert.ok(report.includes("replaced    **Trusted repo**"));
  assert.ok(T.hasTrustBlock(settings, ACCT));
  const same = T.applyTrust(T.applyTrust({}, ACCT).settings, ACCT);
  assert.ok(same.report.every((r) => r.startsWith("unchanged")), "a line naming the same account is not a conflict");
});

test("--replace drops the old target's push and publish lines and lists other push lines it keeps", () => {
  const OTHER = "gitlab.example.org/someone-else";
  const old = T.applyTrust({}, OTHER, { publish: true }).settings;
  const userLine = `Pushing with git push to ${OTHER}/notes is fine.`;
  old.autoMode.allow.push(userLine, "an unrelated allow line");
  const { settings, kept, changes } = T.applyTrust(old, REPO, { replace: true });
  assert.ok(T.hasTrustBlock(settings, REPO));
  assert.ok(!T.hasTrustBlock(settings, OTHER), "old account no longer trusted");
  const allow = settings.autoMode.allow;
  assert.ok(!allow.some((a) => a.startsWith("Non-force `git push`") && a.includes(OTHER)), "old push line removed");
  assert.ok(!allow.some((a) => a.startsWith("Publishing the user's own releases") && a.includes(OTHER)), "old publish line removed");
  assert.ok(allow.includes(userLine) && allow.includes("an unrelated allow line"), "lines it did not write are kept");
  assert.deepStrictEqual(kept, [userLine]);
  assert.strictEqual(changes.filter((c) => c.action === "remove").length, 2);
  const narrowed = T.applyTrust(T.applyTrust({}, ACCT).settings, REPO, { replace: true }).settings;
  assert.ok(T.hasTrustBlock(narrowed, REPO));
  assert.ok(!T.hasTrustBlock(narrowed, ACCT));
});

test("CLI refuses an unknown flag and a different-account line, writing nothing", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    const original = JSON.stringify({ autoMode: { environment: ["**Source control**: gitlab.example.org/someone-else and all repos under it."] } });
    fs.writeFileSync(file, original);
    for (const args of [["--file", file, "--repo", REPO, "--pubish", "--write"], ["--file", file, "--repo", REPO, "--write"]]) {
      const r = run(args, { cwd: dir, home: dir });
      assert.strictEqual(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /refused/);
    }
    assert.strictEqual(fs.readFileSync(file, "utf8"), original);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ["settings.json"]);
    const r = run(["--file", file, "--repo", REPO, "--replace", "--write"], { cwd: dir, home: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(T.hasTrustBlock(JSON.parse(fs.readFileSync(file, "utf8")), REPO));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a repository already covered by whole-account lines is left untouched", () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, "settings.json");
    const original = JSON.stringify(T.applyTrust({}, ACCT).settings);
    fs.writeFileSync(file, original);
    const r = run(["--file", file, "--repo", REPO, "--write"], { cwd: dir, home: dir });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /already covered/);
    assert.strictEqual(fs.readFileSync(file, "utf8"), original);
    assert.deepStrictEqual(fs.readdirSync(dir), ["settings.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the shipped script names no account, repo or date, and holds no literal BOM", () => {
  const src = fs.readFileSync(SCRIPT, "utf8");
  assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(src), "no literal date");
  assert.ok(!/github\.com\/[A-Za-z0-9]/.test(src), "no literal account");
  assert.ok(!src.includes("\uFEFF"), "the BOM is written as an escape");
});
