#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  CANONICAL_STAGES,
  parseConstStringArray,
} = require("../../../scripts/checks/scaffold-coverage-scan");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const telemetryDir = path.join(REPO_ROOT, "_mc/templates/app-scaffold/src/lib/telemetry");
const events = fs.readFileSync(path.join(telemetryDir, "events.ts.tmpl"), "utf8");
const chain = fs.readFileSync(path.join(telemetryDir, "chain.ts.tmpl"), "utf8");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("stage-vocabulary-is-fixed", () => {
  assert.deepStrictEqual(parseConstStringArray(events, "SUPPLY_CHAIN_STAGES"), CANONICAL_STAGES);
});

test("sent-but-never-delivered-is-broken", () => {
  assert.match(chain, /for \(const stage of SUPPLY_CHAIN_STAGES\)/);
  assert.match(chain, /brokenAtStage:\s*stage/);
  assert.match(chain, /telemetryFailure:\s*"broken_chain"/);
  assert.match(chain, /failureEvent/);
});

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`PASS ${t.name}`);
    pass++;
  } catch (err) {
    console.error(`FAIL ${t.name}: ${err.stack || err.message}`);
    fail++;
  }
}

console.log(`telemetry-chain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
