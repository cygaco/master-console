/**
 * providers.js — Cross-provider CLI bridge for review-layer agents.
 *
 * Claude Code's `model:` frontmatter only accepts Claude models. To run review
 * agents on GPT / Gemini for model diversity (different model reviewing Claude's
 * output catches what same-model review misses), we shell out to the respective
 * CLIs instead of dispatching as a Claude sub-agent.
 *
 * Pattern borrowed from /research:deep:
 *   - Write prompt to temp file (avoids bash escaping hell)
 *   - Invoke CLI via execSync, capture stdout
 *   - Normalize output to match Claude sub-agent JSON shape
 *   - Fall back to Claude if CLI unavailable
 *
 * Usage:
 *   const { runProvider, getProviderForRole, providerAvailable } = require('./lib/providers');
 *   const result = runProvider('reviewer', promptText, { timeoutMs: 120000 });
 *
 * Exit codes:
 *   0 — success, result is parsed
 *   1 — CLI failed, result.fallback === true, caller should retry via Claude
 */

const mcEnv = require("./mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PROJECT, PATHS } = require("./paths");
// PLAN §17.2 step-1 wire-through: the live cross-provider dispatch spawns through
// the dispatch SAFETY KERNEL (tool-ID→abs path, arg allowlist, shell:false,
// tree-kill) and resolves keys through the shared N-3 AUTH-RESOLVER (full source
// precedence, in-code dotenv, BOM-safe, never a shell). GUARDED requires — a hook
// lib must never crash on a missing/broken module; fall back to the legacy
// shell:true spawn only if the kernel can't be loaded (logged once).
let safeSpawn = null;
let authResolver = null;
try {
  safeSpawn = require("../../dispatch/safe-spawn");
} catch {
  /* fail-open: legacy spawn path below */
}
try {
  authResolver = require("../../dispatch/auth-resolver");
} catch {
  /* fail-open: dispatch proceeds without the shared auth-resolver */
}
// T-20260610-306: TTL'd circuit breaker — marks a provider down after a quota
// failure so subsequent dispatches skip it instead of re-burning the quota window.
// Guarded require: if the module is missing or broken the breaker is simply absent
// (fail-open; providerAvailable falls through to its normal CLI check).
let providerBreaker = null;
try {
  providerBreaker = require("../../dispatch/provider-breaker");
} catch {
  /* fail-open: breaker unavailable, dispatch proceeds normally */
}

// ── Auth mode label (value-free, inline — importing dispatch-readiness would be circular) ──
// Returns a SHORT label: "key (metered)" | "oauth (plan)" | "key (unknown posture)" | "none" | "harness" | "unknown"
// VALUE-FREE: reads only field PRESENCE, never field values.
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
        try { parsed = JSON.parse(raw); } catch { /* unparseable */ }
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
      // agy self-auths via the shared ~/.gemini keyring (oauth_creds.json). VALUE-FREE:
      // presence of a refresh/access token → an oauth session; else none. (The SUNSET
      // individual gemini CLI's key/env auth path was removed with the deep-clean.)
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

// ── Config resolution ───────────────────────────────────────
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

/**
 * WI-18 — quota / rate-limit detector for a failed dispatch.
 *
 * A preview-tier gemini (or a free-tier key) can 429 / RESOURCE_EXHAUSTED mid
 * cross-provider gauntlet. Before this, runProvider returned a generic
 * `fallback:true` and the failure was easy to read as a silent false-green
 * (the caller's claude fallback ran, but nobody noticed the paid model never
 * served). This classifies the stderr/error text so the caller can (a) see a
 * LOUD, specific reason and (b) route to the openai security pass deliberately.
 *
 * Conservative: pure string match on signals every vendor emits. Returns a
 * small record or null. Never throws, never spends a token.
 */
function classifyQuotaFailure(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;
  // Free-tier daily limit of zero is unrecoverable — distinguish it so the
  // caller doesn't retry/back off pointlessly.
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

// ── WG-11(b): family-aware fallback ─────────────────────────
// A quota/outage fallback MUST land in a DIFFERENT model FAMILY. Same-family fallback re-hits the
// exact condition that failed the primary — a Google quota window takes out gemini AND antigravity
// (both `google`), a GPT outage takes out every gpt-5.6 tier. This is a routing rule, not a flag:
// map the failed provider to its family and return a target in ANOTHER family, preferring a
// NON-claude cross-family target for a Google-lab failure so a security hunter retries on the GPT lab
// rather than collapsing toward the Claude lane (cross-lab diversity preserved).
const PROVIDER_FAMILY = { claude: "anthropic", openai: "openai", antigravity: "google" };
function suggestFallbackProvider(failedProvider, cfg) {
  const family = PROVIDER_FAMILY[failedProvider] || failedProvider;
  // COR-001 (backend-reviewer HIGH): NEVER trust cfg.fallback to be cross-family — a config with
  // {fallback:"openai"} on an openai role would otherwise re-target the SAME family. Only accept a
  // configured fallback when it is a DIFFERENT, KNOWN family; else fall to a guaranteed cross-family
  // default. Preference: a Google-lab failure retries on the GPT lab (non-claude, security lab-diversity).
  const differentFamily = (p) => p && PROVIDER_FAMILY[p] && PROVIDER_FAMILY[p] !== family;
  let target;
  if (family === "google") target = "openai"; // gemini/antigravity → GPT
  else if (family === "openai") target = differentFamily(cfg && cfg.fallback) ? cfg.fallback : "claude";
  else if (family === "anthropic") target = "openai"; // claude → GPT
  else target = differentFamily(cfg && cfg.fallback) ? cfg.fallback : "claude";
  // Final guard — GUARANTEE a different, known family by construction (never same-family or unknown).
  if (!differentFamily(target)) target = family === "anthropic" ? "openai" : "claude";
  return target;
}

/**
 * Provider defaults if manifest.providers is missing.
 * Keys match the CLI tool name.
 */
// Model strings rot. Pin via env vars with dated defaults; override at run start
// without code changes. Defaults updated 2026-04-26 to gpt-5.5 (1M ctx, $5/$30) for
// flagship reasoning roles; gpt-5.4-mini retained for high-volume roles
// (qa, learner) where cost matters more than peak reasoning.
const OPENAI_FLAGSHIP = process.env.OPENAI_FLAGSHIP_MODEL || "gpt-5.6-sol"; // reviewer, compliance (DISPATCH.md §8 flip; gotcha-8 plumbing default)
const OPENAI_MINI = process.env.OPENAI_MINI_MODEL || "gpt-5.4-mini"; // qa, learner (no gpt-5.5-mini exists yet)

// Reasoning effort per role. Forces deeper deliberation across all dispatch
// roles. Per recent learning: "LLM-as-judge is systematically biased and
// gameable — reasoning-level outputs may be subject to length bias and
// authority inflation." Forcing high effort partially mitigates by requiring
// more internal verification before the verdict.
//
// codex (OpenAI): `-c model_reasoning_effort=<level>` — low|medium|high|xhigh
// gemini-3.x:    thinking is always-on for pro-preview tier; no CLI flag
// claude (4.6+): `--effort <level>` — low|medium|high|xhigh|max (max = "always
//                 thinks with no constraints on thinking depth"; opus-4-7 uses
//                 adaptive thinking as the only mode and `max` removes caps)
//
// Per https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
// (2026-04-26): Opus 4.7 + Sonnet 4.6 support `effort` parameter with `max`
// as the "always thinks, no depth cap" setting.
// Renamed 2026-04-29: evaluator → reviewer, auditor → learner.
// New env vars (REASONING_REVIEWER, REASONING_LEARNER) are read first; legacy
// names (REASONING_EVALUATOR, REASONING_AUDITOR) are honored for one transition
// cycle with a one-time deprecation warning.
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
            `[providers.js] DEPRECATED: REASONING_${legacy.toUpperCase()} is set but REASONING_${canonical.toUpperCase()} is not. Old name still works for now; switch to the new name. (${legacy} → ${canonical} renamed 2026-04-29)\n`,
          );
        } catch {
          /* stderr unavailable */
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
  // S-7: learner → ops-analyst. New env var REASONING_OPS_ANALYST wins; the legacy
  // REASONING_LEARNER is honored via the same legacy-name pattern (mirrors how the
  // old `learner` key honored REASONING_AUDITOR). 1-hop legacy fallback.
  "ops-analyst": readReasoningEnv("ops-analyst", "learner", "ultra"),
  qa: readReasoningEnv("qa", null, "medium"), // 13 personas × volume; medium balances cost
  redteam: readReasoningEnv("redteam", null, "high"), // gemini implicit; flag is no-op
  // Build-side roles (claude) — `high` per ADR-0007 effort policy (2026-06-04):
  // `max` is reserved for the top face (alpha) on big projects, not the doers.
  // Env overrides (REASONING_BUILDER / REASONING_FIXER) still win.
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
  // ADR-0007: fall back to the catalog effort map (the single source for the new
  // roster) so aliased + new roles resolve their effort without a parallel
  // hand-maintained list here. e.g. qa→qa-reviewer→xhigh, redteam→security-reviewer→high.
  try {
    const cat = require("../../dispatch/catalog");
    const e = cat && cat.DEFAULT_EFFORT_PER_ROLE && cat.DEFAULT_EFFORT_PER_ROLE[canonical];
    if (e != null) return e;
  } catch {
    /* catalog unavailable — keep null */
  }
  return null;
}

const DEFAULT_PROVIDERS = {
  claude: {
    cli: "claude",
    default_model: "sonnet",
    invocation: "native", // dispatched via Claude Code Agent tool, not this bridge
  },
  openai: {
    cli: "codex",
    default_model: OPENAI_FLAGSHIP, // gpt-5.5 unless OPENAI_FLAGSHIP_MODEL env override
    flagship: OPENAI_FLAGSHIP,
    mini: OPENAI_MINI,
    fallback: "claude",
    // Per https://developers.openai.com/codex/cli/reference :
    //   `codex exec` with `-` reads prompt from stdin.
    //   `--full-auto` is DEPRECATED (Codex ≥0.135) → `--sandbox workspace-write` for headless runs (exec is non-interactive; `--ask-for-approval` is interactive-only).
    //   `-m <model>` or `--model <model>` selects the model.
    //   `-c model_reasoning_effort=<level>` overrides reasoning depth (low|medium|high).
    //   `-o <file>` writes last-message response for reliable capture.
    // `{reasoning}` is replaced with `-c model_reasoning_effort=<level>` if a
    // role-specific level is set; otherwise empty.
    syntax: `codex exec --sandbox workspace-write {reasoning} -m {model} -`,
  },
  // D6 (SP-20260718-003, ED-060): Antigravity CLI (`agy`) — the migration target for the SUNSET
  // gemini individual CLI (IneligibleTierError → "migrate to Antigravity", 2026-06-18). This is the
  // Gemini LAB of the panel-3lab security review. LIVENESS IS OPERATOR-OWNED (ED-060): no live agy
  // CLI + tier exists yet, so this headless contract is BEST-KNOWN / UNPROVEN — gated behind
  // providerAvailable (cliAvailable fail-closes to `fallback` when agy is absent), and the panel-3lab
  // exit stays BLOCKED-ON-OPERATOR until one real agy `fallback:false` ledger record exists.
  antigravity: {
    cli: "agy",
    // gemini-3.1-pro-high — the panel Gemini-lab model (role-registry security-reviewer.provider).
    default_model: process.env.ANTIGRAVITY_MODEL || "gemini-3.1-pro-high",
    // CROSS-FAMILY fallback (WG-11(b)): antigravity is google-family, so a Google-lab outage must
    // retry on the GPT lab, NOT another google endpoint. openai is the cross-family target.
    fallback: "openai",
    // Headless contract (UNPROVEN): `agy --model <id> --print-timeout <dur> -p '<prompt>'`. The prompt
    // is the `-p` argv VALUE (agy has no stdin '-' positional) — safe-spawn's agy ARG_POLICY (#27
    // carve-out) injection-checks it (newline-tolerant refusal + native-exe ONLY, so a .cmd shim
    // cannot reparse the multi-line arg). The ASSEMBLED command line is bounded by CMDLINE_MAX
    // (safe-spawn.js: 32000 — the Windows CreateProcess ceiling minus margin): a >32KB prompt is
    // BLOCKED, never truncated-and-sent (SP-002), so a big diff cannot ride -p. thinking is always-on;
    // our dispatch passes no effort flag (agy default) — and MUST NOT: agy exposes `--effort
    // low|medium|high` in `--help`, but it is MODEL-GATED — the Gemini 3.1 Pro family (gemini-3.1-pro-high,
    // the model BOTH agy lanes use) REJECTS it: `agy --model "Gemini 3.1 Pro (High)" --effort high` exits 1
    // "--effort is not supported for model" (effort is baked into the model NAME). Probed headless
    // 2026-07-24 (agy 1.1.6, reproducible); this confirms the ratified model_policy (antigravity effort:null,
    // thinking always-on). ED-277 CLOSED not-wirable-by-construction — do NOT re-add `--effort` to the agy
    // argv. Re-open trigger: an agy model that ACCEPTS `--effort` (re-probe on a version bump).
    // `{reasoning}` is empty for agy (kept for syntax uniformity).
    syntax: `agy {reasoning} --model {model} --print-timeout 90s -p`,
  },
};

/**
 * Default role → provider mapping. Can be overridden per-project by
 * `manifest.agentProviders`. This is the KEY decision: which agent goes to
 * which provider for model diversity.
 */
// v0.2 consumer rewire: DERIVE from the role-registry keystone ∪ the back-compat
// shim ∪ the W-4 freeform-consult pseudo-roles. GUARDED require + deriveOrFallback —
// this is a hook lib, so a broken registry read must fall back to the literal, never
// crash. CUT-SAFETY: derived yields the same provider for every role the literal
// named (verified before the cut); the registry adds the claude manager/director
// roles (behavior-neutral — getProviderForRole defaults unlisted → claude).
let registryRoles = null;
try {
  registryRoles = require("../../dispatch/registry-roles");
} catch {
  /* fail-open: DEFAULT_AGENT_PROVIDERS falls back to its literal below */
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
  // Review layer — GPT-5.5 for different lens on Claude's output, forced high reasoning
  reviewer: "openai",
  compliance: "openai",
  "ops-analyst": "openai", // S-7: was `learner`
  qa: "openai",
  // Security literal FLOOR = the VERIFIABLE GPT lane (β DECIDE B/0.90, 2026-07-20): a registry-read
  // failure must fall to openai (verifiable), NEVER the SUNSET gemini CLI and NEVER the unverifiable
  // agy lane (ED-230 open). The LIVE security-reviewer default is antigravity via the role-registry
  // derivation (this literal is only the recovery net); redteam is superseded by security-reviewer.
  redteam: "openai",
  // ADR-0007 new roster (must match catalog.js DEFAULT_PROVIDER_PER_ROLE):
  epsilon: "claude",
  "design-lead": "openai",
  "frontend-reviewer": "openai",
  "frontend-fixer": "claude",
  "backend-reviewer": "openai",
  "backend-fixer": "claude",
  "security-builder": "claude",
  "security-reviewer": "openai", // literal FLOOR only — LIVE default = antigravity via role-registry (β DECIDE B/0.90)
  "security-fixer": "claude",
  "qa-reviewer": "openai",
  "visual-review": "claude",
  "test-runner": "claude",
  // S-7: the registered freeform cross-provider consult role (brainstorm, second
  // opinion, research). Non-Claude, NO strict output schema — dispatch-agent.js
  // skips envelope validation for it so freeform replies don't trip the
  // review-envelope validator (false "invalid verdict null") or distort
  // review-role telemetry. Legacy ids advisor/consult resolve to cabinet via
  // role-aliases (getProviderForRole normalizeRole()s before lookup) — no explicit
  // legacy entries here, so they don't surface to dispatch-routing-parity.
  cabinet: "openai",
};

const DEFAULT_AGENT_PROVIDERS = registryRoles
  ? registryRoles.deriveOrFallback(
      () => ({
        ...registryRoles.providerMap(),
        ...registryRoles.SCRAPPED_PROVIDER_ALIASES,
        // S-7: cabinet is now a real registry role (providerMap covers it), so the
        // W-4 pseudo-roles advisor/consult no longer need explicit map entries —
        // getProviderForRole normalizeRole()s them to cabinet, which resolves. (An
        // explicit entry here would surface them to dispatch-routing-parity as
        // undocumented non-Claude roles. The alias is the single back-compat hop.)
      }),
      LITERAL_DEFAULT_AGENT_PROVIDERS,
      "providers.DEFAULT_AGENT_PROVIDERS",
    )
  : LITERAL_DEFAULT_AGENT_PROVIDERS;

/**
 * Build the reasoning-flag fragment for a given provider+role pair.
 * Returns the empty string if no flag is applicable.
 */
function buildReasoningFlag(providerName, role) {
  const level = getReasoningEffort(role);
  if (!level) return "";
  if (providerName === "openai") return `-c model_reasoning_effort=${level}`;
  if (providerName === "claude") return `--effort ${level}`;
  // antigravity (agy) — return "" (no effort flag). agy exposes `--effort low|medium|high` in `--help`,
  // but it is MODEL-GATED: agy's Gemini 3.1 Pro family (gemini-3.1-pro-high, the model BOTH agy lanes use)
  // REJECTS `--effort` — exit 1 "--effort is not supported for model" (effort is baked into the model NAME).
  // Probed headless 2026-07-24 (agy 1.1.6). Wiring `--effort` here would fail-close every agy dispatch AND
  // contradict the ratified model_policy (antigravity effort:null). ED-277 CLOSED not-wirable-by-construction;
  // re-open only if an agy model accepts `--effort` (re-probe on a version bump).
  return "";
}

function getProviderForRole(role) {
  const canonical = normalizeRole(role);
  const manifest = loadManifest();
  const agentMap = manifest.agentProviders || DEFAULT_AGENT_PROVIDERS;
  // Try canonical name first, then legacy as fallback (for partially-migrated
  // manifests during the transition window).
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

// ── Availability ────────────────────────────────────────────
// Actually INVOKE the binary with --version — a dead PATH entry (shim / broken
// symlink) will fail, which `which` / `where` would falsely report as present.
// 30s timeout: gemini CLI's `--version` cold-start on Windows is highly
// variable — measured 2.9s, 3.8s, 5.5s, 8.6s within the same 5-min window.
// Under parallel review-load it spikes harder. A dead command fails well
// under 30s anyway (PATH lookup is instant).
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
  if (providerName === "claude") return true; // always available — it's the harness
  // ── Circuit-breaker consult — SINGLE chokepoint for every provider ──────
  // Every caller that reaches here (dispatch-shape, dispatch-claude, dispatch-agent,
  // provider-health checks) inherits this gate. No per-wrapper consults needed.
  // FAIL-OPEN: if providerBreaker failed to load OR isDown throws, fall through
  // to the normal CLI check — a broken breaker NEVER blocks a healthy provider.
  if (providerBreaker) {
    try {
      if (providerBreaker.isDown(providerName)) return false;
    } catch {
      // Fail-open: breaker error must never block a healthy provider
    }
  }
  const cfg = getProviderConfig(providerName);
  if (!cfg) return false;
  return cliAvailable(cfg.cli);
}

// ── Temp file helpers ───────────────────────────────────────
function tempFilePath(role) {
  const runtimeDir = PATHS.runtime;
  const tmpDir = path.join(runtimeDir, ".provider-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const id = crypto.randomBytes(4).toString("hex");
  return path.join(tmpDir, `${role}-${Date.now()}-${id}.txt`);
}

// ── Invocation ──────────────────────────────────────────────
/**
 * Run a provider for a given role.
 *
 * @param {string} role - Agent role (reviewer, compliance, qa, redteam, learner, etc.)
 * @param {string} prompt - Full prompt text (agent instructions + context)
 * @param {object} opts
 * @param {number} opts.timeoutMs - Default 120_000 (2 min)
 * @param {string} opts.model - Override default model for this provider
 * @returns {object} { ok: boolean, provider: string, model: string, output: string, fallback?: boolean, error?: string }
 */
/**
 * Check whether a given model is actually available on the user's account
 * for the given provider. Returns true if available, false otherwise.
 *
 * For OpenAI/codex: the CLI itself knows the available models (optimistic; the
 * post-dispatch assertion catches mismatches). For antigravity (agy): NEVER probe
 * `agy models` (it hangs headless) — stay optimistic and rely on cert-attest's
 * served-model check. (The SUNSET gemini `models list` probe was removed 2026-07-20.)
 *
 * Cached per-session (12 min TTL) to avoid repeated probes.
 */
const _availabilityCache = new Map();
function modelAvailable(providerName, model) {
  const key = `${providerName}:${model}`;
  const cached = _availabilityCache.get(key);
  if (cached && Date.now() - cached.ts < 12 * 60_000) return cached.value;

  let available = true; // default optimistic; pre-flight is best-effort
  try {
    if (providerName === "openai") {
      // codex doesn't expose models list; skip probe, rely on post-dispatch assertion
      available = true;
    }
    // antigravity (agy): NEVER probe `agy models` — it HANGS headless (>10min, zero
    // output; catalog note). Stay optimistic; cert-attest's served-model check is the
    // real drift witness for the agy lane.
  } catch {
    // Probe failed; fall back to optimistic. Post-dispatch assertion catches mismatches.
    available = true;
  }

  _availabilityCache.set(key, { ts: Date.now(), value: available });
  return available;
}

/**
 * Extract the model identifier a provider reports in its response, if any.
 * Providers often include their self-identification either in headers
 * (not available in CLI mode) or in the text output. This heuristic
 * matches the most common patterns.
 */
function extractReportedModel(output) {
  if (!output) return null;
  // Try JSON parse first — our agents produce a JSON envelope
  try {
    const parsed = typeof output === "string" ? JSON.parse(output) : output;
    if (parsed && parsed.model) return String(parsed.model).toLowerCase();
  } catch {
    /* not JSON — try fenced block */
  }
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (parsed && parsed.model) return String(parsed.model).toLowerCase();
    } catch {
      /* skip */
    }
  }
  // Text fallback: look for "model: <id>" or "I am <id>"
  const m1 = output.match(/model[:\s]+["']?([a-z0-9.\-]+)["']?/i);
  if (m1) return m1[1].toLowerCase();
  return null;
}

/**
 * Compare requested vs reported model. Returns true if they are considered
 * the same model (including known family equivalences). Rejects clearly
 * downgraded cases like gemini-3.1-pro → gemini-2.5-pro.
 */
function modelsMatch(requested, reported) {
  if (!reported) return true; // no self-report; can't verify, assume OK
  const a = requested.toLowerCase();
  const b = reported.toLowerCase();
  if (a === b) return true;
  // Accept exact prefix match (e.g. gpt-5.4 vs gpt-5.4-2026-03-05)
  if (a.startsWith(b) || b.startsWith(a)) return true;
  // Codex self-reports as "gpt-5" — accept within the GPT-5 family only when
  // requested model starts with "gpt-5" as well. Don't accept "gpt-4" etc.
  if (a.startsWith("gpt-5") && b === "gpt-5") return true;
  return false;
}

/**
 * Build the { toolId, argv, usesStdin } CLI invocation shape for a provider dispatch. PURE — the
 * single source of each provider's argv (D6 added agy), so the invocation shape is an assertable
 * surface instead of an untestable inline branch. Returns { fail:true, error } for a provider with no
 * kernel-covered shape (fail-CLOSED — refuse an unvetted spawn rather than shell out a custom cfg.syntax).
 *
 * @param {string} providerName  openai | antigravity
 * @param {string} model
 * @param {string[]} reasoningArgs  pre-split reasoning-effort tokens (openai only; [] otherwise)
 * @param {object} [opts]  { prompt:string }  prompt is agy's -p VALUE
 * @returns {{ toolId, argv, usesStdin } | { fail:true, error }}
 */
function buildProviderArgv(providerName, model, reasoningArgs = [], opts = {}) {
  if (providerName === "openai") {
    // `codex exec --sandbox workspace-write [-c …] -m <model> -` — prompt on stdin.
    return { toolId: "codex", argv: ["exec", "--sandbox", "workspace-write", ...reasoningArgs, "-m", model, "-"], usesStdin: true };
  }
  if (providerName === "antigravity") {
    // agy (Antigravity CLI) — the SUNSET-gemini migration target (ED-060). Headless contract:
    // `agy --model <display-name> --print-timeout <dur> -p '<prompt>'`. The prompt is the `-p` argv
    // VALUE (agy has no stdin '-' positional), bounded + injection-checked + native-exe-only by
    // safe-spawn's agy ARG_POLICY carve-out (#27). usesStdin:false — the prompt rides -p, not stdin.
    // ED-060 slug→display: agy's `--model` resolves the DISPLAY name, not the catalog slug (a slug
    // silently defaults to CCPA → serves the WRONG model). Translate at THIS boundary via the ONE
    // catalog resolver (lazy require avoids a load-time cycle; the SAME resolver cert-attest#probeShape
    // uses — no second copy of the mapping).
    const agyModel = require("../../dispatch/catalog").agyModelName(model);
    // 90s default protects teammate frames (~2-min Bash cap — catalog.js note); a top-level frame
    // dispatching review-scale payloads needs longer before first output (2026-07-25: 31KB security
    // review died "timeout waiting for response" at 90s). Env override, validated against the same
    // duration grammar safe-spawn's ARG_POLICY enforces; malformed values fall back to 90s.
    const agyTimeoutRaw = mcEnv.readEnv("AGY_PRINT_TIMEOUT") || "90s";
    const agyTimeout = /^[0-9]+(ms|s|m|h)?$/.test(agyTimeoutRaw) ? agyTimeoutRaw : "90s";
    return { toolId: "agy", argv: ["--model", agyModel, "--print-timeout", agyTimeout, "-p", opts.prompt || ""], usesStdin: false };
  }
  // A manifest-overridden provider with a custom cfg.syntax has no ARG_POLICY entry in the safety
  // kernel → fail CLOSED rather than spawn an unvetted shell string.
  return {
    fail: true,
    error: `Provider "${providerName}" uses a custom cfg.syntax not covered by the dispatch safety kernel (safe-spawn ARG_POLICY). Add a tool-ID + arg-policy before dispatching — refusing an unvetted shell spawn.`,
  };
}

function runProvider(role, prompt, opts = {}) {
  // Bumped 2026-04-28 from 120s → 900s. xhigh reasoning + 175KB review prompts
  // routinely exceed 2 min on gpt-5.4; gemini-3.1 pro-preview with 90KB prompts
  // also timed out at 120s. 15 min is the new RAW bound for review-class workloads.
  // T-304 fix-cycle (claude backend lane, 2026-06-10): runProvider was the FOURTH
  // wrapper of NOTAGAIN audit G8 and the W0 build clamped only the other three —
  // a foreground runProvider at 900s outlives the 600s harness Bash kill, so its
  // death/quota record never gets written. Same fail-closed clamp as the wrappers:
  // foreground (or undetectable) → ≤540s; explicit background signal → full bound.
  const { foregroundAwareTimeout, WRAPPER_DEFAULTS } = require("../../dispatch/timeout-policy");
  const timeoutMs = foregroundAwareTimeout(
    opts.timeoutMs || WRAPPER_DEFAULTS["run-provider"],
    opts,
  );
  const strict = opts.strict !== false; // default ON — fail on silent downgrade
  // opts.provider forces a provider regardless of the role→provider manifest
  // mapping — used for a SECOND security pass on GPT:
  //   runProvider('redteam', prompt, { provider: 'openai', model: 'gpt-5.5' })
  // so security covers TWO model families (gemini + gpt). Falls back to the
  // manifest mapping when not set. Caller is responsible for normalization.
  const providerName = opts.provider || getProviderForRole(role);

  // Claude path — caller should dispatch via Agent tool, not this bridge
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

  // TEST seam (opts.cliAvailable): injectable CLI-availability probe so a HERMETIC test can force the
  // fail-closed BLOCKED-ON-OPERATOR path deterministically — the agy CLI may or may not be installed in
  // a given environment, and a test that assumes "absent" is non-deterministic (D6-TEST-002). Defaults
  // to the real cliAvailable; never passed in production.
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

  const model = opts.model || cfg.default_model;

  // Pre-flight: verify the model is available on this account. Saves a token
  // spend and a silent downgrade. Only enforces when strict mode is on.
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
    // Read prompt content directly — `cat file |` fails on Windows cmd.exe
    // (Node's default execSync shell). Passing the prompt as stdin via the
    // `input:` option is shell-agnostic and handles any file content.
    const promptContent = fs.readFileSync(promptFile, "utf8");

    // Reasoning-effort flag (per-role). `role` is bound from runProvider's
    // first positional arg in the enclosing scope. Empty string for providers
    // /roles that don't support an explicit flag — the resulting double-space
    // is harmless when the shell parses the command.
    const reasoningFlag = buildReasoningFlag(providerName, role);

    // ── Build the argv ARRAY (no shell string) for the safety kernel ──
    // safeSpawnSync resolves the tool-ID → realpath'd absolute exe (the model
    // never supplies the path), allowlists every flag/value (shell:false),
    // normalizes stdin (UTF-8/BOM/CRLF), and tree-kills on timeout. The codex +
    // gemini ARG_POLICY entries in safe-spawn.js were authored for exactly these
    // invocations. (PLAN §17.2 step-1 wire-through.)
    // The reasoning flag is a single string like "-c model_reasoning_effort=high"
    // → split into discrete argv tokens.
    const reasoningArgs = reasoningFlag
      ? reasoningFlag.split(/\s+/).filter(Boolean)
      : [];
    // D6: single-source the per-provider argv shape (openai + agy). agy carries the prompt as its `-p`
    // argv value (usesStdin:false) — every other provider streams it on stdin.
    const built = buildProviderArgv(providerName, model, reasoningArgs, {
      prompt: promptContent,
    });
    if (built.fail) {
      return { ok: false, provider: providerName, model, output: "", fallback: true, error: built.error };
    }
    const { toolId, argv, usesStdin } = built;

    // Phase 0 workstream C: capture stderr so silent zero-byte deaths leave
    // evidence. execSync only returns stdout; stderr is reachable only via the
    // thrown error's `.stderr` field in the catch branch. To preserve stderr
    // for both success AND failure paths we use spawnSync inline.
    //
    // 0.4.4 fix: with `encoding: "buffer"` Node requires `input` to be a
    // Buffer (not a string). Phase 0 shipped this combination with a string
    // input and threw "Unknown encoding: buffer" before the CLI ran —
    // silently breaking every diff-model review in adhoc + sprint flows.
    // Wrap promptContent in Buffer.from() so the stdin path matches the
    // stdout/stderr buffer treatment.
    // WG-15: dispatched gauntlet agents run `git diff` to review the change;
    // on a checkout owned by a different user than the sandbox runner, git
    // refuses with "dubious ownership" and the review tooling falls back or
    // fails. Inject safe.directory='*' via GIT_CONFIG_* env (process-scoped on
    // the child — NOT a global git-config mutation) so the agent's git just
    // works. Appends after any GIT_CONFIG_* entries the parent already set.
    const gitCfgIdx = parseInt(process.env.GIT_CONFIG_COUNT, 10) || 0;
    const childEnv = {
      ...process.env,
      GIT_CONFIG_COUNT: String(gitCfgIdx + 1),
      [`GIT_CONFIG_KEY_${gitCfgIdx}`]: "safe.directory",
      [`GIT_CONFIG_VALUE_${gitCfgIdx}`]: "*",
    };

    // agy (Antigravity) self-authenticates through its own ~/.gemini keyring
    // (oauth_creds.json) — dispatch injects NO provider key into the child env.
    // (The SUNSET individual gemini CLI's GEMINI_API_KEY injection + workspace-trust
    // env were removed with the deep-clean.)
    // ── Spawn through the dispatch SAFETY KERNEL (shell:false, arg-allowlisted,
    // tool resolved to abs path, tree-kill on timeout). Fail CLOSED if the kernel
    // can't be loaded — refuse the legacy shell:true spawn rather than silently
    // re-introduce the injection surface the wire-through closed.
    if (!safeSpawn) {
      const e = new Error(
        "dispatch safety kernel (scripts/dispatch/safe-spawn.js) unavailable — refusing the legacy shell:true spawn. Restore the module.",
      );
      e.kernelMissing = true;
      throw e;
    }
    // SP-20260723-002: mark the agy run-window START + snapshot the shared cli.log PRE-spawn so the
    // auth-fallback detector reads only THIS serve's DELTA (a stale tell from a prior serve, or a
    // concurrent agy process's rotation, must not false-RED/false-GREEN — DoE r1 finding #2). The
    // detector further pid-scopes the delta to this serve's child.pid.
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
      // D6: agy (usesStdin:false) carries its prompt as the `-p` argv value — passing it ALSO on
      // stdin would double-feed. Every other provider streams the prompt on stdin.
      input: usesStdin ? promptContent : undefined,
      timeoutMs,
      maxBuffer: 32 * 1024 * 1024, // 32MB for long review outputs
    });
    const stderrText = spawned.stderr || "";
    const stderrBytes = Buffer.byteLength(stderrText, "utf8");
    // safeSpawnSync classifies an arg/resolution refusal, a timeout/spawn reap,
    // a non-zero exit, AND a zero-byte-on-exit-0 (the false-green class) all as
    // !ok → throw so the existing quota-classify + claude-fallback path handles
    // every failure uniformly. (This is STRICTER than the old code, which
    // accepted exit-0-empty as success → a silent false-green.)
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

    // actual-model audit.
    // R2 COR-002: actualModel is the OBSERVED served model — it stays NULL unless the provider REPORTS
    // it. codex/OpenAI exposes no served-model header, so it stays null rather than echoing the REQUESTED
    // `model` (an echoed request is not an attestation). The agy (Antigravity) lane's served-model proof
    // is the cert-attest §7 honest-ceiling path, NOT this in-band unwrap. The requested value is retained
    // only in the returned `model` field.
    const output = rawOutput;
    const actualModel = null;

    // SP-20260723-002 / ADR-0037 — agy auth-fallback detection. An UNauthenticated agy serve (expired
    // keyring) exits 0 with output but writes its tells to the cli.log NOT stdout — so a naive record
    // false-greens fallback:false. POSITIVE-PROOF-ONLY + PID-SCOPED: read only THIS serve's cli.log
    // DELTA (pre/post snapshot, rotation-aware), scope to the spawned child.pid, and require a code-site
    // AUTH_SUCCESS to score clean; anything unprovable is "indeterminate" → dispatch-agent forces
    // fallback:true so the binding verdict routes to the verifiable openai/claude lane. stdout is NOT
    // scanned (DoE C4: a reviewer serve quoting a tell in its answer must not veto). NOTE: --log-file is
    // deliberately NOT used — it breaks agy's keyring auth (cert-attest ~L494, DoE-confirmed).
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

    // Strict assertion — detect silent downgrade.
    // actualModel comes from the CLI's own stats (authoritative); compare to requested.
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
      // SP-20260723-002: present ONLY for antigravity; true | "indeterminate" => an unauth/unverifiable
      // agy serve (dispatch-agent forces fallback:true). undefined for non-agy providers (no field).
      ...(authFallback !== undefined ? { auth_fallback: authFallback } : {}),
    };
  } catch (err) {
    // WI-18: detect a quota/429 failure and surface it LOUDLY rather than
    // returning a generic fallback that reads as a silent false-green. We keep
    // fallback:true (so the caller's existing claude/openai fallback still runs
    // — never weaken dispatch) but add quota:{...} so the caller can route the
    // security pass to openai deliberately, and we emit a one-line stderr notice
    // so the failure is visible in the dispatch log, not buried.
    const errText = String(
      (err && (err.stderr || err.message)) || err || "",
    );
    const quota = classifyQuotaFailure(errText);
    if (quota) {
      // T-20260610-306: mark the provider down in the circuit breaker so the NEXT
      // dispatch skips it instead of re-burning the quota window. Only for
      // quota_exhausted (recoverable=true) — the recoverable case the breaker
      // is designed for. Best-effort (providerBreaker is already fail-open).
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
          /* fail-open: breaker write failure must not block the error return */
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
        /* stderr unavailable */
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
              // Hint the caller toward the cross-family fallback. We never
              // auto-switch provider inside runProvider (that would mask the
              // failure); the caller decides, with this flag making it loud.
              suggestFallbackProvider: suggestFallbackProvider(providerName, cfg),
              // Auth mode label — VALUE-FREE (mode label only, never key value).
              // Surfaces "key (metered)" vs "oauth (plan)" so a quota error
              // envelope is self-diagnosing: one read and the posture is clear.
              auth_mode: detectAuthModeLabel(providerName),
            },
          }
        : {}),
    };
  } finally {
    // Cleanup temp file unless debugging
    if (!mcEnv.readEnv("PROVIDER_DEBUG")) {
      try {
        fs.unlinkSync(promptFile);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Parse a provider's output as JSON, falling back to extracting a ```json block.
 * Review agents typically return structured JSON; this normalizes that.
 */
function parseProviderJson(output) {
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    /* try code fence extraction */
  }
  const match = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    // Run-9 issue: reviewers occasionally leaked 1-2K prose before the JSON
    // fence despite explicit JSON-only constraints. Warn when the leak is
    // >500 chars so drift is visible before it compounds across a gauntlet.
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
      /* give up */
    }
  }
  return null;
}

/**
 * Strict model assertion — compares an envelope's stats.mode/model against
 * the manifest-declared expected model. Returns true when the expected model
 * is observed OR when the envelope doesn't report a mode (can't assert).
 * Returns false on silent fallback (e.g., Gemini 3.1-pro-preview → 2.5-pro,
 * 2026-04-17 learning). Caller should fail-closed on false.
 */
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
  buildProviderArgv, // D6 (SP-20260718-003): per-provider argv shape — assertable surface incl. agy
  getProviderForRole,
  getProviderConfig,
  getReasoningEffort,
  buildReasoningFlag,
  providerAvailable,
  parseProviderJson,
  assertStrictModel,
  // WI-18: exported for unit testing the quota classifier.
  classifyQuotaFailure,
  // WG-11(b): family-aware fallback — exported for unit testing the routing rule.
  suggestFallbackProvider,
  PROVIDER_FAMILY,
  DEFAULT_PROVIDERS,
  DEFAULT_AGENT_PROVIDERS,
  // Additive export (SP-20260720-003, α-approved): the raw LITERAL map (spreads SCRAPPED_PROVIDER_ALIASES),
  // INDEPENDENT of catalog's literal (which hardcodes redteam). security-binding-lane Tooth-B(1) compares the
  // two so the redteam alias floor can't silently fork. No behavior change.
  LITERAL_DEFAULT_AGENT_PROVIDERS,
  DEFAULT_REASONING_EFFORT,
};
