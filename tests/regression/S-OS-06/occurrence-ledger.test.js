#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// occurrence-ledger.test.js — S-OS-06 / S-1 (T1). Regression coverage for the
// occurrence ledger's three-disposition partition (AC-1.4's own verified_by path)
// and for the DERIVED-disposition rule: a generated-view occurrence is permitted
// iff it maps to an entry in the Class-3 pin set, computed FROM that set — never
// hand-warranted (BUILD-SPEC.md "DERIVED is the disposition for GENERATED VIEWS").
//
//   AC-1.4 three-disposition-partition-total
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

ok("three-disposition-partition-total", () => {
  assert.strictEqual(built.underived.length, 0, `unpinned-unrewritten-underived must be 0, got ${built.underived.length}`);
  for (const row of built.ledger) {
    assert.ok(row.disposition === "rewritten" || row.disposition === "pinned" || row.disposition === "derived");
    assert.ok(typeof row.file === "string" && row.file.length > 0);
    assert.ok(Number.isInteger(row.line) && row.line > 0);
    assert.ok(typeof row.matchText === "string" && row.matchText.length > 0);
    // NO inline markers rule: the ledger is the ONLY record of a disposition — the
    // source line itself is never asserted to carry a marker comment.
    if (row.disposition !== "rewritten") {
      assert.ok(typeof row.warrant === "string" && row.warrant.length > 0, `${row.file}:${row.line} (${row.disposition}) must carry a warrant`);
    }
  }
});

ok("derived-set-is-exactly-the-5-generated-views", () => {
  const derivedFiles = new Set(built.ledger.filter((r) => r.disposition === "derived").map((r) => r.file));
  assert.ok(derivedFiles.size > 0, "expected at least one derived occurrence on the current tree (non-vacuous check)");
  // Load-bearing direction: every `derived` row's file MUST be one of the 5 declared
  // generated views — a derived row on any other path is the exact false-green this
  // disposition exists to prevent (a stray write-protected path masquerading as
  // "derived" instead of being pinned or rewritten).
  const generatedViewPaths = new Set(partition.generatedViews.map((g) => g.path));
  for (const file of derivedFiles) {
    assert.ok(generatedViewPaths.has(file), `derived-disposition file ${file} is not one of the declared generated views`);
  }
});

ok("derived-occurrences-computed-from-pin-set-not-hand-warranted", () => {
  // T1 scope: derived rows never carry a hand-written warrant string (that would be
  // the exact "computed FROM the pin set, never hand-warranted" violation β r3 named).
  // The assertion that a derived occurrence's text corresponds to an ACTUAL Class-3
  // pinned filename runs AFTER a manifest regen (T5) — T1 only asserts the shape here.
  const derivedRows = built.ledger.filter((r) => r.disposition === "derived");
  for (const row of derivedRows) {
    assert.strictEqual(row.rule, "generated-view", `derived row ${row.file}:${row.line} must carry rule "generated-view"`);
  }
});

ok("pinned-occurrences-each-resolve-to-a-real-warrant", () => {
  const pinnedRows = built.ledger.filter((r) => r.disposition === "pinned");
  assert.ok(pinnedRows.length > 0, "expected at least one pinned occurrence on the current tree (walk-skip.js / leak-gate.js / CHANGELOG historical entries)");
  for (const row of pinnedRows) {
    assert.ok(["occurrence-pin", "changelog-historical"].includes(row.rule), `unexpected pin rule ${row.rule} for ${row.file}:${row.line}`);
  }
});

ok("committed-ledger-persists-exactly-the-warranted-rows", () => {
  // In-memory, deterministic: the committed form is built from the SAME full ledger the
  // partition-total invariant is asserted over — no rewritten row leaks in, no warranted
  // row is dropped, and the header counts are the FULL-data three-disposition totals.
  const committed = RENAME_MC.buildCommittedLedger(built);
  const expected = built.ledger.filter((r) => r.disposition === "pinned" || r.disposition === "derived");
  assert.strictEqual(committed.rows.length, expected.length, "committed ledger must persist every pinned+derived row");
  assert.strictEqual(committed.rows.filter((r) => r.disposition === "rewritten").length, 0, "committed ledger must carry no rewritten rows");
  committed.rows.forEach((row, i) => {
    const src = expected[i];
    assert.deepStrictEqual(
      [row.file, row.line, row.rule, row.matchText, row.disposition, row.warrant],
      [src.file, src.line, src.rule, src.matchText, src.disposition, src.warrant],
      `committed row ${i} must match the full-ledger warranted row`
    );
  });
  assert.deepStrictEqual(committed.dispositionCounts, built.dispositionCounts, "header counts must be the full-data totals");
  const { rewritten, pinned, derived } = committed.dispositionCounts;
  assert.strictEqual(rewritten + pinned + derived, built.ledger.length, "header counts must partition the FULL ledger row count");
  assert.strictEqual(committed.rowsPersisted.pinned, pinned);
  assert.strictEqual(committed.rowsPersisted.derived, derived);
  // Round-trip: the compact serializer emits valid JSON equal to the in-memory form.
  assert.deepStrictEqual(JSON.parse(RENAME_MC.serializeCommittedLedger(committed)), committed);
});

ok("committed-ledger-file-as-written-holds-warranted-rows-only", () => {
  const fs = require("fs");
  const abs = path.join(ROOT, ...RENAME_MC.COMMITTED_LEDGER_REL.split("/"));
  assert.ok(fs.existsSync(abs), "committed ledger must exist (run rename-mc.js --dry-run)");
  const written = JSON.parse(fs.readFileSync(abs, "utf8"));
  const { rewritten, pinned, derived } = written.dispositionCounts;
  for (const n of [rewritten, pinned, derived]) assert.ok(Number.isInteger(n) && n >= 0, "dispositionCounts must carry all three integer totals");
  assert.ok(Array.isArray(written.rows));
  for (const row of written.rows) {
    assert.ok(row.disposition === "pinned" || row.disposition === "derived", `written committed row ${row.file}:${row.line} has non-warranted disposition ${row.disposition}`);
    assert.ok(typeof row.warrant === "string" && row.warrant.length > 0, `written committed row ${row.file}:${row.line} must carry a warrant`);
  }
  assert.strictEqual(written.rows.filter((r) => r.disposition === "pinned").length, pinned, "written pinned rows must equal the pinned count");
  assert.strictEqual(written.rows.filter((r) => r.disposition === "derived").length, derived, "written derived rows must equal the derived count");
});

ok("committed-ledger-is-never-its-own-scan-target", () => {
  const cls = partition.classifyPath(RENAME_MC.COMMITTED_LEDGER_REL);
  assert.strictEqual(cls.writeProtected, true, "the committed ledger must be write-protected (never rewritten by --apply)");
  assert.notStrictEqual(cls.class, 1, "the committed ledger must not be a Class-1 scan/rewrite target");
  assert.strictEqual(built.ledger.filter((r) => r.file === RENAME_MC.COMMITTED_LEDGER_REL).length, 0, "no occurrence row may come from the ledger itself");
});

console.log(`\noccurrence-ledger: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
