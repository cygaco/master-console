#!/usr/bin/env node
"use strict";

/**
 * provider-tier-config.js — S-LC-10 D2. The preferred-tier config (greenfield).
 *
 * Carries, per provider: the operator's SELECTED tier (the floor they want the
 * readiness check to confirm) + an optional SELF-ATTESTED subscription tier /
 * tier, plus the global, OPERATOR-TUNABLE T3 subscription floor.
 *
 * ── SOURCE-vs-INSTANCE (mirrors S-LC-07 spend-ledger#resolveCeiling, P-058) ──
 *   - Framework DEFAULTS live here as a SOURCE constant (FRAMEWORK_DEFAULTS).
 *   - The instance config lives at `.claude/runtime/provider-tier-config.json`
 *     (paths.providerTierConfig) — the SAME runtime home as authorization.json,
 *     gitignored + per-machine, so no instance value is ever committed.
 *   - `readConfig()` returns the instance file WHEN present+valid, ELSE the
 *     framework defaults. It NEVER hardcodes an instance value. Absence is the
 *     normal greenfield case → framework defaults → the check never blocks.
 *
 * ── WRITE IS CONFIRM-CLASS (§14 permission matrix) ──
 *   `writeConfig()` mutates the instance file. It is ONLY reached from the CLI's
 *   explicit `--write` / `--set-tier` path. The default check path is READ-ONLY.
 *   No detection or report ever writes.
 *
 * VALUE-FREE: this config carries TIER LABELS only (selected_tier,
 * subscription_tier, t3_floor) — never a key, secret, or value of any kind.
 *
 * Zero runtime deps. Fail-open: an unreadable/garbage config → framework
 * defaults, never a throw.
 */

const fs = require("fs");
const path = require("path");

// Anchor project root from this file (cwd-independent). scripts/mc/lib → ../../../ .
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

// ── Tier model rank (T1 < T2 < T3) ───────────────────────────
// T1 = reachable (CLI + auth). T2 = + funded/keyed for paid models.
// T3 = + subscription-tier floor met. Documented fully in provider-tier-check.js.
const TIER_RANK = { none: 0, t1: 1, t2: 2, t3: 3 };

// ── Subscription tier rank (the T3 floor axis) ───────────────
// OPERATOR-TUNABLE ordering of named subscription tiers across providers. The
// T3 floor is matched against a provider's self-attested subscription_tier by
// THIS rank, so a config floor change re-grades the verdict (see the engine).
// Claude: free < pro < max_5x < max_20x. Plus generic OpenAI/Gemini sub names.
const SUBSCRIPTION_RANK = {
  none: 0,
  free: 0,
  // entry paid tiers (Claude Pro, OpenAI Plus, Gemini AI Pro) — equivalent floor
  pro: 1,
  plus: 1,
  ai_pro: 1,
  // higher Claude tiers
  max_5x: 2,
  max_20x: 3,
  // higher OpenAI / Gemini tiers
  team: 2,
  ai_ultra: 3,
  enterprise: 3,
};

// ── FRAMEWORK DEFAULTS (the SOURCE; never the instance value) ─
// OPERATOR-TUNABLE: the default selected tier is the conservative, always
// value-free-detectable floor (t1 = reachable) so a greenfield install NEVER
// produces a spurious tier_short and NEVER blocks. Raise per provider via
// `--set-tier`. The T3 floor defaults to `max_5x` for Claude (a documented,
// sensible default — NOT a session-specific value).
const DEFAULT_SELECTED_TIER = "t1";
const DEFAULT_T3_FLOOR = "max_5x"; // OPERATOR-TUNABLE (see provider-tier-check.js header)
const KNOWN_PROVIDERS = ["claude", "openai", "antigravity"];

function FRAMEWORK_DEFAULTS() {
  const providers = {};
  for (const p of KNOWN_PROVIDERS) {
    providers[p] = {
      selected_tier: DEFAULT_SELECTED_TIER,
      subscription_tier: null, // operator self-attests; null = undetected/undeclared
      attested_tier: null, // optional blanket attestation ("t2"/"t3")
    };
  }
  return {
    version: 1,
    t3_floor: DEFAULT_T3_FLOOR, // OPERATOR-TUNABLE
    providers,
  };
}

// ── Path resolution (single-sourced via paths.providerTierConfig) ─
function configPath() {
  // Resolve from the generated paths.json when available; fall back to the
  // literal under the runtime home (same home as authorization.json).
  try {
    const pj = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, ".claude", "paths.json"), "utf8"),
    );
    if (pj && typeof pj.providerTierConfig === "string") {
      return path.join(PROJECT_ROOT, pj.providerTierConfig);
    }
  } catch {
    /* fall through to the literal */
  }
  return path.join(PROJECT_ROOT, ".claude", "runtime", "provider-tier-config.json");
}

// ── READ (fail-open, source-vs-instance) ─────────────────────
/**
 * Read the preferred-tier config. Returns the INSTANCE file when present+valid,
 * else the FRAMEWORK defaults. Never throws; never hardcodes an instance value.
 *
 * ── ABSENT vs PRESENT-BUT-CORRUPT (R-6 / AC-6.2, AC-6.5) ──
 *   Both still return the framework defaults as the resolved `config` (so a caller
 *   that only reads `config` is unchanged), but they are DISTINGUISHED by a new
 *   `corrupt` flag:
 *     - ABSENT (no file)            → corrupt:false → greenfield, defaults are
 *                                     authoritative, the check may pass (AC-6.5).
 *     - PRESENT-but-unparseable     → corrupt:true  → the instance file existed and
 *                                     may have carried an operator-RAISED floor we
 *                                     can no longer read. The engine FAILS CLOSED on
 *                                     this flag rather than silently relaxing to the
 *                                     framework-default t1 (the false-green of #16).
 *   `source` stays "framework-default" in both cases (the resolved config IS the
 *   defaults); `corrupt` is the orthogonal trust signal the engine reads.
 *
 * @param {object} [opts]
 * @param {string} [opts.configPath]  override the file location (tests)
 * @param {object} [opts.configOverride]  inject a parsed config (tests)
 * @returns {{ config:object, source:"instance-file"|"framework-default", corrupt:boolean, path:string }}
 */
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
    // TRUE ABSENCE (ENOENT only) → greenfield; framework defaults are authoritative,
    // corrupt:false. ALL OTHER read failures (EISDIR — a directory sits at the path,
    // EACCES — permission denied, EPERM, etc.) mean the path EXISTS or is blocked for
    // a non-absence reason → corrupt:true → fail-closed hold. Only ENOENT is genuine
    // absence; any other error code must NOT silently degrade to the framework-default
    // t1 green (the false-green of #16, finding 7 — gauntlet attempt-1: before this
    // fix, EISDIR returned corrupt:false and the fail-closed hold never applied).
    const isAbsent = readErr.code === "ENOENT";
    return { config: FRAMEWORK_DEFAULTS(), source: "framework-default", corrupt: !isAbsent, path: file };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // PRESENT-but-unparseable → FAIL CLOSED (corrupt:true). The file existed and
    // may have carried a raised floor we can no longer read — never silently
    // degrade to the framework-default green (AC-6.2 / #16).
    return { config: FRAMEWORK_DEFAULTS(), source: "framework-default", corrupt: true, path: file };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Present but structurally invalid (JSON `null`, a bare array, a number/string)
    // → same fail-closed posture: the file is there but unusable as a config
    // object. Array.isArray is explicit because `typeof [] === "object"` in JS, so
    // a bare array would otherwise slip through as a usable instance file.
    return { config: FRAMEWORK_DEFAULTS(), source: "framework-default", corrupt: true, path: file };
  }
  return { config: normalize(parsed), source: "instance-file", corrupt: false, path: file };
}

// Merge a partial instance config over the framework defaults so a sparse file
// (only one provider, only the floor) still resolves every field.
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
  // Union of known providers + any extra declared in the file.
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

// ── WRITE (CONFIRM-CLASS — only the CLI --write/--set-tier path reaches here) ─
/**
 * Persist the instance config. The caller MUST have an explicit operator-confirm
 * flag (--write / --set-tier) — this helper does not itself gate, the CLI does.
 *
 * @returns {{ ok:boolean, path:string, error?:string }}
 */
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

// ── Resolvers used by the engine ─────────────────────────────
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
