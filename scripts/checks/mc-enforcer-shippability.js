#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

const DECLARERS = [
  {
    id: "tracker-validator",
    source: "scripts/trackers/validate.js",
    extract(src) {
      const m = src.match(/REQUIRED_PATHS\s*=\s*\[([\s\S]*?)\]/);
      if (!m) return null;
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    },
    initializer: {
      script: "scripts/trackers/init.js",
      command: ".claude/commands/trackers/init.md",
    },
    shipsPrefixes: ["trackers/templates/"],
  },
];

function fail(msg) {
  console.error(`[mc-enforcer-shippability] runner error: ${msg}`);
  process.exit(2);
}

function loadShippedSet() {
  const mfPath = path.join(ROOT, ".claude", "framework-manifest.json");
  let mf;
  try {
    mf = JSON.parse(fs.readFileSync(mfPath, "utf8"));
  } catch (e) {
    fail(`cannot read .claude/framework-manifest.json: ${e.message}`);
  }
  const assets =
    mf && mf.assets && typeof mf.assets === "object" && !Array.isArray(mf.assets)
      ? Object.values(mf.assets).flat()
      : Array.isArray(mf.assets)
        ? mf.assets
        : [];
  const set = new Set();
  for (const a of assets) {
    const p = (a && (a.dest || a.src || a.path)) || (typeof a === "string" ? a : null);
    if (p) set.add(p.replace(/\\/g, "/"));
  }
  return set;
}

function isShipped(shipped, relPath) {
  const norm = relPath.replace(/\\/g, "/").replace(/\/$/, "");
  if (shipped.has(norm)) return true;
  for (const s of shipped) if (s === norm || s.startsWith(norm + "/")) return true;
  return false;
}

function main() {
  const shipped = loadShippedSet();
  const findings = [];
  let declaredTotal = 0;

  for (const d of DECLARERS) {
    let src;
    try {
      src = fs.readFileSync(path.join(ROOT, d.source), "utf8");
    } catch (e) {
      fail(`cannot read declarer ${d.source}: ${e.message}`);
    }
    const declared = d.extract(src);
    if (!declared || declared.length === 0) {
      fail(`could not extract declared required-paths from ${d.source} (format drift?)`);
    }
    const initOk =
      fs.existsSync(path.join(ROOT, d.initializer.script)) &&
      fs.existsSync(path.join(ROOT, d.initializer.command));

    for (const req of declared) {
      declaredTotal++;
      const isFrameworkContent = d.shipsPrefixes.some((pre) => req.startsWith(pre));
      if (isFrameworkContent) {
        if (!isShipped(shipped, req)) {
          findings.push(
            `[${d.id}] requires "${req}" (framework content) but the capsule does NOT ship it ` +
              `(absent from framework-manifest). A consumer that updates gets the validator but not this path.`,
          );
        }
      } else {
        if (!initOk) {
          findings.push(
            `[${d.id}] requires "${req}" (project content) but no initializer ships to create it ` +
              `(missing ${d.initializer.script} and/or ${d.initializer.command}). ` +
              `A consumer has no supported way to scaffold it.`,
          );
        }
      }
    }
  }

  if (findings.length === 0) {
    console.log(
      `OK   [mc-enforcer-shippability] every fail-closed-validator-declared path ships or is initializable ` +
        `(${declaredTotal} declared path(s) across ${DECLARERS.length} declarer(s)).`,
    );
    process.exit(0);
  }

  console.error(
    `FAIL [mc-enforcer-shippability] ${findings.length} declared path(s) are neither shipped nor initializable ` +
      `— a check is shipped while the data it checks is not. Ship the path OR provide an initializer:`,
  );
  for (const f of findings) console.error("  - " + f);
  console.error(
    `\nThis is ADVISORY (surfaced at /scan:full, does NOT block release). ` +
      `Close by: (1) add the framework paths to the capsule manifest, and/or ` +
      `(2) ship an initializer command. Then promote this to a release gate.`,
  );
  process.exit(1);
}

main();
