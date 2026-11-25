"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const P = require("./presets");

const REPO = path.resolve(__dirname, "..", "..");
const FIX = path.join(__dirname, "fixtures", "presets");
const presetsDir = path.join(REPO, ".claude", "agents", "_org", "presets");
const opts = {
  registryPath: path.join(REPO, ".claude", "agents", "_org", "role-registry.json"),
  manifestPath: path.join(REPO, ".claude", "manifest.json"),
  projectRoot: REPO,
  presetsDir,
  logPath: path.join(REPO, "runtime", "unused-presets.log.jsonl"),
};
const readFix = (n) => JSON.parse(fs.readFileSync(path.join(FIX, `${n}.json`), "utf8"));
const codes = (f) => f.map((x) => `${x.code}:${x.unitClass}`);

test("codex builders with codex reviewers cannot claim cross-family code review", () => {
  const f = P.validatePresetCoverage(readFix("codex-builders-codex-reviewers"), opts);
  assert.deepEqual(codes(f).filter((c) => c.startsWith("coverage-unmet:code")), ["coverage-unmet:code"]);
});

test("claude builders with codex reviewers do deliver cross-family code review", () => {
  assert.deepEqual(P.validatePresetCoverage(readFix("claude-builders-codex-reviewers"), opts), []);
});

test("standard pins cannot claim cross-family code review", () => {
  const f = P.validatePresetCoverage(readFix("standard-claims-code-cross"), opts);
  assert.ok(codes(f).includes("coverage-unmet:code"));
});

test("the shipped presets validate", () => {
  for (const id of ["standard", "spend-more-on-codex", "spend-more-on-claude"]) {
    const p = P.loadPreset(id, { ...opts, allowInvalid: true });
    assert.deepEqual(P.validatePresetCoverage(p, opts), [], id);
    assert.doesNotThrow(() => P.loadPreset(id, opts), id);
  }
});

test("a preset with no coverage reports every unit class missing", () => {
  const p = { ...readFix("claude-builders-codex-reviewers") };
  delete p.coverage;
  const f = P.validatePresetCoverage(p, opts);
  assert.deepEqual(codes(f).sort(), ["coverage-missing:code", "coverage-missing:security", "coverage-missing:visual"]);
});

test("a value outside the allowed set is invalid", () => {
  const p = readFix("claude-builders-codex-reviewers");
  p.coverage.visual = "cross-family";
  assert.deepEqual(codes(P.validatePresetCoverage(p, opts)), ["coverage-invalid:visual"]);
});

test("loadPreset refuses a false claim unless allowInvalid is set", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "pcov-"));
  fs.copyFileSync(path.join(FIX, "standard-claims-code-cross.json"), path.join(dir, "standard-claims-code-cross.json"));
  const o = { ...opts, presetsDir: dir };
  assert.throws(() => P.loadPreset("standard-claims-code-cross", o), /coverage-unmet/);
  assert.ok(P.loadPreset("standard-claims-code-cross", { ...o, allowInvalid: true }));
});

test("presets validate exits 0 for the shipped presets and 1 for a false claim", () => {
  const run = (args, dir) =>
    spawnSync(process.execPath, [path.join(__dirname, "presets.js"), "validate", ...args], {
      cwd: dir || REPO,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir || REPO },
      encoding: "utf8",
    });
  assert.equal(run([]).status, 0);
  const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "pcov-cli-"));
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  for (const rel of [".claude/paths.json", ".claude/manifest.json", ".claude/agents/_org/role-registry.json"]) {
    w(rel, fs.readFileSync(path.join(REPO, rel), "utf8"));
  }
  w(".claude/agents/_org/presets/bad.json", fs.readFileSync(path.join(FIX, "standard-claims-code-cross.json"), "utf8"));
  const r = run([], root);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /coverage-unmet/);
});
