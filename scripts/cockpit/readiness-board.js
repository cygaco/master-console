#!/usr/bin/env node
"use strict";

// ── Cockpit: portfolio launch-readiness board ───────────────────────────────────
//
// S-PF-09b / E-PRODUCT-FOUNDATION-001 W3 (R-3). The operator-facing cockpit: the President
// runs `/cockpit:readiness` to see launch readiness across EVERY registered product at once
// (composite %, blocked count, owner-action work left), and can drill into one product.
//
// It is the aggregator over the R-1 keystone (scripts/scaffold/readiness-report.js): for each
// product in the portfolio registry (~/.mc/portfolio.json) it runs buildReadinessReport()
// against that product's repo and rolls the results into a board. ALSO the "runnable skill"
// retrofit/run-anywhere mechanism (DoP decision 2026-06-13): run it against any product —
// existing (retrofit) or new — without that product shipping any panel code.
//
// STRICTLY READ-ONLY against sibling product repos — it reads FOUNDERS_CHECKLIST.md state and
// never writes to another project (MC-only boundary: feedback_mc_only_no_cross_project).
// PURE/DETERMINISTIC: takes no clock; generated_at is stamped by the CLI.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildReadinessReport } = require("../scaffold/readiness-report");

const BOARD_SCHEMA = "mc/readiness-board/v1";
const DEFAULT_REGISTRY = path.join(os.homedir(), ".mc", "portfolio.json");

/** Read the portfolio registry → [{ slug, repo_path }]. Missing/unreadable → []. */
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

/** Read-only readiness for one product repo. Missing repo → { present:false }. */
function productReadiness(repoPath, opts = {}) {
  if (!repoPath || !fs.existsSync(repoPath)) return { present: false };
  try {
    return { present: true, report: buildReadinessReport(repoPath, { generated_at: opts.generated_at || null, product_id: opts.slug }) };
  } catch (e) {
    return { present: false, error: e.message };
  }
}

/**
 * Build the portfolio readiness board.
 * @param {object} [opts]
 *   opts.products      injected [{slug,repo_path}] (default: readRegistry).
 *   opts.registryPath  override registry path.
 *   opts.reportFor     injected (product) => { present, report } for tests (default: productReadiness).
 *   opts.generated_at  ISO stamp (CLI-supplied; pure fn takes no clock).
 *   opts.includeItems  include per-item detail in each row (drill-in).
 * @returns {Board}
 */
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

  // Sort: lowest readiness first (the products that need attention float up), missing last.
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

// ── CLI ─────────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const get = (flag) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : undefined; };
  const generated_at = new Date().toISOString(); // the only clock — keeps buildBoard() deterministic
  const json = argv.includes("--json");
  const slug = get("--product");
  const root = get("--root");

  // Single-product mode: --root <path> or --product <slug> (looked up in the registry).
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

  // Portfolio mode (default): the cockpit board across every registered product.
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
