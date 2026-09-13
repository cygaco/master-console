"use strict";
/**
 * ed-dup-id-lint.js (SP-20260723-003 / ED-258a) — the GENESIS-KEYED duplicate-id lint over the
 * enforcement-debt register (/scan:full-scoped). The BACKSTOP detector for the ED-267b allocator: the
 * allocator fixes the generator (mint max+1), this lint catches any residual collision.
 *
 * GENESIS-KEYED (β 0.90 DIRECTIVE): a violation is an id with >1 GENESIS row (two distinct debt loggings
 * colliding). An append-only CLOSURE/amendment row re-using an id is NOT a violation — a bare
 * "id appears >=2x" check would false-RED every closed ED (the append-only closure pattern). See
 * ed-registry.js#findDuplicateGenesisIds for the discriminator.
 *
 * Exit 0 = no genesis-dup · 1 = dup found · 2 = fail-closed (register unreadable — never a silent green).
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const { findDuplicateGenesisIds, findGenesisEvadingUpdates } = require("./ed-registry");

function registerPath() {
  try { return require(path.join(ROOT, "scripts", "hooks", "lib", "paths")).PATHS.enforcementDebt; }
  catch { return path.join(".claude", "project", "memory", "enforcement-debt.jsonl"); }
}

/** run(text) -> { dups, evading } — genesis-id collisions AND genesis-hiding-behind-an-update-marker rows. */
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
    // SP-005 ship-safety (β B/0.88 CATCH-2): partition a genuinely ABSENT register (ENOENT) — SKIP exit 0,
    // "nothing to lint" (the product state: a scaffolded product has no MC ED-register) — from a
    // register that is PRESENT-but-unreadable/corrupt — fail-closed exit 2 (the MC-corruption state).
    // Matches the established shipped-script pattern (betaevents-dedup / reasoned-consult-honesty skip-on-
    // absent; next-ed-id ENOENT→empty). Without this, a shipped BLOCKING /scan:full (full.md:130) REDs in
    // every product that lacks the register.
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
  for (const e of evading) process.stderr.write(`  ${e.id}: an UPDATE-marked row (amendment/record_kind/amends) carries a fresh description (policy/origin/gap) — a second genesis hiding from the dup count (security r2 #2)\n`);
  process.stderr.write("Fix: a fresh debt must mint a new id via `node scripts/enforcement/next-ed-id.js` (not reuse an id under an update marker); an append-only closure/amendment updates via `note`, not a fresh description.\n");
  process.exit(1);
}

module.exports = { run, registerPath };
