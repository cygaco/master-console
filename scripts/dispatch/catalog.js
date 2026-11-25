
"use strict";

const ANTHROPIC = {
  id: "claude",
  label: "Anthropic (Claude)",
  cli: "claude",
  cliEffortFlagTemplate: "--effort {effort}",
  syntaxTemplate: "claude -p {reasoning} --agent {role}",
  requiresFallback: false,
  defaultModel: "claude-opus-5-5",
  models: [
    {
      id: "claude-fable-5-2",
      label: "Claude Fable 5.2 (top brain tier — latest; replaces fable-5-1)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 8, outPerMTok: 40 },
      aliases: ["fable", "fable-5-2", "claude-fable-5-2"],
    },
    {
      id: "claude-fable-5-1",
      label: "Claude Fable 5.1 (legacy — superseded by claude-fable-5-2; still served)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 10, outPerMTok: 50 },
      aliases: ["fable-5-1", "claude-fable-5-1"],
    },
    {
      id: "claude-fable-5",
      label: "Claude Fable 5 (legacy — superseded by claude-fable-5-1; still served)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 10, outPerMTok: 50 },
      aliases: ["claude-fable-5"],
    },
    {
      id: "claude-sonnet-5-5",
      label: "Claude Sonnet 5.5 (builders/fixers tier — GA 2026-09-28; replaces sonnet-5)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 2, outPerMTok: 10 },
      aliases: ["sonnet", "sonnet-5-5", "claude-sonnet-5-5"],
    },
    {
      id: "claude-sonnet-5",
      label: "Claude Sonnet 5 (legacy — superseded by claude-sonnet-5-5; still served)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 2, outPerMTok: 10 },
      aliases: ["sonnet-5", "claude-sonnet-5"],
    },
    {
      id: "claude-opus-5",
      label: "Claude Opus 5 (legacy — superseded by claude-opus-5-5; still served)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 5, outPerMTok: 25 },
      aliases: ["claude-opus-5"],
    },
    {
      id: "claude-opus-5-5",
      label: "Claude Opus 5.5 (opus tier — GA 2026-09-22; API default effort = medium, pin explicitly)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 4, outPerMTok: 20 },
      defaultEffort: "medium",
      aliases: ["opus", "claude-opus-5-5"],
    },
    {
      id: "claude-opus-4-8",
      label: "Claude Opus 4.8 (legacy — still served; provider-fallback deep_fallback target)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 5, outPerMTok: 25 },
      aliases: ["claude-opus-4-8"],
    },
    {
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6 (legacy — still served; superseded by claude-sonnet-5-5)",
      effortLevels: ["low", "medium", "high", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
      pricing: { inPerMTok: 3, outPerMTok: 15 },
      aliases: ["claude-sonnet-4-6"],
    },
    {
      id: "claude-haiku-5-5",
      label: "Claude Haiku 5.5 (haiku tier — GA 2026-10-07; API default effort = medium)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 0.1, outPerMTok: 0.5 },
      defaultEffort: "medium",
      aliases: ["haiku", "haiku-5-5", "claude-haiku-5-5"],
    },
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5 (legacy — still served; superseded by claude-haiku-5-5)",
      effortLevels: [],
      contextTokens: 200_000,
      maxOutputTokens: 64_000,
      pricing: { inPerMTok: 1, outPerMTok: 5 },
      aliases: ["claude-haiku-4-5"],
    },
  ],
};

const OPENAI = {
  id: "openai",
  label: "OpenAI",
  cli: "codex",
  cliEffortFlagTemplate: "-c model_reasoning_effort={effort}",
  syntaxTemplate: "codex exec --sandbox workspace-write {reasoning} -m {model} -",
  requiresFallback: true,
  defaultModel: "gpt-6.1-sol",
  models: [
    {
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol (flagship — live default)",
      effortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 4, outPerMTok: 20 },
    },
    {
      id: "gpt-5.6-terra",
      label: "GPT-5.6 Terra (mid)",
      effortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 2, outPerMTok: 12 },
    },
    {
      id: "gpt-5.6-luna",
      label: "GPT-5.6 Luna (cheap mini rung)",
      effortLevels: ["low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 0.2, outPerMTok: 1.2 },
    },
    {
      id: "gpt-6-astra",
      servability: { codexChatgptAccount: true, codexVersion: "0.160.0" },
      label: "GPT-6 Astra (newest flagship — $10/$50)",
      effortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 10, outPerMTok: 50 },
    },
    {
      id: "gpt-6.1-sol",
      servability: { codexChatgptAccount: true, codexVersion: "0.160.0" },
      label: "GPT-6.1 Sol (coding flagship — Codex CLI default; migrate_to for gpt-5.5 / gpt-5.4)",
      effortLevels: ["low", "medium", "high", "xhigh", "max", "ultra"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 2, outPerMTok: 10 },
    },
    {
      id: "gpt-6.1-terra",
      servability: { codexChatgptAccount: true, codexVersion: "0.159.0" },
      label: "GPT-6.1 Terra (fast/efficient — writing, visual reasoning, computer use; $1/$5)",
      effortLevels: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 1, outPerMTok: 5 },
    },
    {
      id: "gpt-6-sol",
      servability: { codexChatgptAccount: true, codexVersion: "0.160.0" },
      label: "GPT-6 Sol (GA; superseded by gpt-6.1-sol)",
      effortLevels: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 2, outPerMTok: 10 },
    },
    {
      id: "gpt-6-luna",
      servability: { codexChatgptAccount: true, codexVersion: "0.160.0" },
      label: "GPT-6 Luna (cheap/high-volume — migrate_to for gpt-5.4-mini / gpt-5.4-nano)",
      effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
      contextTokens: 1_050_000,
      maxOutputTokens: 128_000,
      pricing: { inPerMTok: 0.1, outPerMTok: 0.5 },
    },
  ],
};

const ANTIGRAVITY = {
  id: "antigravity",
  label: "Antigravity (Gemini)",
  cli: "agy",
  cliEffortFlagTemplate: "",
  syntaxTemplate: "agy --model {model} --print-timeout 90s -p '{prompt}'",
  requiresFallback: true,
  defaultModel: "gemini-4-argon-high",
  models: [
    {
      id: "gemini-4-argon-high",
      label: "Gemini 4 Argon (high thinking) — via agy",
      agyModelName: "Gemini 4 Argon (High)",
      apiId: "gemini-4-argon",
      effortLevels: [],
      contextTokens: 1_048_576,
      maxOutputTokens: 65_536,
      thinkingAlwaysOn: true,
      pricing: { inPerMTok: 2, outPerMTok: 10 },
    },
    {
      id: "gemini-3.1-pro-high",
      label: "Gemini 3.1 Pro (high thinking) — via agy — NOT SERVED by agy since 2026-10-17",
      agyModelName: "Gemini 3.1 Pro (High)",
      apiId: "gemini-3.1-pro-preview",
      effortLevels: [],
      contextTokens: 1_000_000,
      maxOutputTokens: 65_536,
      thinkingAlwaysOn: true,
      pricing: { inPerMTok: 2, outPerMTok: 12 },
    },
    {
      id: "gemini-3.8-flash",
      label: "Gemini 3.8 Flash (high thinking) — via agy",
      agyModelName: "Gemini 3.8 Flash (High)",
      apiId: "gemini-3.8-flash",
      effortLevels: [],
      contextTokens: 1_048_576,
      maxOutputTokens: 65_536,
      thinkingAlwaysOn: true,
      pricing: { inPerMTok: 0.75, outPerMTok: 3.75 },
    },
  ],
};

const PROVIDERS = { claude: ANTHROPIC, openai: OPENAI, antigravity: ANTIGRAVITY };

const CATALOG_MODELS_FILE = require("path").join(__dirname, "catalog-models.json");
const DATA_ROW_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DATA_ROW_DISPLAY = /^[A-Za-z0-9][A-Za-z0-9 .()\-]{0,63}$/;

const DATA_ROW_EFFORT = /^(low|medium|high|xhigh|max|ultra)$/i;
const isNonNegNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

function warnRow(msg) {
  process.stderr.write("catalog-models.json: " + msg + "\n");
}

function mergeDataRows(providers, file) {
  let doc;
  try {
    doc = JSON.parse(require("fs").readFileSync(file, "utf8"));
  } catch (_) {
    return 0;
  }
  const rows = doc && Array.isArray(doc.models) ? doc.models : [];
  const own = Object.prototype.hasOwnProperty;
  const seen = new Set();
  let added = 0;
  for (const row of rows) {
    const p =
      row && typeof row === "object" && typeof row.provider === "string" && own.call(providers, row.provider)
        ? providers[row.provider]
        : null;
    const bad =
      !p || !Array.isArray(p.models) ? "unknown provider"
      : typeof row.id !== "string" || !DATA_ROW_ID.test(row.id) ? "bad id"
      : typeof row.displayName !== "string" || !DATA_ROW_DISPLAY.test(row.displayName) ? "bad displayName"
      : null;
    if (bad) {
      warnRow(`skipped row ${JSON.stringify(row && row.id)} (${bad})`);
      continue;
    }
    const key = row.provider + "/" + row.id;
    if (seen.has(key)) {
      warnRow(`duplicate row ${JSON.stringify(row.id)} ignored (first one kept)`);
      continue;
    }
    seen.add(key);
    if (p.models.some((m) => m.id === row.id || (m.aliases || []).includes(row.id))) continue;
    let efforts = [];
    if (Array.isArray(row.effortLevels)) {
      efforts = row.effortLevels.filter((e) => typeof e === "string" && DATA_ROW_EFFORT.test(e));
      if (efforts.length !== row.effortLevels.length) {
        warnRow(`row ${JSON.stringify(row.id)}: dropped effort levels outside the allowed vocabulary`);
      }
    }
    const m = {
      id: row.id,
      label: `${row.displayName} — via ${p.cli}`,
      displayName: row.displayName,
      effortLevels: efforts,
      fromDataFile: true,
    };
    if (typeof row.apiId === "string") m.apiId = row.apiId;
    for (const k of ["contextTokens", "maxOutputTokens"]) {
      if (row[k] === undefined) continue;
      if (isNonNegNum(row[k])) m[k] = row[k];
      else warnRow(`row ${JSON.stringify(row.id)}: ignored non-numeric ${k}`);
    }
    if (row.pricing !== undefined) {
      const pr = row.pricing;
      const clean = {};
      if (pr && typeof pr === "object" && !Array.isArray(pr)) {
        for (const k of Object.keys(pr)) if (isNonNegNum(pr[k])) clean[k] = pr[k];
      }
      if (Object.keys(clean).length) m.pricing = clean;
      else warnRow(`row ${JSON.stringify(row.id)}: ignored invalid pricing`);
    }
    if (p.id === "antigravity") m.agyModelName = row.displayName;
    p.models.push(m);
    added++;
  }
  return added;
}

mergeDataRows(PROVIDERS, CATALOG_MODELS_FILE);
const PROVIDER_LIST = [ANTHROPIC, OPENAI, ANTIGRAVITY];

const PROVIDER_ALIASES = {
  anthropic: "claude",
  claude: "claude",
  openai: "openai",
  gpt: "openai",
  google: "antigravity",
  antigravity: "antigravity",
  agy: "antigravity",
};

function normalizeProviderId(id) {
  if (!id) return id;
  return PROVIDER_ALIASES[id.toLowerCase()] || id;
}

const LEGACY_ROLE_NAMES = Object.freeze(["builder", "fixer", "reviewer", "compliance", "qa", "redteam"]);

const LITERAL_ROLES = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "builder",
  "frontend-builder",
  "backend-builder",
  "design-quality",
  "fixer",
  "reviewer",
  "compliance",
  "ops-analyst",
  "qa",
  "redteam",
  "skeleton-builder",
  "epsilon",
  "design-lead",
  "frontend-reviewer",
  "frontend-fixer",
  "backend-reviewer",
  "backend-fixer",
  "security-builder",
  "security-reviewer",
  "security-fixer",
  "qa-reviewer",
  "visual-review",
  "test-runner",
  "cabinet",
];

const registryRoles = require("./registry-roles");

const ROLES = registryRoles.deriveOrFallback(
  () => {
    const ids = registryRoles.roleIds();
    return ids.length ? [...ids, ...LEGACY_ROLE_NAMES.filter((r) => !ids.includes(r))] : [];
  },
  LITERAL_ROLES,
  "catalog.ROLES",
);

const LITERAL_DEFAULT_PROVIDER_PER_ROLE = {
  alpha: "claude",
  beta: "claude",
  gamma: "claude",
  delta: "claude",
  builder: "claude",
  "frontend-builder": "claude",
  "backend-builder": "claude",
  "design-quality": "claude",
  fixer: "claude",
  reviewer: "openai",
  compliance: "openai",
  "ops-analyst": "openai",
  qa: "openai",
  redteam: "openai",
  "skeleton-builder": "claude",
  cabinet: "openai",
  epsilon: "claude",
  "design-lead": "openai",
  "frontend-reviewer": "openai",
  "frontend-fixer": "claude",
  "backend-reviewer": "openai",
  "backend-fixer": "claude",
  "security-builder": "claude",
  "security-reviewer": "openai",
  "security-fixer": "claude",
  "qa-reviewer": "openai",
  "visual-review": "claude",
  "test-runner": "claude",
};

const LITERAL_DEFAULT_EFFORT_PER_ROLE = {
  alpha: "max",
  beta: "xhigh",
  gamma: "high",
  delta: "high",
  builder: "high",
  "frontend-builder": "high",
  "backend-builder": "high",
  "design-quality": "high",
  fixer: "high",
  reviewer: "xhigh",
  compliance: "xhigh",
  "ops-analyst": "xhigh",
  qa: "medium",
  redteam: "high",
  "skeleton-builder": null,
  cabinet: "xhigh",
  epsilon: "high",
  "design-lead": "xhigh",
  "frontend-reviewer": "xhigh",
  "frontend-fixer": "high",
  "backend-reviewer": "xhigh",
  "backend-fixer": "high",
  "security-builder": "high",
  "security-reviewer": "high",
  "security-fixer": "high",
  "qa-reviewer": "xhigh",
  "visual-review": "high",
  "test-runner": "medium",
};

const DEFAULT_PROVIDER_PER_ROLE = registryRoles.deriveOrFallback(
  () => ({
    ...registryRoles.providerMap(),
    ...registryRoles.SCRAPPED_PROVIDER_ALIASES,
  }),
  LITERAL_DEFAULT_PROVIDER_PER_ROLE,
  "catalog.DEFAULT_PROVIDER_PER_ROLE",
);
const DEFAULT_EFFORT_PER_ROLE = registryRoles.deriveOrFallback(
  () => ({
    ...registryRoles.effortMap(),
    ...registryRoles.SCRAPPED_EFFORT_ALIASES,
  }),
  LITERAL_DEFAULT_EFFORT_PER_ROLE,
  "catalog.DEFAULT_EFFORT_PER_ROLE",
);

function getProvider(id) {
  const normalized = normalizeProviderId(id);
  return PROVIDERS[normalized] || null;
}

function getModel(providerId, modelId) {
  const p = PROVIDERS[providerId];
  if (!p) return null;
  return (
    p.models.find(
      (m) => m.id === modelId || (m.aliases || []).includes(modelId),
    ) || null
  );
}

function resolveModelAlias(modelOrAlias) {
  for (const p of PROVIDER_LIST) {
    for (const m of p.models) {
      if ((m.aliases || []).includes(modelOrAlias)) return m.id;
    }
  }
  return modelOrAlias;
}

function agyModelName(canonicalId) {
  const m = getModel("antigravity", canonicalId);
  return (m && m.agyModelName) || canonicalId;
}

function validateTuple(provider, model, effort) {
  const p = getProvider(provider);
  if (!p) return `Unknown provider: ${provider}`;
  const m = getModel(p.id, model);
  if (!m) return `Model "${model}" not available on provider "${provider}"`;
  if (m.deprecated) return `Model "${model}" is deprecated`;
  if (effort) {
    if (m.effortLevels.length === 0) {
      return null;
    }
    if (!m.effortLevels.includes(effort)) {
      return `Effort "${effort}" not supported by model "${model}". Allowed: ${m.effortLevels.join(", ")}`;
    }
  }
  return null;
}

module.exports = {
  PROVIDERS,
  PROVIDER_LIST,
  PROVIDER_ALIASES,
  ROLES,
  LEGACY_ROLE_NAMES,
  DEFAULT_PROVIDER_PER_ROLE,
  LITERAL_DEFAULT_PROVIDER_PER_ROLE,
  DEFAULT_EFFORT_PER_ROLE,
  getProvider,
  getModel,
  resolveModelAlias,
  agyModelName,
  normalizeProviderId,
  validateTuple,
  mergeDataRows,
};
