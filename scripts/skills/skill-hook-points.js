#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

let _PATHS = null;
function paths() {
  if (!_PATHS) {
    try {
      _PATHS = require("../hooks/lib/paths").PATHS;
    } catch {
      _PATHS = {};
    }
  }
  return _PATHS;
}
function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
}
function skillHookPointsPath() {
  const P = paths();
  if (P && P.skillHookPoints) return P.skillHookPoints;
  return path.join(projectRoot(), ".claude", "agents", "_org", "skill-hook-points.json");
}
function roleRegistryPath() {
  const P = paths();
  if (P && P.orgRoleRegistry) return P.orgRoleRegistry;
  return path.join(projectRoot(), ".claude", "agents", "_org", "role-registry.json");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function load(p = skillHookPointsPath()) {
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

function skillIds(registry = load()) {
  const s = registry && registry.skills;
  return s && typeof s === "object" ? Object.keys(s) : [];
}

function hookRows(registry = load()) {
  const out = [];
  const skills = (registry && registry.skills) || {};
  for (const skill of Object.keys(skills)) {
    const hooks = (skills[skill] && skills[skill].hooks) || [];
    for (const h of hooks) {
      out.push({
        skill,
        hook_point: h.hook_point,
        role: h.role,
        condition: h.condition || "always",
        default: h.default === true,
        note: h.note,
      });
    }
  }
  return out;
}

function resolveAgent(skill, hookPoint, registry = load()) {
  return hookRows(registry).filter(
    (r) => r.skill === skill && (hookPoint == null || r.hook_point === hookPoint),
  );
}

function defaultRoleFor(skill, hookPoint, registry = load()) {
  const rows = resolveAgent(skill, hookPoint, registry);
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0].role;
  const def = rows.find((r) => r.default);
  return def ? def.role : null;
}

function validate(registry, roleIds) {
  const errors = [];
  if (!registry || typeof registry !== "object") return { ok: false, errors: ["registry is not an object"] };
  if (!registry.skills || typeof registry.skills !== "object")
    return { ok: false, errors: ["registry.skills missing or not an object"] };
  const ids = new Set(roleIds);

  for (const skill of Object.keys(registry.skills)) {
    const entry = registry.skills[skill];
    const at = `skills["${skill}"]`;
    if (!entry || typeof entry !== "object") { errors.push(`${at}: not an object`); continue; }
    if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
      errors.push(`${at}: hooks missing or empty`);
      continue;
    }
    const byHook = {};
    entry.hooks.forEach((h, i) => {
      const hat = `${at}.hooks[${i}] (${h && h.hook_point}→${h && h.role})`;
      if (!h || typeof h !== "object") { errors.push(`${hat}: not an object`); return; }
      if (!h.hook_point || typeof h.hook_point !== "string") errors.push(`${hat}: hook_point missing`);
      if (!h.role || !ids.has(h.role)) errors.push(`${hat}: role '${h.role}' is not in role-registry (stale/renamed?)`);
      if (h.condition != null && typeof h.condition !== "string") errors.push(`${hat}: condition must be a string`);
      if (h.default != null && typeof h.default !== "boolean") errors.push(`${hat}: default must be a boolean`);
      (byHook[h.hook_point] = byHook[h.hook_point] || []).push(h);
    });
    for (const hp of Object.keys(byHook)) {
      const rows = byHook[hp];
      if (rows.length > 1) {
        const defs = rows.filter((r) => r.default === true).length;
        if (defs !== 1)
          errors.push(`${at} hook_point '${hp}': conditional hook has ${rows.length} rows but ${defs} default:true (need exactly 1)`);
      }
    }
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
      process.stderr.write(`skill-hook-points error: ${e.message}\n`);
      return 2;
    }
    const res = validate(registry, roleIds);
    if (res.ok) {
      process.stdout.write(
        `OK   [skill-hook-points] ${skillIds(registry).length} skills / ${hookRows(registry).length} hook rows valid\n`,
      );
      return 0;
    }
    process.stderr.write(
      `FAIL [skill-hook-points] ${res.errors.length} error(s):\n${res.errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 1;
  }

  if (cmd === "resolve") {
    const skill = argv[3];
    const hookPoint = argv[4] || null;
    if (!skill) {
      process.stderr.write("usage: skill-hook-points.js resolve <skill> [hook_point]\n");
      return 2;
    }
    let registry;
    try {
      registry = load();
    } catch (e) {
      process.stderr.write(`skill-hook-points error: ${e.message}\n`);
      return 2;
    }
    const rows = resolveAgent(skill, hookPoint, registry);
    if (rows.length === 0) {
      process.stderr.write(`no hook-in entry for skill '${skill}'${hookPoint ? ` hook_point '${hookPoint}'` : ""}\n`);
      return 1;
    }
    process.stdout.write(
      JSON.stringify(
        {
          skill,
          hooks: rows.map((r) => ({
            hook_point: r.hook_point,
            role: r.role,
            condition: r.condition,
            default: r.default,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  process.stderr.write("usage: skill-hook-points.js <validate | resolve <skill> [hook_point]>\n");
  return 2;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  load,
  loadRoles,
  loadRoleIds,
  skillIds,
  hookRows,
  resolveAgent,
  defaultRoleFor,
  validate,
  skillHookPointsPath,
  roleRegistryPath,
};
