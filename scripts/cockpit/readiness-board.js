#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildReadinessReport } = require("../scaffold/readiness-report");

const BOARD_SCHEMA = "mc/readiness-board/v1";
const DEFAULT_REGISTRY = path.join(os.homedir(), ".mc", "portfolio.json");

function readRegistry(registryPath) {
  try {
    const r = JSON.parse(fs.readFileSync(registryPath || DEFAULT_REGISTRY, "utf8"));
    const prods = r.products || {};
    if (Array.isArray(prods)) {
      return prods.map((p) => ({ slug: p.slug || p.id, repo_path: p.repo_path || p.path }));
    }
    return Object.entries(prods).map(([slug, v]) => ({ slug, repo_path: (v && (v.repo_path || v.path)) || null }));
  } catch {
    return [];
  }
}

function productReadiness(repoPath, opts = {}) {
  if (!repoPath || !fs.existsSync(repoPath)) return { present: false };
  try {
    return { present: true, report: buildReadinessReport(repoPath, { generated_at: opts.generated_at || null, product_id: opts.slug }) };
  } catch (e) {
    return { present: false, error: e.message };
  }
}

function buildBoard(opts = {}) {
  const products = opts.products || readRegistry(opts.registryPath);
  const reportFor = opts.reportFor || ((p) => productReadiness(p.repo_path, { generated_at: opts.generated_at, slug: p.slug }));

  const rows = products.map((p) => {
    const r = reportFor(p) || { present: false };
    if (!r.present || !r.report) {
      return { slug: p.slug, repo_path: p.repo_path || null, present: false, composite: null, summary: null };
    }
    return {
      slug: p.slug,
      repo_path: p.repo_path || null,
      present: true,
      composite: r.report.composite,
      summary: r.report.summary,
      items: opts.includeItems ? r.report.items : undefined,
    };
  });

  rows.sort((a, b) => {
    if (a.present !== b.present) return a.present ? -1 : 1;
    return (a.composite ?? 0) - (b.composite ?? 0);
  });

  const present = rows.filter((r) => r.present);
  return {
    schema: BOARD_SCHEMA,
    generated_at: opts.generated_at || null,
    product_count: rows.length,
    present_count: present.length,
    blocked_count: present.reduce((n, r) => n + (r.summary ? r.summary.blocked : 0), 0),
    products: rows,
  };
}

module.exports = { BOARD_SCHEMA, DEFAULT_REGISTRY, readRegistry, productReadiness, buildBoard };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : undefined; };
  const generated_at = new Date().toISOString();
  const json = argv.includes("--json");
  const slug = get("--product");
  const root = get("--root");

  if (root || slug) {
    let repoPath = root;
    if (!repoPath && slug) {
      const hit = readRegistry(get("--registry")).find((p) => p.slug === slug);
      repoPath = hit && hit.repo_path;
    }
    const r = productReadiness(repoPath, { generated_at, slug });
    if (!r.present) {
      console.error(`[cockpit] product not found / unreadable: ${slug || root}`);
      process.exit(1);
    }
    if (json) { console.log(JSON.stringify(r.report, null, 2)); }
    else {
      const s = r.report.summary;
      console.log(`${r.report.product_id}: ${r.report.composite}% ready (${s.completed}/${s.total} done, ${s.open} open, ${s.blocked} blocked)`);
      for (const it of r.report.items) {
        const flag = it.status === "done" ? "[x]" : it.status === "blocked" ? "[!]" : "[ ]";
        const lt = it.lead_time ? ` (~${it.lead_time.days}d)` : "";
        console.log(`  ${flag} ${it.id} [${it.owner_class}]${lt}`);
      }
    }
    process.exit(0);
  }

  const board = buildBoard({ generated_at, registryPath: get("--registry") });
  if (json) { console.log(JSON.stringify(board, null, 2)); process.exit(0); }

  if (board.product_count === 0) {
    console.log("[cockpit] no products registered (~/.mc/portfolio.json empty) — register one with /portfolio:register, or run `--root <path>` for a single product.");
    process.exit(0);
  }
  console.log(`Launch-readiness cockpit — ${board.present_count}/${board.product_count} products readable, ${board.blocked_count} blocked item(s):\n`);
  const w = Math.max(...board.products.map((p) => (p.slug || "").length), 7);
  console.log(`  ${"PRODUCT".padEnd(w)}  READY  DONE/TOTAL  OPEN  BLOCKED`);
  console.log(`  ${"-".repeat(w)}  -----  ----------  ----  -------`);
  for (const p of board.products) {
    if (!p.present) { console.log(`  ${(p.slug || "?").padEnd(w)}  ${"--".padStart(4)}   (repo not found)`); continue; }
    const s = p.summary;
    console.log(`  ${(p.slug || "?").padEnd(w)}  ${String(p.composite).padStart(3)}%   ${String(s.completed + "/" + s.total).padStart(10)}  ${String(s.open).padStart(4)}  ${String(s.blocked).padStart(7)}`);
  }
  console.log(`\nDrill into one: node scripts/cockpit/readiness-board.js --product <slug>`);
  process.exit(0);
}
