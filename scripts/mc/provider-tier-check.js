#!/usr/bin/env node
"use strict";

/**
 * provider-tier-check.js — S-LC-10 D1. The provider TIER engine.
 *
 * Layers a tier grade OVER the existing health stack (provider-health.js +
 * dispatch-readiness.js + auth-resolver.js — REUSED, never duplicated). It
 * answers a question the health stack does not: "is each provider funded /
 * subscribed to the floor the operator selected?" — value-free, report-only.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE T1 / T2 / T3 TIER MODEL
 * ════════════════════════════════════════════════════════════════════════════
 *   T1  REACHABLE       — CLI installed + auth present (the health stack's
 *                         existing checks). Built OVER dispatch-readiness.js's
 *                         cliInstalled() + detectAuthTier(). For Claude (the
 *                         harness) T1 is always met.
 *   T2  FUNDED / KEYED  — T1, PLUS a value-free signal the provider can pay for
 *                         paid models: an API key NAME present (auth-resolver,
 *                         value-free) OR a paid OAuth login (auth tier "oauth").
 *   T3  SUBSCRIBED      — T2, PLUS the provider's subscription tier meets the
 *                         configured FLOOR. The floor is value-free-UNDETECTABLE
 *                         (no value-free billing API exists), so T3 is confirmed
 *                         ONLY by self-attestation (default) or an opt-in --probe
 *                         (stubbed). NEVER by infer-from-dispatch (forbidden —
 *                         §22 #3 — a paid call to detect tier is silently wrong
 *                         on quota-exhaustion).
 *
 * Claude is treated as a fundable + sub-checked provider (NOT auto-ok): T1 is
 * the harness floor, but T2/T3 require a value-free key NAME or self-attestation.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THE CONFIG-DRIVEN T3 FLOOR (OPERATOR-TUNABLE — NOT hardcoded)
 * ════════════════════════════════════════════════════════════════════════════
 *   The subscription tier that counts as "T3" is a CONFIG VALUE, defaulted to a
 *   documented sensible value (`max_5x` for Claude) in provider-tier-config.js
 *   (FRAMEWORK_DEFAULTS) and surfaced in the instance config. Changing the
 *   config's `t3_floor` re-grades the verdict: a provider self-attesting `pro`
 *   is T3-short under a `max_5x` floor but T3-met once the floor is lowered to
 *   `pro`. The floor is NEVER a session-specific hardcode (source-vs-instance).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DETECTION METHOD (§22 #3, operator-resolved 2026-06-09)
 * ════════════════════════════════════════════════════════════════════════════
 *   (a) SELF-ATTESTATION (default): read the preferred-tier config's declared
 *       subscription_tier / attested_tier per provider.
 *   (b) OPTIONAL --probe (opt-in): a billing-API path. No value-free billing API
 *       exists for these providers today, so the probe is a STUB with a clear
 *       interface — it reports "unavailable" and NEVER blocks. Wire a real
 *       value-free probe here if one ships.
 *   (c) INFER-FROM-DISPATCH: REJECTED. This engine has NO dispatch / token-spend
 *       path. It never runs a paid call to detect tier.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VERDICTS (value-free) + EXIT CONTRACT
 * ════════════════════════════════════════════════════════════════════════════
 *   tier_met               — effective tier >= selected tier.
 *   tier_short             — effective tier < selected tier, in a dimension we
 *                            CAN value-free-detect (CLI/auth/key) → confident.
 *   unknown-self-attested  — selected tier needs a value-free-UNDETECTABLE signal
 *                            (T3 sub floor) AND no self-attestation/probe → we
 *                            don't know → FAIL-OPEN (never block).
 *
 *   Default: report-only, EXIT 0 always (informational ramp). `--enforce` exits
 *   2 ONLY when a provider is `tier_short` against its selected tier — behind the
 *   explicit flag. `unknown-self-attested` NEVER trips --enforce (fail-open: an
 *   undetectable funding/sub signal never blocks).
 *
 * Fail-open everywhere: any unreadable config/env/dependency → unknown, exit 0.
 *
 * Usage:
 *   node scripts/mc/provider-tier-check.js                 # human table, exit 0
 *   node scripts/mc/provider-tier-check.js --json          # machine envelope
 *   node scripts/mc/provider-tier-check.js --probe         # opt-in billing probe (stub)
 *   node scripts/mc/provider-tier-check.js --enforce       # exit 2 on tier_short
 *   node scripts/mc/provider-tier-check.js --set-tier <provider> <tier> [--floor <sub>] [--sub <sub>]
 *                                                              # CONFIRM-CLASS write
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

// ── Lazy, fail-open dependency loads (REUSE the health stack) ─
function tryRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (e) {
    return { __loadError: String((e && e.message) || e) };
  }
}
const cfgLib = tryRequire("scripts/mc/lib/provider-tier-config.js");
const dispatchReadiness = tryRequire("scripts/checks/dispatch-readiness.js");
const authResolver = tryRequire("scripts/dispatch/auth-resolver.js");

const { TIER_RANK, SUBSCRIPTION_RANK } = cfgLib;

// Value-free key NAME per provider (NEVER the value — auth-resolver reads name only).
const KEY_NAME = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  // antigravity (agy) self-auths via its own keyring — no metered API key. (The SUNSET
  // individual gemini CLI's GEMINI_API_KEY entry was removed in the 2026-07-20 deep-clean.)
};

function tierRank(t) {
  return Object.prototype.hasOwnProperty.call(TIER_RANK, t) ? TIER_RANK[t] : 0;
}
function subRank(s) {
  if (!s) return 0;
  const k = String(s).toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUBSCRIPTION_RANK, k) ? SUBSCRIPTION_RANK[k] : 0;
}

// ════════════════════════════════════════════════════════════
// SIGNAL DETECTION (value-free, no token spend, no dispatch)
// ════════════════════════════════════════════════════════════
/**
 * Detect the value-free signals for one provider:
 *   { t1Met, authTier, keyCheck:{ key_name, present, source } }
 * Reuses dispatch-readiness (cliInstalled + detectAuthTier) for T1 and
 * auth-resolver (resolveKey, label-only) for the value-free key-NAME check.
 *
 * A test seam: opts.signalsOverride[provider] short-circuits real detection so
 * tier classification can be exercised deterministically without real CLIs.
 */
function detectSignals(provider, opts = {}) {
  if (opts.signalsOverride && opts.signalsOverride[provider]) {
    const s = opts.signalsOverride[provider];
    const keyName = KEY_NAME[provider] || `${provider.toUpperCase()}_API_KEY`;
    const authTier = s.authTier || (s.t1Met ? "key" : "none");
    return {
      t1Met: !!s.t1Met,
      authTier,
      keyCheck: {
        key_name: keyName,
        present: !!s.t2KeyPresent,
        source: s.t2KeyPresent ? s.keySource || "test-seam" : null,
      },
      oauthFunded: s.oauthFunded != null ? !!s.oauthFunded : authTier === "oauth",
    };
  }

  // ── Real detection (fail-open per signal) ──
  let cli = false;
  let authTier = "unknown";
  try {
    if (dispatchReadiness && typeof dispatchReadiness.cliInstalled === "function") {
      cli = dispatchReadiness.cliInstalled(provider);
    }
  } catch {
    cli = false;
  }
  try {
    if (dispatchReadiness && typeof dispatchReadiness.detectAuthTier === "function") {
      authTier = (dispatchReadiness.detectAuthTier(provider) || {}).tier || "unknown";
    }
  } catch {
    authTier = "unknown";
  }
  // Claude is the harness: CLI always present; auth is the harness session.
  if (provider === "claude") {
    cli = true;
    if (authTier === "unknown" || authTier === "none") authTier = "harness";
  }
  const t1Met = !!cli && authTier !== "none";

  // Value-free key NAME check (auth-resolver returns labels, NEVER the value).
  const keyName = KEY_NAME[provider] || `${provider.toUpperCase()}_API_KEY`;
  let keyCheck = { key_name: keyName, present: false, source: null };
  try {
    if (authResolver && typeof authResolver.resolveKey === "function") {
      const r = authResolver.resolveKey(keyName); // NEVER withValue — label-only
      // Defensive: copy ONLY the value-free fields. A future resolver field that
      // leaked a secret would NOT reach our record.
      keyCheck = { key_name: keyName, present: !!r.found, source: r.found ? r.source : null };
    }
  } catch {
    keyCheck = { key_name: keyName, present: false, source: null };
  }
  // A paid OAuth login counts as a funded signal even without a raw key.
  const oauthFunded = authTier === "oauth";
  return { t1Met, authTier, keyCheck, oauthFunded };
}

// ════════════════════════════════════════════════════════════
// TIER RESOLUTION
// ════════════════════════════════════════════════════════════
/**
 * Resolve the effective tier for one provider from value-free signals + the
 * config's self-attestation. Returns { tier, source, t3Detectable }.
 *   source: "detected" (value-free verified) | "self-attested" | "probed".
 *   t3Detectable: whether T3 had ANY signal (attestation/probe) to judge it.
 */
function effectiveTier(provider, signals, config, opts = {}) {
  if (!signals.t1Met) return { tier: "none", source: "detected", t3Judged: false };

  let tier = "t1";
  let source = "detected";

  // T2: value-free funded signal — a key NAME present OR a paid OAuth login.
  const t2Signal = signals.keyCheck.present || signals.oauthFunded;
  if (t2Signal) tier = "t2";

  // T3: subscription floor — SELF-ATTESTATION only (no value-free billing API).
  const pcfg = (config.providers && config.providers[provider]) || {};
  const floor = cfgLib.resolveT3Floor(config);
  let t3Judged = false;

  // (a) self-attested subscription_tier meeting the configured floor.
  if (pcfg.subscription_tier) {
    t3Judged = true;
    if (subRank(pcfg.subscription_tier) >= subRank(floor)) {
      if (tierRank("t3") > tierRank(tier)) {
        tier = "t3";
        source = "self-attested";
      }
    }
  }
  // (b) blanket attested_tier override (operator simply declares "t2"/"t3").
  if (pcfg.attested_tier && tierRank(pcfg.attested_tier) > tierRank(tier)) {
    tier = pcfg.attested_tier;
    source = "self-attested";
    if (tierRank(pcfg.attested_tier) >= tierRank("t3")) t3Judged = true;
  }

  // (c) OPTIONAL opt-in billing probe (stub — see probeBilling). Never blocks.
  if (opts.probe) {
    const probed = probeBilling(provider, config);
    if (probed.judged) {
      t3Judged = true;
      if (probed.tierMet && tierRank("t3") > tierRank(tier)) {
        tier = "t3";
        source = "probed";
      }
    }
  }

  return { tier, source, t3Judged, floor };
}

/**
 * OPTIONAL opt-in billing-API probe — STUB. No value-free billing API exists for
 * Claude/OpenAI/Gemini today, so this never confirms a tier and never blocks.
 * The interface is fixed so a real value-free probe can drop in here later.
 * It performs NO dispatch and spends NO tokens (infer-from-dispatch is rejected).
 *
 * @returns {{ judged:boolean, tierMet:boolean, reason:string }}
 */
function probeBilling(provider /*, config */) {
  return {
    judged: false,
    tierMet: false,
    reason: `no value-free billing API available for "${provider}" — self-attestation is the only non-spend signal (infer-from-dispatch rejected per §22 #3)`,
  };
}

/**
 * Verdict for one provider: tier_met | tier_short | unknown-self-attested.
 */
function verdictFor(provider, signals, config, opts = {}) {
  const selected = cfgLib.resolveSelectedTier(config, provider);
  const eff = effectiveTier(provider, signals, config, opts);

  let verdict;
  if (tierRank(eff.tier) >= tierRank(selected)) {
    verdict = "tier_met";
  } else if (
    signals.t1Met &&
    !!(signals.keyCheck.present || signals.oauthFunded) && // T2 funded — value-free detectable
    tierRank(selected) >= tierRank("t3") &&
    !eff.t3Judged
  ) {
    // unknown-self-attested is RESERVED for the genuinely-undetectable case: BOTH T1
    // AND T2 (the value-free funded signal) ARE confirmed, and ONLY the T3 sub-floor
    // still needs a self-attestation/probe that nobody provided → we cannot know →
    // fail-open (never block). T1 DOWN or T2 UNFUNDED are BOTH value-free-detectable
    // shortfalls → they route to tier_short below (AC-6.1, finding 6). Gating on
    // BOTH signals.t1Met AND t2_funded ensures neither detectably-short case leaks
    // into the unknown branch. (Finding 6 — gauntlet attempt-1: before this fix, a
    // T2-unfunded t3-selected cell produced unknown-self-attested+ok:true.)
    verdict = "unknown-self-attested";
  } else {
    // Confident, value-free-detectable shortfall — incl. T1 down for any selected
    // tier (CLI/auth is detectable, so a down provider is NEVER "unknown").
    verdict = "tier_short";
  }

  const confidence =
    verdict === "unknown-self-attested"
      ? "unknown"
      : eff.source === "detected"
        ? "verified"
        : eff.source; // "self-attested" | "probed"

  return {
    provider,
    selected_tier: selected,
    effective_tier: eff.tier,
    verdict,
    confidence,
    t3_floor: eff.floor,
    t1_met: signals.t1Met,
    auth_tier: signals.authTier,
    t2_funded: !!(signals.keyCheck.present || signals.oauthFunded),
    // VALUE-FREE: key NAME + presence + source LABEL only — never a value/length.
    key_check: signals.keyCheck,
    attested: {
      subscription_tier: (config.providers[provider] || {}).subscription_tier || null,
      attested_tier: (config.providers[provider] || {}).attested_tier || null,
    },
  };
}

// ════════════════════════════════════════════════════════════
// REPORT BUILDER
// ════════════════════════════════════════════════════════════
/**
 * Build the full report. Pure given (config, signals) — accepts test overrides:
 *   opts.configOverride / opts.configPath  → preferred-tier config source
 *   opts.signalsOverride                   → inject per-provider signals
 *   opts.probe                             → run the (stub) billing probe
 *   opts.providers                         → restrict the provider set
 * NEVER throws. Returns a value-free, report-only envelope.
 */
function buildReport(opts = {}) {
  const { config, source: configSource, corrupt: configCorrupt, path: cfgPath } = cfgLib.readConfig(opts);
  const providers =
    opts.providers || Array.from(new Set([...cfgLib.KNOWN_PROVIDERS, ...Object.keys(config.providers || {})]));

  const rows = providers.map((p) => {
    let signals;
    try {
      signals = detectSignals(p, opts);
    } catch {
      // Total fail-open for one provider → treat as unreachable/unknown.
      signals = { t1Met: false, authTier: "unknown", keyCheck: { key_name: KEY_NAME[p] || null, present: false, source: null }, oauthFunded: false };
    }
    return verdictFor(p, signals, config, opts);
  });

  // FAIL-CLOSED on a PRESENT-but-CORRUPT instance file (AC-6.2 / #16): the file
  // existed and may have carried an operator-RAISED floor we can no longer read.
  // We must NOT relax to the framework-default green — hold (tier_short) so an
  // --enforce REDS and the envelope `ok` is false. An ABSENT config (corrupt:false)
  // is the normal greenfield case and is left to its real per-provider verdicts.
  const anyShort = configCorrupt || rows.some((r) => r.verdict === "tier_short");
  const summary = anyShort
    ? "tier_short"
    : rows.some((r) => r.verdict === "unknown-self-attested")
      ? "unknown-self-attested"
      : "tier_met";

  return {
    // ok MIRRORS the verdict (AC-6.3): an `ok`-only consumer can no longer
    // false-green a tier_short (incl. the corrupt-config hold).
    ok: summary !== "tier_short",
    report_only: true,
    detection: "self-attestation (default)" + (opts.probe ? " + opt-in billing probe (stub)" : ""),
    infer_from_dispatch: false, // structurally absent — no dispatch/spend path exists
    config_source: configSource,
    config_corrupt: !!configCorrupt, // PRESENT-but-unreadable → fail-closed hold
    config_path: cfgPath,
    t3_floor: cfgLib.resolveT3Floor(config),
    providers: rows,
    verdict_summary: summary,
  };
}

// ════════════════════════════════════════════════════════════
// RENDERING
// ════════════════════════════════════════════════════════════
function icon(verdict) {
  return verdict === "tier_met" ? "ok" : verdict === "tier_short" ? "xx" : "??";
}

function renderHuman(report) {
  const out = [];
  out.push("Provider Tier Readiness (report-only — value-free, no token spend)");
  out.push("─".repeat(66));
  out.push(`  config: ${report.config_source}   T3 floor: ${report.t3_floor} (operator-tunable)`);
  if (report.config_corrupt) {
    out.push(
      "  WARNING: the instance config file is PRESENT but UNREADABLE — failing closed " +
        "(holding tier_short).\n           A raised floor may be hidden; --enforce REDS. " +
        "Repair or re-run --set-tier to restore it.",
    );
  }
  out.push("");
  out.push("  " + "PROVIDER".padEnd(9) + "EFF".padEnd(6) + "SELECTED".padEnd(10) + "VERDICT".padEnd(24) + "CONF");
  out.push("  " + "─".repeat(62));
  for (const r of report.providers) {
    out.push(
      "  " +
        icon(r.verdict) +
        " " +
        String(r.provider).padEnd(8) +
        String(r.effective_tier).padEnd(6) +
        String(r.selected_tier).padEnd(10) +
        String(r.verdict).padEnd(24) +
        String(r.confidence),
    );
    const bits = [];
    bits.push(`T1=${r.t1_met ? "yes" : "NO"}(${r.auth_tier})`);
    bits.push(`key:${r.key_check.key_name}=${r.key_check.present ? "present" : "absent"}`);
    if (r.attested.subscription_tier) bits.push(`sub(attested)=${r.attested.subscription_tier}`);
    if (r.attested.attested_tier) bits.push(`tier(attested)=${r.attested.attested_tier}`);
    out.push("        " + bits.join("  "));
  }
  out.push("");
  out.push(`  summary: ${report.verdict_summary}   (infer-from-dispatch: rejected)`);
  out.push("  T3 needs self-attestation: set it with");
  out.push("    node scripts/mc/provider-tier-check.js --set-tier <provider> t3 --sub <max_5x|pro|...>");
  return out.join("\n") + "\n";
}

// ════════════════════════════════════════════════════════════
// CLI
// ════════════════════════════════════════════════════════════
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--json") a.json = true;
    else if (t === "--probe") a.probe = true;
    else if (t === "--enforce") a.enforce = true;
    else if (t === "--write") a.write = true;
    else if (t === "--set-tier") {
      a.write = true;
      a.setTier = { provider: argv[++i], tier: argv[++i] };
    } else if (t === "--floor") a.floor = argv[++i];
    else if (t === "--sub") a.sub = argv[++i];
    else if (t === "--config-path") a.configPath = argv[++i]; // test/override seam
    else a._.push(t);
  }
  return a;
}

function main(argv) {
  const args = parseArgs(argv);

  // ── CONFIRM-CLASS write path (gated by --write/--set-tier ONLY) ──
  if (args.write) {
    if (!args.setTier || !args.setTier.provider || !args.setTier.tier) {
      process.stderr.write(
        "usage: --set-tier <provider> <t1|t2|t3> [--sub <subscription>] [--floor <subscription>]\n",
      );
      return 2;
    }
    if (!cfgLib.validTier(args.setTier.tier)) {
      process.stderr.write(`invalid tier "${args.setTier.tier}" — use t1|t2|t3\n`);
      return 2;
    }
    const { config } = cfgLib.readConfig(args);
    const prov = args.setTier.provider;
    config.providers[prov] = config.providers[prov] || { selected_tier: cfgLib.DEFAULT_SELECTED_TIER, subscription_tier: null, attested_tier: null };
    config.providers[prov].selected_tier = args.setTier.tier;
    if (args.sub) config.providers[prov].subscription_tier = args.sub;
    if (args.floor) config.t3_floor = args.floor;
    const res = cfgLib.writeConfig(config, args);
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: res.ok, wrote: res.ok, path: res.path, provider: prov, selected_tier: args.setTier.tier, error: res.error }, null, 2) + "\n");
    } else {
      process.stdout.write(
        res.ok
          ? `Wrote preferred tier: ${prov} → selected=${args.setTier.tier}${args.sub ? `, sub=${args.sub}` : ""}${args.floor ? `, t3_floor=${args.floor}` : ""}\n  ${res.path}\n`
          : `Failed to write config: ${res.error}\n`,
      );
    }
    return res.ok ? 0 : 2;
  }

  // ── READ-ONLY check path (default) ──
  let report;
  try {
    report = buildReport({ probe: args.probe, configPath: args.configPath });
  } catch (e) {
    // Total fail-open — never crash the caller (/mc:health, /scan:environment).
    const msg = "provider-tier-check: internal error (fail-open): " + String((e && e.message) || e);
    if (args.json) process.stdout.write(JSON.stringify({ ok: false, report_only: true, error: msg, providers: [] }) + "\n");
    else process.stdout.write(msg + "\n");
    return 0; // fail-open
  }

  if (args.json) process.stdout.write(JSON.stringify(report) + "\n");
  else process.stdout.write(renderHuman(report));

  // Exit contract: report-only exit 0 by default. --enforce exits 2 ONLY on a
  // confident tier_short — driven by verdict_summary so it covers BOTH a row-level
  // shortfall (incl. T1 down, AC-6.1) AND the present-but-corrupt config fail-closed
  // hold (AC-6.2). unknown-self-attested NEVER trips it (fail-open). This mirrors the
  // envelope `ok` (AC-6.3) so the exit code and `ok` can never disagree.
  if (args.enforce && report.verdict_summary === "tier_short") {
    return 2;
  }
  return 0;
}

module.exports = {
  buildReport,
  detectSignals,
  effectiveTier,
  verdictFor,
  probeBilling,
  renderHuman,
  tierRank,
  subRank,
  KEY_NAME,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
