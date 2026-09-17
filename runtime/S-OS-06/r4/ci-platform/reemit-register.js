#!/usr/bin/env node
"use strict";
// S-OS-06 r4 ci-platform (β a5c3e761 Q2 consequence): the normalizer gained step 7, so $normalizer changed and every
// stored line must again be a fixed point of the DECLARED order. This RE-OBSERVES the WHOLE register on this platform
// through the committed runner's own code path (runNodeTest, pinned tap reporter, hermetic child env, captureCauseLines)
// and re-emits it. Lines are never hand-edited: each entry's causeLines is the canonical multiset of what was observed.
//
// Refuses to write anything if ANY entry does not re-observe cleanly (exit null, passes, truncated, empty capture, or a
// failing-test count different from the registered failCount). Header fields: only the runner's own declarations are
// taken from its exports; every other header field is carried over byte-for-byte. The count of changed header fields
// is computed, not asserted.
//   node runtime/S-OS-06/r4/ci-platform/reemit-register.js [--write]
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const write = process.argv.includes("--write");
const qFile = path.join(ROOT, "tests", "quarantine.json");
const summaryFile = path.join(__dirname, "reemit-summary.json");

(async () => {
  const rawBefore = fs.readFileSync(qFile, "utf8");
  const before = JSON.parse(rawBefore);
  // Serialization drift is RECORDED, not hidden: a re-emission normalizes it, and the summary names where it was.
  const canon = JSON.stringify(before, null, 2) + "\n";
  let firstDiff = -1;
  if (canon !== rawBefore) {
    firstDiff = 0;
    while (firstDiff < rawBefore.length && rawBefore[firstDiff] === canon[firstDiff]) firstDiff++;
  }
  const serializationDrift = firstDiff < 0 ? null : { atChar: firstDiff, rawBytes: rawBefore.length, canonicalBytes: canon.length, raw: rawBefore.slice(Math.max(0, firstDiff - 30), firstDiff + 30), canonical: canon.slice(Math.max(0, firstDiff - 30), firstDiff + 30) };
  const d = JSON.parse(rawBefore);
  const ctx = rt.normalizerContext(ROOT);
  const here = rt.currentStamp();
  const refusals = [];
  const rows = [];
  const t0 = Date.now();
  for (const e of d.entries) {
    const r = await rt.runNodeTest(ROOT, [e.file], { tee: false, timeoutMs: 10 * 60 * 1000 });
    const cap = rt.captureCauseLines(r.output, ctx);
    const fc = rt.failCount(r.output);
    const lines = rt.causeMultiset(cap.lines);
    const row = { file: e.file, exit: r.status, truncated: !!r.truncated, failCountObserved: fc, failCountRegistered: e.failCount, storedLines: e.causeLines.length, observedLines: lines.length };
    if (r.status === null || r.status === 0 || r.truncated || lines.length === 0 || fc !== e.failCount) {
      refusals.push({ ...row, why: r.status === null ? "no exit code" : r.status === 0 ? "passed" : r.truncated ? "capture truncated" : lines.length === 0 ? "empty capture" : "failCount differs" });
    }
    const diff = rt.multisetDifference(lines, e.causeLines);
    row.changed = !rt.sameMultiset(lines, e.causeLines);
    if (row.changed) row.diff = diff;
    const notFixed = lines.filter((l) => !rt.isFixedPoint(l, ctx));
    if (notFixed.length) refusals.push({ ...row, why: "observed line not a fixed point", notFixed });
    rows.push(row);
    e.causeLines = lines;
    e.observedOn = { platform: here.platform, nodeMajor: here.nodeMajor, reporter: here.reporter };
  }
  d.$normalizer = rt.NORMALIZER_DECLARATION.slice();
  d.$dropClass = rt.DROP_CLASS_DECLARATION.slice();
  d.$ceilings = rt.CEILINGS.slice();
  const headerKeys = [...new Set([...Object.keys(before), ...Object.keys(d)])].filter((k) => k !== "entries");
  const headerChanged = headerKeys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(d[k]));
  const out = {
    env: { platform: process.platform, node: process.versions.node, reporter: rt.REPORTER },
    at: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    entries: d.entries.length,
    entriesChanged: rows.filter((x) => x.changed).length,
    headerFieldsTotal: headerKeys.length,
    headerFieldsChanged: headerChanged,
    serializationDrift,
    refusals,
    wrote: false,
    rows,
  };
  if (write && refusals.length === 0) {
    fs.writeFileSync(qFile, JSON.stringify(d, null, 2) + "\n", "utf8");
    out.wrote = true;
  }
  fs.writeFileSync(summaryFile, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ env: out.env, entries: out.entries, entriesChanged: out.entriesChanged, headerFieldsChanged: headerChanged, refusals: refusals.length, wrote: out.wrote, elapsedMs: out.elapsedMs }));
  process.exitCode = refusals.length ? 1 : 0;
})().catch((e) => {
  console.error(`reemit-register: FAILED — ${e && e.stack ? e.stack : e}`);
  process.exitCode = 2;
});
