#!/usr/bin/env node
"use strict";
/**
 * record-trust-exit-runs.test.js — S-OS-06 security gauntlet F4 (MEDIUM, ED-434).
 *
 * Guarantees `npm test` exercises the design->build EXIT gate itself (and so does every CI job that runs
 * `npm test`): spawns `node scripts/checks/record-trust-exit.js` from the repo root and requires a REAL exit
 * code 0 with the enforcer's own all-items-PASS summary line. A spawn error, a timeout or a kill is never a
 * pass — only an observed exit code is an observation.
 *
 * The enforcer's item 1 discovers falsify-*.test.js only, so this file is never re-entered by it.
 *
 *   node --test tests/regression/S-OS-06/record-trust-exit-runs.test.js
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const ENFORCER = path.join(REPO_ROOT, "scripts", "checks", "record-trust-exit.js");
const ENFORCER_TIMEOUT_MS = 20 * 60 * 1000;

test("record-trust-exit runs under npm test: a real exit code 0 on the clean tree", { timeout: ENFORCER_TIMEOUT_MS + 60 * 1000 }, () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // the child must not report into this test runner
  const r = spawnSync(process.execPath, [ENFORCER], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    timeout: ENFORCER_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const out = `${r.stdout || ""}\n${r.stderr || ""}`;
  assert.strictEqual(r.error, undefined, `record-trust-exit did not run to an exit code (spawn error / timeout): ${r.error && r.error.message}\n${out}`);
  assert.notStrictEqual(r.status, null, `record-trust-exit was killed by ${r.signal} — not an observed exit code\n${out}`);
  assert.strictEqual(r.status, 0, `record-trust-exit exited ${r.status}\n${out}`);
  const m = String(r.stdout).match(/^record-trust-exit: PASS \((\d+)\/(\d+) items pass\)\s*$/m);
  assert.ok(m, `exit 0 without the enforcer's PASS summary line is not an observation of a green gate\n${out}`);
  assert.ok(Number(m[2]) > 0 && m[1] === m[2], `summary does not report every item passing: ${m[0]}`);
});
