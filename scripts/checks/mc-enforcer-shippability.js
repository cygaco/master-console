#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";
/**
 * scripts/checks/mc-enforcer-shippability.js
 *
 * THE class-enforcer for "shipped the referee, not the field" — the recurring
 * MC-update bug class where canonical ships a FAIL-CLOSED validator/enforcer
 * that DECLARES consumer-required paths, but the capsule delivers neither those
 * paths nor a way to create them. Two instances proved the class:
 *   - WI-50: a shipped command (new-lib.js) depended on an unshipped script
 *     (warp-setup.js). [different shape — runtime dep — covered by BC-29]
 *   - The enforced-tracker (Epic) system: scripts/trackers/validate.js is
 *     fail-closed and its §33 REQUIRED_PATHS demand TRACKER.md, the
 *     trackers/ dirs, and 9 templates — but trackers/templates/* ships to 0
 *     consumers AND there is no /trackers:init. So a consumer that updates
 *     gets the referee (validator + hooks) with no field (the structure it
 *     validates) and no whistle (an initializer). [THIS check's scope]
 *
 * Contract: for every consumer-required path a fail-closed validator declares,
 * the path must be EITHER
 *   (a) SHIPPED  — present in the shipped framework manifest (framework content,
 *       e.g. reusable templates), OR
 *   (b) INITIALIZABLE — a named initializer command + script exists that
 *       scaffolds it (project content the consumer generates, e.g. TRACKER.md).
 * A required path that is neither shipped nor initializable is the gap.
 *
 * Scope (v1): the tracker validator's §33 REQUIRED_PATHS (parsed from
 * validate.js so the two never drift). Extension point: register another
 * fail-closed validator's declared-paths source in DECLARERS below.
 *
 * Self-detecting + advisory: exits non-zero on a gap so /scan:full surfaces it,
 * but is intentionally NOT wired into release-gates.js (it would block the
 * release while the initializer is pending). Promote to a release gate once the
 * declared gaps are closed.
 *
 * Exit: 0 = every declared path ships or is initializable;
 *       1 = at least one declared path is neither (the gap);
 *       2 = runner error (cannot read a required input) — never a clean pass.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

// ── declarers: fail-closed validators that declare consumer-required paths ────
// Each entry: how to extract the declared required-path list from its source.
const DECLARERS = [
  {
    id: "tracker-validator-§33",
    source: "scripts/trackers/validate.js",
    // The §33 list is the REQUIRED_PATHS = [ ... ] array literal.
    extract(src) {
      const m = src.match(/REQUIRED_PATHS\s*=\s*\[([\s\S]*?)\]/);
      if (!m) return null;
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    },
    // The initializer that would scaffold the PROJECT-content paths.
    initializer: {
      script: "scripts/trackers/init.js",
      command: ".claude/commands/trackers/init.md",
    },
    // Paths under these prefixes are reusable FRAMEWORK content → must SHIP.
    // Everything else is PROJECT content → must be INITIALIZABLE.
    shipsPrefixes: ["trackers/templates/"],
  },
];

function fail(msg) {
  console.error(`[mc-enforcer-shippability] runner error: ${msg}`);
  process.exit(2);
}

function loadShippedSet() {
  // The shipped surface = framework-manifest assets (what install/update copy).
  const mfPath = path.join(ROOT, ".claude", "framework-manifest.json");
  let mf;
  try {
    mf = JSON.parse(fs.readFileSync(mfPath, "utf8"));
  } catch (e) {
    fail(`cannot read .claude/framework-manifest.json: ${e.message}`);
  }
  // framework-manifest.assets is keyed BY KIND (agent/skill/template/...), each
  // value an array of {src,dest,...} entries — NOT a flat array. Flatten both
  // shapes defensively. (Bug fixed 2026-06-06: treating it as a flat array gave
  // an empty set → every path false-flagged as unshipped — a lying enforcer.)
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
  // a dir requirement (e.g. trackers/templates/) ships if any asset is under it.
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
        // must SHIP
        if (!isShipped(shipped, req)) {
          findings.push(
            `[${d.id}] requires "${req}" (framework content) but the capsule does NOT ship it ` +
              `(absent from framework-manifest). A consumer that updates gets the validator but not this path.`,
          );
        }
      } else {
        // must be INITIALIZABLE
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

  // De-dup the project-content "no initializer" findings into one clear line +
  // list the unshipped framework paths individually.
  console.error(
    `FAIL [mc-enforcer-shippability] ${findings.length} declared path(s) are neither shipped nor initializable ` +
      `— the "shipped the referee, not the field" class (WI-50 family). Ship the path OR provide an initializer:`,
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
