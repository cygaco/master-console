#!/usr/bin/env node
/**
 * scripts/mc/test-diff.js — tests for the /mc:diff engine (#441).
 *
 * Builds two synthetic trees (a fake canonical + a fake product) under a temp
 * dir and asserts computeDiff classifies every divergence correctly. NEVER
 * touches a real sibling product (MC-only boundary) — all fixtures are
 * throwaway temp dirs.
 *
 * Coverage:
 *   - version delta (product behind)
 *   - product_stale (unchanged since install, canonical moved on)
 *   - product_modified (locally edited)
 *   - in-sync file (not reported)
 *   - missing_in_product (canonical ships it, product lacks it)
 *   - extra_in_product (product carries a framework file canonical dropped)
 *   - skills/agents/hooks Δ derived from the same sets
 *   - compareVersions
 *   - resolveProductRoot usage error
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const cHash = require("./lib/content-hash");
const diff = require("./diff");

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

// ── build fixtures ─────────────────────────────────────────────────────
const stamp = Date.now();
const tmp = path.join(os.tmpdir(), `warpdiff-${process.pid}-${stamp}`);
const canon = path.join(tmp, "canonical");
const prod = path.join(tmp, "product");

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function hashOf(root, rel) {
  return cHash.contentHash(path.join(root, rel));
}

try {
  fs.mkdirSync(path.join(canon, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(prod, ".claude"), { recursive: true });

  // Canonical version 0.11.0; product installed 0.10.0 (behind).
  write(canon, "version.json", JSON.stringify({ version: "0.11.0" }));

  // Canonical framework files on disk.
  write(canon, "a.txt", "A2\n"); // canonical moved on (product still A1)
  write(canon, "b.txt", "B\n");  // product locally modified to Bmod
  write(canon, "c.txt", "C\n");  // in sync
  write(canon, "d.txt", "D\n");  // missing in product

  // Product framework files on disk.
  write(prod, "a.txt", "A1\n");   // unchanged since install → product_stale
  const installedA = hashOf(prod, "a.txt");
  write(prod, "b.txt", "B\n");    // capture install-time hash first…
  const installedB = hashOf(prod, "b.txt");
  write(prod, "b.txt", "Bmod\n"); // …then locally modify → product_modified
  write(prod, "c.txt", "C\n");    // in sync
  const installedC = hashOf(prod, "c.txt");
  write(prod, "e.txt", "E\n");    // extra in product
  const installedE = hashOf(prod, "e.txt");

  // Canonical framework-installed.json — only dest/kind/owner are consulted on
  // the canonical side (current hash is read from disk).
  write(
    canon,
    ".claude/framework-installed.json",
    JSON.stringify({
      installedVersion: "0.11.0",
      assets: [
        { dest: "a.txt", kind: "skill", owner: "framework", installedHash: hashOf(canon, "a.txt") },
        { dest: "b.txt", kind: "agent", owner: "framework", installedHash: hashOf(canon, "b.txt") },
        { dest: "c.txt", kind: "hook", owner: "framework", installedHash: hashOf(canon, "c.txt") },
        { dest: "d.txt", kind: "skill", owner: "framework", installedHash: hashOf(canon, "d.txt") },
      ],
    }),
  );

  // Product framework-installed.json — installedHash drives stale-vs-modified.
  write(
    prod,
    ".claude/framework-installed.json",
    JSON.stringify({
      installedVersion: "0.10.0",
      assets: [
        { dest: "a.txt", kind: "skill", owner: "framework", installedHash: installedA },
        { dest: "b.txt", kind: "agent", owner: "framework", installedHash: installedB },
        { dest: "c.txt", kind: "hook", owner: "framework", installedHash: installedC },
        { dest: "e.txt", kind: "skill", owner: "framework", installedHash: installedE },
      ],
    }),
  );

  // ── run the diff ─────────────────────────────────────────────────────
  const r = diff.computeDiff(canon, prod);
  ok("computeDiff ok", r.ok === true, JSON.stringify(r));

  // Version delta.
  ok("canonicalVersion 0.11.0", r.canonicalVersion === "0.11.0", r.canonicalVersion);
  ok("productVersion 0.10.0", r.productVersion === "0.10.0", r.productVersion);
  ok("versionDelta product_behind", r.versionDelta === "product_behind", r.versionDelta);

  // Per-file classification.
  const byDest = Object.fromEntries(r.fileDrift.map((f) => [f.dest, f.status]));
  ok("a.txt → product_stale", byDest["a.txt"] === "product_stale", byDest["a.txt"]);
  ok("b.txt → product_modified", byDest["b.txt"] === "product_modified", byDest["b.txt"]);
  ok("c.txt in sync (not reported)", byDest["c.txt"] === undefined, byDest["c.txt"]);
  ok("d.txt → missing_in_product", byDest["d.txt"] === "missing_in_product", byDest["d.txt"]);
  ok("e.txt → extra_in_product", byDest["e.txt"] === "extra_in_product", byDest["e.txt"]);

  // Coverage lists.
  ok("coverage.missingInProduct = [d.txt]", JSON.stringify(r.coverage.missingInProduct) === '["d.txt"]', JSON.stringify(r.coverage.missingInProduct));
  ok("coverage.extraInProduct = [e.txt]", JSON.stringify(r.coverage.extraInProduct) === '["e.txt"]', JSON.stringify(r.coverage.extraInProduct));

  // Skills/agents/hooks delta.
  ok("sahMissing.skill = [d.txt]", JSON.stringify(r.skillsAgentsHooks.missingInProduct.skill) === '["d.txt"]', JSON.stringify(r.skillsAgentsHooks.missingInProduct.skill));
  ok("sahMissing.agent empty", r.skillsAgentsHooks.missingInProduct.agent.length === 0);
  ok("sahExtra.skill = [e.txt]", JSON.stringify(r.skillsAgentsHooks.extraInProduct.skill) === '["e.txt"]', JSON.stringify(r.skillsAgentsHooks.extraInProduct.skill));

  // Counts rollup.
  ok("drift count product_stale=1", r.counts.drift.product_stale === 1, JSON.stringify(r.counts.drift));
  ok("drift count product_modified=1", r.counts.drift.product_modified === 1, JSON.stringify(r.counts.drift));
  ok("drift count missing_in_product=1", r.counts.drift.missing_in_product === 1, JSON.stringify(r.counts.drift));
  ok("drift count extra_in_product=1", r.counts.drift.extra_in_product === 1, JSON.stringify(r.counts.drift));

  // ── compareVersions ──────────────────────────────────────────────────
  ok("compareVersions(0.10.0, 0.11.0) === -1", diff.compareVersions("0.10.0", "0.11.0") === -1);
  ok("compareVersions(1.0.0, 0.9.9) === 1", diff.compareVersions("1.0.0", "0.9.9") === 1);
  ok("compareVersions(0.10.0, 0.10.0) === 0", diff.compareVersions("0.10.0", "0.10.0") === 0);
  ok("compareVersions(0.10, 0.10.0) === 0 (length-tolerant)", diff.compareVersions("0.10", "0.10.0") === 0);

  // ── resolveProductRoot usage error ───────────────────────────────────
  const res = diff.resolveProductRoot(undefined, null);
  ok("resolveProductRoot with no slug/path → error", !!res.error, JSON.stringify(res));

  // ── product without framework-installed.json → ok:false ──────────────
  const empty = path.join(tmp, "empty-product");
  fs.mkdirSync(empty, { recursive: true });
  const r2 = diff.computeDiff(canon, empty);
  ok("missing framework-installed.json → ok:false", r2.ok === false, JSON.stringify(r2));
} finally {
  // Cleanup temp fixtures.
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
