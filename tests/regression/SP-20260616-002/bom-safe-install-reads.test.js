#!/usr/bin/env node
/**
 * Regression: BOM-safe install/update JSON reads (SP-20260616-002, Track-3 #2).
 *
 * PowerShell-written / fresh-migration JSON files carry a leading UTF-8 BOM
 * (U+FEFF). The install/update hot path did raw
 * `JSON.parse(fs.readFileSync(f, "utf8"))` with NO BOM strip, so a BOM'd file
 * either misclassified the repo (readJSON returns fallback) or threw
 * un-recoverably (rollback readers). The fix adds a module-level `stripBom`
 * helper in scripts/mc/update.js + scripts/mc/transaction.js and wraps
 * every such read.
 *
 * This test:
 *   (a) writes a BOM-prefixed JSON file to a temp dir,
 *   (b) proves the OLD raw pattern THROWS on it (planted-violation half),
 *   (c) proves JSON.parse(stripBom(...)) parses it correctly,
 *   (d) requires scripts/mc/transaction.js, greps its source to assert
 *       readHeader/readSnapshot strip BOM, AND calls the exported
 *       readHeader/readSnapshot on a BOM'd header.json/snapshot.json and
 *       asserts success.
 *
 * Plain-node assert, zero deps, exits 1 on failure.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BOM = "﻿"; // U+FEFF — construct via escape; never embed raw (Write-corrupts-literal hazard)
let passed = 0;
function ok(label) {
  passed += 1;
  console.log("  ok - " + label);
}

// The same stripBom shape the fix installs in the two source files.
const stripBom = (s) => (typeof s === "string" ? s.replace(/^﻿/, "") : s);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bom-safe-reads-"));

try {
  // ── (a) write a BOM-prefixed JSON file ──────────────────────────
  const payload = { repoRole: "canonical", mc: { source: "/x" }, n: 42 };
  const jsonText = JSON.stringify(payload, null, 2);
  const bomFile = path.join(tmp, "bommed.json");
  fs.writeFileSync(bomFile, BOM + jsonText, "utf8");

  // Confirm the file really starts with the BOM byte (sanity: the test would
  // be vacuous if the BOM never landed on disk).
  const rawBuf = fs.readFileSync(bomFile);
  assert.ok(
    rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf,
    "fixture file must start with the UTF-8 BOM bytes EF BB BF",
  );
  ok("(a) fixture JSON file written with a leading UTF-8 BOM");

  // ── (b) planted-violation: the OLD raw pattern THROWS ───────────
  assert.throws(
    () => JSON.parse(fs.readFileSync(bomFile, "utf8")),
    /JSON|Unexpected/i,
    "raw JSON.parse(readFileSync(..,utf8)) must throw on a BOM'd file",
  );
  ok("(b) OLD pattern JSON.parse(fs.readFileSync(f,'utf8')) throws on BOM");

  // ── (c) the fix parses it correctly ─────────────────────────────
  const parsed = JSON.parse(stripBom(fs.readFileSync(bomFile, "utf8")));
  assert.strictEqual(parsed.repoRole, "canonical");
  assert.strictEqual(parsed.n, 42);
  ok("(c) JSON.parse(stripBom(fs.readFileSync(f,'utf8'))) parses BOM'd JSON");

  // ── (d1) source-grep: transaction.js readers now strip BOM ──────
  const txPath = path.resolve(__dirname, "..", "..", "..", "scripts", "mc", "transaction.js");
  assert.ok(fs.existsSync(txPath), "transaction.js must exist at " + txPath);
  const txSrc = fs.readFileSync(txPath, "utf8");
  // A module-level stripBom helper must be defined.
  assert.ok(
    /const\s+stripBom\s*=/.test(txSrc),
    "transaction.js must define a module-level stripBom helper",
  );
  // Both readers must route their read through stripBom.
  const readHeaderBody = txSrc.match(/function\s+readHeader\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  const readSnapshotBody = txSrc.match(/function\s+readSnapshot\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert.ok(readHeaderBody, "could not locate readHeader() in transaction.js");
  assert.ok(readSnapshotBody, "could not locate readSnapshot() in transaction.js");
  assert.ok(
    /stripBom\s*\(\s*fs\.readFileSync/.test(readHeaderBody[0]),
    "readHeader must wrap its read in stripBom(fs.readFileSync(...))",
  );
  assert.ok(
    /stripBom\s*\(\s*fs\.readFileSync/.test(readSnapshotBody[0]),
    "readSnapshot must wrap its read in stripBom(fs.readFileSync(...))",
  );
  ok("(d1) transaction.js readHeader/readSnapshot strip BOM (source grep)");

  // ── (d2) behavioral: call exported readers on BOM'd files ───────
  const tx = require(txPath);
  assert.strictEqual(typeof tx.readHeader, "function", "tx.readHeader must be exported");
  assert.strictEqual(typeof tx.readSnapshot, "function", "tx.readSnapshot must be exported");

  const txDir = path.join(tmp, "tx");
  fs.mkdirSync(txDir, { recursive: true });
  const header = { txId: "TX-bom", version: "0.1.2", snapshotSha256: "deadbeef" };
  const snapshot = { txId: "TX-bom", decisions: [{ dest: "a.md", existed_pre_apply: true }] };
  fs.writeFileSync(path.join(txDir, "header.json"), BOM + JSON.stringify(header, null, 2), "utf8");
  fs.writeFileSync(path.join(txDir, "snapshot.json"), BOM + JSON.stringify(snapshot, null, 2), "utf8");

  const gotHeader = tx.readHeader(txDir);
  assert.strictEqual(gotHeader.txId, "TX-bom", "readHeader must parse a BOM'd header.json");
  assert.strictEqual(gotHeader.snapshotSha256, "deadbeef");
  const gotSnapshot = tx.readSnapshot(txDir);
  assert.strictEqual(gotSnapshot.txId, "TX-bom", "readSnapshot must parse a BOM'd snapshot.json");
  assert.strictEqual(gotSnapshot.decisions[0].dest, "a.md");
  ok("(d2) exported readHeader/readSnapshot parse BOM'd header.json/snapshot.json");

  // ── (d3) source-grep: update.js installs the same defense ───────
  const updPath = path.resolve(__dirname, "..", "..", "..", "scripts", "mc", "update.js");
  const updSrc = fs.readFileSync(updPath, "utf8");
  assert.ok(
    /const\s+stripBom\s*=/.test(updSrc),
    "update.js must define a module-level stripBom helper",
  );
  assert.ok(
    !/JSON\.parse\(fs\.readFileSync/.test(updSrc),
    "update.js must have NO remaining raw JSON.parse(fs.readFileSync(...)) reads",
  );
  ok("(d3) update.js defines stripBom and has zero raw JSON.parse(fs.readFileSync) reads");

  console.log("\nPASS — " + passed + " checks");
  process.exit(0);
} catch (err) {
  console.error("\nFAIL — " + (err && err.message ? err.message : err));
  if (err && err.stack) console.error(err.stack);
  process.exit(1);
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort temp cleanup */
  }
}
