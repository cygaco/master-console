#!/usr/bin/env node
"use strict";
/**
 * assert-mc-templates-shipped.js — anti-value-inversion proof for the
 * SP-20260618-001 framework/templates → _mc/templates migration.
 *
 * ship-coverage proves "no owner=framework path is unshipped". This asserts the
 * STRONGER, migration-specific invariant the quality-lead made binding (addendum §2):
 * a single `src` entry for the dir is NOT enough — every one of the 108 template
 * files across all 9 subtrees must actually land in the shipped set (count +
 * membership, not a one-string smoke). Plus the NEGATIVE: _mc build-outputs
 * (MANIFEST.json, settings/) must NOT be shipped (proves the carve was surgical).
 *
 * Run pre-delete AND post-delete (both must pass). Exit 0 = all assertions hold; 1 = fail.
 */
const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();

const TEMPLATES_REL = "_mc/templates";
const EXPECTED_SUBTREES = [
  "app-scaffold", "canonical", "lastmile", "portfolio", "product-bootstrap",
  "product-clone", "product-import", "report", "sprint",
];
// No hardcoded EXPECTED_FILE_COUNT: it rotted (was 122, the tree grew to 138) every time a
// template was added, and a hardcode-to-today's-number just re-arms the same rot. The real
// invariant is a BIJECTION between what's on disk and what the shipping manifest enumerates
// (asserted below): every on-disk template ships AND every shipped template is on disk. That
// derives the count from the manifest, self-updates as templates are added/removed, and is
// strictly stronger — it names WHICH file drifted, not merely that a count changed.

function toRel(p) {
  return p.split(path.sep).join("/");
}

// Flatten framework-manifest assets into the shipped src/dest path set (same walk
// as mc-ship-coverage.js#shippedPathSet — the authoritative shipped set).
function shippedPathSet(fm) {
  const set = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (v.src || v.dest) {
        if (v.src) set.add(v.src);
        if (v.dest) set.add(v.dest);
      } else for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(fm.assets);
  for (const key of ["generated_files", "version_file", "installer_script"]) {
    if (fm[key]) walk(fm[key]);
  }
  return set;
}

// Recursively list files under a dir, project-relative with forward slashes.
function listFiles(absDir, relBase, out) {
  for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, ent.name);
    const rel = `${relBase}/${ent.name}`;
    if (ent.isDirectory()) listFiles(abs, rel, out);
    else out.push(rel);
  }
  return out;
}

function main() {
  const failures = [];
  const fm = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude/framework-manifest.json"), "utf8"));
  const shipped = shippedPathSet(fm);

  // ── POSITIVE: count + membership ──────────────────────────────────────────
  const tmplAbs = path.join(ROOT, TEMPLATES_REL);
  if (!fs.existsSync(tmplAbs)) {
    failures.push(`POSITIVE: ${TEMPLATES_REL} does not exist on disk`);
  } else {
    const onDisk = listFiles(tmplAbs, TEMPLATES_REL, []).map(toRel);
    const onDiskSet = new Set(onDisk);
    const shippedTemplates = new Set([...shipped].filter((p) => p.startsWith(`${TEMPLATES_REL}/`)));
    // (a) BIJECTION (derive-from-manifest, no magic count): every SHIPPED template must be on
    // disk. Paired with (b) below (every on-disk template ships), this is a bijection between
    // disk and the shipping manifest — self-updating as templates are added/removed, and it
    // catches a stale manifest (a shipped path whose file was deleted) that a bare count would
    // miss.
    const shippedNotOnDisk = [...shippedTemplates].filter((p) => !onDiskSet.has(p));
    if (shippedNotOnDisk.length) {
      failures.push(`POSITIVE: ${shippedNotOnDisk.length} shipped ${TEMPLATES_REL} path(s) NOT on disk (stale manifest), e.g.:\n    - ${shippedNotOnDisk.slice(0, 5).join("\n    - ")}`);
    }
    // (b) every on-disk template file is in the shipped set (membership, not single-string)
    const missing = onDisk.filter((p) => !shipped.has(p));
    if (missing.length) {
      failures.push(`POSITIVE: ${missing.length} ${TEMPLATES_REL} file(s) NOT in shipped set, e.g.:\n    - ${missing.slice(0, 5).join("\n    - ")}`);
    }
    // (c) all 9 subtrees represented in the shipped set
    for (const sub of EXPECTED_SUBTREES) {
      const prefix = `${TEMPLATES_REL}/${sub}/`;
      const anyShipped = [...shipped].some((p) => p.startsWith(prefix));
      if (!anyShipped) failures.push(`POSITIVE: subtree ${prefix} has ZERO shipped files`);
    }
    const shippedTemplateCount = [...shipped].filter((p) => p.startsWith(`${TEMPLATES_REL}/`)).length;
    console.log(`POSITIVE: ${onDisk.length} files on disk, ${shippedTemplateCount} ${TEMPLATES_REL}/* paths in shipped set, ${EXPECTED_SUBTREES.length} subtrees checked`);
  }

  // ── NEGATIVE: _mc build-outputs must NOT ship ─────────────────────────
  const mustNotShip = ["_mc/MANIFEST.json", "_mc/settings/defaults.json"];
  for (const p of mustNotShip) {
    if (shipped.has(p)) failures.push(`NEGATIVE: ${p} IS in the shipped set (carve not surgical)`);
  }
  if ([...shipped].some((p) => p.startsWith("_mc/settings/"))) {
    failures.push(`NEGATIVE: a _mc/settings/* path IS in the shipped set`);
  }
  // _mc/BASELINE/ is owner=project build-output (per-install seed snapshot for the
  // deferred validate.js seed-drift consumer) — NOT a shipped asset. Pin it symmetrically
  // so a future accidental BASELINE ship fails this enforcer (gauntlet qa-reviewer LOW,
  // SP-20260618-001).
  if ([...shipped].some((p) => p.startsWith("_mc/BASELINE/"))) {
    failures.push(`NEGATIVE: a _mc/BASELINE/* path IS in the shipped set`);
  }
  console.log(`NEGATIVE: confirmed _mc/MANIFEST.json + _mc/settings/* + _mc/BASELINE/* NOT shipped`);

  if (failures.length) {
    console.error(`\nFAIL (${failures.length}):\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("\nOK — all positive (count+membership) and negative assertions hold.");
}

main();
