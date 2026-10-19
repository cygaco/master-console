#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { isCanonical, roleLabel } = require("./role");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN = path.join(__dirname, "run.js");
const REG = path.join(ROOT, "_requirements", "07-testing", "recurring-bug-classes.json");

function errorVerdict(role, message, r, childStatus) {
  return {
    enforced: true,
    role,
    regressions: 0,
    baselineReds: [],
    staleBaseline: [],
    incoherent: [],
    exit: 2,
    childStatus,
    error: message,
    stderrTail: ((r && (r.stderr || r.stdout)) || "").split(/\r?\n/).filter(Boolean).slice(-6),
  };
}

function isRegression(r) {
  return (
    ["fail", "error", "timeout"].includes(r.result) &&
    (r.expect === "pass" || (r.expect == null && r.type !== "none" && r.type !== "manual"))
  );
}

function incoherentClasses() {
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(REG, "utf8").replace(/^﻿/, ""));
  } catch {
    return [];
  }
  return (reg.classes || [])
    .filter((c) => {
      if (c.status === "gap") return false;
      const d = c.detector;
      return !d || !Array.isArray(d.run) || d.run.length === 0;
    })
    .map((c) => ({ id: c.id, name: c.name }));
}

function baselineRedIds() {
  try {
    const reg = JSON.parse(fs.readFileSync(REG, "utf8").replace(/^﻿/, ""));
    return new Set((reg.classes || []).filter((c) => c.baseline === "red").map((c) => c.id));
  } catch {
    return new Set();
  }
}

function run(opts) {
  const strict = !!(opts && opts.strict);
  const role = roleLabel();
  const canonical = isCanonical();

  if (!canonical) {
    return { enforced: false, role, regressions: 0, incoherent: [], exit: 0, mode: "opt-in" };
  }

  const r = spawnSync(process.execPath, [RUN, "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const childStatus = typeof r.status === "number" ? r.status : null;

  let parsed;
  try {
    parsed = JSON.parse((r.stdout || "").trim());
  } catch {
    return errorVerdict(role, `run.js produced no parseable JSON (status=${childStatus}, error=${r.error ? r.error.code : "none"}).`, r, childStatus);
  }

  if (r.error || (childStatus !== 0 && childStatus !== 1)) {
    return errorVerdict(role, `run.js exited with an error status (status=${childStatus}, error=${r.error ? r.error.code : "none"}) — runner error, not a clean pass.`, r, childStatus);
  }

  const summary = parsed.summary && typeof parsed.summary === "object" ? parsed.summary : {};
  if (!Array.isArray(parsed.results)) {
    return errorVerdict(role, `run.js verdict has no results[] array — malformed runner output.`, r, childStatus);
  }
  const results = parsed.results;
  const summaryRegressions = typeof summary.regressions === "number" ? summary.regressions : null;
  if (summaryRegressions != null && summaryRegressions > 0 && results.length === 0) {
    return errorVerdict(role, `run.js summary claims ${summaryRegressions} regression(s) but results[] is empty — incoherent runner output.`, r, childStatus);
  }

  const baseline = baselineRedIds();
  const allOffending = results.filter(isRegression);
  const offending = allOffending.filter((o) => !baseline.has(o.id));
  const baselineReds = allOffending.filter((o) => baseline.has(o.id)).map((o) => o.id);

  const offendingIds = new Set(allOffending.map((o) => o.id));
  const staleBaseline = [...baseline].filter((id) => !offendingIds.has(id));

  const regressions = offending.length;
  const incoherent = strict ? incoherentClasses() : [];

  const exit =
    regressions > 0 || (strict && (incoherent.length > 0 || staleBaseline.length > 0)) ? 1 : 0;
  return {
    enforced: true,
    role,
    regressions,
    baselineReds,
    staleBaseline,
    incoherent: incoherent.map((c) => c.id),
    exit,
    childStatus,
    summary,
    offending,
    incoherentDetail: incoherent,
    strict,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const json = args.includes("--json");
  const v = run({ strict });

  if (v.exit === 2) {
    process.stderr.write(`enforce: ${v.error}\n`);
    for (const l of v.stderrTail || []) process.stderr.write(`  ${l}\n`);
    if (json) process.stdout.write(JSON.stringify({ enforced: v.enforced, role: v.role, regressions: v.regressions, incoherent: v.incoherent, exit: v.exit, childStatus: v.childStatus, error: v.error }) + "\n");
    process.exit(2);
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({ enforced: v.enforced, role: v.role, regressions: v.regressions, baselineReds: v.baselineReds, staleBaseline: v.staleBaseline, incoherent: v.incoherent, exit: v.exit, childStatus: v.childStatus }) + "\n",
    );
    process.exit(v.exit);
  }

  if (!v.enforced) {
    process.stdout.write(`test-suite enforcement is opt-in for product repos (repoRole=${v.role}); no-op.\n`);
    process.exit(0);
  }

  if (v.regressions > 0) {
    process.stdout.write(`test-suite enforcement FAILED: ${v.regressions} regression(s) in covered classes (repoRole=${v.role}).\n`);
    for (const o of v.offending) process.stdout.write(`  ${o.id}  ${o.name}  (exit ${o.exit})\n`);
  }
  if (v.strict && v.incoherentDetail.length > 0) {
    process.stdout.write(`incoherent registry rows (status != gap but detector.run === null):\n`);
    for (const c of v.incoherentDetail) process.stdout.write(`  ${c.id}  ${c.name}\n`);
  }
  if (v.baselineReds && v.baselineReds.length) {
    process.stdout.write(`known-baseline reds (tracked debt, NOT release-blocking): ${v.baselineReds.join(", ")}\n`);
  }
  if (v.staleBaseline && v.staleBaseline.length) {
    const verb = v.strict ? "BLOCKING in --strict" : "warning";
    process.stdout.write(
      `STALE baseline marker(s) — class no longer failing, remove baseline:"red" so future regressions block again (${verb}): ${v.staleBaseline.join(", ")}\n`,
    );
  }
  if (v.exit === 0) {
    process.stdout.write(
      `test-suite enforcement: ${v.summary.passing}/${v.summary.runnable} runnable green, 0 NEW regressions — canonical clean.\n`,
    );
  }
  process.exit(v.exit);
}

module.exports = { run, isRegression, incoherentClasses };
