#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * scripts/checks/mc-layer-diff.js — read-only observability view of the
 * MC framework/product boundary (SP-20260531-003).
 *
 * Two manifests define the boundary:
 *   - _mc/MANIFEST.json            ownership (owner=framework|generated|project|runtime)
 *   - .claude/framework-manifest.json  what SHIPS to consumer products (assets[])
 *
 * This scan cross-references them and reports the split of owner=framework paths:
 *   - PRODUCT LAYER     = owner=framework AND shipped      (reaches consumer products)
 *   - DEV-TOOLING LAYER = owner=framework AND NOT shipped  (framework-internal only)
 *   - SUMMARY           = counts
 *
 * READ-ONLY and INFORMATIONAL: it writes nothing and exits 0 on success
 * regardless of the split — it is NOT a gate (scan:mc-ship-coverage is the
 * fail-closed gate; this is the read-only report over the same data). It exits
 * non-zero ONLY on a setup error (missing/invalid manifest), so a missing
 * manifest can never masquerade as an empty diff (false reassurance).
 *
 * Usage:  node scripts/checks/mc-layer-diff.js [--json] [--root <dir>]
 * Exit:   0 = report emitted · 2 = setup error (missing/invalid manifest)
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.argv.includes("--root")
  ? path.resolve(process.argv[process.argv.indexOf("--root") + 1])
  : process.cwd();
const JSON_OUT = process.argv.includes("--json");

function fail(msg) {
  console.error(`mc-layer-diff: ${msg}`);
  process.exit(2);
}

function loadJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    fail(
      `missing ${rel} — run the manifest builders first ` +
        `(node scripts/generate-framework-manifest.js + node scripts/mc/manifest/build.js)`,
    );
  }
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    fail(`invalid JSON in ${rel}: ${e.message}`);
  }
}

// Flatten framework-manifest assets (+ single-file sections) into the set of
// shipped project-relative source paths. Mirrors mc-ship-coverage.js so the
// two scans agree on "what ships".
function shippedPathSet(fm) {
  const set = new Set();
  const addEntry = (e) => {
    if (e && typeof e === "object") {
      if (e.src) set.add(e.src);
      if (e.dest) set.add(e.dest);
    }
  };
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.src || v.dest) addEntry(v);
      else for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(fm.assets);
  for (const key of ["generated_files", "version_file", "installer_script"]) {
    if (fm[key]) walk(fm[key]);
  }
  return set;
}

function main() {
  const own = loadJson("_mc/MANIFEST.json");
  const fm = loadJson(".claude/framework-manifest.json");
  const shipped = shippedPathSet(fm);

  const productLayer = []; // owner=framework AND shipped
  const devToolingLayer = []; // owner=framework AND NOT shipped
  for (const [p, entry] of Object.entries(own.paths || {})) {
    if (!entry || entry.owner !== "framework") continue;
    if (entry.kind === "dir") continue; // dirs are implied by their files
    (shipped.has(p) ? productLayer : devToolingLayer).push(p);
  }
  productLayer.sort();
  devToolingLayer.sort();

  const summary = {
    product_layer: productLayer.length,
    dev_tooling_layer: devToolingLayer.length,
    total_framework_owned: productLayer.length + devToolingLayer.length,
  };

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        { product_layer: productLayer, dev_tooling_layer: devToolingLayer, summary },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  // Glanceable counts first, then the two flat lists, then the summary line.
  console.log(
    `MC layer diff — ${summary.total_framework_owned} framework-owned paths: ` +
      `${summary.product_layer} ship (product layer) · ${summary.dev_tooling_layer} do not (dev-tooling layer)`,
  );
  console.log("");
  console.log(
    `PRODUCT LAYER — framework-owned paths that SHIP to consumer products (${productLayer.length})`,
  );
  for (const p of productLayer) console.log(`  + ${p}`);
  console.log("");
  console.log(
    `DEV-TOOLING LAYER — framework-owned paths that do NOT ship (framework-internal) (${devToolingLayer.length})`,
  );
  for (const p of devToolingLayer) console.log(`  - ${p}`);
  console.log("");
  console.log(
    `SUMMARY — product: ${summary.product_layer} · dev-tooling: ${summary.dev_tooling_layer} · total framework-owned: ${summary.total_framework_owned}`,
  );
  process.exit(0);
}

main();
