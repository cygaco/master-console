// S-OS-06 r4 lane I8 item 3 — does ANY real quarantine entry have an unobservable failing-test count today?
// Runs each registered file exactly as the runner does (runNodeTest: hermetic childEnv, tap) and reports only
// {index, status, truncated, failSummaryPresent, fc, registered} — no line text, no file names (purity).
"use strict";
const path = require("path");
const fs = require("fs");
const R = require(path.resolve("scripts/checks/run-tests.js"));
const q = JSON.parse(fs.readFileSync("tests/quarantine.json", "utf8"));
(async () => {
  const rows = [];
  const queue = q.entries.map((e, i) => ({ e, i }));
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const r = await R.runNodeTest(process.cwd(), [job.e.file], { tee: false, timeoutMs: 5 * 60 * 1000 });
      const m = [...r.output.matchAll(/^(?:ℹ|#) fail (\d+)\s*$/gm)];
      rows.push({ index: job.i, status: r.status, truncated: r.truncated, failSummaryPresent: m.length > 0, fc: m.length ? Number(m[m.length - 1][1]) : null, registered: job.e.failCount });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  rows.sort((a, b) => a.index - b.index);
  const nullCount = rows.filter((x) => x.fc === null).length;
  console.log(JSON.stringify({ entries: rows.length, fcUnobservable: nullCount, fcAboveRegistered: rows.filter((x) => x.fc !== null && x.fc > x.registered).length, rows }, null, 1));
})();
