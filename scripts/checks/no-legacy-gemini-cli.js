#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const FORBIDDEN = [
  { form: "bare-quoted-gemini", re: /["']gemini["']/, desc: 'bare quoted provider/cli/tool id "gemini"' },
  { form: "gemini-provider-block", re: /(^|[^\w.-])gemini\s*:\s*\{/, desc: "a `gemini: { … }` provider block" },
  { form: "gemini-key-injection", re: /\bGEMINI_API_KEY\b|\bGOOGLE_API_KEY\b/, desc: "GEMINI_API_KEY / GOOGLE_API_KEY injection" },
  { form: "gemini-trust", re: /\bGEMINI_CLI_TRUST\w*\b|(^|[^\w-])--skip-trust\b/, desc: "GEMINI_CLI_TRUST* / --skip-trust" },
  { form: "gemini-loaders", re: /\bloadGeminiApiKey\b|\bhasValidGeminiOAuth\b|\bgeminiTrustBypass\b|\bMC_GEMINI_(TRUST_BYPASS|PREFER_OAUTH|FORCE_KEY)\b/, desc: "removed gemini key/oauth loaders" },
  { form: "gemini-cli-call", re: /\bgemini\s+(models\s+list|--version|auth\b|-m\b|-p\b|--model\b|exec\b)/, desc: "a `gemini <flag>` CLI invocation" },
];

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

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

const SKIP_DIRS = new Set(["node_modules", ".git", "runtime", ".claude-runtime"]);
const EXCLUDE_FILES = new Set([
  path.join(ROOT, "scripts", "research", "deep-run.js"),
  path.join(ROOT, "scripts", "research", "gemini-deep-research.js"),
  path.join(ROOT, "scripts", "research", "deep-run.test.js"),
  path.join(ROOT, "scripts", "dispatch", "auth-resolver.js"),
  path.join(ROOT, "scripts", "models", "check.js"),
  path.join(ROOT, "scripts", "checks", "no-legacy-gemini-cli.js"),
]);
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
