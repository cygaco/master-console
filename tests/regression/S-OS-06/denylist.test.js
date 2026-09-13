#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// denylist.test.js — S-OS-06 / S-1 (T1). Regression coverage for the committed
// Class-3/4 deny-list artifact: its own header question, the 5 generated views +
// framework/releases/** being present and write-protected, and (read-only,
// against the REAL tree) that a naive rename of those paths would be REFUSED.
// The actual thrown-refusal behavior via execution lives in codemod.test.js
// (sandboxed fixtures only — this ticket never runs --apply against ROOT).
//
//   AC-1.3 denylist-frozen-blocks-generated-views
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DENYLIST_PATH = path.join(ROOT, "scripts", "open-source", "rename-mc.denylist.json");
const LOADER_PATH = path.join(ROOT, "scripts", "open-source", "partition-loader.js");
const RENAME_MC = require(path.join(ROOT, "scripts", "open-source", "rename-mc.js"));

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

const { loadPartition } = require(LOADER_PATH);

ok("denylist-artifact-exists-and-states-its-own-question", () => {
  assert.ok(fs.existsSync(DENYLIST_PATH), "the deny-list must be its own committed file, not folded into walk-skip.js");
  const raw = fs.readFileSync(DENYLIST_PATH, "utf8");
  assert.ok(raw.trim().length > 0, "F3: the deny-list must never be empty");
  const parsed = JSON.parse(raw);
  assert.ok(typeof parsed.$question === "string" && /must NOT be rewritten/i.test(parsed.$question), "header must state 'what must NOT be rewritten'");
  // The header MAY contrast against walk-skip.js's different question ("what is not
  // shipped") for clarity — it must not, however, make THAT the artifact's own
  // question (i.e. it must not say the deny-list itself answers "not shipped").
  assert.ok(!/this (file|artifact) answers['\s]*['"]?what is not shipped/i.test(parsed.$question), "the deny-list must not claim to answer walk-skip's question");
});

ok("denylist-frozen-blocks-generated-views", () => {
  const partition = loadPartition({ forceReload: true });
  const FIVE_GENERATED_VIEWS = [
    ".claude/paths.json",
    "scripts/hooks/lib/paths.generated.js",
    ".claude/framework-manifest.json",
    ".claude/framework-installed.json",
    "_warpos/MANIFEST.json",
  ];
  assert.strictEqual(partition.generatedViews.length, 5, `expected exactly 5 generated views, got ${partition.generatedViews.length}`);
  for (const gv of FIVE_GENERATED_VIEWS) {
    const cls = partition.classifyPath(gv);
    assert.strictEqual(cls.kind, "generated-view", `${gv} must classify as a generated-view`);
    assert.strictEqual(cls.writeProtected, true, `${gv} must be write-protected`);
    assert.ok(fs.existsSync(path.join(ROOT, gv)), `${gv} must actually exist in the tracked tree`);
  }

  const releasesGlob = partition.classifyPath("framework/releases/1.0.0/release.json");
  assert.strictEqual(releasesGlob.class, 4, "framework/releases/** must classify as Class 4");
  assert.strictEqual(releasesGlob.writeProtected, true, "framework/releases/** must be write-protected");
});

ok("refused-renames-on-the-real-tree-never-leak-into-pathRenames", () => {
  // Read-only against ROOT: buildLedgerAndPlan performs no writes. Confirms the
  // real tree's own write-protected paths that WOULD be touched by a naive rename
  // (e.g. _warpos/MANIFEST.json) are captured as refusals, never as applied renames.
  const partition = loadPartition({ forceReload: true });
  const built = RENAME_MC.buildLedgerAndPlan({ root: ROOT, partition });
  const protectedInPathRenames = built.pathRenames.filter((r) => partition.classifyPath(r.from).writeProtected);
  assert.strictEqual(protectedInPathRenames.length, 0, "no write-protected path may appear in pathRenames");

  const generatedViewRefusals = built.refusedRenames.filter((r) => r.kind === "generated-view");
  assert.ok(generatedViewRefusals.length > 0, "expected at least one generated-view refusal on the current tree (_warpos/MANIFEST.json)");
});

ok("denylist-consumed-only-through-the-loader", () => {
  // Structural intent check for T1: the codemod requires partition-loader, not the
  // raw JSON. (The FULL un-routed-reader guard — grepping every OTHER file in the
  // repo for a direct require of the deny-list/allow-list — lands in T2/T5 per the
  // ticket; this asserts the shape the guard will check rename-mc.js against.)
  const codemodSrc = fs.readFileSync(path.join(ROOT, "scripts", "open-source", "rename-mc.js"), "utf8");
  assert.ok(/require\(["']\.\/partition-loader["']\)/.test(codemodSrc), "rename-mc.js must load the partition via partition-loader.js");
  assert.ok(!/rename-mc\.denylist\.json/.test(codemodSrc), "rename-mc.js must never require the deny-list JSON directly");
});

console.log(`\ndenylist: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
