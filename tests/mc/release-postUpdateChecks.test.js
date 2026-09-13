#!/usr/bin/env node
/**
 * release-postUpdateChecks.test.js — static test for T-20260513-020.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-020
 * Story:   S-2
 * AC:      AC-2.1, AC-2.2
 * REDTEAM: RT-4 (no shell interpolation in postUpdateChecks)
 *
 * Asserts the canonical release-skeleton generator (release-canonical.js
 * #buildSkeletonReleaseJson) emits a postUpdateChecks entry that runs
 * provider-smoke as the terminal check. The 0.5.0 release.json is sealed
 * and signed — we do NOT mutate published capsules. The provider-smoke
 * check rolls forward starting with the NEXT capsule.
 *
 * Also performs the RT-4 static lint over every existing release.json's
 * postUpdateChecks: no entry may contain shell interpolation tokens
 * ($(...), `...`, ${...}, |, ;, &&, ||, >).
 *
 * Run:
 *   node tests/mc/release-postUpdateChecks.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASES_DIR = path.join(REPO_ROOT, "framework", "releases");
const CANONICAL_SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "mc",
  "release-canonical.js",
);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`${name}: ${detail || "(no detail)"}`);
  }
}

// ── 1. Source-level: skeleton generator includes provider-smoke ──
//
// We grep the source rather than require() it because release-canonical.js
// has top-level side-effects guarded by `if (require.main === module)` —
// require()-ing under test is safe but slow. Plain string match suffices.

const canonicalSrc = fs.readFileSync(CANONICAL_SCRIPT, "utf8");
check(
  "skeleton generator contains provider-smoke postUpdateChecks entry",
  canonicalSrc.includes(
    "node scripts/mc/provider-smoke.js --providers claude,openai,gemini",
  ),
  "missing literal string in release-canonical.js#buildSkeletonReleaseJson",
);

// The provider-smoke entry must appear AFTER the existing checks (it's the
// terminal smoke gate per AC-2.1).
const buildBlock = canonicalSrc.match(/postUpdateChecks:\s*\[([\s\S]*?)\]/);
check(
  "skeleton generator: postUpdateChecks array parseable",
  buildBlock !== null,
);
if (buildBlock) {
  const arrayText = buildBlock[1];
  const lines = arrayText
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("//"));
  check(
    "skeleton generator: provider-smoke is final entry",
    lines.length > 0 && lines[lines.length - 1].includes("provider-smoke.js"),
    "tail entry: " + (lines[lines.length - 1] || "<empty>"),
  );
}

// ── 2. RT-4 static lint: no shell interpolation across every release.json ──
//
// Iterates every framework/releases/<version>/release.json and asserts
// that no postUpdateChecks entry contains a shell-interpolation token.
// This guards every existing release AND every future release (because
// /warp:release validates against this test in the release plan).

const FORBIDDEN_TOKENS = [
  "$(", // command substitution (sh/bash)
  "`", // backtick command substitution
  "${", // variable expansion
  "|", // pipe
  ";", // command separator
  "&&", // logical AND
  "||", // logical OR
  ">", // output redirect (rarely needed in a check command)
  "<", // input redirect
];

function lintEntry(entry, releaseVersion) {
  for (const token of FORBIDDEN_TOKENS) {
    if (entry.includes(token)) {
      return {
        ok: false,
        reason: `release ${releaseVersion}: '${entry}' contains forbidden token '${token}'`,
      };
    }
  }
  // Must be a known shape. We allow either:
  //   `node <path>...`   — Node CLI invocation (current shape)
  //   `/<cmd>:<sub>`     — MC slash-command invocation (legacy capsules)
  // both of which are literal static strings consumed by /warp:update.
  const isNode = entry.startsWith("node ");
  const isSlashCmd = /^\/[a-z][a-z0-9-]*:[a-z][a-z0-9-]*(\s|$)/.test(entry);
  if (!isNode && !isSlashCmd) {
    return {
      ok: false,
      reason: `release ${releaseVersion}: '${entry}' is neither 'node ...' nor '/cmd:sub'`,
    };
  }
  return { ok: true };
}

const versions = fs.readdirSync(RELEASES_DIR).filter((d) => {
  return fs.statSync(path.join(RELEASES_DIR, d)).isDirectory();
});

check(
  "fixture: release directories discovered",
  versions.length > 0,
  `versions=${versions.length}`,
);

let totalEntries = 0;
for (const v of versions) {
  const rj = path.join(RELEASES_DIR, v, "release.json");
  if (!fs.existsSync(rj)) continue;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(rj, "utf8"));
  } catch (e) {
    check(`release ${v}: release.json is valid JSON`, false, e.message);
    continue;
  }
  const checks = Array.isArray(parsed.postUpdateChecks)
    ? parsed.postUpdateChecks
    : [];
  for (const entry of checks) {
    totalEntries++;
    if (typeof entry !== "string") {
      check(
        `release ${v}: entry is string`,
        false,
        `non-string entry: ${typeof entry}`,
      );
      continue;
    }
    const lint = lintEntry(entry, v);
    check(`RT-4 release ${v}: '${entry.slice(0, 60)}'`, lint.ok, lint.reason);
  }
}

check(
  "fixture: at least one postUpdateChecks entry scanned across capsules",
  totalEntries > 0,
);

// ── 3. AC-2.1: invocation contract — provider-smoke entry is a known shape ──
//
// The smoke entry MUST be `node scripts/mc/provider-smoke.js
// --providers claude,openai,gemini` (literal, no flags that change
// semantics under postUpdateChecks). The release-canonical generator now
// emits this; once a 0.5.1+ capsule ships, every release.json scanned
// above will also contain it.

const SMOKE_ENTRY =
  "node scripts/mc/provider-smoke.js --providers claude,openai,gemini";
check(
  "AC-2.1: provider-smoke entry literal is well-formed (no shell-meta)",
  lintEntry(SMOKE_ENTRY, "synthetic").ok,
);

// ── Summary ───────────────────────────────────────────────────

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(`OK — ${passed} cases passed`);
process.exit(0);
