#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

const TIER_RANK = { none: 0, t1: 1, t2: 2, t3: 3 };

const SUBSCRIPTION_RANK = {
  none: 0,
  free: 0,
  pro: 1,
  plus: 1,
  ai_pro: 1,
  max_5x: 2,
  max_20x: 3,
  team: 2,
  ai_ultra: 3,
  enterprise: 3,
};

const DEFAULT_SELECTED_TIER = "t1";
const DEFAULT_T3_FLOOR = "max_5x";
const KNOWN_PROVIDERS = ["claude", "openai", "antigravity"];

function FRAMEWORK_DEFAULTS() {
  const providers = {};
  for (const p of KNOWN_PROVIDERS) {
    providers[p] = {
      selected_tier: DEFAULT_SELECTED_TIER,
      subscription_tier: null,
      attested_tier: null,
    };
  }
  return {
    version: 1,
    t3_floor: DEFAULT_T3_FLOOR,
    providers,
  };
}

function configPath() {
  try {
    const pj = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, ".claude", "paths.json"), "utf8"),
    );
    if (pj && typeof pj.providerTierConfig === "string") {
      return path.join(PROJECT_ROOT, pj.providerTierConfig);
    }
  } catch {
  }
  return path.join(PROJECT_ROOT, ".claude", "runtime", "provider-tier-config.json");
}

function readConfig(opts = {}) {
  if (opts.configOverride) {
    return { config: normalize(opts.configOverride), source: "instance-file", corrupt: false, path: opts.configPath || configPath() };
  }
  const file = opts.configPath || configPath();
  let raw;
  let readErr;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    readErr = e;
  }
  if (readErr) {
    const isAbsent = readErr.code === "ENOENT";
    return { config: FRAMEWORK_DEFAULTS(), source: "framework-default", corrupt: !isAbsent, path: file };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { config: FRAMEWORK_DEFAULTS(), source: "framework-default", corrupt: true, path: file };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { config: FRAMEWORK_DEFAULTS(), source: "framework-default", corrupt: true, path: file };
  }
  return { config: normalize(parsed), source: "instance-file", corrupt: false, path: file };
}

function normalize(parsed) {
  const base = FRAMEWORK_DEFAULTS();
  const out = {
    version: typeof parsed.version === "number" ? parsed.version : base.version,
    t3_floor:
      typeof parsed.t3_floor === "string" && parsed.t3_floor.trim()
        ? parsed.t3_floor.trim()
        : base.t3_floor,
    providers: {},
  };
  const pin = parsed.providers && typeof parsed.providers === "object" ? parsed.providers : {};
  const names = new Set([...KNOWN_PROVIDERS, ...Object.keys(pin)]);
  for (const name of names) {
    const d = base.providers[name] || { selected_tier: DEFAULT_SELECTED_TIER, subscription_tier: null, attested_tier: null };
    const v = pin[name] && typeof pin[name] === "object" ? pin[name] : {};
    out.providers[name] = {
      selected_tier: validTier(v.selected_tier) ? v.selected_tier : d.selected_tier,
      subscription_tier: typeof v.subscription_tier === "string" ? v.subscription_tier.trim() || null : d.subscription_tier,
      attested_tier: validTier(v.attested_tier) ? v.attested_tier : d.attested_tier,
    };
  }
  return out;
}

function validTier(t) {
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(TIER_RANK, t) && t !== "none";
}

function writeConfig(config, opts = {}) {
  const file = opts.configPath || configPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(normalize(config), null, 2) + "\n");
    return { ok: true, path: file };
  } catch (e) {
    return { ok: false, path: file, error: String((e && e.message) || e) };
  }
}

function resolveSelectedTier(config, provider) {
  const p = config && config.providers && config.providers[provider];
  return (p && validTier(p.selected_tier) && p.selected_tier) || DEFAULT_SELECTED_TIER;
}
function resolveT3Floor(config) {
  return (config && typeof config.t3_floor === "string" && config.t3_floor) || DEFAULT_T3_FLOOR;
}

module.exports = {
  FRAMEWORK_DEFAULTS,
  TIER_RANK,
  SUBSCRIPTION_RANK,
  DEFAULT_SELECTED_TIER,
  DEFAULT_T3_FLOOR,
  KNOWN_PROVIDERS,
  configPath,
  readConfig,
  writeConfig,
  normalize,
  validTier,
  resolveSelectedTier,
  resolveT3Floor,
  PROJECT_ROOT,
};
