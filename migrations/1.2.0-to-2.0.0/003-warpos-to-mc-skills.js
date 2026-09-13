#!/usr/bin/env node
// MC 1.2.0 -> 2.0.0 migration 003 — downstream product INSTALLED SKILLS: warp:<x> -> mc:<x>, scan:warpos-<x> -> scan:mc-<x>.
//
// S-OS-06 T4 (T-20260913-363). mc@2.0.0 renamed the `warp:` skill namespace to `mc:` and the `scan:warpos-<x>` skills
// to `scan:mc-<x>` (S-OS-06 T3 part 1c), and ships a one-release deprecated-alias skill at every legacy path (T3 part 2,
// removed in mc@2.1.0). This migration targets the product's .claude/commands/warp/*.md and
// .claude/commands/scan/warpos-*.md — including product-owned skills the framework never shipped.
//
// ORDERING FACT (scripts/mc/update.js): migrations run AFTER the 2.0.0 framework files are copied, so for every
// framework skill the canonical file (mc/<x>.md, scan/mc-<x>.md) AND the deprecated alias at the legacy path are
// usually ALREADY present. Per legacy skill file L with canonical twin C:
//   L is a deprecated alias                     -> kept (it IS the compat window; mc@2.1.0 removes it)
//   C absent (a product-owned legacy-namespace  -> C := L's body with its RESOLVABLE legacy invocations rewritten, then
//     skill, or an install the update did not       L := a deprecated alias forwarding to C (the legacy name keeps
//     copy C for)                                   working through the compat window)
//   C present, equal to L or to rewritten L     -> L := a deprecated alias (lossless: C already carries the body; this
//                                                  also completes a move interrupted between its two writes)
//   C present, divergent                        -> L kept in place, reported (a product-modified legacy skill the update
//                                                  did not overwrite — never clobbered; the operator reviews it)
//   a non-.md entry under the legacy dirs       -> ignored, reported
// Rewrite scope: ONLY the body being moved into C, and only invocation tokens / command paths whose mc target exists
// once this migration is done (warp:<x> when mc/<x>.md exists or is being moved in; scan:warpos-<x> likewise). An
// unresolvable token (e.g. a retired /warp:<x>) is left verbatim — rewriting it would point at a skill that does not exist.
//
// CLASS-3 DATA: the legacy literals below are what this migration operates ON; migrations/1.2.0-to-2.0.0/ is a
// Class-3, write-protected partition entry (the S-OS-06 partition's futureEntries, a frozen baseline key, read only via
// scripts/open-source/partition-loader.js) — no codemod or purity pass may rewrite them.
//
// Idempotent: after one run every legacy skill file is a deprecated alias or a reported divergent keep -> a second run
// writes nothing, status "noop". Any read/write failure returns ok:false (the loader halts; update.js rolls back).
//
// Invoked by update.js via migrations-loader (apply() / plan()) AND runnable as a CLI (main(); --plan = read-only).
"use strict";

const fs = require("fs");
const path = require("path");

const COMMANDS_REL = ".claude/commands";
const LEGACY_NS = "warp";
const CURRENT_NS = "mc";
const SCAN_DIR = "scan";
const LEGACY_SCAN_PREFIX = "warpos-";
const CURRENT_SCAN_PREFIX = "mc-";
const MIGRATION_REL = "migrations/1.2.0-to-2.0.0/003-warpos-to-mc-skills.js";
// The frontmatter every deprecated alias carries (T3 part 2 aliases and the ones this migration writes).
const ALIAS_RE = /^description:\s*"?\[deprecated alias (?:→|->) \/[a-z][\w-]*:[\w-]+\]/m;

const NS_TOKEN_RE = /(?<![\w-])warp:([a-z0-9][a-z0-9-]*)/g;
const SCAN_TOKEN_RE = /(?<![\w-])scan:warpos-([a-z0-9][a-z0-9-]*)/g;
const NS_PATH_RE = /(?<=commands[\\/])warp([\\/])([a-z0-9][a-z0-9-]*)\.md/g;
const SCAN_PATH_RE = /(?<=commands[\\/]scan[\\/])warpos-([a-z0-9][a-z0-9-]*)\.md/g;

function resolveRoot(ctx) {
  return (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function readDirOrNull(dirAbs) {
  try {
    return fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (e) {
    if (e.code === "ENOENT" || e.code === "ENOTDIR") return null;
    throw e;
  }
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function abs(root, rel) {
  return path.join(root, ...rel.split("/"));
}

/** Every legacy skill file + its canonical twin, plus the non-.md entries that are ignored. */
function enumerate(root) {
  const commandsAbs = abs(root, COMMANDS_REL);
  const pairs = [];
  const ignored = [];

  for (const e of readDirOrNull(path.join(commandsAbs, LEGACY_NS)) || []) {
    const legacyRel = `${COMMANDS_REL}/${LEGACY_NS}/${e.name}`;
    if (!e.isFile() || !e.name.endsWith(".md")) {
      ignored.push({ path: legacyRel, reason: "not a .md skill file" });
      continue;
    }
    const stem = e.name.slice(0, -3);
    pairs.push({
      kind: "ns",
      stem,
      legacyRel,
      canonicalRel: `${COMMANDS_REL}/${CURRENT_NS}/${e.name}`,
      legacyName: `${LEGACY_NS}:${stem}`,
      canonicalName: `${CURRENT_NS}:${stem}`,
    });
  }

  for (const e of readDirOrNull(path.join(commandsAbs, SCAN_DIR)) || []) {
    if (!e.name.startsWith(LEGACY_SCAN_PREFIX)) continue;
    const legacyRel = `${COMMANDS_REL}/${SCAN_DIR}/${e.name}`;
    if (!e.isFile() || !e.name.endsWith(".md")) {
      ignored.push({ path: legacyRel, reason: "not a .md skill file" });
      continue;
    }
    const stem = e.name.slice(LEGACY_SCAN_PREFIX.length, -3);
    pairs.push({
      kind: "scan",
      stem,
      legacyRel,
      canonicalRel: `${COMMANDS_REL}/${SCAN_DIR}/${CURRENT_SCAN_PREFIX}${stem}.md`,
      legacyName: `${SCAN_DIR}:${LEGACY_SCAN_PREFIX}${stem}`,
      canonicalName: `${SCAN_DIR}:${CURRENT_SCAN_PREFIX}${stem}`,
    });
  }
  return { pairs, ignored };
}

/** The mc skill names that resolve once this migration is done: canonical files on disk + every legacy file's twin. */
function resolvableTargets(root, pairs) {
  const ns = new Set();
  const scan = new Set();
  const commandsAbs = abs(root, COMMANDS_REL);
  for (const e of readDirOrNull(path.join(commandsAbs, CURRENT_NS)) || []) {
    if (e.isFile() && e.name.endsWith(".md")) ns.add(e.name.slice(0, -3));
  }
  for (const e of readDirOrNull(path.join(commandsAbs, SCAN_DIR)) || []) {
    if (e.isFile() && e.name.startsWith(CURRENT_SCAN_PREFIX) && e.name.endsWith(".md")) {
      scan.add(e.name.slice(CURRENT_SCAN_PREFIX.length, -3));
    }
  }
  for (const p of pairs) (p.kind === "ns" ? ns : scan).add(p.stem);
  return { ns, scan };
}

/** -> { text, count }: resolvable legacy invocations / command paths rewritten; unresolvable ones verbatim. */
function rewriteBody(text, targets) {
  let count = 0;
  const swap = (ok, to, match) => {
    if (!ok) return match;
    count++;
    return to;
  };
  const out = text
    .replace(NS_TOKEN_RE, (m, name) => swap(targets.ns.has(name), `${CURRENT_NS}:${name}`, m))
    .replace(SCAN_TOKEN_RE, (m, name) => swap(targets.scan.has(name), `${SCAN_DIR}:${CURRENT_SCAN_PREFIX}${name}`, m))
    .replace(NS_PATH_RE, (m, sep, name) => swap(targets.ns.has(name), `${CURRENT_NS}${sep}${name}.md`, m))
    .replace(SCAN_PATH_RE, (m, name) => swap(targets.scan.has(name), `${CURRENT_SCAN_PREFIX}${name}.md`, m));
  return { text: out, count };
}

function aliasStub(p, eol) {
  const legacy = `/${p.legacyName}`;
  const canonical = `/${p.canonicalName}`;
  const renamed =
    p.kind === "ns"
      ? `The \`${LEGACY_NS}:\` skill namespace was renamed to \`${CURRENT_NS}:\` in mc@2.0.0`
      : `The \`${SCAN_DIR}:${LEGACY_SCAN_PREFIX}*\` skills were renamed to \`${SCAN_DIR}:${CURRENT_SCAN_PREFIX}*\` in mc@2.0.0`;
  return [
    "---",
    `description: "[deprecated alias → ${canonical}] Forwards to ${canonical}. ${renamed}; this alias was written by ${MIGRATION_REL}. Removed in mc@2.1.0."`,
    "tags: [deprecated, alias, mc]",
    "---",
    "",
    `# ${legacy} — DEPRECATED, use ${canonical}`,
    "",
    `This skill is a thin alias that forwards to **\`${canonical}\`**. ${renamed}; the skill body now lives at \`${p.canonicalRel}\`. Behavior is identical; only the canonical name changed.`,
    "",
    "## Deprecation notice (one-time)",
    "",
    "Before forwarding, show this notice ONCE per session (skip it if it was already shown this session):",
    "",
    `> \`${legacy}\` is deprecated and will be removed in mc@2.1.0. Use \`${canonical}\`.`,
    "",
    "## Implementation",
    "",
    "Reads `$ARGUMENTS` and dispatches:",
    "",
    "```",
    `${canonical} $ARGUMENTS`,
    "```",
    "",
    "## Removal",
    "",
    `Scheduled for removal at \`mc@2.1.0\`. Update any docs, scripts, or skill references that still call \`${legacy}\` → \`${canonical}\`.`,
    "",
  ].join(eol);
}

function migratePair(root, p, targets, report) {
  const legacyAbs = abs(root, p.legacyRel);
  const canonicalAbs = abs(root, p.canonicalRel);
  const legacyText = fs.readFileSync(legacyAbs, "utf8");

  if (ALIAS_RE.test(legacyText)) {
    report.keptAliases.push({ path: p.legacyRel, forwardsTo: p.canonicalName, canonicalPresent: !!lstatOrNull(canonicalAbs) });
    return;
  }

  const eol = legacyText.includes("\r\n") ? "\r\n" : "\n";
  const rewritten = rewriteBody(legacyText, targets);
  const cs = lstatOrNull(canonicalAbs);

  if (!cs) {
    report.moved.push({ from: p.legacyRel, to: p.canonicalRel, legacyName: p.legacyName, canonicalName: p.canonicalName, tokensRewritten: rewritten.count });
    if (report.apply) {
      fs.mkdirSync(path.dirname(canonicalAbs), { recursive: true });
      fs.writeFileSync(canonicalAbs, rewritten.text, "utf8");
      fs.writeFileSync(legacyAbs, aliasStub(p, eol), "utf8");
    }
    return;
  }

  if (!cs.isFile()) {
    report.kept.push({ path: p.legacyRel, reason: `type conflict with ${p.canonicalRel} — legacy skill kept in place` });
    return;
  }

  const canonicalText = fs.readFileSync(canonicalAbs, "utf8");
  if (canonicalText === legacyText || canonicalText === rewritten.text) {
    report.aliased.push({
      path: p.legacyRel,
      forwardsTo: p.canonicalName,
      reason: canonicalText === legacyText ? "identical to the canonical skill" : "canonical already carries the rewritten body (completes an interrupted move)",
    });
    if (report.apply) fs.writeFileSync(legacyAbs, aliasStub(p, eol), "utf8");
    return;
  }

  report.kept.push({
    path: p.legacyRel,
    reason: `divergent from ${p.canonicalRel} — a product-modified legacy skill kept in place for review (/${p.canonicalName} is the canonical skill)`,
  });
}

function run(root, apply) {
  const report = { root, apply, moved: [], aliased: [], keptAliases: [], kept: [], ignored: [] };
  try {
    const { pairs, ignored } = enumerate(root);
    report.ignored.push(...ignored);
    const targets = resolvableTargets(root, pairs);
    for (const p of pairs) migratePair(root, p, targets, report);
  } catch (e) {
    const { root: _r, apply: _a, ...partial } = report;
    return { ok: false, status: "failed", reason: `${e.code || "error"}: ${e.message}`, ...partial };
  }
  const changes = report.moved.length + report.aliased.length;
  const { root: _r, apply: _a, ...rest } = report;
  return { ok: true, status: changes === 0 ? "noop" : apply ? "migrated" : "planned", ...rest };
}

function toOps(r) {
  if (!r.ok) return [{ op: "error", reason: r.reason }];
  return [
    ...r.moved.map((m) => ({ op: "move-skill", from: m.from, to: m.to, tokensRewritten: m.tokensRewritten })),
    ...r.aliased.map((a) => ({ op: "alias-legacy-skill", path: a.path, forwardsTo: a.forwardsTo, reason: a.reason })),
    ...r.kept.map((k) => ({ op: "keep-legacy-skill", path: k.path, reason: k.reason })),
    ...r.ignored.map((i) => ({ op: "ignore", path: i.path, reason: i.reason })),
  ];
}

async function apply(ctx) {
  return run(resolveRoot(ctx), true);
}

async function plan(ctx) {
  return toOps(run(resolveRoot(ctx), false));
}

function main(argv = process.argv.slice(2)) {
  const r = run(resolveRoot(null), !argv.includes("--plan"));
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  console.log(
    `[003] ${r.status}: moved=${n(r.moved)} aliased=${n(r.aliased)} keptAliases=${n(r.keptAliases)} kept=${n(r.kept)} ignored=${n(r.ignored)}`
  );
  for (const k of r.kept || []) console.log(`  kept ${k.path} — ${k.reason}`);
  if (!r.ok) console.error(`[003] ${r.reason}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "003-warpos-to-mc-skills",
  from: "1.2.0",
  to: "2.0.0",
  description:
    "Rename the product's installed legacy-namespace skills for mc@2.0.0 (.claude/commands/warp/<x>.md -> mc/<x>.md, scan/warpos-<x>.md -> scan/mc-<x>.md): move bodies whose canonical twin is absent (resolvable invocations rewritten) and leave a deprecated alias at the legacy path; keep shipped aliases; never clobber a product-modified legacy skill.",
  ALIAS_RE,
  apply,
  plan,
  main,
};
