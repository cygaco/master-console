"use strict";
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
require("../lib/hermetic-events-home").pin({ realRoot: path.resolve(__dirname, "..", ".."), prefix: "ert-smokeexec-events-" });
const { test } = require("node:test");
const assert = require("node:assert");
const rt = require("./epsilon-runtime");
const runTests = require("../checks/run-tests");

const COMP = { unit_types: ["backend"], max_risk: "low", domains: [] };
const SEAMS = { registry: { rows: [] }, roles: {} };
const decision = (smoke) => ({
  package: "combined-focused",
  focused: { files: [], tests: [] }, touchpoint: { files: [] },
  trailer: { change: "bugfix", blast: "minor" }, security: { hit: false, by: [] },
  stages: [{ stage: 2, name: "smoke", kind: "tests", files: smoke, stop_on_fail: true }],
});
const SMOKE = ["scripts/a.test.js", "scripts/b.test.js"];
const emptyQ = () => ({ entries: [], floor: 1, base: null });

function conduct(files, extra = {}) {
  let spawned = 0;
  const run = () => { spawned++; return { status: 0, stdout: "ok" }; };
  const out = rt.conductGauntletStep(COMP, "SP-SMOKEEXEC", decision(files), { ...SEAMS, run, ...extra });
  return { out, spawned, stage: out.stage_results.find((s) => s.name === "smoke") };
}

test("all requested smoke files discoverable: executed_files equals the request and the stage passes", () => {
  const { stage, spawned } = conduct(SMOKE, { discoverTestFiles: () => [...SMOKE, "scripts/other.test.js"], loadQuarantine: emptyQ });
  assert.strictEqual(stage.ok, true);
  assert.deepStrictEqual(stage.executed_files, SMOKE);
  assert.strictEqual(stage.golden_executed, 2);
  assert.strictEqual(spawned, 1);
});

test("one undiscoverable requested file fails smoke_file_not_executable and names it; nothing spawned", () => {
  const { stage, spawned } = conduct(SMOKE, { discoverTestFiles: () => [SMOKE[0]], loadQuarantine: emptyQ });
  assert.strictEqual(stage.ok, false);
  assert.strictEqual(stage.error, "smoke_file_not_executable");
  assert.deepStrictEqual(stage.not_executable, [SMOKE[1]]);
  assert.strictEqual(stage.golden_executed, 1);
  assert.strictEqual(spawned, 0);
});

test("one quarantined requested file fails smoke_file_not_executable", () => {
  const { stage } = conduct(SMOKE, { discoverTestFiles: () => SMOKE, loadQuarantine: () => ({ entries: [{ file: SMOKE[0] }], floor: 1, base: null }) });
  assert.strictEqual(stage.ok, false);
  assert.strictEqual(stage.error, "smoke_file_not_executable");
  assert.deepStrictEqual(stage.not_executable, [SMOKE[0]]);
});

test("a corrupt quarantine register fails closed; an absent one (ENOENT) is empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ert-smokeexec-"));
  try {
    const bad = path.join(dir, "quarantine.json");
    fs.writeFileSync(bad, "{ not json");
    const corrupt = conduct(SMOKE, { discoverTestFiles: () => SMOKE, loadQuarantine: (_f, root) => runTests.loadQuarantine(bad, root) });
    assert.strictEqual(corrupt.stage.ok, false);
    assert.strictEqual(corrupt.stage.error, "smoke_file_not_executable");
    assert.strictEqual(corrupt.spawned, 0);
    const absent = conduct(SMOKE, { discoverTestFiles: () => SMOKE, loadQuarantine: (_f, root) => runTests.loadQuarantine(path.join(dir, "nope.json"), root) });
    assert.strictEqual(absent.stage.ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the failing smoke stage result carries output that gauntletConductProblems surfaces in the halt detail", () => {
  const { stage } = conduct(SMOKE, { discoverTestFiles: () => [SMOKE[0]], loadQuarantine: emptyQ });
  assert.strictEqual(stage.exit_code, "n/a");
  const { gauntletConductProblems } = require("./full");
  const { problems } = gauntletConductProblems({ stage_results: [stage], halted_at_stage: 2 });
  const p = problems.find((x) => x.kind === "gauntlet_stage_failed");
  assert.ok(p, "gauntlet_stage_failed problem present");
  assert.match(p.detail, /smoke_file_not_executable/);
  assert.ok(p.detail.includes(SMOKE[1]), "detail names the non-executable file");
});
