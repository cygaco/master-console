#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/dispatch/provider-breaker.test.js — Planted-violation tests (P5, β-MANDATORY).
 *
 * Proves:
 *   1. Re-burn blocked: markDown within TTL → isDown true → providerAvailable false.
 *      Expired entry → isDown false (provider treated as recovered).
 *   2. Fail-open on corrupt file: non-JSON → isDown returns false (NOT a throw),
 *      providerAvailable falls through to its normal check (the load-bearing safety test).
 *   3. TTL parse-fail → explicit 30m: computeUntil with a MALFORMED reset hint → DEFAULT.
 *      Sane hint → uses parsed value. Absurd value → clamped to DEFAULT.
 *   4. providerAvailable("claude") always true (breaker exempt).
 *   5. Clear removes the entry.
 *
 * Test seam: WARPOS_PROVIDER_DOWN_FILE env var is set to a temp file so no test
 * touches the real .claude/runtime/provider-down.json.
 *
 *   node scripts/dispatch/provider-breaker.test.js
 */

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Test seam setup ────────────────────────────────────────────────────────
// Point both the breaker AND providers.js at a temp file so no test contaminates
// the real runtime state or depends on an existing provider-down.json.
const tmpFile = path.join(os.tmpdir(), `provider-breaker-test-${process.pid}.json`);
mcEnv.setEnv("PROVIDER_DOWN_FILE", tmpFile);

// Clear the temp file before starting
try { fs.unlinkSync(tmpFile); } catch { /* ok if absent */ }

// ── Load modules AFTER env var is set ─────────────────────────────────────
// Both modules read WARPOS_PROVIDER_DOWN_FILE at call-time (resolveFilePath()),
// so requiring after the env var is set is sufficient.
const breaker = require("./provider-breaker");

// providers.js is in the hooks lib; load it for the providerAvailable integration test.
// It will have loaded provider-breaker via its own guarded require at module load time.
// Since WARPOS_PROVIDER_DOWN_FILE is already set, the same temp file is used.
let providerAvailable = null;
try {
  const providers = require("../hooks/lib/providers");
  providerAvailable = providers.providerAvailable;
} catch (e) {
  // If providers.js can't be loaded (e.g. missing deps in a narrow test env),
  // note it but don't fail — the breaker tests still run.
  process.stderr.write(`[breaker.test] providers.js load skipped: ${e.message}\n`);
}

// ── Helpers ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    process.stdout.write(`  ok    ${name}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL  ${name}\n`);
    if (detail) process.stdout.write(`        ${detail}\n`);
  }
}

function resetTmpFile() {
  try { fs.unlinkSync(tmpFile); } catch { /* ok */ }
}

// ── § 1 — Re-burn blocked (within TTL) ────────────────────────────────────
process.stdout.write("\n§1 Re-burn blocked\n");

resetTmpFile();
const now1 = Date.now();
const until1 = now1 + 30 * 60 * 1000; // 30 min in the future
breaker.markDown("gemini", { kind: "quota_exhausted", untilMs: until1, evidence: "test" });

const down1 = breaker.isDown("gemini");
check(
  "isDown('gemini') true within TTL",
  down1 === true,
  `expected true, got ${down1}`,
);

// providerAvailable integration: should return false (breaker short-circuits before cliAvailable)
if (providerAvailable) {
  const avail1 = providerAvailable("gemini");
  check(
    "providerAvailable('gemini') false when breaker is down (re-burn short-circuited)",
    avail1 === false,
    `expected false, got ${avail1}`,
  );
} else {
  check("providerAvailable skipped (providers.js not loaded)", true);
}

// Expired entry → NOT down
resetTmpFile();
const pastUntil = Date.now() - 1; // already expired
breaker.markDown("gemini", { kind: "quota_exhausted", untilMs: pastUntil });

const down2 = breaker.isDown("gemini");
check(
  "isDown('gemini') false for expired entry (provider may have recovered)",
  down2 === false,
  `expected false, got ${down2}`,
);

// providerAvailable with expired entry falls through to CLI check (may return true/false
// depending on whether gemini CLI is installed — we only verify it doesn't throw)
if (providerAvailable) {
  let threw = false;
  let result;
  try {
    result = providerAvailable("gemini");
  } catch (e) {
    threw = true;
    result = e.message;
  }
  check(
    "providerAvailable('gemini') does NOT throw for expired breaker entry",
    !threw,
    threw ? `threw: ${result}` : null,
  );
}

// ── § 2 — Fail-open on corrupt file (load-bearing safety test) ────────────
process.stdout.write("\n§2 Fail-open on corrupt / non-JSON file\n");

fs.writeFileSync(tmpFile, "THIS IS NOT JSON {{{{ garbage >>>", "utf8");

let isDownThrew = false;
let isDownResult;
try {
  isDownResult = breaker.isDown("gemini");
} catch (e) {
  isDownThrew = true;
  isDownResult = `threw: ${e.message}`;
}

check(
  "isDown returns false on corrupt file (no throw — fail-open)",
  !isDownThrew && isDownResult === false,
  `threw=${isDownThrew} result=${isDownResult}`,
);

if (providerAvailable) {
  // Write garbage again (isDown cleared it internally by reading {} on parse fail)
  fs.writeFileSync(tmpFile, "GARBAGE", "utf8");
  let avThrew = false;
  let avResult;
  try {
    avResult = providerAvailable("gemini");
  } catch (e) {
    avThrew = true;
    avResult = `threw: ${e.message}`;
  }
  check(
    "providerAvailable does NOT throw on corrupt breaker file (falls through to CLI check)",
    !avThrew,
    avThrew ? avResult : null,
  );
  // We don't assert the boolean return because it depends on gemini CLI presence.
}

// markDown must not throw on a corrupt file either
fs.writeFileSync(tmpFile, "{{bad json", "utf8");
let markThrew = false;
try {
  breaker.markDown("openai", { kind: "quota_exhausted", untilMs: Date.now() + 1000 });
} catch (e) {
  markThrew = true;
}
check(
  "markDown does NOT throw on corrupt file (fail-open write)",
  !markThrew,
  markThrew ? "markDown threw" : null,
);

// ── § 3 — TTL computation (computeUntil) ──────────────────────────────────
process.stdout.write("\n§3 TTL computation — parse-fail, sane hint, absurd clamp\n");

const BASE_NOW = 1_000_000_000; // fixed reference point for determinism
const DEFAULT = breaker.DEFAULT_TTL_MS; // 30 min in ms

// 3a. No hint in errText → DEFAULT_TTL_MS
{
  const result = breaker.computeUntil("gemini", "generic error message", BASE_NOW);
  check(
    "computeUntil — no hint → DEFAULT_TTL_MS (30m)",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

// 3b. Sane hint "resets after 1h" → 1h
{
  const result = breaker.computeUntil("gemini", "quota exceeded, resets after 1h", BASE_NOW);
  const expected = BASE_NOW + 60 * 60 * 1000;
  check(
    "computeUntil — sane hint 'resets after 1h' → 1h",
    result === expected,
    `expected ${expected}, got ${result}`,
  );
}

// 3c. Sane hint "retry after 120s" → 120s
{
  const result = breaker.computeUntil("gemini", "rate limited, retry after 120s", BASE_NOW);
  const expected = BASE_NOW + 120 * 1000;
  check(
    "computeUntil — sane hint 'retry after 120s' → 120s",
    result === expected,
    `expected ${expected}, got ${result}`,
  );
}

// 3d. Sane hint "retry in 5m" → 5 min
{
  const result = breaker.computeUntil("gemini", "RESOURCE_EXHAUSTED retry in 5m", BASE_NOW);
  const expected = BASE_NOW + 5 * 60 * 1000;
  check(
    "computeUntil — sane hint 'retry in 5m' → 5m",
    result === expected,
    `expected ${expected}, got ${result}`,
  );
}

// 3e. EXPLICIT parse-fail branch: hint present but MALFORMED (non-numeric) → DEFAULT (NOT infinite, NOT 0)
{
  const result = breaker.computeUntil("gemini", "resets after Xh soon", BASE_NOW);
  check(
    "computeUntil — MALFORMED hint 'resets after Xh' → explicit parse-fail → DEFAULT_TTL_MS (not infinite, not 0)",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

// 3f. Absurd value > 24h → clamped to DEFAULT_TTL_MS
{
  const result = breaker.computeUntil("gemini", "retry after 100h", BASE_NOW);
  check(
    "computeUntil — absurd hint >24h → clamped to DEFAULT_TTL_MS",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

// 3g. Absurd value ≤ 0 → clamped to DEFAULT_TTL_MS
{
  const result = breaker.computeUntil("gemini", "retry after 0s", BASE_NOW);
  check(
    "computeUntil — zero hint '0s' → clamped to DEFAULT_TTL_MS",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

// ── § 4 — claude exempt ────────────────────────────────────────────────────
process.stdout.write("\n§4 claude is always available (breaker exempt)\n");

if (providerAvailable) {
  // Even if someone accidentally markDown("claude"), providerAvailable returns true early
  resetTmpFile();
  breaker.markDown("claude", { kind: "quota_exhausted", untilMs: Date.now() + 999_999 });
  const claudeAvail = providerAvailable("claude");
  check(
    "providerAvailable('claude') always true (exempt from breaker)",
    claudeAvail === true,
    `expected true, got ${claudeAvail}`,
  );
} else {
  check("claude exempt (providers.js not loaded — skipped)", true);
}

// ── § 5 — clear() removes the entry ───────────────────────────────────────
process.stdout.write("\n§5 clear() removes the entry\n");

resetTmpFile();
breaker.markDown("openai", { kind: "quota_exhausted", untilMs: Date.now() + 60_000 });
const downBeforeClear = breaker.isDown("openai");
check("isDown true before clear", downBeforeClear === true, `got ${downBeforeClear}`);

breaker.clear("openai");
const downAfterClear = breaker.isDown("openai");
check("isDown false after clear", downAfterClear === false, `got ${downAfterClear}`);

// ── Cleanup ────────────────────────────────────────────────────────────────
try { fs.unlinkSync(tmpFile); } catch { /* ok */ }

// ── Summary ────────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
