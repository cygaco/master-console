#!/usr/bin/env node

"use strict";

const path = require("path");
const fs = require("fs");

const { probeAll, probeProvider } = require(
  path.join(__dirname, "..", "hooks", "lib", "provider-health.js"),
);
const { log } = require(
  path.join(__dirname, "..", "hooks", "lib", "logger.js"),
);
const { rcaFor } = require(path.join(__dirname, "lib", "provider-rca.js"));
const { runAutofixes } = require(
  path.join(__dirname, "lib", "provider-autofix.js"),
);

const SCHEMA = "mc/provider-smoke/v1";

const KNOWN_PROVIDERS = ["claude", "openai", "antigravity"];

const PROBE_MODES = ["", "list"];

const PROVIDER_TOKEN_RE = /^[a-z][a-z0-9_-]{1,31}$/;

const SEP_CHAR = "─";
const SEP = SEP_CHAR.repeat(48);

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (
        next === undefined ||
        (typeof next === "string" && next.startsWith("--"))
      ) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function validateProviders(rawList) {
  if (rawList === undefined || rawList === true) {
    return KNOWN_PROVIDERS.slice();
  }
  if (typeof rawList !== "string") {
    process.stderr.write("unknown_provider: " + String(rawList) + "\n");
    process.exit(1);
  }
  const tokens = rawList.split(",");
  if (tokens.length === 0) {
    process.stderr.write("unknown_provider: <empty>\n");
    process.exit(1);
  }
  for (const t of tokens) {
    if (t === "") {
      process.stderr.write("unknown_provider: <empty>\n");
      process.exit(1);
    }
    if (!PROVIDER_TOKEN_RE.test(t)) {
      process.stderr.write("unknown_provider: " + t + "\n");
      process.exit(1);
    }
    if (!KNOWN_PROVIDERS.includes(t)) {
      process.stderr.write("unknown_provider: " + t + "\n");
      process.exit(1);
    }
  }
  return tokens;
}

function validateProbe(rawProbe) {
  if (rawProbe === undefined) return "";
  if (rawProbe === true) return "";
  const val = String(rawProbe);
  if (!PROBE_MODES.includes(val)) {
    process.stderr.write("unknown_probe_mode: " + val + "\n");
    process.exit(1);
  }
  return val;
}

function validateTarget(rawTarget) {
  if (rawTarget === undefined) return process.cwd();
  if (rawTarget === true || rawTarget === "") {
    process.stderr.write("invalid_target: <empty>\n");
    process.exit(1);
  }
  const s = String(rawTarget);
  if (s.length === 0) {
    process.stderr.write("invalid_target: <empty>\n");
    process.exit(1);
  }
  const segments = s.split(/[\\/]/);
  if (segments.some((seg) => seg.trim() === "..")) {
    process.stderr.write("invalid_target: " + s + "\n");
    process.exit(1);
  }
  if (s.indexOf("\0") !== -1) {
    process.stderr.write("invalid_target: <null-byte>\n");
    process.exit(1);
  }
  let resolved;
  try {
    resolved = path.resolve(s);
  } catch (e) {
    process.stderr.write("invalid_target: " + s + "\n");
    process.exit(1);
  }
  return resolved;
}

function classify(results) {
  const isGreen = (r) => r && r.status === "ok";
  const isYellow = (r) =>
    r &&
    ["cli_missing", "auth_source_mismatch", "stale_cli_registry"].includes(
      r.status,
    );
  const isRed = (r) => r && !isGreen(r) && !isYellow(r);
  if (results.some(isRed)) return "red";
  if (results.some(isYellow)) return "yellow";
  return "green";
}

function loadFailureModeCatalog() {
  const catalogPath = path.join(
    process.cwd(),
    ".claude",
    "agents",
    "president",
    ".system",
    "policy",
    "provider-failure-modes.json",
  );
  if (!fs.existsSync(catalogPath)) {
    return { entries: {}, version: null, ok: true };
  }
  let raw;
  try {
    raw = fs.readFileSync(catalogPath, "utf8");
  } catch (e) {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "read_failed: " + (e && e.message ? e.message : String(e)),
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "parse_failed: " + (e && e.message ? e.message : String(e)),
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "schema_invalid: not an object",
    };
  }
  if (!parsed.entries || typeof parsed.entries !== "object") {
    return {
      entries: {},
      version: null,
      ok: false,
      error: "schema_invalid: entries map missing",
    };
  }
  return {
    entries: parsed.entries,
    version: parsed.version || null,
    ok: true,
  };
}

const PER_ROLE_BUILD_CHAIN = [
  "builder",
  "fixer",
  "reviewer",
  "compliance",
  "qa",
  "redteam",
  "ops-analyst",
];

function loadPingPrompt(targetRoot) {
  try {
    const p = require("../hooks/lib/mc-dirs").resolveProjectPath(targetRoot, ".mc/ping-prompt.txt");
    if (fs.existsSync(p)) {
      const body = fs.readFileSync(p, "utf8").trim();
      if (body) return body;
    }
  } catch {
  }
  return "Reply with exactly: OK. One line, nothing else.";
}

function perRoleProbe(roles, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60_000;
  const noPing = !!opts.noPing;
  const targetRoot = opts.targetRoot || process.cwd();

  let getProviderForRole, runProvider, getRoleModel;
  try {
    const providers = require(
      path.join(__dirname, "..", "hooks", "lib", "providers.js"),
    );
    getProviderForRole = providers.getProviderForRole;
    runProvider = providers.runProvider;
  } catch (e) {
    return roles.map((role) => ({
      role,
      provider: null,
      model: null,
      modelSource: "unresolved",
      status: "unresolved",
      reachable: false,
      reportedModel: null,
      reason: "providers.js unavailable: " + (e && e.message ? e.message : e),
      elapsed_ms: 0,
    }));
  }
  try {
    ({ getRoleModel } = require(path.join(__dirname, "..", "dispatch-agent.js")));
  } catch {
    getRoleModel = null;
  }

  const pingPrompt = noPing ? null : loadPingPrompt(targetRoot);

  return roles.map((role) => {
    let provider = null;
    try {
      provider = getProviderForRole(role);
    } catch {
      provider = null;
    }
    let specModel = null;
    if (getRoleModel) {
      try {
        specModel = getRoleModel(role);
      } catch {
        specModel = null;
      }
    }

    const base = {
      role,
      provider,
      model: specModel || null,
      modelSource: specModel ? "spec" : "provider-default",
      reportedModel: null,
      elapsed_ms: 0,
    };

    if (!provider) {
      return {
        ...base,
        status: "unresolved",
        reachable: false,
        reason: "could not resolve provider for role",
      };
    }

    if (provider === "claude") {
      return {
        ...base,
        status: "ok",
        reachable: true,
        reason: "claude is the harness; always reachable (not pinged)",
      };
    }

    if (noPing) {
      return {
        ...base,
        status: "resolved",
        reachable: null,
        reason: "resolved provider+model; ping skipped (--no-ping)",
      };
    }

    const t0 = Date.now();
    let res;
    try {
      res = runProvider(
        role,
        pingPrompt,
        specModel ? { model: specModel, timeoutMs } : { timeoutMs },
      );
    } catch (e) {
      return {
        ...base,
        status: "error",
        reachable: false,
        reason: "runProvider threw: " + (e && e.message ? e.message : e),
        elapsed_ms: Date.now() - t0,
      };
    }
    const elapsed_ms = Date.now() - t0;
    const reportedModel = res.actualModel || res.model || specModel || null;

    if (res.ok) {
      return {
        ...base,
        model: res.model || specModel || null,
        reportedModel,
        status: "ok",
        reachable: true,
        reason: "ping ok",
        elapsed_ms,
      };
    }

    let status = "unreachable";
    if (res.strictFailure) status = "model_unavailable";
    else if (res.fallback) status = "fellback";
    return {
      ...base,
      model: res.model || specModel || null,
      reportedModel,
      status,
      reachable: false,
      reason: String(res.error || "ping failed").slice(0, 300),
      elapsed_ms,
    };
  });
}

function classifyPerRole(rows) {
  const isRed = (r) =>
    ["model_unavailable", "unreachable", "error", "unresolved"].includes(
      r.status,
    );
  const isYellow = (r) => r.status === "fellback";
  if (rows.some(isRed)) return "red";
  if (rows.some(isYellow)) return "yellow";
  return "green";
}

function mergeVerdict(a, b) {
  const rank = { green: 0, yellow: 1, red: 2 };
  return rank[b] > rank[a] ? b : a;
}

function iconFor(status) {
  if (status === "ok") return "ok";
  if (
    ["cli_missing", "auth_source_mismatch", "stale_cli_registry"].includes(
      status,
    )
  ) {
    return "!!";
  }
  return "xx";
}

function iconForPerRole(status) {
  if (status === "ok") return "ok";
  if (status === "resolved") return "..";
  if (status === "fellback") return "!!";
  return "xx";
}

function renderPerRole(perRoleResults) {
  if (!Array.isArray(perRoleResults) || perRoleResults.length === 0) return [];
  const out = [];
  out.push("");
  out.push("Per-role reachability (dispatch resolution path):");
  out.push(SEP);
  for (const r of perRoleResults) {
    const ic = iconForPerRole(r.status);
    const role = String(r.role || "?").padEnd(11);
    const prov = String(r.provider || "?").padEnd(7);
    const model = String(r.model || r.reportedModel || "(default)").padEnd(24);
    let suffix = r.reason || r.status || "";
    if (
      r.reportedModel &&
      r.model &&
      r.reportedModel.toLowerCase() !== String(r.model).toLowerCase()
    ) {
      suffix = `requested ${r.model}, served ${r.reportedModel} — ${suffix}`;
    }
    out.push(
      ("  " + ic + "  " + role + " " + prov + " " + model + " " + suffix).trimEnd(),
    );
  }
  return out;
}

function renderHuman(verdict, results, rca, perRoleResults) {
  const out = [];
  const header =
    verdict === "green"
      ? "Provider Smoke — GREEN"
      : verdict === "yellow"
        ? "Provider Smoke — YELLOW (non-fatal)"
        : "Provider Smoke — RED (blocking)";
  out.push(header);
  out.push(SEP);
  const rcaByProvider = {};
  if (Array.isArray(rca)) {
    for (const e of rca) {
      if (e && e.provider) rcaByProvider[e.provider] = e;
    }
  }
  for (const r of results) {
    const ic = iconFor(r.status);
    const prov = String(r.provider || "?").padEnd(8);
    const stat = String(r.status || "?").padEnd(12);
    let suffix = "";
    if (r.status === "ok") {
      suffix = r.reason ? r.reason : "";
    } else if (ic === "!!") {
      suffix = r.reason ? r.reason : "";
    } else {
      const rcaEntry = rcaByProvider[r.provider];
      if (rcaEntry && rcaEntry.root_cause) {
        suffix = "root_cause=" + rcaEntry.root_cause;
      } else {
        suffix = "root_cause=" + r.status;
      }
    }
    out.push(("  " + ic + "  " + prov + " " + stat + " " + suffix).trimEnd());
  }
  for (const line of renderPerRole(perRoleResults)) out.push(line);
  if (verdict === "green") {
    out.push("All required providers ready.");
  } else if (verdict === "yellow") {
    out.push("Update may proceed. Run `/mc:health` for remediation.");
  } else {
    out.push(
      "Install/update aborted. See remediation above. Re-run after fixing.",
    );
  }
  return out.join("\n") + "\n";
}

function run(rawArgv) {
  const t0 = Date.now();
  const args = parseArgs(rawArgv);

  const providers = validateProviders(args.providers);
  const probeMode = validateProbe(args.probe);
  const jsonMode = !!args.json;
  const exitOnYellow = !!args["exit-on-yellow"];
  const noAutofix = !!args["no-autofix"];
  const target = validateTarget(args.target);
  const perRole = !!args["per-role"];
  const noPing = !!args["no-ping"];

  const catalog = loadFailureModeCatalog();

  if (catalog.ok === false) {
    const errMsg = "catalog_load_error: " + catalog.error;
    process.stderr.write(errMsg + "\n");
    try {
      log("audit", {
        type: "smoke",
        action: "provider-smoke-aborted",
        verdict: "error",
        providers: providers,
        duration_ms: Date.now() - t0,
        exit_code: 1,
        invoked_from: "standalone",
        schema_version: SCHEMA,
        catalog_version: null,
        no_autofix: !!args["no-autofix"],
        probe_mode: probeMode,
        target: target,
        error: catalog.error,
      });
    } catch (e) {
    }
    return {
      exitCode: 1,
      verdict: "error",
      results: [],
      rca: [],
      autofixes: [],
      catalog: { entries: {}, version: null },
    };
  }

  const results = probeAll(providers, { probe: probeMode });

  let verdict = classify(results);

  let exitCode;
  if (verdict === "red") exitCode = 2;
  else if (verdict === "yellow") exitCode = exitOnYellow ? 2 : 0;
  else exitCode = 0;

  const rca = rcaFor(results, catalog);

  const autofixes = runAutofixes({
    rca: rca,
    probeOne: (providerName) =>
      probeProvider(providerName, { probe: probeMode }),
    log: log,
    noAutofix: noAutofix,
    print: jsonMode ? () => {} : (s) => process.stdout.write(s),
  });

  if (autofixes.length > 0) {
    let anyApplied = false;
    for (const a of autofixes) {
      if (a && a.applied && a.success) {
        anyApplied = true;
        for (const r of results) {
          if (r && r.provider === a.provider) {
            r.status = "ok";
            r.reason =
              "auto-fix " +
              a.fix_recipe_kind +
              " -> ok (was " +
              a.original_status +
              ")";
          }
        }
      }
    }
    if (anyApplied) {
      const newVerdict = classify(results);
      if (newVerdict !== verdict) {
        verdict = newVerdict;
        if (newVerdict === "red") exitCode = 2;
        else if (newVerdict === "yellow") exitCode = exitOnYellow ? 2 : 0;
        else exitCode = 0;
      }
    }
  }

  let perRoleResults = null;
  if (perRole) {
    const allRows = perRoleProbe(PER_ROLE_BUILD_CHAIN, {
      noPing,
      targetRoot: target,
    });
    perRoleResults = allRows.filter(
      (r) => r.provider === "claude" || providers.includes(r.provider),
    );
    const perRoleVerdict = classifyPerRole(perRoleResults);
    const merged = mergeVerdict(verdict, perRoleVerdict);
    if (merged !== verdict) {
      verdict = merged;
      if (verdict === "red") exitCode = 2;
      else if (verdict === "yellow") exitCode = exitOnYellow ? 2 : 0;
      else exitCode = 0;
    }
  }

  const duration_ms = Date.now() - t0;

  try {
    log("audit", {
      type: "smoke",
      action: "provider-smoke-complete",
      verdict: verdict,
      providers: providers,
      duration_ms: duration_ms,
      exit_code: exitCode,
      invoked_from: "standalone",
      schema_version: SCHEMA,
      catalog_version: catalog.version,
      no_autofix: noAutofix,
      probe_mode: probeMode,
      target: target,
      per_role: perRoleResults
        ? {
            ran: true,
            no_ping: noPing,
            roles: perRoleResults.map((r) => ({
              role: r.role,
              provider: r.provider,
              model: r.model,
              status: r.status,
            })),
          }
        : { ran: false },
    });
  } catch (e) {
  }

  if (jsonMode) {
    const payload = {
      schema: SCHEMA,
      verdict: verdict,
      results: results,
      rca: rca,
      autofixes: autofixes,
      duration_ms: duration_ms,
      catalog_version: catalog.version,
      invoked_from: "standalone",
    };
    if (perRoleResults) payload.per_role = perRoleResults;
    process.stdout.write(JSON.stringify(payload) + "\n");
  } else {
    process.stdout.write(renderHuman(verdict, results, rca, perRoleResults));
  }

  return {
    exitCode: exitCode,
    verdict: verdict,
    results: results,
    rca: rca,
    autofixes: autofixes,
    catalog: catalog,
    perRole: perRoleResults,
  };
}

module.exports = {
  SCHEMA: SCHEMA,
  KNOWN_PROVIDERS: KNOWN_PROVIDERS,
  PROBE_MODES: PROBE_MODES,
  PROVIDER_TOKEN_RE: PROVIDER_TOKEN_RE,
  parseArgs: parseArgs,
  classify: classify,
  loadFailureModeCatalog: loadFailureModeCatalog,
  renderHuman: renderHuman,
  run: run,
  PER_ROLE_BUILD_CHAIN: PER_ROLE_BUILD_CHAIN,
  perRoleProbe: perRoleProbe,
  classifyPerRole: classifyPerRole,
  mergeVerdict: mergeVerdict,
};

if (require.main === module) {
  const result = run(process.argv.slice(2));
  process.exit(result.exitCode);
}
