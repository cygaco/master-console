"use strict";
const mcEnv = require("../hooks/lib/mc-env");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(__dirname, "framework-purity.js");
const { inAbsPathScope } = require("./framework-purity");

const SLUG = "zorblat-product";
const SLUGS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fp-slugs-")), "slugs.json");
fs.writeFileSync(SLUGS_FILE, JSON.stringify({ clientSlugs: [SLUG] }));
const HOME_PATH_NEW = ["C:", "Users", "alice", "Desktop", "x"].join("\\");
const HOME_PATH_OLD = ["C:", "Users", "Alice.Quenneville", "Desktop", "x"].join("\\");

function cleanEnv() {
  const e = { ...process.env };
  delete e.MC_REQUIRE_PRIVATE_DENYLIST;
  return e;
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-gate-"));
  const git = (a) => execSync(`git ${a}`, { cwd: dir, encoding: "utf8" });
  git("init -q");
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.writeFileSync(path.join(dir, "README.md"), "clean framework text\n");
  fs.writeFileSync(path.join(dir, "scripts", "ok.js"), "module.exports = 1;\n");
  git("add -A");
  git('-c user.name=t -c user.email=t@example.com commit -q -m init');
  return { dir, git };
}
function run(repo, args = [], opts = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--json"], {
    encoding: "utf8",
    env: {
      ...cleanEnv(),
      ...mcEnv.envPair("PURITY_ROOT", repo),
      MC_PURITY_SLUGS_FILE: opts.noSlugs ? path.join(repo, "absent.json") : SLUGS_FILE,
      ...(opts.extraEnv || {}),
    },
  });
  return { code: r.status, json: r.stdout ? JSON.parse(r.stdout) : null, err: r.stderr };
}

test("known-answer: a clean tracked tree exits 0 in the DEFAULT (full) mode", () => {
  const { dir } = makeRepo();
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.json.mode, "full");
  assert.strictEqual(r.json.scanned, 2);
});

test("RED proof: a tracked doc carrying a private slug fails the default mode (exit 1)", () => {
  const { dir, git } = makeRepo();
  fs.writeFileSync(path.join(dir, "docs", "leak.md"), `mentions ${SLUG} here\n`);
  git("add -A");
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.summary.client_slug, 1);
  assert.strictEqual(r.json.findings.client_slug[0].path, "docs/leak.md");
});

test("RED proof: a home path in a scripts/*.js fails; a dotted-name one too; the same path in docs/*.md does not", () => {
  const { dir, git } = makeRepo();
  fs.writeFileSync(path.join(dir, "scripts", "bad.js"), `const p = ${JSON.stringify(HOME_PATH_NEW)};\n`);
  fs.writeFileSync(path.join(dir, "scripts", "old.js"), `const p = ${JSON.stringify(HOME_PATH_OLD)};\n`);
  fs.writeFileSync(path.join(dir, "docs", "history.md"), `the old checkout lived at ${HOME_PATH_NEW}\n`);
  git("add -A");
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  const flagged = r.json.findings.abs_path.map((f) => f.path).sort();
  assert.deepStrictEqual(flagged, ["scripts/bad.js", "scripts/old.js"]);
});

test("scope table: abs-path rule applies only to executable/config files under scripts/ and .claude/", () => {
  assert.strictEqual(inAbsPathScope("scripts/x.js"), true);
  assert.strictEqual(inAbsPathScope("scripts/a/b.ps1"), true);
  assert.strictEqual(inAbsPathScope(".claude/settings.json"), true);
  assert.strictEqual(inAbsPathScope(".claude/hooks/x.sh"), true);
  assert.strictEqual(inAbsPathScope("scripts/notes.md"), false);
  assert.strictEqual(inAbsPathScope("docs/x.js"), false);
  assert.strictEqual(inAbsPathScope("runtime/log.json"), false);
});

test("untracked files are NOT scanned in full mode (gitignored local state cannot false-RED the gate)", () => {
  const { dir } = makeRepo();
  fs.writeFileSync(path.join(dir, "docs", "local-scratch.md"), `${SLUG}\n`);
  const r = run(dir);
  assert.strictEqual(r.code, 0, JSON.stringify(r.json && r.json.summary));
});

test("fail-closed: a non-git root exits 2, never 0", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-nogit-"));
  const r = run(dir);
  assert.strictEqual(r.code, 2);
});

test("seeded tree: a clean tracked repository (cwd + CLAUDE_PROJECT_DIR pinned to it) passes the default gate (exit 0)", () => {
  const { dir } = makeRepo();
  const env = { ...cleanEnv(), CLAUDE_PROJECT_DIR: dir, MC_PURITY_SLUGS_FILE: SLUGS_FILE, ...mcEnv.envPair("PURITY_ROOT", dir) };
  const r = spawnSync(process.execPath, [SCRIPT, "--quiet"], { cwd: dir, encoding: "utf8", env });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("config seam: with NO slugs file the slug detector is empty (default); a malformed file fails closed (exit != 0)", () => {
  const { dir, git } = makeRepo();
  fs.writeFileSync(path.join(dir, "docs", "leak.md"), `mentions ${SLUG} here
`);
  git("add -A");
  const r = run(dir, [], { noSlugs: true });
  assert.strictEqual(r.code, 0, "empty default must not flag");
  const bad = path.join(dir, "bad.json");
  fs.writeFileSync(bad, "{ not json");
  const c = spawnSync(process.execPath, [SCRIPT, "--json"], {
    encoding: "utf8",
    env: { ...process.env, ...mcEnv.envPair("PURITY_ROOT", dir), MC_PURITY_SLUGS_FILE: bad },
  });
  assert.notStrictEqual(c.status, 0);
});

test("require-private: MC_REQUIRE_PRIVATE_DENYLIST=1 + zero slugs loaded exits 2 with a fixed message", () => {
  const { dir } = makeRepo();
  const r = run(dir, [], { noSlugs: true, extraEnv: { MC_REQUIRE_PRIVATE_DENYLIST: "1" } });
  assert.strictEqual(r.code, 2, r.err);
  assert.match(r.json.error, /0 private slugs loaded/);
  assert.match(r.json.error, /MC_PURITY_SLUGS_FILE/);
  assert.strictEqual(r.json.private_slugs, 0);
});

const INERT_LOADER_BODY = [
  'const t = () => ({ pendingByFile: {}, pendingSamples: {}, pendingTotal: 0, suppressedTotal: 0, pinnedTotal: 0, derivedTotal: 0, compatTotal: 0, compatBySurface: {}, compatExpiredTotal: 0, compatExpiredBySurface: {}, versionReason: "stub", suppressedByEntry: {}, pinnedByPin: {}, derivedByView: {} });',
  "exports.loadPartition = () => exports;",
  "exports.createLegacySlugTally = t;",
  "exports.tallyLegacySlug = () => {};",
  "exports.classifyPath = () => ({ class: 0 });",
  'exports.tallyLegacySlugPathNames = () => ({ liveUnallowedPaths: [], byDisposition: { liveUnallowed: 0 }, byEntry: {}, compatBySurface: {}, compatExpiredBySurface: {}, versionReason: "stub" });',
  "exports.dispositionSummary = () => ({});",
  'exports.formatLegacySlugTally = () => "";',
  'exports.formatPathNameTally = () => "";',
].join("\n");

test("require-private: required + slugs present gives the normal result (0 clean, 1 on a leak)", () => {
  const { dir, git } = makeRepo();
  const env = { MC_REQUIRE_PRIVATE_DENYLIST: "1", ...loaderEnv(tmpStub(INERT_LOADER_BODY)) };
  const ok = run(dir, [], { extraEnv: env });
  assert.strictEqual(ok.code, 0, ok.err);
  assert.strictEqual(ok.json.private_slugs, 1);
  fs.writeFileSync(path.join(dir, "docs", "leak.md"), `mentions ${SLUG} here\n`);
  git("add -A");
  assert.strictEqual(run(dir, [], { extraEnv: env }).code, 1);
});

test("not required + zero slugs: normal result (public default); the count is still reported", () => {
  const { dir } = makeRepo();
  const r = run(dir, [], { noSlugs: true });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.json.private_slugs, 0);
});

test("count line: the human output prints the slug count, never a slug", () => {
  const { dir } = makeRepo();
  const c = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...cleanEnv(), ...mcEnv.envPair("PURITY_ROOT", dir), MC_PURITY_SLUGS_FILE: SLUGS_FILE },
  });
  assert.match(c.stdout, /private slugs loaded: 1\b/);
  assert.ok(!c.stdout.includes(SLUG));
});

test("CI=true alone never triggers require-private", () => {
  const { dir } = makeRepo();
  assert.strictEqual(run(dir, [], { noSlugs: true, extraEnv: { CI: "true" } }).code, 0);
});

function loaderEnv(p) {
  return mcEnv.envPair("PURITY_PARTITION_LOADER", p);
}
function tmpStub(body) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fp-loader-")), "partition-loader.js");
  fs.writeFileSync(f, body);
  return f;
}
function absentLoaderPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fp-noloader-")), "partition-loader.js");
}

test("loader ABSENT: legacy-slug detector skipped + reported; clean tree exits 0", () => {
  const { dir } = makeRepo();
  const r = run(dir, [], { extraEnv: loaderEnv(absentLoaderPath()) });
  assert.strictEqual(r.code, 0, r.err + JSON.stringify(r.json));
  assert.strictEqual(r.json.legacy_slug.skipped, true);
  assert.match(r.json.legacy_slug.reason, /did NOT run/);
  const human = spawnSync(process.execPath, [SCRIPT], {
    encoding: "utf8",
    env: { ...cleanEnv(), ...mcEnv.envPair("PURITY_ROOT", dir), MC_PURITY_SLUGS_FILE: SLUGS_FILE, ...loaderEnv(absentLoaderPath()) },
  });
  assert.strictEqual(human.status, 0);
  assert.match(human.stdout, /legacy_slug:\s+SKIPPED/);
  assert.match(human.stdout, /legacy-slug detector SKIPPED/);
});

test("loader ABSENT + EXPLICIT enforcement (--enforce-legacy-slug / MC_REQUIRE_PRIVATE_DENYLIST=1): fails CLOSED exit 2, never a skip", () => {
  const { dir } = makeRepo();
  const viaFlag = run(dir, ["--enforce-legacy-slug"], { extraEnv: loaderEnv(absentLoaderPath()) });
  assert.strictEqual(viaFlag.code, 2, viaFlag.err + JSON.stringify(viaFlag.json));
  assert.match(String(viaFlag.json && viaFlag.json.error), /explicitly requested.*loader is absent/);
  const viaEnv = run(dir, [], { extraEnv: { ...loaderEnv(absentLoaderPath()), MC_REQUIRE_PRIVATE_DENYLIST: "1" } });
  assert.strictEqual(viaEnv.code, 2, viaEnv.err + JSON.stringify(viaEnv.json));
  assert.match(String(viaEnv.json && viaEnv.json.error), /MC_REQUIRE_PRIVATE_DENYLIST=1.*loader is absent/);
  const dflt = run(dir, [], { extraEnv: loaderEnv(absentLoaderPath()) });
  assert.strictEqual(dflt.code, 0, dflt.err + JSON.stringify(dflt.json));
  assert.strictEqual(dflt.json.legacy_slug.skipped, true);
});

test("loader ABSENT: planted client_slug and abs_path leaks still exit 1", () => {
  const { dir, git } = makeRepo();
  fs.writeFileSync(path.join(dir, "docs", "leak.md"), `mentions ${SLUG} here\n`);
  fs.writeFileSync(path.join(dir, "scripts", "bad.js"), `const p = ${JSON.stringify(HOME_PATH_NEW)};\n`);
  git("add -A");
  const r = run(dir, [], { extraEnv: loaderEnv(absentLoaderPath()) });
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.json.summary.client_slug, 1);
  assert.strictEqual(r.json.summary.abs_path, 1);
  assert.strictEqual(r.json.legacy_slug.skipped, true);
});

test("loader PRESENT but MALFORMED (loadPartition throws): exit 2, never a skip", () => {
  const { dir } = makeRepo();
  const stub = tmpStub('exports.loadPartition = () => { throw new Error("malformed partition"); };\n');
  const r = run(dir, [], { extraEnv: loaderEnv(stub) });
  assert.strictEqual(r.code, 2, r.err + JSON.stringify(r.json));
  assert.ok(!(r.json.legacy_slug && r.json.legacy_slug.skipped));
});

test("loader PRESENT but a NESTED DEPENDENCY MISSING (MODULE_NOT_FOUND from inside it): exit 2, not a skip", () => {
  const { dir } = makeRepo();
  const stub = tmpStub('require("./does-not-exist");\nexports.loadPartition = () => ({});\n');
  const r = run(dir, [], { extraEnv: loaderEnv(stub) });
  assert.strictEqual(r.code, 2, r.err + JSON.stringify(r.json));
  assert.ok(!(r.json.legacy_slug && r.json.legacy_slug.skipped));
});
