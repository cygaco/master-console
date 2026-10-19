#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

let _PATHS = null;
function paths() {
  if (!_PATHS) {
    try { _PATHS = require("../hooks/lib/paths").PATHS; } catch { _PATHS = {}; }
  }
  return _PATHS;
}

function registryPath() {
  const P = paths();
  if (P && P.orgRoleRegistry) return P.orgRoleRegistry;
  const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
  return path.join(root, ".claude", "agents", "_org", "role-registry.json");
}

function loadRegistry(p = registryPath()) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function loadRoles(p = registryPath()) {
  const raw = loadRegistry(p);
  return raw && raw.roles && typeof raw.roles === "object" ? raw.roles : raw;
}

function roleIds(roles = loadRoles()) {
  return Object.keys(roles).filter(
    (k) => roles[k] && typeof roles[k] === "object" && (roles[k].tier || roles[k].home || roles[k].kind),
  );
}

function providerMap(roles = loadRoles()) {
  const out = {};
  for (const r of roleIds(roles)) if (roles[r].provider) out[r] = roles[r].provider;
  return out;
}

function effortMap(roles = loadRoles()) {
  const out = {};
  for (const r of roleIds(roles)) if (roles[r].effort) out[r] = roles[r].effort;
  return out;
}

function modelMap(roles = loadRoles()) {
  const out = {};
  for (const r of roleIds(roles)) if (roles[r].model) out[r] = roles[r].model;
  return out;
}

const providerOf = (role, roles = loadRoles()) => (roles[role] ? roles[role].provider : undefined);
const effortOf = (role, roles = loadRoles()) => (roles[role] ? roles[role].effort : undefined);
const modelOf = (role, roles = loadRoles()) => (roles[role] ? roles[role].model : undefined);

function passesOf(role, roles = loadRoles()) {
  const r = roles[role];
  if (!r) return [];
  const out = [{ provider: r.provider, model: r.model || null, effort: r.effort || null, key: "primary" }];
  for (const key of ["second_pass", "third_pass"]) {
    const p = r[key];
    if (p && p.provider) out.push({ provider: p.provider, model: p.model || null, effort: p.effort || null, key });
  }
  return out;
}

function buildChainRoles(roles = loadRoles()) {
  return roleIds(roles).filter((r) => roles[r].build_chain === true);
}

function flagshipOpenaiRoles(roles = loadRoles()) {
  return roleIds(roles).filter((r) => roles[r].provider === "openai" && roles[r].model === "gpt-5.5");
}

function fixerRoles(roles = loadRoles()) {
  return roleIds(roles).filter((r) => roles[r].kind === "fixer");
}

function reviewerGateKeys(roles = loadRoles()) {
  return roleIds(roles)
    .filter((r) => roles[r].kind === "reviewer" && roles[r].binding_verdict === true && !roles[r].claude_pinned)
    .map((r) => r.replace(/-/g, "_"))
    .sort();
}

function deriveOrFallback(deriveFn, literal, label) {
  try {
    const v = deriveFn();
    const nonEmpty = v && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
    if (nonEmpty) return v;
    throw new Error("registry derive returned empty");
  } catch (e) {
    try {
      process.stderr.write(
        `[registry-roles] WARN: '${label}' fell back to its literal — registry derive failed: ${e.message}\n`,
      );
    } catch {
    }
    return literal;
  }
}

const SCRAPPED_PROVIDER_ALIASES = Object.freeze({
  builder: "claude",
  fixer: "claude",
  reviewer: "openai",
  compliance: "openai",
  qa: "openai",
  redteam: "openai",
});
const SCRAPPED_EFFORT_ALIASES = Object.freeze({
  builder: "high",
  fixer: "high",
  reviewer: "xhigh",
  compliance: "xhigh",
  qa: "medium",
  redteam: "high",
});

module.exports = {
  registryPath,
  deriveOrFallback,
  SCRAPPED_PROVIDER_ALIASES,
  SCRAPPED_EFFORT_ALIASES,
  loadRegistry,
  loadRoles,
  roleIds,
  providerMap,
  effortMap,
  modelMap,
  providerOf,
  effortOf,
  modelOf,
  passesOf,
  buildChainRoles,
  flagshipOpenaiRoles,
  fixerRoles,
  reviewerGateKeys,
};
