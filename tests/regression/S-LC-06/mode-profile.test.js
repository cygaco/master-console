#!/usr/bin/env node
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// mode-profile.test.js — S-LC-06. The β SECURITY INVARIANT (load-bearing):
// a mode_profile may NARROW a role/class's allowed_shapes but MUST NOT widen past
// the CLASS ceiling. A planted mode-profile that WIDENS a role past its class →
// `dispatch-contract.js validate` FAILS. A narrowing profile → OK.
//
// Each planted contract is materialized as a SEALED file and validated in a
// subprocess via MC_DISPATCH_CONTRACT_PATH (the same path-override seam the
// existing dispatch-contract.test.js uses) so the live keystone is never touched.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const { harness, sealedDir } = require(path.join(ROOT, "scripts", "checks", "lib", "fixture-harness"));
const { CONTRACT_PATH, allowedShapesForRoleInMode } = require(path.join(ROOT, "scripts", "dispatch", "dispatch-contract"));
const VALIDATOR = path.join(ROOT, "scripts", "dispatch", "dispatch-contract.js");

const h = harness("S-LC-06/mode-profile");

// Validate a contract object in a subprocess; returns { ok } where ok = exit 0.
function validateSealed(contractObj, label) {
  const fx = sealedDir({ "dispatch-contract.json": JSON.stringify(contractObj) }, label);
  try {
    const r = spawnSync(process.execPath, [VALIDATOR, "validate"], {
      env: { ...process.env, MC_DISPATCH_CONTRACT_PATH: fx.file("dispatch-contract.json") },
      encoding: "utf8",
    });
    return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
  } finally {
    fx.cleanup();
  }
}

function baseContract() {
  return JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
}

// ── known-answer: the REAL contract (its mode_profiles are all narrowing) passes ──
h.pass("the real keystone with its narrowing mode_profiles validates", () =>
  validateSealed(baseContract(), "real"));

// ── known-answer: an explicit NARROWING profile passes ──────
// build_chain_worker's allowed_shapes = ["subprocess-claude"]. Narrowing it to []
// (or to the identity subset) is a valid subset → OK.
h.pass("a NARROWING class profile (subset of class allowed_shapes) validates", () => {
  const c = baseContract();
  c.mode_profiles.adhoc.class_shapes.build_chain_worker = []; // remove all — strictest narrowing
  c.mode_profiles.adhoc.class_shapes.cross_provider_reviewer = ["subprocess-cross-provider"]; // identity subset
  return validateSealed(c, "narrow");
});

// ── PLANTED VIOLATION (the β invariant): a class profile that WIDENS ──
// build_chain_worker is gated to subprocess-claude. Granting it
// subprocess-cross-provider via a mode profile is the EXACT invariant the brief
// names: "a role gated to subprocess-claude must NOT resolve to
// subprocess-cross-provider just because a mode grants it." → validator MUST FAIL.
h.violation("(β invariant) a mode profile that WIDENS build_chain_worker to subprocess-cross-provider is REJECTED", () => {
  const c = baseContract();
  c.mode_profiles.adhoc.class_shapes.build_chain_worker = ["subprocess-claude", "subprocess-cross-provider"];
  return validateSealed(c, "widen-class"); // ok:true ONLY if the widen WRONGLY passed
});

// ── PLANTED VIOLATION: a class profile granting in-process-agent to a builder ──
h.violation("a mode profile that WIDENS build_chain_worker to in-process-agent is REJECTED (isolation ceiling)", () => {
  const c = baseContract();
  c.mode_profiles.sprint.class_shapes.build_chain_worker = ["subprocess-claude", "in-process-agent"];
  return validateSealed(c, "widen-inproc");
});

// ── PLANTED VIOLATION: a role_shapes profile that WIDENS a specific role ──
h.violation("a role_shapes profile that WIDENS frontend-builder to in-process-agent is REJECTED", () => {
  const c = baseContract();
  c.mode_profiles.adhoc.role_shapes = { "frontend-builder": ["in-process-agent"] };
  return validateSealed(c, "widen-role");
});

// ── PLANTED VIOLATION: a profile granting an UNKNOWN shape ──
h.violation("a mode profile granting an unknown shape is REJECTED", () => {
  const c = baseContract();
  c.mode_profiles.adhoc.class_shapes.manager = ["ghost-shape"];
  return validateSealed(c, "ghost");
});

// ── runtime backstop: allowedShapesForRoleInMode is the INTERSECTION (never widens) ──
h.test("runtime narrowing returns the class default when a mode does not narrow the role", () => {
  const assert = require("assert");
  // oneshot has no cross_provider_reviewer entry → reviewer keeps its class shape.
  assert.deepStrictEqual(allowedShapesForRoleInMode("security-reviewer", "oneshot"), ["subprocess-cross-provider"]);
  // adhoc narrows build_chain_worker to its identity subset.
  assert.deepStrictEqual(allowedShapesForRoleInMode("frontend-builder", "adhoc"), ["subprocess-claude"]);
});

h.test("runtime narrowing can only REMOVE shapes — a fabricated wider narrow set never widens", () => {
  const assert = require("assert");
  // Even if a caller asks for a mode that doesn't exist, the result is the class
  // ceiling (no widening, no throw).
  const shapes = allowedShapesForRoleInMode("frontend-builder", "no-such-mode");
  assert.ok(shapes.includes("subprocess-claude"));
  assert.ok(!shapes.includes("subprocess-cross-provider"), "must never resolve a builder to cross-provider");
});

// ── ED-041: the alpha_only_shapes annotation on the sprint profile ──────────
// The `in-process-agent` shape is α-ONLY in sprint mode — only the top-level
// orchestrator (α, wearing the ε face) can spawn it via the Agent tool; a
// teammate-spawned ε cannot ("Agent is not available inside subagents").
h.test("mode_profiles.sprint.alpha_only_shapes === ['in-process-agent'] (ED-041)", () => {
  const assert = require("assert");
  const c = baseContract();
  assert.deepStrictEqual(c.mode_profiles.sprint.alpha_only_shapes, ["in-process-agent"]);
});

// ── known-answer: a well-formed alpha_only_shapes (all known shapes) validates ──
h.pass("a well-formed alpha_only_shapes (known shapes) validates", () => {
  const c = baseContract();
  c.mode_profiles.adhoc.alpha_only_shapes = ["in-process-agent"]; // an annotation; does not narrow
  return validateSealed(c, "aos-ok");
});

// ── PLANTED VIOLATION: an alpha_only_shapes containing an UNKNOWN shape ──
// A typo'd / fabricated shape in the annotation must be REJECTED by the validator
// (the field is recognized and validated against the shape vocabulary, ED-041).
h.violation("an alpha_only_shapes containing an unknown shape is REJECTED (ED-041)", () => {
  const c = baseContract();
  c.mode_profiles.sprint.alpha_only_shapes = ["in-process-agent", "ghost-shape"];
  return validateSealed(c, "aos-ghost"); // ok:true ONLY if the unknown shape WRONGLY passed
});

h.done();
