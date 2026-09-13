#!/usr/bin/env node
"use strict";

/**
 * shape-door.test.js — E-DISPATCH-SHAPE-001 W2-core (SP-20260616-001).
 *
 * Unit gauntlet for dispatch-shape.js#shapeDoor — the ONE shared per-wrapper enforce gate.
 * Planted BOTH modes (β#3 + DoE): report=>advisory+proceed, enforce=>refuse(exit2 at caller),
 * kill-switch overrides enforce, sanctioned lane proceeds+suppressed, resolver-throw=>fail-open,
 * legacy MC_DISPATCH_CONTRACT_ENFORCE back-compat, report-only-pin never refuses, and the
 * conservative property (only HIGH severity refuses; MEDIUM stays advisory even under enforce).
 *
 *   node tests/regression/SP-20260616-001/shape-door.test.js
 */

const assert = require("assert");
const path = require("path");
const { shapeDoor } = require(path.resolve(__dirname, "../../../scripts/dispatch/dispatch-shape.js"));

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; fails.push(`${name}: ${e.message}`); console.log(`  FAIL ${name} — ${e.message}`); }
}

// HIGH-severity mismatch: a skill resolves to inline/unproven, dispatched as a subprocess.
const hiUnit = { kind: "skill", id: "scan:full" };
// MEDIUM mismatch: a build-chain builder pushed through the cross-provider path (wrong wrapper, not dangerous).
const medUnit = { kind: "agent", id: "backend-builder" };

test("report-mode-advisory-proceeds", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, {}, {});
  assert.strictEqual(r.action, "proceed");
  assert.strictEqual(r.mode, "report");
  assert.ok(r.mismatch && r.mismatch.mismatch, "the mismatch is surfaced as an advisory");
});

test("enforce-high-severity-refuses", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "enforce" }, {});
  assert.strictEqual(r.action, "refuse");
  assert.strictEqual(r.mode, "enforce");
  assert.strictEqual(r.severity, "high");
  assert.ok(/shape-door REFUSE/.test(r.reason), "carries a named reason");
});

test("kill-switch-overrides-enforce", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "enforce", MC_DISABLE_SHAPE_DOOR: "1" }, {});
  assert.strictEqual(r.action, "proceed");
  assert.strictEqual(r.mode, "report", "kill-switch forces report even under enforce");
});

test("sanctioned-lane-proceeds-under-enforce", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "enforce" }, { sanctioned: true });
  assert.strictEqual(r.action, "proceed");
  assert.strictEqual(r.suppressed, true, "sanctioned lane suppresses the advisory (FIX-A3 preserved)");
});

test("resolver-error-fail-open", () => {
  // A unit whose .kind getter throws propagates out of resolveShape -> shapeMismatch -> the door's catch.
  const boom = { get kind() { throw new Error("boom"); } };
  let threw = false, r;
  try { r = shapeDoor("subprocess-claude", boom, { MC_SHAPE_DOOR: "enforce" }, {}); } catch { threw = true; }
  assert.strictEqual(threw, false, "shapeDoor must NEVER throw — fail-OPEN");
  assert.strictEqual(r.action, "proceed");
  assert.ok(/resolver-threw-fail-open/.test(r.reason), "names the fail-open path");
});

test("enforce-medium-stays-advisory", () => {
  // Conservative: only HIGH severity refuses. A wrong-wrapper MEDIUM mismatch is advisory even under enforce.
  const r = shapeDoor("subprocess-cross-provider", medUnit, { MC_SHAPE_DOOR: "enforce" }, {});
  assert.strictEqual(r.action, "proceed");
  assert.strictEqual(r.severity, "medium");
});

test("legacy-MC_DISPATCH_CONTRACT_ENFORCE-back-compat", () => {
  const legacy = shapeDoor("subprocess-claude", hiUnit, { MC_DISPATCH_CONTRACT_ENFORCE: "block" }, {});
  const modern = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "enforce" }, {});
  assert.strictEqual(legacy.action, "refuse", "old var still enforces the shape gate (no silent regression)");
  assert.strictEqual(legacy.action, modern.action, "old var is identical to the new var for the shape gate");
});

test("report-only-pin-never-refuses", () => {
  // dispatch-skill pins this: a high-severity skill mismatch must NOT refuse even under enforce.
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "enforce" }, { reportOnlyPin: true });
  assert.strictEqual(r.action, "proceed");
  assert.strictEqual(r.mode, "report");
});

test("never-throws-on-adversarial-input", () => {
  for (const u of [null, undefined, 7, "x", {}, { kind: "agent" }, { kind: "skill", id: 123 }]) {
    const r = shapeDoor("subprocess-claude", u, {}, {});
    assert.strictEqual(r.action, "proceed", "adversarial input must never block a dispatch");
  }
});

// ── W2/N2 per-wrapper ENFORCE ramp (opts.enforceDefault) ─────────────────────
// A wrapper opts into enforce as its default so wrappers ramp ONE AT A TIME, with the global
// env retaining both a fleet-wide force-on and a fleet-wide force-off (kill) escape.
test("enforceDefault-enforces-when-env-unset", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, {}, { enforceDefault: true });
  assert.strictEqual(r.mode, "enforce", "enforceDefault enforces when the global env is unset");
  assert.strictEqual(r.action, "refuse");
  assert.strictEqual(r.severity, "high");
});

test("enforceDefault-does-not-false-refuse-a-matching-dispatch", () => {
  // Safe-by-construction: a CORRECT shape never refuses even with the per-wrapper flip on.
  const r = shapeDoor("inline", { kind: "skill", id: "scan:full" }, {}, { enforceDefault: true });
  assert.strictEqual(r.action, "proceed", "a matching shape proceeds under the per-wrapper flip");
});

test("global-report-overrides-the-per-wrapper-flip", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "report" }, { enforceDefault: true });
  assert.strictEqual(r.mode, "report");
  assert.strictEqual(r.action, "proceed", "the global report escape disables the flip fleet-wide");
});

test("kill-switch-beats-the-per-wrapper-flip", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_DISABLE_SHAPE_DOOR: "1" }, { enforceDefault: true });
  assert.strictEqual(r.mode, "report", "the kill-switch beats enforceDefault");
  assert.strictEqual(r.action, "proceed");
});

test("no-enforceDefault-is-backward-compatible-report", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, {}, {});
  assert.strictEqual(r.mode, "report", "a wrapper that does not opt in behaves exactly as before");
  assert.strictEqual(r.action, "proceed");
});

// ── W2 GAUNTLET FIXES (GPT-5.5 backend-reviewer found these — regression-locked) ──
// HIGH-2: an explicit MC_SHAPE_DOOR=report is the operator's fleet kill and MUST beat the
// legacy MC_DISPATCH_CONTRACT_ENFORCE=block alias (a stale legacy env must not override it).
test("explicit-report-beats-legacy-block-env", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "report", MC_DISPATCH_CONTRACT_ENFORCE: "block" }, {});
  assert.strictEqual(r.mode, "report", "explicit report kill must beat the legacy block alias");
  assert.strictEqual(r.action, "proceed");
});

// MED-1: the per-wrapper kill is implemented as reportOnlyPin — it must force report even under a
// global enforce (a true per-wrapper kill, not a mere enforceDefault:false).
test("reportOnlyPin-true-kill-beats-global-enforce", () => {
  const r = shapeDoor("subprocess-claude", hiUnit, { MC_SHAPE_DOOR: "enforce" }, { reportOnlyPin: true });
  assert.strictEqual(r.mode, "report", "the per-wrapper reportOnlyPin kill beats a global enforce");
  assert.strictEqual(r.action, "proceed");
});

// HIGH-1: a FAIL-OPEN resolution (the dispatch-contract is unavailable/unreadable) must NOT refuse
// under enforce — a transient contract-read failure must never become a self-inflicted dispatch
// outage. Poison the contract require so resolveAgent takes the fail-open branch, then assert the
// ENFORCE door PROCEEDS. (Restores the real modules in finally so later tests are unaffected.)
test("fail-open-contract-unavailable-proceeds-under-enforce", () => {
  const contractPath = require.resolve(path.resolve(__dirname, "../../../scripts/dispatch/dispatch-contract.js"));
  const shapePath = require.resolve(path.resolve(__dirname, "../../../scripts/dispatch/dispatch-shape.js"));
  const savedContract = require.cache[contractPath];
  const savedShape = require.cache[shapePath];
  try {
    // Exports with NO contractForRole/skillExecution → resolveAgent hits the fail-open branch.
    require.cache[contractPath] = { id: contractPath, filename: contractPath, loaded: true, exports: {} };
    delete require.cache[shapePath]; // re-bind a fresh dispatch-shape to the poisoned contract
    const { shapeDoor: poisonedDoor } = require(shapePath);
    const r = poisonedDoor("subprocess-claude", { kind: "agent", id: "backend-builder" }, { MC_SHAPE_DOOR: "enforce" }, {});
    assert.strictEqual(r.action, "proceed", "fail-open (contract-unavailable) must NOT refuse under enforce");
    assert.notStrictEqual(r.mismatch && r.mismatch.severity, "high", "a fail-open mismatch must not be high-severity");
  } finally {
    if (savedContract) require.cache[contractPath] = savedContract; else delete require.cache[contractPath];
    delete require.cache[shapePath];
    if (savedShape) require.cache[shapePath] = savedShape;
  }
});

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — shape-door: ${passed} passed, ${failed} failed`);
if (failed) { console.error("\n" + fails.join("\n")); process.exit(1); }
