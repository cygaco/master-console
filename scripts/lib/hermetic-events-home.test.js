"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..");
const HELPER = path.join(__dirname, "hermetic-events-home.js");
const PATHS_LIB = path.join(REAL_ROOT, "scripts", "hooks", "lib", "paths.js");
const LOGGER = path.join(REAL_ROOT, "scripts", "hooks", "lib", "logger.js");

function child(src) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["-e", src], { cwd: REAL_ROOT, env, encoding: "utf8" });
}

test("a pin placed after the paths lib loaded THROWS instead of silently doing nothing", () => {
  const r = child(`require(${JSON.stringify(PATHS_LIB)}); require(${JSON.stringify(HELPER)}).pin({ realRoot: ${JSON.stringify(REAL_ROOT)} });`);
  assert.notStrictEqual(r.status, 0, "a late pin must not succeed");
  assert.match(r.stderr, /already loaded/);
});

test("a fresh pin redirects the logger, is inherited by children, and is removed on exit", () => {
  const src = [
    `const h = require(${JSON.stringify(HELPER)}).pin({ realRoot: ${JSON.stringify(REAL_ROOT)}, prefix: "heh-test-" });`,
    `const { LOG_FILE } = require(${JSON.stringify(LOGGER)});`,
    `const kid = require("child_process").spawnSync(process.execPath, ["-e", "process.stdout.write(process.env.CLAUDE_PROJECT_DIR)"], { env: { ...process.env }, encoding: "utf8" });`,
    `process.stdout.write(JSON.stringify({ home: h.home, log: LOG_FILE, kid: kid.stdout, registry: require("fs").existsSync(require("path").join(h.home, ".claude", "agents", "_org", "sprint-hook-points.json")) }));`,
  ].join("\n");
  const r = child(src);
  assert.strictEqual(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  const { inside } = require(HELPER);
  assert.ok(inside(o.home, o.log), `logger escaped the temp project: ${o.log}`);
  assert.strictEqual(path.resolve(o.kid), path.resolve(o.home), "a child spawned with a copy of process.env must inherit the pin");
  assert.strictEqual(o.registry, true, "the registry copy must be present while the pin holds");
  assert.strictEqual(fs.existsSync(o.home), false, "the temp project must be removed on exit");
});

test("an unknown paths key is refused, not skipped", () => {
  const r = child(`require(${JSON.stringify(HELPER)}).pin({ realRoot: ${JSON.stringify(REAL_ROOT)}, keys: ["noSuchKey"] });`);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /paths\.noSuchKey is not in the paths view/);
});
