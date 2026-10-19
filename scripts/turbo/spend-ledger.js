#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const FRAMEWORK_DEFAULT_CEILING_USD = 100;

const WARN_THRESHOLD_PCT = 0.8;

const PAID_PROVIDERS = new Set(["openai", "antigravity"]);

const BYTES_PER_TOKEN = 4;

const PRICE_TABLE = {
  "gpt-6-astra": { inUsdPerM: 10, outUsdPerM: 50 },
  "gpt-6.1-sol": { inUsdPerM: 2, outUsdPerM: 10 },
  "gpt-6-sol": { inUsdPerM: 2, outUsdPerM: 10 },
  "gpt-6-luna": { inUsdPerM: 0.1, outUsdPerM: 0.5 },
  "gpt-5.6-sol": { inUsdPerM: 4, outUsdPerM: 20 },
  "gpt-5.6-terra": { inUsdPerM: 2, outUsdPerM: 12 },
  "gpt-5.6-luna": { inUsdPerM: 0.2, outUsdPerM: 1.2 },
  "gemini-3.8-flash": { inUsdPerM: 0.75, outUsdPerM: 3.75 },
  "gpt-5.5": { inUsdPerM: 1.25, outUsdPerM: 10 },
  "gpt-5": { inUsdPerM: 1.25, outUsdPerM: 10 },
  "gemini-3.1-pro-preview": { inUsdPerM: 1.25, outUsdPerM: 5 },
  "gemini-3.1-pro": { inUsdPerM: 1.25, outUsdPerM: 5 },
  _default: { inUsdPerM: 2, outUsdPerM: 8 },
};

function resolveProject() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function loadPaths(project) {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(project, ".claude", "paths.json"), "utf8"),
    );
    return Object.fromEntries(
      Object.entries(raw)
        .filter(([k]) => k !== "version" && k !== "$schema")
        .map(([k, v]) => [k, path.join(project, v)]),
    );
  } catch {
    return {};
  }
}

function defaultCompletionsFile(project, PATHS) {
  return (
    PATHS.dispatchCompletionsFile ||
    path.join(project, ".claude", "runtime", "dispatch-completions.jsonl")
  );
}

function defaultAuthFile(project, PATHS) {
  const runtime =
    PATHS.runtime || path.join(project, ".claude", "runtime");
  return path.join(runtime, "authorization.json");
}

function resolveCeiling(auth) {
  if (
    auth &&
    typeof auth.spend_ceiling_usd === "number" &&
    Number.isFinite(auth.spend_ceiling_usd) &&
    auth.spend_ceiling_usd > 0
  ) {
    return { ceilingUsd: auth.spend_ceiling_usd, source: "runtime-override" };
  }
  return {
    ceilingUsd: FRAMEWORK_DEFAULT_CEILING_USD,
    source: "framework-default",
  };
}

function estimateRecordCost(rec) {
  const provider = String(rec.provider || "").toLowerCase();
  if (!PAID_PROVIDERS.has(provider)) return null;
  if (rec.exit_code != null) {
    const ec = Number(rec.exit_code);
    if (Number.isFinite(ec) && ec !== 0) return null;
  }
  const model = String(rec.model || "").toLowerCase();
  const price = Object.hasOwn(PRICE_TABLE, model)
    ? PRICE_TABLE[model]
    : PRICE_TABLE._default;
  const suspectBytes = [];
  const inBytes = clampBytes(rec.prompt_bytes, suspectBytes);
  const outBytes = clampBytes(rec.stdout_bytes, suspectBytes);
  const inTokens = inBytes / BYTES_PER_TOKEN;
  const outTokens = outBytes / BYTES_PER_TOKEN;
  const usd =
    (inTokens / 1e6) * price.inUsdPerM + (outTokens / 1e6) * price.outUsdPerM;
  return {
    provider,
    model: rec.model || null,
    usd: round4(usd),
    inBytes,
    outBytes,
    suspect: suspectBytes.length > 0,
    suspectValues: suspectBytes,
  };
}

function computeLedger(opts = {}) {
  try {
    const project = resolveProject();
    const PATHS = loadPaths(project);
    const completionsFile =
      opts.completionsFile || defaultCompletionsFile(project, PATHS);
    const authFile = opts.authFile || defaultAuthFile(project, PATHS);

    let auth = opts.authOverride || null;
    if (!auth) {
      try {
        auth = JSON.parse(fs.readFileSync(authFile, "utf8"));
      } catch {
        auth = null;
      }
    }
    const { ceilingUsd, source: ceilingSource } = resolveCeiling(auth);

    const sinceIso =
      auth && typeof auth.session_started_at === "string"
        ? auth.session_started_at
        : auth && typeof auth.granted_at === "string"
          ? auth.granted_at
          : null;
    const sinceMs = sinceIso ? new Date(sinceIso).getTime() : null;

    let raw = "";
    try {
      raw = fs.readFileSync(completionsFile, "utf8");
    } catch {
      raw = "";
    }

    const byProvider = {};
    let spentUsd = 0;
    let calls = 0;
    const suspectRecords = [];
    if (raw) {
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue;
        }
        if (Number.isFinite(sinceMs)) {
          const t = new Date(rec.completed_at || rec.started_at || 0).getTime();
          if (Number.isFinite(t) && t < sinceMs) continue;
        }
        const cost = estimateRecordCost(rec);
        if (!cost) continue;
        if (cost.suspect) {
          suspectRecords.push({
            provider: cost.provider,
            model: cost.model,
            values: cost.suspectValues,
            dispatch_id: rec.dispatch_id || null,
          });
        }
        spentUsd = round4(spentUsd + cost.usd);
        calls++;
        const key = cost.provider;
        byProvider[key] = byProvider[key] || { calls: 0, usd: 0 };
        byProvider[key].calls++;
        byProvider[key].usd = round4(byProvider[key].usd + cost.usd);
      }
    }

    const pct = ceilingUsd > 0 ? spentUsd / ceilingUsd : 0;
    const overCeiling = spentUsd >= ceilingUsd;

    const warnings = [];
    const notices = [];
    if (suspectRecords.length) {
      const summary = suspectRecords
        .map(
          (s) =>
            `${s.provider}/${s.model || "?"}${
              s.dispatch_id ? "#" + s.dispatch_id : ""
            }[${s.values.join(",")}]`,
        )
        .join("; ");
      warnings.push(
        `SUSPECT RECORD(S) (fail-high): ${suspectRecords.length} dispatch record(s) carried a NONFINITE/overflow byte count (${summary}) that cannot be metered — spend may be UNDER-reported. Investigate the record source.`,
      );
      try {
        process.stderr.write(
          `[spend-ledger] SUSPECT: ${suspectRecords.length} record(s) with nonfinite/overflow byte counts — ${summary}\n`,
        );
      } catch {
      }
      try {
        const { logEvent } = require(
          path.join(project, "scripts", "hooks", "lib", "logger.js"),
        );
        logEvent(
          "audit",
          "turbo",
          "spend-suspect-record",
          "",
          summary,
          { suspectRecords },
        );
      } catch {
      }
    }
    if (overCeiling) {
      warnings.push(
        `OVER CEILING (report-only): est $${spentUsd.toFixed(2)} ≥ $${ceilingUsd.toFixed(
          2,
        )} (${ceilingSource}). Review spend — the $5/op gate + the session ceiling are the real gates.`,
      );
    } else if (pct >= WARN_THRESHOLD_PCT) {
      warnings.push(
        `Budget-approach warning (report-only): est $${spentUsd.toFixed(
          2,
        )} is ${(pct * 100).toFixed(0)}% of the $${ceilingUsd.toFixed(
          2,
        )} ceiling (${ceilingSource}).`,
      );
    } else {
      notices.push(
        `Under budget: est $${spentUsd.toFixed(2)} of $${ceilingUsd.toFixed(
          2,
        )} (${(pct * 100).toFixed(0)}%, ${ceilingSource}).`,
      );
    }

    return {
      reportOnly: true,
      spentUsd: round2(spentUsd),
      ceilingUsd,
      ceilingSource,
      pct: round4(pct),
      overCeiling,
      calls,
      byProvider,
      warnings,
      notices,
      suspectRecords,
      sinceIso,
    };
  } catch (e) {
    return {
      reportOnly: true,
      spentUsd: 0,
      ceilingUsd: FRAMEWORK_DEFAULT_CEILING_USD,
      ceilingSource: "framework-default",
      pct: 0,
      overCeiling: false,
      calls: 0,
      byProvider: {},
      warnings: [],
      notices: [`ledger fault (fail-open): ${String(e.message || e)}`],
      suspectRecords: [],
      sinceIso: null,
      error: String(e.message || e),
    };
  }
}

function clampBytes(v, sink) {
  if (v == null || v === "") return 0;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return n;
  if (sink && typeof sink.push === "function") {
    sink.push(String(v));
  }
  return 0;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function renderReport(led) {
  const lines = [
    "turbo spend ledger (REPORT-ONLY)",
    "",
    `  spent (est):   $${led.spentUsd.toFixed(2)}`,
    `  ceiling:       $${led.ceilingUsd.toFixed(2)} (${led.ceilingSource})`,
    `  utilization:   ${(led.pct * 100).toFixed(0)}%`,
    `  paid calls:    ${led.calls}`,
  ];
  if (led.sinceIso) lines.push(`  session since: ${led.sinceIso}`);
  const provs = Object.keys(led.byProvider);
  if (provs.length) {
    lines.push("  by provider:");
    for (const p of provs) {
      const b = led.byProvider[p];
      lines.push(`    ${p}: ${b.calls} call(s), est $${b.usd.toFixed(2)}`);
    }
  }
  if (led.warnings.length) {
    lines.push("", "  warnings:");
    for (const w of led.warnings) lines.push(`    ! ${w}`);
  }
  if (led.notices.length) {
    lines.push("", "  notices:");
    for (const n of led.notices) lines.push(`    - ${n}`);
  }
  lines.push(
    "",
    "  (report-only — the $5/op CLAUDE.md line + the operator session ceiling are the real gates)",
  );
  return lines.join("\n");
}

module.exports = {
  FRAMEWORK_DEFAULT_CEILING_USD,
  WARN_THRESHOLD_PCT,
  PAID_PROVIDERS,
  PRICE_TABLE,
  resolveCeiling,
  estimateRecordCost,
  computeLedger,
  renderReport,
};

if (require.main === module) {
  const json = process.argv.includes("--json");
  const led = computeLedger();
  if (json) {
    process.stdout.write(JSON.stringify(led, null, 2) + "\n");
  } else {
    process.stdout.write(renderReport(led) + "\n");
  }
  process.exit(0);
}
