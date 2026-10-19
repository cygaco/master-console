"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPTS = [
  "delta-build-fix-brief.js",
  "delta-build-reviewer-prompt.js",
  "delta-dispatch-builder.js",
  "delta-heartbeat.js",
  "delta-mark-built.js",
  "oneshot-store-reset.js",
  "regen-maps.js",
  "validate-gates.js",
];

test("no oneshot script builds a president/.system/ path from literal segments", () => {
  const hits = SCRIPTS.filter((f) => /"president",\s*"\.system"/.test(fs.readFileSync(path.join(__dirname, f), "utf8")));
  assert.deepStrictEqual(hits, []);
});

test("delta-heartbeat writes the store at the registry's default path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oneshot-store-"));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.copyFileSync(path.join(__dirname, "delta-heartbeat.js"), path.join(root, "scripts", "delta-heartbeat.js"));
  const store = path.join(root, ".claude", "agents", "president", "_system", "oneshot", "store.json");
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.writeFileSync(store, JSON.stringify({ features: {} }));
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "delta-heartbeat.js"), '{"phase":1}'], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  const hb = JSON.parse(fs.readFileSync(store, "utf8")).heartbeat;
  assert.strictEqual(hb.phase, 1);
  assert.strictEqual(hb.agent, "delta");
});
