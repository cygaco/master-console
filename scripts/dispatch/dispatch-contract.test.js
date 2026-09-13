#!/usr/bin/env node
"use strict";

/**
 * Isolated P5 test for dispatch-contract.js (the §17.1 keystone reader/validator).
 * Proves the three operator-named dispatch failures are CAUGHT as contract
 * violations, the happy shapes pass, unknown roles fail closed, skills fail closed
 * to inline, and a planted BROKEN contract fails the integrity check.
 *
 *   node scripts/dispatch/dispatch-contract.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const {
  validateDispatch, validateDispatchForClass, contractForRole, classForRole, skillExecution, validateContractFile, CONTRACT_PATH,
} = require("./dispatch-contract");

const h = harness("dispatch-contract");

// ── known-answer: real contract is internally consistent ────
h.pass("validateContractFile() passes on the real keystone", () => validateContractFile());

// ── W5 (ADR-0014): NO shape is α-only — mode_profiles.sprint.alpha_only_shapes is
// EMPTY. ε summons the in-process roster in any spawn context (top-level OR teammate-ε)
// with a scopeContract; the α-only overlay (975ed5c) is retired. Lock the empty state
// so a future re-add of "in-process-agent" (a doctrine regression) fails loudly here.
h.test("W5/ADR-0014: mode_profiles.sprint.alpha_only_shapes is [] (no shape is α-only)", () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const aos = contract.mode_profiles && contract.mode_profiles.sprint && contract.mode_profiles.sprint.alpha_only_shapes;
  assert.ok(Array.isArray(aos), "sprint.alpha_only_shapes must still be an array (retained-but-empty for reversal)");
  assert.strictEqual(aos.length, 0, "sprint.alpha_only_shapes must be EMPTY (ADR-0014 retired the α-only doctrine)");
  assert.ok(!aos.includes("in-process-agent"), "in-process-agent must NOT be α-only (ε summons the roster in any context)");
});
// The contract still REJECTS a build-chain role via in-process-agent — that invariant
// is INDEPENDENT of the α-only retirement (the no-cascade / context-lever guarantee
// stands: a builder is never dispatched in-process, by anyone, ε included).
h.violation("W5: build-chain role via in-process-agent is STILL rejected (no-cascade invariant survives)", () =>
  validateDispatch({ role: "backend-builder", shape: "in-process-agent" }));

// ── class derivation is correct ─────────────────────────────
h.test("class derivation: builder=build_chain_worker, security-reviewer=cross_provider_reviewer, design-quality=claude_pinned_reviewer, alpha=face", () => {
  assert.strictEqual(classForRole("frontend-builder"), "build_chain_worker");
  assert.strictEqual(classForRole("security-reviewer"), "cross_provider_reviewer");
  assert.strictEqual(classForRole("design-quality"), "claude_pinned_reviewer");
  assert.strictEqual(classForRole("alpha"), "face");
  assert.strictEqual(classForRole("director-of-engineering"), "manager");
  // W2 (E-DISPATCH-PERFECT-001): the GPT product-leadership chain resolves to cross_provider_consult_lead
  // — the {tier:director,provider:openai} rule FIRES before the generic {tier:director}→manager (β HOW-
  // condition: prove RESOLUTION, not mere rule-string presence). The Claude director above stays manager,
  // proving the first-match precedence is correct (provider discriminates, not tier).
  assert.strictEqual(classForRole("director-of-product"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("director-of-growth"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("product-lead"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("design-lead"), "cross_provider_consult_lead");
  // gemini-deepclean-20260720 (Task#1 fix-b): the {tier:lead,provider:antigravity} rule FIRES before the
  // generic {tier:lead}→manager catch-all, so research-lead (Growth's antigravity/gemini-lab research
  // consult, ADR-0016 model-spread) derives cross_provider_consult_lead — NOT the Claude-only in-process
  // "manager". Mirrors the openai-lead rule; completes the deep-clean's scan-broadening (role-parity-scan.js:535).
  assert.strictEqual(classForRole("research-lead"), "cross_provider_consult_lead");
});

// ── happy shapes pass ───────────────────────────────────────
h.pass("builder via subprocess-claude (with a worktree cwd) is allowed", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude", cwd: path.join(__dirname, "..", "..", "wt-fixture") }));
// GPT-5.5 review R2 MEDIUM regression guard: omitting cwd for a worktree-required
// role is NOT a bypass — it must be flagged.
h.violation("builder with NO cwd is rejected (omitting cwd is not a worktree bypass)", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude" }));
h.pass("security-reviewer via subprocess-cross-provider (agy) is allowed", () =>
  validateDispatch({ role: "security-reviewer", shape: "subprocess-cross-provider", toolId: "agy" }));
h.pass("design-quality via in-process-agent is allowed (MCP carve-out)", () =>
  validateDispatch({ role: "design-quality", shape: "in-process-agent", toolId: "agent-tool" }));

// ── PLANTED VIOLATIONS — the three operator failures ────────
// (iii) in-process-when-subprocess: a build-chain role via the Agent tool.
h.violation("(iii) build-chain role via in-process-agent is REJECTED", () =>
  validateDispatch({ role: "frontend-builder", shape: "in-process-agent" }));
// (ii) API-when-CLI: a CLI reviewer dispatched via the API shape.
h.violation("(ii) cross-provider reviewer via api is REJECTED (availability != authorization)", () =>
  validateDispatch({ role: "security-reviewer", shape: "api" }));
// cross-provider reviewer via in-process-agent (kills provider diversity).
// The role is REGISTRY-DERIVED, not hard-coded: the operator ruling of 2026-08-18
// re-pinned qa-/frontend-/backend-reviewer to claude (claude_pinned_reviewer, whose
// ONE legal shape IS in-process-agent), so naming a literal role here rots the moment
// the registry moves. Pick any live cross_provider_reviewer; fail loudly if none exist
// (then the diversity invariant has no subject and this test must be revisited).
const XP_REVIEWER = Object.keys(require("./dispatch-contract").loadRegistry().roles || {})
  .find((r) => classForRole(r) === "cross_provider_reviewer");
assert.ok(XP_REVIEWER, "registry has no cross_provider_reviewer role — the diversity invariant has no subject");
h.violation(`cross-provider reviewer (${XP_REVIEWER}) via in-process-agent is REJECTED (diversity)`, () =>
  validateDispatch({ role: XP_REVIEWER, shape: "in-process-agent" }));
// Converse (operator ruling 2026-08-18): a claude-PINNED reviewer's one legal shape is
// in-process-agent — the same shape that is a violation for the cross-provider class.
h.pass("claude-pinned reviewer (qa-reviewer) via in-process-agent is allowed (2026-08-18 re-pin)", () =>
  validateDispatch({ role: "qa-reviewer", shape: "in-process-agent", toolId: "agent-tool" }));
// tool mismatch.
h.violation("builder via subprocess-claude but tool=codex is REJECTED", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "codex" }));
// build-chain in canonical cwd.
h.violation("build-chain role with cwd=canonical-root is REJECTED (worktree-required)", () =>
  validateDispatch({ role: "backend-builder", shape: "subprocess-claude", toolId: "claude", cwd: path.resolve(__dirname, "..", "..") }));

// ── fail-closed: unknown role ───────────────────────────────
h.failClosed("unknown role fails closed (no contract => rejected)", () =>
  validateDispatch({ role: "totally-made-up-role", shape: "subprocess-claude" }));

// ── skills: unverified subprocess falls back to inline ──────
h.test("skillExecution: unverified subprocess candidate falls back to inline (fail-closed)", () => {
  const r = skillExecution("scan:full");
  assert.strictEqual(r.execution, "inline", JSON.stringify(r));
  assert.strictEqual(r.verified, false);
});
h.test("skillExecution: an unlisted skill defaults to inline", () => {
  assert.strictEqual(skillExecution("some:lightweight-skill").execution, "inline");
});

// ── PLANTED BROKEN CONTRACT — integrity check must bite ─────
h.violation("a contract with a bogus shape FAILS validateContractFile (via path-override)", () => {
  const real = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  real.role_classes.face.allowed_shapes = ["ghost-shape-does-not-exist"]; // plant
  const fx = sealedDir({ "dispatch-contract.json": JSON.stringify(real) }, "brokencontract");
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, "dispatch-contract.js"), "validate"], {
      env: { ...process.env, WARPOS_DISPATCH_CONTRACT_PATH: fx.file("dispatch-contract.json") },
      encoding: "utf8",
    });
    // ok:true only if the broken contract wrongly passed (exit 0).
    return { ok: r.status === 0 };
  } finally {
    fx.cleanup();
  }
});

// GPT-5.5 review MEDIUM regression guard: even a MISCONFIGURED contract that
// re-allows in-process-agent for a build-chain class must NOT let a build-chain
// role be dispatched in-process — validateDispatch enforces it directly against
// role-registry (defense in depth), independent of the contract file.
h.violation("a build-chain role via in-process-agent is rejected EVEN with a contract that re-allows it", () => {
  const real = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  real.role_classes.build_chain_worker.allowed_shapes = ["subprocess-claude", "in-process-agent"]; // misconfig
  real.role_classes.build_chain_worker.forbidden_shapes = []; // removed the guard
  const fx = sealedDir({ "dispatch-contract.json": JSON.stringify(real) }, "reallowcontract");
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, "dispatch-contract.js"), "check", "frontend-builder", "in-process-agent"], {
      env: { ...process.env, WARPOS_DISPATCH_CONTRACT_PATH: fx.file("dispatch-contract.json") },
      encoding: "utf8",
    });
    // ok:true only if the misconfigured contract WRONGLY let it through (exit 0).
    return { ok: r.status === 0 };
  } finally {
    fx.cleanup();
  }
});

// ── G1 / β option (c): generic build id 'builder' → build_chain_worker ─────────
// validateDispatch still returns ok:false for 'builder' (not in role-registry — correct);
// validateDispatchForClass resolves build_chain_worker directly — the TRUTHFUL path.

// NEW: the class-level helper resolves build_chain_worker + subprocess-claude → OK.
// A non-canonical cwd satisfies the worktree-required policy.
h.pass("G1: validateDispatchForClass(build_chain_worker, subprocess-claude, worktree cwd) → contract-OK (truthful advisory)", () =>
  validateDispatchForClass({
    class: "build_chain_worker",
    shape: "subprocess-claude",
    toolId: "claude",
    cwd: path.join(__dirname, "..", "..", "wt-fixture"),
  }));

// (planted-G1) The OLD path: validateDispatch alone returns ok:false with "(fail-closed)"
// for 'builder' — that is the LIE G1 eliminates. We assert this explicitly so any
// revert that drops the GENERIC_BUILD_IDS re-route is immediately detectable.
h.violation("(planted-G1) validateDispatch for 'builder' still returns fail-closed — the lying advisory the G1 fix eliminates", () =>
  validateDispatch({
    role: "builder",
    shape: "subprocess-claude",
    toolId: "claude",
    cwd: path.join(__dirname, "..", "..", "wt-fixture"),
  }));

// (planted-G1) validateDispatchForClass MUST NOT produce '(fail-closed)' for the
// build_chain_worker class — if it did, the fix is broken (it would just move the lie).
h.test("(planted-G1) validateDispatchForClass must NOT produce '(fail-closed)' wording for build_chain_worker + subprocess-claude", () => {
  const v = validateDispatchForClass({
    class: "build_chain_worker",
    shape: "subprocess-claude",
    toolId: "claude",
    cwd: path.join(__dirname, "..", "..", "wt-fixture"),
  });
  assert.strictEqual(v.ok, true, `expected ok:true from validateDispatchForClass, got violations: ${JSON.stringify(v.violations)}`);
  const hasFailClosed = (v.violations || []).some((viol) => viol.includes("fail-closed"));
  assert.strictEqual(hasFailClosed, false, `validateDispatchForClass must NOT produce '(fail-closed)' wording — if it does, the G1 fix is broken: ${JSON.stringify(v.violations)}`);
});

h.done();
