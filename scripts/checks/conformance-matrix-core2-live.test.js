#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { evaluateCore2Live, flipGate, run, CORE2_LIVE_MODULE_REL } = require("./conformance-matrix");

const ROOT = path.resolve(__dirname, "..", "..");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const NOT_FLIPPED_FX = { gate: "trust-boundary", bound_core: "CORE-2", report_only: true };
const FLIPPED_FX = { gate: "trust-boundary", bound_core: "CORE-2", report_only: false };
const OTHER_GATE_FX = { gate: "retention", bound_core: "CORE-4", report_only: false };

test("evaluateCore2Live: a NOT-flipped fixture is a no-op (ok:true, checked:0) — flipping is opt-in per fixture", () => {
  const res = evaluateCore2Live({ fixtures: [NOT_FLIPPED_FX], rootDir: ROOT });
  assert.deepStrictEqual(res, { ok: true, checked: 0, violations: [] });
});

test("evaluateCore2Live: a fixture from a DIFFERENT gate/core is never treated as a CORE-2 flip", () => {
  const res = evaluateCore2Live({ fixtures: [OTHER_GATE_FX], rootDir: ROOT });
  assert.deepStrictEqual(res, { ok: true, checked: 0, violations: [] });
});

test("evaluateCore2Live: a FLIPPED fixture with the REAL trusted-controller.js on disk -> ok:true", () => {
  const res = evaluateCore2Live({ fixtures: [FLIPPED_FX], rootDir: ROOT });
  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.checked, 1);
});

test("evaluateCore2Live: a FLIPPED fixture with a MISSING module -> MUST-BLOCK (module-missing violation)", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-core2-missing-"));
  try {
    const res = evaluateCore2Live({ fixtures: [FLIPPED_FX], rootDir: tmpRoot });
    assert.strictEqual(res.ok, false);
    assert.ok(res.violations.some((v) => v.includes("missing")), JSON.stringify(res));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("evaluateCore2Live: a FLIPPED fixture whose module exists but does NOT export integrate() -> MUST-BLOCK", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-core2-noexport-"));
  try {
    const modAbs = path.join(tmpRoot, CORE2_LIVE_MODULE_REL);
    fs.mkdirSync(path.dirname(modAbs), { recursive: true });
    fs.writeFileSync(modAbs, "module.exports = { notIntegrate: () => {} };\n");
    const res = evaluateCore2Live({ fixtures: [FLIPPED_FX], rootDir: tmpRoot });
    assert.strictEqual(res.ok, false);
    assert.ok(res.violations.some((v) => v.includes("integrate()")), JSON.stringify(res));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("evaluateCore2Live: a FLIPPED fixture whose module THROWS on require -> MUST-BLOCK (fail-closed, never a silent pass)", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-core2-throws-"));
  try {
    const modAbs = path.join(tmpRoot, CORE2_LIVE_MODULE_REL);
    fs.mkdirSync(path.dirname(modAbs), { recursive: true });
    fs.writeFileSync(modAbs, "throw new Error('simulated load failure');\n");
    const res = evaluateCore2Live({ fixtures: [FLIPPED_FX], rootDir: tmpRoot });
    assert.strictEqual(res.ok, false);
    assert.ok(res.violations.some((v) => v.includes("failed to load")), JSON.stringify(res));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("run(): the REAL kernel fixture corpus computes a core2Live result — flipped, checked, and ok (the live trusted-layer-sole-integrator.json fixture)", () => {
  const res = run();
  assert.ok(res.core2Live, "run() must attach a core2Live result");
  assert.strictEqual(res.core2Live.checked, 1, "exactly the one real CORE-2 trust-boundary fixture must be checked");
  assert.strictEqual(res.core2Live.ok, true, JSON.stringify(res.core2Live));
});

test("flipGate(): default (unscoped) behavior", () => {
  const gate = flipGate({ mismatches: [], requiredDownLanes: [], fixtureCount: 13 });
  assert.strictEqual(gate.authorized, true);
  assert.strictEqual(gate.scope, "full");
});

test("flipGate(): opts.scope='core2' DROPS requiredDownLanes from the blocker set", () => {
  const gate = flipGate(
    { mismatches: [], requiredDownLanes: [{ helm: "agy-antigravity", evidence_ref: "ED-999060" }], fixtureCount: 13 },
    { scope: "core2" },
  );
  assert.strictEqual(gate.authorized, true, JSON.stringify(gate.blockers));
  assert.strictEqual(gate.scope, "core2");
});

test("flipGate(): the UNSCOPED gate still blocks on requiredDownLanes (regression-proof — agy still refuses the FULL flip)", () => {
  const gate = flipGate({ mismatches: [], requiredDownLanes: [{ helm: "agy-antigravity", evidence_ref: "ED-999060" }], fixtureCount: 13 });
  assert.strictEqual(gate.authorized, false);
});

test("flipGate(): a core2Live FAILURE blocks BOTH scopes — never droppable, either mode", () => {
  const badCore2Live = { ok: false, checked: 1, violations: ["CORE-2 live adapter module missing: scripts/dispatch/trusted-controller.js"] };
  const full = flipGate({ mismatches: [], requiredDownLanes: [], fixtureCount: 13, core2Live: badCore2Live });
  const core2 = flipGate({ mismatches: [], requiredDownLanes: [], fixtureCount: 13, core2Live: badCore2Live }, { scope: "core2" });
  assert.strictEqual(full.authorized, false, "MUST-BLOCK (full scope): a core2Live failure must refuse the flip");
  assert.strictEqual(core2.authorized, false, "MUST-BLOCK (core2 scope): a core2Live failure must ALSO refuse the scoped flip — never droppable");
  assert.ok(full.blockers.some((b) => b.includes("CORE-2 live-adapter")));
  assert.ok(core2.blockers.some((b) => b.includes("CORE-2 live-adapter")));
});

test("flipGate(): over the REAL corpus, --scope=core2 is AUTHORIZED while the full scope stays refused by the unrelated agy lane", () => {
  const res = run();
  const scoped = flipGate(res, { scope: "core2" });
  const full = flipGate(res);
  assert.strictEqual(scoped.authorized, true, JSON.stringify(scoped.blockers));
  assert.strictEqual(full.authorized, false, "the full scope must remain refused by the required-down agy-antigravity lane");
  assert.ok(full.blockers.some((b) => /agy-antigravity/.test(b)));
});

if (failures.length) {
  process.stderr.write(`FAIL [conformance-matrix-core2-live.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [conformance-matrix-core2-live.test] ${passed} passed\n`);
