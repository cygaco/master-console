#!/usr/bin/env node
/**
 * test-framework-purity-staged.js — WI-23 regression test.
 *
 * The COMMIT gate (scripts/hooks/framework-purity-guard.js) must judge ONLY the
 * staged tree — what a `git commit` actually writes. An unstaged leak elsewhere
 * in the tree is NOT part of the commit and must NOT block it. The manual
 * /scan:framework-purity (--diff) keeps the broader staged + unstaged view.
 *
 * Strategy: build a throwaway git repo, point the scanner at it via the
 * WARPOS_PURITY_ROOT test seam, and assert:
 *
 *   1. --staged is CLEAN when only an UNSTAGED file carries a leak (the WI-23
 *      false-RED that this fix removes).
 *   2. --diff FAILS on the same state (unstaged is in scope for the manual view).
 *   3. --staged FAILS when the leak is in a STAGED file (the gate still bites).
 *   4. --staged is CLEAN on an all-clean staged tree (no false-RED).
 *
 * The leak used is a client slug (CLIENT_SLUGS) — the simplest detector that
 * fires on content alone.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync, execSync } = require("child_process");

const SCRIPT = path.join(__dirname, "framework-purity.js");
const LEAK = require("./framework-purity").CLIENT_SLUGS[3]; // a CLIENT_SLUGS entry (never literal here — the gate scans this file too)

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    pass++;
  } else {
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

function git(repo, args) {
  return execSync(`git ${args}`, { cwd: repo, encoding: "utf8" });
}

// Run framework-purity.js against `repo` in the given mode; return exit code.
function runPurity(repo, mode) {
  const r = spawnSync(process.execPath, [SCRIPT, mode, "--quiet"], {
    encoding: "utf8",
    env: { ...process.env, WARPOS_PURITY_ROOT: repo },
  });
  return r.status;
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-staged-"));
  git(dir, "init -q");
  git(dir, 'config user.email "t@t.t"');
  git(dir, 'config user.name "t"');
  git(dir, "config commit.gpgsign false");
  // Seed a committed baseline so diffs are meaningful. `tracked.md` exists so
  // the unstaged-leak case can MODIFY a tracked file (git diff only reports
  // changes to tracked files — a brand-new untracked file isn't in `git diff`).
  fs.writeFileSync(path.join(dir, "README.md"), "# clean baseline\n");
  fs.writeFileSync(path.join(dir, "tracked.md"), "clean tracked content\n");
  git(dir, "add README.md tracked.md");
  git(dir, "commit -q -m baseline");
  return dir;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

// ── Case 1 + 2: leak is UNSTAGED ──────────────────────────────────────
{
  const repo = makeRepo();
  // A CLEAN staged file (the actual commit content)…
  fs.writeFileSync(path.join(repo, "staged-clean.md"), "all good here\n");
  git(repo, "add staged-clean.md");
  // …and a SEPARATE unstaged MODIFICATION carrying a leak (NOT part of this
  // commit). It modifies a tracked file so `git diff` reports it — but it is
  // not staged, so the commit gate must ignore it.
  fs.writeFileSync(
    path.join(repo, "tracked.md"),
    `notes about ${LEAK} integration\n`,
  );

  const staged = runPurity(repo, "--staged");
  ok(
    "1. --staged CLEAN when leak is only in an unstaged file (WI-23)",
    staged === 0,
    `exit ${staged}`,
  );

  const diff = runPurity(repo, "--diff");
  ok(
    "2. --diff FAILS on the same state (unstaged in scope for manual view)",
    diff === 1,
    `exit ${diff}`,
  );

  rmrf(repo);
}

// ── Case 3: leak is STAGED (the gate must still bite) ──────────────────
{
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, "staged-leak.md"),
    `shipping ${LEAK} content\n`,
  );
  git(repo, "add staged-leak.md");

  const staged = runPurity(repo, "--staged");
  ok(
    "3. --staged FAILS when the leak is in a staged file (gate still bites)",
    staged === 1,
    `exit ${staged}`,
  );

  rmrf(repo);
}

// ── Case 4: all-clean staged tree (no false-RED) ──────────────────────
{
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "feature.md"), "nothing to see\n");
  git(repo, "add feature.md");

  const staged = runPurity(repo, "--staged");
  ok(
    "4. --staged CLEAN on an all-clean staged tree (no false-RED)",
    staged === 0,
    `exit ${staged}`,
  );

  rmrf(repo);
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
