#!/usr/bin/env node
"use strict";

/**
 * SP-20260627-001 — no-widen NEGATIVE fixtures (β pin 3). The no-widen invariant is only
 * PROVEN (not asserted) when one planted genuinely-wrong dispatch PER refused class STILL
 * fails under enforce-by-default, plus BC-16 fail-closed on the gate's own evaluation error.
 * These — not the positive legit-passes — are what prove the flip didn't relax a real refusal.
 *
 *   node tests/regression/SP-20260627-001/negative-fixtures.test.js
 */

const path = require("path");
const fs = require("fs");
const os = require("os");
const assert = require("assert");
const { spawnSync } = require("child_process");
const { harness } = require("../../../scripts/checks/lib/fixture-harness");
const { validateDispatch, contractEnforceMode } = require("../../../scripts/dispatch/dispatch-contract");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const h = harness("SP-20260627-001-negative-fixtures");

// Guard: these fixtures live under enforce-by-default (the regime the flip introduced).
h.test("guard: contractEnforceMode is ENFORCE by default (the regime these fixtures certify)", () => {
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", {}), true);
  assert.strictEqual(contractEnforceMode("DISPATCH_AGENT", {}), true);
});

// AC-2.1 api-when-CLI
h.violation("AC-2.1 api-when-CLI: cross-provider reviewer via 'api' shape is REFUSED", () =>
  validateDispatch({ role: "security-reviewer", shape: "api" }));

// AC-2.2 build-chain-in-process
h.violation("AC-2.2 build-chain-in-process: builder via in-process-agent is REFUSED", () =>
  validateDispatch({ role: "frontend-builder", shape: "in-process-agent" }));

// AC-2.3 REAL cwd-worktree-violation — the legit -w case (worktreePending) must NOT mask this.
h.violation("AC-2.3 real cwd-worktree-violation: builder, NO worktreePending, canonical cwd is REFUSED", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude", cwd: PROJECT_ROOT }));

// AC-2.4 forbidden_shape
h.violation("AC-2.4 forbidden_shape: cross-provider reviewer (qa-reviewer) via in-process-agent is REFUSED (kills diversity)", () =>
  validateDispatch({ role: "qa-reviewer", shape: "in-process-agent" }));

// AC-2.5 BC-16 fail-closed-on-own-error — EVALUATION error → ok:false, never silently ok:true.
// (Distinct from the wrappers' MODULE-LOAD fail-OPEN, which preserves availability — β edge.)
h.violation("AC-2.5 BC-16: null input fails CLOSED (ok:false), never silently ok:true", () =>
  validateDispatch(null));
h.violation("AC-2.5 BC-16: missing role fails CLOSED", () =>
  validateDispatch({ shape: "subprocess-claude" }));
h.violation("AC-2.5 BC-16: missing shape fails CLOSED", () =>
  validateDispatch({ role: "frontend-builder" }));

// AC-2.5b — GPT-5.5 gauntlet BLOCKER regression-lock: a MODULE-EVALUATION error (the gate
// ran and threw — here a malformed contract file via WARPOS_DISPATCH_CONTRACT_PATH) must
// FAIL CLOSED under enforce in the dispatch-claude wrapper, NOT be swallowed by a broad
// fail-open catch into a silent bypass. (The separate MODULE-LOAD path still fails OPEN.)
h.test("AC-2.5b BLOCKER regression: malformed contract path → dispatch-claude FAILS CLOSED (exit 1) under enforce", () => {
  const badContract = path.join(os.tmpdir(), `mc-bad-contract-${process.pid}.json`);
  fs.writeFileSync(badContract, "{ this is not valid json");
  try {
    const r = spawnSync("node", ["scripts/dispatch-claude.js", "backend-reviewer", __filename], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, WARPOS_DISPATCH_CONTRACT_PATH: badContract },
      encoding: "utf8",
      timeout: 30000,
    });
    assert.strictEqual(r.status, 1, `expected exit 1 (fail-closed) under enforce, got ${r.status}; stderr: ${(r.stderr || "").slice(0, 300)}`);
    assert.ok(/EVALUATION error[\s\S]*CLOSED/i.test(r.stderr || ""), `expected 'EVALUATION error … failing CLOSED' in stderr: ${(r.stderr || "").slice(0, 300)}`);
  } finally {
    try { fs.unlinkSync(badContract); } catch { /* ignore */ }
  }
});

h.done();
