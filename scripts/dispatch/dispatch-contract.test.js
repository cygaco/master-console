#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { harness, sealedDir } = require("../checks/lib/fixture-harness");
const {
  validateDispatch, validateDispatchForClass, contractForRole, classForRole, skillExecution, validateContractFile, CONTRACT_PATH,
} = require("./dispatch-contract");

const h = harness("dispatch-contract");

h.pass("validateContractFile() passes on the real keystone", () => validateContractFile());

h.test("ADR-0014: mode_profiles.sprint.alpha_only_shapes is [] (no shape is α-only)", () => {
  const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  const aos = contract.mode_profiles && contract.mode_profiles.sprint && contract.mode_profiles.sprint.alpha_only_shapes;
  assert.ok(Array.isArray(aos), "sprint.alpha_only_shapes must be an array");
  assert.strictEqual(aos.length, 0, "sprint.alpha_only_shapes must be EMPTY (ADR-0014: no shape is α-only)");
  assert.ok(!aos.includes("in-process-agent"), "in-process-agent must NOT be α-only (ε summons the roster in any context)");
});
h.violation("build-chain role via in-process-agent is rejected (no-cascade invariant)", () =>
  validateDispatch({ role: "backend-builder", shape: "in-process-agent" }));

h.test("class derivation: builder=build_chain_worker, security-reviewer=cross_provider_reviewer, design-quality=claude_pinned_reviewer, alpha=face", () => {
  assert.strictEqual(classForRole("frontend-builder"), "build_chain_worker");
  assert.strictEqual(classForRole("security-reviewer"), "cross_provider_reviewer");
  assert.strictEqual(classForRole("design-quality"), "claude_pinned_reviewer");
  assert.strictEqual(classForRole("alpha"), "face");
  assert.strictEqual(classForRole("director-of-engineering"), "manager");
  assert.strictEqual(classForRole("director-of-product"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("director-of-growth"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("product-lead"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("design-lead"), "cross_provider_consult_lead");
  assert.strictEqual(classForRole("research-lead"), "cross_provider_consult_lead");
});

h.pass("builder via subprocess-claude (with a worktree cwd) is allowed", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude", cwd: path.join(__dirname, "..", "..", "wt-fixture") }));
h.violation("builder with NO cwd is rejected (omitting cwd is not a worktree bypass)", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "claude" }));
h.pass("security-reviewer via subprocess-cross-provider (agy) is allowed", () =>
  validateDispatch({ role: "security-reviewer", shape: "subprocess-cross-provider", toolId: "agy" }));
h.pass("design-quality via in-process-agent is allowed (MCP carve-out)", () =>
  validateDispatch({ role: "design-quality", shape: "in-process-agent", toolId: "agent-tool" }));

h.violation("(iii) build-chain role via in-process-agent is REJECTED", () =>
  validateDispatch({ role: "frontend-builder", shape: "in-process-agent" }));
h.violation("(ii) cross-provider reviewer via api is REJECTED (availability != authorization)", () =>
  validateDispatch({ role: "security-reviewer", shape: "api" }));
const XP_REVIEWER = Object.keys(require("./dispatch-contract").loadRegistry().roles || {})
  .find((r) => classForRole(r) === "cross_provider_reviewer");
assert.ok(XP_REVIEWER, "registry has no cross_provider_reviewer role — the diversity invariant has no subject");
h.violation(`cross-provider reviewer (${XP_REVIEWER}) via in-process-agent is REJECTED (diversity)`, () =>
  validateDispatch({ role: XP_REVIEWER, shape: "in-process-agent" }));
h.pass("claude-pinned reviewer (qa-reviewer) via in-process-agent is allowed", () =>
  validateDispatch({ role: "qa-reviewer", shape: "in-process-agent", toolId: "agent-tool" }));
h.violation("builder via subprocess-claude but tool=codex is REJECTED", () =>
  validateDispatch({ role: "frontend-builder", shape: "subprocess-claude", toolId: "codex" }));
h.violation("build-chain role with cwd=canonical-root is REJECTED (worktree-required)", () =>
  validateDispatch({ role: "backend-builder", shape: "subprocess-claude", toolId: "claude", cwd: path.resolve(__dirname, "..", "..") }));

h.failClosed("unknown role fails closed (no contract => rejected)", () =>
  validateDispatch({ role: "totally-made-up-role", shape: "subprocess-claude" }));

h.test("skillExecution: unverified subprocess candidate falls back to inline (fail-closed)", () => {
  const r = skillExecution("scan:full");
  assert.strictEqual(r.execution, "inline", JSON.stringify(r));
  assert.strictEqual(r.verified, false);
});
h.test("skillExecution: an unlisted skill defaults to inline", () => {
  assert.strictEqual(skillExecution("some:lightweight-skill").execution, "inline");
});

h.violation("a contract with a bogus shape FAILS validateContractFile (via path-override)", () => {
  const real = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  real.role_classes.face.allowed_shapes = ["ghost-shape-does-not-exist"];
  const fx = sealedDir({ "dispatch-contract.json": JSON.stringify(real) }, "brokencontract");
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, "dispatch-contract.js"), "validate"], {
      env: { ...process.env, ...mcEnv.envPair("DISPATCH_CONTRACT_PATH", fx.file("dispatch-contract.json")) },
      encoding: "utf8",
    });
    return { ok: r.status === 0 };
  } finally {
    fx.cleanup();
  }
});

h.violation("a build-chain role via in-process-agent is rejected EVEN with a contract that re-allows it", () => {
  const real = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
  real.role_classes.build_chain_worker.allowed_shapes = ["subprocess-claude", "in-process-agent"];
  real.role_classes.build_chain_worker.forbidden_shapes = [];
  const fx = sealedDir({ "dispatch-contract.json": JSON.stringify(real) }, "reallowcontract");
  try {
    const r = spawnSync(process.execPath, [path.join(__dirname, "dispatch-contract.js"), "check", "frontend-builder", "in-process-agent"], {
      env: { ...process.env, ...mcEnv.envPair("DISPATCH_CONTRACT_PATH", fx.file("dispatch-contract.json")) },
      encoding: "utf8",
    });
    return { ok: r.status === 0 };
  } finally {
    fx.cleanup();
  }
});

h.pass("validateDispatchForClass(build_chain_worker, subprocess-claude, worktree cwd) → contract-OK (truthful advisory)", () =>
  validateDispatchForClass({
    class: "build_chain_worker",
    shape: "subprocess-claude",
    toolId: "claude",
    cwd: path.join(__dirname, "..", "..", "wt-fixture"),
  }));

h.violation("(planted) validateDispatch for 'builder' still returns fail-closed — the lying advisory the class-level helper eliminates", () =>
  validateDispatch({
    role: "builder",
    shape: "subprocess-claude",
    toolId: "claude",
    cwd: path.join(__dirname, "..", "..", "wt-fixture"),
  }));

h.test("(planted) validateDispatchForClass must NOT produce '(fail-closed)' wording for build_chain_worker + subprocess-claude", () => {
  const v = validateDispatchForClass({
    class: "build_chain_worker",
    shape: "subprocess-claude",
    toolId: "claude",
    cwd: path.join(__dirname, "..", "..", "wt-fixture"),
  });
  assert.strictEqual(v.ok, true, `expected ok:true from validateDispatchForClass, got violations: ${JSON.stringify(v.violations)}`);
  const hasFailClosed = (v.violations || []).some((viol) => viol.includes("fail-closed"));
  assert.strictEqual(hasFailClosed, false, `validateDispatchForClass must NOT produce '(fail-closed)' wording — if it does, the fix is broken: ${JSON.stringify(v.violations)}`);
});

h.done();
