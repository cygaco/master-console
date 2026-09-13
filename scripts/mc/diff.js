#!/usr/bin/env node
/**
 * scripts/mc/diff.js — canonical ↔ product divergence report (#441).
 *
 * The engine behind /mc:diff (and /portfolio:diff <slug>). Diffs THIS
 * canonical MC checkout against an installed product repo and reports:
 *   1. version + staleness   — product installedVersion vs canonical version
 *   2. framework file drift   — framework-owned files whose on-disk content
 *                               diverges, sub-classified product_stale
 *                               (canonical moved on) vs product_modified
 *                               (locally edited) vs missing_in_product
 *   3. coverage gaps          — framework files canonical ships that the product
 *                               lacks (missing) and files the product carries
 *                               that canonical dropped (extra)
 *   4. skills/agents/hooks Δ  — present in canonical but missing in product,
 *                               and vice-versa
 *
 * READ-ONLY and canonical-side: it reads the product repo, it NEVER writes to
 * it (per the MC-only / products-in-their-own-session boundary). The
 * product is identified by a registered slug (resolved via the portfolio
 * registry) or an explicit --product <path>.
 *
 * Usage:
 *   node scripts/mc/diff.js <slug>            # resolve via portfolio registry
 *   node scripts/mc/diff.js --product <path>  # explicit product root
 *   node scripts/mc/diff.js <slug> --json     # machine-readable report
 *
 * Exit codes:
 *   0 — report produced (divergence is informational, not an error)
 *   2 — usage / resolution error (no slug+path, product unreadable, etc.)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const cHash = require("./lib/content-hash");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ── small helpers ──────────────────────────────────────────────────────

function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function hashFileMaybe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return cHash.contentHash(file);
  } catch {
    return null;
  }
}

/** Numeric-ish semver compare. Returns -1 / 0 / 1 (a<b / a==b / a>b). */
function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b || "0").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const SAH_KINDS = new Set(["skill", "agent", "hook"]);

// ── core diff ──────────────────────────────────────────────────────────

/**
 * Compute the divergence report between a canonical root and a product root.
 * Pure w.r.t. its inputs (only reads the two trees) so it is unit-testable
 * against synthetic fixtures.
 *
 * @returns {{
 *   ok: boolean, error?: string,
 *   canonicalVersion: string, productVersion: string, versionDelta: string,
 *   fileDrift: Array<{dest,status,kind}>,
 *   coverage: { missingInProduct: string[], extraInProduct: string[] },
 *   skillsAgentsHooks: { missingInProduct: object, extraInProduct: object },
 *   counts: object,
 * }}
 */
function computeDiff(canonicalRoot, productRoot) {
  const canonInstalled =
    readJsonMaybe(path.join(canonicalRoot, ".claude", "framework-installed.json")) || {};
  const prodInstalled = readJsonMaybe(
    path.join(productRoot, ".claude", "framework-installed.json"),
  );

  if (!prodInstalled) {
    return {
      ok: false,
      error: `product has no readable .claude/framework-installed.json under ${productRoot} — is MC installed there?`,
    };
  }

  const canonVersionDoc = readJsonMaybe(path.join(canonicalRoot, "version.json")) || {};
  const canonicalVersion =
    canonVersionDoc.version || canonInstalled.installedVersion || "0.0.0";
  const productVersion = prodInstalled.installedVersion || "0.0.0";
  const cmp = compareVersions(productVersion, canonicalVersion);
  const versionDelta =
    cmp < 0 ? "product_behind" : cmp > 0 ? "product_ahead" : "same";

  // Index framework-owned assets by dest on each side.
  const canonAssets = (canonInstalled.assets || []).filter((a) => a.owner === "framework");
  const prodAssets = (prodInstalled.assets || []).filter((a) => a.owner === "framework");
  const canonByDest = new Map(canonAssets.map((a) => [a.dest, a]));
  const prodByDest = new Map(prodAssets.map((a) => [a.dest, a]));

  const fileDrift = [];
  const missingInProduct = [];
  const extraInProduct = [];

  // Walk canonical's framework files: classify each against the product.
  for (const [dest, a] of canonByDest) {
    const canonHash = hashFileMaybe(path.join(canonicalRoot, dest));
    const prodFileAbs = path.join(productRoot, dest);
    const prodExists = fs.existsSync(prodFileAbs);
    if (!prodExists) {
      missingInProduct.push(dest);
      fileDrift.push({ dest, kind: a.kind, status: "missing_in_product" });
      continue;
    }
    const prodHash = hashFileMaybe(prodFileAbs);
    if (canonHash && prodHash && !cHash.hashMatches(canonHash, prodHash)) {
      // Diverges from canonical. Sub-classify using the product's own
      // install-time hash: unchanged-since-install ⇒ product is just stale;
      // changed-since-install ⇒ the product locally modified the file.
      const prodAsset = prodByDest.get(dest);
      const installedHash = prodAsset && prodAsset.installedHash;
      const productModified =
        installedHash && !cHash.hashMatches(prodHash, installedHash);
      fileDrift.push({
        dest,
        kind: a.kind,
        status: productModified ? "product_modified" : "product_stale",
      });
    }
  }

  // Files the product carries as framework-owned that canonical no longer ships.
  for (const dest of prodByDest.keys()) {
    if (!canonByDest.has(dest)) {
      extraInProduct.push(dest);
      const a = prodByDest.get(dest);
      fileDrift.push({ dest, kind: a.kind, status: "extra_in_product" });
    }
  }

  // Skills / agents / hooks delta (by kind), derived from the same asset sets.
  const sahMissing = { skill: [], agent: [], hook: [] };
  const sahExtra = { skill: [], agent: [], hook: [] };
  for (const [dest, a] of canonByDest) {
    if (SAH_KINDS.has(a.kind) && !prodByDest.has(dest)) sahMissing[a.kind].push(dest);
  }
  for (const [dest, a] of prodByDest) {
    if (SAH_KINDS.has(a.kind) && !canonByDest.has(dest)) sahExtra[a.kind].push(dest);
  }

  const driftCounts = fileDrift.reduce((m, d) => {
    m[d.status] = (m[d.status] || 0) + 1;
    return m;
  }, {});

  return {
    ok: true,
    canonicalVersion,
    productVersion,
    versionDelta,
    fileDrift,
    coverage: { missingInProduct, extraInProduct },
    skillsAgentsHooks: { missingInProduct: sahMissing, extraInProduct: sahExtra },
    counts: {
      canonicalFrameworkFiles: canonByDest.size,
      productFrameworkFiles: prodByDest.size,
      drift: driftCounts,
      sahMissing: { skill: sahMissing.skill.length, agent: sahMissing.agent.length, hook: sahMissing.hook.length },
      sahExtra: { skill: sahExtra.skill.length, agent: sahExtra.agent.length, hook: sahExtra.hook.length },
    },
  };
}

// ── product resolution (slug via portfolio registry, or explicit path) ──

function resolveProductRoot(arg, explicitPath) {
  if (explicitPath) {
    return { root: path.resolve(explicitPath), slug: null, registryEntry: null };
  }
  if (!arg) return { error: "no <slug> and no --product <path> provided" };
  // Treat an existing directory path as a direct root; otherwise resolve via registry.
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) {
    return { root: path.resolve(arg), slug: null, registryEntry: null };
  }
  let registry;
  try {
    registry = require("../portfolio/registry");
  } catch (e) {
    return { error: `cannot load portfolio registry (${e.message}); pass --product <path>` };
  }
  const entry = registry.findBySlug(arg);
  if (!entry) {
    return { error: `no registered product with slug "${arg}" (and not a directory); pass --product <path>` };
  }
  return { root: entry.repo_path, slug: entry.slug, registryEntry: entry };
}

// ── human report ───────────────────────────────────────────────────────

function renderHuman(report, ctx) {
  const L = [];
  const label = ctx.slug ? `${ctx.slug} (${ctx.root})` : ctx.root;
  L.push(`MC divergence — canonical ${report.canonicalVersion} ↔ product ${report.productVersion}`);
  L.push(`  product: ${label}`);
  const deltaWord =
    report.versionDelta === "product_behind"
      ? `BEHIND canonical`
      : report.versionDelta === "product_ahead"
        ? `AHEAD of canonical`
        : `in sync (same version)`;
  L.push(`  version: ${deltaWord}`);
  if (ctx.registryEntry && ctx.registryEntry.last_synced) {
    L.push(`  last synced: ${ctx.registryEntry.last_synced}`);
  }
  const c = report.counts;
  L.push("");
  L.push(`  framework files: canonical ${c.canonicalFrameworkFiles} · product ${c.productFrameworkFiles}`);
  const d = c.drift || {};
  L.push(
    `  drift: ${d.product_modified || 0} product-modified · ${d.product_stale || 0} stale · ` +
      `${d.missing_in_product || 0} missing-in-product · ${d.extra_in_product || 0} extra-in-product`,
  );
  L.push(
    `  skills/agents/hooks missing in product: ` +
      `${c.sahMissing.skill} skills · ${c.sahMissing.agent} agents · ${c.sahMissing.hook} hooks`,
  );
  L.push(
    `  skills/agents/hooks extra in product:   ` +
      `${c.sahExtra.skill} skills · ${c.sahExtra.agent} agents · ${c.sahExtra.hook} hooks`,
  );

  // Top divergent files (cap the human view).
  const interesting = report.fileDrift.filter((f) => f.status !== "product_stale");
  if (interesting.length) {
    L.push("");
    L.push(`  notable file divergences (${interesting.length}):`);
    for (const f of interesting.slice(0, 25)) L.push(`    ${f.status.padEnd(18)} ${f.dest}`);
    if (interesting.length > 25) L.push(`    … and ${interesting.length - 25} more`);
  }
  return L.join("\n");
}

// ── CLI ────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonOut = args.includes("--json");
  const prodIdx = args.indexOf("--product");
  const explicitPath = prodIdx !== -1 ? args[prodIdx + 1] : null;
  const positional = args.find((a) => !a.startsWith("--") && a !== explicitPath);

  const resolved = resolveProductRoot(positional, explicitPath);
  if (resolved.error) {
    process.stderr.write(`mc:diff: ${resolved.error}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(resolved.root)) {
    process.stderr.write(`mc:diff: product root does not exist: ${resolved.root}\n`);
    process.exit(2);
  }

  const report = computeDiff(REPO_ROOT, resolved.root);
  if (!report.ok) {
    process.stderr.write(`mc:diff: ${report.error}\n`);
    process.exit(2);
  }

  if (jsonOut) {
    process.stdout.write(
      JSON.stringify({ ...report, product: { slug: resolved.slug, root: resolved.root } }, null, 2) + "\n",
    );
  } else {
    process.stdout.write(renderHuman(report, resolved) + "\n");
  }
  process.exit(0);
}

module.exports = { computeDiff, compareVersions, resolveProductRoot };
