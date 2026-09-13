#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const frameworkManifest = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".claude/framework-manifest.json"), "utf8"),
);
const mcManifest = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "_mc/MANIFEST.json"), "utf8"),
);

const REQUIRED = [
  "_mc/templates/app-scaffold/src/lib/telemetry/events.ts.tmpl",
  "_mc/templates/app-scaffold/src/lib/telemetry/sink.ts.tmpl",
  "_mc/templates/app-scaffold/src/lib/telemetry/track.ts.tmpl",
  "_mc/templates/app-scaffold/src/lib/telemetry/chain.ts.tmpl",
];

function flattenFrameworkAssets(manifest) {
  const out = new Set();
  for (const items of Object.values(manifest.assets || {})) {
    for (const item of items || []) {
      if (item.src) out.add(item.src);
      if (item.dest) out.add(item.dest);
    }
  }
  return out;
}

function flattenWarposPaths(manifest) {
  if (Array.isArray(manifest.paths)) {
    return new Set(manifest.paths.map((entry) => entry.path));
  }
  return new Set(Object.keys(manifest.paths || {}));
}

const frameworkPaths = flattenFrameworkAssets(frameworkManifest);
const mcPaths = flattenWarposPaths(mcManifest);

try {
  for (const rel of REQUIRED) {
    assert(frameworkPaths.has(rel), `framework manifest missing ${rel}`);
    assert(mcPaths.has(rel), `mc manifest missing ${rel}`);
  }
  console.log("PASS telemetry-templates-ship");
  console.log("manifest-shipping: 1 passed, 0 failed");
  process.exit(0);
} catch (err) {
  console.error(`FAIL telemetry-templates-ship: ${err.message}`);
  console.log("manifest-shipping: 0 passed, 1 failed");
  process.exit(1);
}
