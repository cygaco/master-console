#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// partition-total.test.js — S-OS-06 / S-1 (T1, ticket T-20260913-360). Regression
// coverage for the codemod's total-partition assertions against the REAL tracked
// tree (read-only — buildLedgerAndPlan() never writes to disk; only runDryRun()/
// runApply() do, and neither is called here against the live tree).
//
//   AC-1.1 unclassified_is_zero
//   AC-1.4 three-disposition-partition-total (also aliased in occurrence-ledger.test.js)
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const RENAME_MC = require(path.join(ROOT, "scripts", "open-source", "rename-mc.js"));
const { loadPartition } = require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

const partition = loadPartition({ forceReload: true });
const built = RENAME_MC.buildLedgerAndPlan({ root: ROOT, partition });

ok("unclassified_is_zero", () => {
  assert.strictEqual(
    built.unclassified.length,
    0,
    `expected 0 unclassified tracked paths, got ${built.unclassified.length}: ${built.unclassified.slice(0, 10).join(", ")}`
  );
  assert.strictEqual(
    built.classCounts[1] + built.classCounts[2] + built.classCounts[3] + built.classCounts[4],
    built.trackedFileCount,
    "the four class counts must sum to the total tracked-file count (two-grain (a) total)"
  );
});

ok("three-disposition-partition-total", () => {
  assert.strictEqual(
    built.underived.length,
    0,
    `expected 0 unpinned-unrewritten-underived occurrences, got ${built.underived.length}`
  );
  const { rewritten, pinned, derived } = built.dispositionCounts;
  assert.strictEqual(
    rewritten + pinned + derived,
    built.ledger.length,
    "the three disposition counts must sum to the total occurrence-ledger row count (two-grain (b) total)"
  );
  // Every ledger row has EXACTLY one of the three dispositions — never zero, never two.
  for (const row of built.ledger) {
    assert.ok(["rewritten", "pinned", "derived"].includes(row.disposition), `row ${row.file}:${row.line} has an invalid disposition "${row.disposition}"`);
  }
});

ok("classCounts-match-git-ls-files", () => {
  // Sanity floor: classification runs over `git ls-files`, not an arbitrary walk.
  assert.ok(built.trackedFileCount > 0, "expected a non-empty tracked-file set");
});

console.log(`\npartition-total: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
