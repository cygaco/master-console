#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const STORE = path.join(ROOT, "runtime", "arbitration");

function collectOpen(store = STORE) {
  const open = [];
  if (!fs.existsSync(store)) return open;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith(".json")) {
        let rec;
        try {
          rec = JSON.parse(fs.readFileSync(full, "utf8"));
        } catch {
          continue;
        }
        if (
          rec &&
          rec.type === "decision_record" &&
          rec.arbitration_needed === true &&
          rec.resolved !== true
        ) {
          rec._file = full;
          open.push(rec);
        }
      }
    }
  };
  walk(store);
  return open;
}

function bundlePerUnit(records) {
  const byUnit = {};
  for (const r of records) {
    const u = r.unit || "(unspecified)";
    (byUnit[u] = byUnit[u] || []).push(r);
  }
  for (const u of Object.keys(byUnit)) {
    byUnit[u].sort(
      (a, b) => (b.artifact_precedence || 0) - (a.artifact_precedence || 0),
    );
  }
  return byUnit;
}

function main(argv) {
  const json = argv.includes("--json");
  let bundles, openCount;
  try {
    const open = collectOpen();
    openCount = open.length;
    bundles = bundlePerUnit(open);
  } catch (e) {
    process.stderr.write(`arbitration-resolver error: ${e.message}\n`);
    return 2;
  }
  const units = Object.keys(bundles);
  const shipReady = units.length === 0;

  if (json) {
    process.stdout.write(
      JSON.stringify(
        { ok: shipReady, check: "arbitration-resolver", openCount, parkedUnits: units, bundles },
        null,
        2,
      ) + "\n",
    );
    return shipReady ? 0 : 1;
  }

  if (shipReady) {
    process.stdout.write(
      "OK   [arbitration-resolver] no open arbitration records — run is ship-ready\n",
    );
    return 0;
  }

  process.stderr.write(
    `HALT [arbitration-resolver] ${openCount} open arbitration record(s) across ${units.length} parked unit(s) — NOT ship-ready (fail-closed):\n`,
  );
  for (const u of units) {
    process.stderr.write(
      `  ▸ unit "${u}" — ${bundles[u].length} concern(s), precedence-ordered:\n`,
    );
    for (const r of bundles[u]) {
      process.stderr.write(
        `      - [${r.owner} @prec ${r.artifact_precedence || 0}] ${r.decision} :: ${String(r.rationale).slice(0, 140)} (conf ${r.confidence})\n`,
      );
    }
  }
  process.stderr.write(
    "  Resolve: α/β arbitrate each per-unit bundle (highest-precedence concern leads), then set resolved:true on each record (or remove). Re-run to clear the gate.\n",
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { collectOpen, bundlePerUnit, STORE, main };
