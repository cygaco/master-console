"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "config-path-resolves.js");

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cpr-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  return dir;
}

function check(dir) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--json"], { encoding: "utf8" });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { }
  return { code: r.status, json, out: r.stdout + r.stderr };
}

const POLICY = "scripts/checks/provider-api-policy.allowlist.json";
const SHIP = "scripts/checks/mc-ship-coverage.js";
const shipSource = (entries) => `"use strict";\nconst KNOWN_NOT_SHIPPED = [\n${entries.join(",\n")}\n];\nmodule.exports = { KNOWN_NOT_SHIPPED };\n`;

test("RED: a data allowlist entry naming a file the tree does not carry is DANGLING (exit 1, named)", () => {
  const dir = repo({
    "scripts/real.js": "// present\n",
    [POLICY]: { allow: [{ path: "scripts/real.js", reason: "present" }, { path: "GONE.md", reason: "a file this tree never had" }] },
  });
  const r = check(dir);
  assert.strictEqual(r.code, 1, r.out);
  assert.deepStrictEqual(r.json.dangling.map((d) => d.entry), ["GONE.md"]);
});

test("GREEN: the same allowlist without the dangling entry passes", () => {
  const dir = repo({
    "scripts/real.js": "// present\n",
    [POLICY]: { allow: [{ path: "scripts/real.js", reason: "present" }] },
  });
  const r = check(dir);
  assert.strictEqual(r.code, 0, r.out);
  assert.strictEqual(r.json.dangling.length, 0);
});

test("RED: a code allowlist prefix and a one-regex predicate that match nothing are DANGLING", () => {
  const dir = repo({
    "scripts/tool.js": "// present\n",
    [SHIP]: shipSource([
      `  { prefix: "scripts/tool.js", reason: "present" }`,
      `  { prefix: "scripts/scratch-brief.md", reason: "a scratch file this tree never had" }`,
      `  { match: (p) => /^scripts\\/[^/]+\\.js$/.test(p), reason: "matches scripts/tool.js" }`,
      `  { match: (p) => /^scripts\\/delta-[^/]+\\.txt$/.test(p), reason: "matches nothing" }`,
    ]),
  });
  const r = check(dir);
  assert.strictEqual(r.code, 1, r.out);
  assert.deepStrictEqual(r.json.dangling.map((d) => d.entry).sort(), ["/^scripts\\/delta-[^/]+\\.txt$/", "scripts/scratch-brief.md"]);
});

test("RED: a predicate the check cannot read as one regex is UNVERIFIABLE, never trusted", () => {
  const dir = repo({
    "scripts/tool.js": "// present\n",
    [SHIP]: shipSource([`  { match: (p) => p.endsWith(".tmp") || p.includes("x"), reason: "not a single regex" }`]),
  });
  const r = check(dir);
  assert.strictEqual(r.code, 1, r.out);
  assert.strictEqual(r.json.unverifiable.length, 1);
});

test("a path created at run time resolves only through RUNTIME_PATHS with a writer that names it", () => {
  const writer = "scripts/mc/manifest/build.js";
  const green = repo({ [writer]: "// default --out: <root>/_mc/MANIFEST.json\n", [SHIP]: shipSource([`  { prefix: "_mc/MANIFEST.json", reason: "build output" }`]) });
  const r1 = check(green);
  assert.deepStrictEqual(r1.json.dangling, [], r1.out);
  const noWriter = repo({ [SHIP]: shipSource([`  { prefix: "_mc/MANIFEST.json", reason: "build output" }`]) });
  assert.deepStrictEqual(check(noWriter).json.dangling.map((d) => d.entry), ["_mc/MANIFEST.json"]);
  const silentWriter = repo({ [writer]: "// writes nothing named\n", [SHIP]: shipSource([`  { prefix: "_mc/MANIFEST.json", reason: "build output" }`]) });
  assert.deepStrictEqual(check(silentWriter).json.dangling.map((d) => d.entry), ["_mc/MANIFEST.json"]);
});

test("a RUNTIME_PATHS key that no entry of its present source uses is reported stale", () => {
  const dir = repo({ "scripts/tool.js": "// present\n", [SHIP]: shipSource([`  { prefix: "scripts/tool.js", reason: "present" }`]) });
  const r = check(dir);
  assert.strictEqual(r.code, 1, r.out);
  assert.ok(r.json.staleRuntime.includes(`${SHIP}#KNOWN_NOT_SHIPPED: _mc/MANIFEST.json`), JSON.stringify(r.json.staleRuntime));
});

test("records resolve against their registries: a role and a lifecycle event", () => {
  const files = {
    ".claude/agents/_org/role-registry.json": { roles: { "quality-lead": {} } },
    ".claude/agents/_org/mode-lifecycle-hooks.json": { events: [{ event: "mode:init:before" }] },
    "scripts/checks/consult-roster-no-dispatch.js": `const KNOWN_EXEMPTIONS = new Map([\n  ["quality-lead", "real"],\n  ["retired-role", "gone"],\n]);\n`,
    "scripts/checks/mode-lifecycle-hooks-coverage.allowlist.json": { wiring_pending: { "mode:init:before": {}, "mode:never:fired": {} } },
  };
  const r = check(repo(files));
  assert.strictEqual(r.code, 1, r.out);
  assert.deepStrictEqual(r.json.dangling.map((d) => d.entry).sort(), ["mode:never:fired", "retired-role"]);
});

test("RUNNER ERROR: an unregistered allowlist-bearing file is exit 2, not a pass", () => {
  const r = check(repo({ "scripts/checks/new-thing.allowlist.json": { allow: [] } }));
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.json.error, /unregistered allowlist-bearing file: scripts\/checks\/new-thing\.allowlist\.json/);
});

test("RUNNER ERROR: a registered constant missing from a present source file is exit 2", () => {
  const r = check(repo({ [SHIP]: "\"use strict\";\nconst RENAMED_LIST = [];\n" }));
  assert.strictEqual(r.code, 2, r.out);
  assert.match(r.json.error, /KNOWN_NOT_SHIPPED not found/);
});

test("RUNNER ERROR: malformed allowlist JSON is exit 2", () => {
  const r = check(repo({ [POLICY]: "{ \"allow\": [ " }));
  assert.strictEqual(r.code, 2, r.out);
});

test("an absent source file is skipped, and a fixture allowlist is not a config source", () => {
  const r = check(repo({ "fixtures/x/foo.allowlist.json": { allow: [{ path: "nowhere" }] }, "README.md": "x\n" }));
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(r.json.skipped.some((s) => s.source.startsWith(SHIP)), JSON.stringify(r.json.skipped));
});

test("RED: a shipped script that requires or spawns a file the tree does not carry is UNRESOLVED", () => {
  const r = check(repo({
    "scripts/a.js": "const b = require(\"./b\");\nconst { spawnSync } = require(\"child_process\");\nspawnSync(process.execPath, [\"scripts/missing-tool.js\"]);\n",
  }));
  assert.strictEqual(r.code, 1, r.out);
  assert.deepStrictEqual(r.json.unresolvedRequires.map((u) => `${u.kind}:${u.entry}`).sort(), ["require:./b", "spawn:scripts/missing-tool.js"]);
});

test("GREEN: the same script with its targets tracked resolves; strings, tests and absence-guarded private modules are not followed", () => {
  const r = check(repo({
    "scripts/a.js": "const b = require(\"./b\");\nconst { spawnSync } = require(\"child_process\");\nspawnSync(process.execPath, [\"scripts/tool.js\"]);\nconst doc = \"usage: require('./not-a-real-module')\";\ntry { require(\"./open-source/partition-loader\"); } catch {}\n",
    "scripts/b.js": "module.exports = 1;\n",
    "scripts/tool.js": "// a tool\n",
    "scripts/a.test.js": "require(\"./fixture-only-module\");\n",
  }));
  assert.deepStrictEqual(r.json.unresolvedRequires, [], r.out);
  assert.strictEqual(r.code, 0, r.out);
});

const LINT = "scripts/path-lint.js";
const lintSource = (entries) => `"use strict";\nconst SKIP_SUBSTRINGS = [\n${entries.map((e) => `  "${e}",`).join("\n")}\n];\n`;

test("RED: a path-lint skip entry no tracked path contains, and nothing vouches for, is DANGLING", () => {
  const r = check(repo({ "docs/kept.md": "x\n", [LINT]: lintSource(["docs/kept.md", "one-off/instance-only.js"]) }));
  assert.strictEqual(r.code, 1, r.out);
  assert.deepStrictEqual(r.json.dangling.map((d) => `${d.kind}:${d.entry}`), ["substring:one-off/instance-only.js"]);
});

test("a vouched run-time skip entry resolves, and its vouch is not stale where the path IS tracked", () => {
  const writers = { ".claude/paths.json": "{ \"runtime\": \".claude/runtime\" }\n" };
  const usedHere = (r) => !r.json.staleRuntime.some((s) => s.endsWith(": .claude/runtime/"));
  const fresh = check(repo({ ...writers, [LINT]: lintSource([".claude/runtime/"]) }));
  assert.deepStrictEqual(fresh.json.dangling, [], fresh.out);
  assert.ok(usedHere(fresh), JSON.stringify(fresh.json.staleRuntime));
  const tracked = check(repo({ ...writers, ".claude/runtime/x.json": "{}\n", [LINT]: lintSource([".claude/runtime/"]) }));
  assert.deepStrictEqual(tracked.json.dangling, [], tracked.out);
  assert.ok(usedHere(tracked), JSON.stringify(tracked.json.staleRuntime));
});

test("an instance-only allowlist registers through the instance-local file; without it, exit 2; malformed, exit 2", () => {
  const priv = "scripts/private/thing.denylist.json";
  const local = ".claude/project/memory/config-path-resolves.local.json";
  const without = check(repo({ [priv]: { deny: ["x"] } }));
  assert.strictEqual(without.code, 2, without.out);
  const dir = repo({ [priv]: { deny: ["x"] } });
  fs.mkdirSync(path.join(dir, ".claude", "project", "memory"), { recursive: true });
  fs.writeFileSync(path.join(dir, local), JSON.stringify({ dataSources: { [priv]: "instance-only, checked by its owner" } }));
  const withLocal = check(dir);
  assert.strictEqual(withLocal.code, 0, withLocal.out);
  assert.ok(withLocal.json.skipped.some((s) => s.source === priv && /instance-local/.test(s.reason)), JSON.stringify(withLocal.json.skipped));
  fs.writeFileSync(path.join(dir, local), "{ not json");
  assert.strictEqual(check(dir).code, 2);
});

test("RED: a vouch whose entry is tracked in this tree is used, not stale (the same source runs where it is not)", () => {
  const r = check(repo({
    "_mc/MANIFEST.json": "{}\n",
    "scripts/mc/manifest/build.js": "// writes _mc/MANIFEST.json\n",
    [SHIP]: shipSource([`  { prefix: "_mc/MANIFEST.json", reason: "build output" }`]),
  }));
  assert.ok(!r.json.staleRuntime.some((s) => s.endsWith(": _mc/MANIFEST.json")), JSON.stringify(r.json.staleRuntime));
});
