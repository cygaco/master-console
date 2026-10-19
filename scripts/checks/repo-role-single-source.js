#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.join(ROOT, "scripts");

const ALLOWLIST_FILES = new Set([
  path.join(SCRIPTS_DIR, "mc", "repo-role.js"),
  path.join(SCRIPTS_DIR, "mc", "test-repo-role.js"),
  path.join(SCRIPTS_DIR, "checks", "repo-role-single-source.js"),
]);

const ALLOWLIST_DIRS = [
  path.join(SCRIPTS_DIR, "mc", "manifest"),
];

function isAllowlisted(file) {
  if (ALLOWLIST_FILES.has(file)) return true;
  for (const dir of ALLOWLIST_DIRS) {
    if (file === dir) return true;
    if (file.startsWith(dir + path.sep)) return true;
  }
  return false;
}

const PATTERNS = [
  {
    name: "mc_canonical_marker",
    regex: /['".]mc-canonical['"]/,
    description: "'.mc-canonical' marker check — role derivation only belongs in repo-role.js",
  },
  {
    name: "mc_source_self",
    regex: /mc(?:\?\.|[.\[]).*source.*===.*['"]self['"]|['"]self['"].*===.*mc(?:\?\.|[.\[]).*source/,
    description: "mc.source === \"self\" role check — use resolveRepoRole() instead",
  },
  {
    name: "project_slug_mc",
    regex: /project(?:\?\.|[.\[]).*slug.*===.*['"]mc['"]|['"]mc['"].*===.*project(?:\?\.|[.\[]).*slug/,
    description: "project.slug === \"mc\" role check — use resolveRepoRole() instead",
  },
  {
    name: "mc_manifest_existence_role",
    regex: /(existsSync|safeExists).*_mc.*MANIFEST\.json|_mc.*MANIFEST\.json.*(existsSync|safeExists)/,
    description: "_mc/MANIFEST.json existsSync role check — use resolveRepoRole() instead",
  },
  {
    name: "version_json_name_mc",
    regex: /\.name\s*===\s*['"]mc['"]|['"]mc['"]\s*===\s*\.name/,
    description: "version.json#name === \"mc\" role check — use resolveRepoRole() instead",
  },
];

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
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(full, out);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      out.push(full);
    }
  }
}

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
        policy: "All repo-role derivation must flow through scripts/mc/repo-role.js",
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
          "Policy: all canonical-vs-consumer detection must flow through",
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
