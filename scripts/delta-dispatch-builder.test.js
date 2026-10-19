"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function tree({ registry }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "delta-builder-"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(__dirname, "delta-dispatch-builder.js"), path.join(root, "scripts", "delta-dispatch-builder.js"));
  const oneshot = path.join(root, ".claude", "agents", "president", "_system", "oneshot");
  fs.mkdirSync(oneshot, { recursive: true });
  fs.writeFileSync(path.join(oneshot, "store.json"), JSON.stringify({ features: { alpha: { files: ["src/a.ts"], status: "not_started" } } }));
  fs.writeFileSync(path.join(root, ".claude", "manifest.json"), JSON.stringify({ build: {}, fileOwnership: {} }));
  if (registry) {
    fs.mkdirSync(path.join(root, ".claude", "agents", "_org"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "agents", "_org", "role-registry.json"), JSON.stringify(registry));
  }
  return root;
}
const run = (root) => spawnSync(process.execPath, [path.join(root, "scripts", "delta-dispatch-builder.js"), "alpha"], { encoding: "utf8" });
const read = (root, f) => fs.readFileSync(path.join(root, ".claude", "runtime", "dispatch", f), "utf8");

test("the launch script carries the role registry's doer pin", () => {
  const root = tree({ registry: { model_policy: { doers: { provider: "claude", model: "claude-test-doer", effort: "high" } } } });
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(read(root, "alpha-launch.sh"), /dispatch-claude\.js" builder "[^"]+" --model claude-test-doer --effort high --worktree/);
});

test("with no readable registry the launch script passes no model or effort", () => {
  const root = tree({ registry: null });
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  const launch = read(root, "alpha-launch.sh");
  assert.doesNotMatch(launch, /--model|--effort/);
  assert.match(r.stdout, /"doerPin": "none \(no readable doer pin in the role registry\)"/);
});

test("the repo's own role registry yields its doer pin", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ".claude", "agents", "_org", "role-registry.json"), "utf8"));
  const doers = registry.model_policy.doers;
  const root = tree({ registry });
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(read(root, "alpha-launch.sh").includes(`--model ${doers.model} --effort ${doers.effort} --worktree`), read(root, "alpha-launch.sh"));
});

test("a fresh product with no retros gets a prompt that says so", () => {
  const root = tree({ registry: null });
  const r = run(root);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(read(root, "alpha-prompt.txt"), /^0\. \(no retro HYGIENE file yet\)$/m);
});
