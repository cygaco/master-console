#!/usr/bin/env node
/**
 * scripts/checks/repo-role-single-source.js — ED-009 invariant enforcer.
 *
 * Policy: ALL canonical-vs-consumer role derivation MUST flow through
 * scripts/mc/repo-role.js. No guard or script may re-derive the repo role
 * by reading canonical signals inline (e.g. checking _mc/MANIFEST.json
 * existence, .mc-canonical, manifest.json#mc.source, version.json#name,
 * etc.).
 *
 * This script greps for known inline role-derivation idioms across the scripts/
 * directory tree and exits non-zero if any appear OUTSIDE the resolver itself.
 *
 * Usage:
 *   node scripts/checks/repo-role-single-source.js         # human report
 *   node scripts/checks/repo-role-single-source.js --json  # machine-readable
 *
 * Exit codes:
 *   0 — clean (no inline derivation found outside the resolver)
 *   1 — violations: one or more files re-derive role independently
 *   2 — tool/scan error
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

// ── Allowlist ──────────────────────────────────────────────────────────────
// Individual files allowed to reference canonical-detection patterns.
const ALLOWLIST_FILES = new Set([
  path.join(SCRIPTS_DIR, "mc", "repo-role.js"),
  path.join(SCRIPTS_DIR, "mc", "test-repo-role.js"),
  path.join(SCRIPTS_DIR, "checks", "repo-role-single-source.js"), // self
]);

// Entire directories allowlisted — files inside these dirs are legitimate
// manifest-tool readers that reference _mc/MANIFEST.json for CONTENT
// (build, validate, walk-skip) rather than for role derivation. NOTE: this is a
// CONTENT-reader carve-out, not a role-derivation hiding place — bootstrap.js's
// canonical detection (detectMode) was refactored to flow through the resolver
// (isCanonicalDir) so it no longer re-derives role inline here (xprovider review
// 2026-06-15 BLOCKER-1a: the dir-allowlist must not mask a LIVE role detector).
const ALLOWLIST_DIRS = [
  path.join(SCRIPTS_DIR, "mc", "manifest"), // build.js, validate.js, walk-skip.js content-readers (+ tests)
];

function isAllowlisted(file) {
  if (ALLOWLIST_FILES.has(file)) return true;
  for (const dir of ALLOWLIST_DIRS) {
    // Match files directly inside the directory or in any subdirectory.
    if (file === dir) return true;
    if (file.startsWith(dir + path.sep)) return true;
  }
  return false;
}

// ── Patterns that constitute "inline role derivation" ─────────────────────
// Each entry: { name, regex } — the regex is matched against each line.
// Only patterns that are UNAMBIGUOUSLY role-detection are listed (not broad
// substring matches that appear in legitimate non-role contexts).
const PATTERNS = [
  {
    name: "mc_canonical_marker",
    // existsSync check for the .mc-canonical marker file — exclusively a role signal.
    regex: /['".]mc-canonical['"]/,
    description: "'.mc-canonical' marker check — role derivation only belongs in repo-role.js",
  },
  {
    name: "mc_source_self",
    // m.mc.source === "self" or similar — specific canonical-dev-repo signal.
    // The (?:\?\.|[.\[]) accessor group also catches optional chaining (mc?.source).
    regex: /mc(?:\?\.|[.\[]).*source.*===.*['"]self['"]|['"]self['"].*===.*mc(?:\?\.|[.\[]).*source/,
    description: "mc.source === \"self\" role check — use resolveRepoRole() instead",
  },
  {
    name: "project_slug_mc",
    // m.project.slug === "mc" — specific canonical role signal.
    // The (?:\?\.|[.\[]) accessor group also catches optional chaining (project?.slug).
    regex: /project(?:\?\.|[.\[]).*slug.*===.*['"]mc['"]|['"]mc['"].*===.*project(?:\?\.|[.\[]).*slug/,
    description: "project.slug === \"mc\" role check — use resolveRepoRole() instead",
  },
  {
    name: "mc_manifest_existence_role",
    // existsSync/safeExists check on _mc/MANIFEST.json used for role derivation.
    // Legitimate content-readers (build.js, validate.js, tests) call readFileSync/loadJson
    // and live in scripts/mc/manifest/ (allowlisted above). Any OTHER file calling
    // existsSync on that path is re-deriving the role signal inline.
    regex: /(existsSync|safeExists).*_mc.*MANIFEST\.json|_mc.*MANIFEST\.json.*(existsSync|safeExists)/,
    description: "_mc/MANIFEST.json existsSync role check — use resolveRepoRole() instead",
  },
  {
    name: "version_json_name_mc",
    // version.json#name === "mc" structural heuristic — a role signal.
    // Keyed on `.name === "mc"` / `"mc" === .name` — specific enough to
    // only catch role-derivation without broad false positives.
    regex: /\.name\s*===\s*['"]mc['"]|['"]mc['"]\s*===\s*\.name/,
    description: "version.json#name === \"mc\" role check — use resolveRepoRole() instead",
  },
];

// ── File walker ────────────────────────────────────────────────────────────

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // Skip node_modules and hidden dirs.
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(full, out);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      out.push(full);
    }
  }
}

// ── Scan ──────────────────────────────────────────────────────────────────

function scan() {
  const files = [];
  walk(SCRIPTS_DIR, files);

  const violations = [];

  for (const file of files) {
    if (isAllowlisted(file)) continue;

    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pat of PATTERNS) {
        if (pat.regex.test(line)) {
          violations.push({
            file: path.relative(ROOT, file),
            line: i + 1,
            pattern: pat.name,
            description: pat.description,
            text: line.trim().slice(0, 120),
          });
        }
      }
    }
  }

  return violations;
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  const json = process.argv.includes("--json");

  let violations;
  try {
    violations = scan();
  } catch (e) {
    if (json) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message, violations: [] }) + "\n");
    } else {
      process.stderr.write(`repo-role-single-source: scan error — ${e.message}\n`);
    }
    process.exit(2);
  }

  const ok = violations.length === 0;

  if (json) {
    process.stdout.write(
      JSON.stringify({
        ok,
        policy: "All repo-role derivation must flow through scripts/mc/repo-role.js (ED-009)",
        resolver: "scripts/mc/repo-role.js",
        violationCount: violations.length,
        violations,
      }, null, 2) + "\n",
    );
  } else {
    if (ok) {
      process.stdout.write(
        "repo-role-single-source: OK — no inline role derivation found outside scripts/mc/repo-role.js\n",
      );
    } else {
      process.stderr.write(
        [
          `repo-role-single-source: FAIL — ${violations.length} inline role-derivation(s) found.`,
          "Policy (ED-009): all canonical-vs-consumer detection must flow through",
          "  scripts/mc/repo-role.js  (use resolveRepoRole())",
          "",
          ...violations.map(
            (v) =>
              `  ${v.file}:${v.line}  [${v.pattern}]\n    ${v.text}`,
          ),
          "",
          "Fix: replace the inline check with:",
          "  const { resolveRepoRole } = require('<rel>/mc/repo-role');",
          "  const isCanonical = resolveRepoRole({ root: <your-root> }).role === 'canonical';",
          "",
        ].join("\n"),
      );
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
