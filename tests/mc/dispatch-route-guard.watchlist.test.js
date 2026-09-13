#!/usr/bin/env node
/**
 * dispatch-route-guard.watchlist.test.js — T-20260513-026.
 *
 * Sprint:  SP-20260513-002
 * Ticket:  T-20260513-026
 * Story:   S-8
 * AC:      AC-8.1, AC-8.2
 * TRACE:   TR-7
 *
 * Exercises the dispatch-route-guard pattern matcher (findForbidden) against
 * the bug class that has bitten this codebase repeatedly:
 *
 *   - LRN-2026-04-17-n  cmd.exe stdin: `cat <file> | codex exec` re-introduced
 *                       the Windows-stdin bug 13 days after the lib-only fix.
 *   - LRN-2026-04-30    binding-gap: phase-1/2 review agents bypassed runProvider
 *                       and called `cat <file> | codex exec ...` from Bash.
 *
 * These are the patterns provider-smoke is built to detect at probe time.
 * This test pins down the WATCHLIST: every variant a future caller might
 * use to bypass scripts/mc/provider-smoke.js with a raw provider call
 * must be blocked by the dispatch-route-guard hook BEFORE it ever runs.
 *
 * AC-8.1: source-level invariant — scripts/mc/provider-smoke.js and
 *         scripts/mc/lib/provider-*.js must contain ZERO occurrences
 *         of the `cat ... | (codex|gemini)` pattern in code (comments OK).
 *
 * AC-8.2: behavioural invariant — the guard's findForbidden() must block
 *         every cmd.exe-stdin variant. Failure of any case here means the
 *         next contributor can re-introduce the bug; smoke surface does
 *         NOT introduce a bypass path.
 *
 * Run:
 *   node tests/mc/dispatch-route-guard.watchlist.test.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(
  REPO_ROOT,
  "scripts",
  "hooks",
  "dispatch-route-guard.js",
);

const { findForbidden, findHeavySkillAdvisory } = require(GUARD);

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

// ── 1. cmd.exe stdin bug class — every variant must be blocked ─

const BLOCKED_CMDS = [
  // LRN-2026-04-17-n: literal repro
  "cat prompt.txt | codex exec --model gpt-5",
  // LRN-2026-04-30: phase-1 review-agent repro
  "cat /tmp/review-prompt.txt | codex exec",
  // Variant: type-pipe on Windows (alias for cat)
  // (the guard sees the | codex pattern regardless of source program)
  "type prompt.txt | codex exec --model gpt-5-codex",
  // Pipe into gemini -p (re-uses gemini prompt mode)
  "cat prompt.txt | gemini -p",
  // Bare `codex exec` without dispatch-agent.js prefix
  "codex exec --model gpt-5 --prompt 'hi'",
  // Bare `gemini -p`
  "gemini -p 'classify this'",
  // Bare `claude -p` without --agent
  "claude -p 'summarize this'",
  // N5 (W2): raw `claude -p --agent <cross-provider-reviewer>` is RECORDLESS — must use the
  // RECORDED --review-fallback lane (dispatch-claude.js). Blocked by role AND by legacy alias.
  "claude -p --agent backend-reviewer /tmp/p.txt",
  "claude -p --agent security-reviewer /tmp/p.txt",
  "claude -p --agent qa-reviewer /tmp/prompt.txt", // current cross-provider reviewer name
  // N5 gauntlet hardening — quoted-token + multi-flag evasions must STILL block (they execute raw):
  '"claude" -p --agent qa-reviewer /tmp/p.txt', // quoted claude token
  'claude "-p" --agent backend-reviewer /tmp/p.txt', // quoted -p token
  "claude -p --agent general-purpose --agent qa-reviewer /tmp/p.txt", // multi --agent (last-wins)
  // N5 gauntlet round-2 hardening — path-qualified + backslash-escaped command tokens still block:
  "/usr/local/bin/claude -p --agent qa-reviewer /tmp/p.txt", // path-qualified executable
  "claude.exe -p --agent backend-reviewer /tmp/p.txt", // .exe form
  "c\\laude -p --agent security-reviewer /tmp/p.txt", // backslash-escaped command token (c\laude → claude)
];

for (const cmd of BLOCKED_CMDS) {
  const hit = findForbidden(cmd);
  check(
    `BLOCKED (watchlist): ${cmd.slice(0, 60)}`,
    hit !== null,
    `findForbidden returned null for command: ${cmd}`,
  );
}

// ── 2. Allowed shapes — provider-smoke's safe surfaces must pass ─

const ALLOWED_CMDS = [
  // The canonical wrapper — always allowed
  "node scripts/dispatch-agent.js qa /tmp/prompt.txt",
  "node scripts/dispatch/dispatch-agent.js redteam /tmp/p.txt",
  // Version / help calls (never go to prompt mode)
  "codex --version",
  "gemini --help",
  "claude --version",
  // models list / auth status calls
  "codex models list",
  "gemini auth status",
  // The Claude documented fallback — allowed for NON-review roles (N5 redirects cross-provider
  // review roles to the recorded --review-fallback lane). general-purpose = dispatch-skill's path;
  // design-quality = a claude-pinned judge — both still fall through (no recorded-fallback lane).
  "claude -p --agent general-purpose /tmp/prompt.txt",
  "claude -p --agent design-quality /tmp/prompt.txt",
  // N5 false-positive guard: a literal `claude -p --agent <reviewer>` INSIDE a quoted arg (e.g. a
  // commit message) is ONE shell token → must NOT block (the quoted-blob the detection preserves).
  'git commit -m "switching from claude -p --agent qa-reviewer to the recorded lane"',
  // N5 round-2 false-positive guard: separately-quoted literal tokens passed to ANOTHER program
  // (claude is NOT at a command position) must NOT block.
  'printf "%s " "claude" "-p" "--agent" "qa-reviewer"',
  // Provider-smoke itself — never invokes a prompt CLI, just probes
  "node scripts/mc/provider-smoke.js --providers claude,openai,gemini",
  "node scripts/mc/provider-smoke.js --json --no-autofix",
  "node scripts/mc/provider-smoke.js --probe list --providers gemini",
];

for (const cmd of ALLOWED_CMDS) {
  const hit = findForbidden(cmd);
  check(
    `ALLOWED: ${cmd.slice(0, 60)}`,
    hit === null,
    `findForbidden returned ${JSON.stringify(hit)} for command: ${cmd}`,
  );
}

// ── 3. AC-8.1: provider-smoke surface source-level invariant ──

const SURFACE_FILES = [
  path.join(REPO_ROOT, "scripts", "mc", "provider-smoke.js"),
  path.join(REPO_ROOT, "scripts", "mc", "lib", "provider-rca.js"),
  path.join(REPO_ROOT, "scripts", "mc", "lib", "provider-autofix.js"),
];

function stripJsComments(s) {
  let out = s.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return out;
}

const SOURCE_FORBIDDEN_PATTERNS = [
  // Anchor at the actual bug class — pipe-into-provider as command-line input
  { name: "cat | codex", re: /cat\s+[^\n]*\|\s*codex\b/ },
  { name: "cat | gemini", re: /cat\s+[^\n]*\|\s*gemini\b/ },
  { name: "type | codex", re: /\btype\s+[^\n]*\|\s*codex\b/ },
  // direct exec invocation outside the canonical dispatch wrapper
  { name: "codex exec (direct)", re: /\bcodex\s+exec\b/ },
  { name: "gemini -p (direct)", re: /\bgemini\s+-p\b/ },
];

for (const file of SURFACE_FILES) {
  if (!fs.existsSync(file)) {
    check(`surface file exists: ${path.basename(file)}`, false, "missing");
    continue;
  }
  const src = fs.readFileSync(file, "utf8");
  const code = stripJsComments(src);
  for (const pat of SOURCE_FORBIDDEN_PATTERNS) {
    check(
      `AC-8.1 ${path.basename(file)}: no ${pat.name}`,
      pat.re.test(code) === false,
      `pattern found in code (not just comments)`,
    );
  }
}

// ── 4. Edge cases: provider-smoke must not introduce a new bypass ──

// Whitespace variants of the bug class
const EDGE_VARIANTS = [
  "cat  prompt.txt  |  codex  exec", // extra whitespace
  "  cat prompt.txt | codex exec", // leading whitespace
  "cat prompt.txt|codex exec", // no whitespace around pipe
];
for (const cmd of EDGE_VARIANTS) {
  const hit = findForbidden(cmd);
  check(
    `EDGE BLOCKED: '${cmd}'`,
    hit !== null,
    `whitespace edge case slipped through the matcher`,
  );
}

// One-shot bypass: WARPOS_PROVIDER_PROBE=1 in env. The guard's probeBypass
// only runs in the actual hook plumbing; findForbidden ignores env so the
// pure-function matcher always blocks. We assert that here so callers
// understand the boundary.
const probeShape = "cat prompt.txt | codex exec";
const probeHit = findForbidden(probeShape);
check(
  "WARPOS_PROVIDER_PROBE escape hatch lives in hook, not in matcher",
  probeHit !== null,
  "findForbidden should be env-agnostic; bypass logic is in probeBypass()",
);

// ── 5. RT-2 catalog lint cross-check (sanity) ──
//
// The autofix dispatcher and the catalog itself are tested in their own
// suites. We do one cheap sanity check here to keep T-026 (the watchlist
// suite) load-bearing for the end-to-end RT-2 invariant:
//   No catalog entry with safe_to_autofix=true may have a fix_recipe whose
//   `env` mutates a forbidden auth substring.

const CATALOG = path.join(
  REPO_ROOT,
  ".claude",
  "agents",
  "00-alex",
  ".system",
  "policy",
  "provider-failure-modes.json",
);
const FORBIDDEN_ENV_SUBSTRINGS = [
  "API_KEY",
  "TOKEN",
  "SECRET",
  "AUTH",
  "PASSWORD",
  "PASSWD",
  "CREDENTIAL",
  "OAUTH",
  "SESSION",
  "BEARER",
];

if (fs.existsSync(CATALOG)) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const entries = (cat && cat.entries) || {};
  for (const [status, entry] of Object.entries(entries)) {
    if (!entry || entry.safe_to_autofix !== true) continue;
    const recipe = entry.fix_recipe;
    if (!recipe || !recipe.env || typeof recipe.env !== "object") continue;
    for (const key of Object.keys(recipe.env)) {
      const upper = String(key).toUpperCase();
      const sus = FORBIDDEN_ENV_SUBSTRINGS.find((s) => upper.includes(s));
      check(
        `RT-2 catalog (${status}): env key '${key}' is not auth-mutating`,
        !sus,
        `safe_to_autofix=true with auth-mutating env: ${key} (matched ${sus})`,
      );
    }
  }
}

// ── 6. ED-021: heavy-skill lean-return advisory (Agent-tool prompts) ──
//
// findHeavySkillAdvisory FIRES when an Agent dispatch prompt runs a heavy
// aggregate/verify skill (/scan:full, /research:deep, /redteam:full, /qa:audit)
// WITHOUT a lean-return request, and is SUPPRESSED when the prompt already asks
// for a lean / envelope / write-file-then-summarize return. Non-blocking.

const HEAVY_NO_LEAN = [
  "Run /scan:full and tell me what's red.",
  "Please run /research:deep on the competitor and summarize the market.",
  "Dispatch this: run /redteam:full against the auth surface.",
  "Execute /qa:audit across the codebase and report failures.",
  // bare form (no leading slash)
  "kick off scan:full for the whole repo",
];
for (const p of HEAVY_NO_LEAN) {
  const adv = findHeavySkillAdvisory(p);
  check(
    `ED-021 FIRES (heavy, no lean-return): '${p.slice(0, 50)}'`,
    adv !== null,
    `findHeavySkillAdvisory returned null for: ${p}`,
  );
}

const HEAVY_WITH_LEAN = [
  // explicit lean-return contract phrasings → suppressed
  "Run /scan:full. Write the full report to a file and return ONE lean verdict envelope (≤8 lines).",
  "Run /research:deep, write findings to disk, then return only a short envelope.",
  "Dispatch /redteam:full but do NOT return the full output — return ≤6 lines: verdict + counts + file path.",
  "Run /qa:audit; lean-return only: write the report file and return a 5 line summary.",
];
for (const p of HEAVY_WITH_LEAN) {
  const adv = findHeavySkillAdvisory(p);
  check(
    `ED-021 SUPPRESSED (lean-return requested): '${p.slice(0, 50)}'`,
    adv === null,
    `findHeavySkillAdvisory should be null (lean-return present), got: ${JSON.stringify(adv)}`,
  );
}

// Non-heavy skill prompts must NOT trigger the advisory (no false positives).
const NOT_HEAVY = [
  "Run /fix:fast on the failing test.",
  "Author a PRD for the new feature.",
  "Dispatch a builder to implement the login form.",
  "", // empty prompt
];
for (const p of NOT_HEAVY) {
  const adv = findHeavySkillAdvisory(p);
  check(
    `ED-021 no false-positive (non-heavy): '${p.slice(0, 40)}'`,
    adv === null,
    `findHeavySkillAdvisory should be null for non-heavy prompt, got: ${JSON.stringify(adv)}`,
  );
}

// The advisory must be non-blocking — it is surfaced as additionalContext, never
// as a `findForbidden` block. Sanity: a heavy-skill prompt is NOT a forbidden Bash cmd.
check(
  "ED-021 advisory is non-blocking (heavy-skill prompt is not a findForbidden hit)",
  findForbidden("Run /scan:full and summarize") === null,
  "heavy-skill prompt must not be a hard block",
);

// ── Summary ───────────────────────────────────────────────────

if (failed > 0) {
  console.error(`FAIL — ${failed} of ${passed + failed} cases failed:`);
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}

console.log(`OK — ${passed} cases passed`);
process.exit(0);
