#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const a = { from: "claude-opus-4-7", to: "claude-opus-4-8", apply: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--apply") a.apply = true;
    else if (k === "--from") a.from = argv[++i];
    else if (k === "--to") a.to = argv[++i];
    else if (k === "--root") a.root = path.resolve(argv[++i]);
    else if (k === "--help" || k === "-h") a.help = true;
    else { console.error(`unknown arg: ${k}`); process.exit(2); }
  }
  return a;
}

function labelOf(id) {
  const m = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/i);
  if (!m) return null;
  const fam = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${fam} ${m[2]}.${m[3]}`;
}

const DENY_DIRS = new Set([".git", "node_modules", ".mc", "backups"]);
const TEXT_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".json", ".md", ".yaml", ".yml", ".txt"]);

function isDenied(relPath) {
  const norm = relPath.split(path.sep).join("/");
  if (norm.startsWith(".claude/project/")) return true;
  if (norm.endsWith(".jsonl")) return true;
  if (path.basename(norm) === "IMPLEMENTATION_PLAN.md") return true;
  return false;
}

function walk(dir, root, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (DENY_DIRS.has(e.name)) continue;
      walk(full, root, out);
    } else if (e.isFile()) {
      if (!TEXT_EXT.has(path.extname(e.name))) continue;
      if (full === __filename) continue;
      const rel = path.relative(root, full);
      if (isDenied(rel)) continue;
      out.push(full);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/dispatch/bump-model.js [--from <id>] [--to <id>] [--root <dir>] [--apply]");
    process.exit(0);
  }
  if (!fs.existsSync(args.root)) {
    console.error(`root not found: ${args.root}`);
    process.exit(2);
  }
  if (args.from === args.to) {
    console.error("--from and --to are identical; nothing to do");
    process.exit(2);
  }

  const pairs = [[args.from, args.to]];
  const lf = labelOf(args.from), lt = labelOf(args.to);
  if (lf && lt) pairs.push([lf, lt]);

  const files = [];
  walk(args.root, args.root, files);

  const changed = [];
  let totalHits = 0;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    let next = text, hits = 0;
    for (const [a, b] of pairs) {
      if (!next.includes(a)) continue;
      const count = next.split(a).length - 1;
      hits += count;
      next = next.split(a).join(b);
    }
    if (hits > 0 && next !== text) {
      changed.push({ file: path.relative(args.root, f), hits });
      totalHits += hits;
      if (args.apply) fs.writeFileSync(f, next, "utf8");
    }
  }

  const mode = args.apply ? "APPLIED" : "DRY-RUN (no files written; pass --apply)";
  console.log(`bump-model: ${args.from} → ${args.to}  [${mode}]`);
  console.log(`root: ${args.root}`);
  console.log(`scanned ${files.length} text files (history/append-only excluded)\n`);
  if (changed.length === 0) {
    console.log("  no live references found — already up to date.");
  } else {
    for (const c of changed.sort((x, y) => y.hits - x.hits)) {
      console.log(`  ${String(c.hits).padStart(3)}  ${c.file}`);
    }
    console.log(`\n${totalHits} id/label reference(s) across ${changed.length} file(s).`);
    if (!args.apply) console.log("Re-run with --apply to write.");
  }
  console.log("\nNote: prose mentions (\"Opus 4.7\" without the full id) are intentionally");
  console.log("left for human review — they often live in dated/historical context.");
  process.exit(0);
}

main();
