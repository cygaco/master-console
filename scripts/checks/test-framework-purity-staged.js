#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync, execSync } = require("child_process");

const SCRIPT = path.join(__dirname, "framework-purity.js");
const slugsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fp-staged-slugs-")), "slugs.json");
fs.writeFileSync(slugsFile, JSON.stringify({ clientSlugs: ["zorblat-product"] }));
mcEnv.setEnv("PURITY_SLUGS_FILE", slugsFile);
const LEAK = require("./framework-purity").CLIENT_SLUGS[0];

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

function runPurity(repo, mode) {
  const r = spawnSync(process.execPath, [SCRIPT, mode, "--quiet"], {
    encoding: "utf8",
    env: { ...process.env, ...mcEnv.envPair("PURITY_ROOT", repo) },
  });
  return r.status;
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-staged-"));
  git(dir, "init -q");
  git(dir, 'config user.email "t@t.invalid"');
  git(dir, 'config user.name "t"');
  git(dir, "config commit.gpgsign false");
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
  }
}

{
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, "staged-clean.md"), "all good here\n");
  git(repo, "add staged-clean.md");
  fs.writeFileSync(
    path.join(repo, "tracked.md"),
    `notes about ${LEAK} integration\n`,
  );

  const staged = runPurity(repo, "--staged");
  ok(
    "1. --staged CLEAN when leak is only in an unstaged file",
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
