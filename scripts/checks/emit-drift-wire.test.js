"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const FULL_MD = path.join(ROOT, ".claude", "commands", "scan", "full.md");
const ENFORCER = path.join(__dirname, "emit-drift-vs-published.js");
const GENERATOR = path.join(ROOT, "scripts", "public-repo", "generate.js");
const STRIP = path.join(ROOT, "scripts", "public-repo", "comment-strip.js");
const COMMAND = "node scripts/checks/emit-drift-vs-published.js --source . --ref HEAD";
const CONFIG_REL = "scripts/public-repo/emit-drift.json";
const HAS_GEN = fs.existsSync(FULL_MD) && fs.existsSync(GENERATOR) && fs.existsSync(STRIP);
const SKIP = HAS_GEN ? false : "publisher-source files (full.md / generate.js) are absent here";

const cleanup = [];
process.on("exit", () => { for (const d of cleanup) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { } } });
const GENV = Object.assign({}, process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" });
for (const k of Object.keys(GENV)) if (/^GIT_(DIR|INDEX_FILE|WORK_TREE)$/.test(k)) delete GENV[k];
function git(dir, ...args) {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", "-C", dir, ...args], { env: GENV, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function mkRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edw-"));
  cleanup.push(dir);
  git(dir, "init", "-q");
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture");
  return dir;
}
const cfg = JSON.stringify({ schema: "mc/emit-drift/v1", published: { repo: "cygaco/master-console", ref: "main" }, exceptions: [] });
function source({ withConfig }) {
  const files = {
    "scripts/checks/emit-drift-vs-published.js": fs.readFileSync(ENFORCER),
    "scripts/public-repo/generate.js": `module.exports = require(${JSON.stringify(GENERATOR)});\n`,
    "scripts/public-repo/comment-strip.js": fs.readFileSync(STRIP),
    "scripts/public-repo/policy.json": JSON.stringify({ schema: "mc/public-repo-policy/v1", exclude: [], seeds: {} }),
    "scripts/public-repo/allowlist.txt": "# header\nREADME.md\n",
    "README.md": "# Product\nline one\n",
  };
  if (withConfig) files[CONFIG_REL] = cfg;
  return mkRepo(files);
}
function fakeGh(pubDir, fail) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "edw-bin-"));
  cleanup.push(bin);
  fs.copyFileSync(process.execPath, path.join(bin, process.platform === "win32" ? "gh.exe" : "gh"));
  fs.chmodSync(path.join(bin, process.platform === "win32" ? "gh.exe" : "gh"), 0o755);
  return { bin, env: { FAKE_GH_PUB: pubDir || "", FAKE_GH_FAIL: fail ? "1" : "" } };
}
const API_SCRIPT = String.raw`
const { spawnSync } = require("child_process");
if (process.env.FAKE_GH_FAIL) { console.error("gh: network unreachable"); process.exit(1); }
const dir = process.env.FAKE_GH_PUB;
const g = (a, o) => spawnSync("git", ["-C", dir, ...a], Object.assign({ encoding: "utf8", maxBuffer: 1 << 26 }, o || {}));
const ep = process.argv[2];
let m;
if ((m = /\/commits\//.exec(ep))) console.log(JSON.stringify({ sha: g(["rev-parse", "HEAD"]).stdout.trim() }));
else if (/\/git\/trees\//.test(ep)) {
  const tree = g(["ls-tree", "-r", "HEAD"]).stdout.split("\n").filter(Boolean).map((l) => { const x = /^\d+ (\w+) ([0-9a-f]+)\t(.*)$/.exec(l); return { path: x[3], type: x[1], sha: x[2] }; });
  console.log(JSON.stringify({ tree, truncated: false }));
} else if ((m = /\/git\/blobs\/([0-9a-f]+)/.exec(ep))) {
  const r = spawnSync("git", ["-C", dir, "cat-file", "blob", m[1]], { maxBuffer: 1 << 26 });
  console.log(JSON.stringify({ encoding: "base64", content: r.stdout.toString("base64") }));
} else { console.error("unexpected endpoint " + ep); process.exit(1); }
`;
function runCommand(src, gh) {
  fs.writeFileSync(path.join(src, "api"), API_SCRIPT);
  const argv = COMMAND.split(/\s+/).slice(1);
  const env = Object.assign({}, GENV, gh.env, { PATH: gh.bin + path.delimiter + process.env.PATH });
  return spawnSync(process.execPath, argv, { cwd: src, env, encoding: "utf8" });
}

test("W1 /scan:full carries the exact enforcer command line", { skip: SKIP }, () => {
  const md = fs.readFileSync(FULL_MD, "utf8");
  const lines = md.split(/\r?\n/).filter((l) => l.startsWith(COMMAND));
  assert.strictEqual(lines.length, 1, "exactly one line must start with the command");
  assert.ok(/^node scripts\/checks\/emit-drift-vs-published\.js --source \. --ref HEAD(\s|$)/.test(lines[0]));
  assert.ok(/exit 1 = critical/.test(lines[0]) && /exit 2 = could-not-run/.test(lines[0]) && /NEVER green/.test(lines[0]) && /SKIP/.test(lines[0]));
});

test("W2 the exact command exits 1 on a fixture that would drop published content", { skip: SKIP }, () => {
  const pub = mkRepo({ "README.md": "# Product\nline one\nline gone\n", "ci/public-allowlist.txt": "README.md\n" });
  const r = runCommand(source({ withConfig: true }), fakeGh(pub));
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("REMOVED README.md: line gone"), r.stdout);
});

test("W3 the exact command exits 2 when the published side cannot be reached", { skip: SKIP }, () => {
  const r = runCommand(source({ withConfig: true }), fakeGh("", true));
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stdout.includes("COULD NOT RUN"), r.stdout);
});

test("W4 the exact command exits 2 on a generator without its config (never a pass)", { skip: SKIP }, () => {
  const r = runCommand(source({ withConfig: false }), fakeGh("", true));
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
});

test("W5 the exact command prints SKIP and exits 0 where neither generator nor config exist", { skip: SKIP }, () => {
  const src = mkRepo({ "scripts/checks/emit-drift-vs-published.js": fs.readFileSync(ENFORCER), "README.md": "x\n" });
  const r = runCommand(src, fakeGh("", true));
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.startsWith("SKIP:"), r.stdout);
});
