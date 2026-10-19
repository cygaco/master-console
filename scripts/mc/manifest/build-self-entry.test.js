"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { build } = require("./build");
const { validate } = require("./validate");

function write(root, rel, body) {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function freshProduct() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-self-entry-"));
  write(root, "CLAUDE.md", "# product\n");
  write(root, "_mc/commands/demo.md", "demo\n");
  write(root, ".claude/commands/demo.md", "demo\n");
  return root;
}

test("a first build in a product lists _mc/MANIFEST.json, and validate --strict finds nothing", () => {
  const root = freshProduct();
  try {
    const manifestPath = path.join(root, "_mc", "MANIFEST.json");
    assert.ok(!fs.existsSync(manifestPath));
    const r = build({ root, sourcePrefix: "_mc" });
    assert.strictEqual(r.ok, true, r.error);
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.ok(m.paths["_mc/MANIFEST.json"], "the manifest does not list itself");
    assert.strictEqual(m.paths["_mc/MANIFEST.json"].owner, "generated");
    const v = validate({ manifestPath, root, strict: true });
    assert.deepStrictEqual(v.findings.unmanifested, []);
    assert.strictEqual(v.code, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a rebuild keeps listing _mc/MANIFEST.json once", () => {
  const root = freshProduct();
  try {
    build({ root, sourcePrefix: "_mc" });
    const r = build({ root, sourcePrefix: "_mc" });
    assert.strictEqual(r.ok, true, r.error);
    const m = JSON.parse(fs.readFileSync(path.join(root, "_mc", "MANIFEST.json"), "utf8"));
    assert.strictEqual(Object.keys(m.paths).filter((k) => k === "_mc/MANIFEST.json").length, 1);
    assert.strictEqual(m.paths["_mc/MANIFEST.json"].owner, "generated");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
