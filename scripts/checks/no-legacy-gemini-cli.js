#!/usr/bin/env node
/**
 * no-legacy-gemini-cli.js — creep-back enforcer for the 2026-07-20 Gemini deep-clean.
 *
 * The individual-tier `gemini` CLI (`@google/gemini-cli`) is SUNSET (IneligibleTierError →
 * "migrate to Antigravity"). ALL Gemini now routes through the supported `antigravity` (`agy`)
 * CLI, which serves the SAME Gemini MODELS. This gate FAILS (exit 1) if any legacy-gemini-CLI
 * WIRING reappears in production dispatch code / config — the drift class CLAUDE.md's
 * refactor-hygiene rules flag.
 *
 * KEYS ON WIRING, NOT THE MODEL-NAME SUBSTRING. It FLAGS:
 *   - a `gemini` provider block (`cli: "gemini"` / a `gemini: { … }` provider entry)
 *   - GEMINI_API_KEY / GOOGLE_API_KEY injection, GEMINI_CLI_TRUST* / --skip-trust
 *   - the removed key/oauth loaders (loadGeminiApiKey / hasValidGeminiOAuth / geminiTrustBypass)
 *   - any bare quoted provider/cli/tool id "gemini" (role→"gemini" in a provider map,
 *     provider === "gemini" branches, a "gemini" TOOL_ID/ARG_POLICY, a panel pass→"gemini")
 *   - a `gemini <cli-flag>` invocation (`gemini models list`, `gemini -m`, `gemini --model`, …)
 *
 * It does NOT flag (the KEEP partition):
 *   - gemini-3.1-pro-* MODEL IDS served via agy (e.g. "gemini-3.1-pro-high")
 *   - antigravity / agy wiring, ANTIGRAVITY_MODEL, the "Gemini 3.1 Pro (High)" agy display name
 *
 * Sanctioned exception: the Gemini DEEP-RESEARCH API path (scripts/research/deep-run.js,
 * scripts/research/gemini-deep-research.js) is a no-CLI-equivalent capability (generativelanguage
 * API), NOT the sunset redteam CLI — excluded from this scan.
 *
 * Pure core (scanText / scanFile) is exported for the bite-test (negative + positive fixtures).
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

// ── Forbidden WIRING forms (each keyed by a `form` name a fixture can target) ──
const FORBIDDEN = [
  // A bare quoted provider/cli/tool id "gemini" — model ids are "gemini-3.1-…" (a hyphen follows),
  // so a closing quote right after "gemini" is ALWAYS the provider id, never a model. Catches
  // cli:"gemini", role:"gemini", provider==="gemini", a "gemini" Set/ARG_POLICY key, panel pass→"gemini".
  { form: "bare-quoted-gemini", re: /["']gemini["']/, desc: 'bare quoted provider/cli/tool id "gemini"' },
  // A `gemini: { … }` provider block with an UNQUOTED key (the JS DEFAULT_PROVIDERS shape).
  { form: "gemini-provider-block", re: /(^|[^\w.-])gemini\s*:\s*\{/, desc: "a `gemini: { … }` provider block" },
  // Key/env injection for the dead CLI.
  { form: "gemini-key-injection", re: /\bGEMINI_API_KEY\b|\bGOOGLE_API_KEY\b/, desc: "GEMINI_API_KEY / GOOGLE_API_KEY injection" },
  // Workspace-trust env / flag for the dead CLI.
  { form: "gemini-trust", re: /\bGEMINI_CLI_TRUST\w*\b|(^|[^\w-])--skip-trust\b/, desc: "GEMINI_CLI_TRUST* / --skip-trust" },
  // The removed key/oauth loaders + trust-bypass opt.
  { form: "gemini-loaders", re: /\bloadGeminiApiKey\b|\bhasValidGeminiOAuth\b|\bgeminiTrustBypass\b|\bMC_GEMINI_(TRUST_BYPASS|PREFER_OAUTH|FORCE_KEY)\b/, desc: "removed gemini key/oauth loaders" },
  // A `gemini <cli-flag>` invocation string. (Matches the dead CLI's own flags; the model-id
  // "gemini-3.1-…" has a hyphen immediately after "gemini", so `gemini\s+<flag>` never matches it.)
  { form: "gemini-cli-call", re: /\bgemini\s+(models\s+list|--version|auth\b|-m\b|-p\b|--model\b|exec\b)/, desc: "a `gemini <flag>` CLI invocation" },
];

// Strip // line comments and /* */ block comments so the removal-documenting comments (which
// discuss "gemini" in prose/backticks) never trip the scan. Over-stripping is safe (fewer
// false-positives); the forbidden forms live in CODE, not comments.
function stripComments(text) {
  return text
    // Blank out block comments but PRESERVE their newlines so line numbers stay accurate.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/** Scan text → [{ form, desc, line, snippet }]. Pure — the fixture bite-test calls this. */
function scanText(text, { isJson = false } = {}) {
  const scanned = isJson ? text : stripComments(text);
  const lines = scanned.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    for (const f of FORBIDDEN) {
      if (f.re.test(line)) {
        out.push({ form: f.form, desc: f.desc, line: i + 1, snippet: line.trim().slice(0, 160) });
      }
    }
  });
  return out;
}

function scanFile(abs) {
  let text;
  try { text = fs.readFileSync(abs, "utf8"); } catch { return []; }
  return scanText(text, { isJson: abs.endsWith(".json") }).map((v) => ({ ...v, file: path.relative(ROOT, abs).split(path.sep).join("/") }));
}

// ── What to scan (production dispatch code + the wire-shaped configs) ──
const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".claude-runtime"]);
// Sanctioned Gemini DEEP-RESEARCH API path (no-CLI-equivalent capability) — NOT the sunset CLI.
// auth-resolver.js resolves GEMINI_API_KEY/GOOGLE_API_KEY for that API path (deep-run.js consumes it),
// so its GEMINI_API_KEY source-chain is API auth, not CLI wiring — excluded.
const EXCLUDE_FILES = new Set([
  path.join(ROOT, "scripts", "research", "deep-run.js"),
  path.join(ROOT, "scripts", "research", "gemini-deep-research.js"),
  path.join(ROOT, "scripts", "research", "deep-run.test.js"),
  path.join(ROOT, "scripts", "dispatch", "auth-resolver.js"), // GEMINI_API_KEY = the deep-research API key
  // models/check.js is model-catalog RESEARCH tooling (maps a provider to its model-research
  // snapshot file stem, e.g. the Gemini model family → gemini.json) — a MODEL-family reference,
  // not provider-CLI dispatch wiring. Its provider KEY is antigravity; only the research-file stem
  // value carries the "gemini" model-family name (Bucket C: gemini MODEL names are KEPT).
  path.join(ROOT, "scripts", "models", "check.js"),
  path.join(ROOT, "scripts", "checks", "no-legacy-gemini-cli.js"), // this file carries the patterns
]);
// Tests are separately maintained fixtures, not production wiring — excluded (basename test-*.js / *.test.js).
const isTestFile = (base) => base.endsWith(".test.js") || base.startsWith("test-");

function walkJs(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkJs(abs, acc);
    } else if (e.isFile() && e.name.endsWith(".js") && !isTestFile(e.name) && !EXCLUDE_FILES.has(abs)) {
      acc.push(abs);
    }
  }
}

// Wire-shaped config files (JSON) that carry provider/role maps + panel lanes.
const CONFIG_FILES = [
  ".claude/manifest.json",
  ".claude/agents/_org/role-registry.json",
  ".claude/agents/_org/panel-lane-manifest.json",
  ".claude/agents/_org/dispatch-contract.json",
  ".claude/agents/president/_system/policy/provider-fallback.json",
  ".claude/agents/president/_system/policy/provider-failure-modes.json",
  "scripts/checks/cert-cli-pins.json",
].map((p) => path.join(ROOT, p));

function scanTree() {
  const files = [];
  walkJs(path.join(ROOT, "scripts"), files);
  for (const c of CONFIG_FILES) if (fs.existsSync(c)) files.push(c);
  const violations = [];
  for (const f of files) violations.push(...scanFile(f));
  return violations;
}

module.exports = { scanText, scanFile, scanTree, FORBIDDEN };

if (require.main === module) {
  const violations = scanTree();
  if (violations.length === 0) {
    console.log("OK — no legacy `gemini` CLI wiring found (all Gemini routes through antigravity/agy).");
    process.exit(0);
  }
  console.error(`FAIL — ${violations.length} legacy-gemini-CLI wiring hit(s) (the SUNSET individual gemini CLI must not reappear; route Gemini through antigravity/agy):`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.form}] ${v.desc}`);
    console.error(`      ${v.snippet}`);
  }
  process.exit(1);
}
