#!/usr/bin/env node
"use strict";

/**
 * scripts/guides/registry.js — the _guides/ anchor-contract registry engine.
 *
 * The guide-anchor contract (established by /guides:write) lives in each
 * guide's YAML frontmatter:
 *
 *   ---
 *   guide: AUTH
 *   anchor: lastmile:module/auth
 *   shape: walkthrough        # walkthrough | checklist | notice
 *   timing: at-module         # project-start | at-module | at-gate | reference
 *   lead_time: "..."          # real-world wait, or "none"
 *   ---
 *
 * This module is the SINGLE source of frontmatter parsing + registry I/O,
 * shared by /guides:organize (writes the registry), /guides:integrate
 * (reads it to place guides), and /guides:coverage (reads it to enforce).
 * Keeping the parse in one place stops the three skills from drifting on
 * the contract shape.
 *
 * The generated _guides/registry.json is DETERMINISTIC (no timestamp inside)
 * so it is byte-stable across regens — it never re-stales the framework
 * manifest, and `--check` is a clean equality test.
 *
 * CLI:
 *   node scripts/guides/registry.js            # (re)build _guides/registry.json
 *   node scripts/guides/registry.js --check    # exit 1 if registry.json is stale vs frontmatter
 *   node scripts/guides/registry.js --json     # print the registry to stdout, write nothing
 *
 * Exit codes: 0 ok / fresh · 1 stale (--check) · 2 CLI or read error.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUIDES_DIR = path.join(REPO_ROOT, "_guides");
const REGISTRY_FILE = path.join(GUIDES_DIR, "registry.json");
const REGISTRY_SCHEMA = "mc/guides/registry/v1";

const VALID_SHAPES = ["walkthrough", "checklist", "notice"];
const VALID_TIMINGS = ["project-start", "at-module", "at-gate", "reference"];
// Canonical anchor namespaces. `none` = meta/index guide (e.g. README).
const ANCHOR_PATTERN =
  /^(none|spinup:(preflight|intent|canon|roadmap|onscreen)|lastmile:(audit|module\/[a-z0-9-]+|gate\/[a-z0-9-]+))$/;

/**
 * Parse flat-scalar YAML frontmatter from the head of a markdown file.
 * The guide-anchor contract is intentionally flat (no nesting), so a full
 * YAML parser is unnecessary (js-yaml is not a dependency here). Returns
 * `null` when the file has no leading `---` frontmatter block.
 */
function parseFrontmatter(content) {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = content.slice(3, end).trim();
  const out = {};
  for (const rawLine of block.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // strip a trailing inline comment that is not inside quotes
    if (!/^["']/.test(val)) {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
    // strip matching surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Load every _guides/*.md (excluding the registry) with parsed frontmatter. */
function loadGuides() {
  if (!fs.existsSync(GUIDES_DIR)) {
    throw new Error(`_guides dir not found at ${GUIDES_DIR}`);
  }
  const files = fs
    .readdirSync(GUIDES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  return files.map((file) => {
    const full = path.join(GUIDES_DIR, file);
    const content = fs.readFileSync(full, "utf8");
    const fm = parseFrontmatter(content);
    // First markdown H1 as a human title (best-effort).
    const titleMatch = content.match(/^#\s+(.+)$/m);
    return {
      file,
      stem: file.replace(/\.md$/, ""),
      frontmatter: fm,
      title: titleMatch ? titleMatch[1].trim() : file,
      hasFrontmatter: fm !== null,
    };
  });
}

/** Validate one guide's frontmatter against the contract. Returns string[] of problems. */
function validateGuideFrontmatter(g) {
  const problems = [];
  if (g.stem === "README") return problems; // index handled by anchor:none rule below if present
  const fm = g.frontmatter;
  if (!fm) {
    problems.push(`${g.file}: no frontmatter (guide-anchor contract missing)`);
    return problems;
  }
  if (!fm.guide) problems.push(`${g.file}: missing 'guide' id`);
  if (!fm.anchor) problems.push(`${g.file}: missing 'anchor'`);
  else if (!ANCHOR_PATTERN.test(fm.anchor))
    problems.push(`${g.file}: invalid anchor '${fm.anchor}'`);
  if (!fm.shape) problems.push(`${g.file}: missing 'shape'`);
  else if (!VALID_SHAPES.includes(fm.shape))
    problems.push(`${g.file}: invalid shape '${fm.shape}' (want ${VALID_SHAPES.join("|")})`);
  if (!fm.timing) problems.push(`${g.file}: missing 'timing'`);
  else if (!VALID_TIMINGS.includes(fm.timing))
    problems.push(`${g.file}: invalid timing '${fm.timing}' (want ${VALID_TIMINGS.join("|")})`);
  if (fm.lead_time === undefined)
    problems.push(`${g.file}: missing 'lead_time' (use "none" when there is no real-world wait)`);
  return problems;
}

/** Build the deterministic registry object from current frontmatter. */
function buildRegistry() {
  const guides = loadGuides()
    .filter((g) => g.hasFrontmatter && g.frontmatter.guide)
    .map((g) => ({
      guide: g.frontmatter.guide,
      file: `_guides/${g.file}`,
      anchor: g.frontmatter.anchor || null,
      shape: g.frontmatter.shape || null,
      timing: g.frontmatter.timing || null,
      lead_time: g.frontmatter.lead_time || "none",
      title: g.title,
    }))
    .sort((a, b) => a.guide.localeCompare(b.guide));
  return { schema: REGISTRY_SCHEMA, guides };
}

/** Read the on-disk registry, or null if absent/unreadable. */
function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return null;
  }
}

function serialize(reg) {
  return JSON.stringify(reg, null, 2) + "\n";
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const jsonOnly = args.includes("--json");

  let built;
  try {
    built = buildRegistry();
  } catch (e) {
    console.error(`guides/registry: ${e.message}`);
    process.exit(2);
  }

  if (jsonOnly) {
    process.stdout.write(serialize(built));
    process.exit(0);
  }

  if (check) {
    const current = (() => {
      try {
        return fs.readFileSync(REGISTRY_FILE, "utf8");
      } catch {
        return null;
      }
    })();
    if (current === serialize(built)) {
      console.log(`guides/registry: fresh (${built.guides.length} anchored guides)`);
      process.exit(0);
    }
    console.error(
      "guides/registry: STALE — _guides/registry.json does not match guide frontmatter. Run `node scripts/guides/registry.js` (or /guides:organize) to rebuild."
    );
    process.exit(1);
  }

  fs.writeFileSync(REGISTRY_FILE, serialize(built));
  console.log(
    `guides/registry: wrote _guides/registry.json (${built.guides.length} anchored guides)`
  );
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  REPO_ROOT,
  GUIDES_DIR,
  REGISTRY_FILE,
  REGISTRY_SCHEMA,
  VALID_SHAPES,
  VALID_TIMINGS,
  ANCHOR_PATTERN,
  parseFrontmatter,
  loadGuides,
  validateGuideFrontmatter,
  buildRegistry,
  loadRegistry,
};
