#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const events = fs.readFileSync(
  path.join(REPO_ROOT, "_mc/templates/app-scaffold/src/lib/telemetry/events.ts.tmpl"),
  "utf8",
);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("thin-core-loop-fails-closed", () => {
  assert.match(events, /function\s+deriveActivationDefinition\b/);
  assert.match(events, /if \(!action \|\| !subject \|\| !source\)/);
  assert.match(events, /requires core-loop action, subject, and source/);
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

console.log(`activation-definition: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
