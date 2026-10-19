#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluateSpec } = require("./taste-gate-presence");

let passed = 0;
const failures = [];
function test(name, fn) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } }

const COMPLETE = [
  "## The taste gate — a SEVENTH judgment (vibe verdict)",
  'Add `"taste_gate": { "pass": true, "note": "" }` to the output schema.',
  "Treat `taste_gate.pass:false` as a `verdict:\"FAIL\"` trigger — a binding gate failure.",
].join("\n");

test("complete taste-gate contract → no missing pieces", () => {
  assert.deepStrictEqual(evaluateSpec(COMPLETE), []);
});
test("planted: drop the taste-gate SECTION → flagged", () => {
  const t = COMPLETE.replace(/## The taste gate.*/i, "## Some other section");
  const m = evaluateSpec(t);
  assert.ok(m.some((x) => /taste-gate section/.test(x)), m.join(" | "));
});
test("planted: drop the SCHEMA field → flagged", () => {
  const t = COMPLETE.replace(/"taste_gate"\s*:\s*\{\s*"pass"\s*:/, '"other": {');
  const m = evaluateSpec(t);
  assert.ok(m.some((x) => /output-schema field/.test(x)), m.join(" | "));
});
test("planted: drop the BINDING rule → flagged", () => {
  const t = "## The taste gate\n\"taste_gate\": { \"pass\": true }\n(no binding language here)";
  const m = evaluateSpec(t);
  assert.ok(m.some((x) => /BINDING rule/.test(x)), m.join(" | "));
});

test("live specs → real enforcer exits 0 + OK", () => {
  const out = execFileSync("node", [path.join(__dirname, "taste-gate-presence.js")], { encoding: "utf8" });
  assert.ok(/OK\s+\[taste-gate-presence\]/.test(out), `expected OK on live specs, got: ${out}`);
});

if (failures.length) {
  process.stderr.write(`FAIL [taste-gate-presence.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [taste-gate-presence.test] ${passed} passed\n`);
