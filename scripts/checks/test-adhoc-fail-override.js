#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const { evaluate, reviewerJsonIsFail, isFailVerdict } = require("./adhoc-fail-override");

let passes = 0;
let failures = 0;
function ok(name, condition, detail) {
  if (condition) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function gateCheck(feature, overrides = {}) {
  return {
    feature,
    frontend_reviewer: "pass",
    backend_reviewer: "pass",
    qa_reviewer: "pass",
    security_reviewer: "pass",
    ...overrides,
  };
}

function gammaResult(overrides = {}) {
  return {
    scope: "feat-x",
    mode: "adhoc",
    status: "pass",
    features_completed: ["feat-x"],
    gate_checks: [gateCheck("feat-x")],
    ...overrides,
  };
}

function epsilonGateCheck(unit, overrides = {}) {
  return {
    unit,
    frontend_reviewer: "pass",
    backend_reviewer: "pass",
    qa_reviewer: "pass",
    security_reviewer: "pass",
    ...overrides,
  };
}

function epsilonResult(overrides = {}) {
  return {
    sprint_id: "SP-x",
    mode: "sprint",
    status: "complete",
    units_completed: ["unit-a"],
    gate_checks: [epsilonGateCheck("unit-a")],
    ...overrides,
  };
}

function deltaResult(overrides = {}) {
  return {
    mode: "oneshot",
    status: "complete",
    features_completed: ["feat-y"],
    gate_checks: [gateCheck("feat-y")],
    ...overrides,
  };
}

console.log("Predicates:");
ok("isFailVerdict('fail') → true", isFailVerdict("fail") === true);
ok("isFailVerdict('FAIL') → true (case-insensitive)", isFailVerdict("FAIL") === true);
ok("isFailVerdict('pass') → false", isFailVerdict("pass") === false);
ok("isFailVerdict('skipped') → false", isFailVerdict("skipped") === false);
ok("reviewerJsonIsFail({verdict:'FAIL'}) → true", reviewerJsonIsFail({ verdict: "FAIL" }) === true);
ok("reviewerJsonIsFail({critical_findings:2}) → true", reviewerJsonIsFail({ critical_findings: 2 }) === true);
ok(
  "reviewerJsonIsFail({findings:[{severity:'high'}]}) → true",
  reviewerJsonIsFail({ findings: [{ severity: "high" }] }) === true,
);
ok("reviewerJsonIsFail({verdict:'PASS'}) → false", reviewerJsonIsFail({ verdict: "PASS" }) === false);
ok("reviewerJsonIsFail({findings:[{severity:'low'}]}) → false", reviewerJsonIsFail({ findings: [{ severity: "low" }] }) === false);

console.log("\n(a) fail gate_check + status:'pass' → REJECT:");
{
  const result = gammaResult({
    status: "pass",
    gate_checks: [gateCheck("feat-x", { qa_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("REJECTs", out.result === "REJECT", `got ${out.result}: ${out.errors.join("; ")}`);
  ok("error names the failing reviewer", out.errors.some((e) => /qa_reviewer/.test(e)), out.errors.join("; "));
  ok("error cites the independence invariant", out.errors.some((e) => /independence invariant/i.test(e)));
}

console.log("\n(b) fail gate_check + status:'fail' + feature NOT completed → PASS (honest):");
{
  const result = gammaResult({
    status: "fail",
    features_completed: [],
    gate_checks: [gateCheck("feat-x", { security_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("PASSes (no override — FAIL honestly reflected)", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(b2) fail gate_check + status:'halted' + feature NOT completed → PASS (honest):");
{
  const result = gammaResult({
    status: "halted",
    features_completed: [],
    gate_checks: [gateCheck("feat-x", { frontend_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("PASSes (halted is honest)", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(c) all reviewers pass + status:'pass' → PASS:");
{
  const out = evaluate({ result: gammaResult(), reviewerVerdicts: [] });
  ok("PASSes", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
  ok("checked 0 failing verdicts", out.checked === 0, `got ${out.checked}`);
}

console.log("\n(d) fail gate_check + feature still in features_completed (status:'fail') → REJECT:");
{
  const result = gammaResult({
    status: "fail",
    features_completed: ["feat-x"],
    gate_checks: [gateCheck("feat-x", { qa_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("REJECTs (features_completed override)", out.result === "REJECT", `got ${out.result}`);
  ok("error mentions features_completed", out.errors.some((e) => /features_completed/.test(e)), out.errors.join("; "));
}

console.log("\n(e) reviewer JSON inner FAIL + status:'pass' (summary-vs-detail override) → REJECT:");
{
  const result = gammaResult({ status: "pass", gate_checks: [gateCheck("feat-x")] });
  const reviewerVerdicts = [{ source: "feat-x-qa.json", fail: true, feature: "feat-x" }];
  const out = evaluate({ result, reviewerVerdicts });
  ok("REJECTs (reviewer detail contradicts summary)", out.result === "REJECT", `got ${out.result}: ${out.errors.join("; ")}`);
  ok("error names the reviewer source", out.errors.some((e) => /feat-x-qa\.json/.test(e)), out.errors.join("; "));
}

console.log("\n(e2) reviewer JSON inner FAIL + status:'fail' + not completed → PASS (honest):");
{
  const result = gammaResult({ status: "fail", features_completed: [], gate_checks: [gateCheck("feat-x")] });
  const reviewerVerdicts = [{ source: "feat-x-qa.json", fail: true, feature: "feat-x" }];
  const out = evaluate({ result, reviewerVerdicts });
  ok("PASSes (reviewer FAIL honestly reflected as status:fail)", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(g) EPSILON override: qa_reviewer fail + status:'complete' + unit in units_completed → REJECT:");
{
  const result = epsilonResult({
    status: "complete",
    units_completed: ["unit-a"],
    gate_checks: [epsilonGateCheck("unit-a", { qa_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("REJECTs (ε declared complete over a binding FAIL)", out.result === "REJECT", `got ${out.result}: ${out.errors.join("; ")}`);
  ok("error names the unit", out.errors.some((e) => /unit-a/.test(e)), out.errors.join("; "));
  ok("error cites units_completed (not features_completed)", out.errors.some((e) => /units_completed/.test(e)), out.errors.join("; "));
}

console.log("\n(g2) EPSILON honest: security_reviewer fail + status:'halted' + unit NOT completed → PASS:");
{
  const result = epsilonResult({
    status: "halted",
    units_completed: [],
    gate_checks: [epsilonGateCheck("unit-a", { security_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("PASSes (ε halted is honest)", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(g3) EPSILON all-pass + status:'complete' → PASS:");
{
  const out = evaluate({ result: epsilonResult(), reviewerVerdicts: [] });
  ok("PASSes", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(h) DELTA override: security_reviewer fail + status:'complete' + feature completed → REJECT:");
{
  const result = deltaResult({
    status: "complete",
    features_completed: ["feat-y"],
    gate_checks: [gateCheck("feat-y", { security_reviewer: "fail" })],
  });
  const out = evaluate({ result, reviewerVerdicts: [] });
  ok("REJECTs (δ 'complete' is a declared success)", out.result === "REJECT", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(h2) DELTA all-pass + status:'complete' → PASS:");
{
  const out = evaluate({ result: deltaResult(), reviewerVerdicts: [] });
  ok("PASSes", out.result === "PASS", `got ${out.result}: ${out.errors.join("; ")}`);
}

console.log("\n(f) CLI EXIT CODES — subprocess tests:");
{
  const ENGINE = path.join(__dirname, "adhoc-fail-override.js");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-afo-"));
  const emptyReviewers = path.join(tmpDir, "reviewers");
  fs.mkdirSync(emptyReviewers);

  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: no run to check → exit 0 (graceful)", r.status === 0, `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  }

  {
    const bad = path.join(tmpDir, "bad.json");
    fs.writeFileSync(bad, "{ not valid json ");
    const r = cp.spawnSync(process.execPath, [ENGINE, "--result", bad, "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: malformed result → exit 2 (fail-closed)", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
  }

  {
    const f = path.join(tmpDir, "override.json");
    fs.writeFileSync(f, JSON.stringify(gammaResult({ status: "pass", gate_checks: [gateCheck("feat-x", { qa_reviewer: "fail" })] })));
    const r = cp.spawnSync(process.execPath, [ENGINE, "--result", f, "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: fail+status:pass → exit 1 (reject)", r.status === 1, `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  }

  {
    const f = path.join(tmpDir, "honest.json");
    fs.writeFileSync(f, JSON.stringify(gammaResult({ status: "fail", features_completed: [], gate_checks: [gateCheck("feat-x", { qa_reviewer: "fail" })] })));
    const r = cp.spawnSync(process.execPath, [ENGINE, "--result", f, "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: honest fail+status:fail → exit 0", r.status === 0, `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  }

  {
    const f = path.join(tmpDir, "clean.json");
    fs.writeFileSync(f, JSON.stringify(gammaResult()));
    const r = cp.spawnSync(process.execPath, [ENGINE, "--result", f, "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: all-pass → exit 0", r.status === 0, `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  }

  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--result", path.join(tmpDir, "nope.json"), "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: --result missing file → exit 2 (fail-closed)", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
  }

  {
    const f = path.join(tmpDir, "epsilon-override.json");
    fs.writeFileSync(
      f,
      JSON.stringify(
        epsilonResult({
          status: "complete",
          units_completed: ["unit-a"],
          gate_checks: [epsilonGateCheck("unit-a", { security_reviewer: "fail" })],
        }),
      ),
    );
    const r = cp.spawnSync(process.execPath, [ENGINE, "--result", f, "--reviewers", emptyReviewers], { encoding: "utf8" });
    ok("CLI: ε override (status:complete) → exit 1 (reject)", r.status === 1, `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  }

  try { fs.rmSync(tmpDir, { recursive: true }); } catch { }
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
