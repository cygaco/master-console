#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// codemod.test.js — S-OS-06 / S-1 (T1). Regression coverage for the codemod's
// --apply idempotency (AC-1.2) and AC-1.3's write-protection refusal.
//
// Runs ONLY against disposable git-init'd temp fixtures under os.tmpdir() — this
// ticket is DRY-RUN ONLY against the real tree ("Do NOT run --apply. Do NOT
// rename or rewrite any existing tree file."); runApply() is exercised here
// exclusively on throwaway sandboxes, never on ROOT.
//
//   AC-1.2 codemod-idempotent
//   AC-1.3 refuses a write-protected touch (denylist.test.js covers the same AC
//   against the real tree's read-only classification; this file covers the
//   actual thrown-refusal behavior via execution)
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
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

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}

function makeFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-mc-fixture-"));
  git(["init", "-q"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "S-OS-06 fixture"], dir);
  fs.mkdirSync(path.join(dir, "scripts", "warpos"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "scripts", "warpos", "thing.js"),
    "// warpos thing\nconst warpos = 1;\nmodule.exports = warpos;\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "# WarpOS demo\nThis mentions warpos twice, warpos.\n",
    "utf8"
  );
  git(["add", "-A"], dir);
  return dir;
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

let fixtureDir;
try {
  fixtureDir = makeFixtureRepo();

  ok("codemod-idempotent: first apply performs a real change", () => {
    const first = RENAME_MC.runApply({ root: fixtureDir });
    assert.ok(first.ok, "first apply must succeed");
    assert.strictEqual(first.renamed, 1, "expects the scripts/warpos/ -> scripts/mc/ dir segment rename");
    assert.ok(first.filesRewritten >= 1, "expects README.md content rewritten");
    assert.ok(
      fs.existsSync(path.join(fixtureDir, "scripts", "mc", "thing.js")),
      "renamed file should exist at the new path"
    );
    assert.ok(
      !fs.existsSync(path.join(fixtureDir, "scripts", "warpos", "thing.js")),
      "old path should no longer exist"
    );
  });

  ok("codemod-idempotent: second apply is a no-op", () => {
    const second = RENAME_MC.runApply({ root: fixtureDir });
    assert.strictEqual(second.renamed, 0, "second apply must rename nothing");
    assert.strictEqual(second.filesRewritten, 0, "second apply must rewrite nothing — idempotent (AC-1.2)");
  });

  ok("codemod-idempotent: no `warpos` occurrence with disposition=rewritten survives", () => {
    const { loadPartition } = require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"));
    const partition = loadPartition({ forceReload: true });
    const built = RENAME_MC.buildLedgerAndPlan({ root: fixtureDir, partition });
    const stillRewritable = built.ledger.filter((r) => r.disposition === "rewritten");
    assert.strictEqual(stillRewritable.length, 0, `expected 0 remaining rewritable occurrences after apply, got ${stillRewritable.length}`);
  });
} finally {
  if (fixtureDir) rmrf(fixtureDir);
}

// T3 part 0 ruling (rename candidacy vs write permission): a Class-3/4 historical path that a
// naive rename WOULD touch is never a rename CANDIDATE — it keeps its name verbatim and is
// recorded in keptHistoricalPaths (not pathRenames, not refusedRenames), so --apply proceeds.
const { loadPartition: loadRealPartition } = require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"));

function makeBareFixture(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(["init", "-q"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "S-OS-06 fixture"], dir);
  return dir;
}

let protectedFixtureDir;
try {
  protectedFixtureDir = makeBareFixture("rename-mc-protected-fixture-");
  // Mirrors the real tree's own denylisted glob (framework/releases/**) with a
  // basename ("warpos") that WOULD be renamed by the generic segment rule — the
  // exact shape the real tree exhibits with _planning/warpos-lifecycle-plan.md.
  const HISTORICAL_REL = "framework/releases/warpos/notes.md";
  const HISTORICAL_BODY = "historical warpos release notes\n";
  fs.mkdirSync(path.join(protectedFixtureDir, "framework", "releases", "warpos"), { recursive: true });
  fs.writeFileSync(path.join(protectedFixtureDir, ...HISTORICAL_REL.split("/")), HISTORICAL_BODY, "utf8");
  git(["add", "-A"], protectedFixtureDir);

  ok("class4-historical-path-is-kept-never-a-rename-candidate", () => {
    const built = RENAME_MC.buildLedgerAndPlan({ root: protectedFixtureDir, partition: loadRealPartition({ forceReload: true }) });
    assert.ok(
      built.keptHistoricalPaths.some((k) => k.path === HISTORICAL_REL && k.class === 4 && k.wouldBe === "framework/releases/mc/notes.md"),
      `the Class-4 path must be recorded in keptHistoricalPaths: ${JSON.stringify(built.keptHistoricalPaths)}`
    );
    assert.ok(!built.pathRenames.some((r) => r.from === HISTORICAL_REL), "a Class-4 path is never in pathRenames");
    assert.strictEqual(built.refusedRenames.length, 0, "a Class-4 path is never a refusal (it is not a candidate)");
  });

  ok("apply-keeps-the-class4-historical-path-name-and-bytes-verbatim", () => {
    const result = RENAME_MC.runApply({ root: protectedFixtureDir });
    assert.ok(result.ok, "apply proceeds: a kept historical path is not a refusal");
    assert.strictEqual(result.renamed, 0, "nothing is renamed");
    assert.strictEqual(
      fs.readFileSync(path.join(protectedFixtureDir, ...HISTORICAL_REL.split("/")), "utf8"),
      HISTORICAL_BODY,
      "the historical path keeps its name and bytes"
    );
    assert.ok(!fs.existsSync(path.join(protectedFixtureDir, "framework", "releases", "mc", "notes.md")), "no renamed copy appears");
  });
} finally {
  if (protectedFixtureDir) rmrf(protectedFixtureDir);
}

// AC-1.3: a GENUINE refusal still throws — a Class-2 (gated, write-protected) path on a rename
// path must cause --apply to REFUSE, never silently skip-and-continue. (F9 covers the
// target-lands-on-a-write-protected-path refusal; F5 the generated-view refusals.)
let gatedFixtureDir;
try {
  gatedFixtureDir = makeBareFixture("rename-mc-gated-fixture-");
  fs.mkdirSync(path.join(gatedFixtureDir, ".github", "warpos"), { recursive: true });
  fs.writeFileSync(path.join(gatedFixtureDir, ".github", "warpos", "ci.yml"), "name: warpos ci\n", "utf8");
  git(["add", "-A"], gatedFixtureDir);

  ok("apply-refuses-a-write-protected-class2-rename", () => {
    assert.throws(
      () => RENAME_MC.runApply({ root: gatedFixtureDir }),
      /\.github\/warpos\/ci\.yml -> \.github\/mc\/ci\.yml is write-protected \(class 2, path-glob\)/,
      "runApply must throw rather than silently rename a Class-2 (.github/**) path"
    );
  });

  ok("apply-refusal-leaves-the-gated-path-untouched", () => {
    assert.ok(fs.existsSync(path.join(gatedFixtureDir, ".github", "warpos", "ci.yml")), "the gated path must still exist after the refused apply");
    assert.ok(!fs.existsSync(path.join(gatedFixtureDir, ".github", "mc", "ci.yml")), "the gated path was not renamed");
  });
} finally {
  if (gatedFixtureDir) rmrf(gatedFixtureDir);
}

console.log(`\ncodemod: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
