
const mcEnv = require("./mc-env");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PROJECT, PATHS } = require("./paths");
let safeSpawn = null;
let authResolver = null;
try {
  safeSpawn = require("../../dispatch/safe-spawn");
} catch {
}
try {
  authResolver = require("../../dispatch/auth-resolver");
} catch {
}
let providerBreaker = null;
try {
  providerBreaker = require("../../dispatch/provider-breaker");
} catch {
}

const os_mod = require("os");
function readFileSafeLocal(p) {
  try { return fs.readFileSync(p, "utf8"); } catch { return null; }
}
function detectAuthModeLabel(provider) {
  try {
    if (provider === "claude") return "harness";
    if (provider === "openai") {
      const authFiles = [
        path.join(os_mod.homedir(), ".codex", "auth.json"),
        path.join(os_mod.homedir(), ".config", "codex", "auth.json"),
      ];
      for (const f of authFiles) {
        const raw = readFileSafeLocal(f);
        if (raw === null) continue;
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { }
        if (parsed !== null && typeof parsed === "object") {
          if (
            Object.prototype.hasOwnProperty.call(parsed, "auth_mode") ||
            Object.prototype.hasOwnProperty.call(parsed, "OPENAI_API_KEY")
          ) return "key (metered)";
          if (
            Object.prototype.hasOwnProperty.call(parsed, "access_token") ||
            Object.prototype.hasOwnProperty.call(parsed, "refresh_token") ||
            Object.prototype.hasOwnProperty.call(parsed, "tokens") ||
            Object.prototype.hasOwnProperty.call(parsed, "id_token")
          ) return "oauth (plan)";
          return "key (unknown posture)";
        }
        return "key (unknown posture)";
      }
      if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY) return "key (env)";
      return "none";
    }
    if (provider === "antigravity") {
      const credsPath = path.join(os_mod.homedir(), ".gemini", "oauth_creds.json");
      const raw = readFileSafeLocal(credsPath);
      if (raw && /(refresh|access)_token/.test(raw)) return "oauth (plan)";
      return "none";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.manifest, "utf8"));
  } catch {
    return {};
  }
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(PATHS.store, "utf8"));
  } catch {
    return {};
  }
}

function classifyQuotaFailure(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;
  if (
    (s.includes("free") && /limit:\s*0|limit\s*=\s*0|per[\s-]?day.*0/.test(s)) ||
    s.includes("free_tier_limit")
  ) {
    return { kind: "free_tier_limit_zero", recoverable: false };
  }
  if (
    s.includes("resource_exhausted") ||
    s.includes("quota") ||
    s.includes("rate limit") ||
    s.includes("ratelimit") ||
    s.includes("rate_limit") ||
    /\b429\b/.test(s) ||
    s.includes("too many requests")
  ) {
    return { kind: "quota_exhausted", recoverable: true };
  }
  return null;
}

const PROVIDER_FAMILY = { claude: "anthropic", openai: "openai", antigravity: "google" };
function suggestFallbackProvider(failedProvider, cfg) {
  const family = PROVIDER_FAMILY[failedProvider] || failedProvider;
  const differentFamily = (p) => p && PROVIDER_FAMILY[p] && PROVIDER_FAMILY[p] !== family;
  let target;
  if (family === "google") target = "openai";
  else if (family === "openai") target = differentFamily(cfg && cfg.fallback) ? cfg.fallback : "claude";
  else if (family === "anthropic") target = "openai";
  else target = differentFamily(cfg && cfg.fallback) ? cfg.fallback : "claude";
  if (!differentFamily(target)) target = family === "anthropic" ? "openai" : "claude";
  return target;
}

const OPENAI_FLAGSHIP = process.env.OPENAI_FLAGSHIP_MODEL || "gpt-5.6-sol";
const OPENAI_MINI = process.env.OPENAI_MINI_MODEL || "gpt-5.6-luna";

function readReasoningEnv(canonical, legacy, fallback) {
  const newVal = process.env[`REASONING_${canonical.toUpperCase()}`];
  if (newVal) return newVal;
  if (legacy) {
    const oldVal = process.env[`REASONING_${legacy.toUpperCase()}`];
    if (oldVal) {
      if (!global.__reasoningDeprecationWarned)
        global.__reasoningDeprecationWarned = {};
      if (!global.__reasoningDeprecationWarned[legacy]) {
        global.__reasoningDeprecationWarned[legacy] = true;
        try {
          process.stderr.write(
            `[providers.js] DEPRECATED: REASONING_${legacy.toUpperCase()} is set but REASONING_${canonical.toUpperCase()} is not. Old name still works for now; switch to the new name. (${legacy} → ${canonical} renamed)\n`,
          );
        } catch {
        }
      }
      return oldVal;
    }
  }
  return fallback;
}

const DEFAULT_REASONING_EFFORT = {
  reviewer: readReasoningEnv("reviewer", "evaluator", "xhigh"),
  compliance: readReasoningEnv("compliance", null, "xhigh"),
  "ops-analyst": readReasoningEnv("ops-analyst", "learner", "xhigh"),
  qa: readReasoningEnv("qa", null, "medium"),
  redteam: readReasoningEnv("redteam", null, "high"),
  builder: readReasoningEnv("builder", null, "high"),
  fixer: readReasoningEnv("fixer", null, "high"),
  alpha: null,
  beta: null,
  gamma: null,
  delta: null,
};

const { normalizeRole } = require("./role-aliases");

function getReasoningEffort(role) {
  const canonical = normalizeRole(role);
  if (DEFAULT_REASONING_EFFORT[canonical] != null)
    return DEFAULT_REASONING_EFFORT[canonical];
  try {
    const cat = require("../../dispatch/catalog");
    const e = cat && cat.DEFAULT_EFFORT_PER_ROLE && cat.DEFAULT_EFFORT_PER_ROLE[canonical];
    if (e != null) return e;
  } catch {
  }
  return null;
}

const LEGACY_OPENAI_ALIAS_PIN = Object.freeze({
  reviewer: () => OPENAI_FLAGSHIP,
  compliance: () => OPENAI_FLAGSHIP,
  qa: () => OPENAI_MINI,
});
function legacyAliasPin(role, providerName) {
  if (providerName !== "openai") return null;
  const f = LEGACY_OPENAI_ALIAS_PIN[String(role || "").toLowerCase()];
  return f ? f() : null;
}

const DEFAULT_PROVIDERS = {
  claude: {
    cli: "claude",
    default_model: "sonnet",
    invocation: "native",
  },
  openai: {
    cli: "codex",
    default_model: OPENAI_FLAGSHIP,
    flagship: OPENAI_FLAGSHIP,
    mini: OPENAI_MINI,
    fallback: "claude",
    syntax: `codex exec --sandbox workspace-write {reasoning} -m {model} -`,
  },
  antigravity: {
    cli: "agy",
    default_model: process.env.ANTIGRAVITY_MODEL || "gemini-3.1-pro-high",
    fallback: "openai",
    syntax: `agy {reasoning} --model {model} --print-timeout 90s -p`,
  },
};

let registryRoles = null;
try {
  registryRoles = require("../../dispatch/registry-roles");
} catch {
}
const LITERAL_DEFAULT_AGENT_PROVIDERS = {
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
  cabinet: "openai",
};

const DEFAULT_AGENT_PROVIDERS = registryRoles
  ? registryRoles.deriveOrFallback(
      () => ({
        ...registryRoles.providerMap(),
        ...registryRoles.SCRAPPED_PROVIDER_ALIASES,
      }),
      LITERAL_DEFAULT_AGENT_PROVIDERS,
      "providers.DEFAULT_AGENT_PROVIDERS",
    )
  : LITERAL_DEFAULT_AGENT_PROVIDERS;

function buildReasoningFlag(providerName, role) {
  const level = getReasoningEffort(role);
  if (!level) return "";
  if (providerName === "openai") return `-c model_reasoning_effort=${level}`;
  if (providerName === "claude") return `--effort ${level}`;
  return "";
}

function getProviderForRole(role) {
  const canonical = normalizeRole(role);
  const manifest = loadManifest();
  const agentMap = manifest.agentProviders || DEFAULT_AGENT_PROVIDERS;
  return (
    agentMap[canonical] ||
    agentMap[role] ||
    DEFAULT_AGENT_PROVIDERS[canonical] ||
    "claude"
  );
}

function getProviderConfig(providerName) {
  const manifest = loadManifest();
  const providers = manifest.providers || DEFAULT_PROVIDERS;
  return providers[providerName] || DEFAULT_PROVIDERS[providerName] || null;
}

function cliAvailable(cmd) {
  try {
    execSync(`${cmd} --version`, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    return true;
  } catch {
    return false;
  }
}

function providerAvailable(providerName) {
  if (providerName === "claude") return true;
  if (providerBreaker) {
    try {
      if (providerBreaker.isDown(providerName)) return false;
    } catch {
    }
  }
  const cfg = getProviderConfig(providerName);
  if (!cfg) return false;
  return cliAvailable(cfg.cli);
}

function tempFilePath(role) {
  const runtimeDir = PATHS.runtime;
  const tmpDir = path.join(runtimeDir, ".provider-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const id = crypto.randomBytes(4).toString("hex");
  return path.join(tmpDir, `${role}-${Date.now()}-${id}.txt`);
}

const _availabilityCache = new Map();
function modelAvailable(providerName, model) {
  const key = `${providerName}:${model}`;
  const cached = _availabilityCache.get(key);
  if (cached && Date.now() - cached.ts < 12 * 60_000) return cached.value;

  let available = true;
  try {
    if (providerName === "openai") {
      available = true;
    }
  } catch {
    available = true;
  }

  _availabilityCache.set(key, { ts: Date.now(), value: available });
  return available;
}

function extractReportedModel(output) {
  if (!output) return null;
  try {
    const parsed = typeof output === "string" ? JSON.parse(output) : output;
    if (parsed && parsed.model) return String(parsed.model).toLowerCase();
  } catch {
  }
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (parsed && parsed.model) return String(parsed.model).toLowerCase();
    } catch {
    }
  }
  const m1 = output.match(/model[:\s]+["']?([a-z0-9.\-]+)["']?/i);
  if (m1) return m1[1].toLowerCase();
  return null;
}

function modelsMatch(requested, reported) {
  if (!reported) return true;
  const a = requested.toLowerCase();
  const b = reported.toLowerCase();
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (a.startsWith("gpt-5") && b === "gpt-5") return true;
  return false;
}

function buildProviderArgv(providerName, model, reasoningArgs = [], opts = {}) {
  if (providerName === "openai") {
    return { toolId: "codex", argv: ["exec", "--sandbox", "workspace-write", ...reasoningArgs, "-m", model, "-"], usesStdin: true };
  }
  if (providerName === "antigravity") {
    const agyModel = require("../../dispatch/catalog").agyModelName(model);
    const agyTimeoutRaw = mcEnv.readEnv("AGY_PRINT_TIMEOUT") || "90s";
    const agyTimeout = /^[0-9]+(ms|s|m|h)?$/.test(agyTimeoutRaw) ? agyTimeoutRaw : "90s";
    return { toolId: "agy", argv: ["--model", agyModel, "--print-timeout", agyTimeout, "-p", opts.prompt || ""], usesStdin: false };
  }
  return {
    fail: true,
    error: `Provider "${providerName}" uses a custom cfg.syntax not covered by the dispatch safety kernel (safe-spawn ARG_POLICY). Add a tool-ID + arg-policy before dispatching — refusing an unvetted shell spawn.`,
  };
}

function runProvider(role, prompt, opts = {}) {
  const { foregroundAwareTimeout, WRAPPER_DEFAULTS } = require("../../dispatch/timeout-policy");
  const timeoutMs = foregroundAwareTimeout(
    opts.timeoutMs || WRAPPER_DEFAULTS["run-provider"],
    opts,
  );
  const strict = opts.strict !== false;
  const providerName = opts.provider || getProviderForRole(role);

  if (providerName === "claude") {
    return {
      ok: false,
      provider: "claude",
      output: "",
      fallback: false,
      error:
        "Provider is Claude — dispatch via Claude Code Agent tool, not this bridge.",
    };
  }

  const cfg = getProviderConfig(providerName);
  if (!cfg) {
    return {
      ok: false,
      provider: providerName,
      output: "",
      fallback: true,
      error: `Unknown provider: ${providerName}`,
    };
  }

  const probeCliAvailable = opts.cliAvailable || cliAvailable;
  if (!probeCliAvailable(cfg.cli)) {
    return {
      ok: false,
      provider: providerName,
      output: "",
      fallback: true,
      error: `CLI "${cfg.cli}" not found — install it or switch provider to ${cfg.fallback || "claude"}`,
    };
  }

  const model = opts.model || legacyAliasPin(role, providerName) || cfg.default_model;

  if (strict && !modelAvailable(providerName, model)) {
    return {
      ok: false,
      provider: providerName,
      model,
      output: "",
      fallback: false,
      strictFailure: true,
      error: `Model ${model} is not available on your ${providerName} account. Upgrade your tier, or edit manifest.providers.${providerName}.default_model to a model you have access to. Refusing to silently downgrade.`,
    };
  }

  const promptFile = tempFilePath(role);
  fs.writeFileSync(promptFile, prompt, "utf8");

  try {
    const promptContent = fs.readFileSync(promptFile, "utf8");

    const reasoningFlag = buildReasoningFlag(providerName, role);

    const reasoningArgs = reasoningFlag
      ? reasoningFlag.split(/\s+/).filter(Boolean)
      : [];
    const built = buildProviderArgv(providerName, model, reasoningArgs, {
      prompt: promptContent,
    });
    if (built.fail) {
      return { ok: false, provider: providerName, model, output: "", fallback: true, error: built.error };
    }
    const { toolId, argv, usesStdin } = built;

    const gitCfgIdx = parseInt(process.env.GIT_CONFIG_COUNT, 10) || 0;
    const childEnv = {
      ...process.env,
      GIT_CONFIG_COUNT: String(gitCfgIdx + 1),
      [`GIT_CONFIG_KEY_${gitCfgIdx}`]: "safe.directory",
      [`GIT_CONFIG_VALUE_${gitCfgIdx}`]: "*",
    };

    if (!safeSpawn) {
      const e = new Error(
        "dispatch safety kernel (scripts/dispatch/safe-spawn.js) unavailable — refusing the legacy shell:true spawn. Restore the module.",
      );
      e.kernelMissing = true;
      throw e;
    }
    const antigravityStartMs = providerName === "antigravity" ? Date.now() : null;
    const agyLogPath =
      providerName === "antigravity"
        ? require("path").join(require("os").homedir(), ".gemini", "antigravity-cli", "cli.log")
        : null;
    let agyLogPre = null;
    if (providerName === "antigravity") {
      const { snapshotAgyLog } = require("../../dispatch/agy-auth-tells");
      agyLogPre = snapshotAgyLog(agyLogPath);
    }
    const spawned = safeSpawn.safeSpawnSync(toolId, argv, {
      cwd: PROJECT,
      env: childEnv,
      input: usesStdin ? promptContent : undefined,
      timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    const stderrText = spawned.stderr || "";
    const stderrBytes = Buffer.byteLength(stderrText, "utf8");
    if (!spawned.ok) {
      const detail = spawned.violations
        ? `arg-policy: ${spawned.violations.join("; ")}`
        : spawned.detail
          ? spawned.detail
          : stderrText.trim() || spawned.reason || `exit ${spawned.exitCode}`;
      const e = new Error(detail);
      e.stderr = stderrText;
      e.status = spawned.exitCode;
      e.stderrBytes = stderrBytes;
      e.reaped = spawned.reaped;
      e.reason = spawned.reason;
      throw e;
    }
    const rawOutput = (spawned.stdout || "").trim();

    const output = rawOutput;
    const actualModel = null;

    let authFallback;
    if (providerName === "antigravity") {
      const { detectAgyAuthFallback, readAgyLogDelta } = require("../../dispatch/agy-auth-tells");
      const delta = readAgyLogDelta(agyLogPath, agyLogPre);
      authFallback = detectAgyAuthFallback({
        agyLog: delta.ok ? delta.delta : null,
        agyLogReadError: !delta.ok,
        startedMs: antigravityStartMs,
        runPid: spawned.pid,
      }).auth_fallback;
    }

    if (strict && !modelsMatch(model, actualModel)) {
      return {
        ok: false,
        provider: providerName,
        model,
        actualModel,
        output,
        fallback: false,
        strictFailure: true,
        error: `Silent downgrade: requested ${model}, CLI served ${actualModel}. Refusing to accept — the whole point of cross-provider is model-specific review. Options: (1) upgrade provider tier, (2) edit manifest.providers.${providerName}.default_model to "${actualModel}", (3) pass opts.strict=false to accept any model returned.`,
      };
    }

    return {
      ok: true,
      provider: providerName,
      model,
      actualModel,
      output,
      stderrBytes,
      cmd: [toolId, ...argv].join(" ").slice(0, 200),
      ...(spawned.tool && spawned.tool.path
        ? {
            tool_path: spawned.tool.path,
            tool_version: (spawned.tool.resolution && spawned.tool.resolution.chosen_version) || null,
            tool_choice: (spawned.tool.resolution && spawned.tool.resolution.reason) || null,
            ...(spawned.tool.resolution && Array.isArray(spawned.tool.resolution.alternatives) && spawned.tool.resolution.alternatives.length
              ? { tool_alternatives: spawned.tool.resolution.alternatives }
              : {}),
          }
        : {}),
      ...(authFallback !== undefined ? { auth_fallback: authFallback } : {}),
    };
  } catch (err) {
    const errText = String(
      (err && (err.stderr || err.message)) || err || "",
    );
    const quota = classifyQuotaFailure(errText);
    if (quota) {
      if (quota.kind === "quota_exhausted" && providerBreaker) {
        try {
          providerBreaker.markDown(providerName, {
            kind: quota.kind,
            untilMs: providerBreaker.computeUntil(
              providerName,
              errText,
              Date.now(),
            ),
            evidence: `${quota.kind} on model=${model}`.slice(0, 200),
          });
        } catch {
        }
      }
      try {
        process.stderr.write(
          `[providers.js] QUOTA: ${providerName} (${model}) hit ${quota.kind}` +
            `${quota.recoverable ? "" : " — UNRECOVERABLE (free-tier daily=0)"}.` +
            ` Falling back to ${cfg.fallback || "claude"}. For a 2nd security pass` +
            ` on a different family use runProvider(role, prompt, {provider:'openai'}).\n`,
        );
      } catch {
      }
    }
    return {
      ok: false,
      provider: providerName,
      model,
      output: "",
      fallback: true,
      error: String(err.message || err).slice(0, 500),
      stderrBytes: typeof err.stderrBytes === "number" ? err.stderrBytes : 0,
      ...(quota
        ? {
            quota: {
              kind: quota.kind,
              recoverable: quota.recoverable,
              suggestFallbackProvider: suggestFallbackProvider(providerName, cfg),
              auth_mode: detectAuthModeLabel(providerName),
            },
          }
        : {}),
    };
  } finally {
    if (!mcEnv.readEnv("PROVIDER_DEBUG")) {
      try {
        fs.unlinkSync(promptFile);
      } catch {
      }
    }
  }
}

function parseProviderJson(output) {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
  }
  const match = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    const preFence = output.slice(0, match.index ?? 0);
    const preLen = preFence.trim().length;
    if (preLen > 500) {
      process.stderr.write(
        `[parseProviderJson] prose-leak: ${preLen} chars of narrative before JSON fence (reviewer ignored JSON-only constraint)\n`,
      );
    }
    try {
      return JSON.parse(match[1].trim());
    } catch {
    }
  }
  return null;
}

function assertStrictModel(envelope, expectedModel) {
  if (!envelope || typeof envelope !== "object") return true;
  const stats = envelope.stats || envelope._stats;
  if (!stats || typeof stats !== "object") return true;
  const actualMode = stats.mode || stats.model;
  if (!actualMode || typeof actualMode !== "string") return true;
  if (actualMode.includes(expectedModel)) return true;
  process.stderr.write(
    `[strict-model-assertion] FAIL: expected ${expectedModel}, got ${actualMode} (silent fallback detected)\n`,
  );
  return false;
}

module.exports = {
  runProvider,
  legacyAliasPin,
  buildProviderArgv,
  getProviderForRole,
  getProviderConfig,
  getReasoningEffort,
  buildReasoningFlag,
  providerAvailable,
  parseProviderJson,
  assertStrictModel,
  classifyQuotaFailure,
  suggestFallbackProvider,
  PROVIDER_FAMILY,
  DEFAULT_PROVIDERS,
  DEFAULT_AGENT_PROVIDERS,
  LITERAL_DEFAULT_AGENT_PROVIDERS,
  DEFAULT_REASONING_EFFORT,
};
