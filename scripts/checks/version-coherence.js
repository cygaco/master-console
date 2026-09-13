#!/usr/bin/env node
/**
 * version-coherence.js — single enforcer for version + schema-label drift.
 *
 * Born from the 2026-05-30 audit, which found two drift classes that NO existing
 * gate caught:
 *   (1) PRODUCT VERSION lag — .claude/manifest.json#mc.version stayed 0.10.0
 *       after the 0.11.0 release because version-quorum doesn't check that field.
 *   (2) SCHEMA-LABEL divergence — paths.json carried v5 *content* but a v4 *label*
 *       (registry#version never bumped), and a stale framework-manifest/v1 fallback
 *       lingered while everything else was v2.
 *
 * Three checks:
 *   A. Product-version quorum (EXTENDED — covers the fields version-quorum misses:
 *      manifest.mc.version + install.ps1's MC_VERSION constant).
 *   B. Schema-label coherence (authoritative declarations of each schema family
 *      must agree — paths registry→derived→paths.json→schema validator→installed;
 *      framework-manifest version.json-claim vs declared).
 *   C. Broad sweep — any `mc/<family>/vN` family with >1 distinct version across
 *      OPERATIONAL tracked files (excludes migrations/fixtures/release-capsules/tests/
 *      accept-list validator/docs, which legitimately name historical versions).
 *
 * Exit 0 green, 1 red. Wired into /scan:full (Tier 3) + release-gates.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const asJson = process.argv.includes("--json");
const R = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const Rraw = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const findings = [];
const red = (check, msg) => findings.push({ severity: "red", check, msg });
const ok = (msg) => { if (!asJson) console.log("  ok: " + msg); };

// ── A. Product-version quorum (extended) ──────────────────────────────
try {
  const truth = R("version.json").version;
  const fields = [
    [".claude/manifest.json#mc.version", () => R(".claude/manifest.json").mc.version],
    [".claude/framework-manifest.json#version", () => R(".claude/framework-manifest.json").version],
    [".claude/framework-installed.json#installedVersion", () => R(".claude/framework-installed.json").installedVersion],
  ];
  let drift = 0;
  for (const [where, get] of fields) {
    let val;
    try { val = get(); } catch { continue; }
    if (val !== truth) { red("product-version", `${where} = ${val} ≠ version.json ${truth}`); drift++; }
  }
  // install.ps1 fallback constant (the one that fired the spurious 0.4.3 warning)
  const m = Rraw("install.ps1").match(/\$Script:MC_VERSION\s*=\s*"([^"]+)"/);
  if (m && m[1] !== truth) { red("product-version", `install.ps1 $Script:MC_VERSION = ${m[1]} ≠ version.json ${truth}`); drift++; }
  if (!drift) ok(`product version ${truth} agrees across manifest/framework-manifest/installed/install.ps1`);
} catch (e) { red("product-version", "error: " + e.message); }

// ── B. Schema-label coherence (authoritative declarations) ─────────────
try {
  const vj = R("version.json");
  // paths family — registry#version is the root; everything derives "mc/paths/v<N>"
  const regV = R("framework/paths.registry.json").version;
  const derived = "mc/paths/v" + regV;
  const pathsDecls = [
    ["version.json#pathRegistrySchema", vj.pathRegistrySchema],
    [".claude/paths.json#$schema", R(".claude/paths.json")["$schema"]],
    ["schemas/paths.schema.json#$id", R("schemas/paths.schema.json")["$id"]],
    ["schemas/paths.schema.json const", R("schemas/paths.schema.json").properties["$schema"].const],
  ];
  let pd = 0;
  for (const [where, val] of pathsDecls) if (val !== derived) { red("paths-schema", `${where} = ${val} ≠ registry-derived ${derived}`); pd++; }
  const fiPRV = R(".claude/framework-installed.json").pathRegistryVersion;
  if (fiPRV !== "v" + regV) { red("paths-schema", `framework-installed#pathRegistryVersion = ${fiPRV} ≠ v${regV}`); pd++; }
  if (!pd) ok(`paths schema label ${derived} agrees across registry/paths.json/validator/version.json/installed`);

  // framework-manifest family (generator stamps it into the `$schema` field)
  const fmJson = R(".claude/framework-manifest.json");
  const fmDeclared = fmJson["$schema"] || fmJson.schema;
  if (vj.frameworkManifestSchema !== fmDeclared) red("framework-manifest-schema", `version.json#frameworkManifestSchema=${vj.frameworkManifestSchema} ≠ framework-manifest.json#schema=${fmDeclared}`);
  else ok(`framework-manifest schema label ${fmDeclared} agrees`);
} catch (e) { red("schema-label", "error: " + e.message); }

// ── C. Broad sweep: any family with >1 version in operational tracked files ──
try {
  const tracked = execSync("git ls-files", { cwd: ROOT, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const EXCLUDE = [
    /(^|\/)migrations\//,            // migration defs legitimately name old versions
    /(^|\/)fixtures\//,              // fixtures simulate old installs
    /(^|\/)framework\/releases\//,   // frozen release capsules
    /[._-]test[._-]|test-|\.test\./, // test files replay old versions
    /scripts\/schemas\/validate\.js$/, // accept-list lists multiple by design
    /\.md$/,                         // docs/changelogs name historical versions
    /(^|\/)\.claude\/project\/sprint\/sprints\//, // closed-sprint manifests replay their era's schema (same class as migrations/fixtures/tests)
  ];
  const fams = {}; // family -> { version -> [files] }
  for (const f of tracked) {
    if (EXCLUDE.some((re) => re.test(f))) continue;
    if (!/\.(js|json|ps1)$/.test(f)) continue;
    let txt;
    try { txt = fs.readFileSync(path.join(ROOT, f), "utf8"); } catch { continue; }
    const re = /mc\/([a-z][a-z-]*(?:\/[a-z][a-z-]*)?)\/v(\d+)/g;
    let mm;
    while ((mm = re.exec(txt))) {
      const fam = mm[1], ver = "v" + mm[2];
      fams[fam] = fams[fam] || {};
      (fams[fam][ver] = fams[fam][ver] || new Set()).add(f);
    }
  }
  let split = 0;
  for (const [fam, vers] of Object.entries(fams)) {
    const vlist = Object.keys(vers);
    if (vlist.length > 1) {
      split++;
      const detail = vlist.map((v) => `${v} in [${[...vers[v]].slice(0, 3).join(", ")}]`).join(" vs ");
      red("family-split", `mc/${fam}: ${detail}`);
    }
  }
  if (!split) ok("no schema family carries >1 version label in operational files");
} catch (e) {
  // Broad sweep is best-effort (needs git); never crash the whole check on its failure.
  if (!asJson) console.log("  note: broad sweep skipped — " + e.message);
}

// ── Report ──────────────────────────────────────────────────────────
if (asJson) {
  process.stdout.write(JSON.stringify({ ok: findings.length === 0, findings }, null, 2) + "\n");
} else {
  console.log("");
  if (findings.length) { for (const f of findings) console.error(`  RED [${f.check}]: ${f.msg}`); console.error(`version-coherence: ${findings.length} drift finding(s)`); }
  else console.log("version-coherence: all version + schema labels agree");
}
process.exit(findings.length ? 1 : 0);
