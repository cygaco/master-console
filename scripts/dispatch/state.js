
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  PROVIDERS,
  DEFAULT_EFFORT_PER_ROLE,
  resolveModelAlias,
} = require("./catalog");
const registryRoles = require("./registry-roles");

const resolveModelAliasFromCatalog = resolveModelAlias;
const { effectivePin, effectiveProviderForRole } = require("./effective-pin");
const { buildRoleFileMap } = require("./role-files");
const { parse: parseFm, getValue } = require("./frontmatter");

const PROJECT_ROOT = process.cwd();

const ENV_REASONING_VAR_PER_ROLE = {
  alpha: null,
  beta: null,
  gamma: null,
  delta: null,
  builder: "REASONING_BUILDER",
  fixer: "REASONING_FIXER",
  reviewer: "REASONING_REVIEWER",
  compliance: "REASONING_COMPLIANCE",
  "ops-analyst": "REASONING_LEARNER",
  qa: "REASONING_QA",
  redteam: "REASONING_REDTEAM",
  "skeleton-builder": null,
  cabinet: null,
};

const LEGACY_ENV_REASONING_VAR_PER_ROLE = {
  reviewer: "REASONING_EVALUATOR",
  "ops-analyst": "REASONING_AUDITOR",
};

const FLAGSHIP_OPENAI_ROLES = registryRoles.deriveOrFallback(
  () => [
    ...new Set([...registryRoles.flagshipOpenaiRoles(), "reviewer", "compliance"]),
  ],
  ["reviewer", "compliance", "ops-analyst", "design-lead", "frontend-reviewer", "backend-reviewer", "qa-reviewer", "cabinet"],
  "state.FLAGSHIP_OPENAI_ROLES",
);
const MINI_OPENAI_ROLES = ["qa"];

function readRoleFrontmatter(files) {
  if (files.length === 0) {
    return {
      model: null,
      provider: null,
      provider_model: null,
      provider_fallback: null,
      provider_reasoning_effort: null,
      effort: null,
    };
  }
  const raw = fs.readFileSync(files[0], "utf8");
  const parsed = parseFm(raw);
  return {
    model: getValue(parsed, "model"),
    provider: getValue(parsed, "provider"),
    provider_model: getValue(parsed, "provider_model"),
    provider_fallback: getValue(parsed, "provider_fallback"),
    provider_reasoning_effort: getValue(parsed, "provider_reasoning_effort"),
    effort: getValue(parsed, "effort"),
  };
}

function resolveProvider(role) {
  return effectiveProviderForRole(role);
}

function providerSourceOf(role) {
  const pin = effectivePin(role);
  return pin && (pin.source === "project" || pin.source === "overlay") ? "manifest" : "default";
}

function resolveModel(role, provider, fm) {
  const envShadows = [];
  if (provider === "openai" && FLAGSHIP_OPENAI_ROLES.includes(role)) {
    const v = process.env.OPENAI_FLAGSHIP_MODEL;
    if (v) {
      envShadows.push({
        var: "OPENAI_FLAGSHIP_MODEL",
        value: v,
        affects: "model",
      });
      return { model: v, modelSource: "env", envShadowsModel: envShadows };
    }
  }
  if (provider === "openai" && MINI_OPENAI_ROLES.includes(role)) {
    const v = process.env.OPENAI_MINI_MODEL;
    if (v) {
      envShadows.push({ var: "OPENAI_MINI_MODEL", value: v, affects: "model" });
      return { model: v, modelSource: "env", envShadowsModel: envShadows };
    }
  }
  if (provider === "claude" && fm.model && fm.model !== "inherit") {
    const resolved = resolveModelAliasFromCatalog(fm.model);
    return {
      model: resolved,
      modelSource: "frontmatter",
      envShadowsModel: envShadows,
    };
  }
  if (provider !== "claude" && fm.provider_model) {
    return {
      model: fm.provider_model,
      modelSource: "frontmatter",
      envShadowsModel: envShadows,
    };
  }
  const pin = legacyAliasPin(role, provider);
  if (pin) {
    return { model: pin, modelSource: "legacy-alias-pin", envShadowsModel: envShadows };
  }
  return {
    model: PROVIDERS[provider].defaultModel,
    modelSource: "default",
    envShadowsModel: envShadows,
  };
}

function legacyAliasPin(role, provider) {
  try {
    return require("../hooks/lib/providers").legacyAliasPin(role, provider);
  } catch {
    return null;
  }
}

function resolveEffort(role, fm) {
  const envShadows = [];
  const envVar = ENV_REASONING_VAR_PER_ROLE[role];
  if (envVar) {
    const v = process.env[envVar];
    if (v) {
      envShadows.push({ var: envVar, value: v, affects: "effort" });
      return { effort: v, effortSource: "env", envShadowsEffort: envShadows };
    }
  }
  const legacyVar = LEGACY_ENV_REASONING_VAR_PER_ROLE[role];
  if (legacyVar) {
    const v = process.env[legacyVar];
    if (v) {
      envShadows.push({ var: legacyVar, value: v, affects: "effort" });
      return { effort: v, effortSource: "env", envShadowsEffort: envShadows };
    }
  }
  const fmEffort = fm.provider_reasoning_effort || fm.effort;
  if (fmEffort) {
    return {
      effort: fmEffort,
      effortSource: "frontmatter",
      envShadowsEffort: envShadows,
    };
  }
  return {
    effort: DEFAULT_EFFORT_PER_ROLE[role],
    effortSource: "default",
    envShadowsEffort: envShadows,
  };
}

function relPosix(p) {
  return path.relative(PROJECT_ROOT, p).split(path.sep).join("/");
}

function buildPanelState() {
  const roleFiles = buildRoleFileMap();

  const roles = [];
  for (const role of registryRoles.roleIds()) {
    const files = roleFiles[role] || [];
    const fmRaw = readRoleFrontmatter(files);
    const pin = effectivePin(role);
    const fm = { ...fmRaw };
    if (pin && pin.model) {
      if (pin.provider === "claude") fm.model = pin.model;
      else fm.provider_model = pin.model;
    }
    if (pin && pin.effort) {
      fm.provider_reasoning_effort = pin.effort;
    }
    const provider = resolveProvider(role);
    const providerSource = providerSourceOf(role);
    const { model, modelSource, envShadowsModel } = resolveModel(
      role,
      provider,
      fm,
    );
    const { effort, effortSource, envShadowsEffort } = resolveEffort(role, fm);
    const fallback = fm.provider_fallback || null;

    roles.push({
      role,
      provider,
      providerSource,
      model,
      modelSource,
      effort,
      effortSource,
      fallback,
      files: files.map(relPosix),
      envShadows: [...envShadowsModel, ...envShadowsEffort],
      raw: fmRaw,
    });
  }

  return {
    manifestPath: ".claude/manifest.json",
    roles,
  };
}

module.exports = { buildPanelState, resolveModel };
