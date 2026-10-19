#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

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
    const creds = readFileSafe(path.join(os.homedir(), ".gemini", "oauth_creds.json"));
    const oauth = !!(creds && /(refresh|access)_token/.test(creds));
    if (oauth) return { tier: "oauth", detail: "agy keyring session detected (~/.gemini/oauth_creds.json)" };
    return { tier: "none", detail: "no agy keyring session — sign in to Antigravity (`agy`)" };
  }

  if (provider === "openai") {
    const authFiles = [
      path.join(os.homedir(), ".codex", "auth.json"),
      path.join(os.homedir(), ".config", "codex", "auth.json"),
    ];
    for (const f of authFiles) {
      const raw = readFileSafe(f);
      if (raw === null) continue;
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { }
      if (parsed !== null && typeof parsed === "object") {
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
        return {
          tier: "key",
          detail:
            "key (unknown posture) — auth.json present but auth_mode/token fields absent; treat as metered until posture is confirmed",
        };
      }
      return {
        tier: "key",
        detail:
          "key (unknown posture) — auth.json present but unreadable; treat as metered until posture is confirmed",
      };
    }
    const key = !!(process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY);
    if (key) return { tier: "key", detail: "OPENAI_API_KEY in env" };
    return { tier: "none", detail: "no codex login and no OPENAI_API_KEY — run `codex login`" };
  }

  return { tier: "unknown", detail: "unknown provider" };
}

const BUILD_CHAIN_ROLES = [
  "builder",
  "fixer",
  "reviewer",
  "compliance",
  "qa",
  "redteam",
  "ops-analyst",
];

function resolveRole(role) {
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

  let effort = null;
  if (catalog && catalog.DEFAULT_EFFORT_PER_ROLE) {
    effort = catalog.DEFAULT_EFFORT_PER_ROLE[role] || null;
  }

  let model = null;
  if (provider && catalog && typeof catalog.getProvider === "function") {
    const p = catalog.getProvider(provider);
    if (p) model = p.defaultModel || null;
  }

  return { role, provider, model, effort };
}

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
  return false;
}

function modelValid(provider, model) {
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

function buildReadiness() {
  const providersSet = new Set();
  const roleRows = BUILD_CHAIN_ROLES.map((r) => {
    const resolved = resolveRole(r);
    if (resolved.provider) providersSet.add(resolved.provider);
    const m = modelValid(resolved.provider, resolved.model);
    const e = effortValid(resolved.provider, resolved.model, resolved.effort);
    return { ...resolved, modelCheck: m, effortCheck: e };
  });
  ["claude", "openai", "antigravity"].forEach((p) => providersSet.add(p));

  const providerRows = [...providersSet].sort().map((provider) => {
    const cli = cliInstalled(provider);
    const auth = detectAuthTier(provider);
    const rolesHere = roleRows.filter((r) => r.provider === provider);
    const ghostModels = rolesHere.filter((r) => r.modelCheck.ok === false);
    const badEfforts = rolesHere.filter((r) => r.effortCheck.ok === false);

    let verdict;
    if (provider === "claude") {
      verdict = "PASS";
    } else if (!cli) {
      verdict = "FAIL";
    } else if (auth.tier === "none") {
      verdict = "FAIL";
    } else if (ghostModels.length > 0) {
      verdict = "FAIL";
    } else if (badEfforts.length > 0 || auth.tier === "key") {
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

function main(argv) {
  const jsonMode = argv.includes("--json");
  const strict = argv.includes("--strict");

  let model;
  try {
    model = buildReadiness();
  } catch (e) {
    const msg = "dispatch-readiness: internal error (fail-open): " + String((e && e.message) || e);
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg, providers: [], roles: [] }) + "\n");
    } else {
      process.stdout.write(msg + "\n");
    }
    return 0;
  }

  const anyFail = model.providers.some((p) => p.verdict === "FAIL");
  const verdict = anyFail ? "FAIL" : model.providers.some((p) => p.verdict === "PARTIAL") ? "PARTIAL" : "PASS";

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ ok: !anyFail, verdict, ...model }) + "\n");
  } else {
    process.stdout.write(renderHuman(model));
  }

  if (strict && anyFail) return 2;
  return 0;
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
