#!/usr/bin/env node
"use strict";
// One-shot transform (S-OS-06 r4 lane I2): the WIP register captured by lane I's REAL sequential observation
// (runtime/S-OS-06/r4/s2i/wip/quarantine.json.wip) -> tests/quarantine.json under the multiset ruling (β 2d7f5b83,
// row 479). Lines are NOT re-derived or edited: each entry's causeLines is put in canonical (sorted) order, and the
// declarations are taken from the runner's own exports so declared = actual by construction.
// Whether the result still matches reality is verified separately by an actual observation (observe-register.js).
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const src = path.join(ROOT, "runtime", "S-OS-06", "r4", "s2i", "wip", "quarantine.json.wip");
const dst = path.join(ROOT, "tests", "quarantine.json");
const d = JSON.parse(fs.readFileSync(src, "utf8"));
function mustReplace(s, from, to) {
  if (!s.includes(from)) throw new Error(`expected text not found: ${from}`);
  return s.split(from).join(to);
}
d.$policy = mustReplace(d.$policy, "fails with a different ordered sequence of cause lines", "fails with a different multiset of cause lines");
d.$format = mustReplace(
  d.$format,
  "causeLines = the ORDERED SEQUENCE of cause lines observed when the file runs alone",
  "causeLines = the UNORDERED MULTISET (duplicates kept) of cause lines observed when the file runs alone"
);
d.$format = mustReplace(
  d.$format,
  "Comparison is exact equality of the sequence, never containment, never a hash.",
  "The multiset is stored in canonical form, sorted by ascending UTF-16 code unit, and a stored causeLines in any other order is refused. Comparison is exact equality of the two multisets in canonical form, never containment, never a hash. ORDER IS NOT LOCKED (see $ceilings): the TAP reporter renders stdout and stderr lines identically, so cross-stream order is pipe scheduling, not a property of the test."
);
d.$normalizer = rt.NORMALIZER_DECLARATION.slice();
d.$dropClass = rt.DROP_CLASS_DECLARATION.slice();
d.$ceilings = rt.CEILINGS.slice();
let reordered = 0;
for (const e of d.entries) {
  const sorted = rt.causeMultiset(e.causeLines);
  if (sorted.some((l, i) => l !== e.causeLines[i])) reordered++;
  e.causeLines = sorted;
}
fs.writeFileSync(dst, JSON.stringify(d, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ entries: d.entries.length, reorderedToCanonical: reordered, totalLines: d.entries.reduce((n, e) => n + e.causeLines.length, 0) }));
