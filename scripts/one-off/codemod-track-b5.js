#!/usr/bin/env node
/* Track B.5 codemod — rewrite hardcoded path references after Track C
 * consolidation. Renumbered chapters + docs↔requirements merge.
 *
 * Run:   node scripts/one-off/codemod-track-b5.js [--dry]
 * Dry:   prints what would change; doesn't modify files.
 *
 * EXCLUDED PATHS:
 *   node_modules, .next, runtime, .mc, playwright-report, backups,
 *   .git, mc/releases/* (historical capsules — never modify)
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DRY = process.argv.includes("--dry");

// Round 4: mc/ → framework/ rename (top-level only — not scripts/mc/).
// IMPORTANT: only matches "mc/X" where X is paths|hooks|releases|version etc.
const SUBS = [
  // mc/ → framework/ (only top-level — scripts/mc/ stays)
  ['"mc", "paths.registry.json"', '"framework", "paths.registry.json"'],
  ['"mc", "hooks.registry.json"', '"framework", "hooks.registry.json"'],
  ['"mc", "releases"', '"framework", "releases"'],
  // bare "mc" intentionally NOT matched (it's the framework name in version.json, schema URI prefix, etc.)
  ["mc/paths.registry.json", "framework/paths.registry.json"],
  ["mc/hooks.registry.json", "framework/hooks.registry.json"],
  ["mc/releases/", "framework/releases/"],
  ["mc/releases", "framework/releases"],
  ["mc/installer/", "framework/installer/"],
  // path.join split-arg patterns (longest first)
  ['"requirements", "04-architecture"', '"requirements", "03-architecture"'],
  ['"requirements", "05-features"', '"requirements", "04-features"'],
  ['"requirements", "06-operations"', '"requirements", "05-operations"'],
  ['"requirements", "07-security"', '"requirements", "06-security"'],
  ['"requirements", "08-testing"', '"requirements", "07-testing"'],
  ['"requirements", "09-automation"', '"requirements", "08-automation"'],
  ['"requirements", "99-audits"', '"requirements", "_audits"'],
  ['"docs", "00-canonical"', '"requirements", "00-canonical"'],
  ['"docs", "01-design-system"', '"requirements", "01-design-system"'],
  ['"docs", "02-copy-system"', '"requirements", "02-copy-system"'],
  ['"docs", "04-architecture"', '"requirements", "03-architecture"'],
  ['"docs", "05-features"', '"requirements", "04-features"'],
  ['"docs", "06-integrations"', '"requirements", "09-integrations"'],
  ['"docs", "audit-reports"', '"requirements", "_audits"'],
  // string-literal patterns
  ["docs/99-resources/00-user-communication", "docs/user-communication"],
  ["docs/99-resources/01-research", "docs/research"],
  ["docs/99-resources/02-karpathy-autoresearch", "docs/karpathy-auto-research"],
  ["docs/99-resources", "docs"],
  ["requirements/04-architecture", "requirements/03-architecture"],
  ["requirements/05-features", "requirements/04-features"],
  ["requirements/06-operations", "requirements/05-operations"],
  ["requirements/07-security", "requirements/06-security"],
  ["requirements/08-testing", "requirements/07-testing"],
  ["requirements/09-automation", "requirements/08-automation"],
  ["requirements/99-audits", "requirements/_audits"],
  ["requirements/03-requirement-standards", "requirements/_standards"],
  ["docs/00-canonical", "requirements/00-canonical"],
  ["docs/01-design-system", "requirements/01-design-system"],
  ["docs/02-copy-system", "requirements/02-copy-system"],
  ["docs/04-architecture", "requirements/03-architecture"],
  ["docs/05-features", "requirements/04-features"],
  ["docs/06-integrations", "requirements/09-integrations"],
  ["docs/audit-reports", "requirements/_audits"],
];

// Files to skip even within otherwise-scanned dirs. SCRIPTS_MC_KEEP: the
// scripts/mc/* machinery dir intentionally keeps its name; do not rewrite
// any 'mc/' inside it that's actually 'scripts/mc/'-relative.
function isScriptsMcPath(s) {
  return /\bscripts\/mc\//.test(s);
}

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
  "mc/releases/", // historical release capsules — never modify
  ".mc/",
  "runtime/",
  "scripts/one-off/codemod-track-b5.js", // don't self-modify
  "scripts/mc/codemod-docs-to-requirements.js", // deprecated codemod, retired separately
  "tests/fixtures/manifest-migrate/", // fixtures intentionally hold historical paths
  "framework/releases/", // historical capsule manifests; never modify
  "framework/paths.registry.json", // registry source-of-truth; deprecation lists must NOT be rewritten
  "scripts/path-lint.rules.generated.json", // generated FROM registry; rebuild via paths/build.js
  "scripts/hooks/lib/paths.generated.js", // generated FROM registry; rebuild via paths/build.js
  "schemas/paths.schema.json", // generated FROM registry; rebuild via paths/build.js
  "requirements/03-architecture/PATH_KEYS.md", // generated FROM registry; rebuild via paths/build.js
  "docs/research/", // research artifacts (.tmp/ scripts have unrelated docs/ paths)
  ".claude/project/reference/mc-system-updates-2026-04-15.md", // historical record
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

for (const file of files) {
  let body;
  try {
    body = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  let updated = body;
  let fileReplacements = 0;
  for (const [from, to] of SUBS) {
    if (updated.includes(from)) {
      const occurrences = updated.split(from).length - 1;
      updated = updated.split(from).join(to);
      fileReplacements += occurrences;
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
