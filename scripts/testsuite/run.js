#!/usr/bin/env node
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

function insideRoot(rel) {
  if (typeof rel !== "string" || !rel) return null;
  const full = path.resolve(ROOT, rel);
  const back = path.relative(ROOT, full);
  if (!back || back.startsWith("..") || path.isAbsolute(back)) return null;
  return full;
}

const NA_CONDITIONS = {
  file_first_line(f) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return false;
    if (Object.keys(f).some((k) => k !== "path" && k !== "equals")) return false;
    const full = insideRoot(f.path);
    if (!full || typeof f.equals !== "string") return false;
    try {
      return fs.readFileSync(full, "utf8").replace(/^﻿/, "").split(/\r?\n/)[0] === f.equals;
    } catch {
      return false;
    }
  },
  file_absent(rel) {
    const full = insideRoot(rel);
    return !!full && !fs.existsSync(full);
  },
};

function naWhenHolds(cond) {
  if (!cond || typeof cond !== "object" || Array.isArray(cond)) return false;
  if (typeof cond.reason !== "string" || !cond.reason) return false;
  const keys = Object.keys(cond).filter((k) => k !== "reason");
  if (!keys.length) return false;
  return keys.every((k) => Object.prototype.hasOwnProperty.call(NA_CONDITIONS, k) && NA_CONDITIONS[k](cond[k]));
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
  if (result !== "pass" && d.expect_canonical === "na") result = "na";
  let reason;
  if (result === "fail" && naWhenHolds(d.na_when)) {
    result = "na";
    reason = d.na_when.reason;
  }
  const row = { id: c.id, name: c.name, category: c.category, status: c.status, type: d.type, result, exit: r.status ?? null, expect: d.expect_canonical || null };
  if (reason) row.reason = reason;
  results.push(row);
}

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
  process.stdout.write(`\nMC regression-seed suite — ${results.length} recurring bug classes\n`);
  process.stdout.write("=".repeat(72) + "\n");
  for (const r of results) {
    process.stdout.write(`  [${mark[r.result] || r.result}] ${r.id}  ${r.name.slice(0, 52).padEnd(52)} ${r.status}${r.reason ? ` — n/a: ${r.reason}` : ""}\n`);
  }
  process.stdout.write("=".repeat(72) + "\n");
}
process.stdout.write(
  `regression-seed: ${summary.passing}/${summary.runnable} runnable green` +
  ` | ${summary.regressions} regression(s) | ${summary.na_canonical} n/a-canonical | ${summary.uncovered_gaps} gap + ${summary.manual} manual` +
  ` | coverage ${summary.covered} covered / ${summary.partial} partial / ${summary.gap} gap of ${summary.total}\n`
);
if (regressions.length && !QUIET) {
  process.stdout.write("\nREGRESSIONS (classes whose detector failed where it was expected to pass):\n");
  for (const r of regressions) process.stdout.write(`  - ${r.id} ${r.name} (exit ${r.exit})\n`);
}
process.exit(regressions.length ? 1 : 0);
