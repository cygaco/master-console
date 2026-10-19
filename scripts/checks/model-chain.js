#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const NAME = "model-chain";
const ROOT = path.resolve(__dirname, "..", "..");
const REGISTRY = ".claude/agents/_org/role-registry.json";

const TOP_MODEL = "claude-opus-4-8";
const ALPHA_ALLOWED = [
  { model: "claude-fable-5-1", effort: "high" },
];
const DOER_MODELS = new Set(["claude-sonnet-5-5"]);
const MAX_ALLOWED_ROLES = new Set(["security-reviewer"]);
const ULTRA_MODELS = new Set(["gpt-5.6-sol", "gpt-5.6-terra"]);
const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra", null]);
const NULL_EFFORT_ALLOW = new Set(["skeleton-builder", "security_claude_hunter"]);
const SCRAPPED_ROLES = new Set(["builder", "reviewer", "compliance", "qa", "redteam", "fixer"]);
const fmtEffort = (x) => (x === null || x === undefined ? "null" : `"${x}"`);

const THINKING_400_EFFORTS = new Set(["xhigh", "max"]);
function thinkingDisabled(t) {
  if (t == null) return false;
  if (typeof t === "string") return /^(disabled|off|false|none|no)$/i.test(t.trim());
  if (typeof t === "object" && typeof t.type === "string") return t.type.toLowerCase() === "disabled";
  return false;
}

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function collectModelRefs(reg) {
  const refs = [];
  const roles = (reg && reg.roles) || {};
  for (const [name, r] of Object.entries(roles)) {
    if (r.model != null) refs.push({ where: `roles.${name}.model`, model: r.model });
    if (r.second_pass && r.second_pass.model != null)
      refs.push({ where: `roles.${name}.second_pass.model`, model: r.second_pass.model });
    if (r.third_pass && r.third_pass.model != null)
      refs.push({ where: `roles.${name}.third_pass.model`, model: r.third_pass.model });
  }
  const policy = (reg && reg.model_policy) || {};
  for (const k of ["doers", "review_flagship", "security_2nd_pass"]) {
    if (policy[k] && policy[k].model != null)
      refs.push({ where: `model_policy.${k}.model`, model: policy[k].model });
  }
  return refs;
}

function evaluateModelChain({ reg, consumers, specs }) {
  const errors = [];
  const roles = (reg && reg.roles) || {};
  const policy = (reg && reg.model_policy) || {};

  const alpha = roles.alpha;
  if (!alpha) {
    const allowed = ALPHA_ALLOWED.map((t) => `${t.model}@${t.effort}`).join(" OR ");
    errors.push(`[CRITICAL] no "alpha" role — the top face must exist, pinned to one of: ${allowed}`);
  } else {
    const match = ALPHA_ALLOWED.some((t) => t.model === alpha.model && t.effort === alpha.effort);
    if (!match) {
      const allowed = ALPHA_ALLOWED.map((t) => `${t.model}@${t.effort}`).join(" OR ");
      errors.push(
        `[CRITICAL] alpha.model="${alpha.model}"/effort="${alpha.effort}" — the top face must be one of the sanctioned top tuples: ${allowed}`,
      );
    }
  }

  if (policy.doers && policy.doers.model && !DOER_MODELS.has(policy.doers.model))
    errors.push(
      `model_policy.doers.model="${policy.doers.model}" — the doer model must be a sanctioned doer (${[...DOER_MODELS].join(" OR ")})`,
    );

  for (const [name, r] of Object.entries(roles)) {
    if (!r.model || typeof r.model !== "string")
      errors.push(
        `role "${name}" has no model — every role must carry an explicit model (no inherit/blank; ADR-0008 routing SoT)`,
      );
    if (!("effort" in r)) {
      errors.push(
        `role "${name}" has no effort key — every role must declare effort (null only for skeleton-builder / antigravity)`,
      );
    } else if (!VALID_EFFORTS.has(r.effort)) {
      errors.push(`role "${name}" effort="${r.effort}" is not a valid level (low|medium|high|xhigh|max|ultra|null)`);
    } else if (
      r.effort === null &&
      !NULL_EFFORT_ALLOW.has(name) &&
      r.provider !== "antigravity"
    ) {
      errors.push(
        `role "${name}" effort=null but is not skeleton-builder or an antigravity role — null effort needs documented justification`,
      );
    }
  }

  for (const [name, r] of Object.entries(roles)) {
    if (r.effort === "max" && !MAX_ALLOWED_ROLES.has(name))
      errors.push(
        `role "${name}" effort=max — max is reserved for ${[...MAX_ALLOWED_ROLES].join(" / ")} (${name} caps at xhigh)`,
      );
    if (r.effort === "ultra" && !ULTRA_MODELS.has(r.model))
      errors.push(
        `role "${name}" effort=ultra on model "${r.model}" — ultra is only valid on ${[...ULTRA_MODELS].join(" / ")} (luna/claude have no ultra)`,
      );
  }

  if (consumers) {
    for (const [name, r] of Object.entries(roles)) {
      const cp = consumers.catalogProvider;
      const ce = consumers.catalogEffort;
      const pa = consumers.providerAgent;
      if (cp && name in cp && cp[name] !== r.provider)
        errors.push(`[DRIFT] catalog DEFAULT_PROVIDER_PER_ROLE["${name}"]="${cp[name]}" ≠ registry provider "${r.provider}"`);
      if (r.effort != null && ce && name in ce && ce[name] !== r.effort)
        errors.push(`[DRIFT] catalog DEFAULT_EFFORT_PER_ROLE["${name}"]="${ce[name]}" ≠ registry effort "${r.effort}"`);
      if (pa && name in pa && pa[name] !== r.provider)
        errors.push(`[DRIFT] providers DEFAULT_AGENT_PROVIDERS["${name}"]="${pa[name]}" ≠ registry provider "${r.provider}"`);
      if (r.effort != null && typeof consumers.providerEffortFn === "function") {
        let pe;
        try {
          pe = consumers.providerEffortFn(name);
        } catch {
          pe = undefined;
        }
        if (pe !== undefined && pe !== r.effort)
          errors.push(
            `[DRIFT] providers.getReasoningEffort("${name}")="${pe}" ≠ registry effort "${r.effort}" (stale DEFAULT_REASONING_EFFORT literal?)`,
          );
      }
    }
  }

  if (specs) {
    for (const [name, r] of Object.entries(roles)) {
      const s = specs[name];
      if (!s || !s.exists) continue;
      const regEffort = r.effort === undefined ? null : r.effort;
      for (const [label, has, val] of [
        ["effort", s.hasEffortKey, s.effort],
        ["provider_reasoning_effort", s.hasProviderEffortKey, s.providerEffort],
      ]) {
        if (!has) continue;
        const specEffort = val === undefined ? null : val;
        if (specEffort !== regEffort)
          errors.push(
            `[DRIFT] spec "${name}" (${s.path}) frontmatter ${label}=${fmtEffort(specEffort)} ≠ registry effort=${fmtEffort(regEffort)} — the registry is the routing SoT; the spec pin must match`,
          );
      }
    }
  }

  if (specs) {
    for (const [name, r] of Object.entries(roles)) {
      if (!r.provider || r.provider === "claude") continue;
      const s = specs[name];
      if (!s || !s.exists) continue;
      if (!s.hasProviderModelKey) {
        errors.push(
          `[DRIFT] spec "${name}" (${s.path}) is a ${r.provider} role but declares NO provider_model — dispatch-agent serves the provider DEFAULT, not the role model "${r.model}" (cosmetic-flip); add provider_model: ${r.model}`,
        );
      } else if (s.providerModel !== r.model) {
        errors.push(
          `[DRIFT] spec "${name}" (${s.path}) provider_model="${s.providerModel}" ≠ registry model="${r.model}" — the cross-provider dispatch serves the spec provider_model; it must match the registry`,
        );
      }
    }
  }

  for (const name of Object.keys(roles))
    if (SCRAPPED_ROLES.has(name))
      errors.push(`[SCRAPPED] registry role "${name}" was collapsed by ADR-0007 — it must not be a real registry role (use the pod-specific role)`);

  for (const [name, r] of Object.entries(roles)) {
    const units = [
      { where: `roles.${name}`, provider: r.provider, effort: r.effort, thinking: r.thinking },
      r.second_pass && { where: `roles.${name}.second_pass`, provider: r.second_pass.provider, effort: r.second_pass.effort, thinking: r.second_pass.thinking },
      r.third_pass && { where: `roles.${name}.third_pass`, provider: r.third_pass.provider, effort: r.third_pass.effort, thinking: r.third_pass.thinking },
    ].filter(Boolean);
    for (const u of units) {
      if (u.provider === "claude" && THINKING_400_EFFORTS.has(u.effort) && thinkingDisabled(u.thinking)) {
        errors.push(
          `[THINKING-400] ${u.where} is a Claude lane at effort="${u.effort}" with thinking DISABLED (${JSON.stringify(u.thinking)}) — opus-5 400s on disabled-thinking + xhigh/max; a Claude role at xhigh/max MUST keep thinking ON (ADR-0016)`,
        );
      }
    }
  }

  return errors;
}

function fmScalar(fmBlock, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(fmBlock);
  if (!m) return { has: false };
  let raw = m[1].trim();
  const q = raw[0];
  if ((q === '"' || q === "'") && raw.indexOf(q, 1) > 0) {
    return { has: true, value: raw.slice(1, raw.indexOf(q, 1)) };
  }
  const hash = raw.indexOf("#");
  if (hash >= 0) raw = raw.slice(0, hash).trim();
  if (raw === "" || raw === "null" || raw === "~") return { has: true, value: null };
  return { has: true, value: raw };
}

function parseFrontmatterEffort(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ""));
  if (!m) return { hasFrontmatter: false, hasEffortKey: false, hasProviderEffortKey: false, hasProviderModelKey: false };
  const eff = fmScalar(m[1], "effort");
  const pre = fmScalar(m[1], "provider_reasoning_effort");
  const pm = fmScalar(m[1], "provider_model");
  return {
    hasFrontmatter: true,
    hasEffortKey: eff.has,
    effort: eff.has ? eff.value : undefined,
    hasProviderEffortKey: pre.has,
    providerEffort: pre.has ? pre.value : undefined,
    hasProviderModelKey: pm.has,
    providerModel: pm.has ? pm.value : undefined,
  };
}

function loadSpecEfforts(reg, root) {
  const out = {};
  const roles = (reg && reg.roles) || {};
  for (const [name, r] of Object.entries(roles)) {
    if (!r.spec) {
      out[name] = { exists: false, reason: "no spec field in registry" };
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(path.join(root, r.spec), "utf8");
    } catch {
      out[name] = { exists: false, reason: "spec file unreadable", path: r.spec };
      continue;
    }
    out[name] = { exists: true, path: r.spec, ...parseFrontmatterEffort(text) };
  }
  return out;
}

function loadConsumers(root) {
  const out = { catalogProvider: null, catalogEffort: null, providerAgent: null, providerEffortFn: null, loadErrors: [] };
  try {
    const catalog = require(path.join(root, "scripts/dispatch/catalog.js"));
    out.catalogProvider = catalog.DEFAULT_PROVIDER_PER_ROLE || null;
    out.catalogEffort = catalog.DEFAULT_EFFORT_PER_ROLE || null;
  } catch (e) {
    out.loadErrors.push(`catalog.js unloadable: ${e.message}`);
  }
  try {
    const providers = require(path.join(root, "scripts/hooks/lib/providers.js"));
    out.providerAgent = providers.DEFAULT_AGENT_PROVIDERS || null;
    out.providerEffortFn = typeof providers.getReasoningEffort === "function" ? providers.getReasoningEffort : null;
  } catch (e) {
    out.loadErrors.push(`providers.js unloadable: ${e.message}`);
  }
  return out;
}

function main(argv) {
  const json = (argv || []).includes("--json");
  let reg;
  try {
    reg = readJSON(path.join(ROOT, REGISTRY));
  } catch (e) {
    process.stderr.write(`${NAME}: role-registry.json unreadable/unparseable: ${e.message}\n`);
    return 2;
  }
  let errors = [];
  try {
    const consumers = loadConsumers(ROOT);
    for (const le of consumers.loadErrors)
      errors.push(`[DRIFT] ${le} — cannot verify registry↔consumer parity`);
    const specs = loadSpecEfforts(reg, ROOT);
    errors.push(...evaluateModelChain({ reg, consumers, specs }));
  } catch (e) {
    process.stderr.write(`${NAME} error: ${e.message}\n`);
    return 2;
  }
  if (json) {
    process.stdout.write(JSON.stringify({ ok: errors.length === 0, check: NAME, errors }, null, 2) + "\n");
    return errors.length ? 1 : 0;
  }
  if (errors.length === 0) {
    process.stdout.write(
      `OK   [${NAME}] model/effort chain intentional — alpha = fable@high, doers = sonnet-5, max = security-reviewer, ultra ∈ {sol, terra}, registry↔catalog↔providers agree\n`,
    );
    return 0;
  }
  process.stderr.write(
    `FAIL [${NAME}] model-chain drift (${errors.length}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`,
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = {
  evaluateModelChain,
  collectModelRefs,
  loadConsumers,
  loadSpecEfforts,
  parseFrontmatterEffort,
  main,
  NAME,
  TOP_MODEL,
  VALID_EFFORTS,
  SCRAPPED_ROLES,
  ALPHA_ALLOWED,
  DOER_MODELS,
  MAX_ALLOWED_ROLES,
  ULTRA_MODELS,
  THINKING_400_EFFORTS,
  thinkingDisabled,
};
