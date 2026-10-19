#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { PATHS } = require("../hooks/lib/paths");

const STEPS = Object.freeze(["plan", "design", "build", "gauntlet", "release", "retro"]);
const RISK_ORDER = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const MODES = Object.freeze(["block", "advisory"]);

const CHANGE_VALUES = Object.freeze(["bugfix", "update", "release"]);
const BLAST_VALUES = Object.freeze(["minor", "major"]);

function hookPointsPath() {
  return (
    PATHS.sprintHookPoints ||
    path.join(SPRINT.PROJECT, ".claude", "agents", "_org", "sprint-hook-points.json")
  );
}
function roleRegistryPath() {
  return (
    PATHS.orgRoleRegistry ||
    path.join(SPRINT.PROJECT, ".claude", "agents", "_org", "role-registry.json")
  );
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function load(p = hookPointsPath()) {
  return readJson(p);
}

function loadRoles(p = roleRegistryPath()) {
  const raw = readJson(p);
  return raw && raw.roles && typeof raw.roles === "object" ? raw.roles : raw;
}

function loadRoleIds(p = roleRegistryPath()) {
  const roles = loadRoles(p);
  return Object.keys(roles).filter(
    (k) => roles[k] && typeof roles[k] === "object" && (roles[k].tier || roles[k].home || roles[k].kind),
  );
}

function residencyOf(role, roles = loadRoles()) {
  const row = roles && roles[role];
  const r = row && typeof row === "object" ? String(row.residency || "").toLowerCase() : "";
  return r === "persistent" ? "persistent" : "ephemeral";
}

function normalizeComposition(comp = {}) {
  const lc = (a) => new Set((a || []).map((s) => String(s).toLowerCase()));
  return {
    unit_types: lc(comp.unit_types || comp.unitTypes),
    max_risk: String(comp.max_risk || comp.maxRisk || "").toLowerCase(),
    domains: lc(comp.domains),
    change: String(comp.change || "").toLowerCase(),
    blast: String(comp.blast || "").toLowerCase(),
    surfaces: lc(comp.surfaces),
  };
}

function matchConditionReason(condition, comp) {
  if (condition === "always" || condition == null) return "always";
  if (typeof condition !== "object") return "closed";
  if (Array.isArray(condition.unit_type)) {
    return condition.unit_type.some((t) => comp.unit_types.has(String(t).toLowerCase())) ? "value" : "closed";
  }
  if (condition.risk_min) {
    const need = RISK_ORDER[String(condition.risk_min).toLowerCase()] || 0;
    const have = RISK_ORDER[comp.max_risk] || 0;
    return have > 0 && have >= need ? "value" : "closed";
  }
  if (Array.isArray(condition.domain)) {
    return condition.domain.some((d) => comp.domains.has(String(d).toLowerCase())) ? "value" : "closed";
  }
  if (Array.isArray(condition.change)) {
    if (!comp.change) return "unknown-open";
    return condition.change.some((c) => String(c).toLowerCase() === comp.change) ? "value" : "closed";
  }
  if (Array.isArray(condition.blast)) {
    if (!comp.blast) return "unknown-open";
    return condition.blast.some((b) => String(b).toLowerCase() === comp.blast) ? "value" : "closed";
  }
  if (Array.isArray(condition.risk_surface)) {
    return condition.risk_surface.some((s) => comp.surfaces.has(String(s).toLowerCase())) ? "value" : "closed";
  }
  if (condition.unit_type_absent === true) {
    return comp.unit_types.size === 0 ? "value" : "closed";
  }
  if (Array.isArray(condition.any)) {
    if (!condition.any.length) return "closed";
    for (const c of condition.any) {
      const r = matchConditionReason(c, comp);
      if (r !== "closed") return r;
    }
    return "closed";
  }
  if (Array.isArray(condition.all)) {
    if (!condition.all.length) return "closed";
    let weakest = "value";
    for (const c of condition.all) {
      const r = matchConditionReason(c, comp);
      if (r === "closed") return "closed";
      if (r === "unknown-open") weakest = "unknown-open";
    }
    return weakest;
  }
  return "closed";
}

function matchCondition(condition, comp) {
  return matchConditionReason(condition, comp) !== "closed";
}

function agentsForStep(step, composition, registry = load()) {
  const comp = normalizeComposition(composition);
  const matched = (registry.rows || [])
    .filter((r) => r.step === step && matchCondition(r.condition, comp))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const seen = new Set();
  return matched
    .filter((r) => {
      if (seen.has(r.role)) return false;
      seen.add(r.role);
      return true;
    })
    .map((r) => ({ ...r, matched_via: matchConditionReason(r.condition, comp) }));
}

function compositionFromTickets(tickets = []) {
  const unit_types = new Set();
  const domains = new Set();
  let maxRank = 0;
  let max_risk = "";
  for (const t of tickets) {
    if (!t || typeof t !== "object") continue;
    if (t.unit_type) unit_types.add(String(t.unit_type).toLowerCase());
    if (t.domain) domains.add(String(t.domain).toLowerCase());
    if (String(t.type || "").toLowerCase() === "copy") domains.add("copy");
    const rank = RISK_ORDER[String(t.risk_level || "").toLowerCase()] || 0;
    if (rank > maxRank) {
      maxRank = rank;
      max_risk = String(t.risk_level).toLowerCase();
    }
  }
  const comp = { unit_types: [...unit_types], max_risk, domains: [...domains] };
  let trailer = null;
  try {
    trailer = require("../checks/change-trailer").aggregateClassification(tickets);
  } catch {
    trailer = null;
  }
  if (trailer) {
    if (trailer.change) comp.change = trailer.change;
    if (trailer.blast) comp.blast = trailer.blast;
    if (trailer.risks) comp.risks = trailer.risks;
  }
  return comp;
}

function conditionErrors(c, at) {
  if (c === "always" || c == null) return [];
  if (typeof c !== "object") return [`${at}: malformed condition ${JSON.stringify(c)}`];
  if (Array.isArray(c.any) || Array.isArray(c.all)) {
    const key = Array.isArray(c.any) ? "any" : "all";
    const list = c[key];
    if (!list.length) return [`${at}: '${key}' must be a non-empty array`];
    return list.flatMap((sub, i) => conditionErrors(sub, `${at}.${key}[${i}]`));
  }
  if (Array.isArray(c.unit_type)) return [];
  if (Array.isArray(c.domain)) return [];
  if (c.risk_min) {
    return RISK_ORDER[String(c.risk_min).toLowerCase()] ? [] : [`${at}: unknown risk_min '${c.risk_min}'`];
  }
  if (Array.isArray(c.change)) {
    const bad = c.change.filter((v) => !CHANGE_VALUES.includes(String(v).toLowerCase()));
    return bad.length ? [`${at}: unknown change value(s) ${bad.join(",")}`] : [];
  }
  if (Array.isArray(c.blast)) {
    const bad = c.blast.filter((v) => !BLAST_VALUES.includes(String(v).toLowerCase()));
    return bad.length ? [`${at}: unknown blast value(s) ${bad.join(",")}`] : [];
  }
  if (Array.isArray(c.risk_surface)) return [];
  if (c.unit_type_absent === true) return [];
  return [`${at}: malformed condition ${JSON.stringify(c)}`];
}

function validate(registry, roleIds) {
  const errors = [];
  if (!registry || typeof registry !== "object") return { ok: false, errors: ["registry is not an object"] };
  if (!Array.isArray(registry.rows)) return { ok: false, errors: ["registry.rows missing or not an array"] };
  const ids = new Set(roleIds);
  const stepsSeen = new Set();
  registry.rows.forEach((r, i) => {
    const at = `rows[${i}] (${r && r.role}@${r && r.step})`;
    if (!r || typeof r !== "object") { errors.push(`${at}: not an object`); return; }
    if (!r.role || !ids.has(r.role)) errors.push(`${at}: role '${r.role}' is not in role-registry`);
    if (!STEPS.includes(r.step)) errors.push(`${at}: step '${r.step}' is not a canonical lifecycle step`);
    if (!MODES.includes(r.mode)) errors.push(`${at}: mode '${r.mode}' not one of ${MODES.join("|")}`);
    if (typeof r.order !== "number") errors.push(`${at}: order must be a number`);
    errors.push(...conditionErrors(r.condition, at));
    if (STEPS.includes(r.step)) stepsSeen.add(r.step);
  });
  for (const s of STEPS) {
    if (!stepsSeen.has(s)) errors.push(`step '${s}' has NO registered agent row (orphan step)`);
  }
  return { ok: errors.length === 0, errors };
}

function main(argv) {
  const cmd = argv[2] || "validate";

  if (cmd === "validate") {
    let registry, roleIds;
    try {
      registry = load();
      roleIds = loadRoleIds();
    } catch (e) {
      process.stderr.write(`hook-points error: ${e.message}\n`);
      return 2;
    }
    const res = validate(registry, roleIds);
    if (res.ok) {
      process.stdout.write(
        `OK   [sprint-hook-points] ${registry.rows.length} rows valid across ${STEPS.length} steps\n`,
      );
      return 0;
    }
    process.stderr.write(
      `FAIL [sprint-hook-points] ${res.errors.length} error(s):\n${res.errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 1;
  }

  if (cmd === "for-step") {
    const step = argv[3];
    if (!STEPS.includes(step)) {
      process.stderr.write(`unknown step '${step}'. one of: ${STEPS.join(" | ")}\n`);
      return 2;
    }
    const ci = argv.indexOf("--composition");
    let comp = {};
    if (ci !== -1 && argv[ci + 1]) {
      try {
        comp = JSON.parse(argv[ci + 1]);
      } catch (e) {
        process.stderr.write(`bad --composition JSON: ${e.message}\n`);
        return 2;
      }
    }
    const rows = agentsForStep(step, comp);
    process.stdout.write(
      JSON.stringify(
        { step, agents: rows.map((r) => ({ role: r.role, mode: r.mode, order: r.order })) },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  process.stderr.write(
    "usage: hook-points.js <validate | for-step <step> [--composition <json>]>\n",
  );
  return 2;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  STEPS,
  RISK_ORDER,
  MODES,
  CHANGE_VALUES,
  BLAST_VALUES,
  load,
  loadRoles,
  loadRoleIds,
  residencyOf,
  normalizeComposition,
  matchCondition,
  matchConditionReason,
  conditionErrors,
  agentsForStep,
  compositionFromTickets,
  validate,
  hookPointsPath,
  roleRegistryPath,
};
