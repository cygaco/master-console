#!/usr/bin/env node
/**
 * dispatch-readiness.js — WI-04 static dispatch-readiness table.
 *
 * Cluster C-3 (provider/dispatch readiness & auth-tier). A READ-ONLY, NO-TOKEN
 * pre-flight that walks every configured provider AND every build-chain role and
 * answers the four questions a dispatch needs satisfied BEFORE it spends a token:
 *
 *   1. CLI installed?        — `<cli> --version` succeeds (provider-health#cliPresent)
 *   2. model id valid?       — the resolved model exists in the dispatch catalog
 *                              (NOT a ghost / shut-down / typo'd id)
 *   3. effort/flags valid?   — the role's effort is allowed for that model
 *                              (catalog#validateTuple)
 *   4. auth tier?            — OAuth (paid login) vs KEY (file/env) vs NONE,
 *                              per provider — the WI-19 axis surfaced as a column
 *
 * It deliberately does NOT ping the providers (no token spend, no network) — that
 * is `scripts/mc/provider-smoke.js --per-role`'s job. This check is the fast,
 * cheap, offline complement that catches the static failures (ghost model, bad
 * effort, missing CLI, no auth) the live smoke would otherwise burn a dispatch to
 * discover. Run it first; run smoke when this is green.
 *
 * Verdict per provider: PASS | PARTIAL | FAIL.
 *   FAIL    — CLI missing, OR a routed model is a ghost, OR no auth at all.
 *   PARTIAL — reachable-but-degraded (effort mismatch, OAuth-vs-key ambiguity,
 *             model not in catalog but CLI present, etc.).
 *   PASS    — CLI present, every routed model valid, effort valid, auth present.
 *
 * FAIL-OPEN by contract: this is a diagnostic, not a gate. Exit 0 always in the
 * default mode so it can be wired into /mc:health without ever blocking. Pass
 * --strict to exit 2 when any provider is FAIL (for CI / a deliberate gate).
 *
 * Usage:
 *   node scripts/checks/dispatch-readiness.js            # human table, exit 0
 *   node scripts/checks/dispatch-readiness.js --json     # machine envelope
 *   node scripts/checks/dispatch-readiness.js --strict   # exit 2 on any FAIL
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

// ── Lazy, fail-open module loads ─────────────────────────────
// Every require is wrapped so a missing/edited dependency degrades to a
// readable PARTIAL row instead of crashing the whole check.
function tryRequire(rel) {
  try {
    return require(path.join(ROOT, rel));
  } catch (e) {
    return { __loadError: String((e && e.message) || e) };
  }
}

const catalog = tryRequire("scripts/dispatch/catalog.js");
const providerHealth = tryRequire("scripts/hooks/lib/provider-health.js");
const providersLib = tryRequire("scripts/hooks/lib/providers.js");

// ── Auth-tier detection (read-only, no spend) ────────────────
// Returns one of: "harness" | "oauth" | "key" | "none" | "unknown".
// The agy (antigravity) lane self-auths via the shared ~/.gemini keyring; the
// SUNSET individual gemini CLI auth branch was removed in the 2026-07-20 deep-clean.
function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function detectAuthTier(provider) {
  if (provider === "claude") return { tier: "harness", detail: "Claude is the harness" };

  if (provider === "antigravity") {
    // agy self-auths via the shared ~/.gemini keyring (oauth_creds.json). VALUE-FREE presence check.
    const creds = readFileSafe(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
    const oauth = !!(creds && /(refresh|access)_token/.test(creds));
    if (oauth) return { tier: "oauth", detail: "agy keyring session detected (~/.gemini/oauth_creds.json)" };
    return { tier: "none", detail: "no agy keyring session — sign in to Antigravity (`agy`)" };
  }

  if (provider === "openai") {
    // codex login --with-api-key AND codex login (OAuth) both write auth.json.
    // We MUST parse the CONTENT to distinguish them — a metered key written by
    // `codex login --with-api-key` must NOT be reported as oauth/funded.
    // VALUE-FREE: we read only the PRESENCE of fields, never field values.
    const authFiles = [
      path.join(os.homedir(), ".codex", "auth.json"),
      path.join(os.homedir(), ".config", "codex", "auth.json"),
    ];
    for (const f of authFiles) {
      const raw = readFileSafe(f);
      if (raw === null) continue; // file absent — try next
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* unparseable */ }
      if (parsed !== null && typeof parsed === "object") {
        // Metered-key signal: `codex login --with-api-key` writes auth_mode or OPENAI_API_KEY.
        // Check PRESENCE only — VALUE-FREE (never log the key value).
        const isMetered =
          Object.prototype.hasOwnProperty.call(parsed, "auth_mode") ||
          Object.prototype.hasOwnProperty.call(parsed, "OPENAI_API_KEY");
        if (isMetered) {
          return {
            tier: "key",
            detail:
              "key (metered) — codex login --with-api-key (auth.json carries a metered API key, NOT an OAuth session)",
          };
        }
        // OAuth signal: refresh_token / access_token / tokens / id_token present.
        const isOAuth =
          Object.prototype.hasOwnProperty.call(parsed, "access_token") ||
          Object.prototype.hasOwnProperty.call(parsed, "refresh_token") ||
          Object.prototype.hasOwnProperty.call(parsed, "tokens") ||
          Object.prototype.hasOwnProperty.call(parsed, "id_token");
        if (isOAuth) {
          return {
            tier: "oauth",
            detail: "oauth (plan) — codex login OAuth session",
          };
        }
        // auth.json present but neither metered nor OAuth signal detected.
        // Do NOT default to oauth — the whole bug is that default. Be honest.
        return {
          tier: "key",
          detail:
            "key (unknown posture) — auth.json present but auth_mode/token fields absent; treat as metered until posture is confirmed",
        };
      }
      // auth.json present but could not be parsed (empty / malformed).
      return {
        tier: "key",
        detail:
          "key (unknown posture) — auth.json present but unreadable; treat as metered until posture is confirmed",
      };
    }
    // No auth file found — fall through to env key check.
    const key = !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);
    if (key) return { tier: "key", detail: "OPENAI_API_KEY in env" };
    return { tier: "none", detail: "no codex login and no OPENAI_API_KEY — run `codex login`" };
  }

  return { tier: "unknown", detail: "unknown provider" };
}

// ── Role → provider/model/effort resolution (manifest-aware) ──
const BUILD_CHAIN_ROLES = [
  "builder",
  "fixer",
  "reviewer",
  "compliance",
  "qa",
  "redteam",
  "ops-analyst", // S-7: was `learner`
];

function resolveRole(role) {
  // Provider: prefer the manifest-aware resolver (matches real dispatch), fall
  // back to the catalog default.
  let provider = null;
  if (providersLib && typeof providersLib.getProviderForRole === "function") {
    try {
      provider = providersLib.getProviderForRole(role);
    } catch {
      provider = null;
    }
  }
  if (!provider && catalog && catalog.DEFAULT_PROVIDER_PER_ROLE) {
    provider = catalog.DEFAULT_PROVIDER_PER_ROLE[role] || null;
  }

  // Effort: catalog's per-role default (the authoritative wiring).
  let effort = null;
  if (catalog && catalog.DEFAULT_EFFORT_PER_ROLE) {
    effort = catalog.DEFAULT_EFFORT_PER_ROLE[role] || null;
  }

  // Model: the provider's catalog default (role specs may override via
  // provider_model, but for a static table the provider default is the
  // load-bearing value — and the one most likely to be a ghost after a model
  // shut-down).
  let model = null;
  if (provider && catalog && typeof catalog.getProvider === "function") {
    const p = catalog.getProvider(provider);
    if (p) model = p.defaultModel || null;
  }

  return { role, provider, model, effort };
}

// ── Provider-level static checks ─────────────────────────────
function cliInstalled(provider) {
  if (provider === "claude") return true;
  if (providerHealth && typeof providerHealth.cliPresent === "function") {
    const cli = provider === "openai" ? "codex" : provider === "antigravity" ? "agy" : provider;
    try {
      return providerHealth.cliPresent(cli);
    } catch {
      return false;
    }
  }
  return false; // can't verify → treat as not installed (conservative)
}

function modelValid(provider, model) {
  // "Valid" = present in the dispatch catalog for this provider. A model that
  // was shut down / typo'd / is a ghost will not be in the catalog.
  if (!model) return { ok: false, reason: "no model resolved for this role" };
  if (!catalog || typeof catalog.getModel !== "function")
    return { ok: null, reason: "catalog unavailable — cannot validate model" };
  const m = catalog.getModel(provider, model);
  if (!m) return { ok: false, reason: `model "${model}" not in catalog (ghost / typo / shut down?)` };
  if (m.deprecated) return { ok: false, reason: `model "${model}" is deprecated` };
  return { ok: true, reason: "" };
}

function effortValid(provider, model, effort) {
  if (!effort) return { ok: true, reason: "no effort flag for this role (n/a)" };
  if (!catalog || typeof catalog.validateTuple !== "function")
    return { ok: null, reason: "catalog unavailable — cannot validate effort" };
  const err = catalog.validateTuple(provider, model, effort);
  if (err) return { ok: false, reason: err };
  return { ok: true, reason: "" };
}

// ── Build the readiness model ────────────────────────────────
function buildReadiness() {
  const providersSet = new Set();
  const roleRows = BUILD_CHAIN_ROLES.map((r) => {
    const resolved = resolveRole(r);
    if (resolved.provider) providersSet.add(resolved.provider);
    const m = modelValid(resolved.provider, resolved.model);
    const e = effortValid(resolved.provider, resolved.model, resolved.effort);
    return { ...resolved, modelCheck: m, effortCheck: e };
  });
  // Always include the three known providers even if no role routes to them.
  ["claude", "openai", "antigravity"].forEach((p) => providersSet.add(p));

  const providerRows = [...providersSet].sort().map((provider) => {
    const cli = cliInstalled(provider);
    const auth = detectAuthTier(provider);
    // Roles routed to this provider.
    const rolesHere = roleRows.filter((r) => r.provider === provider);
    const ghostModels = rolesHere.filter((r) => r.modelCheck.ok === false);
    const badEfforts = rolesHere.filter((r) => r.effortCheck.ok === false);

    // Verdict logic.
    let verdict;
    if (provider === "claude") {
      verdict = "PASS"; // harness — always ready
    } else if (!cli) {
      verdict = "FAIL";
    } else if (auth.tier === "none") {
      verdict = "FAIL";
    } else if (ghostModels.length > 0) {
      verdict = "FAIL"; // a routed role points at a ghost model
    } else if (badEfforts.length > 0 || auth.tier === "key") {
      // effort mismatch is degraded; key-only (no OAuth) is a WI-19 yellow for
      // gemini (free-tier risk) — flag as PARTIAL, not FAIL (it still dispatches).
      verdict = "PARTIAL";
    } else {
      verdict = "PASS";
    }

    return {
      provider,
      cliInstalled: cli,
      authTier: auth.tier,
      authDetail: auth.detail,
      ghostModels: ghostModels.map((r) => ({ role: r.role, model: r.model, reason: r.modelCheck.reason })),
      badEfforts: badEfforts.map((r) => ({ role: r.role, model: r.model, effort: r.effort, reason: r.effortCheck.reason })),
      verdict,
    };
  });

  return { providers: providerRows, roles: roleRows };
}

// ── Rendering ────────────────────────────────────────────────
function icon(verdict) {
  return verdict === "PASS" ? "ok" : verdict === "PARTIAL" ? "!!" : "xx";
}

function renderHuman(model) {
  const out = [];
  out.push("Dispatch Readiness (static — no token spend)");
  out.push("─".repeat(60));
  out.push("  " + "PROVIDER".padEnd(9) + "CLI".padEnd(6) + "AUTH".padEnd(9) + "VERDICT");
  out.push("  " + "─".repeat(56));
  for (const p of model.providers) {
    out.push(
      "  " +
        icon(p.verdict) +
        " " +
        String(p.provider).padEnd(8) +
        (p.cliInstalled ? "yes " : "NO  ").padEnd(6) +
        String(p.authTier).padEnd(9) +
        p.verdict,
    );
    if (p.authDetail && p.verdict !== "PASS") out.push("        auth: " + p.authDetail);
    for (const g of p.ghostModels) out.push(`        GHOST: ${g.role} → ${g.model} (${g.reason})`);
    for (const b of p.badEfforts)
      out.push(`        EFFORT: ${b.role} effort=${b.effort} on ${b.model} — ${b.reason}`);
  }
  out.push("");
  out.push("Per-role resolution (provider / model / effort):");
  out.push("  " + "─".repeat(56));
  for (const r of model.roles) {
    const mIc = r.modelCheck.ok === false ? "xx" : r.modelCheck.ok === null ? ".." : "ok";
    out.push(
      "  " +
        mIc +
        " " +
        String(r.role).padEnd(11) +
        String(r.provider || "?").padEnd(8) +
        String(r.model || "(default)").padEnd(26) +
        "effort=" +
        String(r.effort || "n/a"),
    );
  }
  out.push("");
  out.push("Static checks only. Run `node scripts/mc/provider-smoke.js --per-role`");
  out.push("for a live reachability ping when this is green.");
  return out.join("\n") + "\n";
}

// ── Main ─────────────────────────────────────────────────────
function main(argv) {
  const jsonMode = argv.includes("--json");
  const strict = argv.includes("--strict");

  let model;
  try {
    model = buildReadiness();
  } catch (e) {
    // Total fail-open: never crash the caller (/mc:health).
    const msg = "dispatch-readiness: internal error (fail-open): " + String((e && e.message) || e);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg, providers: [], roles: [] }) + "\n");
    } else {
      process.stdout.write(msg + "\n");
    }
    return 0; // fail-open
  }

  const anyFail = model.providers.some((p) => p.verdict === "FAIL");
  const verdict = anyFail ? "FAIL" : model.providers.some((p) => p.verdict === "PARTIAL") ? "PARTIAL" : "PASS";

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: !anyFail, verdict, ...model }) + "\n");
  } else {
    process.stdout.write(renderHuman(model));
  }

  if (strict && anyFail) return 2;
  return 0; // fail-open by default
}

module.exports = {
  buildReadiness,
  detectAuthTier,
  resolveRole,
  modelValid,
  effortValid,
  cliInstalled,
  renderHuman,
  BUILD_CHAIN_ROLES,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
