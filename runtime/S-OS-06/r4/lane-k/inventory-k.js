#!/usr/bin/env node
"use strict";

/**
 * S-OS-06 r4 lane K — INVENTORY of the partition's ALLOW-LISTED population (MEASUREMENT ONLY, fixes nothing).
 *
 * Emits, per tracked file the partition allow-lists (class 2/3/4: path-glob, future-entry, compat member), the
 * legacy ROOT-token occurrence count (grammar T of oracle (iv): the root token, case-insensitive, anywhere), the
 * occupancy-form sub-counts, the name occurrence, and the bucket oracle (iv) assigns it (its list-form section 1 path
 * rule, compat, or CONTESTED). Property A / property B adjudication is NOT done here: it is a per-file reading
 * recorded in adjudication-k.json. This script only fixes the population the adjudication must cover.
 *
 * Usage: node runtime/S-OS-06/r4/lane-k/inventory-k.js --oracle <abs path to oracle-iv-occupancy.js>
 *                                                       [--out <inventory.json>] [--lines <local-lines.txt>]
 *   --lines writes the matching LINE TEXT for local reading ONLY (outside the tree; never commit it — the purity gate
 *   forbids the strings such quotes can carry in tracked files).
 *
 * Refuses (exit 2) on a dirty tracked tree, an unreadable partition, or an unreadable file.
 * Self-reference hygiene: the root token is assembled at runtime.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const TOKEN = ["wa", "rp"].join("");
const TOKEN_RE = () => new RegExp(TOKEN, "gi");

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
function refuse(msg) {
  console.error(`inventory-k: REFUSED — ${msg}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const arg = (k) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : null);
const oraclePath = arg("--oracle");
if (!oraclePath) refuse("--oracle <path to oracle-iv-occupancy.js> is required (its occupancyForm + PATH_RULES are reused, never copied)");
const oracle = require(path.resolve(oraclePath));

const head = git(["rev-parse", "HEAD"]).stdout.trim();
const dirty = git(["status", "--porcelain", "--untracked-files=no"]).stdout.split(/\r?\n/).filter(Boolean);
if (dirty.length) refuse(`tracked tree dirty (${dirty.length})`);
const tracked = git(["ls-files", "-z"]).stdout.split(String.fromCharCode(0)).filter(Boolean);

const loader = require(path.join(ROOT, "scripts", "open-source", "partition-loader.js"));
let partition;
try {
  partition = loader.loadPartition({ forceReload: true });
} catch (e) {
  refuse(`partition load threw: ${e.message}`);
}

const rows = [];
const localLines = [];
const pop = { tracked: tracked.length, allowListed: 0, allowListedWithOccurrence: 0, allowListedNoOccurrence: 0, binary: 0, unreadable: 0 };
const byEntry = {};

for (const rel of tracked) {
  const pc = partition.classifyPath(rel);
  if (!pc || pc.class === 1) continue;
  pop.allowListed += 1;
  const entry = pc.kind === "compat" ? `compat:${pc.entry.surface}(expires ${pc.entry.expires})` : `class-${pc.class} ${pc.kind} '${pc.entry.pattern}'`;
  const nameHit = TOKEN_RE().test(rel.split("/").pop());
  let buf;
  try {
    buf = fs.readFileSync(path.join(ROOT, rel));
  } catch (e) {
    pop.unreadable += 1;
    refuse(`unreadable ${rel}: ${e.message}`);
  }
  const isBinary = buf.subarray(0, 8192).includes(0);
  if (isBinary) pop.binary += 1;
  const content = isBinary ? "" : buf.toString("utf8");
  const forms = {};
  const lines = [];
  let n = 0;
  if (!isBinary) {
    content.split(/\r?\n/).forEach((t, i) => {
      const re = TOKEN_RE();
      let m;
      let k = 0;
      while ((m = re.exec(t)) !== null) {
        k += 1;
        const f = oracle.occupancyForm(t, m.index);
        forms[f] = (forms[f] || 0) + 1;
      }
      if (k) {
        n += k;
        lines.push(i + 1);
        localLines.push(`${rel}:${i + 1}: ${t.length > 240 ? t.slice(0, 240) + "…" : t}`);
      }
    });
  }
  const pathRule = oracle.PATH_RULES.filter((r) => r.test(rel)).map((r) => r.id);
  const oracleBucket = pc.kind === "compat" ? "compat" : pathRule.length === 1 ? `historical:${pathRule[0]}` : pathRule.length > 1 ? "ambiguous" : "CONTESTED";
  if (!byEntry[entry]) byEntry[entry] = { files: 0, filesWithOcc: 0, occurrences: 0, namedPaths: 0, oracleBuckets: {} };
  const e = byEntry[entry];
  e.files += 1;
  if (n || nameHit) e.filesWithOcc += 1;
  e.occurrences += n;
  if (nameHit) e.namedPaths += 1;
  e.oracleBuckets[oracleBucket] = (e.oracleBuckets[oracleBucket] || 0) + n;
  if (n || nameHit) pop.allowListedWithOccurrence += 1;
  else pop.allowListedNoOccurrence += 1;
  rows.push({ file: rel, entry, oracleBucket, occurrences: n, nameHit, binary: isBinary, lines, forms });
}

const out = {
  $lane: "S-OS-06 r4 lane K — allow-listed population inventory (measurement only)",
  head,
  grammar: `/${TOKEN}/gi (oracle (iv) grammar T)`,
  population: pop,
  reconciliation: `allowListed ${pop.allowListed} == withOccurrence ${pop.allowListedWithOccurrence} + noOccurrence ${pop.allowListedNoOccurrence} [holds=${pop.allowListed === pop.allowListedWithOccurrence + pop.allowListedNoOccurrence}]`,
  byEntry,
  files: rows.filter((r) => r.occurrences || r.nameHit),
};
const outPath = arg("--out");
if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
const linesPath = arg("--lines");
if (linesPath) fs.writeFileSync(linesPath, localLines.join("\n") + "\n");
console.log(`head ${head}`);
console.log(JSON.stringify(pop));
console.log(out.reconciliation);
for (const [k, v] of Object.entries(byEntry).sort((a, b) => b[1].occurrences - a[1].occurrences)) console.log(`${String(v.occurrences).padStart(6)} occ ${String(v.filesWithOcc).padStart(4)}/${String(v.files).padEnd(4)} files  ${k}  ${JSON.stringify(v.oracleBuckets)}`);
