#!/usr/bin/env node
"use strict";

/**
 * SP-20260627-001 — enforce-correctness ACs (β pins 1+2 + the ADR-0013 flip).
 *   AC-1.1 worktree_pending_conditioned · AC-1.2 fixer_in_process_still_refused
 *   AC-1.3 role_norm_pure_alias · AC-1.4 enforce_default_with_override
 *
 *   node tests/regression/SP-20260627-001/enforce-correctness.test.js
 */

const path = require("path");
const assert = require("assert");
const { harness } = require("../../../scripts/checks/lib/fixture-harness");
const {
  validateDispatch, validateDispatchForClass, contractEnforceMode, classForRole,
} = require("../../../scripts/dispatch/dispatch-contract");
const { normalizeRole, ROLE_ALIASES } = require("../../../scripts/hooks/lib/role-aliases");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const h = harness("SP-20260627-001-enforce-correctness");

// ── AC-1.1 worktree_pending_conditioned — BOTH directions (conditioned, NOT a blanket pass) ──
h.pass("AC-1.1 -w build-chain WITH worktreePending + canonical cwd PASSES (worktree created post-validation)", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude", cwd: PROJECT_ROOT, worktreePending: true }));
h.violation("AC-1.1 build-chain + canonical cwd WITHOUT worktreePending STILL violates (no blanket pass)", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude", cwd: PROJECT_ROOT }));
h.violation("AC-1.1 build-chain + NO cwd + no worktreePending STILL violates (omitting cwd is not a bypass)", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude" }));
h.pass("AC-1.1 (class path) build_chain_worker + worktreePending + canonical PASSES (generic builder/fixer route)", () =>
  validateDispatchForClass({ class: "build_chain_worker", shape: "subprocess-claude", toolId: "claude", cwd: PROJECT_ROOT, worktreePending: true }));

// ── AC-1.2 fixer_in_process_still_refused — fixer→GENERIC_BUILD_IDS→build_chain_worker; in-process STILL refused ──
h.violation("AC-1.2 fixer (→build_chain_worker class) via in-process-agent is STILL refused (classifying != exempting)", () =>
  validateDispatchForClass({ class: "build_chain_worker", shape: "in-process-agent" }));

// ── AC-1.3 role_norm_pure_alias — pure 1-hop alias, no chaining, no cross-class widening ──
h.test("AC-1.3 role-norm is a pure 1-hop alias (no chaining); normalizing never makes a forbidden shape allowed", () => {
  for (const [legacy, canon] of Object.entries(ROLE_ALIASES)) {
    assert.ok(!(canon in ROLE_ALIASES), `alias '${legacy}'->'${canon}' must be 1-hop: target '${canon}' must NOT itself be a legacy alias key`);
    assert.strictEqual(normalizeRole(canon), canon, `normalizeRole('${canon}') must be idempotent (1-hop)`);
  }
  // no-widen spot check: redteam->security-reviewer, and security-reviewer STILL forbids in-process-agent.
  assert.strictEqual(normalizeRole("redteam"), "security-reviewer", "redteam aliases to security-reviewer");
  assert.strictEqual(
    validateDispatch({ role: "security-reviewer", shape: "in-process-agent" }).ok, false,
    "normalizing redteam->security-reviewer must NOT make in-process-agent allowed (no-widen)",
  );
});

// ── AC-1.4 enforce_default_with_override — default enforce; report|off|0 + kill-switch revert ──
h.test("AC-1.4 contractEnforceMode defaults to ENFORCE; report|off|0 + master/per-wrapper kill revert it", () => {
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", {}), true, "default must be enforce");
  assert.strictEqual(contractEnforceMode("DISPATCH_AGENT", {}), true, "default must be enforce (any wrapper)");
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", { MC_DISPATCH_CONTRACT_ENFORCE: "off" }), false, "=off reverts");
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", { MC_DISPATCH_CONTRACT_ENFORCE: "report" }), false, "=report reverts");
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", { MC_DISPATCH_CONTRACT_ENFORCE: "0" }), false, "=0 reverts");
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", { MC_DISABLE_SHAPE_DOOR: "1" }), false, "master kill reverts");
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", { MC_DISPATCH_CONTRACT_ENFORCE_DISPATCH_CLAUDE: "report" }), false, "per-wrapper kill reverts");
  assert.strictEqual(contractEnforceMode("DISPATCH_CLAUDE", { MC_DISPATCH_CONTRACT_ENFORCE: "enforce" }), true, "explicit enforce stays enforce");
});

h.done();
