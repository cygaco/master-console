"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const CHECK = path.join("scripts", "checks", "config-path-resolves.js");
let canned = null;
const realSpawnSync = cp.spawnSync;
cp.spawnSync = function routed(cmd, args, opts) {
  if (canned && Array.isArray(args) && typeof args[0] === "string" && args[0].endsWith(CHECK)) return canned;
  return realSpawnSync.apply(this, arguments);
};
const { run } = require("./release-gates.js");
const GATE = "config_paths_resolve";
const ALL_GATES = [...fs.readFileSync(path.join(__dirname, "release-gates.js"), "utf8").matchAll(/\bgate\("([a-z0-9_]+)"/g)].map((m) => m[1]);
const gateWith = (status, stdout) => {
  canned = { status, stdout, stderr: "" };
  try {
    return run({ skip: ALL_GATES.filter((g) => g !== GATE) }).results.find((r) => r.name === GATE);
  } finally {
    canned = null;
  }
};

test("the gate exists", () => assert.ok(ALL_GATES.includes(GATE)));

test("GREEN when the check exits 0", () => {
  assert.strictEqual(gateWith(0, "config-path-resolves: 12 entries\n  result: OK (exit 0)\n").severity, "green");
});

test("RED when the check finds a dangling entry, naming it", () => {
  const g = gateWith(1, "  DANGLING  scripts/checks/x.allowlist.json: file 'GONE.md' does not resolve in this tree\n  result: FAIL (exit 1)\n");
  assert.strictEqual(g.severity, "red");
  assert.ok(g.details.some((d) => d.includes("GONE.md")), JSON.stringify(g.details));
});

test("RED on a runner error (exit 2), never a pass", () => {
  assert.strictEqual(gateWith(2, "").severity, "red");
});

test("RED when a script requires a script the tree does not carry, naming it", () => {
  const g = gateWith(1, "  UNRESOLVED-REQUIRE  scripts/a.js -> ./gone is not in this tree\n  result: FAIL (exit 1)\n");
  assert.strictEqual(g.severity, "red");
  assert.ok(g.details.some((d) => d.includes("./gone")), JSON.stringify(g.details));
});
