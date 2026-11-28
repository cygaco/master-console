#!/usr/bin/env node
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const GUARD = path.join(__dirname, "dependency-admission-guard.js");

const PKG = (extra) =>
  JSON.stringify({ name: "fixture", version: "0.0.0", engines: { node: ">=18" }, ...extra }, null, 2) + "\n";

function tmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dag-${tag}-`));
}

function run(payload, home) {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: home },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const edit = (file, old_string, new_string, extra) => ({ tool_name: "Edit", tool_input: { file_path: file, old_string, new_string, ...extra } });

test("a partial Edit that touches no dependency (engines bump) in the HOME repo passes", () => {
  const home = tmp("home");
  const file = path.join(home, "package.json");
  fs.writeFileSync(file, PKG());
  const r = run(edit(file, '"node": ">=18"', '"node": ">=20"'), home);
  assert.strictEqual(r.status, 0, r.out);
});

test("a partial Edit that ADDS a dependency without an admission record in the HOME repo is blocked (exit 2) and names it", () => {
  const home = tmp("home");
  const file = path.join(home, "package.json");
  fs.writeFileSync(file, PKG());
  const r = run(edit(file, '"engines": {', '"dependencies": { "left-pad": "1.3.0" },\n  "engines": {'), home);
  assert.strictEqual(r.status, 2, r.out);
  assert.ok(r.out.includes("left-pad@1.3.0"), r.out);
});

test("an Edit whose old_string is not in the file fails CLOSED (exit 2) — the guard never guesses", () => {
  const home = tmp("home");
  const file = path.join(home, "package.json");
  fs.writeFileSync(file, PKG());
  const r = run(edit(file, "NOT-IN-FILE", "x"), home);
  assert.strictEqual(r.status, 2, r.out);
  assert.ok(/failing closed/.test(r.out), r.out);
});

test("a Write of a whole package.json that adds a dependency is still blocked (document path unchanged)", () => {
  const home = tmp("home");
  const file = path.join(home, "package.json");
  fs.writeFileSync(file, PKG());
  const r = run({ tool_name: "Write", tool_input: { file_path: file, content: PKG({ dependencies: { "left-pad": "1.3.0" } }) } }, home);
  assert.strictEqual(r.status, 2, r.out);
});

test("scope: a package.json OUTSIDE the home project is never evaluated — even an unparseable fragment passes", () => {
  const home = tmp("home");
  const foreign = tmp("foreign");
  const file = path.join(foreign, "package.json");
  fs.writeFileSync(file, PKG());
  const r = run(edit(file, '"node": ">=18"', '"node": ">=20"'), home);
  assert.strictEqual(r.status, 0, r.out);
  const r2 = run(edit(file, '"engines": {', '"dependencies": { "left-pad": "1.3.0" },\n  "engines": {'), home);
  assert.strictEqual(r2.status, 0, r2.out);
});

test("a non-package.json file and a non-Edit/Write tool are ignored", () => {
  const home = tmp("home");
  const r = run({ tool_name: "Edit", tool_input: { file_path: path.join(home, "index.js"), old_string: "a", new_string: "b" } }, home);
  assert.strictEqual(r.status, 0, r.out);
  const r2 = run({ tool_name: "Read", tool_input: { file_path: path.join(home, "package.json") } }, home);
  assert.strictEqual(r2.status, 0, r2.out);
});
