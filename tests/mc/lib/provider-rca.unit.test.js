#!/usr/bin/env node
/**
 * provider-rca.unit.test.js — unit tests for T-20260513-022.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-022
 * Story:   S-4
 * AC:      AC-4.1, AC-4.2, AC-4.3
 *
 * Pattern mirrors tests/mc/provider-smoke.unit.test.js: plain Node, no
 * Jest, hand-rolled `check()` + counters. Exit 0 on pass, 1 on fail.
 *
 * Run:
 *   node tests/mc/lib/provider-rca.unit.test.js
 *
 * Coverage:
 *   AC-4.1 — non-green status -> rca entry with root_cause from catalog
 *   AC-4.2 — unknown status   -> unknown_error root_cause, status PRESERVED
 *   AC-4.3 — green results    -> excluded from output
 *   Defensive — null/undefined inputs, missing catalog entries, malformed rows
 *   Schema  — output entry shape matches the documented 7-key contract
 *   Determinism — same input twice -> identical output (no hidden state)
 */

"use strict";

const path = require("path");

const RCA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "mc",
  "lib",
  "provider-rca.js",
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

const { rcaFor, HARDCODED_UNKNOWN_FALLBACK } = require(RCA_PATH);
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

// Helper to find the rca entry for a given provider (tests work with small
// result lists, so a linear find is fine).
function entryFor(rca, provider) {
  return rca.find((e) => e.provider === provider);
}

// ── catalog sanity (the real, on-disk catalog) ────────────────

check(
  "catalog: loaded with entries map",
  catalog && typeof catalog.entries === "object",
);
check(
  "catalog: has unknown_error entry (required for AC-4.2)",
  !!catalog.entries.unknown_error,
);

// ── AC-4.3 — green results excluded ───────────────────────────

const r1 = rcaFor(
  [
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "ok" },
    { provider: "gemini", status: "ok" },
  ],
  catalog,
);
check("AC-4.3: all green -> empty rca", Array.isArray(r1) && r1.length === 0);

const r2 = rcaFor(
  [
    { provider: "claude", status: "ok" },
    { provider: "openai", status: "auth_missing" },
    { provider: "gemini", status: "ok" },
  ],
  catalog,
);
check(
  "AC-4.3: green entries dropped, only non-green kept",
  r2.length === 1 && r2[0].provider === "openai",
  JSON.stringify(r2),
);

// ── AC-4.1 — known status maps to catalog entry ──────────────

const r3 = rcaFor([{ provider: "gemini", status: "model_not_found" }], catalog);
check("AC-4.1: model_not_found -> one rca entry", r3.length === 1);
check(
  "AC-4.1: model_not_found root_cause matches catalog",
  r3[0].root_cause === catalog.entries.model_not_found.root_cause,
  JSON.stringify(r3[0]),
);
check(
  "AC-4.1: model_not_found preserves provider",
  r3[0].provider === "gemini",
);
check(
  "AC-4.1: model_not_found preserves status",
  r3[0].status === "model_not_found",
);
check(
  "AC-4.1: model_not_found safe_to_autofix=false",
  r3[0].safe_to_autofix === false,
);

// auth_source_mismatch — yellow but special (fallback_allowed=false)
const r4 = rcaFor(
  [{ provider: "openai", status: "auth_source_mismatch" }],
  catalog,
);
check(
  "AC-4.1: auth_source_mismatch -> safe_to_autofix=false",
  r4[0].safe_to_autofix === false,
);
check(
  "AC-4.1: auth_source_mismatch -> fallback_allowed=false",
  r4[0].fallback_allowed === false,
  JSON.stringify(r4[0]),
);

// trusted_directory_required — safe-to-autofix=true with fix_recipe
const r5 = rcaFor(
  [{ provider: "gemini", status: "trusted_directory_required" }],
  catalog,
);
check(
  "AC-4.1: trusted_directory_required -> safe_to_autofix=true",
  r5[0].safe_to_autofix === true,
);
check(
  "AC-4.1: trusted_directory_required -> fix_recipe is object (not null)",
  r5[0].fix_recipe !== null && typeof r5[0].fix_recipe === "object",
);
check(
  "AC-4.1: trusted_directory_required -> fix_recipe.kind = set_env_and_reprobe",
  r5[0].fix_recipe && r5[0].fix_recipe.kind === "set_env_and_reprobe",
);

// provider_timeout — safe-to-autofix=true with retry recipe
const r6 = rcaFor(
  [{ provider: "claude", status: "provider_timeout" }],
  catalog,
);
check(
  "AC-4.1: provider_timeout -> safe_to_autofix=true",
  r6[0].safe_to_autofix === true,
);
check(
  "AC-4.1: provider_timeout -> fix_recipe.kind = retry_with_same_timeout",
  r6[0].fix_recipe && r6[0].fix_recipe.kind === "retry_with_same_timeout",
);

// cli_missing
const r7 = rcaFor([{ provider: "openai", status: "cli_missing" }], catalog);
check(
  "AC-4.1: cli_missing root_cause matches catalog",
  r7[0].root_cause === catalog.entries.cli_missing.root_cause,
);
check(
  "AC-4.1: cli_missing fallback_allowed=true",
  r7[0].fallback_allowed === true,
);

// ── AC-4.2 — unknown status falls back to unknown_error root_cause but
// preserves the OBSERVED status string ────────────────────────

const r8 = rcaFor(
  [{ provider: "claude", status: "never_seen_before" }],
  catalog,
);
check("AC-4.2: unknown status -> one rca entry", r8.length === 1);
check(
  "AC-4.2: unknown status -> root_cause from unknown_error entry",
  r8[0].root_cause === catalog.entries.unknown_error.root_cause,
  JSON.stringify(r8[0]),
);
check(
  "AC-4.2: unknown status -> PRESERVES observed status (does not rewrite)",
  r8[0].status === "never_seen_before",
);
check(
  "AC-4.2: unknown status -> safe_to_autofix=false",
  r8[0].safe_to_autofix === false,
);
check(
  "AC-4.2: unknown status -> does not throw on multiple unknowns",
  rcaFor(
    [
      { provider: "a", status: "weird1" },
      { provider: "b", status: "weird2" },
    ],
    catalog,
  ).length === 2,
);

// ── Multi-row: mix of green, known-red, unknown-red ────────────

const rMix = rcaFor(
  [
    { provider: "claude", status: "ok" }, // dropped
    { provider: "openai", status: "auth_missing" }, // known
    { provider: "gemini", status: "fictional_status" }, // unknown
  ],
  catalog,
);
check(
  "multi-row: mix produces 2 rca entries (green dropped)",
  rMix.length === 2,
);
check(
  "multi-row: openai uses auth_missing catalog entry",
  entryFor(rMix, "openai").root_cause ===
    catalog.entries.auth_missing.root_cause,
);
check(
  "multi-row: gemini uses unknown_error root_cause but keeps observed status",
  entryFor(rMix, "gemini").root_cause ===
    catalog.entries.unknown_error.root_cause &&
    entryFor(rMix, "gemini").status === "fictional_status",
);

// ── Defensive: null/undefined/empty inputs ─────────────────────

check("defensive: null results -> []", rcaFor(null, catalog).length === 0);
check(
  "defensive: undefined results -> []",
  rcaFor(undefined, catalog).length === 0,
);
check("defensive: empty results -> []", rcaFor([], catalog).length === 0);
check(
  "defensive: non-array results (object) -> []",
  rcaFor({ provider: "x" }, catalog).length === 0,
);

// ── Defensive: malformed result rows ──────────────────────────

check(
  "defensive: result with no status -> uses unknown_error fallback",
  rcaFor([{ provider: "foo" }], catalog).length === 1 &&
    rcaFor([{ provider: "foo" }], catalog)[0].root_cause ===
      catalog.entries.unknown_error.root_cause,
);
check(
  "defensive: null result row skipped",
  rcaFor([null, { provider: "foo", status: "auth_missing" }], catalog)
    .length === 1,
);
check(
  "defensive: non-object result row skipped",
  rcaFor(["string-row", { provider: "foo", status: "auth_missing" }], catalog)
    .length === 1,
);

// ── Defensive: catalog missing / corrupt ──────────────────────

const rNoCat = rcaFor([{ provider: "openai", status: "auth_missing" }], null);
check("defensive: null catalog still emits rca", rNoCat.length === 1);
check(
  "defensive: null catalog -> root_cause from hardcoded fallback",
  rNoCat[0].root_cause === HARDCODED_UNKNOWN_FALLBACK.root_cause,
  JSON.stringify(rNoCat[0]),
);
check(
  "defensive: null catalog -> safe_to_autofix=false",
  rNoCat[0].safe_to_autofix === false,
);
check(
  "defensive: null catalog -> preserves observed status",
  rNoCat[0].status === "auth_missing",
);

const rEmptyEntries = rcaFor([{ provider: "openai", status: "auth_missing" }], {
  entries: {},
});
check(
  "defensive: empty entries map -> hardcoded fallback root_cause",
  rEmptyEntries[0].root_cause === HARDCODED_UNKNOWN_FALLBACK.root_cause,
);

const rMissingUnknown = rcaFor([{ provider: "openai", status: "weird" }], {
  entries: { cli_missing: catalog.entries.cli_missing },
});
check(
  "defensive: catalog missing unknown_error -> hardcoded fallback used",
  rMissingUnknown[0].root_cause === HARDCODED_UNKNOWN_FALLBACK.root_cause,
);

// ── Schema: every rca entry has the 7 documented keys ─────────

const rSchema = rcaFor(
  [{ provider: "gemini", status: "auth_source_mismatch" }],
  catalog,
);
const REQUIRED_KEYS = [
  "provider",
  "status",
  "root_cause",
  "safe_to_autofix",
  "fix_recipe",
  "remediation",
  "fallback_allowed",
];
for (const k of REQUIRED_KEYS) {
  check(
    `schema: rca entry contains key '${k}'`,
    Object.prototype.hasOwnProperty.call(rSchema[0], k),
    JSON.stringify(Object.keys(rSchema[0])),
  );
}

// ── Determinism: same input twice -> identical output ─────────

const detIn = [
  { provider: "claude", status: "ok" },
  { provider: "openai", status: "auth_missing" },
  { provider: "gemini", status: "cli_missing" },
];
const detA = JSON.stringify(rcaFor(detIn, catalog));
const detB = JSON.stringify(rcaFor(detIn, catalog));
check("determinism: same input -> identical JSON output", detA === detB);

// ── No-throw guarantee under hostile input ────────────────────

let threw = false;
try {
  rcaFor(
    [
      { provider: "x", status: 42 }, // non-string status
      { provider: null, status: "auth_missing" }, // null provider
      { provider: "y", status: "" }, // empty-string status
      { provider: "z" }, // no status field
    ],
    catalog,
  );
} catch (e) {
  threw = true;
}
check("no-throw: hostile rows don't throw", threw === false);

// ── Summary ───────────────────────────────────────────────────

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(`OK — ${passed} cases passed`);
process.exit(0);
