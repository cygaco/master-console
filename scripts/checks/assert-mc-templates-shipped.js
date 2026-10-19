#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.cwd();

const TEMPLATES_REL = "_mc/templates";
const EXPECTED_SUBTREES = [
  "app-scaffold", "canonical", "lastmile", "portfolio", "product-bootstrap",
  "product-clone", "product-import", "report", "sprint",
];

function toRel(p) {
  return p.split(path.sep).join("/");
}

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

  const tmplAbs = path.join(ROOT, TEMPLATES_REL);
  if (!fs.existsSync(tmplAbs)) {
    failures.push(`POSITIVE: ${TEMPLATES_REL} does not exist on disk`);
  } else {
    const onDisk = listFiles(tmplAbs, TEMPLATES_REL, []).map(toRel);
    const onDiskSet = new Set(onDisk);
    const shippedTemplates = new Set([...shipped].filter((p) => p.startsWith(`${TEMPLATES_REL}/`)));
    const shippedNotOnDisk = [...shippedTemplates].filter((p) => !onDiskSet.has(p));
    if (shippedNotOnDisk.length) {
      failures.push(`POSITIVE: ${shippedNotOnDisk.length} shipped ${TEMPLATES_REL} path(s) NOT on disk (stale manifest), e.g.:\n    - ${shippedNotOnDisk.slice(0, 5).join("\n    - ")}`);
    }
    const missing = onDisk.filter((p) => !shipped.has(p));
    if (missing.length) {
      failures.push(`POSITIVE: ${missing.length} ${TEMPLATES_REL} file(s) NOT in shipped set, e.g.:\n    - ${missing.slice(0, 5).join("\n    - ")}`);
    }
    for (const sub of EXPECTED_SUBTREES) {
      const prefix = `${TEMPLATES_REL}/${sub}/`;
      const anyShipped = [...shipped].some((p) => p.startsWith(prefix));
      if (!anyShipped) failures.push(`POSITIVE: subtree ${prefix} has ZERO shipped files`);
    }
    const shippedTemplateCount = [...shipped].filter((p) => p.startsWith(`${TEMPLATES_REL}/`)).length;
    console.log(`POSITIVE: ${onDisk.length} files on disk, ${shippedTemplateCount} ${TEMPLATES_REL}/* paths in shipped set, ${EXPECTED_SUBTREES.length} subtrees checked`);
  }

  const mustNotShip = ["_mc/MANIFEST.json", "_mc/settings/defaults.json"];
  for (const p of mustNotShip) {
    if (shipped.has(p)) failures.push(`NEGATIVE: ${p} IS in the shipped set (carve not surgical)`);
  }
  if ([...shipped].some((p) => p.startsWith("_mc/settings/"))) {
    failures.push(`NEGATIVE: a _mc/settings/* path IS in the shipped set`);
  }
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
