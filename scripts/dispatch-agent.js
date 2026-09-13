#!/usr/bin/env node
/**
 * dispatch-agent.js — Cross-provider agent dispatch.
 *
 * Used by γ (adhoc orchestrator) and δ (oneshot orchestrator) to dispatch
 * review-layer and security agents that run on GPT (codex) or the Gemini family
 * via Antigravity (agy) instead of Claude.
 *
 * Usage:
 *   node scripts/dispatch-agent.js <role> <prompt-file>
 *   node scripts/dispatch-agent.js <role> -              # read prompt from stdin
 *
 * Reads manifest.agentProviders[<role>] to determine provider:
 *   - "claude"       → errors (caller should dispatch natively via Claude Code Agent tool or `claude -p`)
 *   - "openai"       → shells out to `codex` (prompt on stdin)
 *   - "antigravity"  → shells out to `agy` (prompt on the `-p` argv value; the sunset-`gemini`-CLI migration target, ADR-0031)
 *
 * Output on stdout:
 *   JSON: { ok, provider, model, role, output, fallback?, error? }
 *
 * Exit codes:
 *   0 — provider call succeeded
 *   1 — provider unavailable or errored; caller should retry via Claude fallback
 *   2 — usage / config error
 *
 * Example (from gamma's bash dispatch):
 *   node scripts/dispatch-agent.js evaluator /tmp/eval-prompt.txt
 */

const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
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
// BE-2 (SP-20260718-005 / ED-069 + ED-070): the pure started-row builder + the
// quota-fragment builder. Both are wired here (the single recordCompletion
// sink + a new recordDispatchStart wrapper) so dispatch-claude.js and
// epsilon-runtime.js — which already import recordCompletion from this file —
// inherit the same fields with zero per-caller duplication.
const {
  startedRow,
  quotaField,
} = require("./dispatch/dispatch-record-fields");

// ── provider-id → tool-id (D2, SP-20260718-003 / I-2) ────────────────────────
// The dispatch CONTRACT keys on tool-id (`codex`/`agy`; `gemini` is the SUNSET tool-id per ADR-0031 —
// the live Gemini-family route is provider `antigravity` → tool `agy`); callers speak provider-id
// (`openai`/`antigravity`). ONE map, used at BOTH the validate call and the completion record — an
// inlined ternary that omitted `antigravity`→`agy` tripped dispatch-contract on security-reviewer.
// Refactor-hygiene: replace EVERY occurrence, not just the one you remember.
const PROVIDER_TOOL_ID = { openai: "codex", antigravity: "agy" };
function providerToolId(provider) {
  return PROVIDER_TOOL_ID[provider] ?? provider;
}

// ── OBSERVED completion fields (C2, SP-20260718-003 / D2-FALSE-GREEN-001 · SR-004/QA-002) ────────────
// The completion record must reflect what ACTUALLY ran, never what was requested. On a quota-fallback
// (a contracted lab is down → runProvider retries on another lab and returns it as result.provider with
// result.quotaFallbackFrom set), stamping the REQUESTED provider/tool_id with fallback:false lets an
// openai run masquerade as an observed-agy record — which cert-attest then accepts as agy evidence (the
// binding false-green the security lane reproduced). PURE + exported so the shaping is a tested surface.
//   provider  = the observed lab (result.provider), falling back to the requested provider when absent
//   tool_id   = providerToolId of the OBSERVED provider (openai→codex, not the requested agy)
//   fallback  = true if runProvider fell back OR a quota-fallback ran another lab (contracted lab didn't run)
function observedCompletionFields(requestedProvider, result) {
  // R2-D (D2-FALSE-GREEN-003): a MISSING observed provider (result carries no provider identity) cannot
  // honestly attest the contracted lab. The old `|| requestedProvider` fallback stamped the requested
  // provider with fallback:false → an identity-less dispatch false-attested (e.g. agy). Now: use the
  // observed provider when present; when ABSENT, stamp the requested provider for traceability but force
  // fallback:true so the record is UNATTESTABLE (cert-attest requires fallback:false). No false-green.
  const observedProvider = result && result.provider;
  const hasObserved = typeof observedProvider === "string" && observedProvider.length > 0;
  const provider = hasObserved ? observedProvider : requestedProvider;
  // SP-20260723-002 / ADR-0037 — agy AUTH-fallback, DISTINCT from provider/quota fallback. runProvider
  // sets result.auth_fallback for an antigravity serve: true (a TERMINAL not-logged-in/eval/default tell
  // in the run window) or "indeterminate" (the cli.log was unverifiable → fail-closed). Either forces
  // fallback:true so the binding verdict routes to the verifiable openai/claude lane — an unauthenticated
  // agy serve can NEVER stamp fallback:false again (the exact false-green this closes; the record's
  // fallback logic previously saw only provider/quota fallback, never agy's INTERNAL auth-fallback). The
  // explicit auth_fallback field is stamped on every agy serve so downstream (cert-attest, the ED-060(c)
  // close, gauntlet-verify --strict-fallback) can tell an AUTH fallback apart from a provider fallback (ADR-0025).
  // agy-ONLY invariant (backend r1 LOW #4): auth_fallback is meaningful ONLY on the antigravity lane
  // (runProvider sets it there and nowhere else). Honor + stamp it ONLY when the RESOLVED provider is
  // antigravity — a stray auth_fallback riding a non-agy result is ignored (defense in depth). Under an
  // agy→openai provider-fallback the resolved provider is openai and no auth_fallback is present anyway.
  const isAgy = provider === "antigravity";
  const authFallback = isAgy ? (result && result.auth_fallback) : undefined;
  // FAIL-CLOSED: any PRESENT non-false auth_fallback value forces fallback:true (not a whitelist of
  // true|"indeterminate") — so a future detector sentinel (e.g. an "error" state) cannot fail-OPEN.
  const authFallbackActive = authFallback !== undefined && authFallback !== false;
  const fallback = !!(result && (result.fallback || result.quotaFallbackFrom)) || !hasObserved || authFallbackActive;
  return {
    provider,
    tool_id: providerToolId(provider),
    fallback,
    ...(authFallback !== undefined ? { auth_fallback: authFallback } : {}),
  };
}

// ── model/provider run-opts resolution (D4, SP-20260718-003 / ED-205 regression guard) ──
// ED-205 is RESOLVED / correct-by-design — inventing a "fix" would create a PHANTOM regression.
// The run-opts a dispatch passes to runProvider are a pure function of three inputs (an explicit
// --provider override, an explicit --model override, and the role's registry model getRoleModel).
// The BINDING semantics (do NOT change):
//   - no override            → the role's native provider_model applies (runProvider uses roleModel);
//   - --provider X (no -m)   → the spec model belongs to the WRONG provider → DROPPED; the override
//                              provider's own default is used;
//   - --provider X --model Y → both forced;
//   - --model Y only         → force the model on the native provider.
// Extracted PURE (behavior-IDENTICAL to the prior inline block at the runProvider call site) so the
// ED-205 semantics are a tested surface, not an untestable inline branch. Regression teeth:
// scripts/dispatch-agent-model-semantics.test.js (3 cases).
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

// ── Canonical root anchor (AC2 / ED-016 / class-#20 fix) ──
//
// AGENT_ROOT is resolved from THIS FILE'S location (__dirname), NOT from
// process.cwd() or CLAUDE_PROJECT_DIR. This is the key fix for the worktree
// telemetry cwd bug:
//
//   Root cause: PATHS is built from `path.resolve(CLAUDE_PROJECT_DIR || ".")`
//   in scripts/hooks/lib/paths.js. When a build-chain agent is dispatched with
//   cwd=<worktree> AND CLAUDE_PROJECT_DIR is unset, PROJECT bends to the
//   worktree, so PATHS.runtime points at worktree/.claude/runtime. The
//   completion record lands in the worktree; gauntlet-verify reads canonical's
//   path → false "no-record" (confirmed live: all 11 records landed in worktree).
//
//   Fix: this script lives at scripts/dispatch-agent.js. Its module location is
//   IMMUTABLE (cwd-independent). AGENT_ROOT = path.resolve(__dirname, "..") is
//   ALWAYS the root of the repo containing THIS file — canonical or consumer,
//   never a worktree regardless of cwd.
//
// canonicalFile() uses AGENT_ROOT as the primary anchor. It prefers the PATHS
// value only when PATHS has resolved to a path that is under AGENT_ROOT (i.e.
// CLAUDE_PROJECT_DIR was set correctly to the same root). When PATHS bends to
// a different root (worktree case), the __dirname-anchored fallback is used.
// The net invariant: telemetry NEVER lands at a cwd-relative path.

const AGENT_ROOT = path.resolve(__dirname, "..");
const AGENT_ROOT_NORM = path.normalize(AGENT_ROOT);
const VALID_MODES = new Set(["adhoc", "oneshot", "sprint", "solo"]);

/**
 * Resolve a telemetry file path, anchored to AGENT_ROOT.
 *
 * @param {string|undefined} pathsValue  - value from PATHS registry (may be
 *   absolute but resolve to a worktree path when cwd-bent)
 * @param {string} relFallback           - relative path from AGENT_ROOT to use
 *   when pathsValue is absent or outside AGENT_ROOT
 * @returns {string} absolute path guaranteed to be under AGENT_ROOT
 */
function canonicalFile(pathsValue, relFallback) {
  if (pathsValue && path.isAbsolute(pathsValue)) {
    const norm = path.normalize(pathsValue);
    // Accept PATHS value only when it resolves within the same root as this
    // script (case-insensitive on Windows). This covers the correct case
    // (CLAUDE_PROJECT_DIR explicitly set to the canonical root) without
    // accepting a worktree-bent path.
    const rootPrefixMatch =
      process.platform === "win32"
        ? norm.toLowerCase().startsWith(AGENT_ROOT_NORM.toLowerCase() + path.sep) ||
          norm.toLowerCase() === AGENT_ROOT_NORM.toLowerCase()
        : norm.startsWith(AGENT_ROOT_NORM + path.sep) || norm === AGENT_ROOT_NORM;
    if (rootPrefixMatch) return pathsValue;
  }
  // Fall back to __dirname-anchored canonical path — cwd-independent.
  return path.join(AGENT_ROOT, relFallback);
}

// ── Telemetry helpers (Phase 0 workstream C) ──────────────
//
// Every dispatch gets a unique dispatch_id. Completion + silent-death markers
// are persisted to durable JSONL files under .claude/runtime/ so a post-mortem
// can answer "did the process actually run and produce nothing, or was it
// pre-empted before runProvider returned?". Fail-open everywhere — never let
// telemetry crash an otherwise-successful dispatch.

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

// N-1 (PLAN §17.4): run-context fields stamped onto every completion record so the
// coverage gate (scripts/dispatch/coverage-gate.js) can prove a phase's CLAIMED
// roles ACTUALLY dispatched under the same run — killing "sprint theater" (a
// coverage row with no backing dispatch). Sourced from the orchestrator's env;
// null when dispatched ad-hoc (a null run_id simply can't satisfy a run-scoped
// coverage check, which is the correct fail-closed behavior).
// T-303 (N8): sprint_id added as the SINGLE SOURCE for env-read — all three
// wrappers (dispatch-agent, dispatch-claude, dispatch-skill) already spread
// ...runContext() into the completion record, so extending this function is
// enough to propagate sprint_id uniformly with no per-wrapper duplication.
function runContext() {
  return {
    run_id: mcEnv.readEnv("RUN_ID") || null,
    phase_id: mcEnv.readEnv("PHASE_ID") || null,
    plan_item_id: mcEnv.readEnv("PLAN_ITEM_ID") || null,
    sprint_id: mcEnv.readEnv("SPRINT_ID") || null,
  };
}

// Digest of the prompt — proof-of-content for the §17.4 coverage record: a record
// is tied to the exact spec it ran, not just "a role ran". Accepts a Buffer or a
// string; fail-soft to null.
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

// Digest of the produced OUTPUT — §17.4 proof-of-artifact: a coverage record must
// prove it produced non-trivial output, not merely that "a role ran". Returns null
// for empty/whitespace output, so the coverage gate can detect blind/unproven
// coverage (an ok:true record with no real artifact behind it). Buffer or string.
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

// §17.4 argv/stamp schema version — sourced from the dispatch keystone (one source
// of truth). Fail-soft so a contract-read hiccup never crashes a live dispatch.
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
    /* ignore */
  }
}

function appendJsonl(file, record) {
  try {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch {
    /* fail-open — telemetry never blocks dispatch */
  }
}

// TEST-ONLY isolation seam: when DISPATCH_LEDGER_DIR is set (never in
// production), completion/death records redirect there so a test can exercise
// the real dispatch path without polluting the canonical ledger. This is an
// EXPLICIT opt-in env — it does NOT re-open ED-016 (which was the IMPLICIT
// cwd-bending bug). Unset → behaviour is byte-identical to canonicalFile().
function ledgerFile(pathsValue, relFallback) {
  const testDir = process.env.DISPATCH_LEDGER_DIR;
  if (testDir) return path.join(testDir, path.basename(relFallback));
  return canonicalFile(pathsValue, relFallback);
}

// Execution-time code SHA — the git HEAD the dispatch actually ran against. Cached per-process (a
// dispatch never rewrites HEAD mid-run). Read via fs (NO subprocess — QA-012: a nested spawn is
// EPERM-blocked in the CI/reviewer sandbox, which made code_sha null and the attestation inoperable
// there). Empty on a non-git install → attestation blocks (fail-closed).
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

// ED-069 (BE-2): the SAME canonical ledger file recordCompletion writes to —
// factored out so recordDispatchStart() (below) and recordCompletion() never
// diverge on path resolution (both call this, not a second copy of
// canonicalFile/ledgerFile args).
function completionsLedgerFile() {
  return ledgerFile(
    PATHS.dispatchCompletionsFile,
    path.join(".claude", "runtime", "dispatch-completions.jsonl"),
  );
}

/**
 * ED-069 write-ahead started-row. Call BEFORE the provider/CLI spawn so a
 * dispatch that dies mid-flight (reap/hang/crash) leaves POSITIVE evidence it
 * was attempted, in the SAME ledger recordCompletion writes to. Never a valid
 * completion (phase:"started", ok:false — gauntlet-verify's
 * isWellFormedOkRecord requires ok===true), so it can never be mistaken for a
 * "ran" record; it correlates to its eventual completion by dispatch_id
 * (dispatch-record-fields#startedRowSuperseded).
 *
 * Deliberately uses appendJsonl (the SAME raw writer recordCompletion/
 * recordDeath already use), NOT dispatch-record-fields#appendRecord — that
 * helper's write-time rotation is out of scope for this wiring change (BE-2
 * wires started-row + quota fields, not "activate ledger rotation for the
 * first time"; rotating a real over-cap production ledger is an operational
 * decision that deserves its own review, not a side effect of composing two
 * library functions). Fail-open: telemetry must never crash or block a live
 * dispatch — a bad `fields` shape (missing role/provider) is a caller bug and
 * is swallowed here with a stderr note, exactly like recordCompletion's own
 * signing-failure fail-open above.
 */
function recordDispatchStart(fields) {
  try {
    const row = startedRow(fields);
    appendJsonl(completionsLedgerFile(), row);
  } catch (e) {
    try {
      process.stderr.write(`[recordDispatchStart] skipped (fail-open): ${e && e.message}\n`);
    } catch {
      /* noop */
    }
  }
}

function recordCompletion(record) {
  // canonicalFile() ensures the path is __dirname-anchored, never cwd-relative.
  // Fixes ED-016/class-#20: worktree-cwd dispatches wrote to worktree's runtime.
  const file = completionsLedgerFile();
  // SR-011/SR-013 + ED-231 (execution PROVENANCE, WRITER-AUTHORITATIVE + ORIGIN-PROOF): every completion
  // record is bound to its run IDENTITY + CODE at write-time — injected HERE, the single record-writer that
  // every dispatch wrapper shares (dispatch-agent/dispatch-claude/dispatch-skill/epsilon-runtime), so NO call
  // site can omit them. The WRITER derives them from its OWN sources (env panel_run_id + own git HEAD) and they
  // are AUTHORITATIVE — a caller-supplied value that CONFLICTS is a forged-provenance attempt (or a real bug):
  // the writer does NOT produce a valid SIGNED record for it (fail-closed, visible), never silently prefers one
  // (α ED-231 ruling — supersedes the pre-ED-231 caller-explicit-wins model record-provenance.test enshrined).
  const derivedRun = mcEnv.readEnv("PANEL_RUN_ID") || null;
  const derivedSha = currentCodeSha() || null;
  const callerRun = record.panel_run_id;
  const callerSha = record.code_sha;
  const runMismatch = callerRun != null && callerRun !== "" && derivedRun != null && callerRun !== derivedRun;
  const shaMismatch = callerSha != null && callerSha !== "" && derivedSha != null && callerSha !== derivedSha;
  const enriched = { ...record, panel_run_id: derivedRun, code_sha: derivedSha };
  // ED-070 (BE-2): every completion record carries a `quota` fragment — the
  // provider quota/billing posture known at dispatch time. A caller MAY pass
  // a pre-built fragment via record.quota (dispatch-record-fields#quotaField)
  // when it has real knowledge (e.g. this file's own call site maps
  // runProvider's observed result.quota); when ABSENT, the sink stamps the
  // SAME builder's honest-unknown default (`{known:false}`) so the shape is
  // UNIFORM across every writer (dispatch-agent/dispatch-claude/
  // epsilon-runtime) without each call site duplicating it — "wired into ALL
  // dispatch writers as ONE change" via the single sink.
  if (!enriched.quota || typeof enriched.quota !== "object") {
    try {
      enriched.quota = quotaField(enriched.provider || null).quota;
    } catch {
      /* best-effort — never block a completion write for a quota-stamp hiccup */
    }
  }
  if (runMismatch || shaMismatch) {
    // Refuse to SIGN a conflicting-provenance record — it can never attest. Written UNSIGNED + flagged (visible).
    enriched.provenance_mismatch = true;
    try { process.stderr.write(`[recordCompletion] provenance mismatch (caller panel_run_id/code_sha != writer-derived) — record written UNSIGNED, cannot attest (ED-231)\n`); } catch { /* noop */ }
    appendJsonl(file, enriched);
    return;
  }
  // QA-7G-012 (r3g, defense-in-depth): dispatch_id is the paired-waiter's correlation KEY and is signed —
  // it MUST be a string (makeDispatchId always produces "d-..."). A non-string dispatch_id is a producer
  // bug/attack surface (a signed numeric id could be string-aliased at the Map correlation); refuse to SIGN
  // it — written UNSIGNED + flagged, cannot attest (the injective canonical encoding closes the aliasing at
  // VERIFY; this stops a non-string id ever getting a signature at the PRODUCER).
  if (enriched.dispatch_id != null && typeof enriched.dispatch_id !== "string") {
    enriched.dispatch_id_type_invalid = true;
    try { process.stderr.write(`[recordCompletion] non-string dispatch_id (${typeof enriched.dispatch_id}) — record written UNSIGNED, cannot attest (QA-7G-012)\n`); } catch { /* noop */ }
    appendJsonl(file, enriched);
    return;
  }
  // ORIGIN-PROOF (ED-231 / ADR-0025): sign the canonical IDENTITY fields with the per-session secret. A
  // hand-authored record (never through this writer) has no valid signature → cert-attest fails it closed.
  // Fail-open on a signing error (unsigned → cannot attest, but never blocks the dispatch — telemetry stays
  // non-blocking; the FAIL-CLOSED happens at VERIFY, not here).
  try {
    const sig = require("./dispatch/attest-signing").signRecord(enriched);
    if (sig) enriched.attest_sig = sig;
  } catch { /* signing module unavailable → unsigned → cert-attest fails it closed at verify */ }
  appendJsonl(file, enriched);
}

function recordDeath(record) {
  // Same canonical anchor as recordCompletion — both must land in the same root.
  const file = ledgerFile(
    PATHS.dispatchDeathsFile,
    path.join(".claude", "runtime", "dispatch-deaths.jsonl"),
  );
  appendJsonl(file, record);
}

/**
 * Find an agent spec file for a role by scanning .claude/agents/.
 *
 * ADR-0007: the agent system is ONE department-mirroring tree of mode-agnostic
 * roles (no more 01-adhoc/ ↔ 02-oneshot/ duplication). Specs live at:
 *   .claude/agents/president/<face>.md            (alpha/beta/gamma/delta/epsilon)
 *   .claude/agents/engineering/<pod>/<role>.md    (builder/reviewer/fixer per pod)
 *   .claude/agents/product/quality/<role>.md      (qa-reviewer/design-quality/…)
 *   .claude/agents/growth/<role>.md · product/<role>.md · _system/<role>.md
 *
 * Resolution order (mode-agnostic now — the same role spec serves every mode;
 * the conducting face γ/δ/ε supplies the mode context):
 *   1. mcEnv.readEnv("MODE") explicit (kept for detectMode() callers)
 *   2. `president/<role>.md` for the faces (alpha/beta/gamma/delta/epsilon)
 *   3. DFS over the whole department tree — match by frontmatter `name:` or stem.
 *      Since workers are no longer duplicated, the first stem/name match is
 *      unambiguous.
 */

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
    // oneshotStore now resolves (via the paths registry) to
    // president/_system/oneshot/store.json. Keep the legacy .system fallback for
    // old installs, but anchor literal fallbacks to this script's repo root.
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
    /* fall through */
  }
  return "adhoc";
}

// ADR-0007: roles are mode-agnostic — there is no per-mode spec subdir any more.
// Kept as a no-op shim so any external caller doesn't break; resolution now goes
// president/ → DFS over the department tree.
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
    /* unreadable */
  }
  return false;
}

function tryDirect(role, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    if (fs.existsSync(c)) {
      // Prefer files whose frontmatter `name:` matches the role, but accept
      // when stem matches and frontmatter is silent.
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

  // 1. The faces live directly under president/ (alpha/beta/gamma/delta/epsilon).
  const face = tryDirect(role, path.join(agentsDir, "president", `${role}.md`));
  if (face) return face;

  // 2. DFS over the whole department tree — match a spec when its frontmatter
  //    `name:` equals the role (authoritative) OR its stem equals the role.
  //    ADR-0007: the new pod specs are named by FILE-stem only at the pod level
  //    (engineering/security/reviewer.md whose frontmatter `name: security-reviewer`),
  //    so a stem-only gate would MISS `security-reviewer`/`frontend-reviewer` —
  //    we must consult the frontmatter `name:` of EVERY .md, not just stem hits.
  //    Collect candidates and prefer the NEW department tree over the legacy
  //    mode-coupled dirs during the cutover coexistence window (so a stale
  //    01-adhoc/02-oneshot duplicate never shadows the canonical new spec).
  const NEW_TREE = ["president", "engineering", "product", "growth", "_system"];
  const LEGACY_TREE = ["00-alex", "01-adhoc", "02-oneshot", "03-managers"];
  const matches = []; // { full, name, stem }
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
        const nameMatch = specMatchesRole(full, role); // frontmatter name === role
        if (nameMatch || stem === role) {
          matches.push({ full, byName: nameMatch, stem });
        }
      }
    }
  }
  if (matches.length === 0) return null;
  const rel = (p) => path.relative(agentsDir, p).split(path.sep);
  const inTree = (p, roots) => roots.includes(rel(p)[0]);
  // Preference: frontmatter-name match in the NEW tree > stem match in NEW tree >
  // name match in legacy > stem match in legacy > any.
  const rank = (m) =>
    (m.byName ? 0 : 2) + (inTree(m.full, NEW_TREE) ? 0 : inTree(m.full, LEGACY_TREE) ? 1 : 0.5);
  matches.sort((a, b) => rank(a) - rank(b));
  return matches[0].full;
}

/**
 * Parse an agent spec's frontmatter and return the declared `provider_model`.
 */
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

// Allow test code to require() this module without triggering the CLI flow.
if (require.main !== module) {
  module.exports = {
    findAgentSpec,
    providerToolId, // D2 (SP-20260718-003 / I-2): provider-id → tool-id map
    observedCompletionFields, // C2 (SP-20260718-003 / D2-FALSE-GREEN-001): observed-provider record shaping
    resolveModelRunOpts, // D4 (SP-20260718-003 / ED-205): run-opts semantics — regression guard
    getRoleModel,
    detectMode,
    readModeFromProjectRoot,
    modeSubdir,
    // AC2 / ED-016 fix: exported for unit testing the canonical-path resolution.
    // Tests can call canonicalFile(fakeWorktreePath, relFallback) directly to
    // assert that paths outside AGENT_ROOT are replaced with the anchored fallback.
    canonicalFile,
    AGENT_ROOT,
    // RI-004 / ED-018: the Claude-role bounded dispatch wrapper
    // (scripts/dispatch-claude.js) reuses these telemetry helpers so it writes
    // to the SAME canonical ledger gauntlet-verify reads. Single source of the
    // record/path logic — no second copy, no fork. (See dispatch-claude.js.)
    recordCompletion,
    recordDeath,
    // BE-2 (SP-20260718-005 / ED-069): the write-ahead started-row wrapper —
    // reused by dispatch-claude.js and epsilon-runtime.js's CLAUDE_RAW raw
    // spawn so ALL subprocess dispatch writers emit it via the SAME canonical
    // ledger path (never a forked/second mechanism).
    recordDispatchStart,
    makeDispatchId,
    cmdlineChecksum,
    // N-1 (PLAN §17.4): run-context + prompt-digest stampers, reused by
    // dispatch-claude.js so both wrappers write the SAME coverage-gradeable schema.
    runContext,
    promptDigest,
    // §17.4 schema strengthening — reused by dispatch-claude.js so both wrappers
    // stamp output_digest (proof-of-artifact) + the argv schema version identically.
    outputDigest,
    argvSchemaVersion,
  };
  return;
}

const [, , role, promptArg, ...restArgs] = process.argv;

// Optional overrides — used by the SECOND GPT security pass and manual reruns:
//   --provider <claude|openai|antigravity>   force a provider regardless of manifest (gemini is sunset → antigravity/agy)
//   --model <id>                         force a model
// e.g. node scripts/dispatch-agent.js redteam prompt.txt --provider openai --model gpt-5.5
function parseFlag(name) {
  const i = restArgs.indexOf(name);
  return i >= 0 && restArgs[i + 1] ? restArgs[i + 1] : null;
}
const PROVIDER_ALIAS = {
  anthropic: "claude",
  claude: "claude",
  openai: "openai",
  gpt: "openai",
  // The SUNSET individual `gemini` CLI was removed in the 2026-07-20 deep-clean; `google`
  // resolves to the supported `antigravity` (agy) lane that serves Gemini models.
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
// --domain <d>: the unit of work's domain (product|marketing|engineering|...),
// threaded into the dispatch/run records so domain-aware routing + per-domain
// gauntlet selection have the signal (S1.1 chassis, part 2).
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

// ── Derived role binding (SP-20260718-004 Phase 2, G2.1/ED-216; CORE-1) ──────────
// The CHANNEL (this cross-provider bridge) derives actor_kind=dispatched_worker PRE-SPAWN — a
// cross-provider reviewer/consult is NEVER President, regardless of any ambient AGENTS.md/router text
// it slurps from cwd. HARD-REFUSE the President-leak class fail-closed; stamp the derived binding on
// the env so downstream records/children inherit it. Non-leak ok:false (unknown role / corrupt
// control) still stamps dispatched_worker and warns — additive, non-breaking.
try {
  const { deriveBinding } = require("./dispatch/role-resolver");
  const __b = deriveBinding({ channel: "dispatch-agent", role });
  mcEnv.setEnv("ACTOR_KIND", __b.actor_kind || "dispatched_worker");
  if (__b.ok && __b.boundRole) mcEnv.setEnv("BOUND_ROLE", __b.boundRole);
  // Fail-CLOSED on any TRUSTED-KERNEL INTEGRITY failure (gauntlet R1 SR-ID-001/BE-CQ-001/002): corrupt/
  // unreadable control, ED-220 value failure, unknown channel, President-identity role, bogus top-level
  // default → failClosed:true → REFUSE. A benign unrecognized role (failClosed:false) proceeds stamped
  // dispatched_worker (never President), keeping generic/consult roles working.
  if (!__b.ok && __b.failClosed) {
    console.error(
      JSON.stringify({ ok: false, error: `role-binding REFUSED (fail-closed, CORE-1): ${__b.reason}` }),
    );
    process.exit(2);
  } else if (!__b.ok) {
    process.stderr.write(`[dispatch-agent] role-binding advisory (benign, not President-leak): ${__b.reason}\n`);
  }
} catch (e) {
  // A MISSING/broken identity resolver fails CLOSED (SR-ID-001): the trusted binding step cannot run → refuse.
  console.error(JSON.stringify({ ok: false, error: `role-resolver unavailable — REFUSING dispatch (fail-closed): ${e.message}` }));
  process.exit(2);
}

// Load the prompt
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

// Phase 0 workstream C: stamp telemetry identity for this dispatch.
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

// ── Dispatch-contract consult (§17.1 keystone — symmetric with dispatch-claude.js) ──
// This wrapper owns the subprocess-cross-provider shape. Assert the role is
// contract-allowed to be dispatched this way (a build-chain role, or a claude-pinned
// reviewer routed here, is a routing error). REPORT-ONLY by default (PLAN §4 ramp);
// WARPOS_DISPATCH_CONTRACT_ENFORCE=block makes a violation fatal. Fail-OPEN on any
// contract-read error so the contract never crashes a working cross-provider dispatch.
// β edge (SP-20260627-001): split the two error classes. A MODULE-LOAD failure (require
// throws — a broken/absent contract module) fails OPEN: the contract must never brick a
// working cross-provider dispatch, and the kill-switch needs no loadable module. An
// EVALUATION failure (the gate ran and threw on input) fails CLOSED under enforce (BC-16).
// β pin 2b: legacy role names are normalized (pure 1-hop alias) BEFORE validation so an
// alias like `redteam`/`advisor` resolves instead of false-refusing under enforce-by-default.
let contractMod = null;
try {
  contractMod = require("./dispatch/dispatch-contract");
} catch (e) {
  process.stderr.write(`[dispatch-agent] dispatch-contract module unloadable — failing OPEN (advisory only; set WARPOS_DISPATCH_CONTRACT_ENFORCE=off to silence): ${e && e.message}\n`);
}
if (contractMod) {
  const { validateDispatch, contractEnforceMode } = contractMod;
  // Claude gauntlet LOW: load normalizeRole defensively so an unloadable role-aliases module
  // fails OPEN (identity) — symmetric with the contract module-load availability design above,
  // instead of crashing uncaught.
  let normalizeRole = (r) => r;
  try { normalizeRole = require("./hooks/lib/role-aliases").normalizeRole || normalizeRole; } catch { /* identity fallback */ }
  const currentMode = detectMode();
  // W2 flip (β DECIDE 0.87, ADR-0013 amended SP-20260627-001): the contract gate enforces by
  // DEFAULT (it checks api-when-CLI + forbidden_shapes + in-process-hard + cwd the shape-door
  // doesn't). Escapes via the helper (report|off|0).
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

// ── Shape-resolver self-detection (T-20260608-271) ──────────────────────────
// This wrapper OWNS the subprocess-cross-provider shape. Consult the LIVE resolver as
// the independent authority: if resolveShape picks a DIFFERENT shape for this role, the
// role is routed through the wrong wrapper (e.g. a build-chain builder pushed through the
// cross-provider path) — the wrong shape self-detects on a REAL dispatch. W2/N2 ENFORCE FLIP
// (2026-06-16): dispatch-agent is the LOWEST-BLAST first flip — it ENFORCES by default
// (enforceDefault). SAFE-BY-CONSTRUCTION: enforce only REFUSES high-severity mismatches
// (unproven-subprocess / build-chain-in-process); a legitimate cross-provider reviewer resolves
// through the contract to proven:true + 'subprocess-cross-provider' (MATCHES → never refused). A
// mere wrong-wrapper (a builder shoved through this path) is only a MEDIUM advisory — still NOT
// refused (conservative by design). So the flip cannot false-refuse a real reviewer dispatch; its
// teeth apply only to a genuinely-dangerous unproven-subprocess unit. Escapes:
// WARPOS_SHAPE_DOOR_DISPATCH_AGENT=report (per-wrapper kill), global
// WARPOS_SHAPE_DOOR=report (fleet kill), WARPOS_DISABLE_SHAPE_DOOR=1 (ultimate). exit 2 on an
// enforce refusal; fail-OPEN on any resolver error.
try {
  const { shapeDoor } = require("./dispatch/dispatch-shape");
  // The per-wrapper env is a TRUE kill (W2 gauntlet MED-1): when set to report, force report via
  // reportOnlyPin (which beats even a global WARPOS_SHAPE_DOOR=enforce) — not merely clear the
  // flip. Unset → enforceDefault (the per-wrapper ramp default).
  const killThis = /^(report|off|0)$/i.test(String(mcEnv.readEnv("SHAPE_DOOR_DISPATCH_AGENT") || ""));
  const door = shapeDoor("subprocess-cross-provider", { kind: "agent", id: role }, process.env, killThis ? { reportOnlyPin: true } : { enforceDefault: true });
  if (door.mismatch && door.mismatch.mismatch && !door.suppressed) {
    // β#4: report-mode advisory string stays BYTE-IDENTICAL to the pre-door legacy (no `(mode)`
    // label); only the new refuse path (exit 2) carries the mode in its VIOLATION wording.
    process.stderr.write(
      `[dispatch-agent] shape-resolver ${door.action === "refuse" ? `VIOLATION (${door.mode})` : "advisory"}: role '${role}' dispatched as 'subprocess-cross-provider' but the resolver picks '${door.mismatch.expected}' (${door.mismatch.expectedReason || door.mismatch.reason}; severity=${door.mismatch.severity || "medium"}).\n`,
    );
  }
  if (door.action === "refuse") {
    // exit 2 = the shape-DOOR refusal (β#3 — distinct from the contract-consult block's exit 1).
    console.log(JSON.stringify({ ok: false, provider, role, error: "dispatch_shape_mismatch", expected: door.mismatch.expected, actual: "subprocess-cross-provider", severity: door.mismatch.severity }));
    process.exit(2);
  }
} catch {
  /* fail-open — the resolver consult never crashes a working dispatch */
}

// (The Phase-5T Gemini-redteam 75KB prompt cap was removed in the 2026-07-20 deep-clean:
// the SUNSET individual gemini CLI is gone. The agy lane's assembled-command-line ceiling is
// bounded structurally by safe-spawn's CMDLINE_MAX / RIDER-1, not a provider-specific pre-check.)

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

// T-322: the ε-propagated child bound, single-sourced. When epsilon-runtime's
// DISPATCH_AGENT spawn site sets DISPATCH_BUILDER_TIMEOUT_MS = String(childBaseMs),
// BOTH child timeout layers (slot-acquire below + runProvider's exec) MUST derive
// from it, so the parent's spawnSync bound (childBaseMs + grace) strictly exceeds
// every child layer BY CONSTRUCTION (mirrors the epsilon-claude/dispatch-claude.js
// site, which already reads this env). NULL for non-ε callers — env absent →
// behaviour is byte-identical to before (DISPATCH_SLOT_TIMEOUT_MS / runProvider's
// own default). The foregroundAwareTimeout re-clamp is idempotent: an already-clamped
// childBaseMs cannot be lifted above the foreground ceiling here.
const propagatedBoundRaw = process.env.DISPATCH_BUILDER_TIMEOUT_MS;
const propagatedChildBaseMs =
  propagatedBoundRaw != null && propagatedBoundRaw !== ""
    ? (() => {
        const { foregroundAwareTimeout } = require("./dispatch/timeout-policy");
        const n = parseInt(propagatedBoundRaw, 10);
        return Number.isFinite(n) ? foregroundAwareTimeout(n, {}) : null;
      })()
    : null;

// Acquire a per-provider concurrency slot. Caps protect against API rate
// limits and concurrency-induced failures (e.g. gemini reliably errors on
// 15+ parallel calls but is fine 1-by-1 — observed during run-12 redteam
// gauntlet, retro 2026-04-29). On slot-acquire timeout, return fallback:true
// so the orchestrator routes to claude instead of waiting indefinitely.
// T-322: when ε propagates the child bound, the slot bound must be ≤ childBaseMs
// so the parent's childBaseMs+grace strictly exceeds it; else keep the standalone
// DISPATCH_SLOT_TIMEOUT_MS default (600s) unchanged for non-ε callers.
//
// T-322 / β build-constraint (DECIDE 0.90), CHOICE (b) — DOCUMENTED-ACCEPT, not floored:
// when ε's propagated childBaseMs is FOREGROUND-CLAMPED (540s), this INTENTIONALLY
// shortens the slot-acquire wait below the 600s DISPATCH_SLOT_TIMEOUT_MS default. The
// invariant is slot ≤ childBaseMs ≤ the dispatch's TOTAL budget (540s foreground): a slot
// the dispatch would have NO TIME LEFT to use is not worth waiting for, so falling back to
// the claude lane EARLIER (high concurrency cap, no rate-limit) is the correct behavior —
// strictly better than waiting up to 600s for a slot we could never actually run on.
// A FLOOR at 600s (e.g. Math.max(propagatedChildBaseMs, 600s)) is NOT an option: it would
// make slot (600s) > parent's foreground SIGTERM bound (childBaseMs 540s + 45s grace = 585s)
// → parent(585s) < slot(600s), RE-CREATING the exact parent-kills-child-before-it-writes-its
// -record race this fix closes. BACKGROUND dispatches keep the full wait (childBaseMs=900s >
// 600s), so a saturated provider that genuinely needs ~600s to free a slot is UNAFFECTED —
// only the foreground (can't-run-long-anyway) lane shortens. Pinned by epsilon-spawn-grace
// section (6); a "restore the 600s floor" change REDs there.
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

// ED-069 (BE-2): write-ahead started-row, AFTER the concurrency slot is
// acquired (so this dispatch is genuinely about to spawn) and BEFORE the
// actual runProvider call — the exact window a reap/hang/crash would
// otherwise leave with zero evidence. sprint_id carried via runContext() for
// correlation, mirroring the completion record's own run-context stamping.
recordDispatchStart({
  role,
  provider,
  dispatch_id: dispatchId,
  started_at: dispatchStartedAt,
  sprint_id: runContext().sprint_id,
});

let result;
try {
  // Honor the agent's frontmatter-declared provider_model (e.g. qa → gpt-5.4-mini,
  // reviewer → gpt-5.6-sol, security-reviewer → gemini-3.1-pro-high via agy) instead of the
  // provider default. BUT when --provider overrides the native provider, the spec's model
  // belongs to the WRONG provider — ignore it and use --model (or let runProvider
  // pick the override provider's default).
  const roleModel = getRoleModel(role);
  // T-322 (attempt #3): single-source the propagated child bound for EVERY runProvider
  // call site BY CONSTRUCTION. When ε propagates childBaseMs, the provider-exec must
  // single-source from it too — runProvider otherwise uses its own run-provider default
  // (540s), INDEPENDENT of the parent's propagated value, leaving the cross-provider
  // site's death-record race open. Routing every runProvider opts object through this
  // ONE helper means any present-or-future call site (main + the WI-18 quota-retry)
  // inherits the bound automatically — closing the bug class, not the third instance.
  // runProvider re-clamps idempotently via foregroundAwareTimeout; non-ε callers (env
  // absent → propagatedChildBaseMs null) keep runProvider's own default, byte-identical.
  const withPropagatedTimeout = (opts) =>
    propagatedChildBaseMs != null ? { ...opts, timeoutMs: propagatedChildBaseMs } : opts;
  const runOpts = resolveModelRunOpts({ providerOverride, modelOverride, roleModel }); // D4/ED-205
  result = runProvider(role, prompt, withPropagatedTimeout(runOpts));

  // WI-18 + WG-11(b): family-aware quota fallback. When ANY non-claude provider 429s / exhausts
  // quota, runProvider surfaces it via result.quota (which now carries a FAMILY-AWARE
  // suggestFallbackProvider — a target in a DIFFERENT model family). Rather than silently degrading
  // to claude (same family as the code under review — weak diff-model coverage), do ONE bounded retry
  // on the suggested cross-family provider, but only when the operator hasn't forced a provider/model.
  // Broadened from gemini-only to any non-claude provider (post-flip the Google hunter routes via
  // `antigravity`, and a GPT role that quota-fails also needs the cross-family retry). Recoverable
  // (rate-limit) AND unrecoverable (free-tier=0) both warrant it. Single attempt, no loop.
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
        `[dispatch-agent] WI-18 quota fallback: ${role} ${result.provider}` +
          ` (${result.quota.kind}) → retrying on ${fbProvider} for cross-family` +
          ` security coverage (1 attempt).\n`,
      );
      // T-322 (attempt #3): the retry runs the provider-exec layer just like the main
      // call — it MUST inherit the same propagated childBaseMs (else for a small
      // opts.timeoutMs the parent bound falls below the retry's 540s run-provider
      // default, re-opening the death-record race on the quota-fallback path). Route
      // it through the same withPropagatedTimeout helper — the single propagation point.
      const retry = runProvider(role, prompt, withPropagatedTimeout({ provider: fbProvider }));
      if (retry && retry.ok) {
        retry.quotaFallbackFrom = {
          provider: result.provider,
          model: result.model || null,
          kind: result.quota.kind,
        };
        result = retry;
      }
      // If the retry also fails, keep the original quota result (its loud error +
      // fallback:true still drives the caller's existing claude fallback). Never
      // mask a double failure as success.
    }
  }

  // Add role + structured output to result
  result.role = role;
  if (roleModel) result.specModel = roleModel;
  const parsed = parseProviderJson(result.output);
  if (parsed) result.parsed = parsed;
  // ADR-0012: the per-dispatch envelope-validation gate is BURIED. It validated build-chain
  // envelopes but ran on cross-provider REVIEW outputs (a category error → frequent ok:false,
  // and grep-verified NEVER consumed → a dead gate, the "36/36" state NOTAGAIN named). The real
  // per-dispatch validation is gauntlet-verify's ok:true completion record + the orchestrator's
  // consumption of result.parsed (set above). The output-validator.js utility is unchanged
  // (still used for build-chain output + its own self-test) — it just stops being stamped here.
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

  // Phase 0 workstream C: completion + silent-death telemetry.
  const stdoutBytes = result.output
    ? Buffer.byteLength(String(result.output), "utf8")
    : 0;
  const stderrBytes = result.stderrBytes || 0;
  const completedAt = new Date().toISOString();
  const completedMs = Date.now();
  const elapsedMs = completedMs - dispatchStartedMs;
  // C2 (D2-FALSE-GREEN-001 · SR-004/QA-002): the record's provider/tool_id/fallback derive from the
  // OBSERVED result via ONE helper — a quota-fallback openai run can never be stamped as observed-agy.
  const observedRec = observedCompletionFields(provider, result);
  // ED-070 (BE-2): map runProvider's OBSERVED quota signal (only ever present on a
  // classified quota/429 failure — see providers.js#classifyQuotaFailure) into the
  // honest quotaField() shape. Absent real knowledge, recordCompletion's own default
  // stamps `{known:false}` — this call site just supplies what's ACTUALLY known here.
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
    // OBSERVED provider (C2): what ACTUALLY ran. The intended/expected provider lives in the provider-trace.
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
    // A quota-fallback that ran another lab is STILL a fallback for attestation (contracted lab didn't run).
    fallback: observedRec.fallback,
    // SP-20260723-002 / ADR-0037: agy AUTH-fallback (true | "indeterminate"), DISTINCT from provider/quota
    // fallback — present only on an antigravity serve (undefined → omitted, so non-agy records are unchanged).
    ...(observedRec.auth_fallback !== undefined ? { auth_fallback: observedRec.auth_fallback } : {}),
    ok: !!result.ok,
    // N-1 (§17.4): run-context + shape + tool + prompt digest for the coverage gate.
    ...runContext(),
    prompt_digest: promptDigest(prompt),
    shape: "subprocess-cross-provider",
    // tool_id derives from the OBSERVED provider (C2): a quota-fallback openai run stamps 'codex', not 'agy'.
    tool_id: observedRec.tool_id,
    // §17.4 strengthening: schema version (the gate rejects stale/backfilled
    // records), cwd, and output_digest (proof the dispatch produced real output —
    // a record's mere existence is not coverage).
    argv_schema_version: argvSchemaVersion(),
    cwd: AGENT_ROOT,
    output_digest: outputDigest(result.output),
    // ED-070: honest quota fragment (known:false when runProvider surfaced no quota signal).
    quota: quotaField(observedRec.provider, knownQuota).quota,
  });

  // Silent zero-byte death: process returned a non-ok with no stdout AND no
  // captured stderr — this is the LRN-2026-04-17 / 2026-04-30 binding-gap
  // failure signature. Persist for post-mortem so future flag-drain / health
  // checks can flag the pattern instead of swallowing it.
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
