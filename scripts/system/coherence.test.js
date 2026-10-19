"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const { checks } = require("./coherence");

delete process.env.CLAUDE_PROJECT_DIR;

const made = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coh-fixture-"));
  made.push(dir);
  return dir;
}
test.after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
}
function copy(root, rel) {
  const src = path.join(REPO, rel);
  const dst = path.join(root, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

function specTree() {
  const root = fixture();
  copy(root, "scripts/requirements");
  copy(root, "scripts/hooks/lib");
  copy(root, "scripts/mc/repo-role.js");
  return root;
}

test("spec: no requirements graph and no feature specs is yellow and names graph-build.js", () => {
  const n = checks.spec(specTree());
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /not built yet/);
  assert.match(n.message, /node scripts\/requirements\/graph-build\.js/);
});

test("spec: no requirements graph while a feature spec exists stays red", () => {
  const root = specTree();
  write(root, "_requirements/04-features/onboarding/PRD.md", "# Onboarding\n");
  const n = checks.spec(root);
  assert.strictEqual(n.status, "red", JSON.stringify(n));
  assert.ok(n.details.some((d) => /graph_present/.test(d)), JSON.stringify(n.details));
});

function pathTree() {
  const root = fixture();
  copy(root, "framework/paths.registry.json");
  copy(root, "scripts/paths/build.js");
  copy(root, "scripts/paths/gate.js");
  write(root, "scripts/path-lint.js", 'console.log(JSON.stringify({ critical: [], warnings: [] }));\n');
  const r = spawnSync(process.execPath, [path.join(root, "scripts/paths/build.js")], { cwd: root, encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  return root;
}
const PATH_KEYS = "_requirements/03-architecture/PATH_KEYS.md";

test("path: every generated artifact current is green", () => {
  const n = checks.path(pathTree());
  assert.strictEqual(n.status, "green", JSON.stringify(n));
});

test("path: the path-keys reference doc not built is yellow and names build.js", () => {
  const root = pathTree();
  fs.rmSync(path.join(root, PATH_KEYS));
  const n = checks.path(root);
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /not built yet/);
  assert.match(n.message, /node scripts\/paths\/build\.js/);
});

test("path: a stale path-keys reference doc stays red", () => {
  const root = pathTree();
  fs.appendFileSync(path.join(root, PATH_KEYS), "hand edit\n");
  assert.strictEqual(checks.path(root).status, "red");
});

test("path: a missing runtime artifact (.claude/paths.json) stays red", () => {
  const root = pathTree();
  fs.rmSync(path.join(root, ".claude/paths.json"));
  assert.strictEqual(checks.path(root).status, "red");
});

function aliasTree() {
  const root = pathTree();
  const regFile = path.join(root, "framework/paths.registry.json");
  const reg = JSON.parse(fs.readFileSync(regFile, "utf8"));
  const key = Object.keys(reg.paths).find((k) => !reg.paths[k].removedIn);
  reg.paths[key].deprecatedAliases = ["old-tree/legacy-dir"];
  fs.writeFileSync(regFile, JSON.stringify(reg, null, 2) + "\n");
  spawnSync(process.execPath, [path.join(root, "scripts/paths/build.js")], { cwd: root, encoding: "utf8" });
  write(root, "notes/archived-plan.md", "See old-tree/legacy-dir for the layout.\n");
  return root;
}
const LOCAL_SKIPS = ".claude/project/memory/path-lint.local.json";

test("path: a deprecated alias in a file the tree carries is red without an instance-local skip", () => {
  assert.strictEqual(checks.path(aliasTree()).status, "red");
});

test("path: the instance-local skip file excludes a file from the deprecated-alias walk", () => {
  const root = aliasTree();
  write(root, LOCAL_SKIPS, { skipSubstrings: ["notes/archived-plan.md"] });
  const n = checks.path(root);
  assert.strictEqual(n.status, "green", JSON.stringify(n));
});

test("path: a malformed instance-local skip file is red", () => {
  const root = aliasTree();
  write(root, LOCAL_SKIPS, { skipSubstrings: "notes/archived-plan.md" });
  const n = checks.path(root);
  assert.strictEqual(n.status, "red", JSON.stringify(n));
  assert.ok(n.details.some((d) => /instance-local skip file/.test(d)), JSON.stringify(n.details));
});

function decisionTree(lines) {
  const root = fixture();
  copy(root, "scripts/decisions/ledger.js");
  copy(root, "scripts/hooks/lib");
  if (lines) write(root, ".claude/project/decisions/decision-ledger.jsonl", lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return root;
}
const entry = (cls) => ({ id: `DEC-${cls}`, ts: "2026-01-01T00:00:00.000Z", class: cls, owner: "alpha", topic: "t", decision: "d", why: "w", reversible: true, reversalPlan: "r" });

test("decision: no ledger yet is yellow and names the record command", () => {
  const n = checks.decision(decisionTree(null));
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /no decisions recorded yet/);
  assert.match(n.message, /node scripts\/decisions\/ledger\.js --record/);
});

test("decision: a ledger of Class A entries only stays red", () => {
  assert.strictEqual(checks.decision(decisionTree([entry("A")])).status, "red");
});

test("decision: an entry with an invalid class stays red", () => {
  assert.strictEqual(checks.decision(decisionTree([entry("B"), { id: "DEC-x" }])).status, "red");
});

test("decision: a valid Class B entry is green", () => {
  assert.strictEqual(checks.decision(decisionTree([entry("B")])).status, "green");
});

function providerTree(providers) {
  const root = fixture();
  copy(root, "scripts/agents/provider-trace.js");
  const roles = Object.keys(providers);
  write(root, "scripts/dispatch/org-roles.js", `module.exports = { gauntletReviewRoles: () => ${JSON.stringify(roles)} };\n`);
  write(root, "scripts/hooks/lib/providers.js", `const m = ${JSON.stringify(providers)};\nmodule.exports = { getProviderForRole: (r) => m[r] };\n`);
  write(root, ".claude/manifest.json", { agentProviders: {} });
  return root;
}

test("provider: openai and antigravity review lanes are green", () => {
  const n = checks.provider(providerTree({ "qa-reviewer": "openai", "security-reviewer": "antigravity" }));
  assert.strictEqual(n.status, "green", JSON.stringify(n));
});

test("provider: review lanes repinned to claude with one non-Anthropic lane left is yellow", () => {
  const n = checks.provider(providerTree({ "qa-reviewer": "claude", "backend-reviewer": "claude", "security-reviewer": "antigravity" }));
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.ok(n.details.some((d) => /openai/.test(d)), JSON.stringify(n.details));
});

test("provider: no non-Anthropic review lane at all stays red", () => {
  const n = checks.provider(providerTree({ "qa-reviewer": "claude", "security-reviewer": "claude" }));
  assert.strictEqual(n.status, "red", JSON.stringify(n));
});

function installTree({ manifest = true, installed = null } = {}) {
  const root = fixture();
  copy(root, "scripts/mc/snapshot-installed.js");
  copy(root, "scripts/mc/lib");
  write(root, "install.ps1", "# installer\n");
  write(root, "version.json", { version: "9.9.9" });
  if (manifest) write(root, ".claude/framework-manifest.json", { $schema: "mc/framework-manifest/v2", version: "9.9.9", assets: {} });
  if (installed) write(root, ".claude/framework-installed.json", installed);
  return root;
}

test("install: the framework source tree without an installed snapshot is yellow and names snapshot-installed.js", () => {
  const n = checks.install(installTree());
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /not built yet/);
  assert.match(n.message, /node scripts\/mc\/snapshot-installed\.js/);
});

test("install: a stale installed snapshot stays red", () => {
  const n = checks.install(installTree({ installed: { $schema: "mc/framework-installed/v2", installedVersion: "1.0.0", assets: [] } }));
  assert.strictEqual(n.status, "red", JSON.stringify(n));
});

test("install: a current installed snapshot is green", () => {
  const n = checks.install(installTree({ installed: { $schema: "mc/framework-installed/v2", installedVersion: "9.9.9", assets: [] } }));
  assert.strictEqual(n.status, "green", JSON.stringify(n));
});

test("install: a tree with neither the framework manifest nor an installed snapshot stays red", () => {
  assert.strictEqual(checks.install(installTree({ manifest: false })).status, "red");
});

test("install: install.ps1 missing stays red", () => {
  const root = installTree();
  fs.rmSync(path.join(root, "install.ps1"));
  assert.strictEqual(checks.install(root).status, "red");
});

function pkgTree(scripts, workflow) {
  const root = fixture();
  write(root, "package.json", { name: "x", scripts });
  if (workflow) write(root, ".github/workflows/test.yml", "name: test\n");
  return root;
}

test("test: no build script is yellow, not red", () => {
  const n = checks.test(pkgTree({ test: "node t.js" }, true));
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /no build script/);
});

test("test: no test script stays red", () => {
  assert.strictEqual(checks.test(pkgTree({ build: "node b.js" }, true)).status, "red");
});

test("test: build, test and the CI workflow present is green", () => {
  assert.strictEqual(checks.test(pkgTree({ build: "node b.js", test: "node t.js" }, true)).status, "green");
});

test("test: no .github/workflows/test.yml is yellow, not red", () => {
  const n = checks.test(pkgTree({ build: "node b.js", test: "node t.js" }, false));
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /\.github\/workflows\/test\.yml not found/);
});

function versionTree(v, mv, capsule) {
  const root = fixture();
  write(root, "version.json", { version: v });
  write(root, ".claude/framework-manifest.json", { version: mv });
  if (capsule) write(root, `framework/releases/${v}/release.json`, { version: capsule });
  return root;
}

test("version: no release capsule for the version yet is yellow and names /mc:release", () => {
  const n = checks.version(versionTree("2.0.0", "2.0.0", null));
  assert.strictEqual(n.status, "yellow", JSON.stringify(n));
  assert.match(n.message, /framework\/releases\/2\.0\.0\/release\.json/);
  assert.match(n.message, /\/mc:release/);
});

test("version: version.json and the framework manifest disagreeing stays red", () => {
  assert.strictEqual(checks.version(versionTree("2.0.0", "1.9.0", null)).status, "red");
});

test("version: a release capsule naming another version stays red", () => {
  assert.strictEqual(checks.version(versionTree("2.0.0", "2.0.0", "1.9.0")).status, "red");
});

test("version: all three sources agreeing is green", () => {
  assert.strictEqual(checks.version(versionTree("2.0.0", "2.0.0", "2.0.0")).status, "green");
});

const SETTINGS_SCHEMA = "https://json.schemastore.org/claude-code-settings.json";

const readRepoJson = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
const HAS_DEFAULTS = fs.existsSync(path.join(REPO, "_mc/settings/defaults.json"));

test("config: the settings source this tree carries declares the Claude Code settings $schema", () => {
  if (HAS_DEFAULTS) {
    assert.strictEqual(readRepoJson("_mc/settings/defaults.json").$schema, SETTINGS_SCHEMA);
    assert.strictEqual(readRepoJson("scripts/public-repo/seeds/.claude/settings.json").$schema, SETTINGS_SCHEMA);
    const r = spawnSync(process.execPath, [path.join(REPO, "scripts/public-repo/settings-seed.js"), "check"], { cwd: REPO, encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  } else {
    assert.strictEqual(readRepoJson(".claude/settings.json").$schema, SETTINGS_SCHEMA);
  }
});
