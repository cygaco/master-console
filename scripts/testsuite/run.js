#!/usr/bin/env node
/**
 * scripts/testsuite/run.js — MC regression-seed runner (0.17.0 foundation).
 *
 * Reads the executable bug-class registry
 * (_requirements/07-testing/recurring-bug-classes.json), runs each class's
 * detector, and reports per-class result + an overall catch-rate. This is the
 * concrete core of the Per-Sprint Exhaustive Test-Suite System: the 26 recurring
 * bug classes from the regression seed, made runnable.
 *
 *   node scripts/testsuite/run.js            # human report
 *   node scripts/testsuite/run.js --json     # machine output (for scan:full)
 *   node scripts/testsuite/run.js --quiet    # summary line only
 *
 * Role-aware: a detector with detector.expect_canonical === "na" is consumer-only;
 * if it fails in canonical that is EXPECTED (n/a), not a regression. (Interim until
 * the shared repo-role resolver lands — 0.17.0 open item.)
 *
 * Exit: 0 when no detector EXPECTED to pass in canonical actually failed (gaps +
 * manual + n/a are reported, never fail the run — they are the suite's backlog).
 * Non-zero = a real regression signal in a covered class.
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const REG = path.join(ROOT, "_requirements", "07-testing", "recurring-bug-classes.json");
const TIMEOUT_MS = 90_000;

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const QUIET = args.includes("--quiet");

let reg;
try {
  reg = JSON.parse(fs.readFileSync(REG, "utf8").replace(/^﻿/, ""));
} catch (e) {
  process.stderr.write(`testsuite: cannot load registry at ${REG}: ${e.message}\n`);
  process.exit(2);
}

const results = [];
for (const c of reg.classes) {
  const d = c.detector || {};
  if (!d.run) {
    results.push({ id: c.id, name: c.name, category: c.category, status: c.status, type: d.type || "none", result: d.type === "manual" ? "manual" : "gap", exit: null, expect: d.expect_canonical || null });
    continue;
  }
  const r = cp.spawnSync(process.execPath, d.run, { cwd: ROOT, timeout: TIMEOUT_MS, encoding: "utf8" });
  let result;
  if (r.error) result = r.error.code === "ETIMEDOUT" ? "timeout" : "error";
  else result = r.status === 0 ? "pass" : "fail";
  // Role-aware: a consumer-only detector that fails in canonical is N/A here, not a regression.
  if (result !== "pass" && d.expect_canonical === "na") result = "na";
  results.push({ id: c.id, name: c.name, category: c.category, status: c.status, type: d.type, result, exit: r.status ?? null, expect: d.expect_canonical || null });
}

// "regression" = a class whose detector ran and failed while expected to pass in canonical.
const regressions = results.filter((r) => ["fail", "error", "timeout"].includes(r.result) && (r.expect === "pass" || (r.expect == null && r.type !== "none" && r.type !== "manual")));
const ran = results.filter((r) => ["pass", "fail", "error", "timeout"].includes(r.result));
const passing = results.filter((r) => r.result === "pass");
const na = results.filter((r) => r.result === "na");
const gaps = results.filter((r) => r.result === "gap");
const manual = results.filter((r) => r.result === "manual");

const summary = {
  total: results.length,
  covered: reg.classes.filter((c) => c.status === "covered").length,
  partial: reg.classes.filter((c) => c.status === "partial").length,
  gap: reg.classes.filter((c) => c.status === "gap").length,
  runnable: ran.length,
  passing: passing.length,
  regressions: regressions.length,
  na_canonical: na.length,
  manual: manual.length,
  uncovered_gaps: gaps.length,
  catch_rate_runnable: ran.length ? Math.round((passing.length / ran.length) * 100) : 0,
};

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ summary, results }, null, 2) + "\n");
  process.exit(regressions.length ? 1 : 0);
}

if (!QUIET) {
  const mark = { pass: "PASS", fail: "FAIL", error: "ERR ", timeout: "TIME", gap: "gap ", manual: "man ", na: "n/a " };
  process.stdout.write("\nMC regression-seed suite — 26 recurring bug classes\n");
  process.stdout.write("=".repeat(72) + "\n");
  for (const r of results) {
    process.stdout.write(`  [${mark[r.result] || r.result}] ${r.id}  ${r.name.slice(0, 52).padEnd(52)} ${r.status}\n`);
  }
  process.stdout.write("=".repeat(72) + "\n");
}
process.stdout.write(
  `regression-seed: ${summary.passing}/${summary.runnable} runnable green` +
  ` | ${summary.regressions} regression(s) | ${summary.na_canonical} n/a-canonical | ${summary.uncovered_gaps} gap + ${summary.manual} manual` +
  ` | coverage ${summary.covered} covered / ${summary.partial} partial / ${summary.gap} gap of ${summary.total}\n`
);
if (regressions.length && !QUIET) {
  process.stdout.write("\nREGRESSIONS (covered classes whose detector failed):\n");
  for (const r of regressions) process.stdout.write(`  - ${r.id} ${r.name} (exit ${r.exit})\n`);
}
process.exit(regressions.length ? 1 : 0);
