#!/usr/bin/env node
/**
 * provider-autofix.unit.test.js — unit tests for T-20260513-023.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-023
 * Story:   S-5
 * AC:      AC-5.1, AC-5.2, AC-5.3
 * REDTEAM: RT-2 (catalog cannot mutate operator auth)
 *
 * Pattern mirrors tests/mc/lib/provider-rca.unit.test.js — plain Node,
 * no Jest. Run:
 *
 *   node tests/mc/lib/provider-autofix.unit.test.js
 *
 * Coverage:
 *   AC-5.1 — safe_to_autofix=true recipe -> applied=true + re-probe + event
 *   AC-5.2 — safe_to_autofix=false -> no recipe runs, no autofix event
 *   AC-5.3 — --no-autofix bypass -> single notice line, [] attempts
 *
 *   RT-2 — catalog cannot mutate operator auth:
 *           - unknown recipe.kind blocked
 *           - recipe.scope != "process" blocked
 *           - env-var name not in ALLOWED_ENV_KEYS blocked
 *           - env-var name containing AUTH/TOKEN/API_KEY/etc. blocked
 *           - on-disk catalog statically inspected: no safe_to_autofix=true
 *             entry has a recipe that mutates auth-shaped data
 *
 *   Determinism + no-I/O — the module itself does no subprocess work; uses
 *   a passed-in probeOne so tests can inject deterministic re-probes.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const AUTOFIX_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "mc",
  "lib",
  "provider-autofix.js",
);
const CATALOG_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".claude",
  "agents",
  "00-alex",
  ".system",
  "policy",
  "provider-failure-modes.json",
);

const autofix = require(AUTOFIX_PATH);
const {
  runAutofixes,
  ALLOWED_RECIPE_KINDS,
  ALLOWED_ENV_KEYS,
  FORBIDDEN_ENV_SUBSTRINGS,
  isAuthMutatingEnvKey,
} = autofix;
const catalog = require(CATALOG_PATH);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}: ${detail || "(no detail)"}`);
  }
}

// Captures audit events emitted via the injected log fn.
function makeRecorder() {
  const events = [];
  function log(level, payload) {
    events.push({ level, payload });
  }
  return { events, log };
}

function makeStdoutCapture() {
  const lines = [];
  return { lines, print: (s) => lines.push(String(s)) };
}

// Build an RCA entry from a catalog status. Mirrors the shape that
// provider-rca.js#rcaFor produces.
function rcaEntry(provider, status) {
  const entry = catalog.entries[status];
  if (!entry) throw new Error("no catalog entry for " + status);
  return {
    provider: provider,
    status: status,
    root_cause: entry.root_cause,
    safe_to_autofix: !!entry.safe_to_autofix,
    fix_recipe: entry.fix_recipe || null,
    remediation: entry.remediation,
    fallback_allowed:
      entry.fallback_allowed === undefined ? true : !!entry.fallback_allowed,
  };
}

// ── Module-shape sanity ───────────────────────────────────────

check(
  "ALLOWED_RECIPE_KINDS is exactly 2 (set_env_and_reprobe + retry_with_same_timeout)",
  ALLOWED_RECIPE_KINDS.length === 2 &&
    ALLOWED_RECIPE_KINDS.includes("set_env_and_reprobe") &&
    ALLOWED_RECIPE_KINDS.includes("retry_with_same_timeout"),
  ALLOWED_RECIPE_KINDS.join(","),
);

check(
  "ALLOWED_ENV_KEYS only contains GEMINI_CLI_TRUST_WORKSPACE",
  ALLOWED_ENV_KEYS.length === 1 &&
    ALLOWED_ENV_KEYS.includes("GEMINI_CLI_TRUST_WORKSPACE"),
  ALLOWED_ENV_KEYS.join(","),
);

check(
  "FORBIDDEN_ENV_SUBSTRINGS includes API_KEY/TOKEN/AUTH/SECRET/PASSWORD/SESSION/OAUTH",
  ["API_KEY", "TOKEN", "AUTH", "SECRET", "PASSWORD", "SESSION", "OAUTH"].every(
    (s) => FORBIDDEN_ENV_SUBSTRINGS.includes(s),
  ),
);

// ── RT-2 helper isAuthMutatingEnvKey ──────────────────────────

check(
  "RT-2 helper: GEMINI_CLI_TRUST_WORKSPACE NOT flagged as auth-mutating",
  isAuthMutatingEnvKey("GEMINI_CLI_TRUST_WORKSPACE") === false,
);
check(
  "RT-2 helper: ANTHROPIC_API_KEY flagged as auth-mutating",
  isAuthMutatingEnvKey("ANTHROPIC_API_KEY") === true,
);
check(
  "RT-2 helper: OPENAI_AUTH_TOKEN flagged",
  isAuthMutatingEnvKey("OPENAI_AUTH_TOKEN") === true,
);
check(
  "RT-2 helper: GEMINI_OAUTH_SESSION flagged",
  isAuthMutatingEnvKey("GEMINI_OAUTH_SESSION") === true,
);
check("RT-2 helper: non-string flagged", isAuthMutatingEnvKey(42) === true);
check(
  "RT-2 helper: lowercase auth token flagged (case-insensitive)",
  isAuthMutatingEnvKey("my_auth_secret") === true,
);

// ── AC-5.2 — safe_to_autofix=false skipped ────────────────────

{
  const { events, log } = makeRecorder();
  const out = runAutofixes({
    rca: [rcaEntry("openai", "auth_missing")],
    probeOne: () => ({ provider: "openai", status: "ok" }),
    log: log,
  });
  check(
    "AC-5.2: safe_to_autofix=false -> no autofix entry returned",
    out.length === 0,
    JSON.stringify(out),
  );
  check(
    "AC-5.2: safe_to_autofix=false -> zero audit events",
    events.length === 0,
  );
}

// auth_source_mismatch is the canary — fallback_allowed=false catalog entry
{
  const { events, log } = makeRecorder();
  const out = runAutofixes({
    rca: [rcaEntry("openai", "auth_source_mismatch")],
    probeOne: () => ({ provider: "openai", status: "ok" }),
    log: log,
  });
  check(
    "AC-5.2: auth_source_mismatch never auto-fixed",
    out.length === 0 && events.length === 0,
  );
}

// ── AC-5.1 — safe_to_autofix=true applied + re-probe + audit event ─

{
  const { events, log } = makeRecorder();
  const { lines, print } = makeStdoutCapture();
  let probeCalls = 0;
  const out = runAutofixes({
    rca: [rcaEntry("gemini", "trusted_directory_required")],
    probeOne: () => {
      probeCalls++;
      return { provider: "gemini", status: "ok", reason: "after trust env" };
    },
    log: log,
    print: print,
  });
  check(
    "AC-5.1: trusted_directory_required -> 1 attempt record",
    out.length === 1 && out[0].applied === true,
    JSON.stringify(out[0]),
  );
  check("AC-5.1: re-probe invoked exactly once", probeCalls === 1);
  check("AC-5.1: success = true (status ok)", out[0].success === true);
  check("AC-5.1: reprobe_status = 'ok'", out[0].reprobe_status === "ok");
  check(
    "AC-5.1: env was set on process.env",
    process.env.GEMINI_CLI_TRUST_WORKSPACE === "true",
  );
  check(
    "AC-5.1: exactly one autofix audit event emitted",
    events.length === 1 &&
      events[0].payload.type === "autofix" &&
      events[0].payload.action === "provider-autofix-attempted",
  );
  check(
    "AC-5.1: audit event captures applied=true success=true",
    events[0].payload.applied === true && events[0].payload.success === true,
  );
  check(
    "AC-5.1: C-4 stdout contains 'Auto-fix:' prefix",
    lines.join("").includes("Auto-fix:") &&
      lines.join("").includes("trusted_directory_required"),
    lines.join(""),
  );
  // Clean up the env we mutated.
  delete process.env.GEMINI_CLI_TRUST_WORKSPACE;
}

// Re-probe still red -> success=false, applied=true, event still emitted
{
  const { events, log } = makeRecorder();
  const out = runAutofixes({
    rca: [rcaEntry("gemini", "trusted_directory_required")],
    probeOne: () => ({
      provider: "gemini",
      status: "trusted_directory_required",
      reason: "still red",
    }),
    log: log,
    print: () => {},
  });
  check(
    "AC-5.1: re-probe still red -> applied=true success=false",
    out[0].applied === true && out[0].success === false,
  );
  check(
    "AC-5.1: audit event records the still-red status",
    events[0].payload.reprobe_status === "trusted_directory_required",
  );
  delete process.env.GEMINI_CLI_TRUST_WORKSPACE;
}

// provider_timeout: retry_with_same_timeout kind
{
  const { events, log } = makeRecorder();
  let probeCalls = 0;
  const out = runAutofixes({
    rca: [rcaEntry("claude", "provider_timeout")],
    probeOne: () => {
      probeCalls++;
      return { provider: "claude", status: "ok" };
    },
    log: log,
    print: () => {},
  });
  check(
    "AC-5.1: provider_timeout -> retry_with_same_timeout fired",
    out.length === 1 && out[0].fix_recipe_kind === "retry_with_same_timeout",
  );
  check("AC-5.1: provider_timeout re-probe count = 1", probeCalls === 1);
  check("AC-5.1: provider_timeout success=true", out[0].success === true);
}

// ── AC-5.3 — --no-autofix bypass ──────────────────────────────

{
  const { events, log } = makeRecorder();
  const { lines, print } = makeStdoutCapture();
  let probeCalls = 0;
  const out = runAutofixes({
    rca: [rcaEntry("gemini", "trusted_directory_required")],
    probeOne: () => {
      probeCalls++;
      return { provider: "gemini", status: "ok" };
    },
    log: log,
    print: print,
    noAutofix: true,
  });
  check("AC-5.3: --no-autofix -> empty attempt list", out.length === 0);
  check("AC-5.3: --no-autofix -> no audit events", events.length === 0);
  check("AC-5.3: --no-autofix -> no re-probe invoked", probeCalls === 0);
  check(
    "AC-5.3: --no-autofix -> stdout has 'Auto-fix skipped (--no-autofix)'",
    lines.join("").includes("Auto-fix skipped (--no-autofix)"),
    lines.join(""),
  );
}

// --no-autofix with no safe_to_autofix entries -> no notice line printed
{
  const { lines, print } = makeStdoutCapture();
  const out = runAutofixes({
    rca: [rcaEntry("openai", "auth_missing")],
    probeOne: () => ({ provider: "openai", status: "ok" }),
    print: print,
    noAutofix: true,
  });
  check(
    "AC-5.3: --no-autofix with no safe entries -> no notice line (avoid noise)",
    out.length === 0 && lines.length === 0,
  );
}

// ── RT-2 — adversarial recipe handling ────────────────────────

// Unknown recipe.kind blocked
{
  const { events, log } = makeRecorder();
  const out = runAutofixes({
    rca: [
      {
        provider: "gemini",
        status: "trusted_directory_required",
        safe_to_autofix: true,
        fix_recipe: { kind: "exec_arbitrary_command", cmd: "rm -rf /" },
        root_cause: "x",
        remediation: "x",
        fallback_allowed: true,
      },
    ],
    probeOne: () => ({ provider: "gemini", status: "ok" }),
    log: log,
    print: () => {},
  });
  check(
    "RT-2: unknown recipe.kind -> applied=false skipped_reason=unknown_recipe_kind",
    out.length === 1 &&
      out[0].applied === false &&
      out[0].skipped_reason === "unknown_recipe_kind",
    JSON.stringify(out[0]),
  );
  check(
    "RT-2: unknown recipe.kind audit event records 'skipped'",
    events.length === 1 &&
      events[0].payload.action === "provider-autofix-skipped",
  );
}

// Scope != "process" blocked
{
  const out = runAutofixes({
    rca: [
      {
        provider: "gemini",
        status: "trusted_directory_required",
        safe_to_autofix: true,
        fix_recipe: {
          kind: "set_env_and_reprobe",
          scope: "user",
          env: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
        },
        root_cause: "x",
        remediation: "x",
        fallback_allowed: true,
      },
    ],
    probeOne: () => ({ provider: "gemini", status: "ok" }),
    print: () => {},
  });
  check(
    "RT-2: scope='user' blocked -> applied=false skipped_reason=recipe_scope_not_process",
    out.length === 1 &&
      out[0].applied === false &&
      out[0].skipped_reason === "recipe_scope_not_process",
  );
}

// Env key not in allowlist blocked (even if name looks innocuous)
{
  const out = runAutofixes({
    rca: [
      {
        provider: "gemini",
        status: "trusted_directory_required",
        safe_to_autofix: true,
        fix_recipe: {
          kind: "set_env_and_reprobe",
          scope: "process",
          env: { SOME_OTHER_FLAG: "1" },
        },
        root_cause: "x",
        remediation: "x",
        fallback_allowed: true,
      },
    ],
    probeOne: () => ({ provider: "gemini", status: "ok" }),
    print: () => {},
  });
  check(
    "RT-2: env key not in ALLOWED_ENV_KEYS blocked",
    out[0].applied === false &&
      out[0].skipped_reason.startsWith("env_key_not_allowed"),
    JSON.stringify(out[0]),
  );
  check(
    "RT-2: SOME_OTHER_FLAG NOT set on process.env",
    !("SOME_OTHER_FLAG" in process.env),
  );
}

// Auth-shaped env name blocked even if maliciously added to allowlist
{
  const out = runAutofixes({
    rca: [
      {
        provider: "openai",
        status: "trusted_directory_required",
        safe_to_autofix: true,
        fix_recipe: {
          kind: "set_env_and_reprobe",
          scope: "process",
          env: { ANTHROPIC_API_KEY: "sk-hijacked" },
        },
        root_cause: "x",
        remediation: "x",
        fallback_allowed: true,
      },
    ],
    probeOne: () => ({ provider: "openai", status: "ok" }),
    print: () => {},
  });
  check(
    "RT-2: ANTHROPIC_API_KEY blocked (not in allowlist; substring match too)",
    out[0].applied === false,
    JSON.stringify(out[0]),
  );
  check(
    "RT-2: ANTHROPIC_API_KEY NOT set on process.env",
    process.env.ANTHROPIC_API_KEY !== "sk-hijacked",
  );
}

// Non-string env value blocked
{
  const out = runAutofixes({
    rca: [
      {
        provider: "gemini",
        status: "trusted_directory_required",
        safe_to_autofix: true,
        fix_recipe: {
          kind: "set_env_and_reprobe",
          scope: "process",
          env: { GEMINI_CLI_TRUST_WORKSPACE: 42 },
        },
        root_cause: "x",
        remediation: "x",
        fallback_allowed: true,
      },
    ],
    probeOne: () => ({ provider: "gemini", status: "ok" }),
    print: () => {},
  });
  check(
    "RT-2: non-string env value blocked",
    out[0].applied === false &&
      out[0].skipped_reason.startsWith("env_value_not_string"),
  );
}

// Empty env map blocked
{
  const out = runAutofixes({
    rca: [
      {
        provider: "gemini",
        status: "trusted_directory_required",
        safe_to_autofix: true,
        fix_recipe: { kind: "set_env_and_reprobe", scope: "process", env: {} },
        root_cause: "x",
        remediation: "x",
        fallback_allowed: true,
      },
    ],
    probeOne: () => ({ provider: "gemini", status: "ok" }),
    print: () => {},
  });
  check(
    "RT-2: empty env map blocked",
    out[0].applied === false && out[0].skipped_reason === "recipe_env_empty",
  );
}

// ── RT-2 — static lint of the on-disk catalog ────────────────
//
// For every entry where safe_to_autofix === true:
//   1. fix_recipe.kind must be in ALLOWED_RECIPE_KINDS
//   2. if kind === set_env_and_reprobe, every env key must be in
//      ALLOWED_ENV_KEYS AND not match a FORBIDDEN_ENV_SUBSTRINGS
//   3. if kind === retry_with_same_timeout, no env field allowed
//
// This is the load-bearing test: if anyone edits the catalog to enable
// `safe_to_autofix: true` on an entry that would touch operator auth,
// this test fails BEFORE the orchestrator can run the recipe.

let safeAutofixCount = 0;
for (const [status, entry] of Object.entries(catalog.entries)) {
  if (entry && entry.safe_to_autofix === true) {
    safeAutofixCount++;
    const recipe = entry.fix_recipe;
    check(
      `RT-2 catalog lint: ${status} has fix_recipe object`,
      recipe && typeof recipe === "object",
      JSON.stringify(entry),
    );
    if (!recipe) continue;
    check(
      `RT-2 catalog lint: ${status} recipe.kind in ALLOWED_RECIPE_KINDS`,
      ALLOWED_RECIPE_KINDS.includes(recipe.kind),
      recipe.kind,
    );
    if (recipe.kind === "set_env_and_reprobe") {
      check(
        `RT-2 catalog lint: ${status} recipe.scope === 'process'`,
        recipe.scope === "process",
        recipe.scope,
      );
      check(
        `RT-2 catalog lint: ${status} recipe.env is non-empty object`,
        recipe.env &&
          typeof recipe.env === "object" &&
          Object.keys(recipe.env).length > 0,
      );
      if (recipe.env) {
        for (const key of Object.keys(recipe.env)) {
          check(
            `RT-2 catalog lint: ${status} env key '${key}' in ALLOWED_ENV_KEYS`,
            ALLOWED_ENV_KEYS.includes(key),
            key,
          );
          check(
            `RT-2 catalog lint: ${status} env key '${key}' NOT auth-mutating`,
            isAuthMutatingEnvKey(key) === false,
          );
        }
      }
    }
    if (recipe.kind === "retry_with_same_timeout") {
      check(
        `RT-2 catalog lint: ${status} retry recipe has no env field`,
        recipe.env === undefined || recipe.env === null,
      );
    }
  }
}

check(
  "RT-2 catalog lint: exactly 2 safe-autofixable entries (trusted_directory_required + provider_timeout)",
  safeAutofixCount === 2,
  `count=${safeAutofixCount}`,
);

// ── source-level guard: no subprocess / no cat-pipe patterns ──

const src = fs.readFileSync(AUTOFIX_PATH, "utf8");
function stripJsComments(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}
const srcCode = stripJsComments(src);
check(
  "source: provider-autofix.js never requires child_process",
  /require\(["']child_process["']\)/.test(srcCode) === false,
);
check(
  "source: no `cat ... | (codex|gemini)` patterns",
  /cat\s+[^\n]*\|\s*(codex|gemini)\b/.test(srcCode) === false,
);
check(
  "source: no direct `codex exec` / `gemini -p`",
  /\b(codex\s+exec|gemini\s+-p)\b/.test(srcCode) === false,
);

// ── Defensive: null/empty/malformed inputs ────────────────────

check(
  "defensive: empty args -> []",
  Array.isArray(runAutofixes({ rca: [] })) &&
    runAutofixes({ rca: [] }).length === 0,
);

check(
  "defensive: no args object -> []",
  Array.isArray(runAutofixes()) && runAutofixes().length === 0,
);

check(
  "defensive: rca null -> []",
  Array.isArray(runAutofixes({ rca: null })) &&
    runAutofixes({ rca: null }).length === 0,
);

// safe_to_autofix=true but probeOne missing -> bail with single audit event
{
  const { events, log } = makeRecorder();
  const out = runAutofixes({
    rca: [rcaEntry("gemini", "trusted_directory_required")],
    log: log,
    print: () => {},
  });
  check("defensive: probeOne missing -> empty attempts", out.length === 0);
  check(
    "defensive: probeOne missing -> one 'skipped' audit event",
    events.length === 1 && events[0].payload.reason === "probeOne_missing",
  );
  delete process.env.GEMINI_CLI_TRUST_WORKSPACE;
}

// probeOne throws -> applied=true success=false (with reprobe_threw reason)
{
  const out = runAutofixes({
    rca: [rcaEntry("gemini", "trusted_directory_required")],
    probeOne: () => {
      throw new Error("network down");
    },
    print: () => {},
  });
  check(
    "defensive: probeOne throws -> applied=true success=false",
    out.length === 1 && out[0].applied === true && out[0].success === false,
  );
  check(
    "defensive: probeOne throws -> reprobe_status='unknown_error'",
    out[0].reprobe_status === "unknown_error",
  );
  delete process.env.GEMINI_CLI_TRUST_WORKSPACE;
}

// ── Summary ───────────────────────────────────────────────────

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(`OK — ${passed} cases passed`);
process.exit(0);
