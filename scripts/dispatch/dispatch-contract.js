#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * dispatch-contract.js — reader + validator for the dispatch-shape keystone
 * (.claude/agents/_org/dispatch-contract.json, PLAN §17.1).
 *
 * role-registry.json owns role IDENTITY; this resolves the dispatch SHAPE contract
 * for a role by DERIVING its class from registry attributes (single source — no
 * duplicated role list), then merging defaults <- class <- role_override.
 *
 * The consumer API `validateDispatch({role, shape, toolId, cwd})` encodes the three
 * operator-named dispatch failures as contract violations:
 *   (ii)  API-when-CLI            => shape 'api' for a role whose allowed_shapes lacks it.
 *   (iii) in-process-when-subproc => shape 'in-process-agent' on a forbidden role (build-chain).
 *   (i)   skipped coverage        => surfaced by the coverage gate using `coverage` here.
 *
 * `validateContractFile()` is the keystone integrity check (every registry role
 * resolves; classes reference real shapes; the build-chain<->in-process invariant
 * holds). Pure functions; CLI: `node scripts/dispatch/dispatch-contract.js validate`.
 *
 * Zero runtime deps.
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// PLAN §17.4: the coverage-record argv/stamp schema version. Bumped whenever the
// set of §17.4 fields a wrapper stamps (or their meaning) changes, so the coverage
// gate can REJECT a record written under an older/unknown schema as stale or
// backfilled (a record's mere existence is not coverage). Both wrappers stamp it;
// the coverage gate requires the CURRENT value. One source of truth here in the
// dispatch keystone — both wrappers + the gate already read this module.
const ARGV_SCHEMA_VERSION = "1";
// Path-override seam (downstream products + tests): point at an alternate contract
// or registry without code change. Defaults to the canonical _org/ keystones.
const CONTRACT_PATH = mcEnv.readEnv("DISPATCH_CONTRACT_PATH") || path.join(PROJECT_ROOT, ".claude", "agents", "_org", "dispatch-contract.json");
// GPT-5.5 review R2 HIGH: role IDENTITY (the basis of the build_chain hard
// invariant) must NOT be env-overridable — a hostile env could redefine which
// roles are build_chain and bypass the in-process rejection. The registry path is
// FIXED to canonical (resolved per-install from this file's location). The CONTRACT
// path stays overridable (downstream products + tests supply their own contract),
// but never their own role identity.
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

/** Registry attributes for a role (or null if unknown). */
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

/** Apply class_derivation rules (first match) to a role's registry attributes. */
function classForRole(role) {
  const contract = loadContract();
  const attrs = registryAttrs(role);
  if (!attrs) return null; // unknown role — caller decides (validateDispatch flags it)
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
  // one-level-deep merge for the nested policy objects.
  for (const key of ["coverage", "budget"]) {
    if (base[key] || over[key]) out[key] = { ...(base[key] || {}), ...(over[key] || {}) };
  }
  // strip _doc/_note noise from a resolved contract.
  delete out._doc;
  delete out._note;
  return out;
}

/**
 * The resolved dispatch contract for a role: defaults <- class <- role_override.
 * Returns { role, class, ...contract } or { role, class:null, unknown:true }.
 */
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

/**
 * Validate a proposed dispatch against the role's contract.
 *   { role, shape, toolId?, cwd? } -> { ok, violations[], contract }
 * Encodes failures (ii) + (iii); (i) is the coverage gate's job (it reads `coverage`).
 */
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
    // DEFENSE-IN-DEPTH (GPT-5.5 review MEDIUM fix): enforce the build_chain ->
    // NOT-in-process invariant DIRECTLY against role-registry, independent of the
    // merged contract. A misconfigured class/override that accidentally re-allowed
    // in-process-agent for a build-chain role would otherwise pass; this hard check
    // can't be bypassed by editing dispatch-contract.json. (validateContractFile
    // remains the integrity gate; this is the runtime backstop.)
    const attrs = registryAttrs(role);
    if (attrs && attrs.build_chain && shape === "in-process-agent") {
      violations.push(`role '${role}' is build_chain (role-registry) and MUST NOT be dispatched in-process-agent — hard invariant, independent of the contract file.`);
    }
    const allowed = c.allowed_shapes || [];
    const forbidden = c.forbidden_shapes || [];
    if (forbidden.includes(shape)) {
      // (iii) in-process-when-subprocess for build-chain is the canonical case.
      violations.push(`shape '${shape}' is FORBIDDEN for role '${role}' (class ${c.class}). Allowed: ${allowed.join(", ")}.`);
    } else if (!allowed.includes(shape)) {
      // (ii) api-when-CLI lands here: 'api' not in a CLI role's allowed_shapes.
      const hint = shape === "api" ? " — API availability never implies API dispatch (PLAN §3/N-2)." : "";
      violations.push(`shape '${shape}' is not allowed for role '${role}' (class ${c.class}). Allowed: ${allowed.join(", ")}.${hint}`);
    }
  }
  if (req && "toolId" in req && shape && !violations.length) {
    if (!toolMatches(c.tool_id, req.toolId)) {
      violations.push(`tool '${req.toolId}' does not match the contract tool_id (${JSON.stringify(c.tool_id)}) for role '${role}'.`);
    }
  }
  // Mode-scoped NARROWING (S-LC-06): when a `mode` is supplied, the shape must
  // ALSO survive the mode profile's narrowing. The class allowed_shapes check
  // above is the hard ceiling (a mode can never widen past it); this only flags a
  // shape the class allows but the MODE has removed for that mode. REPORT-ONLY
  // ramp: callers opt in by passing `mode`; absent a mode, dispatch is unchanged.
  if (req && req.mode && shape && !violations.length) {
    const inMode = allowedShapesForRoleInMode(role, req.mode);
    if (!inMode.includes(shape)) {
      violations.push(`shape '${shape}' is class-allowed for role '${role}' but NARROWED OUT by mode '${req.mode}' (mode allows: ${inMode.join(", ") || "<none>"}).`);
    }
  }
  if (c.cwd_policy === "worktree-required") {
    // β pin 1 (SP-20260627-001): a `-w` build-chain dispatch creates its isolated worktree
    // AFTER validation — `claude … -w` makes the worktree itself (dispatch-claude.js:200
    // `passW`), and validateDispatch runs BEFORE that (dispatch-claude.js:366). At check
    // time there is no worktree path yet and cwd=canonical. The wrapper signals this with
    // `worktreePending:true`. cwd=canonical/absent is then LEGITIMATE (the worktree is
    // pending). CONDITIONED, NOT a blanket pass: without worktreePending, canonical/absent
    // STILL violates (the real cwd-worktree-violation — a builder that would edit the live
    // repo). GPT-5.5 review R2 MEDIUM (omitting cwd is not a bypass) still holds for the
    // non-pending case.
    if (req && req.worktreePending === true) {
      // legitimate `-w`: worktree will be created post-validation — no violation.
    } else if (!req.cwd) {
      violations.push(`role '${role}' has cwd_policy 'worktree-required' but NO cwd was supplied — a build-chain dispatch must name its isolated worktree (omitting cwd is not a bypass).`);
    } else if (path.resolve(req.cwd) === PROJECT_ROOT) {
      violations.push(`role '${role}' has cwd_policy 'worktree-required' but cwd is the canonical root — a build-chain role must run in an isolated worktree.`);
    }
  }
  return { ok: violations.length === 0, violations, contract: c };
}

/**
 * Validate a proposed dispatch against a NAMED class's contract directly,
 * bypassing the role-registry lookup. Used for known generic build ids (e.g.
 * 'builder') that are NOT in role-registry.json but map to a real class —
 * so the advisory emitted by the wrapper is TRUTHFUL rather than "(fail-closed)".
 * G1 / β option (c) / EVT-dispatch-shape-w0-plan-design-001.
 *
 *   { class, shape, toolId?, cwd? } -> { ok, violations[], contract }
 *
 * The shape + toolId + cwd_policy checks mirror validateDispatch but operate
 * against the class definition directly, never against registry attributes.
 * DEFENSE-IN-DEPTH note: this function does NOT have access to build_chain
 * registry attributes (the role is not in the registry), so the hard invariant
 * check (build_chain → NOT in-process) cannot be applied here. That invariant
 * ONLY guards registered roles via validateDispatch; callers who use this helper
 * must know the class maps to a safe shape (build_chain_worker + subprocess-claude
 * is the only sanctioned call site — dispatch-claude.js, which already enforces
 * the worktree isolation gate for build-chain roles BEFORE reaching this path).
 */
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
      const hint = shape === "api" ? " — API availability never implies API dispatch (PLAN §3/N-2)." : "";
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
    // β pin 1 (SP-20260627-001): worktree-pending tolerance for `-w` (worktree created
    // AFTER validation). CONDITIONED — without worktreePending, canonical/absent STILL
    // violates. Mirrors validateDispatch so the generic-build-id (class) path agrees.
    if (req && req.worktreePending === true) {
      // legitimate `-w`: worktree will be created post-validation — no violation.
    } else if (!req.cwd) {
      violations.push(`class '${className}' has cwd_policy 'worktree-required' but NO cwd was supplied — a build-chain dispatch must name its isolated worktree (omitting cwd is not a bypass).`);
    } else if (path.resolve(req.cwd) === PROJECT_ROOT) {
      violations.push(`class '${className}' has cwd_policy 'worktree-required' but cwd is the canonical root — a build-chain role must run in an isolated worktree.`);
    }
  }
  return { ok: violations.length === 0, violations, contract: { class: className, ...resolved } };
}

/**
 * Sanctioned-lane consult (SP-20260611-001 fix 2 / T-311). Returns
 *   { sanctioned, lane, shape, reason, classes } .
 *
 * A sanctioned lane is a NAMED, NARROWLY-SCOPED dispatch that is INTENTIONALLY off the
 * class default shape (e.g. --review-fallback routing a cross-provider reviewer through
 * subprocess-claude when its provider is quota-dead). It is registered in the contract's
 * `sanctioned_lanes` block (registry-as-SoT) rather than suppressed by a wrapper-local
 * `!blocking` conditional — so the lane resolves valid in BOTH report-only and blocking
 * (ENFORCE) modes and a future ENFORCE flip never BRICKS the fallback.
 *
 * REGISTER-ONLY + ADDITIVE: this function does NOT touch validateDispatch's exit paths
 * and grants no new shape there. sanctioned:true requires ALL of:
 *   (a) `lane` is a registered lane in `sanctioned_lanes`,
 *   (b) the proposed `shape` equals that lane's `shape`,
 *   (c) the role's DERIVED class is in the lane's `applies_to_classes` (NO wildcard —
 *       a non-matching class is NOT sanctioned, so the over-breadth redteam case fails closed).
 * Any miss returns sanctioned:false with a reason — the caller then falls through to its
 * normal (unchanged) validation/refusal path.
 *
 *   { role, shape, lane } -> { sanctioned, lane, shape, reason, classes }
 */
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

/**
 * The mode-scoped dispatch profile (S-LC-06 / PLAN §8.7) for a mode, or null.
 * A profile NARROWS (never widens) which shapes a class/role may use in that mode.
 */
function modeProfile(mode) {
  const contract = loadContract();
  const mp = contract.mode_profiles && contract.mode_profiles[mode];
  if (!mp || mode.startsWith("_")) return null;
  return mp;
}

/**
 * The shapes a role may use WHILE IN `mode`: the intersection of the role's
 * class allowed_shapes (the HARD ceiling) with the mode profile's narrowing for
 * that role (role_shapes) or its class (class_shapes). Absent a profile entry,
 * the class allowed_shapes apply unchanged. The intersection guarantees a mode
 * can only REMOVE a shape, never add one the class forbids — the β invariant
 * holds even if the profile were mis-authored (the static validator catches the
 * mis-authoring; this is the runtime backstop).
 */
function allowedShapesForRoleInMode(role, mode) {
  const c = contractForRole(role);
  const classAllowed = (c && c.allowed_shapes) || [];
  const mp = mode ? modeProfile(mode) : null;
  if (!mp) return classAllowed.slice();
  let narrow = null;
  if (mp.role_shapes && Array.isArray(mp.role_shapes[role])) narrow = mp.role_shapes[role];
  else if (mp.class_shapes && c && c.class && Array.isArray(mp.class_shapes[c.class])) narrow = mp.class_shapes[c.class];
  if (!narrow) return classAllowed.slice();
  // INTERSECTION — never a union. A shape only survives if it is BOTH class-allowed
  // AND mode-listed. This is the structural guarantee the profile cannot widen.
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

/**
 * Resolve a skill's execution shape (PLAN §13). Fail-closed: an unverified
 * `subprocess` candidate is treated as `inline` (never trust an unverified
 * subprocess classification). Returns { skill, execution, verified, source }.
 */
function skillExecution(skill) {
  const contract = loadContract();
  const cand = contract.skills && contract.skills.candidates && contract.skills.candidates[skill];
  if (!cand) return { skill, execution: "inline", verified: false, source: "default" };
  if (cand.execution === "subprocess" && cand.subprocess_verified !== true) {
    return { skill, execution: "inline", verified: false, source: "unverified-subprocess-falls-back-to-inline" };
  }
  return { skill, execution: cand.execution, verified: cand.subprocess_verified === true, source: "candidate" };
}

/**
 * Keystone integrity check. Returns { ok, violations[] }.
 * - every role-registry role resolves to a known class,
 * - every class's allowed_shapes/forbidden_shapes reference real shapes,
 * - the build-chain <-> in-process invariant holds for every build-chain role,
 * - role_overrides reference real roles.
 */
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

  // classes reference real shapes
  for (const [cls, def] of Object.entries(contract.role_classes || {})) {
    for (const s of def.allowed_shapes || []) if (!shapeNames.has(s)) violations.push(`class ${cls} allows unknown shape '${s}'`);
    for (const s of def.forbidden_shapes || []) if (!shapeNames.has(s)) violations.push(`class ${cls} forbids unknown shape '${s}'`);
    // a class may not both allow and forbid the same shape
    for (const s of def.allowed_shapes || []) if ((def.forbidden_shapes || []).includes(s)) violations.push(`class ${cls} both allows AND forbids '${s}'`);
  }
  // derivation rules reference real classes
  for (const rule of (contract.class_derivation && contract.class_derivation.rules) || []) {
    if (!classNames.has(rule.class)) violations.push(`class_derivation rule -> unknown class '${rule.class}'`);
  }
  const fb = contract.class_derivation && contract.class_derivation.fallback_class;
  if (fb && !classNames.has(fb)) violations.push(`fallback_class '${fb}' is not a defined class`);

  // every registry role classifies, and build-chain invariant holds
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
    // a cross-provider reviewer must not be in-process (kills diversity)
    if (attrs && attrs.kind === "reviewer" && attrs.provider && attrs.provider !== "claude") {
      if (!(c.forbidden_shapes || []).includes("in-process-agent")) violations.push(`cross-provider reviewer '${role}' must FORBID in-process-agent (provider diversity)`);
    }
  }
  // ── sanctioned_lanes: registered lanes must be well-formed (T-311) ──────────
  // Every lane's `shape` must be a known dispatch shape and every entry in its
  // `applies_to_classes` must be a defined role-class — a typo'd shape or class
  // would silently never match (sanctionedLane fails closed), so the validator
  // FAILS a malformed lane loudly rather than letting it rot. NO wildcard is
  // permitted: applies_to_classes must be a non-empty array of real classes.
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

  // role_overrides reference real, non-scrapped roles
  for (const role of Object.keys(contract.role_overrides || {})) {
    if (role.startsWith("_")) continue;
    if (!reg.roles || !reg.roles[role]) {
      if (scrapped.has(role)) violations.push(`role_override '${role}' targets a SCRAPPED role`);
      else violations.push(`role_override '${role}' is not a role in role-registry.json`);
    }
  }

  // ── mode_profiles: the β SECURITY INVARIANT — narrow-only, never widen ──────
  // A mode profile may NARROW a class/role's allowed_shapes but MUST NOT widen
  // past the CLASS constraint. Every shape a profile lists for a class/role must
  // be a SUBSET of that class/role's own allowed_shapes; a shape the class does
  // NOT allow is a WIDENING and is REJECTED. This is the load-bearing check the
  // planted-widen test asserts — the class_derivation + role-registry ceiling can
  // never be relaxed by a mode "granting" a shape.
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
          violations.push(`mode_profile '${mode}' WIDENS class '${cls}' to shape '${s}' which is NOT in the class allowed_shapes [${ceiling.join(", ")}] — a mode profile may only NARROW, never widen past the class ceiling (β security invariant).`);
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
          violations.push(`mode_profile '${mode}' WIDENS role '${role}' to shape '${s}' which is NOT in its allowed_shapes [${ceiling.join(", ")}] — a mode profile may only NARROW, never widen past the role ceiling (β security invariant).`);
        }
      }
    }
    // ── alpha_only_shapes (ADR-0014): a RECOGNIZED annotation naming which of a
    // mode's listed shapes are α-ONLY. As of ADR-0014 NO shape is α-only — the array
    // is RETAINED-BUT-EMPTY (`[]`): the in-process-agent roster is summonable by the ε
    // conductor in ANY spawn context (top-level OR teammate-ε) supplying a
    // scopeContract, because ED-041 ("Agent unavailable inside subagents") was a
    // per-spec misstatement (a Claude subagent has Agent iff its spec lists it; ε's
    // does). The key is kept (not removed) so a reversal is a one-line re-add. It does
    // NOT narrow class_shapes; it records WHO may use the shape. It must be an ARRAY
    // whose entries are all KNOWN shapes (the allowed_shapes vocabulary); an unknown
    // shape is a typo'd annotation and is REJECTED — recognizing the key here keeps it
    // from being silently ignored and lets the validator FAIL a malformed annotation
    // (an EMPTY array is valid + the post-ADR-0014 expected state).
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

// W2 dispatch-contract ENFORCE flip (β DECIDE 0.87, ADR-0013). The contract gate (validateDispatch)
// enforces by DEFAULT — it checks a STRICTLY LARGER surface than the shape-door: forbidden_shapes,
// the api-when-CLI rule (operator failure ii), build-chain→NOT-in-process (iii), cwd-worktree-
// required, mode-narrowing — none of which the shape-door (the canonical-PICK gate) evaluates. The
// two overlap only on the canonical shape; the contract-consult runs BEFORE the door (exit 1 vs the
// door's exit 2 — defined precedence, no double-refuse). Escapes mirror the shape-door so an
// operator keeps a fleet + per-wrapper + master off-switch:
//   WARPOS_DISABLE_SHAPE_DOOR=1                        → master kill (disables BOTH dispatch gates)
//   WARPOS_DISPATCH_CONTRACT_ENFORCE=report|off|0      → fleet kill (contract gate)
//   WARPOS_DISPATCH_CONTRACT_ENFORCE_<WRAPPER>=report  → per-wrapper kill (e.g. _DISPATCH_AGENT)
//   (legacy WARPOS_DISPATCH_CONTRACT_ENFORCE=block still enforces — now the default)
function contractEnforceMode(wrapperKey, env) {
  const e = env || process.env;
  // ADR-0013 (amended SP-20260627-001): ENFORCE BY DEFAULT. The original 2026-06-16 flip was
  // reverted to report-only because default-enforce FALSE-REFUSED legitimate dispatches —
  // a `-w` build-chain dispatch (worktree created AFTER validation, so cwd=canonical at check
  // time), the generic `fixer` path (not in GENERIC_BUILD_IDS), and raw legacy role names.
  // Those three are now FIXED (worktree-pending predicate in validateDispatch/forClass,
  // `fixer` in GENERIC_BUILD_IDS, role normalization), so the flip is safe: enforce is the
  // default. Reversibility is preserved via RECOVERABLE kill-switches — no code edit needed,
  // and (β edge, SP-20260627-001) they short-circuit independent of a broken contract MODULE
  // (callers fail-OPEN on module-load error; this gate only decides EVALUATION-error posture):
  //   WARPOS_DISABLE_SHAPE_DOOR=1                              → master kill (both dispatch gates)
  //   WARPOS_DISPATCH_CONTRACT_ENFORCE=report|off|0           → fleet kill (back to report-only)
  //   WARPOS_DISPATCH_CONTRACT_ENFORCE_<WRAPPER>=report|off|0 → per-wrapper kill
  //   WARPOS_DISPATCH_CONTRACT_ENFORCE[_<WRAPPER>]=enforce|block → explicit enforce (now also the default)
  if (/^(1|true|yes)$/i.test(String(mcEnv.readEnv("DISABLE_SHAPE_DOOR", e) || ""))) return false;
  const isOff = (v) => /^(report|off|0|false|no)$/.test(v);
  const isOn = (v) => /^(enforce|block|1|true|yes)$/.test(v);
  const per = String(mcEnv.readEnv(`DISPATCH_CONTRACT_ENFORCE_${wrapperKey}`, e) || "").toLowerCase();
  if (isOff(per)) return false;
  if (isOn(per)) return true;
  const g = String(mcEnv.readEnv("DISPATCH_CONTRACT_ENFORCE", e) || "").toLowerCase();
  if (isOff(g)) return false;
  if (isOn(g)) return true;
  return true; // DEFAULT = enforce (ADR-0013 amended SP-20260627-001)
}

module.exports = {
  loadContract, loadRegistry, classForRole, contractForRole, validateDispatch,
  validateDispatchForClass, sanctionedLane, contractEnforceMode,
  skillExecution, validateContractFile, registryAttrs, CONTRACT_PATH, REGISTRY_PATH,
  ARGV_SCHEMA_VERSION, modeProfile, allowedShapesForRoleInMode, allowedShapesForClassInMode,
};

// ── CLI ─────────────────────────────────────────────────────
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
    // check <role> <shape> [toolId]
    const res = validateDispatch({ role: rest[0], shape: rest[1], toolId: rest[2] });
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    process.exit(res.ok ? 0 : 1);
  }
  process.stderr.write("usage: dispatch-contract.js validate | role <role> | check <role> <shape> [toolId]\n");
  process.exit(2);
}
