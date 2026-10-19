"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..");
const DEPS = [
  "scripts/mc/snapshot-installed.js",
  "scripts/mc/lib/content-hash.js",
  "scripts/mc/repo-role.js",
  "scripts/hooks/lib/mc-env.js",
  "scripts/hooks/lib/split-brain-core.js",
];

function write(root, rel, body) {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body, null, 2));
}

function product({ record, withFrameworkManifest = true }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-installed-"));
  for (const rel of DEPS) {
    const dest = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO, ...rel.split("/")), dest);
  }
  write(root, "README.md", "# product\n");
  write(root, "version.json", { $schema: "mc/version/v1", name: "mc", version: "2.1.0" });
  write(root, "_mc/MANIFEST.json", { $schema: "mc/manifest/v1", paths: {} });
  if (withFrameworkManifest) {
    write(root, ".claude/framework-manifest.json", {
      $schema: "mc/framework-manifest/v2",
      version: "2.1.0",
      assets: { doc: [{ id: "doc.readme", src: "README.md", dest: "README.md" }] },
    });
  }
  if (record !== undefined) write(root, ".claude/framework-installed.json", record);
  return root;
}

function runSnapshot(root) {
  const env = { ...process.env };
  delete env.MC_REPO_ROLE;
  delete env.WARPOS_REPO_ROLE;
  return spawnSync(process.execPath, [path.join(root, "scripts", "mc", "snapshot-installed.js")], { cwd: root, env, encoding: "utf8" });
}

function readRecord(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".claude", "framework-installed.json"), "utf8"));
}

function roleOf(root) {
  const { resolveRepoRole } = require(path.join(root, "scripts", "mc", "repo-role.js"));
  return resolveRepoRole({ root });
}

const installRecord = (source) => ({
  $schema: "mc/framework-installed/v2",
  installedVersion: "2.1.0",
  source,
  target: "C:\\work\\product",
  assets: [],
});

test("a rewrite with a framework-manifest keeps the installer's source, and the product still resolves consumer", () => {
  for (const source of ["C:\\src\\mc", "https://example.invalid/mc.git"]) {
    const root = product({ record: installRecord(source) });
    try {
      const r = runSnapshot(root);
      assert.strictEqual(r.status, 0, r.stderr || r.stdout);
      const rec = readRecord(root);
      assert.strictEqual(rec.source, source);
      assert.strictEqual(rec.assets.length, 1, "the snapshot was rebuilt from the framework-manifest");
      assert.strictEqual(roleOf(root).role, "consumer");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a rewrite without a framework-manifest (re-hash in place) keeps the source too", () => {
  const root = product({ record: installRecord("C:\\src\\mc"), withFrameworkManifest: false });
  try {
    const r = runSnapshot(root);
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    assert.strictEqual(readRecord(root).source, "C:\\src\\mc");
    assert.strictEqual(roleOf(root).role, "consumer");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the framework repo's own snapshot records source self: no record yet, or a self record in any case", () => {
  for (const record of [undefined, installRecord("self"), installRecord(" SELF ")]) {
    const root = product({ record });
    try {
      const r = runSnapshot(root);
      assert.strictEqual(r.status, 0, r.stderr || r.stdout);
      assert.strictEqual(readRecord(root).source, "self");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
