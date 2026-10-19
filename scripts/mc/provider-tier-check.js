#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

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

const KEY_NAME = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function tierRank(t) {
  return Object.prototype.hasOwnProperty.call(TIER_RANK, t) ? TIER_RANK[t] : 0;
}
function subRank(s) {
  if (!s) return 0;
  const k = String(s).toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUBSCRIPTION_RANK, k) ? SUBSCRIPTION_RANK[k] : 0;
}

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
  if (provider === "claude") {
    cli = true;
    if (authTier === "unknown" || authTier === "none") authTier = "harness";
  }
  const t1Met = !!cli && authTier !== "none";

  const keyName = KEY_NAME[provider] || `${provider.toUpperCase()}_API_KEY`;
  let keyCheck = { key_name: keyName, present: false, source: null };
  try {
    if (authResolver && typeof authResolver.resolveKey === "function") {
      const r = authResolver.resolveKey(keyName);
      keyCheck = { key_name: keyName, present: !!r.found, source: r.found ? r.source : null };
    }
  } catch {
    keyCheck = { key_name: keyName, present: false, source: null };
  }
  const oauthFunded = authTier === "oauth";
  return { t1Met, authTier, keyCheck, oauthFunded };
}

function effectiveTier(provider, signals, config, opts = {}) {
  if (!signals.t1Met) return { tier: "none", source: "detected", t3Judged: false };

  let tier = "t1";
  let source = "detected";

  const t2Signal = signals.keyCheck.present || signals.oauthFunded;
  if (t2Signal) tier = "t2";

  const pcfg = (config.providers && config.providers[provider]) || {};
  const floor = cfgLib.resolveT3Floor(config);
  let t3Judged = false;

  if (pcfg.subscription_tier) {
    t3Judged = true;
    if (subRank(pcfg.subscription_tier) >= subRank(floor)) {
      if (tierRank("t3") > tierRank(tier)) {
        tier = "t3";
        source = "self-attested";
      }
    }
  }
  if (pcfg.attested_tier && tierRank(pcfg.attested_tier) > tierRank(tier)) {
    tier = pcfg.attested_tier;
    source = "self-attested";
    if (tierRank(pcfg.attested_tier) >= tierRank("t3")) t3Judged = true;
  }

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

function probeBilling(provider ) {
  return {
    judged: false,
    tierMet: false,
    reason: `no value-free billing API available for "${provider}" — self-attestation is the only non-spend signal`,
  };
}

function verdictFor(provider, signals, config, opts = {}) {
  const selected = cfgLib.resolveSelectedTier(config, provider);
  const eff = effectiveTier(provider, signals, config, opts);

  let verdict;
  if (tierRank(eff.tier) >= tierRank(selected)) {
    verdict = "tier_met";
  } else if (
    signals.t1Met &&
    !!(signals.keyCheck.present || signals.oauthFunded) &&
    tierRank(selected) >= tierRank("t3") &&
    !eff.t3Judged
  ) {
    verdict = "unknown-self-attested";
  } else {
    verdict = "tier_short";
  }

  const confidence =
    verdict === "unknown-self-attested"
      ? "unknown"
      : eff.source === "detected"
        ? "verified"
        : eff.source;

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
    key_check: signals.keyCheck,
    attested: {
      subscription_tier: (config.providers[provider] || {}).subscription_tier || null,
      attested_tier: (config.providers[provider] || {}).attested_tier || null,
    },
  };
}

function buildReport(opts = {}) {
  const { config, source: configSource, corrupt: configCorrupt, path: cfgPath } = cfgLib.readConfig(opts);
  const providers =
    opts.providers || Array.from(new Set([...cfgLib.KNOWN_PROVIDERS, ...Object.keys(config.providers || {})]));

  const rows = providers.map((p) => {
    let signals;
    try {
      signals = detectSignals(p, opts);
    } catch {
      signals = { t1Met: false, authTier: "unknown", keyCheck: { key_name: KEY_NAME[p] || null, present: false, source: null }, oauthFunded: false };
    }
    return verdictFor(p, signals, config, opts);
  });

  const anyShort = configCorrupt || rows.some((r) => r.verdict === "tier_short");
  const summary = anyShort
    ? "tier_short"
    : rows.some((r) => r.verdict === "unknown-self-attested")
      ? "unknown-self-attested"
      : "tier_met";

  return {
    ok: summary !== "tier_short",
    report_only: true,
    detection: "self-attestation (default)" + (opts.probe ? " + opt-in billing probe (stub)" : ""),
    infer_from_dispatch: false,
    config_source: configSource,
    config_corrupt: !!configCorrupt,
    config_path: cfgPath,
    t3_floor: cfgLib.resolveT3Floor(config),
    providers: rows,
    verdict_summary: summary,
  };
}

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
  out.push(`  summary: ${report.verdict_summary}`);
  out.push("  T3 needs self-attestation: set it with");
  out.push("    node scripts/mc/provider-tier-check.js --set-tier <provider> t3 --sub <max_5x|pro|...>");
  return out.join("\n") + "\n";
}

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
    else if (t === "--config-path") a.configPath = argv[++i];
    else a._.push(t);
  }
  return a;
}

function main(argv) {
  const args = parseArgs(argv);

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

  let report;
  try {
    report = buildReport({ probe: args.probe, configPath: args.configPath });
  } catch (e) {
    const msg = "provider-tier-check: internal error (fail-open): " + String((e && e.message) || e);
    if (args.json) process.stdout.write(JSON.stringify({ ok: false, report_only: true, error: msg, providers: [] }) + "\n");
    else process.stdout.write(msg + "\n");
    return 0;
  }

  if (args.json) process.stdout.write(JSON.stringify(report) + "\n");
  else process.stdout.write(renderHuman(report));

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
