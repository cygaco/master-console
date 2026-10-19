"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delta-aggregate-"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(__dirname, "delta-aggregate-reviews.js"), path.join(root, "scripts", "delta-aggregate-reviews.js"));
  const dir = path.join(root, ".claude", "runtime", "dispatch", "reviewers");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), JSON.stringify({ ok: true, output: '```json\n{"pass":true}\n```' }));
  return root;
}
const run = (root, ...args) =>
  spawnSync(process.execPath, [path.join(root, "scripts", "delta-aggregate-reviews.js"), ...args], { encoding: "utf8" });

test("with no arguments, the features are the ones with reviewer output", () => {
  const r = run(tree(["alpha-reviewer-output.json", "beta-gamma-qa-output.json", "notes.txt"]));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^alpha\s+reviewer\s+✓ PASS/m);
  assert.match(r.stdout, /^beta-gamma\s+qa\s+✓ PASS/m);
  assert.match(r.stdout, /^alpha\s+compliance\s+✗ missing/m);
  assert.doesNotMatch(r.stdout, /^notes/m);
});

test("a current-roster role reads the common verdict field", () => {
  const root = tree([]);
  const dir = path.join(root, ".claude", "runtime", "dispatch", "reviewers");
  fs.writeFileSync(path.join(dir, "alpha-qa-reviewer-output.json"), JSON.stringify({ ok: true, output: '```json\n{"verdict":"pass","findings":[]}\n```' }));
  fs.mkdirSync(path.join(root, "scripts", "dispatch"));
  fs.writeFileSync(path.join(root, "scripts", "dispatch", "org-roles.js"), 'module.exports = { reviewGauntletRoles: () => ["qa-reviewer"] };\n');
  const r = run(root, "alpha");
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^alpha\s+qa-reviewer\s+✓ PASS\s+findings=0/m);
});

test("feature arguments still choose the features", () => {
  const r = run(tree(["alpha-reviewer-output.json"]), "delta");
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /^delta\s+reviewer\s+✗ missing/m);
  assert.doesNotMatch(r.stdout, /^alpha\s/m);
});
