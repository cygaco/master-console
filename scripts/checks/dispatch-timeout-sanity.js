#!/usr/bin/env node
"use strict";

/**
 * dispatch-timeout-sanity.js — Report-only FAIL-CLOSED check (T-20260610-304 / G8/N1).
 *
 * Asserts every wrapper's FOREGROUND effective bound is ≤540s (FOREGROUND_CEILING_MS).
 *
 * Background: every dispatch wrapper's default timeout exceeded the harness FOREGROUND
 * Bash ceiling (600s). When run via the harness, the harness killed the wrapper BEFORE
 * its own bound fired — so the wrapper never wrote its death record. The clamp in
 * timeout-policy.js fixes this; this check VERIFIES the fix holds.
 *
 * FAIL-CLOSED: if the policy module can't be loaded, or a wrapper's bound can't be
 * computed (constant missing / not a finite number), that reads as a VIOLATION — not
 * a pass. Mirrors the mc-install-baseline fail-closed pattern.
 *
 * PLANTED-VIOLATION: use `runChecks({ wrapperDefaults: { "bad-wrapper": 30*60*1000 } })`
 * to confirm a >540s foreground bound is caught as red. See the companion test.
 *
 * Output schema: { name, status, reason } per check (green/red). --json for machine
 * output. Exits 0 on all-green, 1 on any red.
 *
 * NOTE: wire into /scan:full report-only (classifier-held — operator edits scan/full.md).
 *
 * Run standalone: node scripts/checks/dispatch-timeout-sanity.js [--json]
 * Test:           node scripts/checks/dispatch-timeout-sanity.test.js
 */

// ── Load the policy module (FAIL-CLOSED on any import error) ──────────────────
let policyLoaded = false;
let FOREGROUND_CEILING_MS, WRAPPER_DEFAULTS, foregroundAwareTimeout;
let policyLoadError = null;
try {
  const policy = require("../dispatch/timeout-policy");
  FOREGROUND_CEILING_MS = policy.FOREGROUND_CEILING_MS;
  WRAPPER_DEFAULTS = policy.WRAPPER_DEFAULTS;
  foregroundAwareTimeout = policy.foregroundAwareTimeout;
  if (
    typeof FOREGROUND_CEILING_MS !== "number" ||
    !Number.isFinite(FOREGROUND_CEILING_MS) ||
    typeof WRAPPER_DEFAULTS !== "object" ||
    WRAPPER_DEFAULTS === null ||
    typeof foregroundAwareTimeout !== "function"
  ) {
    throw new Error("timeout-policy module is incomplete (missing or invalid exports)");
  }
  policyLoaded = true;
} catch (e) {
  policyLoadError = (e && e.message) ? e.message : String(e);
}

const JSON_OUT = process.argv.includes("--json");
const START = Date.now();

/**
 * runChecks(opts) -> { ok: boolean, checks: Array<{name, status, reason, ...}> }
 *
 * The programmatic entry point — used by the CLI below AND by the test to inject
 * planted violations. opts.wrapperDefaults overrides WRAPPER_DEFAULTS for tests.
 */
function runChecks(opts) {
  if (!policyLoaded) {
    return {
      ok: false,
      checks: [{
        name: "dispatch-timeout-sanity/policy-load",
        status: "red",
        reason: `FAIL-CLOSED: timeout-policy module unreadable — ${policyLoadError}`,
      }],
    };
  }

  const targets = (opts && opts.wrapperDefaults != null)
    ? opts.wrapperDefaults
    : WRAPPER_DEFAULTS;

  const checks = [];
  const entries = Object.entries(targets);

  // Empty targets = no wrappers checked = violation (fail-closed: can't verify nothing)
  if (entries.length === 0) {
    return {
      ok: false,
      checks: [{
        name: "dispatch-timeout-sanity/empty-targets",
        status: "red",
        reason: "FAIL-CLOSED: no wrapper defaults to check — cannot assert the ceiling holds",
      }],
    };
  }

  for (const [wrapper, defaultMs] of entries) {
    try {
      if (typeof defaultMs !== "number" || !Number.isFinite(defaultMs)) {
        throw new Error(`defaultMs is ${JSON.stringify(defaultMs)} — not a finite number`);
      }
      // No background signal → foreground path → must be ≤ ceiling
      const effectiveMs = foregroundAwareTimeout(defaultMs, {});
      const ok = effectiveMs <= FOREGROUND_CEILING_MS;
      checks.push({
        name: `dispatch-timeout-sanity/${wrapper}`,
        status: ok ? "green" : "red",
        reason: ok
          ? `foreground effective bound ${effectiveMs}ms ≤ ${FOREGROUND_CEILING_MS}ms ceiling`
          : `VIOLATION: foreground effective bound ${effectiveMs}ms > ${FOREGROUND_CEILING_MS}ms ceiling`,
        wrapper,
        defaultMs,
        effectiveMs,
        ceiling: FOREGROUND_CEILING_MS,
      });
    } catch (e) {
      // FAIL-CLOSED: computation error → treat as violation
      checks.push({
        name: `dispatch-timeout-sanity/${wrapper}`,
        status: "red",
        reason: `FAIL-CLOSED: could not compute foreground effective bound — ${(e && e.message) ? e.message : e}`,
        wrapper,
      });
    }
  }

  const ok = checks.every(c => c.status === "green");
  return { ok, checks };
}

module.exports = { runChecks };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const result = runChecks();
  const durationMs = Date.now() - START;
  const green = result.checks.filter(c => c.status === "green").length;
  const total = result.checks.length;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      name: "dispatch-timeout-sanity",
      ok: result.ok,
      status: result.ok ? "green" : "red",
      durationMs,
      checks: result.checks,
    }, null, 2));
  } else {
    for (const c of result.checks) {
      const sym = c.status === "green" ? "✓" : "✗";
      const detail = (c.effectiveMs != null && c.ceiling != null)
        ? ` (${c.effectiveMs}ms / ceiling ${c.ceiling}ms)`
        : "";
      console.log(`  ${sym} [${c.status.padEnd(5)}] ${c.name}${detail}`);
      if (c.reason) console.log(`           ${c.reason}`);
    }
    console.log(
      `\ndispatch-timeout-sanity: ${result.ok ? "GREEN" : "RED"} ` +
      `(${green}/${total} checks passed, ${durationMs}ms)`,
    );
  }

  process.exit(result.ok ? 0 : 1);
}
