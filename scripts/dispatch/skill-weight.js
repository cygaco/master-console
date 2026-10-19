#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  path.resolve(__dirname, "..", "..");

const COMMANDS_DIR = path.join(PROJECT, ".claude", "commands");
const OUT_PATH = path.join(PROJECT, ".claude", "runtime", "skill-weight.json");

const EXECUTIONS = new Set(["subprocess", "inline", "inline-required"]);

const INLINE_REQUIRED_RE = /^session:(end|handoff|dump|checkpoint|recap|resume|takenotes)$/;
const SUBPROCESS_RES = [
  /^scan:/,
  /^maps:/,
  /^research:deep$/,
  /^qa:audit$/,
  /^redteam:full$/,
  /^sleep:deep$/,
  /^learn:deep$/,
];
const INLINE_RES = [
  /:(list|show|status|tail|query|explain|search|catalog|history|coverage)$/,
];

function classifyByHeuristic(slug) {
  if (INLINE_REQUIRED_RE.test(slug)) return { weight: "mixed", execution: "inline-required" };
  if (INLINE_RES.some((re) => re.test(slug))) return { weight: "light", execution: "inline" };
  if (SUBPROCESS_RES.some((re) => re.test(slug))) return { weight: "heavy", execution: "subprocess" };
  return { weight: "light", execution: "inline" };
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return {};
  const close = text.indexOf("\n---", 3);
  if (close === -1) return {};
  const block = text.slice(3, close).trim();
  const fm = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1].trim()] = value;
  }
  return fm;
}

function walkSkills(dir, rel = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const relPath = path.posix.join(rel, e.name);
    if (e.isDirectory()) out.push(...walkSkills(full, relPath));
    else if (e.isFile() && e.name.endsWith(".md")) out.push({ full, rel: relPath });
  }
  return out;
}

function slugFromRel(relPath) {
  return relPath.replace(/\.md$/i, "").replace(/\//g, ":");
}

function classifySkill(input) {
  const slug = input && input.slug;
  const fm = (input && input.frontmatter) || {};
  const declared = typeof fm.execution === "string" ? fm.execution.trim() : null;
  if (declared && EXECUTIONS.has(declared)) {
    const weight =
      typeof fm.weight === "string" && fm.weight.trim()
        ? fm.weight.trim()
        : declared === "subprocess"
          ? "heavy"
          : declared === "inline-required"
            ? "mixed"
            : "light";
    return { weight, execution: declared, source: "frontmatter", subprocess_verified: false };
  }
  const h = classifyByHeuristic(slug);
  return { ...h, source: "heuristic", subprocess_verified: false };
}

function buildRegistry(commandsDir) {
  const files = walkSkills(commandsDir);
  const candidates = {};
  let heavy = 0;
  let inlineRequired = 0;
  for (const f of files) {
    let text = "";
    try {
      text = fs.readFileSync(f.full, "utf8");
    } catch {
      continue;
    }
    const slug = slugFromRel(f.rel);
    const c = classifySkill({ slug, frontmatter: parseFrontmatter(text) });
    candidates[slug] = c;
    if (c.execution === "subprocess") heavy++;
    if (c.execution === "inline-required") inlineRequired++;
  }
  return {
    schema: "mc/skill-weight/v1",
    generated_at: new Date().toISOString(),
    source: ".claude/commands",
    classification: "seeded-candidates",
    _doc:
      "Skill-weight registry. execution is a PROPOSAL (author frontmatter `execution:` or the default heuristic). subprocess_verified is ALWAYS false here — a skill is only TRUSTED as a subprocess after a real headless smoke run stamps it in the dispatch-contract keystone. dispatch-contract.js#skillExecution is the fail-closed reader.",
    count: Object.keys(candidates).length,
    subprocess_count: heavy,
    inline_required_count: inlineRequired,
    candidates,
  };
}

function atomicWrite(dest, content) {
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch {
  }
  const tmp = dest + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, dest);
}

module.exports = {
  classifySkill,
  classifyByHeuristic,
  buildRegistry,
  parseFrontmatter,
  slugFromRel,
  EXECUTIONS,
};

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const verbose = args.has("--verbose");
  const dryRun = args.has("--json");

  if (!fs.existsSync(COMMANDS_DIR)) {
    console.error(`[skill-weight] commands dir missing: ${COMMANDS_DIR}`);
    process.exit(1);
  }
  const registry = buildRegistry(COMMANDS_DIR);
  if (verbose) {
    for (const [slug, c] of Object.entries(registry.candidates)) {
      console.error(`  ${slug}\t${c.execution}\t(${c.weight}, ${c.source})`);
    }
  }
  const json = JSON.stringify(registry, null, 2);
  if (dryRun) {
    process.stdout.write(json + "\n");
    process.exit(0);
  }
  atomicWrite(OUT_PATH, json + "\n");
  console.log(
    `[skill-weight] wrote ${registry.count} candidates to ${OUT_PATH} ` +
      `(${registry.subprocess_count} subprocess, ${registry.inline_required_count} inline-required; all subprocess_verified:false until smoke-stamped)`,
  );
}
