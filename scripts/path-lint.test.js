"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const LINT = path.join(__dirname, "path-lint.js");

function project(localSkips) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "path-lint-"));
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "notes", "instance-history.md"), "Old layout wrote to .claude/events/events.jsonl once.\n"); // path-literal-allowed (the planted fixture)
  if (localSkips !== undefined) {
    fs.mkdirSync(path.join(dir, ".claude", "project", "memory"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "project", "memory", "path-lint.local.json"), typeof localSkips === "string" ? localSkips : JSON.stringify(localSkips));
  }
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [LINT, "--json"], { encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

test("with the instance-local skip, the instance-only file is not linted", () => {
  const r = run(project({ skipSubstrings: ["notes/instance-history.md"] }));
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.strictEqual(json.critical.length, 0);
  assert.strictEqual(json.instanceSkips, 1);
});

test("without the file, the same file is linted and the output says there are no instance skips", () => {
  const r = run(project(undefined));
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const json = JSON.parse(r.stdout);
  assert.ok(json.critical.some((c) => c.file === "notes/instance-history.md"), r.stdout);
  assert.strictEqual(json.instanceSkips, "none (no instance-local skip file)");
});

test("a malformed instance-local skip file exits 2", () => {
  const r = run(project("{ not json"));
  assert.strictEqual(r.status, 2, r.stdout + r.stderr);
});
