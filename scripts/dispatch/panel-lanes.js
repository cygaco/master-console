#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const MANIFEST_PATH = path.join(ROOT, ".claude", "agents", "_org", "panel-lane-manifest.json");
const SUPPORT_MATRIX_PATH = path.join(ROOT, ".claude", "kernel", "support-matrix.json");
const SECURITY_ROLE = "security-reviewer";

const pv = require("./provenance-verifier");
const CROSS_PROVIDER_SHAPE = pv.CROSS_PROVIDER_SHAPE;
const IN_PROCESS_SHAPE = pv.IN_PROCESS_SHAPE;

const STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  BLOCKED_INCONCLUSIVE: "BLOCKED-INCONCLUSIVE",
  BLOCKED_ON_OPERATOR: "BLOCKED-ON-OPERATOR",
});

const PANEL_PROVIDER_FAMILY = { claude: "anthropic", openai: "openai", gemini: "google", antigravity: "google" };

function loadManifest(manifestPath = MANIFEST_PATH) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

function loadSupportMatrix(p = SUPPORT_MATRIX_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function getProfile(manifest, name) {
  const prof = manifest && manifest.profiles && manifest.profiles[name];
  if (!prof) throw new Error(`panel profile '${name}' not found in manifest`);
  return prof;
}

function requiredLanes(manifest, profileName) {
  const prof = getProfile(manifest, profileName);
  return (prof.required || []).map((laneId) => {
    const lane = (manifest.lanes || {})[laneId];
    if (!lane) throw new Error(`profile '${profileName}' requires lane '${laneId}' which is not defined in manifest.lanes`);
    return { laneId, ...lane };
  });
}

function isSanctionedInProcessLane(laneId, lane) {
  return pv.isSanctionedHunterLane(laneId, lane);
}

function assertCliOnlyPanel(observedLanes = []) {
  const violations = [];
  for (const l of observedLanes) {
    const laneId = l.laneId || l.lane || l.pass;
    if (isSanctionedInProcessLane(laneId, l)) continue;
    if (l.shape === IN_PROCESS_SHAPE) {
      violations.push(
        `panel lane '${laneId}' (provider ${l.provider}) resolved '${IN_PROCESS_SHAPE}' — a cross-provider lab MUST be a CLI subprocess ('${CROSS_PROVIDER_SHAPE}'); only the claude hunter (lane 'claude' + provider 'claude') may be in-process (positive scope)`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}

function validatePanelManifest(opts = {}) {
  const errors = [];
  let manifest, passes, toolIdOf, supportMatrix;
  try {
    manifest = opts.manifest || loadManifest();
    const passesOf = opts.passesOf || require("./registry-roles").passesOf;
    passes = opts.roles ? passesOf(SECURITY_ROLE, opts.roles) : passesOf(SECURITY_ROLE);
    toolIdOf = opts.toolIdOf || require("../dispatch-agent").providerToolId;
    supportMatrix = opts.supportMatrix || loadSupportMatrix();
  } catch (e) {
    return { ok: false, loaderError: true, errors: [`panel manifest loader failed (fail-closed): ${e.message}`] };
  }

  const lanes = manifest.lanes || {};
  const laneEntries = Object.entries(lanes);
  const laneByProvider = {};
  for (const [laneId, lane] of laneEntries) laneByProvider[lane.provider] = { laneId, lane };

  for (const p of passes) {
    if (!laneByProvider[p.provider]) {
      errors.push(`registry pass provider '${p.provider}' (${p.key}) has NO manifest lane — the manifest must cover every security-reviewer pass (drift)`);
    }
  }
  for (const [laneId, lane] of laneEntries) {
    if (!passes.some((p) => p.provider === lane.provider)) {
      errors.push(`manifest lane '${laneId}' provider '${lane.provider}' is NOT a security-reviewer pass (phantom lane)`);
    }
    const expectTool = toolIdOf(lane.provider);
    if (lane.tool_id !== expectTool) {
      errors.push(`manifest lane '${laneId}' tool_id '${lane.tool_id}' != providerToolId('${lane.provider}')='${expectTool}' (provider-id/tool-id drift)`);
    }
    const expectShape = lane.provider === "claude" ? IN_PROCESS_SHAPE : CROSS_PROVIDER_SHAPE;
    if (lane.shape !== expectShape) {
      errors.push(`manifest lane '${laneId}' shape '${lane.shape}' != required '${expectShape}' for provider '${lane.provider}'`);
    }
  }
  const agyLane = laneByProvider["antigravity"];
  if (agyLane) {
    const sunsetBlob = JSON.stringify(agyLane.lane.sunset_ref || "") + JSON.stringify(manifest.sunset || "");
    if (!/ADR-0031/.test(sunsetBlob)) errors.push(`agy lane '${agyLane.laneId}' must carry a sunset ref to ADR-0031`);
    const agyRow = supportMatrix && supportMatrix.rows && supportMatrix.rows["agy-antigravity"];
    if (!agyRow) errors.push(`support-matrix.json has no 'agy-antigravity' row (the lane-status single-source) — cannot certify agy liveness`);
  }
  const setEq = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x));
  const providerToLaneId = {};
  for (const [laneId, lane] of laneEntries) providerToLaneId[lane.provider] = laneId;
  const allLabLaneIds = passes.map((p) => providerToLaneId[p.provider]).filter(Boolean);
  const nonAgyLaneIds = passes.filter((p) => p.provider !== "antigravity").map((p) => providerToLaneId[p.provider]).filter(Boolean);
  const p3 = (manifest.profiles || {})["panel-3lab"];
  const p2 = (manifest.profiles || {})["panel-2family"];
  if (!p3 || p3.binding !== true) errors.push(`panel-3lab must exist and be binding:true`);
  else if (!setEq(p3.required || [], allLabLaneIds)) errors.push(`panel-3lab.required must be EXACTLY the full lab set ${JSON.stringify(allLabLaneIds)} (got ${JSON.stringify(p3.required)}) — an included-not-exact set lets a required lane be silently dropped`);
  if (!p2 || p2.binding === true) errors.push(`panel-2family must exist as the non-binding degraded floor (binding:false)`);
  else if (!setEq(p2.required || [], nonAgyLaneIds)) errors.push(`panel-2family.required must be EXACTLY the non-agy lab set ${JSON.stringify(nonAgyLaneIds)} (got ${JSON.stringify(p2.required)}) — agy is optional (operator-owned), not required, in the degraded floor`);

  for (const [pn, prof] of Object.entries(manifest.profiles || {})) {
    if (typeof prof.min_families !== "number" || prof.min_families < 2)
      errors.push(`profile '${pn}' min_families must be a number >= 2 (got ${JSON.stringify(prof.min_families)}) — a security panel requires >= 2 provider families`);
  }

  return { ok: errors.length === 0, errors, passes, lanes };
}

function panelStatus(profile, lanes = [], opts = {}) {
  const binding = !!(profile && profile.binding);
  if (opts.loaderError) {
    return { status: STATUS.BLOCKED_INCONCLUSIVE, reason: "loader error — the panel contract could not be loaded (fail-closed at the loader boundary)", families: 0, laneStatus: {}, binding, loader: true };
  }

  const required = (profile && profile.required) || [];
  const laneById = {};
  for (const l of lanes) laneById[l.laneId] = l;

  const laneStatus = {};
  const blocked = [];
  const failed = [];
  const operatorBlocked = [];
  const observedFamilies = new Set();

  for (const laneId of required) {
    const l = laneById[laneId];
    if (!l || l.hasEvidence !== true) {
      if (opts.agyOperatorOwned && laneId === "agy") { operatorBlocked.push(laneId); laneStatus[laneId] = "operator-owned-absent"; }
      else { blocked.push(laneId); laneStatus[laneId] = "missing-evidence"; }
      continue;
    }
    const coerced =
      l.fallback === true ||
      !l.observedProvider ||
      (!!l.contractedProvider && l.observedProvider !== l.contractedProvider);
    if (coerced) { blocked.push(laneId); laneStatus[laneId] = "coerced"; continue; }
    if (l.alive !== true) { blocked.push(laneId); laneStatus[laneId] = "dead"; continue; }
    const v = String(l.verdict || "").toLowerCase();
    if (v === "fail") { failed.push(laneId); laneStatus[laneId] = "fail"; continue; }
    if (v !== "pass" && v !== "warn") { blocked.push(laneId); laneStatus[laneId] = "refused-or-malformed"; continue; }
    laneStatus[laneId] = "alive-clean";
    const fam = PANEL_PROVIDER_FAMILY[l.observedProvider] || l.observedProvider;
    if (fam) observedFamilies.add(fam);
  }

  const requiredSet = new Set(required);
  const optionalBlocked = [];
  const optionalFailed = [];
  for (const l of lanes) {
    if (!l || !l.laneId || requiredSet.has(l.laneId)) continue;
    if (l.hasEvidence !== true) {
      laneStatus[l.laneId] = "optional-absent-waived";
      continue;
    }
    const oCoerced = l.fallback === true || !l.observedProvider || (!!l.contractedProvider && l.observedProvider !== l.contractedProvider);
    if (oCoerced) { optionalBlocked.push(l.laneId); laneStatus[l.laneId] = "coerced"; continue; }
    if (l.alive !== true) { optionalBlocked.push(l.laneId); laneStatus[l.laneId] = "dead"; continue; }
    const ov = String(l.verdict || "").toLowerCase();
    if (ov === "fail") { optionalFailed.push(l.laneId); laneStatus[l.laneId] = "fail"; continue; }
    if (ov !== "pass" && ov !== "warn") { optionalBlocked.push(l.laneId); laneStatus[l.laneId] = "refused-or-malformed"; continue; }
    laneStatus[l.laneId] = "alive-clean";
  }

  const families = observedFamilies.size;
  const minFamilies = (profile && profile.min_families) || 2;

  if (failed.length) {
    return { status: STATUS.FAIL, reason: `required lane(s) FAILED: ${failed.join(", ")}`, families, laneStatus, binding };
  }
  if (optionalFailed.length) {
    return { status: STATUS.FAIL, reason: `optional lane(s) RAN and FAILED (binds): ${optionalFailed.join(", ")}`, families, laneStatus, binding };
  }
  if (operatorBlocked.length && blocked.length === 0 && optionalBlocked.length === 0) {
    return { status: STATUS.BLOCKED_ON_OPERATOR, reason: `awaiting operator-owned lane(s): ${operatorBlocked.join(", ")} — never GREEN`, families, laneStatus, binding, operator_blocked: operatorBlocked };
  }
  if (blocked.length || operatorBlocked.length) {
    return { status: STATUS.BLOCKED_INCONCLUSIVE, reason: `unprovable required lane(s): ${[...blocked, ...operatorBlocked].join(", ")}`, families, laneStatus, binding };
  }
  if (optionalBlocked.length) {
    return {
      status: STATUS.BLOCKED_INCONCLUSIVE,
      reason: `unprovable PRESENT optional lane(s) (coerced/dead/refused-or-malformed — present is not proof): ${optionalBlocked.join(", ")}`,
      families,
      laneStatus,
      binding,
    };
  }
  if (families < minFamilies) {
    return { status: STATUS.BLOCKED_INCONCLUSIVE, reason: `observed provider families ${families} < required ${minFamilies} (diversity loss — observed count)`, families, laneStatus, binding };
  }
  return { status: STATUS.PASS, reason: "all required lanes alive, clean, attested on the contracted provider; family diversity met", families, laneStatus, binding };
}

function agyLive(supportMatrix) {
  try {
    const row = (supportMatrix || loadSupportMatrix()).rows["agy-antigravity"];
    return !!row && row.status === "supported" && row.proven === true;
  } catch {
    return false;
  }
}

function main(argv) {
  const cmd = argv[0] || "validate";
  const json = argv.includes("--json");
  if (cmd === "validate") {
    let out;
    try {
      out = validatePanelManifest();
    } catch (e) {
      process.stderr.write(`panel-lanes validate: fail-closed loader error: ${e.message}\n`);
      return 1;
    }
    if (json) process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    else if (out.ok) process.stdout.write(`OK  panel-lane-manifest validates against passesOf('${SECURITY_ROLE}') + support-matrix (single-source, no drift)\n`);
    else process.stderr.write(`FAIL panel-lane-manifest drift${out.loaderError ? " (loader)" : ""}:\n${out.errors.map((e) => "  - " + e).join("\n")}\n`);
    return out.ok ? 0 : 1;
  }
  process.stderr.write("usage: panel-lanes.js <validate> [--json]\n");
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = {
  loadManifest,
  loadSupportMatrix,
  getProfile,
  requiredLanes,
  isSanctionedInProcessLane,
  assertCliOnlyPanel,
  validatePanelManifest,
  panelStatus,
  agyLive,
  STATUS,
  PANEL_PROVIDER_FAMILY,
  MANIFEST_PATH,
  SUPPORT_MATRIX_PATH,
  CROSS_PROVIDER_SHAPE,
  IN_PROCESS_SHAPE,
};
