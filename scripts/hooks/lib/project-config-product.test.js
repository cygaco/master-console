"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_CONFIG = path.join(__dirname, "project-config.js");

function productFor(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-product-slug-"));
  try {
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "manifest.json"), JSON.stringify(manifest));
    const code =
      "const pc = require(" + JSON.stringify(PROJECT_CONFIG) + ");" +
      "process.stdout.write(JSON.stringify({ fn: typeof pc.getMcProduct, v: typeof pc.getMcProduct === 'function' ? pc.getMcProduct() : null }));";
    const r = spawnSync(process.execPath, ["-e", code], {
      cwd: dir,
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("getMcProduct is exported", () => {
  assert.strictEqual(productFor({}).fn, "function");
});

test("new-format manifest: top-level mcProduct is read", () => {
  assert.strictEqual(productFor({ mcProduct: "new-slug" }).v, "new-slug");
});

test("old-format manifest: top-level warpProduct is still read", () => {
  assert.strictEqual(productFor({ warpProduct: "old-slug" }).v, "old-slug");
});

test("mcProduct wins over the legacy key when both are present", () => {
  assert.strictEqual(productFor({ mcProduct: "new-slug", warpProduct: "old-slug" }).v, "new-slug");
});

test("project.slug takes precedence over both top-level keys", () => {
  assert.strictEqual(productFor({ project: { slug: "proj-slug" }, mcProduct: "new-slug", warpProduct: "old-slug" }).v, "proj-slug");
});
