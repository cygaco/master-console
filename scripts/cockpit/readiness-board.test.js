#!/usr/bin/env node
"use strict";

// Tests for the cockpit portfolio readiness board (S-PF-09b / R-3). Drives buildBoard()
// with injected products + reportFor (no real sibling repos needed), plus readRegistry shape.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { BOARD_SCHEMA, readRegistry, buildBoard } = require("./readiness-board");

let passes = 0;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) { passes++; console.log(`  ok  ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const GEN_AT = "2026-06-14T00:00:00.000Z";

// A fake per-product report (the shape buildReadinessReport returns).
function fakeReport(slug, { completed, total, open, blocked }) {
  return {
    present: true,
    report: {
      schema: "mc/readiness/v1", product_id: slug, composite: total ? Math.round((completed / total) * 100) : 0,
      summary: { total, completed, open, blocked, owner_action: total, sprint_work: 0, waiver: blocked },
      items: [{ id: "provider.accounts", status: "open", owner_class: "owner-action" }],
    },
  };
}

// ── AC-B10: N products → board renders N rows with composite + blocked-count ─────
console.log("AC-B10 — portfolio board over N products:");
{
  const products = [
    { slug: "alpha-app", repo_path: "/x/alpha" },
    { slug: "beta-app", repo_path: "/x/beta" },
    { slug: "gamma-app", repo_path: "/x/gamma" },
  ];
  const reports = {
    "alpha-app": fakeReport("alpha-app", { completed: 5, total: 6, open: 1, blocked: 0 }),
    "beta-app": fakeReport("beta-app", { completed: 1, total: 6, open: 3, blocked: 2 }),
    "gamma-app": fakeReport("gamma-app", { completed: 0, total: 0, open: 0, blocked: 0 }),
  };
  const board = buildBoard({ products, generated_at: GEN_AT, reportFor: (p) => reports[p.slug] });
  ok("schema is mc/readiness-board/v1", board.schema === BOARD_SCHEMA);
  ok("product_count = 3", board.product_count === 3, `got ${board.product_count}`);
  ok("present_count = 3", board.present_count === 3);
  ok("blocked_count aggregates (0+2+0=2)", board.blocked_count === 2, `got ${board.blocked_count}`);
  ok("each row carries composite", board.products.every((r) => typeof r.composite === "number"));
  // sorted lowest-readiness-first: gamma(0) , beta(17), alpha(83)
  ok("sorted lowest readiness first", board.products[0].composite <= board.products[2].composite, board.products.map((p) => p.composite).join(","));
}

// ── Missing product repo → present:false row, floats to the bottom ──────────────
console.log("\nMissing repo handling:");
{
  const products = [
    { slug: "ok-app", repo_path: "/x/ok" },
    { slug: "gone-app", repo_path: "/x/does-not-exist" },
  ];
  const board = buildBoard({
    products, generated_at: GEN_AT,
    reportFor: (p) => (p.slug === "ok-app" ? fakeReport("ok-app", { completed: 2, total: 4, open: 2, blocked: 0 }) : { present: false }),
  });
  ok("present_count = 1 (one repo missing)", board.present_count === 1, `got ${board.present_count}`);
  const gone = board.products.find((r) => r.slug === "gone-app");
  ok("missing product row has present:false + null composite", gone && gone.present === false && gone.composite === null);
  ok("missing product sorts last", board.products[board.products.length - 1].slug === "gone-app");
}

// ── Graceful empty: no products ─────────────────────────────────────────────────
console.log("\nGraceful empty:");
{
  const board = buildBoard({ products: [], generated_at: GEN_AT });
  ok("product_count = 0", board.product_count === 0);
  ok("blocked_count = 0", board.blocked_count === 0);
  ok("products is []", Array.isArray(board.products) && board.products.length === 0);
}

// ── Determinism ─────────────────────────────────────────────────────────────────
console.log("\nDeterminism:");
{
  const products = [{ slug: "a", repo_path: "/x/a" }];
  const rf = () => fakeReport("a", { completed: 1, total: 2, open: 1, blocked: 0 });
  const a = JSON.stringify(buildBoard({ products, generated_at: GEN_AT, reportFor: rf }));
  const b = JSON.stringify(buildBoard({ products, generated_at: GEN_AT, reportFor: rf }));
  ok("two builds byte-identical", a === b);
}

// ── readRegistry: object-keyed, array, and missing forms ────────────────────────
console.log("\nreadRegistry shapes:");
{
  const tmp = path.join(os.tmpdir(), `cockpit-reg-${process.pid}.json`);
  // object-keyed (the real ~/.mc/portfolio.json shape)
  fs.writeFileSync(tmp, JSON.stringify({ schema: "x", products: { foo: { repo_path: "/x/foo" }, bar: { repo_path: "/x/bar" } } }));
  const objForm = readRegistry(tmp);
  ok("object-keyed registry → 2 products with slug+repo_path", objForm.length === 2 && objForm.every((p) => p.slug && p.repo_path), JSON.stringify(objForm));
  // array form
  fs.writeFileSync(tmp, JSON.stringify({ products: [{ slug: "baz", repo_path: "/x/baz" }] }));
  ok("array registry → 1 product", readRegistry(tmp).length === 1);
  try { fs.rmSync(tmp); } catch { /* ignore */ }
  // missing file → []
  ok("missing registry → [] (graceful)", readRegistry(path.join(os.tmpdir(), "definitely-not-here.json")).length === 0);
}

// ── Real registry smoke (read-only): does not throw, returns rows ────────────────
console.log("\nReal registry smoke (read-only):");
{
  // Uses the actual ~/.mc/portfolio.json + real repos (read-only). Just assert no throw.
  let threw = false, board;
  try { board = buildBoard({ generated_at: GEN_AT }); } catch { threw = true; }
  ok("buildBoard over the real registry does not throw", !threw);
  ok("board has a products array", board && Array.isArray(board.products));
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
