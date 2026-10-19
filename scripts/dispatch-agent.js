#!/usr/bin/env node

const mcEnv = require("./hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  runProvider,
  getProviderForRole,
  providerAvailable,
  parseProviderJson,
} = require("./hooks/lib/providers");
const { PATHS } = require("./hooks/lib/paths");
const {
  acquireSlotSync,
  releaseSlot,
} = require("./hooks/lib/concurrency-lock");
const { record: recordProviderTrace } = require("./agents/provider-trace");
const {
  startedRow,
  quotaField,
} = require("./dispatch/dispatch-record-fields");

const PROVIDER_TOOL_ID = { openai: "codex", antigravity: "agy" };
function providerToolId(provider) {
  return PROVIDER_TOOL_ID[provider] ?? provider;
}

function observedCompletionFields(requestedProvider, result) {
  const observedProvider = result && result.provider;
  const hasObserved = typeof observedProvider === "string" && observedProvider.length > 0;
  const provider = hasObserved ? observedProvider : requestedProvider;
  const isAgy = provider === "antigravity";
  const authFallback = isAgy ? (result && result.auth_fallback) : undefined;
  const authFallbackActive = authFallback !== undefined && authFallback !== false;
  const fallback = !!(result && (result.fallback || result.quotaFallbackFrom)) || !hasObserved || authFallbackActive;
  return {
    provider,
    tool_id: providerToolId(provider),
    fallback,
    ...(authFallback !== undefined ? { auth_fallback: authFallback } : {}),
  };
}

function resolveModelRunOpts({ providerOverride, modelOverride, roleModel }) {
  const runOpts = {};
  if (providerOverride) {
    runOpts.provider = providerOverride;
    if (modelOverride) runOpts.model = modelOverride;
  } else if (modelOverride) {
    runOpts.model = modelOverride;
  } else if (roleModel) {
    runOpts.model = roleModel;
  }
  return runOpts;
}

const AGENT_ROOT = path.resolve(__dirname, "..");
const AGENT_ROOT_NORM = path.normalize(AGENT_ROOT);
const VALID_MODES = new Set(["adhoc", "oneshot", "sprint", "solo"]);

function canonicalFile(pathsValue, relFallback) {
  if (pathsValue && path.isAbsolute(pathsValue)) {
    const norm = path.normalize(pathsValue);
    const rootPrefixMatch =
      process.platform === "win32"
        ? norm.toLowerCase().startsWith(AGENT_ROOT_NORM.toLowerCase() + path.sep) ||
          norm.toLowerCase() === AGENT_ROOT_NORM.toLowerCase()
        : norm.startsWith(AGENT_ROOT_NORM + path.sep) || norm === AGENT_ROOT_NORM;
    if (rootPrefixMatch) return pathsValue;
  }
  return path.join(AGENT_ROOT, relFallback);
}

function makeDispatchId() {
  return (
    "d-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex")
  );
}

function cmdlineChecksum(role, provider, promptBytes) {
  return (
    "sha256:" +
    crypto
      .createHash("sha256")
      .update(`${role}|${provider}|${promptBytes}|${process.argv.join(" ")}`)
      .digest("hex")
      .slice(0, 32)
  );
}

function runContext() {
  return {
    run_id: mcEnv.readEnv("RUN_ID") || null,
    phase_id: mcEnv.readEnv("PHASE_ID") || null,
    plan_item_id: mcEnv.readEnv("PLAN_ITEM_ID") || null,
    sprint_id: mcEnv.readEnv("SPRINT_ID") || null,
  };
}

function promptDigest(promptBufOrStr) {
  try {
    const buf = Buffer.isBuffer(promptBufOrStr)
      ? promptBufOrStr
      : Buffer.from(String(promptBufOrStr), "utf8");
    return "sha256:" + crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

function outputDigest(outBufOrStr) {
  try {
    const s = Buffer.isBuffer(outBufOrStr)
      ? outBufOrStr.toString("utf8")
      : String(outBufOrStr == null ? "" : outBufOrStr);
    if (!s.trim()) return null;
    return "sha256:" + crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

function argvSchemaVersion() {
  try {
    return require("./dispatch/dispatch-contract").ARGV_SCHEMA_VERSION || "1";
  } catch {
    return "1";
  }
}

function ensureDir(p) {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch {
  }
}

function appendJsonl(file, record) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
  }
}

function ledgerFile(pathsValue, relFallback) {
  const testDir = process.env.DISPATCH_LEDGER_DIR;
  if (testDir) return path.join(testDir, path.basename(relFallback));
  return canonicalFile(pathsValue, relFallback);
}

let _cachedCodeSha;
function currentCodeSha() {
  if (_cachedCodeSha !== undefined) return _cachedCodeSha;
  try {
    _cachedCodeSha = require("./dispatch/git-head").readGitHead(AGENT_ROOT) || "";
  } catch {
    _cachedCodeSha = "";
  }
  return _cachedCodeSha;
}

function completionsLedgerFile() {
  return ledgerFile(
    PATHS.dispatchCompletionsFile,
    path.join(".claude", "runtime", "dispatch-completions.jsonl"),
  );
}

function recordDispatchStart(fields) {
  try {
    const row = startedRow(fields);
    appendJsonl(completionsLedgerFile(), row);
  } catch (e) {
    try {
      process.stderr.write(`[recordDispatchStart] skipped (fail-open): ${e && e.message}\n`);
    } catch {
    }
  }
}

function recordCompletion(record) {
  const file = completionsLedgerFile();
  const derivedRun = mcEnv.readEnv("PANEL_RUN_ID") || null;
  const derivedSha = currentCodeSha() || null;
  const callerRun = record.panel_run_id;
  const callerSha = record.code_sha;
  const runMismatch = callerRun != null && callerRun !== "" && derivedRun != null && callerRun !== derivedRun;
  const shaMismatch = callerSha != null && callerSha !== "" && derivedSha != null && callerSha !== derivedSha;
  const enriched = { ...record, panel_run_id: derivedRun, code_sha: derivedSha };
  if (!enriched.quota || typeof enriched.quota !== "object") {
    try {
      enriched.quota = quotaField(enriched.provider || null).quota;
    } catch {
    }
  }
  if (runMismatch || shaMismatch) {
    enriched.provenance_mismatch = true;
    try { process.stderr.write(`[recordCompletion] provenance mismatch (caller panel_run_id/code_sha != writer-derived) — record written UNSIGNED, cannot attest\n`); } catch { }
    appendJsonl(file, enriched);
    return;
  }
  if (enriched.dispatch_id != null && typeof enriched.dispatch_id !== "string") {
    enriched.dispatch_id_type_invalid = true;
    try { process.stderr.write(`[recordCompletion] non-string dispatch_id (${typeof enriched.dispatch_id}) — record written UNSIGNED, cannot attest\n`); } catch { }
    appendJsonl(file, enriched);
    return;
  }
  try {
    const sig = require("./dispatch/attest-signing").signRecord(enriched);
    if (sig) enriched.attest_sig = sig;
  } catch { }
  appendJsonl(file, enriched);
}

function recordDeath(record) {
  const file = ledgerFile(
    PATHS.dispatchDeathsFile,
    path.join(".claude", "runtime", "dispatch-deaths.jsonl"),
  );
  appendJsonl(file, record);
}

function readModeFromProjectRoot(root) {
  try {
    const p = path.join(root, ".claude", "runtime", "mode.json");
    if (!fs.existsSync(p)) return null;
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const mode = String((doc && doc.mode) || "").toLowerCase();
    return VALID_MODES.has(mode) ? mode : null;
  } catch {
    return null;
  }
}

function detectMode() {
  const explicit = mcEnv.readEnv("MODE");
  if (explicit && VALID_MODES.has(String(explicit).toLowerCase()))
    return String(explicit).toLowerCase();
  const envRoot = process.env.CLAUDE_PROJECT_DIR
    ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
    : null;
  const roots = [];
  if (envRoot) roots.push(envRoot);
  roots.push(AGENT_ROOT);
  for (const root of roots) {
    const mode = readModeFromProjectRoot(root);
    if (mode) return mode;
  }
  try {
    const storePaths = [
      PATHS.oneshotStore,
      path.join(AGENT_ROOT, ".claude", "agents", "president", "_system", "oneshot", "store.json"),
      path.join(AGENT_ROOT, ".claude", "agents", "president", ".system", "oneshot", "store.json"),
    ].filter(Boolean);
    for (const storePath of storePaths) {
      if (fs.existsSync(storePath)) {
        const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
        if (store && store.status === "running") return "oneshot";
      }
    }
  } catch {
  }
  return "adhoc";
}

function modeSubdir() {
  return null;
}

function specMatchesRole(filePath, role) {
  try {
    const body = fs.readFileSync(filePath, "utf8");
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      const nameMatch = fmMatch[1].match(/^name:\s*(\S+)/m);
      if (nameMatch && nameMatch[1] === role) return true;
    }
  } catch {
  }
  return false;
}

function tryDirect(role, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (fs.existsSync(c)) {
      if (specMatchesRole(c, role)) return c;
      const stem = path.basename(c).replace(/\.md$/, "");
      if (stem === role) return c;
    }
  }
  return null;
}

function findAgentSpec(role) {
  const agentsDir =
    PATHS.agents || path.join(PATHS.claudeDir || ".claude", "agents");
  if (!fs.existsSync(agentsDir)) return null;

  const face = tryDirect(role, path.join(agentsDir, "president", `${role}.md`));
  if (face) return face;

  const NEW_TREE = ["president", "engineering", "product", "growth", "_system"];
  const LEGACY_TREE = ["00-alex", "01-adhoc", "02-oneshot", "03-managers"];
  const matches = [];
  const stack = [agentsDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile() && ent.name.endsWith(".md")) {
        const stem = ent.name.replace(/\.md$/, "");
        const nameMatch = specMatchesRole(full, role);
        if (nameMatch || stem === role) {
          matches.push({ full, byName: nameMatch, stem });
        }
      }
    }
  }
  if (matches.length === 0) return null;
  const rel = (p) => path.relative(agentsDir, p).split(path.sep);
  const inTree = (p, roots) => roots.includes(rel(p)[0]);
  const rank = (m) =>
    (m.byName ? 0 : 2) + (inTree(m.full, NEW_TREE) ? 0 : inTree(m.full, LEGACY_TREE) ? 1 : 0.5);
  matches.sort((a, b) => rank(a) - rank(b));
  return matches[0].full;
}

function getRoleModel(role) {
  const spec = findAgentSpec(role);
  if (!spec) return null;
  try {
    const body = fs.readFileSync(spec, "utf8");
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const m = fmMatch[1].match(/^provider_model:\s*(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

if (require.main !== module) {
  module.exports = {
    findAgentSpec,
    providerToolId,
    observedCompletionFields,
    resolveModelRunOpts,
    getRoleModel,
    detectMode,
    readModeFromProjectRoot,
    modeSubdir,
    canonicalFile,
    AGENT_ROOT,
    recordCompletion,
    recordDeath,
    recordDispatchStart,
    makeDispatchId,
    cmdlineChecksum,
    runContext,
    promptDigest,
    outputDigest,
    argvSchemaVersion,
  };
  return;
}

const [, , role, promptArg, ...restArgs] = process.argv;

function parseFlag(name) {
  const i = restArgs.indexOf(name);
  return i >= 0 && restArgs[i + 1] ? restArgs[i + 1] : null;
}
const PROVIDER_ALIAS = {
  anthropic: "claude",
  claude: "claude",
  openai: "openai",
  gpt: "openai",
  google: "antigravity",
  antigravity: "antigravity",
  agy: "antigravity",
};
const rawProviderOverride = parseFlag("--provider");
const providerOverride = rawProviderOverride
  ? PROVIDER_ALIAS[rawProviderOverride.toLowerCase()] ||
    rawProviderOverride.toLowerCase()
  : null;
const modelOverride = parseFlag("--model");
const domainFlag = parseFlag("--domain");

if (!role || !promptArg) {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        "Usage: node scripts/dispatch-agent.js <role> <prompt-file | '-' for stdin>",
    }),
  );
  process.exit(2);
}

try {
  const { deriveBinding } = require("./dispatch/role-resolver");
  const __b = deriveBinding({ channel: "dispatch-agent", role });
  mcEnv.setEnv("ACTOR_KIND", __b.actor_kind || "dispatched_worker");
  if (__b.ok && __b.boundRole) mcEnv.setEnv("BOUND_ROLE", __b.boundRole);
  if (!__b.ok && __b.failClosed) {
    console.error(
      JSON.stringify({ ok: false, error: `role-binding REFUSED (fail-closed, CORE-1): ${__b.reason}` }),
    );
    process.exit(2);
  } else if (!__b.ok) {
    process.stderr.write(`[dispatch-agent] role-binding advisory (benign, not President-leak): ${__b.reason}\n`);
  }
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: `role-resolver unavailable — REFUSING dispatch (fail-closed): ${e.message}` }));
  process.exit(2);
}

let prompt = "";
if (promptArg === "-") {
  prompt = fs.readFileSync(0, "utf8");
} else {
  if (!fs.existsSync(promptArg)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: `Prompt file not found: ${promptArg}`,
      }),
    );
    process.exit(2);
  }
  prompt = fs.readFileSync(promptArg, "utf8");
}

if (!prompt.trim()) {
  console.error(JSON.stringify({ ok: false, error: "Empty prompt" }));
  process.exit(2);
}

const provider = providerOverride || getProviderForRole(role);
const promptBytes = Buffer.byteLength(prompt, "utf8");

const dispatchId = makeDispatchId();
const dispatchStartedAt = new Date().toISOString();
const dispatchStartedMs = Date.now();
const cmdChecksum = cmdlineChecksum(role, provider, promptBytes);

if (provider === "claude") {
  console.error(
    JSON.stringify({
      ok: false,
      provider: "claude",
      role,
      error:
        "Provider is Claude — dispatch natively via Claude Code Agent tool or `claude -p --agent " +
        role +
        "`. This bridge handles OpenAI and Gemini only.",
    }),
  );
  process.exit(2);
}

let contractMod = null;
try {
  contractMod = require("./dispatch/dispatch-contract");
} catch (e) {
  process.stderr.write(`[dispatch-agent] dispatch-contract module unloadable — failing OPEN (advisory only; set MC_DISPATCH_CONTRACT_ENFORCE=off to silence): ${e && e.message}\n`);
}
if (contractMod) {
  const { validateDispatch, contractEnforceMode } = contractMod;
  let normalizeRole = (r) => r;
  try { normalizeRole = require("./hooks/lib/role-aliases").normalizeRole || normalizeRole; } catch { }
  const currentMode = detectMode();
  const blocking = contractEnforceMode("DISPATCH_AGENT", process.env);
  let verdict;
  try {
    verdict = validateDispatch({
      role: normalizeRole(role),
      shape: "subprocess-cross-provider",
      toolId: providerToolId(provider),
      mode: currentMode,
    });
  } catch (evalErr) {
    process.stderr.write(`[dispatch-agent] dispatch-contract EVALUATION error — ${blocking ? "failing CLOSED" : "advisory"}: ${evalErr && evalErr.message}\n`);
    if (blocking) {
      console.log(JSON.stringify({ ok: false, provider, role, error: "dispatch_contract_eval_error" }));
      process.exit(1);
    }
    verdict = { ok: true, violations: [] };
  }
  if (verdict && !verdict.ok) {
    process.stderr.write(
      `[dispatch-agent] dispatch-contract ${blocking ? "VIOLATION" : "advisory"}: ${verdict.violations.join("; ")}\n`,
    );
    if (blocking) {
      console.log(JSON.stringify({ ok: false, provider, role, error: "dispatch_contract_violation", violations: verdict.violations }));
      process.exit(1);
    }
  }
}

try {
  const { shapeDoor } = require("./dispatch/dispatch-shape");
  const killThis = /^(report|off|0)$/i.test(String(mcEnv.readEnv("SHAPE_DOOR_DISPATCH_AGENT") || ""));
  const door = shapeDoor("subprocess-cross-provider", { kind: "agent", id: role }, process.env, killThis ? { reportOnlyPin: true } : { enforceDefault: true });
  if (door.mismatch && door.mismatch.mismatch && !door.suppressed) {
    process.stderr.write(
      `[dispatch-agent] shape-resolver ${door.action === "refuse" ? `VIOLATION (${door.mode})` : "advisory"}: role '${role}' dispatched as 'subprocess-cross-provider' but the resolver picks '${door.mismatch.expected}' (${door.mismatch.expectedReason || door.mismatch.reason}; severity=${door.mismatch.severity || "medium"}).\n`,
    );
  }
  if (door.action === "refuse") {
    console.log(JSON.stringify({ ok: false, provider, role, error: "dispatch_shape_mismatch", expected: door.mismatch.expected, actual: "subprocess-cross-provider", severity: door.mismatch.severity }));
    process.exit(2);
  }
} catch {
}

if (!providerAvailable(provider)) {
  recordProviderTrace({
    role,
    expectedProvider: provider,
    actualProvider: "claude",
    fellBack: true,
    fallbackReason: `Provider ${provider} CLI not available`,
    promptBytes,
    ok: false,
  });
  console.log(
    JSON.stringify({
      ok: false,
      provider,
      role,
      fallback: true,
      error: `Provider ${provider} CLI not available. Falling back to Claude — caller should dispatch via \`claude -p --agent ${role}\`.`,
    }),
  );
  process.exit(1);
}

const propagatedBoundRaw = process.env.DISPATCH_BUILDER_TIMEOUT_MS;
const propagatedChildBaseMs =
  propagatedBoundRaw != null && propagatedBoundRaw !== ""
    ? (() => {
        const { foregroundAwareTimeout } = require("./dispatch/timeout-policy");
        const n = parseInt(propagatedBoundRaw, 10);
        return Number.isFinite(n) ? foregroundAwareTimeout(n, {}) : null;
      })()
    : null;

const slotTimeoutMs =
  propagatedChildBaseMs != null
    ? propagatedChildBaseMs
    : parseInt(process.env.DISPATCH_SLOT_TIMEOUT_MS || `${10 * 60 * 1000}`, 10);
const slot = acquireSlotSync(provider, {
  timeoutMs: slotTimeoutMs,
  meta: {
    dispatch_id: dispatchId,
    role,
    provider,
    prompt_bytes: promptBytes,
    cmdline_checksum: cmdChecksum,
  },
});
if (!slot) {
  recordProviderTrace({
    role,
    expectedProvider: provider,
    actualProvider: "claude",
    fellBack: true,
    fallbackReason: `Provider ${provider} concurrency cap full after ${slotTimeoutMs}ms`,
    promptBytes,
    ok: false,
  });
  console.log(
    JSON.stringify({
      ok: false,
      provider,
      role,
      fallback: true,
      error: `Provider ${provider} concurrency cap full after ${slotTimeoutMs}ms — falling back to Claude. Tune via ${provider.toUpperCase()}_MAX_CONCURRENCY env var.`,
    }),
  );
  process.exit(1);
}

recordDispatchStart({
  role,
  provider,
  dispatch_id: dispatchId,
  started_at: dispatchStartedAt,
  sprint_id: runContext().sprint_id,
});

let result;
try {
  const roleModel = getRoleModel(role);
  const withPropagatedTimeout = (opts) =>
    propagatedChildBaseMs != null ? { ...opts, timeoutMs: propagatedChildBaseMs } : opts;
  const runOpts = resolveModelRunOpts({ providerOverride, modelOverride, roleModel });
  result = runProvider(role, prompt, withPropagatedTimeout(runOpts));

  if (
    result &&
    !result.ok &&
    result.quota &&
    !providerOverride &&
    !modelOverride &&
    result.provider &&
    result.provider !== "claude"
  ) {
    const fbProvider = result.quota.suggestFallbackProvider || "openai";
    if (fbProvider !== "claude") {
      process.stderr.write(
        `[dispatch-agent] quota fallback: ${role} ${result.provider}` +
          ` (${result.quota.kind}) → retrying on ${fbProvider} for cross-family` +
          ` security coverage (1 attempt).\n`,
      );
      const retry = runProvider(role, prompt, withPropagatedTimeout({ provider: fbProvider }));
      if (retry && retry.ok) {
        retry.quotaFallbackFrom = {
          provider: result.provider,
          model: result.model || null,
          kind: result.quota.kind,
        };
        result = retry;
      }
    }
  }

  result.role = role;
  if (roleModel) result.specModel = roleModel;
  const parsed = parseProviderJson(result.output);
  if (parsed) result.parsed = parsed;
  recordProviderTrace({
    role,
    domain: domainFlag || null,
    expectedProvider: provider,
    actualProvider: result.provider || provider,
    model: result.model || roleModel || null,
    fellBack: !!result.fallback,
    fallbackReason: result.error || null,
    promptBytes,
    ok: result.ok,
  });

  const stdoutBytes = result.output
    ? Buffer.byteLength(String(result.output), "utf8")
    : 0;
  const stderrBytes = result.stderrBytes || 0;
  const completedAt = new Date().toISOString();
  const completedMs = Date.now();
  const elapsedMs = completedMs - dispatchStartedMs;
  const observedRec = observedCompletionFields(provider, result);
  const knownQuota = result && result.quota
    ? {
        auth_mode: result.quota.auth_mode,
        note: `${result.quota.kind}${result.quota.recoverable === false ? " (unrecoverable)" : ""}`,
        source: "runProvider.result.quota",
      }
    : {};
  recordCompletion({
    dispatch_id: dispatchId,
    pid: process.pid,
    role,
    domain: domainFlag || null,
    provider: observedRec.provider,
    model: result.model || roleModel || null,
    started_at: dispatchStartedAt,
    completed_at: completedAt,
    elapsed_ms: elapsedMs,
    prompt_bytes: promptBytes,
    cmdline_checksum: cmdChecksum,
    exit_code: result.ok ? 0 : 1,
    stdout_bytes: stdoutBytes,
    stderr_bytes: stderrBytes,
    fallback: observedRec.fallback,
    ...(observedRec.auth_fallback !== undefined ? { auth_fallback: observedRec.auth_fallback } : {}),
    ok: !!result.ok,
    ...runContext(),
    prompt_digest: promptDigest(prompt),
    shape: "subprocess-cross-provider",
    tool_id: observedRec.tool_id,
    ...(result && result.tool_path
      ? {
          tool_path: result.tool_path,
          tool_version: result.tool_version ?? null,
          tool_choice: result.tool_choice ?? null,
          ...(result.tool_alternatives ? { tool_alternatives: result.tool_alternatives } : {}),
        }
      : {}),
    argv_schema_version: argvSchemaVersion(),
    cwd: AGENT_ROOT,
    output_digest: outputDigest(result.output),
    quota: quotaField(observedRec.provider, knownQuota).quota,
  });

  if (!result.ok && stdoutBytes === 0 && stderrBytes === 0) {
    recordDeath({
      dispatch_id: dispatchId,
      timestamp: completedAt,
      pid: process.pid,
      role,
      domain: domainFlag || null,
      provider,
      model: result.model || roleModel || null,
      prompt_bytes: promptBytes,
      cmdline_checksum: cmdChecksum,
      exit_code: null,
      stdout_bytes: 0,
      stderr_bytes: 0,
      last_stdout_mtime: null,
      last_stderr_mtime: null,
      reason: "silent_zero_byte_death",
      hint: result.error || null,
    });
  }
} finally {
  releaseSlot(slot);
}

console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
