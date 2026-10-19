#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUIDES_DIR = path.join(REPO_ROOT, "_guides");
const REGISTRY_FILE = path.join(GUIDES_DIR, "registry.json");
const REGISTRY_SCHEMA = "mc/guides/registry/v1";

const VALID_SHAPES = ["walkthrough", "checklist", "notice"];
const VALID_TIMINGS = ["project-start", "at-module", "at-gate", "reference"];
const ANCHOR_PATTERN =
  /^(none|spinup:(preflight|intent|canon|roadmap|onscreen)|lastmile:(audit|module\/[a-z0-9-]+|gate\/[a-z0-9-]+))$/;

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
    if (!/^["']/.test(val)) {
      const hash = val.indexOf(" #");
      if (hash !== -1) val = val.slice(0, hash).trim();
    }
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

function validateGuideFrontmatter(g) {
  const problems = [];
  if (g.stem === "README") return problems;
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
