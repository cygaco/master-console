"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fl = require("./falsifier-liveness.js");

const FIXTURE = path.join(__dirname, "fixtures", "record-trust", "manifest.json");

test("parseTapCounts reads a well-formed node:test TAP summary", () => {
  const tap = [
    "TAP version 13",
    "1..13",
    "# tests 13",
    "# suites 0",
    "# pass 13",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 42",
  ].join("\n");
  assert.deepStrictEqual(fl.parseTapCounts(tap), { tests: 13, pass: 13, fail: 0, skipped: 0 });
});

test("parseTapCounts returns null when a required count line is absent (fail-closed)", () => {
  assert.strictEqual(fl.parseTapCounts("TAP version 13\n1..0\n"), null);
  assert.strictEqual(fl.parseTapCounts(""), null);
  assert.strictEqual(fl.parseTapCounts(undefined), null);
});

test("evaluateFileCounts BLOCKS a file that ran ZERO tests (the aggregate-masking hole)", () => {
  const v = fl.evaluateFileCounts("x/f.js", { tests: 0, pass: 0, fail: 0, skipped: 0 });
  assert.ok(v.some((s) => /ZERO tests executed/.test(s)), JSON.stringify(v));
});

test("evaluateFileCounts BLOCKS a file with a skipped falsifier", () => {
  const v = fl.evaluateFileCounts("x/f.js", { tests: 1, pass: 0, fail: 0, skipped: 1 });
  assert.ok(v.some((s) => /skipped=1/.test(s)));
});

test("evaluateFileCounts BLOCKS a file with a failed test", () => {
  const v = fl.evaluateFileCounts("x/f.js", { tests: 2, pass: 1, fail: 1, skipped: 0 });
  assert.ok(v.some((s) => /fail=1/.test(s)));
});

test("evaluateFileCounts is fail-closed on null counts", () => {
  const v = fl.evaluateFileCounts("x/f.js", null);
  assert.ok(v.some((s) => /un-parseable/.test(s)));
});

test("evaluateFileCounts PASSES a file that executed cleanly (>=1 test, all pass, 0 skipped)", () => {
  const v = fl.evaluateFileCounts("x/f.js", { tests: 2, pass: 2, fail: 0, skipped: 0 });
  assert.deepStrictEqual(v, []);
});

test("collectFixtures derives falsifiers + positive companions from manifest surfaces", () => {
  const manifest = {
    surfaces: [
      { id: "a", falsifier_fixtures: ["x/f1.js", "x/f2.js"] },
      { id: "b", falsifier_fixtures: ["x/f2.js"], positive_companions: ["x/pc.js"] },
    ],
  };
  const { falsifiers, companions } = fl.collectFixtures(manifest);
  assert.deepStrictEqual(falsifiers, ["x/f1.js", "x/f2.js"], "de-duplicated, stable order");
  assert.deepStrictEqual(companions, ["x/pc.js"]);
});

const okBuilt = () => ({ ok: true, detail: "record-trust-gate: PASS (built)" });
const fileTap = (o) => `TAP version 13\n# tests ${o.tests}\n# pass ${o.pass}\n# fail ${o.fail}\n# skipped ${o.skipped}\n`;
const liveFile = () => ({ stdout: fileTap({ tests: 1, pass: 1, fail: 0, skipped: 0 }) });

test("evaluate PASSES when every fixture file executed per-file and --built is green", () => {
  const res = fl.evaluate(FIXTURE, { runFile: liveFile, runBuilt: okBuilt });
  assert.strictEqual(res.ok, true, JSON.stringify(res.violations));
  assert.strictEqual(res.code, 0);
});

test("evaluate BLOCKS when ONE fixture file ran ZERO tests — the aggregate-masking hole", () => {
  let n = 0;
  const runFile = () =>
    ({ stdout: fileTap(++n === 1 ? { tests: 0, pass: 0, fail: 0, skipped: 0 } : { tests: 2, pass: 2, fail: 0, skipped: 0 }) });
  const res = fl.evaluate(FIXTURE, { runFile, runBuilt: okBuilt });
  assert.strictEqual(res.ok, false);
  assert.ok(res.violations.some((v) => /ZERO tests executed/.test(v)), JSON.stringify(res.violations));
});

test("evaluate BLOCKS when a fixture file has a skip even though --built is green", () => {
  let n = 0;
  const runFile = () =>
    ({ stdout: fileTap(++n === 2 ? { tests: 1, pass: 0, fail: 0, skipped: 1 } : { tests: 1, pass: 1, fail: 0, skipped: 0 }) });
  const res = fl.evaluate(FIXTURE, { runFile, runBuilt: okBuilt });
  assert.strictEqual(res.ok, false);
  assert.ok(res.violations.some((v) => /skipped=1/.test(v)));
});

test("evaluate BLOCKS when --built is red even though every file is live", () => {
  const res = fl.evaluate(FIXTURE, {
    runFile: liveFile,
    runBuilt: () => ({ ok: false, detail: "record-trust-gate: BLOCK — choke_point module missing" }),
  });
  assert.strictEqual(res.ok, false);
  assert.ok(res.violations.some((v) => /--built/.test(v)));
});

test("evaluate is fail-closed (code 2) on an unreadable manifest", () => {
  const res = fl.evaluate(FIXTURE + ".nope", { runFile: liveFile, runBuilt: okBuilt });
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.ok, false);
});
