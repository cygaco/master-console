#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "role-parity";

const ORCHESTRATOR_SYSTEM = new Set([
  "alpha", "beta", "gamma", "delta",
  "ops-analyst", "skeleton-builder", "cabinet",
  "learner", "stub-scaffold",
]);

const TRANSITIONAL = new Map([
  ["builder", "splits into frontend-builder/backend-builder; org-map declares both (agent:null, pending)"],
  ["qa", "DEPRECATED (ADR-0007): absorbed into qa-reviewer (alias qa→qa-reviewer). Legacy catalog id, not dispatched live; trims in the catalog-roster cleanup."],
  ["reviewer", "DEPRECATED (ADR-0007): split into frontend-reviewer/backend-reviewer (code-quality only). Legacy catalog id, not dispatched live; trims in the catalog-roster cleanup."],
  ["compliance", "DEPRECATED (ADR-0007): absorbed into qa-reviewer integrity scope (alias compliance→qa-reviewer). Legacy catalog id, not dispatched live; trims in the catalog-roster cleanup."],
  ["redteam", "DEPRECATED (ADR-0007): replaced by security-reviewer (alias redteam→security-reviewer). Legacy catalog id, not dispatched live; trims in the catalog-roster cleanup."],
]);

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function parseGammaOnlyTypes(src) {
  const m = src.match(/GAMMA_ONLY_TYPES\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!m) return null;
  return new Set([...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]));
}

function collectOrgRoles(org) {
  const domainRoles = new Set();
  const builtAgents = [];
  const buildChainBuilt = [];
  const addRole = (r, agent, isBuilder) => {
    if (r) domainRoles.add(r);
    if (agent) {
      builtAgents.push({ role: r, agent });
      if (isBuilder) buildChainBuilt.push(r);
    }
  };
  for (const [, d] of Object.entries(org.domains || {})) {
    if (d.director) addRole(d.director.role, d.director.agent, false);
    for (const lead of d.leads || []) {
      addRole(lead.role, lead.agent, false);
      for (const sp of lead.specialists || []) addRole(sp.role, sp.agent, false);
    }
    for (const sp of d.specialists || []) addRole(sp.role, sp.agent, false);
    for (const b of d.builders || []) addRole(b.role, b.agent, true);
  }
  return { domainRoles, builtAgents, buildChainBuilt };
}

function fmName(file) {
  try {
    const body = fs.readFileSync(file, "utf8");
    const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return null;
    const m = fm[1].match(/^name:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch { return null; }
}
function makeRealAgentResolver(root) {
  const agentsRoot = path.join(root, ".claude", "agents");
  return function agentResolves(agent) {
    let found = false;
    const walk = (dir, depth) => {
      if (found || depth > 5) return;
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (found) return;
        if (e.isDirectory()) {
          if (e.name === agent) { found = true; return; }
          if (!e.name.startsWith(".")) walk(path.join(dir, e.name), depth + 1);
        } else if (e.isFile() && e.name.endsWith(".md")) {
          if (e.name === `${agent}.md`) { found = true; return; }
          if (fmName(path.join(dir, e.name)) === agent) { found = true; return; }
        }
      }
    };
    walk(agentsRoot, 0);
    return found;
  };
}

const NON_POD_SUBDIRS = new Set([]);

function scanSpecTree(root) {
  const agentsRoot = path.join(root, ".claude", "agents");
  const byName = {};
  let files = 0;
  const walk = (dir, segs, depth) => {
    if (depth > 6) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), [...segs, e.name], depth + 1);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        const nm = fmName(path.join(dir, e.name));
        if (!nm) continue;
        files++;
        const home = segs[0] || null;
        let sub_home = null;
        if (segs.length >= 2 && !NON_POD_SUBDIRS.has(segs[1])) sub_home = segs[1];
        if (!byName[nm]) {
          byName[nm] = { home, sub_home, file: path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/") };
        }
      }
    }
  };
  walk(agentsRoot, [], 0);
  return { byName, files };
}

function evaluateReportingStructure({ reg, specTree, exempt = new Set() }) {
  const errors = [];
  const roles = (reg && reg.roles) || {};
  const byName = (specTree && specTree.byName) || {};
  for (const [name, r] of Object.entries(roles)) {
    if (!r || typeof r !== "object") continue;
    const onDisk = byName[name];
    if (!onDisk) {
      errors.push(`no-spec-on-disk: registry role "${name}" has no spec .md under .claude/agents/ whose frontmatter name="${name}" (reporting structure names a role the spec tree does not back)`);
      continue;
    }
    if (exempt.has(name)) continue;
    if (r.home && onDisk.home && r.home !== onDisk.home) {
      errors.push(`home-drift: registry role "${name}" home="${r.home}" but its spec lives under department "${onDisk.home}" (${onDisk.file}) — the registry's reporting department drifted from the spec tree`);
    }
    const regSub = r.sub_home || null;
    const diskSub = onDisk.sub_home || null;
    if (regSub !== diskSub) {
      errors.push(`sub_home-drift: registry role "${name}" sub_home=${regSub ? `"${regSub}"` : "(none)"} but its spec lives in pod ${diskSub ? `"${diskSub}"` : "(none)"} (${onDisk.file})`);
    }
  }
  return errors;
}

function evaluate({ org, ROLES, gammaOnly, agentResolves, registryRoles = new Set() }) {
  const errors = [];
  const { domainRoles, builtAgents, buildChainBuilt } = collectOrgRoles(org);

  const gauntletNames = new Set();
  const gauntletMembers = new Set();
  for (const [gname, g] of Object.entries(org.gauntlets || {})) {
    gauntletNames.add(`${gname}-gauntlet`);
    gauntletNames.add(gname);
    for (const mem of g.members || []) gauntletMembers.add(mem);
  }

  for (const { role, agent } of builtAgents) {
    if (!agentResolves(agent)) {
      errors.push(`org-map role "${role}" claims built agent "${agent}" but no spec resolves under .claude/agents/`);
    }
  }
  for (const mem of gauntletMembers) {
    if (!ROLES.includes(mem)) {
      errors.push(`gauntlet member "${mem}" is not a dispatch role (absent from catalog.js ROLES)`);
    }
  }
  const knownRoles = new Set([...domainRoles, ...gauntletNames, "enforcer"]);
  for (const [key, r] of Object.entries(org.routing || {})) {
    if (key.startsWith("_")) continue;
    const owner = r && r.owner_role;
    if (owner && !knownRoles.has(owner)) {
      errors.push(`routing["${key}"].owner_role "${owner}" is not defined in the org map (domains/gauntlets/enforcer)`);
    }
  }
  for (const role of ROLES) {
    if (ORCHESTRATOR_SYSTEM.has(role)) continue;
    if (!(gauntletMembers.has(role) || domainRoles.has(role) || TRANSITIONAL.has(role) || registryRoles.has(role))) {
      errors.push(`dispatch role "${role}" is ungoverned — not a gauntlet member, org-map domain role, role-registry role, or transitional (repartition drift)`);
    }
  }
  for (const role of buildChainBuilt) {
    if (!gammaOnly.has(role)) {
      errors.push(`built build-chain role "${role}" is NOT in team-guard GAMMA_ONLY_TYPES — α could dispatch it directly (gate hole)`);
    }
  }
  return errors;
}

function validateRegistry(root, catalog) {
  const regPath = path.join(
    root,
    ".claude/agents/_org/role-registry.json",
  );
  let reg;
  try {
    reg = readJSON(regPath);
  } catch (e) {
    return {
      errors: [`role-registry.json unreadable/unparseable: ${e.message}`],
      fatal: true,
    };
  }
  const errors = evaluateRegistry(reg, catalog);
  const specTree = scanSpecTree(root);
  errors.push(...evaluateReportingStructure({ reg, specTree }));
  const specFm = readAllSpecFm(root, reg);
  errors.push(...evaluateModelPins({ reg, specFm }));
  return { errors, fatal: false };
}

function isDoerRole(role) {
  return !!role && (role.kind === "builder" || role.kind === "fixer" || role.build_chain === true);
}

function evaluateRegistry(reg, catalog) {
  const errors = [];
  const roles = reg.roles || {};
  const roleNames = new Set(Object.keys(roles));
  const models = new Set();
  for (const p of catalog.PROVIDER_LIST || []) {
    for (const m of p.models || []) {
      models.add(m.id);
      for (const a of m.aliases || []) models.add(a);
    }
  }
  for (const [name, r] of Object.entries(roles)) {
    if (r.model && !models.has(r.model)) {
      errors.push(`registry role "${name}" model "${r.model}" is not in the catalog`);
    }
    if (r.second_pass && r.second_pass.model && !models.has(r.second_pass.model)) {
      errors.push(`registry role "${name}" second_pass.model "${r.second_pass.model}" is not in the catalog`);
    }
    if (r.third_pass && r.third_pass.model && !models.has(r.third_pass.model)) {
      errors.push(`registry role "${name}" third_pass.model "${r.third_pass.model}" is not in the catalog`);
    }
    for (const d of r.dispatchable_by || []) {
      if (!roleNames.has(d)) errors.push(`registry role "${name}".dispatchable_by names unknown role "${d}"`);
    }
    for (const d of r.dispatches || []) {
      if (!roleNames.has(d)) errors.push(`registry role "${name}".dispatches names unknown role "${d}"`);
    }
    if (r.effort === "max" && name !== "alpha") {
      errors.push(`registry role "${name}" effort=max — max is reserved for alpha (ADR-0007 effort policy)`);
    }
    if (r.model === "gpt-5.5" && r.effort === "max") {
      errors.push(`registry role "${name}" gpt-5.5 cannot use effort=max (ceiling is xhigh)`);
    }
    if (r.kind === "reviewer") {
      for (const d of r.dispatchable_by || []) {
        const manager = roles[d];
        if (manager && isDoerRole(manager)) {
          errors.push(`[CRITICAL] reviewer "${name}" is dispatchable_by doer "${d}" (kind="${manager.kind}"${manager.build_chain ? ", build_chain" : ""}) — reviewers CANNOT report to doers (ADR-0007 reporting-line invariant)`);
        }
      }
    }
  }
  return errors;
}

function readAllSpecFm(root, reg) {
  const specFm = {};
  for (const r of Object.values((reg && reg.roles) || {})) {
    if (!r || !r.spec) continue;
    try {
      const body = fs.readFileSync(path.join(root, r.spec), "utf8");
      const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (!fm) continue;
      const m = fm[1].match(/^model:\s*(\S+)/m);
      if (m) specFm[r.spec] = m[1];
    } catch { }
  }
  return specFm;
}

function evaluateModelPins({ reg, specFm }) {
  const errors = [];
  const roles = (reg && reg.roles) || {};
  for (const [name, r] of Object.entries(roles)) {
    if (!r || typeof r !== "object" || !r.spec) continue;
    const fm = specFm && specFm[r.spec];
    if (fm === undefined) {
      errors.push(
        `model-pin: registry role "${name}" spec "${r.spec}" has NO resolvable model ` +
        `frontmatter (missing file, missing frontmatter block, or no model: line) — ` +
        `every registry-routed role must carry an explicit pin`
      );
      continue;
    }
    if (fm === "inherit") {
      errors.push(
        `model-pin: registry role "${name}" spec "${r.spec}" has model: inherit — ` +
        `inherit is FORBIDDEN for registry-routed roles (the registry is the routing SoT; ` +
        `inherit silently bypasses it by inheriting the caller session model)`
      );
      continue;
    }
    const provider = r.provider || "claude";
    if (provider === "claude" && r.model && fm !== r.model) {
      errors.push(
        `model-pin: registry role "${name}" spec "${r.spec}" frontmatter model "${fm}" ` +
        `≠ registry model "${r.model}" — the spec must pin the registry model for Claude roles`
      );
    }
  }
  return errors;
}

const CROSS_PROVIDER_SCOPE = Object.freeze(["openai", "antigravity"]);

function matchesClassRule(roleAttrs, when) {
  for (const [k, v] of Object.entries(when || {})) {
    if (roleAttrs[k] !== v) return false;
  }
  return true;
}

function deriveClass(roleAttrs, rules, fallback) {
  for (const rule of (rules || [])) {
    if (matchesClassRule(roleAttrs, rule.when)) return rule.class;
  }
  return fallback;
}

function evaluateShapeRouteConflicts({ reg, contract, scope = CROSS_PROVIDER_SCOPE }) {
  const errors = [];
  const roles = (reg && reg.roles) || {};
  const rules = (contract && contract.class_derivation && contract.class_derivation.rules) || [];
  const fallbackClass = (contract && contract.class_derivation && contract.class_derivation.fallback_class) || "manager";
  const roleClasses = (contract && contract.role_classes) || {};

  for (const [name, r] of Object.entries(roles)) {
    if (!r || typeof r !== "object") continue;
    const provider = r.provider || "claude";
    if (!scope.includes(provider)) continue;

    const derivedClass = deriveClass(r, rules, fallbackClass);
    const classEntry = roleClasses[derivedClass];
    if (!classEntry) continue;

    const allowedShapes = classEntry.allowed_shapes || [];
    if (!allowedShapes.includes("subprocess-cross-provider")) {
      errors.push(
        `shape-route-conflict: registry role "${name}" has provider="${provider}" ` +
        `(requires subprocess-cross-provider dispatch for provider-diversity) but ` +
        `derived class "${derivedClass}" allowed_shapes [${allowedShapes.join(", ")}] ` +
        `cannot express it — add a specific class_derivation rule before the catch-all ` +
        `(e.g. {tier:"lead",provider:"openai"} → cross_provider_consult_lead)`
      );
    }
  }
  return errors;
}

const HOOK_SCRAPPED_LITERALS = ["redteam", "req-reviewer"];
const SCRAPPED_CANONICAL = { redteam: "security-reviewer", "req-reviewer": "qa-reviewer" };

function referencesScrappedLiteral(src, literal) {
  const q = new RegExp(`["'\`]${literal}["'\`]`);
  const k = new RegExp(`(^|[^\\w-])${literal}([^\\w-]|$)`, "m");
  return q.test(src) || k.test(src);
}

function normalizesOrDerives(src) {
  return (
    /role-aliases/.test(src) ||
    /normalizeRole\b/.test(src) ||
    /dispatch\/org-roles/.test(src)
  );
}

function evaluateHooks({ hookSources, scrappedRoles = HOOK_SCRAPPED_LITERALS }) {
  const errors = [];
  for (const [name, src] of Object.entries(hookSources || {})) {
    if (typeof src !== "string") continue;
    if (normalizesOrDerives(src)) continue;
    const hits = [];
    for (const lit of scrappedRoles) {
      if (!referencesScrappedLiteral(src, lit)) continue;
      const canon = SCRAPPED_CANONICAL[lit];
      if (canon && referencesScrappedLiteral(src, canon)) continue;
      hits.push(lit);
    }
    if (hits.length === 0) continue;
    errors.push(
      `hook "${name}" gates on scrapped role literal(s) [${hits.join(", ")}] with no normalizeRole/role-aliases/org-roles safety net and no canonical replacement present — a rename silently no-ops it (false-green class)`,
    );
  }
  return errors;
}

function readHookSources(root) {
  const dir = path.join(root, "scripts", "hooks");
  const out = {};
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (!e.isFile() || !e.name.endsWith(".js")) continue;
    try { out[e.name] = fs.readFileSync(path.join(dir, e.name), "utf8"); } catch { }
  }
  return out;
}

function main(argv) {
  const json = argv.includes("--json");
  let errors;
  try {
    const org = readJSON(path.join(ROOT, ".claude/agents/_org/org-map.json"));
    const catalog = require(path.join(ROOT, "scripts/dispatch/catalog.js"));
    if (!Array.isArray(catalog.ROLES)) { process.stderr.write("role-parity: catalog.js does not export ROLES\n"); return 2; }
    const { gammaOnlyTypes } = require(path.join(ROOT, "scripts/dispatch/org-roles.js"));
    const gammaOnly = gammaOnlyTypes(org);
    if (!(gammaOnly instanceof Set) || gammaOnly.size === 0) { process.stderr.write("role-parity: org-roles.gammaOnlyTypes() returned empty\n"); return 2; }
    let registryRoles = new Set();
    try {
      const reg = readJSON(path.join(ROOT, ".claude/agents/_org/role-registry.json"));
      registryRoles = new Set(Object.keys(reg.roles || {}));
    } catch { }
    errors = evaluate({ org, ROLES: catalog.ROLES, gammaOnly, agentResolves: makeRealAgentResolver(ROOT), registryRoles });
    const tgSrc = fs.readFileSync(path.join(ROOT, "scripts/hooks/team-guard.js"), "utf8");
    if (!/require\(\s*["'][^"']*dispatch\/org-roles["']\s*\)/.test(tgSrc)) {
      errors.push("team-guard.js no longer delegates its GAMMA_ONLY_TYPES gate to scripts/dispatch/org-roles (config-driven role gate bypassed — re-hardcoded?)");
    }
    const regResult = validateRegistry(ROOT, catalog);
    if (regResult.fatal) {
      process.stderr.write(`role-parity: ${regResult.errors[0]}\n`);
      return 2;
    }
    errors.push(...regResult.errors);
    try {
      const regForShape = readJSON(path.join(ROOT, ".claude/agents/_org/role-registry.json"));
      const contractForShape = readJSON(path.join(ROOT, ".claude/agents/_org/dispatch-contract.json"));
      errors.push(...evaluateShapeRouteConflicts({ reg: regForShape, contract: contractForShape }));
    } catch { }
    errors.push(...evaluateHooks({ hookSources: readHookSources(ROOT) }));
  } catch (e) {
    process.stderr.write(`role-parity-scan error: ${e.message}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(JSON.stringify({ ok: errors.length === 0, check: NAME, errors }, null, 2) + "\n");
    return errors.length ? 1 : 0;
  }
  if (errors.length === 0) {
    process.stdout.write(`OK   [${NAME}] org map ↔ dispatch catalog ↔ team-guard agree (role universe coherent)\n`);
    return 0;
  }
  process.stderr.write(`FAIL [${NAME}] role parity drift (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, evaluateRegistry, validateRegistry, evaluateReportingStructure, scanSpecTree, evaluateHooks, readHookSources, referencesScrappedLiteral, HOOK_SCRAPPED_LITERALS, parseGammaOnlyTypes, collectOrgRoles, makeRealAgentResolver, isDoerRole, evaluateModelPins, readAllSpecFm, evaluateShapeRouteConflicts, matchesClassRule, deriveClass, CROSS_PROVIDER_SCOPE };
