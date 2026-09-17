#!/usr/bin/env node
"use strict";
// S-OS-06 r4 lane I2: an ACTUAL observation of the committed register through the committed runner's own code path.
// For N sequential passes, every entry in tests/quarantine.json runs ALONE via run-tests.js runNodeTest (reporter
// pinned to tap) + captureCauseLines, and the observed multiset is compared with the stored one via sameMultiset.
// Also records whether the ORDERED sequence was stable across passes (informational; it is not the lock).
//   node runtime/S-OS-06/r4/s2i2/observe-register.js [passes=3] [outFile]
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const passes = Number(process.argv[2] || 3);
const outFile = process.argv[3] || path.join(__dirname, "observe-register.summary.json");

(async () => {
  const qFile = path.join(ROOT, "tests", "quarantine.json");
  const { entries, base } = rt.loadQuarantine(qFile, ROOT);
  const ctx = rt.normalizerContext(ROOT);
  const per = new Map(entries.map((e) => [e.file, { file: e.file, stored: e.causeLines.length, multisetEqualsRegister: [], exit: [], failCount: [], orderings: new Set() }]));
  const t0 = Date.now();
  for (let p = 0; p < passes; p++) {
    for (const e of entries) {
      const r = await rt.runNodeTest(ROOT, [e.file], { tee: false, timeoutMs: 10 * 60 * 1000 });
      const cap = rt.captureCauseLines(r.output, ctx);
      const s = per.get(e.file);
      s.exit.push(r.status);
      const m = /^# fail (\d+)\s*$/m.exec(r.output);
      s.failCount.push(m ? Number(m[1]) : null);
      s.multisetEqualsRegister.push(r.status !== null && !r.truncated && rt.sameMultiset(cap.lines, e.causeLines));
      s.orderings.add(JSON.stringify(cap.lines));
      if (!rt.sameMultiset(cap.lines, e.causeLines)) s.lastDiff = rt.multisetDifference(cap.lines, e.causeLines);
    }
  }
  const rows = [...per.values()].map((s) => ({ ...s, orderings: s.orderings.size }));
  const summary = {
    env: { platform: process.platform, node: process.versions.node, reporter: rt.REPORTER, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || null },
    at: new Date().toISOString(),
    base,
    passes,
    elapsedMs: Date.now() - t0,
    entries: rows.length,
    multisetEqualsRegisterEveryPass: rows.filter((r) => r.multisetEqualsRegister.every(Boolean)).length,
    orderedSequenceStableAcrossPasses: rows.filter((r) => r.orderings === 1).length,
    orderFlappingEntries: rows.filter((r) => r.orderings > 1).map((r) => `${r.file} (${r.orderings} orderings)`),
    rows,
  };
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ passes, entries: summary.entries, multisetEqualsRegisterEveryPass: summary.multisetEqualsRegisterEveryPass, orderedSequenceStableAcrossPasses: summary.orderedSequenceStableAcrossPasses, orderFlappingEntries: summary.orderFlappingEntries, elapsedMs: summary.elapsedMs, out: path.relative(ROOT, outFile) }));
  process.exitCode = summary.multisetEqualsRegisterEveryPass === summary.entries ? 0 : 1;
})().catch((e) => {
  console.error(e.stack || e);
  process.exitCode = 2;
});
