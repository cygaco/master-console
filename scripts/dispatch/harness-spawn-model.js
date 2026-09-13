#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * harness-spawn-model.js — the Agent-tool CHANNEL model resolver (SP-20260718-003 D1, ED-208).
 *
 * THE TWO TRUTHS THIS SEPARATES (PRD R-2 / AC-2):
 *   1. LOGICAL ROLE ROUTING (who reviews whom, on which provider/model for cross-provider
 *      diversity) — owned by the role-registry + getProviderForRole/passesOf (the CLI path).
 *   2. INVOCATION-CHANNEL CAPABILITY (what a given spawn channel can actually run) — the harness
 *      Agent tool spawns ONLY Claude models. A registry role pinned to openai/antigravity/gemini
 *      CANNOT be spawned in-process on its native model; the harness silently fails (ED-208) or,
 *      worse, resolves a Claude clone that MASQUERADES as the pinned provider (the D1↔D5 false-green
 *      this phase kills). So an in-process Agent-tool spawn of a non-Claude role must resolve a
 *      Claude model BY CONSTRUCTION — never the registry's non-Claude pin.
 *
 * `harnessSpawnModel(role)` is that resolver. It ALWAYS returns a Claude model for the Agent-tool
 * channel, and it governs ONLY that channel — getProviderForRole / passesOf (the CLI dispatch path,
 * which routes to the real provider for cross-provider review) are UNTOUCHED. This is the structural
 * replacement of the manual `model:"opus"` workaround (project_harness_spawn_claude_model_override):
 * the channel-model is DERIVED from the role's tier, not hand-passed per spawn.
 *
 * Resolution (pure, deterministic):
 *   - a NATIVE-CLAUDE role (provider === "claude", incl. claude_pinned visual judges) → its OWN
 *     model (already a valid Agent-tool model);
 *   - a NON-CLAUDE role → its TIER mapped to a Claude model (capability tier preserved, provider
 *     coerced to Claude): face/director/lead → claude-opus-4-8 (the proven harness in-process model,
 *     support-matrix Addendum A), worker/tool → claude-sonnet-5.
 *   - an unknown role → the face-tier Claude model (fail-SAFE: a real Claude model, never a
 *     non-Claude pin — the channel invariant holds even off the happy path).
 *
 * The invariant the test asserts (AC-2, both halves): for a non-Claude role,
 *   harnessSpawnModel(role).model  starts with "claude-"   (channel coerced to Claude),
 *   getProviderForRole(role)       is UNCHANGED (still openai/antigravity)  — CLI routing intact.
 *
 * See ADR (D9): "Agent-tool channel = Claude-only capability, distinct from registry role-routing"
 * (ED-208 resolved).
 *
 *   node scripts/dispatch/harness-spawn-model.js <role> [--json]
 */
const path = require("path");

// The proven harness in-process face/director/lead model + the worker/tool model. These are the two
// Claude models the harness Agent-tool channel is PROVEN to spawn (support-matrix.json Addendum A:
// claude-opus-4-8 / harness / proven:true). Env-overridable so a model-string rotation is one var,
// not a code edit (same discipline as providers.js OPENAI_FLAGSHIP).
const HARNESS_FACE_MODEL = mcEnv.readEnv("HARNESS_FACE_MODEL") || "claude-opus-4-8";
const HARNESS_WORKER_MODEL = mcEnv.readEnv("HARNESS_WORKER_MODEL") || "claude-sonnet-5";

// tier → the Claude model the Agent-tool channel spawns for a NON-Claude role. Capability tier is
// preserved (a director-tier reviewer still gets the top Claude brain); only the PROVIDER is coerced.
const TIER_CLAUDE_MODEL = Object.freeze({
  face: HARNESS_FACE_MODEL,
  director: HARNESS_FACE_MODEL,
  lead: HARNESS_FACE_MODEL,
  worker: HARNESS_WORKER_MODEL,
  tool: HARNESS_WORKER_MODEL,
});

function loadRolesSafe() {
  try {
    return require("./registry-roles").loadRoles();
  } catch {
    return {};
  }
}

/**
 * Resolve the Claude model the harness Agent-tool channel must spawn for `role`. PURE given its
 * `roles` seam (default = the live registry) so the bite-test drives every branch off a stub.
 *
 * @param {string} role
 * @param {object} [roles]  registry roles object (default = live registry)
 * @returns {{ role, model, source, coerced_from:(string|null), reason }}
 */
function harnessSpawnModel(role, roles) {
  const r = (roles || loadRolesSafe())[role];

  // Unknown role → the face-tier Claude model. FAIL-SAFE: the channel invariant (a Claude model,
  // never a non-Claude pin) holds even when the role can't be resolved.
  if (!r || typeof r !== "object") {
    return {
      role,
      model: HARNESS_FACE_MODEL,
      source: "default-unknown-role",
      coerced_from: null,
      reason: `unknown role '${role}' — defaulting to the face-tier Claude model (the Agent-tool channel is Claude-only)`,
    };
  }

  // A native-Claude role (provider "claude", which includes the claude_pinned visual judges) keeps
  // its OWN model — it is already a valid Agent-tool Claude model. If a Claude role somehow carries
  // no model, fall through to the tier map so we still return a real Claude model.
  if (r.provider === "claude" && r.model) {
    return {
      role,
      model: r.model,
      source: r.claude_pinned === true ? "claude-pinned" : "claude-native",
      coerced_from: null,
      reason: "role is native-Claude — its own model is a valid Agent-tool model (channel unchanged)",
    };
  }

  // THE ED-208 CORE: a non-Claude registry pin cannot spawn via the harness Agent-tool channel on
  // its native model. Coerce to a Claude model by the role's TIER — capability preserved, provider
  // forced to Claude. This is what makes an in-process reviewer NEVER a silent Claude clone wearing
  // the openai/antigravity label.
  const tier = String(r.tier || "").toLowerCase();
  const model = TIER_CLAUDE_MODEL[tier] || HARNESS_FACE_MODEL;
  return {
    role,
    model,
    source: "tier-coerced",
    coerced_from: r.provider || null,
    reason: `non-Claude registry pin (${r.provider || "unknown"}) coerced to a Claude model by tier '${tier || "?"}' — the Agent-tool channel is Claude-only (ED-208)`,
  };
}

/** True iff `model` is a Claude model id (the channel invariant, exported for the test + callers). */
function isClaudeModel(model) {
  return typeof model === "string" && /^claude-/.test(model);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv) {
  const role = argv.find((a) => !a.startsWith("--"));
  const json = argv.includes("--json");
  if (!role) {
    process.stderr.write("usage: harness-spawn-model.js <role> [--json]\n");
    return 2;
  }
  const out = harnessSpawnModel(role);
  if (json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write(`${out.role} → ${out.model}  (${out.source})  ${out.reason}\n`);
  }
  // Non-zero if — impossibly — the resolver ever returned a non-Claude model (a broken invariant is
  // a loud failure, not a silent bad spawn).
  return isClaudeModel(out.model) ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  harnessSpawnModel,
  isClaudeModel,
  HARNESS_FACE_MODEL,
  HARNESS_WORKER_MODEL,
  TIER_CLAUDE_MODEL,
};
