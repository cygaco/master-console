#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const {
  computeFindings,
  validateIsoDate,
  LEGACY_EXEMPT_BEFORE,
  TELEMETRY_ONLY_BEFORE,
  REQUIRED_MANAGER,
  DESIGN_TOUCH_MANAGERS,
  AUTHORING_EXEMPT_BEFORE,
  AUTHORING_ROLE,
  AUTHORING_PHASES,
} = require("./sprint-manager-consult");

let passes = 0;
let failures = 0;

function ok(name, condition, detail) {
  if (condition) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    const suffix = detail ? ` — ${detail}` : "";
    console.log(`  FAIL ${name}${suffix}`);
  }
}

const FIXTURE_EXEMPT_BEFORE = "2026-06-03";
const FIXTURE_TELEMETRY_ONLY_BEFORE = "2026-06-08";
const FIXTURE_AUTHORING_EXEMPT_BEFORE = "2026-06-13";
const FX_OPTS = { telemetryOnlyBefore: FIXTURE_TELEMETRY_ONLY_BEFORE, authoringExemptBefore: FIXTURE_AUTHORING_EXEMPT_BEFORE };
const cf = (events, dates, cutoff = FIXTURE_EXEMPT_BEFORE, recs = [], opts = FX_OPTS) => computeFindings(events, dates, cutoff, recs, opts);
const POST_CUTOFF_DATE = "2026-06-05";
const PRE_CUTOFF_DATE = "2026-06-01";
const BASE_TS = "2026-06-05T10:00:00.000Z";

function makeSprintFullRec(sprintId, kind = "sprint_full_started", extra = {}) {
  return {
    id: `EVT-test-${Math.random().toString(36).slice(2)}`,
    ts: BASE_TS,
    cat: "audit",
    actor: "alpha",
    session: "s-test",
    sprint_id: sprintId,
    data: { kind, sprint_id: sprintId, ts: BASE_TS, ...extra },
  };
}

function makeManagerConsultRec(sprintId, manager, extra = {}) {
  return {
    id: `EVT-test-${Math.random().toString(36).slice(2)}`,
    ts: BASE_TS,
    cat: "manager_consult",
    actor: "system",
    session: "s-test",
    sprint_id: sprintId,
    data: {
      manager,
      mode: extra.mode || "oneshot",
      unit: extra.unit || "some-feature",
      verdict: extra.verdict || "APPROVE",
      lane2Mode: extra.lane2Mode || "block",
      ts: BASE_TS,
    },
  };
}

console.log("Module exports:");
ok("LEGACY_EXEMPT_BEFORE defaults to null (no exemption)", LEGACY_EXEMPT_BEFORE === null, `got ${LEGACY_EXEMPT_BEFORE}`);
ok("TELEMETRY_ONLY_BEFORE defaults to null (record-backed for every sprint)", TELEMETRY_ONLY_BEFORE === null, `got ${TELEMETRY_ONLY_BEFORE}`);
ok("REQUIRED_MANAGER is design-quality", REQUIRED_MANAGER === "design-quality");
ok(
  "DESIGN_TOUCH_MANAGERS includes visual-review",
  Array.isArray(DESIGN_TOUCH_MANAGERS) && DESIGN_TOUCH_MANAGERS.includes("visual-review"),
);
ok(
  "DESIGN_TOUCH_MANAGERS excludes design-quality (non-circular)",
  !DESIGN_TOUCH_MANAGERS.includes("design-quality"),
);

console.log("\n(a) MISSING-CONSULT — design-touch (visual-review) but no design-quality consult:");
{
  const sprintId = "SP-TEST-MC-MISS-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
  ];
  const r = cf(events, { [sprintId]: POST_CUTOFF_DATE });
  ok("MC-MISS: has finding", r.findings.length > 0, `got ${r.findings.length}`);
  ok(
    "MC-MISS: finding_type is missing_design_consult",
    r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  ok("MC-MISS: 1 applicable", r.applicable === 1, `got ${r.applicable}`);
  ok("MC-MISS: derived exit 1", r.findings.length > 0);
}

console.log("\n(b) PRESENT-CONSULT — design-touch + a design-quality consult → clean:");
{
  const sprintId = "SP-TEST-MC-OK-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality", { verdict: "APPROVE" }),
  ];
  const r = cf(events, { [sprintId]: POST_CUTOFF_DATE });
  ok("MC-OK: 0 findings", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("MC-OK: 1 applicable", r.applicable === 1, `got ${r.applicable}`);
  ok("MC-OK: derived exit 0", r.findings.length === 0);
}

console.log("\n(b2) PRESENT-CONSULT — design-quality REJECT verdict still counts as consulted:");
{
  const sprintId = "SP-TEST-MC-REJECT-999999";
  const events = [
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality", { verdict: "REJECT" }),
  ];
  const r = cf(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "MC-REJECT: no missing_design_consult (REJECT is still a consult)",
    !r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

console.log("\n(c) NO-DESIGN-TOUCH — sprint ran but no UI signal → not applicable:");
{
  const sprintId = "SP-TEST-MC-NOUI-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "execute" }),
  ];
  const r = cf(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "NO-UI: 0 findings (design authority not required for non-UI sprint)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
  ok("NO-UI: 0 applicable (out of scope)", r.applicable === 0, `got ${r.applicable}`);
}

console.log("\n(d) PRE-CUTOFF — design-touch + missing consult but pre-wire-date → exempt:");
{
  const sprintId = "SP-TEST-MC-LEGACY-999999";
  const events = [
    makeManagerConsultRec(sprintId, "visual-review"),
  ];
  const r = cf(events, { [sprintId]: PRE_CUTOFF_DATE });
  ok("PRE-CUTOFF: 0 findings (legacy exempt)", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("PRE-CUTOFF: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
}

console.log("\n(e) UNDATED — design-touch + missing consult but no known date → exempt:");
{
  const sprintId = "SP-TEST-MC-UNDATED-999999";
  const events = [makeManagerConsultRec(sprintId, "visual-review")];
  const r = cf(events, {});
  ok("UNDATED: 0 findings (exempted)", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("UNDATED: undatedExempt > 0", r.undatedExempt > 0, `got undatedExempt=${r.undatedExempt}`);
}

console.log("\n(f) SYNTHETIC — SP-J* sprint with missing consult → audit-exempt:");
{
  const sprintId = "SP-J9-SYNTH-991";
  const events = [makeManagerConsultRec(sprintId, "visual-review")];
  const r = cf(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "SYNTH: no findings for synthetic sprint (audit-exempt)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
}

console.log("\n(g) UI-TOUCHED FLAG — ui_touched:true on a sprint_full event is a design-touch:");
{
  const sprintId = "SP-TEST-MC-UITOUCH-999999";
  const events = [
    makeSprintFullRec(sprintId, "sprint_full_phase_completed", { phase: "execute", ui_touched: true }),
  ];
  const r = cf(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "UI-TOUCH: ui_touched:true triggers applicability",
    r.applicable === 1 && r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `applicable=${r.applicable} findings=${JSON.stringify(r.findings)}`,
  );
}

console.log("\n(h) EMPTY — no events at all:");
{
  const r = cf([], {});
  ok("EMPTY: 0 findings", r.findings.length === 0);
  ok("EMPTY: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
}

console.log("\n(i) --SINCE VALIDATION — validateIsoDate predicate:");
{
  ok("SINCE-VALID: '2026-06-04' → true", validateIsoDate("2026-06-04"));
  ok("SINCE-INVALID: 'bogus' → false", !validateIsoDate("bogus"));
  ok("SINCE-INVALID: '2026-13-01' → false", !validateIsoDate("2026-13-01"));
  ok("SINCE-INVALID: '2026-02-30' → false (V8 rollover)", !validateIsoDate("2026-02-30"));
  ok("SINCE-INVALID: '' → false", !validateIsoDate(""));
}

console.log("\n(k) RECORD-BACKED COVERAGE — from the fixture telemetry cutoff, a dispatch record is required:");

const POST_RECORD_BACKED_DATE = FIXTURE_TELEMETRY_ONLY_BEFORE;
const BACKING_RECORD_TS = BASE_TS;
const HISTORIC_RECORD_TS = "2026-01-01T00:00:00.000Z";

function makeDispatchRecord(role, completedAt, extra = {}) {
  return {
    dispatch_id: `d-test-${Math.random().toString(36).slice(2)}`,
    role,
    provider: "openai",
    model: "gpt-5.5",
    ok: true,
    started_at: completedAt,
    completed_at: completedAt,
    ...extra,
  };
}

{
  const sprintId = "SP-TEST-RB-MISS-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  const r = cf(
    events,
    { [sprintId]: POST_RECORD_BACKED_DATE },
    FIXTURE_EXEMPT_BEFORE,
    [],
  );
  ok(
    "k1: post-cutoff + telemetry-only → RED (missing_design_consult)",
    r.findings.length > 0 && r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `findings=${JSON.stringify(r.findings)}`,
  );
  ok("k1: applicable=1", r.applicable === 1, `got ${r.applicable}`);
}

{
  const sprintId = "SP-TEST-RB-OK-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  const backingRecord = makeDispatchRecord("design-quality", BACKING_RECORD_TS);
  const r = cf(
    events,
    { [sprintId]: POST_RECORD_BACKED_DATE },
    FIXTURE_EXEMPT_BEFORE,
    [backingRecord],
  );
  ok(
    "k2: post-cutoff + telemetry + in-window record → GREEN (0 findings)",
    r.findings.length === 0,
    `findings=${JSON.stringify(r.findings)}`,
  );
  ok("k2: applicable=1", r.applicable === 1, `got ${r.applicable}`);
}

{
  const sprintId = "SP-TEST-RB-HISTORIC-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  const historicRecord = makeDispatchRecord("design-quality", HISTORIC_RECORD_TS);
  const r = cf(
    events,
    { [sprintId]: POST_RECORD_BACKED_DATE },
    FIXTURE_EXEMPT_BEFORE,
    [historicRecord],
  );
  ok(
    "k2b: post-cutoff + telemetry + historic-only record (outside sprint window) → RED",
    r.findings.length > 0 && r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `findings=${JSON.stringify(r.findings)}`,
  );
}

{
  const sprintId = "SP-TEST-RB-LEGACY-999999";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  const r = cf(
    events,
    { [sprintId]: POST_CUTOFF_DATE },
    FIXTURE_EXEMPT_BEFORE,
    [],
  );
  ok(
    "k3: between the fixture cutoffs, telemetry-only → GREEN (legacy predicate)",
    r.findings.length === 0,
    `findings=${JSON.stringify(r.findings)}`,
  );
}

console.log("\n(j) CLI EXIT CODES — subprocess tests:");
{
  const ENGINE = path.join(__dirname, "sprint-manager-consult.js");

  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--since", "bogus"], { encoding: "utf8" });
    ok("CLI-EXIT: --since bogus → exit 2", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
  }

  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--since"], { encoding: "utf8" });
    ok("CLI-EXIT: --since (no value) → exit 2", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
  }

  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-smc-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    fs.writeFileSync(tmpEvents, "");
    const r = cp.spawnSync(process.execPath, [ENGINE], {
      encoding: "utf8",
      env: { ...process.env, ...mcEnv.envPair("EVENTS_FILE", tmpEvents), ...mcEnv.envPair("SPRINT_DATES_JSON", "{}") },
    });
    ok(
      "CLI-EXIT: empty events → exit 0 (graceful-empty)",
      r.status === 0,
      `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`,
    );
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { }
  }

  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-smc-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    const sprintId = "SP-CLI-MC-FINDING-991";
    const evt = {
      id: "EVT-cli-mc-001",
      ts: BASE_TS,
      cat: "manager_consult",
      actor: "system",
      session: "s-cli",
      sprint_id: sprintId,
      data: { manager: "visual-review", mode: "oneshot", unit: "u", ts: BASE_TS },
    };
    fs.writeFileSync(tmpEvents, JSON.stringify(evt) + "\n");
    const r = cp.spawnSync(process.execPath, [ENGINE], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...mcEnv.envPair("EVENTS_FILE", tmpEvents),
        ...mcEnv.envPair("SPRINT_DATES_JSON", JSON.stringify({ [sprintId]: POST_CUTOFF_DATE })),
      },
    });
    ok(
      "CLI-EXIT: design-touch + no design-quality consult → exit 1 (finding)",
      r.status === 1,
      `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`,
    );
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { }
  }

  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-smc-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    const sprintId = "SP-CLI-MC-CLEAN-991";
    const lines = [
      {
        id: "EVT-cli-mc-vr", ts: BASE_TS, cat: "manager_consult", actor: "system", session: "s",
        sprint_id: sprintId, data: { manager: "visual-review", ts: BASE_TS },
      },
      {
        id: "EVT-cli-mc-dq", ts: BASE_TS, cat: "manager_consult", actor: "system", session: "s",
        sprint_id: sprintId, data: { manager: "design-quality", verdict: "APPROVE", ts: BASE_TS },
      },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n";
    fs.writeFileSync(tmpEvents, lines);
    const r = cp.spawnSync(process.execPath, [ENGINE, "--telemetry-only-before", FIXTURE_TELEMETRY_ONLY_BEFORE], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...mcEnv.envPair("EVENTS_FILE", tmpEvents),
        ...mcEnv.envPair("SPRINT_DATES_JSON", JSON.stringify({ [sprintId]: POST_CUTOFF_DATE })),
      },
    });
    ok(
      "CLI-EXIT: design-touch + design-quality consult → exit 0 (clean)",
      r.status === 0,
      `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`,
    );
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { }
  }
}

console.log("\n(pl) PRODUCT-LEAD AUTHORING COVERAGE (report-only):");

const POST_AUTHORING_DATE = FIXTURE_AUTHORING_EXEMPT_BEFORE;
const PRE_AUTHORING_DATE = "2026-06-11";

function makePhaseEventRec(sprintId, phase) {
  return makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase });
}

{
  const sprintId = "SP-TEST-PLA-MISS-999999";
  const events = [makePhaseEventRec(sprintId, "plan")];
  const r = cf(events, { [sprintId]: POST_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, []);
  ok(
    "pl1: post-cutoff plan artifact + no product-lead record → advisory fires",
    (r.advisoryFindings || []).some((f) => f.finding_type === "missing_product_lead_authoring"),
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
  ok("pl1: applicable=1", r.applicable === 1, `got ${r.applicable}`);
  ok("pl1: report-only — 0 BLOCKING findings", r.findings.length === 0, `findings=${JSON.stringify(r.findings)}`);
}

{
  const sprintId = "SP-TEST-PLA-HIST-999999";
  const events = [makePhaseEventRec(sprintId, "design")];
  const histRecord = makeDispatchRecord("product-lead", HISTORIC_RECORD_TS, { sprint_id: sprintId, step: "design" });
  const r = cf(events, { [sprintId]: POST_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, [histRecord]);
  ok(
    "pl2: design artifact + only historic (out-of-window) product-lead record → advisory fires",
    (r.advisoryFindings || []).some((f) => f.finding_type === "missing_product_lead_authoring"),
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

{
  const sprintId = "SP-TEST-PLA-OK-999999";
  const events = [makePhaseEventRec(sprintId, "plan")];
  const record = makeDispatchRecord("product-lead", BASE_TS, { sprint_id: sprintId, step: "plan" });
  const r = cf(events, { [sprintId]: POST_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, [record]);
  ok(
    "pl3: plan artifact + in-window product-lead record → 0 advisory (compliant greens)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
  ok("pl3: applicable=1", r.applicable === 1, `got ${r.applicable}`);
}

{
  const sprintId = "SP-TEST-PLA-SOLO-999999";
  const events = [makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "execute" })];
  const r = cf(events, { [sprintId]: POST_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, []);
  ok(
    "pl4: no plan/design phase event (solo shape) + no record → 0 advisory via in-scope carve-out (NOT circular)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
  ok("pl4: solo sprint NOT counted applicable (out of scope)", r.applicable === 0, `got ${r.applicable}`);
}

{
  const sprintId = "SP-TEST-PLA-PRE-999999";
  const events = [makePhaseEventRec(sprintId, "plan")];
  const r = cf(events, { [sprintId]: PRE_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, []);
  ok(
    "pl5: plan artifact before the authoring cutoff + no record → exempt, 0 advisory",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

{
  const sprintA = "SP-TEST-PLA-ISO-A";
  const sprintB = "SP-TEST-PLA-ISO-B";
  const events = [makePhaseEventRec(sprintA, "plan"), makePhaseEventRec(sprintB, "plan")];
  const recordA = makeDispatchRecord("product-lead", BASE_TS, { sprint_id: sprintA, step: "plan" });
  const r = cf(
    events,
    { [sprintA]: POST_AUTHORING_DATE, [sprintB]: POST_AUTHORING_DATE },
    FIXTURE_EXEMPT_BEFORE,
    [recordA],
  );
  const advA = (r.advisoryFindings || []).filter((f) => f.sprint_id === sprintA);
  const advB = (r.advisoryFindings || []).filter((f) => f.sprint_id === sprintB);
  ok(
    "pl6: sprint_id isolation — A (has record) greens, B (no record) fires; A's record does NOT green B",
    advA.length === 0 && advB.length === 1,
    `advA=${JSON.stringify(advA)} advB=${JSON.stringify(advB)}`,
  );
  ok("pl6: applicable=2 (both in-scope)", r.applicable === 2, `got ${r.applicable}`);
}

{
  const sprintId = "SP-TEST-PLA-WL-999999";
  const events = [
    makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "replan" }),
    makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "design-review" }),
  ];
  const r = cf(events, { [sprintId]: POST_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, []);
  ok(
    "pl-wl: phase 'replan'/'design-review' does NOT trip the signal (whitelist, not loose substring)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

{
  const sprintId = "SP-TEST-PLA-NOCROSS-999999";
  const events = [makeSprintFullRec(sprintId), makeManagerConsultRec(sprintId, "visual-review")];
  const r = cf(events, { [sprintId]: POST_AUTHORING_DATE }, FIXTURE_EXEMPT_BEFORE, []);
  ok(
    "pl-nocross: design-touch-only sprint (no plan/design phase event) → 0 authoring advisory (no cross-contamination)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

console.log("\n(pl-shape) module exports:");
ok("AUTHORING_EXEMPT_BEFORE defaults to null (no exemption)", AUTHORING_EXEMPT_BEFORE === null, `got ${AUTHORING_EXEMPT_BEFORE}`);
{
  const sid = "SP-TEST-FRESH-999999";
  const ev = [makeSprintFullRec(sid), makeManagerConsultRec(sid, "visual-review"), makeManagerConsultRec(sid, "design-quality"), makePhaseEventRec(sid, "plan")];
  const r = computeFindings(ev, { [sid]: PRE_CUTOFF_DATE });
  ok("FRESH-DEFAULT: a pre-dated design-touch sprint is applicable", r.applicable === 1, `got ${r.applicable}`);
  ok("FRESH-DEFAULT: telemetry alone is not enough (record-backed) → missing_design_consult", r.findings.some((f) => f.finding_type === "missing_design_consult"), JSON.stringify(r.findings));
  ok("FRESH-DEFAULT: the authoring pass audits it too → advisory", (r.advisoryFindings || []).some((f) => f.finding_type === "missing_product_lead_authoring"), JSON.stringify(r.advisoryFindings));
}
ok("AUTHORING_ROLE is product-lead", AUTHORING_ROLE === "product-lead", `got ${AUTHORING_ROLE}`);
ok(
  "AUTHORING_PHASES whitelists plan + design",
  Array.isArray(AUTHORING_PHASES) && AUTHORING_PHASES.includes("plan") && AUTHORING_PHASES.includes("design"),
);
ok(
  "AUTHORING_PHASES excludes execute/replan (bounded whitelist)",
  !AUTHORING_PHASES.includes("execute") && !AUTHORING_PHASES.includes("replan"),
);

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
