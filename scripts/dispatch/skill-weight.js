#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * skill-weight.js — generate the skill-weight registry (PLAN §13.2).
 *
 * The companion to dispatch-skill.js. Walks .claude/commands/**\/*.md, reads each
 * skill's frontmatter `execution:` field (subprocess | inline | inline-required)
 * when present, otherwise CLASSIFIES it with the §13.2 default heuristic, and emits
 * a skill-weight registry JSON.
 *
 * The registry mirrors the SHAPE of the dispatch-contract keystone's
 * `skills.candidates` block (.claude/agents/_org/dispatch-contract.json) so the two
 * are reconcilable — each candidate carries { weight, execution, subprocess_verified }.
 * A frontmatter `execution:` is an EXPLICIT author classification; the heuristic is a
 * fallback. Either way `subprocess_verified` stays FALSE: a skill is only TRUSTED as a
 * subprocess after a real headless smoke run stamps it (§13.6/§13.7) — this generator
 * never stamps verification, it only proposes. dispatch-contract.js#skillExecution is
 * the fail-closed READER (an unverified `subprocess` is treated as `inline`).
 *
 * This is a "propose, don't trust" generator. Mirrors generate-skill-catalog.js's
 * walk + frontmatter parse + atomic write; mirrors the candidate shape of the contract.
 *
 * Usage:
 *   node scripts/dispatch/skill-weight.js              # write the registry
 *   node scripts/dispatch/skill-weight.js --json       # print to stdout, no write
 *   node scripts/dispatch/skill-weight.js --verbose    # per-skill decisions on stderr
 *
 * Zero runtime deps.
 */

const fs = require("fs");
const path = require("path");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  path.resolve(__dirname, "..", "..");

const COMMANDS_DIR = path.join(PROJECT, ".claude", "commands");
const OUT_PATH = path.join(PROJECT, ".claude", "runtime", "skill-weight.json");

// Valid execution classes. `inline-required` = a skill that depends on the LIVE
// conversation context and therefore CANNOT be a subprocess (e.g. a handoff that
// must read the running session). Mirrors the contract's enum.
const EXECUTIONS = new Set(["subprocess", "inline", "inline-required"]);

// ── §13.2 default classification heuristic ──────────────────
// A skill with no explicit frontmatter `execution:` is classified by name pattern.
// HEAVY aggregate/research/audit/synthesis skills => subprocess (worth the lean
// envelope). Conversation-context-dependent skills => inline-required. Everything
// else (status views, lookups, micro-edits) => inline (cheap; subprocess overhead
// would dominate).
//
// Order matters: inline-required (context-bound) is checked BEFORE the heavy
// subprocess patterns, because session:end is "mixed" — its handoff leg is
// context-bound even though its learn/mine/sleep legs are heavy. Wholesale-routing
// it would lose the live conversation (§13.5: split, don't route wholesale).
const INLINE_REQUIRED_RE = /^session:(end|handoff|dump|checkpoint|recap|resume|takenotes)$/;
const SUBPROCESS_RES = [
  /^scan:/, // scan:* — full system scans
  /^maps:/, // maps:* — relationship-graph synthesis
  /^research:deep$/,
  /^qa:audit$/,
  /^redteam:full$/,
  /^sleep:deep$/,
  /^learn:deep$/,
];
// Explicitly INLINE patterns — cheap status/lookups that must NOT be mis-swept into
// subprocess by a broad namespace rule. Checked before the per-namespace fallthrough.
const INLINE_RES = [
  /:(list|show|status|tail|query|explain|search|catalog|history|coverage)$/,
];

function classifyByHeuristic(slug) {
  if (INLINE_REQUIRED_RE.test(slug)) return { weight: "mixed", execution: "inline-required" };
  if (INLINE_RES.some((re) => re.test(slug))) return { weight: "light", execution: "inline" };
  if (SUBPROCESS_RES.some((re) => re.test(slug))) return { weight: "heavy", execution: "subprocess" };
  return { weight: "light", execution: "inline" };
}

// ── Frontmatter parse (mirrors generate-skill-catalog.js) ───
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

/**
 * classifySkill({ slug, frontmatter }) -> { weight, execution, source, subprocess_verified }
 * Pure — testable with a synthetic frontmatter object, no filesystem.
 */
function classifySkill(input) {
  const slug = input && input.slug;
  const fm = (input && input.frontmatter) || {};
  const declared = typeof fm.execution === "string" ? fm.execution.trim() : null;
  if (declared && EXECUTIONS.has(declared)) {
    // Author-declared execution wins. weight: honor a declared `weight:` else infer
    // (subprocess => heavy, inline-required => mixed, inline => light).
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
  // No (valid) frontmatter execution → §13.2 heuristic.
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
      "PLAN §13.2 skill-weight registry. execution is a PROPOSAL (author frontmatter `execution:` or the default heuristic). subprocess_verified is ALWAYS false here — a skill is only TRUSTED as a subprocess after a real headless smoke run (§13.6/§13.7) stamps it in the dispatch-contract keystone. dispatch-contract.js#skillExecution is the fail-closed reader.",
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
    /* ignore */
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

// ── CLI ─────────────────────────────────────────────────────
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
