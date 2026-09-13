#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * dispatch-timeout-sanity.test.js — planted-violation + fail-closed tests (T-20260610-304).
 *
 * Verifies:
 *   1. foregroundAwareTimeout helper behavior (clamp, background signal, fail-closed detection).
 *   2. All WRAPPER_DEFAULTS foreground bounds are ≤ FOREGROUND_CEILING_MS.
 *   3. runChecks() is GREEN on real WRAPPER_DEFAULTS.
 *   4. A PLANTED wrapper config with foreground bound > 540s → red (exit 1).
 *   5. runChecks fail-closes on empty wrapperDefaults and on null/invalid defaultMs.
 *   6. runChecks is GREEN standalone (integration: node dispatch-timeout-sanity.js exits 0).
 */

const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");

const { foregroundAwareTimeout, FOREGROUND_CEILING_MS, WRAPPER_DEFAULTS } =
  require("../dispatch/timeout-policy");
const { runChecks } = require("./dispatch-timeout-sanity");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL ${name}: ${e && e.message ? e.message : e}`);
    failed++;
  }
}

// ── 1. Helper: clamp behavior ────────────────────────────────────────────────
console.log("\n(1) foregroundAwareTimeout — clamp and background-signal logic:");

test("foregroundAwareTimeout(20min, {}) clamps to FOREGROUND_CEILING_MS", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = foregroundAwareTimeout(20 * 60 * 1000, {});
    assert.strictEqual(result, FOREGROUND_CEILING_MS,
      `Expected ${FOREGROUND_CEILING_MS}ms, got ${result}ms`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("foregroundAwareTimeout(15min, {}) clamps to FOREGROUND_CEILING_MS", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = foregroundAwareTimeout(15 * 60 * 1000, {});
    assert.strictEqual(result, FOREGROUND_CEILING_MS,
      `Expected ${FOREGROUND_CEILING_MS}ms, got ${result}ms`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("foregroundAwareTimeout(20min, { background: true }) returns full 20min", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = foregroundAwareTimeout(20 * 60 * 1000, { background: true });
    assert.strictEqual(result, 20 * 60 * 1000,
      `Expected ${20 * 60 * 1000}ms (full), got ${result}ms`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("MC_DISPATCH_BACKGROUND=1 env signal → full bound (background path)", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.setEnv("DISPATCH_BACKGROUND", "1");
  try {
    const result = foregroundAwareTimeout(20 * 60 * 1000, {});
    assert.strictEqual(result, 20 * 60 * 1000,
      `Expected ${20 * 60 * 1000}ms (full), got ${result}ms`);
  } finally {
    if (orig === undefined) mcEnv.unsetEnv("DISPATCH_BACKGROUND");
    else mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

// ── 2. Fail-closed detection: no signal ⇒ clamp ──────────────────────────────
console.log("\n(2) Fail-closed detection — absence of signal → clamp:");

test("no background signal (env absent, no opts.background) → clamps to ceiling", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = foregroundAwareTimeout(20 * 60 * 1000, {});
    assert(result <= FOREGROUND_CEILING_MS,
      `Expected ≤ ${FOREGROUND_CEILING_MS}ms (fail-closed clamp), got ${result}ms`);
    assert.strictEqual(result, FOREGROUND_CEILING_MS,
      `Expected exactly ${FOREGROUND_CEILING_MS}ms when foreground, got ${result}ms`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("opts.background=false (explicit non-background) → clamps to ceiling", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = foregroundAwareTimeout(20 * 60 * 1000, { background: false });
    assert.strictEqual(result, FOREGROUND_CEILING_MS,
      `Expected ${FOREGROUND_CEILING_MS}ms (clamped), got ${result}ms`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("small default (1000ms) → returned unchanged (already under ceiling)", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = foregroundAwareTimeout(1000, {});
    assert.strictEqual(result, 1000,
      `Expected 1000ms (already ≤ ceiling), got ${result}ms`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

// ── 3. WRAPPER_DEFAULTS all clamp correctly ────────────────────────────────
console.log("\n(3) All WRAPPER_DEFAULTS foreground bounds ≤ FOREGROUND_CEILING_MS:");

test("WRAPPER_DEFAULTS is non-empty (sanity: defaults are defined)", () => {
  const keys = Object.keys(WRAPPER_DEFAULTS);
  assert(keys.length >= 4, `Expected ≥4 wrapper entries, got ${keys.length}: ${keys.join(", ")}`);
});

test("all WRAPPER_DEFAULTS foreground effective bounds ≤ ceiling", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    for (const [wrapper, defaultMs] of Object.entries(WRAPPER_DEFAULTS)) {
      const effective = foregroundAwareTimeout(defaultMs, {});
      assert(effective <= FOREGROUND_CEILING_MS,
        `${wrapper}: foreground effective ${effective}ms > ceiling ${FOREGROUND_CEILING_MS}ms`);
    }
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

// ── 4. runChecks() — GREEN on real defaults ─────────────────────────────────
console.log("\n(4) runChecks() GREEN on real WRAPPER_DEFAULTS:");

test("runChecks() returns ok:true on real WRAPPER_DEFAULTS", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    const result = runChecks();
    assert.strictEqual(result.ok, true,
      `Expected ok:true but got ok:false. Checks: ${JSON.stringify(result.checks)}`);
    assert(result.checks.length >= 4,
      `Expected ≥4 checks, got ${result.checks.length}`);
    assert(result.checks.every(c => c.status === "green"),
      `Not all checks are green: ${JSON.stringify(result.checks.filter(c => c.status !== "green"))}`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

// ── 5. PLANTED violation — >540s foreground bound → red ─────────────────────
// Design note: foregroundAwareTimeout always CLAMPS when no background signal is
// present. So a large default (30min) with no env signal still yields effectiveMs=540s
// (GREEN — that IS the fix). The planted violation that proves the check's comparison
// fires correctly is triggered by MC_DISPATCH_BACKGROUND=1, which bypasses the
// clamp and exposes a raw value > ceiling.
console.log("\n(5) Planted violation — foreground bound >540s → red:");

test("planted: large default clamped to ceiling by helper → check is GREEN (the fix works)", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    // 30min default with no bg signal: foregroundAwareTimeout clamps to 540000 ≤ ceiling → GREEN
    const result = runChecks({ wrapperDefaults: { "large-default-clamped": 30 * 60 * 1000 } });
    const c = result.checks.find(ch => ch.wrapper === "large-default-clamped");
    assert(c, "Expected check for large-default-clamped");
    assert.strictEqual(c.status, "green",
      `Expected green (30min clamped→540000 ≤ ceiling by foregroundAwareTimeout), got ${c.status}`);
    assert.strictEqual(result.ok, true, "Expected ok:true when the helper clamps the bound");
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("planted: MC_DISPATCH_BACKGROUND=1 bypasses clamp → 30min default exposes violation (red)", () => {
  // This is the true planted violation: with background signal set, the helper returns the
  // raw defaultMs (no clamp). If defaultMs > ceiling, the check correctly reports RED.
  // This proves the check's comparison logic fires (not just the helper's clamp).
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.setEnv("DISPATCH_BACKGROUND", "1"); // bypass clamp → raw 30min returned
  try {
    const result = runChecks({ wrapperDefaults: { "bg-bypass-planted": 30 * 60 * 1000 } });
    // effective = 30*60*1000 = 1800000 > 540000 → RED
    const c = result.checks.find(ch => ch.wrapper === "bg-bypass-planted");
    assert(c, "Expected check for bg-bypass-planted");
    assert.strictEqual(c.status, "red",
      `Expected red: MC_DISPATCH_BACKGROUND=1 bypassed the clamp, effective=1800000ms > ceiling`);
    assert.strictEqual(result.ok, false, "Expected ok:false for planted violation");
    assert(c.reason && /VIOLATION/i.test(c.reason),
      `Expected VIOLATION in reason, got: ${c.reason}`);
  } finally {
    if (orig === undefined) mcEnv.unsetEnv("DISPATCH_BACKGROUND");
    else mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

test("planted: 541000ms default (1ms over ceiling) clamped → GREEN (clamp saves it)", () => {
  const orig = mcEnv.readEnv("DISPATCH_BACKGROUND");
  mcEnv.unsetEnv("DISPATCH_BACKGROUND");
  try {
    // effectiveMs = min(541000, 540000) = 540000 ≤ 540000 → GREEN (the clamp is the fix)
    const result = runChecks({ wrapperDefaults: { "just-over-ceiling": 541000 } });
    const c = result.checks.find(ch => ch.wrapper === "just-over-ceiling");
    assert(c, "Expected check for just-over-ceiling");
    assert.strictEqual(c.status, "green",
      `Expected green (541000ms clamped to 540000ms ≤ ceiling), got ${c.status}: ${c.reason}`);
  } finally {
    if (orig !== undefined) mcEnv.setEnv("DISPATCH_BACKGROUND", orig);
  }
});

// ── 6. Fail-closed: empty/invalid inputs ─────────────────────────────────────
console.log("\n(6) Fail-closed — empty or invalid wrapperDefaults:");

test("runChecks({ wrapperDefaults: {} }) → ok:false (no wrappers to check)", () => {
  const result = runChecks({ wrapperDefaults: {} });
  assert.strictEqual(result.ok, false,
    `Expected ok:false for empty wrapperDefaults`);
  assert(result.checks.length > 0, "Expected at least one check entry");
  assert.strictEqual(result.checks[0].status, "red",
    `Expected red status for empty wrapperDefaults`);
});

test("runChecks with null defaultMs → ok:false (fail-closed on unreadable bound)", () => {
  const result = runChecks({ wrapperDefaults: { "null-entry": null } });
  assert.strictEqual(result.ok, false,
    `Expected ok:false for null defaultMs`);
  const c = result.checks.find(ch => ch.wrapper === "null-entry");
  assert(c, "Expected check for null-entry");
  assert.strictEqual(c.status, "red",
    `Expected red for null defaultMs`);
  assert(c.reason && /FAIL-CLOSED/i.test(c.reason),
    `Expected FAIL-CLOSED in reason, got: ${c.reason}`);
});

test("runChecks with Infinity defaultMs → ok:false (FAIL-CLOSED: not finite)", () => {
  const result = runChecks({ wrapperDefaults: { "infinite-entry": Infinity } });
  assert.strictEqual(result.ok, false,
    `Expected ok:false for Infinity defaultMs`);
});

test("runChecks with string defaultMs → ok:false (FAIL-CLOSED)", () => {
  const result = runChecks({ wrapperDefaults: { "string-entry": "not-a-number" } });
  assert.strictEqual(result.ok, false,
    `Expected ok:false for string defaultMs`);
});

// ── 7. Standalone CLI exits 0 ────────────────────────────────────────────────
console.log("\n(7) Standalone CLI exit code:");

test("node dispatch-timeout-sanity.js exits 0 (all wrappers ≤ ceiling)", () => {
  const r = spawnSync(process.execPath, [
    path.join(__dirname, "dispatch-timeout-sanity.js"),
    "--json",
  ], { encoding: "utf8", timeout: 10000 });
  assert.strictEqual(r.status, 0,
    `Expected exit 0, got ${r.status}. stdout: ${r.stdout.slice(0, 500)}`);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.ok, true,
    `Expected ok:true in JSON output, got: ${JSON.stringify(out)}`);
});

test("node dispatch-timeout-sanity.js --json output is valid JSON with checks array", () => {
  const r = spawnSync(process.execPath, [
    path.join(__dirname, "dispatch-timeout-sanity.js"),
    "--json",
  ], { encoding: "utf8", timeout: 10000 });
  assert.doesNotThrow(() => JSON.parse(r.stdout), "Output must be valid JSON");
  const out = JSON.parse(r.stdout);
  assert(Array.isArray(out.checks), "Expected checks to be an array");
  assert(out.checks.length >= 4, `Expected ≥4 checks, got ${out.checks.length}`);
  assert(out.checks.every(c => c.name && c.status && c.reason),
    "Each check must have name, status, and reason");
});

// ── Fix-cycle pin (claude backend lane, 2026-06-10): runProvider was the FOURTH
// G8 wrapper and the original W0 build missed it. Pin its presence so a silent
// removal from WRAPPER_DEFAULTS (which would drop it from the sanity sweep
// without any red) is caught here.
console.log("\n(7) fix-cycle pin — runProvider (providers.js) is a covered wrapper:");
test("WRAPPER_DEFAULTS includes 'run-provider' (the cross-provider runProvider route)", () => {
  assert(Object.prototype.hasOwnProperty.call(WRAPPER_DEFAULTS, "run-provider"),
    "run-provider must stay in WRAPPER_DEFAULTS — removing it silently drops the 4th G8 wrapper from the sanity sweep");
  assert(
    foregroundAwareTimeout(WRAPPER_DEFAULTS["run-provider"], {}) <= FOREGROUND_CEILING_MS,
    "run-provider foreground bound must clamp to the ceiling",
  );
});
test("providers.js loads and reaches timeout-policy (no broken require path)", () => {
  const providers = require("../hooks/lib/providers.js");
  assert(typeof providers.runProvider === "function", "runProvider export intact");
});

// ── Final ─────────────────────────────────────────────────────────────────────
console.log(`\ndispatch-timeout-sanity.test.js — ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
