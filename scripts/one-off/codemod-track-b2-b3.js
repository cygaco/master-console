#!/usr/bin/env node
/* Track B.2 + B.3 codemod — requirements/ → _requirements/ and docs/ → _docs/.
 *
 * Uses regex with negative lookbehind to skip:
 *   - already-prefixed `_requirements/`, `_docs/`
 *   - URLs (preceded by `://` or `.com/`)
 *   - registry deprecation entries (handled via EXCLUDE_PATHS)
 *
 * Run:   node scripts/one-off/codemod-track-b2-b3.js [--dry]
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DRY = process.argv.includes("--dry");

// Each rule: [regex, replacement, label].
// (?<![a-zA-Z0-9_./]) prevents matching inside _requirements, urls (paths
// usually preceded by space/quote/( or start-of-line)
const RULES = [
  // requirements/ → _requirements/  (only when not already prefixed and not part of a URL/longer path)
  [
    /(?<![a-zA-Z0-9_/.])requirements\//g,
    "_requirements/",
    "requirements/ → _requirements/",
  ],
  // docs/ → _docs/  (skip URLs like developers.openai.com/api/docs/)
  [/(?<![a-zA-Z0-9_/.])docs\//g, "_docs/", "docs/ → _docs/"],
];

const EXCLUDE = new Set([
  "node_modules",
  ".next",
  "runtime",
  ".mc",
  "playwright-report",
  "backups",
  ".git",
  ".worktrees",
  ".playwright-mcp",
  "codex-bin",
]);
const EXCLUDE_PATHS = [
  "framework/releases/",
  ".mc/",
  "runtime/",
  "scripts/one-off/codemod-track-b5.js",
  "scripts/one-off/codemod-track-b2-b3.js",
  "scripts/mc/codemod-docs-to-requirements.js",
  "tests/fixtures/manifest-migrate/",
  "framework/paths.registry.json",
  "scripts/path-lint.rules.generated.json",
  "scripts/hooks/lib/paths.generated.js",
  "schemas/paths.schema.json",
  // PATH_KEYS.md is generated; will be regenerated post-codemod
];

const ALLOWED_EXT = new Set([
  ".md",
  ".json",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".sh",
  ".ps1",
  ".yml",
  ".yaml",
  ".html",
  ".css",
]);

function shouldSkipPath(rel) {
  for (const p of EXCLUDE_PATHS) if (rel.startsWith(p)) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    if (shouldSkipPath(rel)) continue;
    if (entry.isDirectory()) {
      walk(abs, out);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      out.push(abs);
    }
  }
  return out;
}

const files = walk(ROOT);
let changedCount = 0;
let totalReplacements = 0;
const ruleHits = new Map();

for (const file of files) {
  let body;
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  let updated = body;
  let fileReplacements = 0;
  for (const [re, replacement, label] of RULES) {
    const before = updated;
    re.lastIndex = 0;
    updated = updated.replace(re, replacement);
    if (updated !== before) {
      const count = (
        before.match(re) ||
        before.match(new RegExp(re.source, "g")) ||
        []
      ).length;
      fileReplacements += count;
      ruleHits.set(label, (ruleHits.get(label) || 0) + count);
    }
  }
  if (fileReplacements > 0) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    console.log(
      `  ${rel} (${fileReplacements} replacement${fileReplacements === 1 ? "" : "s"})`,
    );
    if (!DRY) fs.writeFileSync(file, updated);
    changedCount += 1;
    totalReplacements += fileReplacements;
  }
}

console.log(
  `\n${DRY ? "[DRY] " : ""}${changedCount} files changed, ${totalReplacements} replacements total.`,
);
console.log("Rule breakdown:");
for (const [label, n] of ruleHits.entries()) console.log(`  ${label}: ${n}`);
