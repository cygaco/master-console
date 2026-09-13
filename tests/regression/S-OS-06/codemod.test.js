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

// AC-1.3: a write-protected path that WOULD be touched by a naive rename must cause
// --apply to REFUSE (throw), never silently skip-and-continue.
let protectedFixtureDir;
try {
  protectedFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "rename-mc-protected-fixture-"));
  git(["init", "-q"], protectedFixtureDir);
  git(["config", "user.email", "test@example.com"], protectedFixtureDir);
  git(["config", "user.name", "S-OS-06 fixture"], protectedFixtureDir);
  // Mirrors the real tree's own denylisted glob (framework/releases/**) with a
  // basename ("warpos") that WOULD be renamed by the generic segment rule — the
  // exact shape the real tree already exhibits (framework/releases isn't hit
  // today only because none of its 200 capsules happen to have a bare "warpos"
  // path segment; this fixture forces the case so the refusal is exercised).
  fs.mkdirSync(path.join(protectedFixtureDir, "framework", "releases", "warpos"), { recursive: true });
  fs.writeFileSync(
    path.join(protectedFixtureDir, "framework", "releases", "warpos", "notes.md"),
    "historical warpos release notes\n",
    "utf8"
  );
  git(["add", "-A"], protectedFixtureDir);

  ok("apply-refuses-write-protected-touch", () => {
    assert.throws(
      () => RENAME_MC.runApply({ root: protectedFixtureDir }),
      /write-protected/,
      "runApply must throw rather than silently rename a Class-4 (framework/releases/**) path"
    );
  });

  ok("apply-refusal-leaves-the-protected-path-untouched", () => {
    assert.ok(
      fs.existsSync(path.join(protectedFixtureDir, "framework", "releases", "warpos", "notes.md")),
      "the protected path must still exist at its original location after the refused apply"
    );
  });
} finally {
  if (protectedFixtureDir) rmrf(protectedFixtureDir);
}

console.log(`\ncodemod: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
