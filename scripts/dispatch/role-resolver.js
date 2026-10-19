"use strict";
const fs = require("fs");
const path = require("path");

const DISPATCH_CHANNELS = Object.freeze(["dispatch-claude", "dispatch-agent"]);
const TOP_LEVEL_CHANNELS = Object.freeze(["session-bootstrap", "helm"]);

const TOP_LEVEL_ONLY_ROLES = Object.freeze(["alex-alpha", "alpha", "president"]);

function isPresidentIdentity(role) {
  if (!role || typeof role !== "string") return false;
  const mapped = role.replace(/[αΑ]/g, "alpha");
  const norm = mapped.toLowerCase().replace(/[^a-z]/g, "");
  return norm === "alpha" || norm === "alex" || norm.includes("alexalpha") || norm.includes("president");
}

const CANONICAL_PRESIDENT_ROLES = Object.freeze(["alex-alpha", "alpha"]);
function isCanonicalPresidentRole(role) {
  if (!role || typeof role !== "string") return false;
  const norm = role.toLowerCase().replace(/[^a-z]/g, "");
  return norm === "alexalpha" || norm === "alpha";
}

function actorKindForChannel(channel) {
  if (DISPATCH_CHANNELS.includes(channel)) return "dispatched_worker";
  if (TOP_LEVEL_CHANNELS.includes(channel)) return "top_level_session";
  return null;
}

function defaultKernelDir() {
  const anchored = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchored, ".claude", "kernel", "role-binding.json")))
    return path.join(anchored, ".claude", "kernel");
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(path.join(envRoot, ".claude", "kernel", "role-binding.json")))
    return path.join(envRoot, ".claude", "kernel");
  return path.join(anchored, ".claude", "kernel");
}

function defaultKnownRoles() {
  try {
    const rr = require("./registry-roles");
    const ids = rr.roleIds();
    return Array.isArray(ids) && ids.length ? ids : null;
  } catch {
    return null;
  }
}

function validateRoleBinding(rb, roleBindingPath) {
  if (!rb || typeof rb !== "object" || Array.isArray(rb)) {
    const err = new Error(`role binding ${roleBindingPath} is not a JSON object`);
    err.code = "ROLE_BINDING_SHAPE_ERROR";
    throw err;
  }
  if (!Array.isArray(rb.order) || rb.order.length === 0) {
    const err = new Error(`role binding ${roleBindingPath} missing/invalid 'order' (must be a non-empty array)`);
    err.code = "ROLE_BINDING_SHAPE_ERROR";
    throw err;
  }
  if (!rb.sources || typeof rb.sources !== "object" || Array.isArray(rb.sources)) {
    const err = new Error(`role binding ${roleBindingPath} missing/invalid 'sources' (must be an object)`);
    err.code = "ROLE_BINDING_SHAPE_ERROR";
    throw err;
  }
  if (typeof rb.worker_default_when_unbound !== "string" || !rb.worker_default_when_unbound) {
    const err = new Error(
      `role binding ${roleBindingPath} missing/invalid 'worker_default_when_unbound' (must be a non-empty string)`,
    );
    err.code = "ROLE_BINDING_SHAPE_ERROR";
    throw err;
  }
  return rb;
}

function loadRoleBinding(kernelDir) {
  const roleBindingPath = path.join(kernelDir, "role-binding.json");
  let text;
  try {
    text = fs.readFileSync(roleBindingPath, "utf8");
  } catch (e) {
    const err = new Error(`role binding ${roleBindingPath} is unreadable: ${(e && e.message) || e}`);
    err.code = "ROLE_BINDING_READ_ERROR";
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    const err = new Error(`role binding ${roleBindingPath} is not valid JSON: ${(e && e.message) || e}`);
    err.code = "ROLE_BINDING_PARSE_ERROR";
    throw err;
  }
  return validateRoleBinding(parsed, roleBindingPath);
}

function evaluateRoleBinding(input, rb) {
  rb = rb || {};
  const sources = rb.sources || {};
  if (input.actor_kind === "dispatched_worker") {
    const presented = [
      { field: "explicit_user_instruction", source: "explicit_user" },
      { field: "validated_workorder_or_cli_binding", source: "validated_workorder_or_cli" },
      { field: "explicit_top_level_helm_binding", source: "explicit_top_level_helm" },
    ].filter((m) => input[m.field]);

    if (presented.length === 0) {
      return {
        outcome: rb.worker_default_when_unbound === "FAIL_CLOSED" ? "BLOCK" : "PASS",
        reason: "unbound dispatched worker; worker_default_when_unbound governs",
      };
    }

    for (const m of presented) {
      const src = sources[m.source] || {};
      const appliesTo = Array.isArray(src.applies_to_actor) ? src.applies_to_actor : [];
      if (!appliesTo.includes("dispatched_worker")) {
        return {
          outcome: "BLOCK",
          reason: `dispatched_worker presented '${m.source}', scoped to applies_to_actor=[${appliesTo.join(", ")}] only -- category error, fail-closed (CORE-1)`,
        };
      }
    }

    const bound = presented.some((m) => (sources[m.source] || {}).can_bind);
    if (!bound) {
      return {
        outcome: rb.worker_default_when_unbound === "FAIL_CLOSED" ? "BLOCK" : "PASS",
        reason: "presented source(s) are actor-scoped to dispatched_worker but none is can_bind:true; worker_default_when_unbound governs",
      };
    }
    return { outcome: "PASS", reason: "role resolved through the precedence order (actor-scoped to dispatched_worker)" };
  }
  if (input.attempted_binding_source) {
    const src = sources[input.attempted_binding_source] || {};
    return {
      outcome: src.can_bind ? "PASS" : "BLOCK",
      reason: `sources.${input.attempted_binding_source}.can_bind = ${!!src.can_bind}`,
    };
  }
  return { outcome: "BLOCK", reason: "unrecognized role-binding input shape (fail-closed)" };
}

const KNOWN_ACTORS = Object.freeze(["top_level_session", "dispatched_worker"]);

function validateRoleBindingValues(rb) {
  const errors = [];
  if (rb.worker_default_when_unbound !== "FAIL_CLOSED")
    errors.push(
      `worker_default_when_unbound must be "FAIL_CLOSED" (got ${JSON.stringify(rb.worker_default_when_unbound)}) — any other value flips CORE-1 open`,
    );
  if (rb.top_level_default_binding_source !== "helm_only")
    errors.push(`top_level_default_binding_source must be "helm_only" (got ${JSON.stringify(rb.top_level_default_binding_source)})`);
  if (!isCanonicalPresidentRole(rb.top_level_human_default))
    errors.push(
      `top_level_human_default ${JSON.stringify(rb.top_level_human_default)} is not the canonical President identity (a bogus/invented top-level default is a control-integrity failure)`,
    );
  for (const o of rb.order || []) {
    if (o === "UNBOUND") continue;
    if (!rb.sources || !rb.sources[o]) errors.push(`order entry '${o}' has no sources[${o}] entry (graph not total over 'order')`);
  }
  for (const [name, src] of Object.entries(rb.sources || {})) {
    if (!src || typeof src !== "object") {
      errors.push(`sources.${name} must be an object`);
      continue;
    }
    if (typeof src.can_bind !== "boolean") errors.push(`sources.${name}.can_bind must be a boolean`);
    if (src.applies_to_actor !== undefined) {
      if (!Array.isArray(src.applies_to_actor) || src.applies_to_actor.some((a) => !KNOWN_ACTORS.includes(a)))
        errors.push(`sources.${name}.applies_to_actor must be a subset of [${KNOWN_ACTORS.join(", ")}]`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function deriveBinding({ channel, role, workorder } = {}, opts = {}) {
  let rb;
  try {
    rb = opts.rb || loadRoleBinding(opts.kernelDir || defaultKernelDir());
  } catch (e) {
    return { actor_kind: null, boundRole: null, ok: false, failClosed: true, reason: `role-binding control unreadable/invalid (fail-closed): ${e.message}` };
  }
  const vv = validateRoleBindingValues(rb);
  if (!vv.ok)
    return { actor_kind: null, boundRole: null, ok: false, failClosed: true, reason: `role-binding VALUE invalid (fail-closed): ${vv.errors.join("; ")}` };

  const actor_kind = actorKindForChannel(channel);
  if (!actor_kind)
    return {
      actor_kind: null,
      boundRole: null,
      ok: false,
      failClosed: true,
      reason: `unknown/absent dispatch channel ${JSON.stringify(channel)} — no actor_kind derivable (fail-closed; ambient text can never supply one)`,
    };

  const knownRoles = opts.knownRoles !== undefined ? opts.knownRoles : defaultKnownRoles();

  if (actor_kind === "dispatched_worker") {
    if (!role || typeof role !== "string")
      return {
        actor_kind,
        boundRole: null,
        ok: false,
        failClosed: true,
        reason: "dispatched worker with no channel-asserted role — UNBOUND, fail-closed (CORE-1); never defaults to President",
      };
    if (isPresidentIdentity(role))
      return {
        actor_kind,
        boundRole: null,
        ok: false,
        failClosed: true,
        reason: `dispatched worker asked to bind President-identity role '${role}' — category error, BLOCK (closes the worktree President-identity leak, CORE-1)`,
      };
    if (Array.isArray(knownRoles) && knownRoles.length && !knownRoles.includes(role))
      return {
        actor_kind,
        boundRole: null,
        ok: false,
        failClosed: false,
        reason: `bound role '${role}' is not a known role-registry id (benign — dispatched_worker, never President)`,
      };
    let validatedWorkorderOrCli = true;
    let workorderFailReason = null;
    let bindingSource;
    if (workorder !== undefined && workorder !== null) {
      try {
        const validateWorkOrder = opts.workorderValidate || require("./workorder-validator").validate;
        const wv = validateWorkOrder(workorder, opts.workorderOpts || {});
        validatedWorkorderOrCli = !!(wv && wv.ok);
        if (!validatedWorkorderOrCli) workorderFailReason = (wv && wv.reason) || "workorder validation failed (validator returned no reason)";
      } catch (e) {
        validatedWorkorderOrCli = false;
        workorderFailReason = `workorder-validator unavailable (fail-closed): ${e.message}`;
      }
      bindingSource = "workorder-validated";
    } else {
      bindingSource = "cli-channel";
    }

    const out = evaluateRoleBinding({ actor_kind, validated_workorder_or_cli_binding: validatedWorkorderOrCli }, rb);
    if (out.outcome !== "PASS")
      return {
        actor_kind,
        boundRole: null,
        ok: false,
        failClosed: true,
        reason: workorderFailReason
          ? `WorkOrder validation failed (fail-closed): ${workorderFailReason}`
          : `precedence graph did not resolve dispatched worker: ${out.reason}`,
      };
    return {
      actor_kind,
      boundRole: role,
      ok: true,
      failClosed: false,
      binding_source: bindingSource,
      reason:
        bindingSource === "workorder-validated"
          ? "bound via workorder-validated (WorkOrder schema + same-session provenance validated); derived-not-settable, ambient text inert (CORE-3)"
          : "bound via cli-channel (channel-derived argv role; no WorkOrder presented); derived-not-settable, ambient text inert (CORE-3)",
    };
  }

  const out = evaluateRoleBinding({ attempted_binding_source: "explicit_top_level_helm" }, rb);
  if (out.outcome !== "PASS")
    return { actor_kind, boundRole: null, ok: false, failClosed: true, reason: `top-level helm binding did not resolve: ${out.reason}` };
  if (!isCanonicalPresidentRole(rb.top_level_human_default))
    return {
      actor_kind,
      boundRole: null,
      ok: false,
      failClosed: true,
      reason: `top_level_human_default '${rb.top_level_human_default}' is not the canonical President identity — refusing a bogus top-level binding (fail-closed)`,
    };
  return {
    actor_kind,
    boundRole: rb.top_level_human_default,
    ok: true,
    failClosed: false,
    reason: "top-level human-facing session bound to the President helm default (helm_only); ambient prose inert (CORE-3)",
  };
}

module.exports = {
  DISPATCH_CHANNELS,
  TOP_LEVEL_CHANNELS,
  TOP_LEVEL_ONLY_ROLES,
  CANONICAL_PRESIDENT_ROLES,
  isPresidentIdentity,
  isCanonicalPresidentRole,
  actorKindForChannel,
  defaultKernelDir,
  defaultKnownRoles,
  validateRoleBinding,
  loadRoleBinding,
  evaluateRoleBinding,
  validateRoleBindingValues,
  deriveBinding,
};
