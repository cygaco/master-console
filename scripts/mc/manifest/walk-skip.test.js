"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SRC = path.join(__dirname, "walk-skip.js");

function root(local) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walk-skip-"));
  const modDir = path.join(dir, "scripts", "mc", "manifest");
  fs.mkdirSync(modDir, { recursive: true });
  fs.copyFileSync(SRC, path.join(modDir, "walk-skip.js"));
  if (local !== undefined) {
    const memDir = path.join(dir, ".claude", "project", "memory");
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(path.join(memDir, "walk-skip.local.json"), typeof local === "string" ? local : JSON.stringify(local));
  }
  return path.join(modDir, "walk-skip.js");
}

test("with the instance-local file, its names join the skip sets next to the product entries", () => {
  const ws = require(root({ skipDirs: ["instance-scratch"], skipFiles: ["INSTANCE-NOTES.md"] }));
  assert.ok(ws.WALK_SKIP_DIRS.has("instance-scratch"));
  assert.ok(ws.WALK_SKIP_FILES.has("INSTANCE-NOTES.md"));
  assert.ok(ws.WALK_SKIP_DIRS.has("node_modules") && ws.WALK_SKIP_DIRS.has("runtime"));
  assert.ok(ws.WALK_SKIP_FILES.has(".env"));
  assert.strictEqual(ws.WALK_SKIP_INSTANCE, 2);
});

test("without the file, the skip sets hold only the product entries and the status says there are none", () => {
  const withLocal = require(root({ skipDirs: ["instance-scratch"], skipFiles: ["INSTANCE-NOTES.md"] }));
  const ws = require(root(undefined));
  assert.ok(!ws.WALK_SKIP_DIRS.has("instance-scratch"));
  assert.ok(!ws.WALK_SKIP_FILES.has("INSTANCE-NOTES.md"));
  assert.ok(ws.WALK_SKIP_DIRS.has("node_modules") && ws.WALK_SKIP_DIRS.has(".git"));
  assert.strictEqual(ws.WALK_SKIP_DIRS.size, withLocal.WALK_SKIP_DIRS.size - 1);
  assert.strictEqual(ws.WALK_SKIP_FILES.size, withLocal.WALK_SKIP_FILES.size - 1);
  assert.strictEqual(ws.WALK_SKIP_INSTANCE, "none (no instance-local skip file)");
});

test("either key alone is enough", () => {
  const ws = require(root({ skipFiles: ["INSTANCE-NOTES.md"] }));
  assert.ok(ws.WALK_SKIP_FILES.has("INSTANCE-NOTES.md"));
  assert.strictEqual(ws.WALK_SKIP_INSTANCE, 1);
});

for (const [label, body] of [
  ["not JSON", "{ not json"],
  ["not an object", "[]"],
  ["no skip key", JSON.stringify({ other: [] })],
  ["a key that is not an array", JSON.stringify({ skipDirs: "instance-scratch" })],
  ["an empty name", JSON.stringify({ skipFiles: [""] })],
  ["a name with a path separator", JSON.stringify({ skipDirs: ["a/b"] })],
]) {
  test(`a malformed instance-local file (${label}) makes require() throw`, () => {
    assert.throws(() => require(root(body)), /walk-skip: instance-local skip file malformed/);
  });
}
