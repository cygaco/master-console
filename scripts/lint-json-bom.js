#!/usr/bin/env node
/**
 * lint-json-bom — Refuse a UTF-8 BOM on any git-tracked JSON file.
 *
 * Why: PowerShell's default text encoding (Out-File / Set-Content / `>` on
 * Windows PowerShell 5.1) prepends a UTF-8 BOM (EF BB BF). Node's JSON.parse
 * rejects a leading BOM, so a BOM'd JSON silently breaks every Node consumer
 * (e.g. ~/.mc/portfolio.json once broke /portfolio:list — exit 2
 * "registry corrupt"). This is a recurring Windows-migration corruption class;
 * see MIGRATION.md §1 and registry.js load() BOM-tolerance.
 *
 * Enforcer for: "no MC-tracked JSON carries a BOM." Auto-discovered by
 * scripts/linters/run.js (lint-*.js) → runs under /linters:run and /scan:full.
 *
 * Exit 0 = clean. Exit 1 = at least one tracked .json has a BOM.
 * Usage: node scripts/lint-json-bom.js
 */
"use strict";

const fs = require("fs");
const { execSync } = require("child_process");

function trackedJsonFiles() {
  // -z + split on NUL so paths with spaces/unicode survive intact.
  const out = execSync("git ls-files -z -- *.json **/*.json", {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean);
}

function hasBom(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(3);
    const n = fs.readSync(fd, buf, 0, 3, 0);
    return n === 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  } catch {
    return false; // unreadable/deleted-but-tracked → not our concern here
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function main() {
  let files;
  try {
    files = trackedJsonFiles();
  } catch (e) {
    // Not a git repo / git missing → fail open (don't block non-git contexts).
    console.log("lint-json-bom: ✓ skipped (git unavailable)");
    process.exit(0);
  }

  const offenders = files.filter(hasBom);

  if (offenders.length === 0) {
    console.log(`lint-json-bom: ✓ no BOM in ${files.length} tracked JSON file(s)`);
    process.exit(0);
  }

  console.error(
    `lint-json-bom: ✗ ${offenders.length} tracked JSON file(s) carry a UTF-8 BOM:\n`,
  );
  for (const f of offenders) console.error(`  ERROR  ${f}`);
  console.error(
    "\nFix: re-write without a BOM. PowerShell 7+: " +
      "(Get-Content -Raw $f) | Set-Content -Encoding utf8NoBOM $f\n" +
      "     PowerShell 5.1: [IO.File]::WriteAllText($f,[IO.File]::ReadAllText($f)," +
      "(New-Object Text.UTF8Encoding $false))\n" +
      "Root cause + migration checklist: MIGRATION.md §1.\n",
  );
  process.exit(1);
}

main();
