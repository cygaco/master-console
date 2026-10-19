#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmpFile = path.join(os.tmpdir(), `provider-breaker-test-${process.pid}.json`);
mcEnv.setEnv("PROVIDER_DOWN_FILE", tmpFile);

try { fs.unlinkSync(tmpFile); } catch { }

const breaker = require("./provider-breaker");

let providerAvailable = null;
try {
  const providers = require("../hooks/lib/providers");
  providerAvailable = providers.providerAvailable;
} catch (e) {
  process.stderr.write(`[breaker.test] providers.js load skipped: ${e.message}\n`);
}

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
  try { fs.unlinkSync(tmpFile); } catch { }
}

process.stdout.write("\n§1 Re-burn blocked\n");

resetTmpFile();
const now1 = Date.now();
const until1 = now1 + 30 * 60 * 1000;
breaker.markDown("gemini", { kind: "quota_exhausted", untilMs: until1, evidence: "test" });

const down1 = breaker.isDown("gemini");
check(
  "isDown('gemini') true within TTL",
  down1 === true,
  `expected true, got ${down1}`,
);

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

resetTmpFile();
const pastUntil = Date.now() - 1;
breaker.markDown("gemini", { kind: "quota_exhausted", untilMs: pastUntil });

const down2 = breaker.isDown("gemini");
check(
  "isDown('gemini') false for expired entry (provider may have recovered)",
  down2 === false,
  `expected false, got ${down2}`,
);

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
}

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

process.stdout.write("\n§3 TTL computation — parse-fail, sane hint, absurd clamp\n");

const BASE_NOW = 1_000_000_000;
const DEFAULT = breaker.DEFAULT_TTL_MS;

{
  const result = breaker.computeUntil("gemini", "generic error message", BASE_NOW);
  check(
    "computeUntil — no hint → DEFAULT_TTL_MS (30m)",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

{
  const result = breaker.computeUntil("gemini", "quota exceeded, resets after 1h", BASE_NOW);
  const expected = BASE_NOW + 60 * 60 * 1000;
  check(
    "computeUntil — sane hint 'resets after 1h' → 1h",
    result === expected,
    `expected ${expected}, got ${result}`,
  );
}

{
  const result = breaker.computeUntil("gemini", "rate limited, retry after 120s", BASE_NOW);
  const expected = BASE_NOW + 120 * 1000;
  check(
    "computeUntil — sane hint 'retry after 120s' → 120s",
    result === expected,
    `expected ${expected}, got ${result}`,
  );
}

{
  const result = breaker.computeUntil("gemini", "RESOURCE_EXHAUSTED retry in 5m", BASE_NOW);
  const expected = BASE_NOW + 5 * 60 * 1000;
  check(
    "computeUntil — sane hint 'retry in 5m' → 5m",
    result === expected,
    `expected ${expected}, got ${result}`,
  );
}

{
  const result = breaker.computeUntil("gemini", "resets after Xh soon", BASE_NOW);
  check(
    "computeUntil — MALFORMED hint 'resets after Xh' → explicit parse-fail → DEFAULT_TTL_MS (not infinite, not 0)",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

{
  const result = breaker.computeUntil("gemini", "retry after 100h", BASE_NOW);
  check(
    "computeUntil — absurd hint >24h → clamped to DEFAULT_TTL_MS",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

{
  const result = breaker.computeUntil("gemini", "retry after 0s", BASE_NOW);
  check(
    "computeUntil — zero hint '0s' → clamped to DEFAULT_TTL_MS",
    result === BASE_NOW + DEFAULT,
    `expected ${BASE_NOW + DEFAULT}, got ${result}`,
  );
}

process.stdout.write("\n§4 claude is always available (breaker exempt)\n");

if (providerAvailable) {
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

process.stdout.write("\n§5 clear() removes the entry\n");

resetTmpFile();
breaker.markDown("openai", { kind: "quota_exhausted", untilMs: Date.now() + 60_000 });
const downBeforeClear = breaker.isDown("openai");
check("isDown true before clear", downBeforeClear === true, `got ${downBeforeClear}`);

breaker.clear("openai");
const downAfterClear = breaker.isDown("openai");
check("isDown false after clear", downAfterClear === false, `got ${downAfterClear}`);

try { fs.unlinkSync(tmpFile); } catch { }

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
