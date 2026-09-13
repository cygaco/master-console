#!/usr/bin/env node
/**
 * provider-smoke.unit.test.js — unit tests for T-20260513-019.
 *
 * Pattern mirrors scripts/test-provider-health.js: plain Node, no Jest,
 * hand-rolled `check()` + counters. Exit 0 on pass, 1 on fail.
 *
 * Run:
 *   node tests/mc/provider-smoke.unit.test.js
 *
 * Coverage:
 *   - argv parser (defaults + explicit list)
 *   - argv validation: unknown provider id (exit 1)
 *   - argv validation: shell-meta rejection (RT-1)
 *   - argv validation: unknown probe mode (exit 1)
 *   - verdict classification (green / yellow / red, --exit-on-yellow)
 *   - --json output schema keys (mc/provider-smoke/v1)
 *   - catalog absent is safe (T-021 hasn't minted it yet)
 *   - rca / autofixes are stub arrays in T-019 (T-022/T-023 populate)
 */

"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "scripts",
  "mc",
  "provider-smoke.js",
);

const smoke = require(SCRIPT);

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

// ── argv parser ───────────────────────────────────────────────

const a1 = smoke.parseArgs(["--providers", "claude,openai", "--json"]);
check(
  "parseArgs: --providers + --json captured",
  a1.providers === "claude,openai" && a1.json === true,
  JSON.stringify(a1),
);

const a2 = smoke.parseArgs([]);
check(
  "parseArgs: no args → empty record (defaults applied by validators)",
  a2.providers === undefined && a2.json === undefined,
  JSON.stringify(a2),
);

const a3 = smoke.parseArgs(["--exit-on-yellow", "--no-autofix"]);
check(
  "parseArgs: dashed boolean flags",
  a3["exit-on-yellow"] === true && a3["no-autofix"] === true,
  JSON.stringify(a3),
);

// ── verdict classification ────────────────────────────────────

check(
  "classify: all ok → green",
  smoke.classify([
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "ok" },
    { provider: "gemini", status: "ok" },
  ]) === "green",
);

check(
  "classify: one cli_missing + rest ok → yellow",
  smoke.classify([
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "cli_missing" },
    { provider: "gemini", status: "ok" },
  ]) === "yellow",
);

check(
  "classify: one auth_source_mismatch + rest ok → yellow",
  smoke.classify([
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "ok" },
    { provider: "gemini", status: "auth_source_mismatch" },
  ]) === "yellow",
);

check(
  "classify: one auth_missing → red (red beats yellow)",
  smoke.classify([
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "auth_missing" },
    { provider: "gemini", status: "ok" },
  ]) === "red",
);

check(
  "classify: red + yellow mixed → red",
  smoke.classify([
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "cli_missing" }, // yellow
    { provider: "gemini", status: "quota_exhausted" }, // red
  ]) === "red",
);

check(
  "classify: unknown_error → red",
  smoke.classify([{ provider: "gemini", status: "unknown_error" }]) === "red",
);

// ── module exports surface ────────────────────────────────────

check(
  "SCHEMA constant matches contract",
  smoke.SCHEMA === "mc/provider-smoke/v1",
);
check("KNOWN_PROVIDERS length 3", smoke.KNOWN_PROVIDERS.length === 3);
check(
  "KNOWN_PROVIDERS set",
  smoke.KNOWN_PROVIDERS.includes("claude") &&
    smoke.KNOWN_PROVIDERS.includes("openai") &&
    smoke.KNOWN_PROVIDERS.includes("gemini"),
);
check(
  "PROVIDER_TOKEN_RE rejects shell-meta (semicolon)",
  smoke.PROVIDER_TOKEN_RE.test("codex;rm") === false,
);
check(
  "PROVIDER_TOKEN_RE rejects shell-meta (ampersand)",
  smoke.PROVIDER_TOKEN_RE.test("gemini&&curl") === false,
);
check(
  "PROVIDER_TOKEN_RE rejects shell-meta (space)",
  smoke.PROVIDER_TOKEN_RE.test("gemini rm") === false,
);
check(
  "PROVIDER_TOKEN_RE rejects shell-meta ($)",
  smoke.PROVIDER_TOKEN_RE.test("gemini$(x)") === false,
);
check(
  "PROVIDER_TOKEN_RE accepts a valid id",
  smoke.PROVIDER_TOKEN_RE.test("openai") === true,
);
check(
  "PROVIDER_TOKEN_RE accepts hyphenated id",
  smoke.PROVIDER_TOKEN_RE.test("foo-bar_baz") === true,
);

// ── renderHuman (COPY C-1) ────────────────────────────────────

const greenOut = smoke.renderHuman("green", [
  { provider: "claude", status: "ok", reason: "harness" },
  { provider: "openai", status: "ok", reason: "" },
  { provider: "gemini", status: "ok", reason: "" },
]);
check(
  "renderHuman green: header present",
  greenOut.startsWith("Provider Smoke — GREEN"),
  greenOut.slice(0, 80),
);
check(
  "renderHuman green: 48-char separator present",
  greenOut.includes("─".repeat(48)),
);
check(
  "renderHuman green: trailing happy-path line",
  greenOut.includes("All required providers ready."),
);
check(
  "renderHuman green: ok icons present",
  (greenOut.match(/\bok\b/g) || []).length >= 4, // 3 provider rows + maybe more
);

const yellowOut = smoke.renderHuman("yellow", [
  { provider: "claude", status: "ok", reason: "" },
  {
    provider: "openai",
    status: "cli_missing",
    reason: "codex CLI not on PATH",
  },
  { provider: "gemini", status: "ok", reason: "" },
]);
check(
  "renderHuman yellow: header present",
  yellowOut.startsWith("Provider Smoke — YELLOW (non-fatal)"),
);
check(
  "renderHuman yellow: !! icon present for cli_missing row",
  yellowOut.includes("!!"),
);
check(
  "renderHuman yellow: closing instruction present",
  yellowOut.includes("Run `/mc:health`"),
);

const redOut = smoke.renderHuman("red", [
  { provider: "claude", status: "ok", reason: "" },
  { provider: "openai", status: "auth_missing", reason: "" },
  { provider: "gemini", status: "ok", reason: "" },
]);
check(
  "renderHuman red: header present",
  redOut.startsWith("Provider Smoke — RED (blocking)"),
);
check(
  "renderHuman red: xx icon present for auth_missing row",
  redOut.includes("xx"),
);
check(
  "renderHuman red: root_cause= present (T-022 stub)",
  redOut.includes("root_cause=auth_missing"),
);
check(
  "renderHuman red: closing instruction present",
  redOut.includes("Install/update aborted"),
);

// ── catalog loader is absent-safe ─────────────────────────────

const cat = smoke.loadFailureModeCatalog();
check(
  "loadFailureModeCatalog: returns { entries, version }",
  cat && typeof cat.entries === "object" && "version" in cat,
);
// T-019 expects entries={} version=null when T-021 hasn't minted the file.
// (Pass through whatever's on disk if present — both shapes are valid.)
check(
  "loadFailureModeCatalog: entries is an object",
  typeof cat.entries === "object" && cat.entries !== null,
);

// ── spawnSync subprocess tests (argv validation exits) ─────────

function runScript(extraArgs, opts) {
  return spawnSync(
    process.execPath,
    [SCRIPT, ...extraArgs],
    Object.assign({ encoding: "utf8", timeout: 30_000 }, opts || {}),
  );
}

// RT-1: unknown provider id rejected
const rUnknown = runScript(["--providers", "bogus"]);
check(
  "subprocess: --providers bogus → exit 1",
  rUnknown.status === 1,
  `exit=${rUnknown.status} stderr=${(rUnknown.stderr || "").slice(0, 200)}`,
);
check(
  "subprocess: --providers bogus → stderr contains unknown_provider",
  (rUnknown.stderr || "").includes("unknown_provider: bogus"),
  (rUnknown.stderr || "").slice(0, 200),
);

// RT-1: shell-meta token rejected
const rShellMeta = runScript(["--providers", "codex;rm -rf /"]);
check(
  "subprocess: shell-meta token → exit 1",
  rShellMeta.status === 1,
  `exit=${rShellMeta.status}`,
);
check(
  "subprocess: shell-meta token → stderr contains unknown_provider",
  (rShellMeta.stderr || "").includes("unknown_provider"),
);

const rAmpersand = runScript(["--providers", "gemini&&curl"]);
check("subprocess: ampersand token → exit 1", rAmpersand.status === 1);

// Unknown probe mode rejected
const rProbe = runScript(["--probe", "weird"]);
check(
  "subprocess: --probe weird → exit 1",
  rProbe.status === 1,
  `exit=${rProbe.status}`,
);
check(
  "subprocess: --probe weird → stderr contains unknown_probe_mode",
  (rProbe.stderr || "").includes("unknown_probe_mode"),
);

// Bare --probe (no value) should be accepted as the default empty mode,
// for symmetry with --providers default behavior.
const rProbeBare = runScript(["--providers", "claude", "--probe", "--json"]);
check(
  "subprocess: bare --probe (no value) → exit 0 (treated as default)",
  rProbeBare.status === 0,
  `exit=${rProbeBare.status} stderr=${(rProbeBare.stderr || "").slice(0, 200)}`,
);

// Path traversal rejected (RT scope — --target with ..)
const rTarget = runScript(["--target", ""]);
check("subprocess: --target empty → exit 1", rTarget.status === 1);

const rTargetDotDot = runScript(["--target", "../outside"]);
check(
  "subprocess: --target ../outside → exit 1 (traversal blocked pre-resolve)",
  rTargetDotDot.status === 1,
  `exit=${rTargetDotDot.status} stderr=${(rTargetDotDot.stderr || "").slice(0, 200)}`,
);
check(
  "subprocess: --target ../outside → stderr contains invalid_target",
  (rTargetDotDot.stderr || "").includes("invalid_target"),
);

const rTargetDotDotWin = runScript(["--target", "..\\outside"]);
check(
  "subprocess: --target ..\\outside → exit 1 (Windows traversal blocked)",
  rTargetDotDotWin.status === 1,
);

// Trailing-space trick (Windows FS strips trailing spaces from path
// components). `.. /x` and `.. \\x` should be caught by the trim-each-segment
// check.
const rTargetTrailSpace = runScript(["--target", ".. /x"]);
check(
  "subprocess: --target '.. /x' (trailing-space trick) → exit 1",
  rTargetTrailSpace.status === 1,
);

// Null byte injection rejected. Node's spawnSync refuses to deliver an
// argv string containing a null byte (ERR_INVALID_ARG_VALUE), so we can't
// reach our validator via subprocess. Exercise the in-process path instead:
// call run([...]) with a stubbed process.exit and assert it throws / sets
// the exit signal. The source-level guard is still meaningful as defense
// in depth for any future caller that bypasses spawnSync.
const realExit = process.exit;
const realStderrWrite = process.stderr.write.bind(process.stderr);
let capturedStderr = "";
let capturedExitCode = null;
process.stderr.write = (chunk) => {
  capturedStderr += String(chunk);
  return true;
};
process.exit = (code) => {
  capturedExitCode = code;
  throw new Error("__test_exit__");
};
try {
  smoke.run(["--providers", "claude", "--target", "ok\0bad"]);
} catch (e) {
  if (!String(e.message).includes("__test_exit__")) {
    process.stderr = { write: realStderrWrite };
    process.exit = realExit;
    throw e;
  }
}
process.stderr.write = realStderrWrite;
process.exit = realExit;
check(
  "run(): --target with null byte → process.exit(1) attempted",
  capturedExitCode === 1,
  `capturedExitCode=${capturedExitCode}`,
);
check(
  "run(): --target with null byte → stderr contains invalid_target",
  capturedStderr.includes("invalid_target"),
  capturedStderr.slice(0, 200),
);

// Strict provider validation: whitespace in CSV rejected
const rWhitespace = runScript(["--providers", "claude, openai"]);
check(
  "subprocess: --providers 'claude, openai' (space after comma) → exit 1 (strict)",
  rWhitespace.status === 1,
  `exit=${rWhitespace.status} stderr=${(rWhitespace.stderr || "").slice(0, 200)}`,
);

// Empty mid-token rejected
const rEmptyMid = runScript(["--providers", "claude,,openai"]);
check(
  "subprocess: --providers 'claude,,openai' → exit 1 (empty token rejected)",
  rEmptyMid.status === 1,
);

// Trailing comma rejected
const rTrailing = runScript(["--providers", "claude,"]);
check(
  "subprocess: --providers 'claude,' → exit 1 (trailing-comma empty token)",
  rTrailing.status === 1,
);

// ── --json output: schema + key presence ──────────────────────
//
// We run --providers claude (claude is always ok per provider-health.js
// L210-218) so we get a deterministic green verdict + exit 0 + parseable
// JSON. This is the SP-005 consumption interface.

const rJson = runScript(["--providers", "claude", "--json"]);
check(
  "subprocess: claude-only --json → exit 0",
  rJson.status === 0,
  `exit=${rJson.status} stderr=${(rJson.stderr || "").slice(0, 200)}`,
);

let parsed = null;
try {
  parsed = JSON.parse((rJson.stdout || "").trim());
} catch (e) {
  // leave null — checks below will fail with clear messages
}

check(
  "--json: stdout parses as JSON",
  parsed !== null,
  (rJson.stdout || "").slice(0, 200),
);
check(
  "--json: schema field matches contract",
  parsed && parsed.schema === "mc/provider-smoke/v1",
  parsed && parsed.schema,
);
check(
  "--json: verdict is green for claude-only",
  parsed && parsed.verdict === "green",
  parsed && parsed.verdict,
);
check(
  "--json: results is array with 1 entry (claude only)",
  parsed && Array.isArray(parsed.results) && parsed.results.length === 1,
);
check(
  "--json: rca is stub [] in T-019",
  parsed && Array.isArray(parsed.rca) && parsed.rca.length === 0,
);
check(
  "--json: autofixes is stub [] in T-019",
  parsed && Array.isArray(parsed.autofixes) && parsed.autofixes.length === 0,
);
check(
  "--json: duration_ms is non-negative integer",
  parsed &&
    typeof parsed.duration_ms === "number" &&
    Number.isInteger(parsed.duration_ms) &&
    parsed.duration_ms >= 0,
);
check(
  "--json: catalog_version present (null when T-021 hasn't landed)",
  parsed && "catalog_version" in parsed,
);
check(
  "--json: invoked_from is 'standalone' for direct CLI",
  parsed && parsed.invoked_from === "standalone",
);

// ── R-8 / RT-5: source file contains no `cat | codex` patterns ──
//
// We strip JS comments (line + block) before scanning so the docstring
// reference to the forbidden patterns ("DO NOT shell out to `codex exec`")
// does not trigger a false positive. The intent is to catch executable
// code that re-introduces the LRN-2026-04-30 binding-gap bug class.

const fs = require("fs");
const srcText = fs.readFileSync(SCRIPT, "utf8");

function stripJsComments(s) {
  // block comments
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  // line comments
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

const srcCode = stripJsComments(srcText);
const forbiddenPattern = /cat\s+[^\n]*\|\s*(codex|gemini)\b/;
check(
  "source: no `cat ... | (codex|gemini)` patterns in code (R-8 AC-8.1)",
  forbiddenPattern.test(srcCode) === false,
);
const directExecPattern = /\b(codex\s+exec|gemini\s+-p)\b/;
check(
  "source: no direct `codex exec` / `gemini -p` invocations in code",
  directExecPattern.test(srcCode) === false,
);

// ── AC-3.2: corrupt catalog → exit 1 with catalog_load_error ──
//
// Spawn smoke in a temp cwd with a malformed catalog file. Confirms:
//   - exit code 1 (NOT 2 — exit 2 is reserved for red provider verdict)
//   - stderr contains `catalog_load_error: parse_failed`
//   - no probes ran (no provider rows in stdout)

const os = require("os");
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-smoke-test-"));
try {
  const catalogDir = path.join(
    tmpDir,
    ".claude",
    "agents",
    "00-alex",
    ".system",
    "policy",
  );
  fs.mkdirSync(catalogDir, { recursive: true });
  // Malformed JSON (unterminated string).
  fs.writeFileSync(
    path.join(catalogDir, "provider-failure-modes.json"),
    '{"entries": {"unterminated',
    "utf8",
  );
  const rCorrupt = spawnSync(
    process.execPath,
    [SCRIPT, "--providers", "claude", "--json"],
    {
      encoding: "utf8",
      timeout: 30_000,
      cwd: tmpDir,
    },
  );
  check(
    "AC-3.2: corrupt catalog → exit 1 (not 2)",
    rCorrupt.status === 1,
    `exit=${rCorrupt.status} stderr=${(rCorrupt.stderr || "").slice(0, 200)}`,
  );
  check(
    "AC-3.2: corrupt catalog → stderr contains catalog_load_error",
    (rCorrupt.stderr || "").includes("catalog_load_error"),
    (rCorrupt.stderr || "").slice(0, 200),
  );
  check(
    "AC-3.2: corrupt catalog → stderr names parse_failed reason",
    (rCorrupt.stderr || "").includes("parse_failed"),
    (rCorrupt.stderr || "").slice(0, 200),
  );

  // schema_invalid: not-an-object root
  fs.writeFileSync(
    path.join(catalogDir, "provider-failure-modes.json"),
    "[]",
    "utf8",
  );
  const rNotObj = spawnSync(
    process.execPath,
    [SCRIPT, "--providers", "claude", "--json"],
    { encoding: "utf8", timeout: 30_000, cwd: tmpDir },
  );
  check(
    "AC-3.2: non-object root → exit 1",
    rNotObj.status === 1,
    `exit=${rNotObj.status} stderr=${(rNotObj.stderr || "").slice(0, 200)}`,
  );
  check(
    "AC-3.2: non-object root → stderr contains schema_invalid",
    (rNotObj.stderr || "").includes("schema_invalid"),
  );

  // schema_invalid: missing entries map
  fs.writeFileSync(
    path.join(catalogDir, "provider-failure-modes.json"),
    '{"version": 1}',
    "utf8",
  );
  const rNoEntries = spawnSync(
    process.execPath,
    [SCRIPT, "--providers", "claude", "--json"],
    { encoding: "utf8", timeout: 30_000, cwd: tmpDir },
  );
  check("AC-3.2: missing entries map → exit 1", rNoEntries.status === 1);

  // Absent catalog: empty cwd with no catalog file at all → still passes
  // (soft fall back to catalog_version null; smoke continues).
  fs.unlinkSync(path.join(catalogDir, "provider-failure-modes.json"));
  const rNoCatalog = spawnSync(
    process.execPath,
    [SCRIPT, "--providers", "claude", "--json"],
    { encoding: "utf8", timeout: 30_000, cwd: tmpDir },
  );
  check(
    "AC-3.2: ABSENT catalog → exit 0 (claude probe still green, no entries)",
    rNoCatalog.status === 0,
    `exit=${rNoCatalog.status} stderr=${(rNoCatalog.stderr || "").slice(0, 200)}`,
  );
} finally {
  // Best-effort cleanup; Windows can keep a transient handle on logs even
  // after spawnSync returns, so we tolerate EBUSY here.
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) {
    /* ignore cleanup race */
  }
}

// ── AC-3.3: auth_source_mismatch catalog entry semantics ──────
//
// Verifies the on-disk catalog has the do_not_fall_back flag wired
// correctly. rcaFor() already exercises this from the rca tests; this
// check guards the catalog file itself against regression.
const fsCat = require("fs");
const realCatalogPath = path.resolve(
  __dirname,
  "..",
  "..",
  ".claude",
  "agents",
  "00-alex",
  ".system",
  "policy",
  "provider-failure-modes.json",
);
if (fsCat.existsSync(realCatalogPath)) {
  const catalogJson = JSON.parse(fsCat.readFileSync(realCatalogPath, "utf8"));
  const entries = (catalogJson && catalogJson.entries) || {};
  check(
    "AC-3.3: auth_source_mismatch.safe_to_autofix === false",
    entries.auth_source_mismatch &&
      entries.auth_source_mismatch.safe_to_autofix === false,
    JSON.stringify(entries.auth_source_mismatch || null),
  );
  check(
    "AC-3.3: auth_source_mismatch.fallback_allowed === false",
    entries.auth_source_mismatch &&
      entries.auth_source_mismatch.fallback_allowed === false,
  );
  // AC-3.1: every provider-health status must have a catalog entry.
  const REQUIRED_STATUSES = [
    "cli_missing",
    "auth_missing",
    "auth_source_mismatch",
    "model_not_found",
    "stale_cli_registry",
    "trusted_directory_required",
    "provider_timeout",
    "quota_exhausted",
    "free_tier_limit_zero",
    "unknown_error",
  ];
  for (const s of REQUIRED_STATUSES) {
    check(
      `AC-3.1: catalog covers status '${s}'`,
      !!entries[s],
      "missing entry",
    );
  }
  // Only trusted_directory_required and provider_timeout are safe-autofix
  // per the design phase β directive.
  const autofixable = Object.entries(entries)
    .filter(([_, v]) => v && v.safe_to_autofix === true)
    .map(([k]) => k)
    .sort();
  check(
    "T-021: exactly 2 safe-autofixable statuses (trusted_directory_required + provider_timeout)",
    autofixable.length === 2 &&
      autofixable.includes("trusted_directory_required") &&
      autofixable.includes("provider_timeout"),
    autofixable.join(","),
  );
}

// ── Summary ───────────────────────────────────────────────────

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(`OK — ${passed} cases passed`);
process.exit(0);
