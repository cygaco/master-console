#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// denylist.test.js — S-OS-06 / S-1 (T1). Regression coverage for the committed
// Class-3/4 deny-list artifact: its own header question, the 5 generated views +
// framework/releases/** being present and write-protected, and (read-only,
// against the REAL tree) the codemod plan's rename-candidacy / write-permission split.
// The actual thrown-refusal behavior via execution lives in codemod.test.js
// (sandboxed fixtures only).
//
// T3 (post-apply): the real tree has been through the one serial --apply. The pre-apply
// view MOVE (_warpos/MANIFEST.json -> _mc/MANIFEST.json planned as a generatedViewMove) is
// proven on a fixture by F5 GREEN; on the real tree this file now asserts the APPLIED state:
// the moved view resolves to its declared entry at its post-rename path, and no rename remains
// (AC-1.2 idempotency on the real tree).
//
//   AC-1.3 denylist-frozen-blocks-generated-views
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LOADER_PATH = path.join(ROOT, "scripts", "open-source", "partition-loader.js");
// T2 Req1: even this test names the partition artifact only through the loader.
const DENYLIST_PATH = require(LOADER_PATH).DENYLIST_PATH;
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
    // The view lives at EXACTLY ONE of its identities (declared, or the codemod's rename of it), and that
    // path resolves to the SAME declared entry — write-protected, never a default Class-1 file.
    const present = partition.viewPathCandidates(cls.entry).filter((p) => fs.existsSync(path.join(ROOT, p)));
    assert.strictEqual(present.length, 1, `${gv} must exist at exactly one of its identities, found ${JSON.stringify(present)}`);
    const at = partition.classifyPath(present[0]);
    assert.strictEqual(at.kind, "generated-view", `${present[0]} (where ${gv} lives) must classify as a generated-view`);
    assert.strictEqual(at.entry, cls.entry, `${present[0]} must resolve to the declared ${gv} entry`);
    assert.strictEqual(at.writeProtected, true, `${present[0]} must be write-protected`);
  }
  // Post-apply: the one moved view lives at its post-rename path, not the declared one.
  assert.strictEqual(fs.existsSync(path.join(ROOT, "_warpos", "MANIFEST.json")), false, "the applied tree has no _warpos/MANIFEST.json");
  assert.strictEqual(fs.existsSync(path.join(ROOT, "_mc", "MANIFEST.json")), true, "the applied tree carries the moved view at _mc/MANIFEST.json");

  const releasesGlob = partition.classifyPath("framework/releases/1.0.0/release.json");
  assert.strictEqual(releasesGlob.class, 4, "framework/releases/** must classify as Class 4");
  assert.strictEqual(releasesGlob.writeProtected, true, "framework/releases/** must be write-protected");
});

ok("real-tree-plan-splits-rename-candidacy-from-write-permission", () => {
  // Read-only against ROOT: buildLedgerAndPlan performs no writes. T3 part 0 ruling:
  // Class-3/4 paths are never rename candidates (keptHistoricalPaths, names verbatim); a
  // generated view moving with its Class-1 directory rename is a permitted MOVE in pathRenames
  // (fixture-proven by F5 GREEN); the real tree carries no genuine refusal.
  const partition = loadPartition({ forceReload: true });
  const built = RENAME_MC.buildLedgerAndPlan({ root: ROOT, partition });
  assert.strictEqual(built.refusedRenames.length, 0, `no genuine refusal on the real tree: ${JSON.stringify(built.refusedRenames.slice(0, 3))}`);

  const historicalInPathRenames = built.pathRenames.filter((r) => [3, 4].includes(partition.classifyPath(r.from).class));
  assert.strictEqual(historicalInPathRenames.length, 0, "no Class-3/4 path may appear in pathRenames");
  const protectedInPathRenames = built.pathRenames.filter((r) => partition.classifyPath(r.from).writeProtected);
  assert.ok(
    protectedInPathRenames.every((r) => r.generatedViewMove === true && partition.classifyPath(r.from).kind === "generated-view"),
    `the only write-protected sources in pathRenames are generated-view directory moves: ${JSON.stringify(protectedInPathRenames)}`
  );
  // T3 post-apply: the 458 renames (incl. the _warpos/MANIFEST.json view move) are done — none remains planned.
  assert.deepStrictEqual(built.pathRenames, [], `the applied real tree plans no further rename: ${JSON.stringify(built.pathRenames.slice(0, 5))}`);
  assert.ok(
    built.ledger.some((r) => r.file === "_mc/MANIFEST.json" && r.disposition === "derived") &&
      built.ledger.filter((r) => r.file === "_mc/MANIFEST.json").every((r) => r.disposition === "derived"),
    "the moved view's occurrences stay DERIVED at _mc/MANIFEST.json (never re-planned as rewritten)"
  );
  assert.ok(
    built.keptHistoricalPaths.some((k) => k.path === "_planning/warpos-lifecycle-plan.md" && k.class === 4),
    "the Class-4 _planning/warpos-lifecycle-plan.md keeps its name (keptHistoricalPaths)"
  );
  assert.ok(built.keptHistoricalPaths.every((k) => [3, 4].includes(k.class)), "keptHistoricalPaths holds Class-3/4 paths only");
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
