"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { findDuplicateGenesisIds, findGenesisEvadingUpdates } = require("./ed-registry");

function registerPath() {
  try { return require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.enforcementDebt; }
  catch { return path.join(".claude", "project", "memory", "enforcement-debt.jsonl"); }
}

function run(text) {
  return { dups: findDuplicateGenesisIds(text), evading: findGenesisEvadingUpdates(text) };
}

if (require.main === module) {
  let p = registerPath();
  if (!path.isAbsolute(p)) p = path.join(ROOT, p);
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") {
      process.stdout.write(`ed-dup-id-lint: SKIP — enforcement-debt register absent at ${p} (nothing to lint).\n`);
      process.exit(0);
    }
    process.stderr.write(`ed-dup-id-lint: enforcement-debt register present but unreadable at ${p} (${e.code || e.message}) — fail-closed.\n`);
    process.exit(2);
  }
  const { dups, evading } = run(text);
  if (dups.length === 0 && evading.length === 0) {
    process.stdout.write("ed-dup-id-lint: OK — no genesis-duplicate ED ids and no genesis hiding behind an update marker.\n");
    process.exit(0);
  }
  process.stderr.write("ed-dup-id-lint: FAIL:\n");
  for (const d of dups) process.stderr.write(`  ${d.id}: ${d.count} genesis rows (two distinct debt loggings colliding — allocator regression)\n`);
  for (const e of evading) process.stderr.write(`  ${e.id}: an UPDATE-marked row (amendment/record_kind/amends) carries a fresh description (policy/origin/gap) — a second genesis hiding from the dup count\n`);
  process.stderr.write("Fix: a fresh debt must mint a new id via `node scripts/enforcement/next-ed-id.js` (not reuse an id under an update marker); an append-only closure/amendment updates via `note`, not a fresh description.\n");
  process.exit(1);
}

module.exports = { run, registerPath };
