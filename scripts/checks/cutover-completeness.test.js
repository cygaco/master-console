#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluate, extractFile } = require("./cutover-completeness");

let passed = 0;
const failures = [];
const skipped = [];
class SkipTest extends Error {}
function requirePartitionLoader() {
  if (!fs.existsSync(path.join(__dirname, "..", "open-source", "partition-loader.js"))) {
    throw new SkipTest("requires the rename-map loader (scripts/open-source/partition-loader.js) — skipped on a fresh install");
  }
}
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    if (e instanceof SkipTest) skipped.push(`${name}: ${e.message}`);
    else failures.push(`${name}: ${e.message}`);
  }
}
const flagged = (res, file, literal) =>
  res.findings.some((f) => f.file === file && f.literal === literal);
const allowedFor = (res, file, literal) =>
  res.allowed.some((a) => a.file === file && a.literal === literal);

const hit = (over = {}) => ({
  file: "scripts/live-consumer.js",
  line: 10,
  literal: "03-managers",
  text: 'path: ".claude/agents/03-managers/x.md",',
  inComment: false,
  wasField: false,
  ...over,
});

test("no hits → 0 findings", () => {
  const res = evaluate({ hits: [], fileAllow: new Set(), prefixAllow: [] });
  assert.deepStrictEqual(res.findings, [], `expected clean, got: ${res.findings.map((f) => f.message).join(" | ")}`);
});

test("functional dead-tree path → flagged (dead-tree-path)", () => {
  const res = evaluate({ hits: [hit()], fileAllow: new Set(), prefixAllow: [] });
  assert.ok(flagged(res, "scripts/live-consumer.js", "03-managers"), "expected 03-managers flagged");
  assert.strictEqual(res.findings[0].kind, "dead-tree-path");
});

test("functional renamed-away role → flagged (renamed-away-role)", () => {
  const res = evaluate({
    hits: [hit({ literal: "product-designer", text: '"rooted_in": "product-designer",', file: ".claude/agents/_principles/registry.json" })],
    fileAllow: new Set(),
    prefixAllow: [],
  });
  assert.ok(flagged(res, ".claude/agents/_principles/registry.json", "product-designer"), "expected product-designer flagged");
  assert.strictEqual(res.findings[0].kind, "renamed-away-role");
});

test("comment hit → allowed (migrated-from / ADR-context), not flagged", () => {
  const res = evaluate({ hits: [hit({ inComment: true })], fileAllow: new Set(), prefixAllow: [] });
  assert.ok(!flagged(res, "scripts/live-consumer.js", "03-managers"), "comment hit must NOT flag");
  assert.ok(allowedFor(res, "scripts/live-consumer.js", "03-managers"), "comment hit must be recorded as allowed");
  assert.ok(/comment/.test(res.allowed[0].allowedBy), `expected comment reason, got ${res.allowed[0].allowedBy}`);
});

test("`was:` field hit → allowed (historical rename record), not flagged", () => {
  const res = evaluate({
    hits: [hit({ literal: "product-designer", wasField: true, text: '"was": "product-designer",' })],
    fileAllow: new Set(),
    prefixAllow: [],
  });
  assert.ok(!flagged(res, "scripts/live-consumer.js", "product-designer"), "`was:` field must NOT flag");
  assert.ok(/was:/.test((res.allowed[0] || {}).allowedBy || ""), "`was:` field must be recorded as allowed");
});

test("file-allowlist hit → allowed (e.g. role-aliases.js), not flagged", () => {
  const f = "scripts/hooks/lib/role-aliases.js";
  const res = evaluate({
    hits: [hit({ file: f, literal: "growth-lead", text: '"growth-lead": "marketing-lead",' })],
    fileAllow: new Set([f]),
    prefixAllow: [],
  });
  assert.ok(!flagged(res, f, "growth-lead"), "file-allowlisted hit must NOT flag");
  assert.ok(allowedFor(res, f, "growth-lead"), "file-allowlisted hit must be recorded as allowed");
});

test("prefix-allowlist hit → allowed (frozen framework/releases/*), not flagged", () => {
  const f = "framework/releases/0.13.0/agents/00-alex/alpha.md";
  const res = evaluate({
    hits: [hit({ file: f, literal: "00-alex" })],
    fileAllow: new Set(),
    prefixAllow: [{ prefix: "framework/releases/", reason: "frozen capsule" }],
  });
  assert.ok(!flagged(res, f, "00-alex"), "prefix-allowlisted hit must NOT flag");
  assert.ok(/prefix-allowlist/.test((res.allowed[0] || {}).allowedBy || ""), "prefix hit must be recorded as allowed");
});

test("dead-tree PATH still flags even when wasField=true (path ≠ rename history)", () => {
  const res = evaluate({
    hits: [hit({ literal: "01-adhoc/", text: '"current_spec": ".claude/agents/01-adhoc/fixer.md", "was": "fixer"', wasField: false })],
    fileAllow: new Set(),
    prefixAllow: [],
  });
  assert.ok(flagged(res, "scripts/live-consumer.js", "01-adhoc/"), "dead-tree path must flag");
});

test("extractFile: new role name does not false-match the old one (token boundary)", () => {
  const tmp = path.join(os.tmpdir(), `cutover-tok-${process.pid}.json`);
  fs.writeFileSync(tmp, '{\n  "a": "research-lead",\n  "b": "marketing-lead",\n  "c": "conversion-lead"\n}\n');
  try {
    const hits = extractFile(tmp, "fixtures/tok.json");
    assert.deepStrictEqual(hits, [], `new names must NOT match dead-role needles, got: ${hits.map((h) => h.literal).join(",")}`);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test("extractFile: classifies comment / was-field / functional correctly", () => {
  const tmpJs = path.join(os.tmpdir(), `cutover-cls-${process.pid}.js`);
  fs.writeFileSync(
    tmpJs,
    [
      'const p = ".claude/agents/03-managers/x.md";   // functional path (flag)',
      '// migrated from .claude/agents/00-alex/alpha.md (comment — allow)',
      'const role = "product-designer"; // functional role (flag)',
    ].join("\n") + "\n",
  );
  try {
    const hits = extractFile(tmpJs, "scripts/sample.js");
    const fn = hits.find((h) => h.literal === "03-managers");
    const cm = hits.find((h) => h.literal === "00-alex");
    const ro = hits.find((h) => h.literal === "product-designer");
    assert.ok(fn && fn.inComment === false, "03-managers path is functional (not in comment)");
    assert.ok(cm && cm.inComment === true, "00-alex in a // comment must be inComment=true");
    assert.ok(ro && ro.inComment === false, "product-designer before a trailing // is functional");
    const res = evaluate({ hits, fileAllow: new Set(), prefixAllow: [] });
    assert.ok(flagged(res, "scripts/sample.js", "03-managers") && flagged(res, "scripts/sample.js", "product-designer"), "two functional hits flag");
    assert.ok(!flagged(res, "scripts/sample.js", "00-alex"), "the comment hit does not flag");
  } finally {
    fs.unlinkSync(tmpJs);
  }
});

test("extractFile: a JSON `was:` field line marks wasField=true", () => {
  const tmp = path.join(os.tmpdir(), `cutover-was-${process.pid}.json`);
  fs.writeFileSync(tmp, '{\n  "design-lead": { "status": "rename", "was": "product-designer" }\n}\n');
  try {
    const hits = extractFile(tmp, ".claude/agents/_org/role-registry.json");
    const h = hits.find((x) => x.literal === "product-designer");
    assert.ok(h && h.wasField === true, "product-designer in a `was:` field must be wasField=true");
    const res = evaluate({ hits, fileAllow: new Set(), prefixAllow: [] });
    assert.ok(!flagged(res, ".claude/agents/_org/role-registry.json", "product-designer"), "`was:` role-name history must NOT flag");
  } finally {
    fs.unlinkSync(tmp);
  }
});

function runEnforcer({ root, env }) {
  let out = "";
  let status = 0;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, "cutover-completeness.js")], {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, ...(env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    status = e.status;
    out = `${e.stdout || ""}${e.stderr || ""}`;
  }
  return { status, out };
}

test("fresh tree: an absent rename-map loader SKIPS the rename-map half (no exit 2); a present-but-broken one fails closed", () => {
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-noloader-"));
  const missing = path.join(dir, "partition-loader.js");
  const a = runEnforcer({ root: path.resolve(__dirname, "..", ".."), env: { MC_CUTOVER_PARTITION_LOADER: missing } });
  assert.notStrictEqual(a.status, 2, `absent loader must not fail closed: ${a.out.slice(0, 400)}`);
  assert.match(a.out, /rename-map half SKIPPED — partition-loader\.js not present/);
  const broken = path.join(dir, "broken-loader.js");
  fs.writeFileSync(broken, "throw new Error('broken loader');\n");
  const b = runEnforcer({ root: path.resolve(__dirname, "..", ".."), env: { MC_CUTOVER_PARTITION_LOADER: broken } });
  assert.strictEqual(b.status, 2, `a present-but-broken loader must fail closed: ${b.out.slice(0, 400)}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("self-host: real enforcer runs on the live tree, lints clean (exit 0), never exit 2", () => {
  requirePartitionLoader();
  const { status, out } = runEnforcer({ root: path.resolve(__dirname, "..", "..") });
  assert.notStrictEqual(status, 2, `runner error (exit 2) is never a pass: ${out.slice(0, 400)}`);
  assert.strictEqual(status, 0, `enforcer must exit 0 on the live tree (no live-stale ref), got ${status}: ${out.slice(0, 600)}`);
  assert.ok(/PASS \[cutover-completeness\]/.test(out), `expected a PASS verdict line, got: ${out.slice(0, 200)}`);
  assert.ok(/0 live-stale/.test(out), `expected the verdict to report 0 live-stale, got: ${out.slice(0, 200)}`);
  assert.ok(!/FAIL[\s\S]*role-aliases\.js/.test(out), "role-aliases.js must NOT be flagged (it's allowlisted)");
});

test("planted: a sealed tree with live-stale keystone refs exits 1 and names them (was: field not flagged)", () => {
  requirePartitionLoader();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-planted-"));
  try {
    const principles = path.join(root, ".claude", "agents", "_principles");
    const org = path.join(root, ".claude", "agents", "_org");
    fs.mkdirSync(principles, { recursive: true });
    fs.mkdirSync(org, { recursive: true });
    fs.writeFileSync(
      path.join(principles, "registry.json"),
      '{\n  "alpha": { "spec": ".claude/agents/03-managers/alpha.md" }\n}\n',
    );
    fs.writeFileSync(
      path.join(org, "role-registry.json"),
      [
        "{",
        '  "design-lead": { "spec": ".claude/agents/product/product-designer.md", "status": "rename",',
        '    "was": "growth-lead" }',
        "}",
        "",
      ].join("\n"),
    );
    const { status, out } = runEnforcer({ root, env: { CLAUDE_PROJECT_DIR: root } });
    assert.strictEqual(status, 1, `planted live-stale refs must exit 1, got ${status}: ${out.slice(0, 600)}`);
    assert.ok(/FAIL \[cutover-completeness\] 2 live-stale ref\(s\)/.test(out), `expected exactly 2 live-stale findings, got: ${out.slice(0, 400)}`);
    assert.ok(/_principles\/registry\.json:2/.test(out) && /'03-managers'/.test(out), "the dead-tree path in _principles/registry.json must be named");
    assert.ok(/_org\/role-registry\.json:2/.test(out) && /'product-designer'/.test(out), "the renamed-away role in role-registry.json must be named");
    assert.ok(!/live-stale 'growth-lead'/.test(out), "the `was:` field value must NOT be flagged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

if (failures.length) {
  process.stderr.write(`cutover-completeness bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
if (skipped.length) process.stdout.write(`cutover-completeness bite-test: ${skipped.length} skipped:\n${skipped.map((f) => `  - ${f}`).join("\n")}\n`);
process.stdout.write(
  `cutover-completeness bite-test: ${passed} passed, ${skipped.length} skipped (positive + dead-tree/role fires + comment/was/file/prefix suppress + token-boundary + extractor classification + integration)\n`,
);
process.exit(0);
