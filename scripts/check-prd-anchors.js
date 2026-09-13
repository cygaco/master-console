#!/usr/bin/env node
/**
 * check-prd-anchors.js — Verify implementation anchors in MC-as-product PRDs.
 *
 * Each PRD frontmatter declares `implementation: [<paths>]`. Each PRD body should
 * cite file paths in the form `path/to/file.js:LINE-LINE` or `path/to/file.js#anchor`.
 *
 * For every cited path: verify file exists. Missing files = exit 1.
 *
 * Usage:
 *   node scripts/check-prd-anchors.js _requirements/04-features/<folder>/
 *   node scripts/check-prd-anchors.js _requirements/04-features/installer/ _requirements/04-features/session-lifecycle/
 *   node scripts/check-prd-anchors.js --all   (scans all 05-features)
 */
const fs = require("fs");
const path = require("path");

const REPO_ROOT = process.cwd();
const FEATURES_DIR = path.join(REPO_ROOT, "requirements", "04-features");

function listFolders(args) {
  if (args.includes("--all")) {
    if (!fs.existsSync(FEATURES_DIR)) return [];
    return fs
      .readdirSync(FEATURES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(FEATURES_DIR, e.name));
  }
  return args.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));
}

function readFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  // crude implementation: list under `implementation:`
  const impl = m[1].match(/implementation:\n((?:\s*-\s*.+\n?)+)/);
  if (impl) {
    out.implementation = impl[1]
      .split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean);
  }
  return out;
}

function extractCitations(text) {
  // Match patterns like `src/lib/foo.ts:10-20`, `scripts/x.js:5`, `scripts/x.js#funcName`.
  // Require at least one `/` (or backslash) so bare basenames in prose
  // (`paths.json`, `warp-setup.js`) are not treated as repo-relative paths.
  const re =
    /`([a-zA-Z0-9._-]+(?:[\/\\][a-zA-Z0-9._-]+)+\.(?:js|ts|tsx|md|json|ps1|sh|jsonl))(?::\d+(?:-\d+)?|#[a-zA-Z0-9_-]+)?`/g;
  const found = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].replace(/\\/g, "/"));
  }
  return [...found];
}

function check(folder) {
  const errors = [];
  const warnings = [];
  const files = [];
  if (!fs.existsSync(folder)) {
    errors.push(`Folder not found: ${folder}`);
    return { folder, ok: false, errors, warnings, files };
  }
  for (const f of fs.readdirSync(folder)) {
    if (!f.endsWith(".md")) continue;
    const fp = path.join(folder, f);
    files.push(fp);
    const text = fs.readFileSync(fp, "utf8");
    const fm = readFrontmatter(text);
    if (!fm) {
      warnings.push(`${path.relative(REPO_ROOT, fp)}: no frontmatter`);
    } else if (fm.implementation) {
      for (const p of fm.implementation) {
        const abs = path.join(REPO_ROOT, p);
        if (!fs.existsSync(abs)) {
          errors.push(
            `${path.relative(REPO_ROOT, fp)}: implementation anchor missing: ${p}`,
          );
        }
      }
    }
    const citations = extractCitations(text);
    for (const c of citations) {
      const abs = path.join(REPO_ROOT, c);
      if (!fs.existsSync(abs)) {
        errors.push(
          `${path.relative(REPO_ROOT, fp)}: cited path missing: ${c}`,
        );
      }
    }
  }
  return { folder, ok: errors.length === 0, errors, warnings, files };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "usage: node scripts/check-prd-anchors.js <folder>... | --all",
    );
    process.exit(2);
  }
  const folders = listFolders(args);
  if (folders.length === 0) {
    console.error("no folders matched");
    process.exit(2);
  }
  let totalErrors = 0;
  for (const folder of folders) {
    const r = check(folder);
    const rel = path.relative(REPO_ROOT, r.folder);
    if (r.ok) {
      console.log(`OK   ${rel}  (${r.files.length} files)`);
    } else {
      console.log(`FAIL ${rel}  (${r.files.length} files)`);
      for (const e of r.errors) console.log(`     E ${e}`);
      totalErrors += r.errors.length;
    }
    for (const w of r.warnings) console.log(`     W ${w}`);
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { check, extractCitations, readFrontmatter };
