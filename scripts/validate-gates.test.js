"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function tree(manifest, store) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "validate-gates-"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(__dirname, "validate-gates.js"), path.join(root, "scripts", "validate-gates.js"));
  fs.mkdirSync(path.join(root, ".claude", "agents", "president", "_system", "oneshot"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "manifest.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(root, ".claude", "agents", "president", "_system", "oneshot", "store.json"), JSON.stringify(store));
  return root;
}
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "validate-gates.js"), ...args], { encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
};

const MANIFEST = { build: { features: [{ id: "foundation", phase: 0 }, { id: "alpha", phase: 1 }, { id: "beta", phase: 1.5 }, { id: "gamma", phase: 2 }] } };
const STORE = {
  features: {
    "foundation-types": { status: "done" },
    alpha: { status: "built" },
    beta: { status: "done" },
    gamma: { status: "not_started" },
  },
};

test("phases come from the manifest and the store's foundation-* units", () => {
  const root = tree(MANIFEST, STORE);
  const r = run(root);
  for (const want of ["--- Phase 0 ---", "--- Phase 1 ---", "--- Phase 1.5 ---", "--- Phase 2 ---", "foundation-types", "alpha", "beta", "gamma"]) {
    assert.ok(r.out.includes(want), `missing ${want}:\n${r.out}`);
  }
  assert.ok(!/\s{2}foundation \(/.test(r.out), `the manifest's unified foundation must not be a phase-0 entry:\n${r.out}`);
});

test("--phase reads one manifest phase and names its blocker", () => {
  const r = run(tree(MANIFEST, STORE), "--phase", "1");
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.out.includes("missing: evalResult"), r.out);
});

test("--advance blocks on an incomplete earlier phase", () => {
  const r = run(tree(MANIFEST, STORE), "--advance", "2");
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.out.includes('"feature": "alpha"'), r.out);
  assert.ok(!r.out.includes('"feature": "beta"'), r.out);
});

test("a phase the manifest does not define is an error", () => {
  const r = run(tree(MANIFEST, STORE), "--phase", "7");
  assert.strictEqual(r.status, 1, r.out);
  assert.ok(r.out.includes("Unknown phase 7"), r.out);
});

test("an empty manifest has no phases beyond the store's foundation units", () => {
  const r = run(tree({ build: { features: [] } }, { features: {} }));
  assert.strictEqual(r.status, 0, r.out);
  assert.ok(!r.out.includes("--- Phase"), r.out);
});
