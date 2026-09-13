#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const telemetryDir = path.join(REPO_ROOT, "_mc/templates/app-scaffold/src/lib/telemetry");

const track = fs.readFileSync(path.join(telemetryDir, "track.ts.tmpl"), "utf8");
const sink = fs.readFileSync(path.join(telemetryDir, "sink.ts.tmpl"), "utf8");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("track-noop-sink-does-not-throw", () => {
  assert.match(sink, /export const noopTelemetrySink/);
  assert.match(sink, /return noopTelemetrySink/);
  assert.match(sink, /!posthogKey/);
});

test("throwing-sink-is-swallowed", () => {
  assert.match(track, /try\s*\{/);
  assert.match(track, /\}\s*catch\s*\{/);
  assert.match(track, /result\.catch\(\(\) => undefined\)/);
});

test("single-sink-resolver-boundary", () => {
  assert.strictEqual((sink.match(/function\s+resolveTelemetrySink\b/g) || []).length, 1);
  assert.strictEqual((track.match(/resolveTelemetrySink\(\)/g) || []).length, 1);
  assert.doesNotMatch(track, /posthog|gtag|plausible|mixpanel|\.capture\s*\(/i);
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

console.log(`telemetry-seam: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
