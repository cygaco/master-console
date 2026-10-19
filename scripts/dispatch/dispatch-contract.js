#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const ARGV_SCHEMA_VERSION = "1";
const CONTRACT_PATH = mcEnv.readEnv("DISPATCH_CONTRACT_PATH") || path.join(PROJECT_ROOT, ".claude", "agents", "_org", "dispatch-contract.json");
const REGISTRY_PATH = path.join(PROJECT_ROOT, ".claude", "agents", "_org", "role-registry.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

let _contract = null;
let _registry = null;
function loadContract(force) {
  if (!_contract || force) _contract = readJson(CONTRACT_PATH);
  return _contract;
}
function loadRegistry(force) {
  if (!_registry || force) _registry = readJson(REGISTRY_PATH);
  return _registry;
}

function registryAttrs(role) {
  const reg = loadRegistry();
  const r = reg.roles && reg.roles[role];
  if (!r) return null;
  return {
    tier: r.tier || null,
    kind: r.kind || null,
    provider: r.provider || null,
    build_chain: r.build_chain === true,
    claude_pinned: r.claude_pinned === true,
  };
}

function classForRole(role) {
  const contract = loadContract();
  const attrs = registryAttrs(role);
  if (!attrs) return null;
  const rules = (contract.class_derivation && contract.class_derivation.rules) || [];
  for (const rule of rules) {
    const w = rule.when || {};
    let match = true;
    for (const k of Object.keys(w)) {
      if (attrs[k] !== w[k]) { match = false; break; }
    }
    if (match) return rule.class;
  }
  return (contract.class_derivation && contract.class_derivation.fallback_class) || null;
}

function mergeContract(base, over) {
  if (!over) return base;
  const out = { ...base, ...over };
  for (const key of ["coverage", "budget"]) {
    if (base[key] || over[key]) out[key] = { ...(base[key] || {}), ...(over[key] || {}) };
  }
  delete out._doc;
  delete out._note;
  return out;
}

function contractForRole(role) {
  const contract = loadContract();
  const cls = classForRole(role);
  if (!cls) return { role, class: null, unknown: true };
  const classContract = (contract.role_classes && contract.role_classes[cls]) || {};
  const override = (contract.role_overrides && contract.role_overrides[role]) || null;
  const resolved = mergeContract(mergeContract(contract.defaults || {}, classContract), override);
  return { role, class: cls, ...resolved };
}

function toolMatches(allowed, toolId) {
  if (allowed == null) return toolId == null || toolId === null;
  if (Array.isArray(allowed)) return allowed.includes(toolId);
  return allowed === toolId;
}

function validateDispatch(req) {
  const violations = [];
  const role = req && req.role;
  const shape = req && req.shape;
  if (!role) return { ok: false, violations: ["no role supplied"], contract: null };
  const c = contractForRole(role);
  if (c.unknown) {
    return { ok: false, violations: [`role '${role}' is not in role-registry.json — cannot resolve a dispatch contract (fail-closed)`], contract: c };
  }
  if (!shape) {
    violations.push("no shape supplied");
  } else {
    const attrs = registryAttrs(role);
    if (attrs && attrs.build_chain && shape === "in-process-agent") {
      violations.push(`role '${role}' is build_chain (role-registry) and MUST NOT be dispatched in-process-agent — hard invariant, independent of the contract file.`);
    }
    const allowed = c.allowed_shapes || [];
    const forbidden = c.forbidden_shapes || [];
    if (forbidden.includes(shape)) {
      violations.push(`shape '${shape}' is FORBIDDEN for role '${role}' (class ${c.class}). Allowed: ${allowed.join(", ")}.`);
    } else if (!allowed.includes(shape)) {
      const hint = shape === "api" ? " — API availability never implies API dispatch." : "";
      violations.push(`shape '${shape}' is not allowed for role '${role}' (class ${c.class}). Allowed: ${allowed.join(", ")}.${hint}`);
    }
  }
  if (req && "toolId" in req && shape && !violations.length) {
    if (!toolMatches(c.tool_id, req.toolId)) {
      violations.push(`tool '${req.toolId}' does not match the contract tool_id (${JSON.stringify(c.tool_id)}) for role '${role}'.`);
    }
  }
  if (req && req.mode && shape && !violations.length) {
    const inMode = allowedShapesForRoleInMode(role, req.mode);
    if (!inMode.includes(shape)) {
      violations.push(`shape '${shape}' is class-allowed for role '${role}' but NARROWED OUT by mode '${req.mode}' (mode allows: ${inMode.join(", ") || "<none>"}).`);
    }
  }
  if (c.cwd_policy === "worktree-required") {
    if (req && req.worktreePending === true) {
    } else if (!req.cwd) {
      violations.push(`role '${role}' has cwd_policy 'worktree-required' but NO cwd was supplied — a build-chain dispatch must name its isolated worktree (omitting cwd is not a bypass).`);
    } else if (path.resolve(req.cwd) === PROJECT_ROOT) {
      violations.push(`role '${role}' has cwd_policy 'worktree-required' but cwd is the canonical root — a build-chain role must run in an isolated worktree.`);
    }
  }
  return { ok: violations.length === 0, violations, contract: c };
}

function validateDispatchForClass(req) {
  const violations = [];
  const className = req && req.class;
  const shape = req && req.shape;
  if (!className) return { ok: false, violations: ["no class supplied"], contract: null };
  const contract = loadContract();
  const classContract = contract.role_classes && contract.role_classes[className];
  if (!classContract) {
    return {
      ok: false,
      violations: [`class '${className}' is not in role_classes — cannot resolve a dispatch contract`],
      contract: null,
    };
  }
  const resolved = mergeContract(contract.defaults || {}, classContract);
  if (!shape) {
    violations.push("no shape supplied");
  } else {
    const allowed = resolved.allowed_shapes || [];
    const forbidden = resolved.forbidden_shapes || [];
    if (forbidden.includes(shape)) {
      violations.push(`shape '${shape}' is FORBIDDEN for class '${className}'. Allowed: ${allowed.join(", ")}.`);
    } else if (!allowed.includes(shape)) {
      const hint = shape === "api" ? " — API availability never implies API dispatch." : "";
      violations.push(`shape '${shape}' is not allowed for class '${className}'. Allowed: ${allowed.join(", ")}.${hint}`);
    }
  }
  if (req && "toolId" in req && shape && !violations.length) {
    if (!toolMatches(resolved.tool_id, req.toolId)) {
      violations.push(`tool '${req.toolId}' does not match the contract tool_id (${JSON.stringify(resolved.tool_id)}) for class '${className}'.`);
    }
  }
  if (req && req.mode && shape && !violations.length) {
    const inMode = allowedShapesForClassInMode(className, req.mode);
    if (!inMode.includes(shape)) {
      violations.push(`shape '${shape}' is class-allowed for class '${className}' but NARROWED OUT by mode '${req.mode}' (mode allows: ${inMode.join(", ") || "<none>"}).`);
    }
  }
  if (resolved.cwd_policy === "worktree-required") {
    if (req && req.worktreePending === true) {
    } else if (!req.cwd) {
      violations.push(`class '${className}' has cwd_policy 'worktree-required' but NO cwd was supplied — a build-chain dispatch must name its isolated worktree (omitting cwd is not a bypass).`);
    } else if (path.resolve(req.cwd) === PROJECT_ROOT) {
      violations.push(`class '${className}' has cwd_policy 'worktree-required' but cwd is the canonical root — a build-chain role must run in an isolated worktree.`);
    }
  }
  return { ok: violations.length === 0, violations, contract: { class: className, ...resolved } };
}

function sanctionedLane(req) {
  const role = req && req.role;
  const shape = req && req.shape;
  const laneName = req && req.lane;
  if (!role || !shape || !laneName) {
    return { sanctioned: false, lane: laneName || null, shape: shape || null, reason: "role, shape, and lane are all required", classes: [] };
  }
  const contract = loadContract();
  const lanes = contract.sanctioned_lanes || {};
  const lane = lanes[laneName];
  if (!lane || typeof lane !== "object" || laneName.startsWith("_")) {
    return { sanctioned: false, lane: laneName, shape, reason: `no sanctioned lane '${laneName}' is registered in the dispatch contract`, classes: [] };
  }
  const classes = Array.isArray(lane.applies_to_classes) ? lane.applies_to_classes : [];
  if (lane.shape !== shape) {
    return { sanctioned: false, lane: laneName, shape, reason: `lane '${laneName}' sanctions shape '${lane.shape}', not '${shape}'`, classes };
  }
  const cls = classForRole(role);
  if (!cls) {
    return { sanctioned: false, lane: laneName, shape, reason: `role '${role}' does not resolve to a class — cannot match a sanctioned lane (fail-closed)`, classes };
  }
  if (!classes.includes(cls)) {
    return { sanctioned: false, lane: laneName, shape, reason: `role '${role}' (class '${cls}') is not in lane '${laneName}' applies_to_classes [${classes.join(", ")}] — not sanctioned`, classes };
  }
  return { sanctioned: true, lane: laneName, shape, reason: `sanctioned lane '${laneName}': shape '${shape}' registered for class '${cls}'`, classes, class: cls };
}

function modeProfile(mode) {
  const contract = loadContract();
  const mp = contract.mode_profiles && contract.mode_profiles[mode];
  if (!mp || mode.startsWith("_")) return null;
  return mp;
}

function allowedShapesForRoleInMode(role, mode) {
  const c = contractForRole(role);
  const classAllowed = (c && c.allowed_shapes) || [];
  const mp = mode ? modeProfile(mode) : null;
  if (!mp) return classAllowed.slice();
  let narrow = null;
  if (mp.role_shapes && Array.isArray(mp.role_shapes[role])) narrow = mp.role_shapes[role];
  else if (mp.class_shapes && c && c.class && Array.isArray(mp.class_shapes[c.class])) narrow = mp.class_shapes[c.class];
  if (!narrow) return classAllowed.slice();
  return classAllowed.filter((s) => narrow.includes(s));
}

function allowedShapesForClassInMode(className, mode) {
  const contract = loadContract();
  const classContract = contract.role_classes && contract.role_classes[className];
  const resolved = mergeContract(contract.defaults || {}, classContract || {});
  const classAllowed = resolved.allowed_shapes || [];
  const mp = mode ? modeProfile(mode) : null;
  if (!mp) return classAllowed.slice();
  const narrow =
    mp.class_shapes && Array.isArray(mp.class_shapes[className])
      ? mp.class_shapes[className]
      : null;
  if (!narrow) return classAllowed.slice();
  return classAllowed.filter((s) => narrow.includes(s));
}

function skillExecution(skill) {
  const contract = loadContract();
  const cand = contract.skills && contract.skills.candidates && contract.skills.candidates[skill];
  if (!cand) return { skill, execution: "inline", verified: false, source: "default" };
  if (cand.execution === "subprocess" && cand.subprocess_verified !== true) {
    return { skill, execution: "inline", verified: false, source: "unverified-subprocess-falls-back-to-inline" };
  }
  return { skill, execution: cand.execution, verified: cand.subprocess_verified === true, source: "candidate" };
}

function validateContractFile() {
  const violations = [];
  let contract, reg;
  try {
    contract = loadContract(true);
    reg = loadRegistry(true);
  } catch (e) {
    return { ok: false, violations: [`cannot load contract/registry: ${e && e.message ? e.message : e}`] };
  }
  const shapeNames = new Set(Object.keys(contract.shapes || {}));
  const classNames = new Set(Object.keys(contract.role_classes || {}));

  for (const [cls, def] of Object.entries(contract.role_classes || {})) {
    for (const s of def.allowed_shapes || []) if (!shapeNames.has(s)) violations.push(`class ${cls} allows unknown shape '${s}'`);
    for (const s of def.forbidden_shapes || []) if (!shapeNames.has(s)) violations.push(`class ${cls} forbids unknown shape '${s}'`);
    for (const s of def.allowed_shapes || []) if ((def.forbidden_shapes || []).includes(s)) violations.push(`class ${cls} both allows AND forbids '${s}'`);
  }
  for (const rule of (contract.class_derivation && contract.class_derivation.rules) || []) {
    if (!classNames.has(rule.class)) violations.push(`class_derivation rule -> unknown class '${rule.class}'`);
  }
  const fb = contract.class_derivation && contract.class_derivation.fallback_class;
  if (fb && !classNames.has(fb)) violations.push(`fallback_class '${fb}' is not a defined class`);

  const scrapped = new Set(Object.keys(reg.scrapped || {}));
  for (const role of Object.keys(reg.roles || {})) {
    const cls = classForRole(role);
    if (!cls || !classNames.has(cls)) {
      violations.push(`registry role '${role}' does not resolve to a defined class (got ${JSON.stringify(cls)})`);
      continue;
    }
    const c = contractForRole(role);
    const attrs = registryAttrs(role);
    if (attrs && attrs.build_chain) {
      if ((c.allowed_shapes || []).includes("in-process-agent")) violations.push(`build-chain role '${role}' must NOT allow in-process-agent`);
      if (!(c.forbidden_shapes || []).includes("in-process-agent")) violations.push(`build-chain role '${role}' must FORBID in-process-agent`);
      if (!(c.allowed_shapes || []).includes("subprocess-claude")) violations.push(`build-chain role '${role}' must allow subprocess-claude`);
    }
    if (attrs && attrs.kind === "reviewer" && attrs.provider && attrs.provider !== "claude") {
      if (!(c.forbidden_shapes || []).includes("in-process-agent")) violations.push(`cross-provider reviewer '${role}' must FORBID in-process-agent (provider diversity)`);
    }
  }
  for (const [laneName, lane] of Object.entries(contract.sanctioned_lanes || {})) {
    if (laneName.startsWith("_")) continue;
    if (!lane || typeof lane !== "object") {
      violations.push(`sanctioned_lane '${laneName}' is not an object`);
      continue;
    }
    if (!shapeNames.has(lane.shape)) violations.push(`sanctioned_lane '${laneName}' sanctions the unknown shape '${lane.shape}'`);
    const laneClasses = lane.applies_to_classes;
    if (!Array.isArray(laneClasses) || laneClasses.length === 0) {
      violations.push(`sanctioned_lane '${laneName}' must list a NON-EMPTY applies_to_classes array (no wildcard — sanctioned-lane over-breadth is a redteam case)`);
    } else {
      for (const cls of laneClasses) {
        if (!classNames.has(cls)) violations.push(`sanctioned_lane '${laneName}' references unknown class '${cls}'`);
      }
    }
  }

  for (const role of Object.keys(contract.role_overrides || {})) {
    if (role.startsWith("_")) continue;
    if (!reg.roles || !reg.roles[role]) {
      if (scrapped.has(role)) violations.push(`role_override '${role}' targets a SCRAPPED role`);
      else violations.push(`role_override '${role}' is not a role in role-registry.json`);
    }
  }

  for (const [mode, profile] of Object.entries(contract.mode_profiles || {})) {
    if (mode.startsWith("_")) continue;
    if (!profile || typeof profile !== "object") {
      violations.push(`mode_profile '${mode}' is not an object`);
      continue;
    }
    const cs = profile.class_shapes || {};
    for (const [cls, shapes] of Object.entries(cs)) {
      if (cls.startsWith("_")) continue;
      const classDef = contract.role_classes && contract.role_classes[cls];
      if (!classDef) {
        violations.push(`mode_profile '${mode}' references unknown class '${cls}'`);
        continue;
      }
      if (!Array.isArray(shapes)) {
        violations.push(`mode_profile '${mode}'.class_shapes['${cls}'] must be an array of shapes`);
        continue;
      }
      const ceiling = classDef.allowed_shapes || (contract.defaults && contract.defaults.allowed_shapes) || [];
      for (const s of shapes) {
        if (!shapeNames.has(s)) violations.push(`mode_profile '${mode}' grants class '${cls}' the unknown shape '${s}'`);
        else if (!ceiling.includes(s)) {
          violations.push(`mode_profile '${mode}' WIDENS class '${cls}' to shape '${s}' which is NOT in the class allowed_shapes [${ceiling.join(", ")}] — a mode profile may only NARROW, never widen past the class ceiling (security invariant).`);
        }
      }
    }
    const rs = profile.role_shapes || {};
    for (const [role, shapes] of Object.entries(rs)) {
      if (role.startsWith("_")) continue;
      if (!reg.roles || !reg.roles[role]) {
        violations.push(`mode_profile '${mode}'.role_shapes references '${role}' which is not a role in role-registry.json`);
        continue;
      }
      if (!Array.isArray(shapes)) {
        violations.push(`mode_profile '${mode}'.role_shapes['${role}'] must be an array of shapes`);
        continue;
      }
      const ceiling = (contractForRole(role).allowed_shapes) || [];
      for (const s of shapes) {
        if (!shapeNames.has(s)) violations.push(`mode_profile '${mode}' grants role '${role}' the unknown shape '${s}'`);
        else if (!ceiling.includes(s)) {
          violations.push(`mode_profile '${mode}' WIDENS role '${role}' to shape '${s}' which is NOT in its allowed_shapes [${ceiling.join(", ")}] — a mode profile may only NARROW, never widen past the role ceiling (security invariant).`);
        }
      }
    }
    if ("alpha_only_shapes" in profile) {
      const aos = profile.alpha_only_shapes;
      if (!Array.isArray(aos)) {
        violations.push(`mode_profile '${mode}'.alpha_only_shapes must be an array of shapes`);
      } else {
        for (const s of aos) {
          if (!shapeNames.has(s)) violations.push(`mode_profile '${mode}'.alpha_only_shapes lists the unknown shape '${s}' (must be a known dispatch shape)`);
        }
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function contractEnforceMode(wrapperKey, env) {
  const e = env || process.env;
  if (/^(1|true|yes)$/i.test(String(mcEnv.readEnv("DISABLE_SHAPE_DOOR", e) || ""))) return false;
  const isOff = (v) => /^(report|off|0|false|no)$/.test(v);
  const isOn = (v) => /^(enforce|block|1|true|yes)$/.test(v);
  const per = String(mcEnv.readEnv(`DISPATCH_CONTRACT_ENFORCE_${wrapperKey}`, e) || "").toLowerCase();
  if (isOff(per)) return false;
  if (isOn(per)) return true;
  const g = String(mcEnv.readEnv("DISPATCH_CONTRACT_ENFORCE", e) || "").toLowerCase();
  if (isOff(g)) return false;
  if (isOn(g)) return true;
  return true;
}

module.exports = {
  loadContract, loadRegistry, classForRole, contractForRole, validateDispatch,
  validateDispatchForClass, sanctionedLane, contractEnforceMode,
  skillExecution, validateContractFile, registryAttrs, CONTRACT_PATH, REGISTRY_PATH,
  ARGV_SCHEMA_VERSION, modeProfile, allowedShapesForRoleInMode, allowedShapesForClassInMode,
};

if (require.main === module) {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "validate") {
    const res = validateContractFile();
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(res.ok ? 0 : 1);
  }
  if (cmd === "role" && rest[0]) {
    process.stdout.write(JSON.stringify(contractForRole(rest[0]), null, 2) + "\n");
    process.exit(0);
  }
  if (cmd === "check" && rest[0]) {
    const res = validateDispatch({ role: rest[0], shape: rest[1], toolId: rest[2] });
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(res.ok ? 0 : 1);
  }
  process.stderr.write("usage: dispatch-contract.js validate | role <role> | check <role> <shape> [toolId]\n");
  process.exit(2);
}
