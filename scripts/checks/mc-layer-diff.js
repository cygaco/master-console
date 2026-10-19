#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

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

  const productLayer = [];
  const devToolingLayer = [];
  for (const [p, entry] of Object.entries(own.paths || {})) {
    if (!entry || entry.owner !== "framework") continue;
    if (entry.kind === "dir") continue;
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
