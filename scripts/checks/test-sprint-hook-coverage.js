#!/usr/bin/env node
"use strict";

const { computeFindings, reverseCoverage, LEGACY_EXEMPT_BEFORE, TELEMETRY_ONLY_BEFORE } = require("./sprint-hook-coverage");
const FIXTURE_EXEMPT_BEFORE = "2026-06-03";
const FIXTURE_TELEMETRY_ONLY_BEFORE = "2026-06-08";
const TELEM = { telemetryOnlyBefore: FIXTURE_TELEMETRY_ONLY_BEFORE };
const hookPoints = require("../sprint/hook-points");

let passes = 0, failures = 0;
function ok(name, cond, detail) {
  if (cond) { passes++; console.log(`  ok  ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const REG = {
  rows: [
    { role: "qa-reviewer", step: "gauntlet", condition: "always", mode: "block", order: 10 },
    { role: "frontend-reviewer", step: "gauntlet", condition: { unit_type: ["frontend"] }, mode: "block", order: 20 },
    { role: "design-quality", step: "gauntlet", condition: { unit_type: ["frontend"] }, mode: "advisory", order: 30 },
  ],
};
const FE = { unit_types: ["frontend"], max_risk: "high", domains: [] };
const run = (sid) => ({ cat: "audit", sprint_id: sid, data: { kind: "sprint_full_phase_started" } });
const consult = (sid, mgr) => ({ cat: "manager_consult", sprint_id: sid, data: { manager: mgr, verdict: "consulted" } });

console.log("FORWARD coverage:");
{
  const events = [run("SP-A"), consult("SP-A", "qa-reviewer"), consult("SP-A", "frontend-reviewer")];
  const r = computeFindings(events, REG, { "SP-A": FE }, { "SP-A": "2026-06-06" }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
  ok("all block agents ran → 0 findings", r.findings.length === 0, JSON.stringify(r.findings));
  ok("advisory-not-run (design-quality) → info, not a finding", r.info.some((i) => i.role === "design-quality"));
  ok("sprint counted applicable+checked", r.applicable === 1 && r.checked === 1);
}
{
  const events = [run("SP-B"), consult("SP-B", "frontend-reviewer")];
  const r = computeFindings(events, REG, { "SP-B": FE }, { "SP-B": "2026-06-06" }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
  ok("missing block agent → finding", r.findings.length === 1 && r.findings[0].role === "qa-reviewer", JSON.stringify(r.findings));
  ok("finding_type missing_block_agent", r.findings[0].finding_type === "missing_block_agent");
}

console.log("\nexemptions:");
{
  const r = computeFindings([run("SP-C"), consult("SP-C", "frontend-reviewer")], REG, { "SP-C": FE }, { "SP-C": "2026-06-01" }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
  ok("pre-cutoff sprint exempt (not applicable)", r.applicable === 0 && r.findings.length === 0);
}
{
  const r = computeFindings([run("SP-J1"), consult("SP-J1", "frontend-reviewer")], REG, { "SP-J1": FE }, { "SP-J1": "2026-06-06" }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
  ok("synthetic sprint (SP-J*) exempt", r.applicable === 0);
}
{
  const r = computeFindings([run("SP-D"), consult("SP-D", "frontend-reviewer")], REG, { "SP-D": FE }, {}, FIXTURE_EXEMPT_BEFORE, [], TELEM);
  ok("undated sprint exempt (undatedExempt)", r.applicable === 0 && r.undatedExempt === 1);
}
{
  const r = computeFindings([consult("SP-E", "frontend-reviewer")], REG, { "SP-E": FE }, { "SP-E": "2026-06-06" }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
  ok("consult without a run marker → not applicable", r.applicable === 0);
}

console.log("\nRECORD-BACKED COVERAGE:");
{
  const EV_TS = "2026-06-06T10:00:00.000Z";
  const HISTORIC_TS = "2026-01-01T00:00:00.000Z";

  const makeRec = (sid) => ({ cat: "audit", sprint_id: sid, ts: EV_TS, data: { kind: "sprint_full_phase_started", ts: EV_TS } });
  const makeC = (sid, mgr) => ({ cat: "manager_consult", sprint_id: sid, ts: EV_TS, data: { manager: mgr, ts: EV_TS } });
  const makeDispatch = (role, completedAt) => ({
    dispatch_id: "d-hookcov-test",
    role,
    provider: "openai",
    model: "gpt-5.5",
    ok: true,
    started_at: completedAt,
    completed_at: completedAt,
  });

  {
    const events = [makeRec("SP-HOOKCOV-A"), makeC("SP-HOOKCOV-A", "qa-reviewer"), makeC("SP-HOOKCOV-A", "frontend-reviewer")];
    const r = computeFindings(events, REG, { "SP-HOOKCOV-A": FE }, { "SP-HOOKCOV-A": FIXTURE_TELEMETRY_ONLY_BEFORE }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
    ok("telemetry-only block row after cutoff → finding", r.findings.length >= 1, JSON.stringify(r.findings));
    ok("telemetry-only block row: finding_type missing_block_agent", r.findings.every((f) => f.finding_type === "missing_block_agent"));
  }

  {
    const events = [makeRec("SP-HOOKCOV-B"), makeC("SP-HOOKCOV-B", "qa-reviewer"), makeC("SP-HOOKCOV-B", "frontend-reviewer")];
    const dispatch = [makeDispatch("qa-reviewer", EV_TS), makeDispatch("frontend-reviewer", EV_TS)];
    const r = computeFindings(events, REG, { "SP-HOOKCOV-B": FE }, { "SP-HOOKCOV-B": FIXTURE_TELEMETRY_ONLY_BEFORE }, FIXTURE_EXEMPT_BEFORE, dispatch, { requireSignature: false, ...TELEM });
    ok("block row after cutoff with in-window records → 0 findings", r.findings.length === 0, JSON.stringify(r.findings));
  }

  {
    const events = [makeRec("SP-HOOKCOV-BH"), makeC("SP-HOOKCOV-BH", "qa-reviewer"), makeC("SP-HOOKCOV-BH", "frontend-reviewer")];
    const dispatch = [makeDispatch("qa-reviewer", HISTORIC_TS), makeDispatch("frontend-reviewer", HISTORIC_TS)];
    const r = computeFindings(events, REG, { "SP-HOOKCOV-BH": FE }, { "SP-HOOKCOV-BH": FIXTURE_TELEMETRY_ONLY_BEFORE }, FIXTURE_EXEMPT_BEFORE, dispatch, { requireSignature: false, ...TELEM });
    ok("after cutoff with only historic records (outside window) → finding", r.findings.length >= 1, JSON.stringify(r.findings));
  }

  {
    const events = [makeRec("SP-HOOKCOV-C"), makeC("SP-HOOKCOV-C", "qa-reviewer"), makeC("SP-HOOKCOV-C", "frontend-reviewer")];
    const r = computeFindings(events, REG, { "SP-HOOKCOV-C": FE }, { "SP-HOOKCOV-C": "2026-06-06" }, FIXTURE_EXEMPT_BEFORE, [], TELEM);
    ok("cutoff window: between the fixture cutoffs, telemetry-only → green (legacy predicate)", r.findings.length === 0, JSON.stringify(r.findings));
  }
}

console.log("\nfresh-install defaults:");
{
  ok("LEGACY_EXEMPT_BEFORE defaults to null (no exemption)", LEGACY_EXEMPT_BEFORE === null);
  ok("TELEMETRY_ONLY_BEFORE defaults to null (record-backed for every sprint)", TELEMETRY_ONLY_BEFORE === null);
  const pre = computeFindings([run("SP-FRESH1"), consult("SP-FRESH1", "qa-reviewer"), consult("SP-FRESH1", "frontend-reviewer")], REG, { "SP-FRESH1": FE }, { "SP-FRESH1": "2026-06-01" });
  ok("default: a sprint dated before any former cutoff is applicable", pre.applicable === 1, JSON.stringify(pre));
  ok("default: telemetry-only block rows need a backing record → finding", pre.findings.length >= 1, JSON.stringify(pre.findings));
}

console.log("\nREVERSE coverage:");
{
  const realReg = hookPoints.load();
  const realIds = hookPoints.loadRoleIds();
  ok("shipped registry is structurally coherent", reverseCoverage(realReg, realIds).ok);
  const broken = { rows: [{ role: "ghost", step: "plan", condition: "always", mode: "block", order: 1 }] };
  ok("broken registry (unknown role + orphan steps) → FAIL", !reverseCoverage(broken, realIds).ok);
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
