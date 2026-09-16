#!/usr/bin/env node
"use strict";
// S-OS-06 r4 lane I3 — falsifier 3 on the COMMITTED runner + COMMITTED register (not a re-measure of the 6-pass,
// which ran the WIP runner and compared passes to EACH OTHER; this compares every pass to the REGISTER).
//   node stability-committed.js <passes> <quiet|load> <outFile>
// load: one busy-loop node process per logical CPU runs for the whole observation (pipe scheduling is exactly what
// load perturbs). Every entry runs ALONE, sequentially, via run-tests.js runNodeTest (TAP pinned) + captureCauseLines.
// Per pass per entry it records: exit, fail count, multiset == register, and the reporter-order sequence (to count
// orderings; order is NOT the lock). Burners are killed in finally.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const rt = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const passes = Number(process.argv[2] || 5);
const mode = process.argv[3] || "quiet";
const outFile = process.argv[4] || path.join(__dirname, `stability-committed-${mode}.summary.json`);

(async () => {
  const { entries, base } = rt.loadQuarantine(path.join(ROOT, "tests", "quarantine.json"), ROOT);
  const ctx = rt.normalizerContext(ROOT);
  const burners = [];
  if (mode === "load") for (let i = 0; i < os.cpus().length; i++) burners.push(spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore", windowsHide: true }));
  const per = new Map(entries.map((e) => [e.file, { file: e.file, stored: e.causeLines.length, eqRegister: [], exit: [], failCount: [], orderings: new Set(), mismatches: [] }]));
  const t0 = Date.now();
  try {
    for (let p = 0; p < passes; p++) {
      for (const e of entries) {
        const r = await rt.runNodeTest(ROOT, [e.file], { tee: false, timeoutMs: 10 * 60 * 1000 });
        const cap = rt.captureCauseLines(r.output, ctx);
        const s = per.get(e.file);
        const fc = (/^# fail (\d+)\s*$/m.exec(r.output) || [])[1];
        s.exit.push(r.status);
        s.failCount.push(fc === undefined ? null : Number(fc));
        const eq = r.status === 1 && !r.truncated && rt.sameMultiset(cap.lines, e.causeLines) && Number(fc) === e.failCount;
        s.eqRegister.push(eq);
        s.orderings.add(JSON.stringify(cap.lines));
        if (!eq) s.mismatches.push({ pass: p + 1, exit: r.status, truncated: r.truncated, failCount: fc, diff: rt.multisetDifference(cap.lines, e.causeLines) });
      }
    }
  } finally {
    for (const b of burners) b.kill();
  }
  const rows = [...per.values()].map((s) => ({ ...s, orderings: s.orderings.size }));
  const summary = {
    env: { platform: process.platform, node: process.versions.node, reporter: rt.REPORTER, cpus: os.cpus().length, mode, burners: burners.length, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR || null },
    at: new Date().toISOString(),
    base,
    passes,
    elapsedMs: Date.now() - t0,
    entries: rows.length,
    observations: rows.length * passes,
    entriesEqualRegisterEveryPass: rows.filter((r) => r.eqRegister.every(Boolean)).length,
    observationsEqualRegister: rows.reduce((n, r) => n + r.eqRegister.filter(Boolean).length, 0),
    orderedSequenceStableAcrossPasses: rows.filter((r) => r.orderings === 1).length,
    orderFlappingEntries: rows.filter((r) => r.orderings > 1).map((r) => `${r.file} (${r.orderings} orderings)`),
    rows,
  };
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n", "utf8");
  const { rows: _r, ...head } = summary;
  console.log(JSON.stringify(head));
  process.exitCode = summary.entriesEqualRegisterEveryPass === summary.entries ? 0 : 1;
})().catch((e) => {
  console.error(e.stack || e);
  process.exitCode = 2;
});
