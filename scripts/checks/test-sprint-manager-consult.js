#!/usr/bin/env node
/**
 * scripts/checks/test-sprint-manager-consult.js
 *
 * Fixture-driven tests for the sprint-manager-consult check engine (ADR-0007
 * Tier-4 GAP 1 coverage enforcer). Drives computeFindings() directly with
 * in-memory event records — no live events.jsonl dependency — plus subprocess
 * tests for the CLI exit codes.
 *
 * Scenarios:
 *   (a) MISSING-CONSULT — design-touch signal, NO design-quality consult → fail
 *   (b) PRESENT-CONSULT — design-touch signal + design-quality consult → pass
 *   (c) NO-DESIGN-TOUCH — sprint with no UI signal → not applicable (0 findings)
 *   (d) PRE-CUTOFF      — design-touch + missing consult but pre-cutoff → exempt
 *   (e) UNDATED         — design-touch + missing consult but no known date → exempt
 *   (f) SYNTHETIC       — SP-J* synthetic sprint → exempt from live audit
 *   (g) UI-TOUCHED FLAG — ui_touched:true on a sprint_full event is a design-touch
 *   (h) EMPTY           — no events → graceful (applicable 0)
 *   CLI: empty→exit 0; missing-consult→exit 1; bad --since→exit 2; present→exit 0
 *
 * Exit: 0 iff all tests pass, 1 otherwise.
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const {
  computeFindings,
  validateIsoDate,
  WIRE_DATE,
  RECORD_BACKED_CUTOFF,
  REQUIRED_MANAGER,
  DESIGN_TOUCH_MANAGERS,
  AUTHORING_CUTOFF,
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

// ── Fixture helpers ───────────────────────────────────────────────────────────

const POST_CUTOFF_DATE = "2026-06-05"; // day AFTER WIRE_DATE → applicable
const PRE_CUTOFF_DATE = "2026-06-01"; // before WIRE_DATE → exempt
const BASE_TS = "2026-06-05T10:00:00.000Z";

/** A sprint_full_* audit event (logger: cat="audit", data={kind,...}). */
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

/** A manager_consult event (logger: cat="manager_consult", data={manager,...}). */
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

// ── Module shape sanity ───────────────────────────────────────────────────────

console.log("Module exports:");
ok("WIRE_DATE is 2026-06-04", WIRE_DATE === "2026-06-04", `got ${WIRE_DATE}`);
ok("RECORD_BACKED_CUTOFF is 2026-06-10", RECORD_BACKED_CUTOFF === "2026-06-10", `got ${RECORD_BACKED_CUTOFF}`);
ok("REQUIRED_MANAGER is design-quality", REQUIRED_MANAGER === "design-quality");
ok(
  "DESIGN_TOUCH_MANAGERS includes visual-review",
  Array.isArray(DESIGN_TOUCH_MANAGERS) && DESIGN_TOUCH_MANAGERS.includes("visual-review"),
);
ok(
  "DESIGN_TOUCH_MANAGERS excludes design-quality (non-circular)",
  !DESIGN_TOUCH_MANAGERS.includes("design-quality"),
);

// ── (a) MISSING-CONSULT ───────────────────────────────────────────────────────

console.log("\n(a) MISSING-CONSULT — design-touch (visual-review) but no design-quality consult:");
{
  const sprintId = "SP-TEST-MC-MISS-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"), // design-touch signal
    // NO design-quality consult
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok("MC-MISS: has finding", r.findings.length > 0, `got ${r.findings.length}`);
  ok(
    "MC-MISS: finding_type is missing_design_consult",
    r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  ok("MC-MISS: 1 applicable", r.applicable === 1, `got ${r.applicable}`);
  ok("MC-MISS: derived exit 1", r.findings.length > 0);
}

// ── (b) PRESENT-CONSULT ───────────────────────────────────────────────────────

console.log("\n(b) PRESENT-CONSULT — design-touch + a design-quality consult → clean:");
{
  const sprintId = "SP-TEST-MC-OK-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"), // design-touch signal
    makeManagerConsultRec(sprintId, "design-quality", { verdict: "APPROVE" }),
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok("MC-OK: 0 findings", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("MC-OK: 1 applicable", r.applicable === 1, `got ${r.applicable}`);
  ok("MC-OK: derived exit 0", r.findings.length === 0);
}

console.log("\n(b2) PRESENT-CONSULT — design-quality REJECT verdict still counts as consulted:");
{
  // A REJECT consult is still a CONSULT — the authority ran. (Whether the run shipped
  // despite REJECT is a different enforcer's concern; coverage only asks "did it run".)
  const sprintId = "SP-TEST-MC-REJECT-001";
  const events = [
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality", { verdict: "REJECT" }),
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "MC-REJECT: no missing_design_consult (REJECT is still a consult)",
    !r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

// ── (c) NO-DESIGN-TOUCH ───────────────────────────────────────────────────────

console.log("\n(c) NO-DESIGN-TOUCH — sprint ran but no UI signal → not applicable:");
{
  const sprintId = "SP-TEST-MC-NOUI-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "execute" }),
    // no visual-review, no ui_touched, no design-quality → non-UI sprint
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "NO-UI: 0 findings (design authority not required for non-UI sprint)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
  ok("NO-UI: 0 applicable (out of scope)", r.applicable === 0, `got ${r.applicable}`);
}

// ── (d) PRE-CUTOFF ────────────────────────────────────────────────────────────

console.log("\n(d) PRE-CUTOFF — design-touch + missing consult but pre-wire-date → exempt:");
{
  const sprintId = "SP-TEST-MC-LEGACY-001";
  const events = [
    makeManagerConsultRec(sprintId, "visual-review"), // design-touch
    // missing design-quality consult — but the sprint predates the wiring
  ];
  const r = computeFindings(events, { [sprintId]: PRE_CUTOFF_DATE });
  ok("PRE-CUTOFF: 0 findings (legacy exempt)", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("PRE-CUTOFF: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
}

// ── (e) UNDATED ───────────────────────────────────────────────────────────────

console.log("\n(e) UNDATED — design-touch + missing consult but no known date → exempt:");
{
  const sprintId = "SP-TEST-MC-UNDATED-001";
  const events = [makeManagerConsultRec(sprintId, "visual-review")];
  const r = computeFindings(events, {}); // no date for this sprint
  ok("UNDATED: 0 findings (exempted)", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("UNDATED: undatedExempt > 0", r.undatedExempt > 0, `got undatedExempt=${r.undatedExempt}`);
}

// ── (f) SYNTHETIC ─────────────────────────────────────────────────────────────

console.log("\n(f) SYNTHETIC — SP-J* sprint with missing consult → audit-exempt:");
{
  const sprintId = "SP-J9-SYNTH-001";
  const events = [makeManagerConsultRec(sprintId, "visual-review")];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "SYNTH: no findings for synthetic sprint (audit-exempt)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
}

// ── (g) UI-TOUCHED FLAG ───────────────────────────────────────────────────────

console.log("\n(g) UI-TOUCHED FLAG — ui_touched:true on a sprint_full event is a design-touch:");
{
  const sprintId = "SP-TEST-MC-UITOUCH-001";
  const events = [
    makeSprintFullRec(sprintId, "sprint_full_phase_completed", { phase: "execute", ui_touched: true }),
    // ui_touched signal present, no design-quality consult → finding
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "UI-TOUCH: ui_touched:true triggers applicability",
    r.applicable === 1 && r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `applicable=${r.applicable} findings=${JSON.stringify(r.findings)}`,
  );
}

// ── (h) EMPTY ─────────────────────────────────────────────────────────────────

console.log("\n(h) EMPTY — no events at all:");
{
  const r = computeFindings([], {});
  ok("EMPTY: 0 findings", r.findings.length === 0);
  ok("EMPTY: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
}

// ── (i) --SINCE VALIDATION ────────────────────────────────────────────────────

console.log("\n(i) --SINCE VALIDATION — validateIsoDate predicate:");
{
  ok("SINCE-VALID: '2026-06-04' → true", validateIsoDate("2026-06-04"));
  ok("SINCE-INVALID: 'bogus' → false", !validateIsoDate("bogus"));
  ok("SINCE-INVALID: '2026-13-01' → false", !validateIsoDate("2026-13-01"));
  ok("SINCE-INVALID: '2026-02-30' → false (V8 rollover)", !validateIsoDate("2026-02-30"));
  ok("SINCE-INVALID: '' → false", !validateIsoDate(""));
}

// ── (k) F-1 RECORD-BACKED COVERAGE (E-DISPATCH-INTEGRITY-001) ────────────────
// Three planted fixtures:
//   k1 — post-RECORD_BACKED_CUTOFF sprint, telemetry-only (no dispatch record) → RED
//   k2 — post-RECORD_BACKED_CUTOFF sprint, telemetry + in-window dispatch record → GREEN
//   k3 — between WIRE_DATE and RECORD_BACKED_CUTOFF, telemetry-only → GREEN (legacy predicate)

console.log("\n(k) F-1 RECORD-BACKED COVERAGE — post-2026-06-10 requires dispatch record:");

const POST_RECORD_BACKED_DATE = RECORD_BACKED_CUTOFF; // "2026-06-10" — at the cutoff boundary
const BACKING_RECORD_TS = BASE_TS; // same as event ts → falls within sprint window
const HISTORIC_RECORD_TS = "2026-01-01T00:00:00.000Z"; // way before events → outside window

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

// k1 — post-cutoff, telemetry consult present, NO backing dispatch record → RED
{
  const sprintId = "SP-TEST-RB-MISS-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"), // design-touch signal
    makeManagerConsultRec(sprintId, "design-quality"), // telemetry says consulted
  ];
  const r = computeFindings(
    events,
    { [sprintId]: POST_RECORD_BACKED_DATE },
    WIRE_DATE,
    [], // no dispatch records
  );
  ok(
    "k1: post-cutoff + telemetry-only → RED (missing_design_consult)",
    r.findings.length > 0 && r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `findings=${JSON.stringify(r.findings)}`,
  );
  ok("k1: applicable=1", r.applicable === 1, `got ${r.applicable}`);
}

// k2 — post-cutoff, telemetry consult + in-window backing dispatch record → GREEN
{
  const sprintId = "SP-TEST-RB-OK-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  const backingRecord = makeDispatchRecord("design-quality", BACKING_RECORD_TS);
  const r = computeFindings(
    events,
    { [sprintId]: POST_RECORD_BACKED_DATE },
    WIRE_DATE,
    [backingRecord],
  );
  ok(
    "k2: post-cutoff + telemetry + in-window record → GREEN (0 findings)",
    r.findings.length === 0,
    `findings=${JSON.stringify(r.findings)}`,
  );
  ok("k2: applicable=1", r.applicable === 1, `got ${r.applicable}`);
}

// k2b — post-cutoff, backing record is ONLY historic (before sprint window) → RED
{
  const sprintId = "SP-TEST-RB-HISTORIC-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  const historicRecord = makeDispatchRecord("design-quality", HISTORIC_RECORD_TS);
  const r = computeFindings(
    events,
    { [sprintId]: POST_RECORD_BACKED_DATE },
    WIRE_DATE,
    [historicRecord],
  );
  ok(
    "k2b: post-cutoff + telemetry + historic-only record (outside sprint window) → RED",
    r.findings.length > 0 && r.findings.some((f) => f.finding_type === "missing_design_consult"),
    `findings=${JSON.stringify(r.findings)}`,
  );
}

// k3 — sprint date between WIRE_DATE and RECORD_BACKED_CUTOFF → old predicate (no record needed)
{
  const sprintId = "SP-TEST-RB-LEGACY-001";
  const events = [
    makeSprintFullRec(sprintId),
    makeManagerConsultRec(sprintId, "visual-review"),
    makeManagerConsultRec(sprintId, "design-quality"),
  ];
  // No backing records — should still pass (old predicate)
  const r = computeFindings(
    events,
    { [sprintId]: POST_CUTOFF_DATE }, // "2026-06-05" — after WIRE_DATE, before RECORD_BACKED_CUTOFF
    WIRE_DATE,
    [], // no dispatch records — legacy predicate, not required
  );
  ok(
    "k3: between WIRE_DATE and RECORD_BACKED_CUTOFF, telemetry-only → GREEN (legacy predicate)",
    r.findings.length === 0,
    `findings=${JSON.stringify(r.findings)}`,
  );
}

// ── (j) CLI EXIT CODES — subprocess tests ────────────────────────────────────

console.log("\n(j) CLI EXIT CODES — subprocess tests:");
{
  const ENGINE = path.join(__dirname, "sprint-manager-consult.js");

  // Test 1: --since bogus → exit 2 (fail-closed)
  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--since", "bogus"], { encoding: "utf8" });
    ok("CLI-EXIT: --since bogus → exit 2", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
  }

  // Test 2: --since with no value → exit 2
  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--since"], { encoding: "utf8" });
    ok("CLI-EXIT: --since (no value) → exit 2", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
  }

  // Test 3: empty events → exit 0 (graceful-empty)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wos-smc-"));
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
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }

  // Test 4: design-touch + missing consult → exit 1 (finding)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wos-smc-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    const sprintId = "SP-CLI-MC-FINDING-001";
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
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }

  // Test 5: design-touch + design-quality consult present → exit 0 (clean)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wos-smc-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    const sprintId = "SP-CLI-MC-CLEAN-001";
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
    const r = cp.spawnSync(process.execPath, [ENGINE], {
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
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
}

// ── (pl) ED-051 PRODUCT-LEAD AUTHORING COVERAGE (report-only advisory) ──────────
//   pl1 — post-cutoff plan artifact, NO product-lead record → advisory fires (report-only)
//   pl2 — design artifact, product-lead record only HISTORIC (out-of-window) → fires
//   pl3 — plan artifact + in-window product-lead record → GREEN (compliant)
//   pl4 — NO plan/design phase event (solo shape) → GREEN via in-scope carve-out (non-circular)
//   pl5 — pre-AUTHORING_CUTOFF plan artifact + no record → exempt
//   pl6 — sprint_id ISOLATION: A (record) greens, B (no record) fires; no cross-green
//   pl-wl — whitelist: phase "replan"/"design-review" must NOT trip the signal
//   pl-nocross — design-touch-only sprint (no plan/design phase event) → 0 authoring advisory

console.log("\n(pl) ED-051 PRODUCT-LEAD AUTHORING COVERAGE (report-only):");

const POST_AUTHORING_DATE = AUTHORING_CUTOFF; // "2026-06-12" — at the cutoff boundary → applicable
const PRE_AUTHORING_DATE = "2026-06-11"; // before AUTHORING_CUTOFF → exempt

/** A sprint_full PHASE event (the in-scope authoring signal). */
function makePhaseEventRec(sprintId, phase) {
  return makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase });
}

// pl1 — post-cutoff plan artifact, NO product-lead record → advisory fires (NOT blocking)
{
  const sprintId = "SP-TEST-PLA-MISS-001";
  const events = [makePhaseEventRec(sprintId, "plan")];
  const r = computeFindings(events, { [sprintId]: POST_AUTHORING_DATE }, WIRE_DATE, []);
  ok(
    "pl1: post-cutoff plan artifact + no product-lead record → advisory fires",
    (r.advisoryFindings || []).some((f) => f.finding_type === "missing_product_lead_authoring"),
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
  ok("pl1: applicable=1", r.applicable === 1, `got ${r.applicable}`);
  ok("pl1: report-only — 0 BLOCKING findings", r.findings.length === 0, `findings=${JSON.stringify(r.findings)}`);
}

// pl2 — design artifact, product-lead record only HISTORIC (outside sprint window) → fires
{
  const sprintId = "SP-TEST-PLA-HIST-001";
  const events = [makePhaseEventRec(sprintId, "design")];
  const histRecord = makeDispatchRecord("product-lead", HISTORIC_RECORD_TS, { sprint_id: sprintId, step: "design" });
  const r = computeFindings(events, { [sprintId]: POST_AUTHORING_DATE }, WIRE_DATE, [histRecord]);
  ok(
    "pl2: design artifact + only historic (out-of-window) product-lead record → advisory fires",
    (r.advisoryFindings || []).some((f) => f.finding_type === "missing_product_lead_authoring"),
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

// pl3 — plan artifact + in-window product-lead record → GREEN (β negative (a))
{
  const sprintId = "SP-TEST-PLA-OK-001";
  const events = [makePhaseEventRec(sprintId, "plan")];
  const record = makeDispatchRecord("product-lead", BASE_TS, { sprint_id: sprintId, step: "plan" });
  const r = computeFindings(events, { [sprintId]: POST_AUTHORING_DATE }, WIRE_DATE, [record]);
  ok(
    "pl3: plan artifact + in-window product-lead record → 0 advisory (compliant greens)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
  ok("pl3: applicable=1", r.applicable === 1, `got ${r.applicable}`);
}

// pl4 — NO plan/design phase event (the solo shape) → GREEN via in-scope carve-out (β negative (b))
{
  const sprintId = "SP-TEST-PLA-SOLO-001";
  // solo α one-offs never run /sprint:full plan/design phases → only an execute event (or none)
  const events = [makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "execute" })];
  const r = computeFindings(events, { [sprintId]: POST_AUTHORING_DATE }, WIRE_DATE, []);
  ok(
    "pl4: no plan/design phase event (solo shape) + no record → 0 advisory via in-scope carve-out (NOT circular)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
  ok("pl4: solo sprint NOT counted applicable (out of scope)", r.applicable === 0, `got ${r.applicable}`);
}

// pl5 — pre-AUTHORING_CUTOFF plan artifact + no record → exempt
{
  const sprintId = "SP-TEST-PLA-PRE-001";
  const events = [makePhaseEventRec(sprintId, "plan")];
  const r = computeFindings(events, { [sprintId]: PRE_AUTHORING_DATE }, WIRE_DATE, []);
  ok(
    "pl5: pre-AUTHORING_CUTOFF plan artifact + no record → exempt, 0 advisory",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

// pl6 — sprint_id ISOLATION: A (record) greens, B (no record) fires; A's record never greens B
{
  const sprintA = "SP-TEST-PLA-ISO-A";
  const sprintB = "SP-TEST-PLA-ISO-B";
  const events = [makePhaseEventRec(sprintA, "plan"), makePhaseEventRec(sprintB, "plan")];
  const recordA = makeDispatchRecord("product-lead", BASE_TS, { sprint_id: sprintA, step: "plan" });
  const r = computeFindings(
    events,
    { [sprintA]: POST_AUTHORING_DATE, [sprintB]: POST_AUTHORING_DATE },
    WIRE_DATE,
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

// pl-wl — whitelist: phase "replan"/"design-review" must NOT trip the in-scope signal (β rider #1)
{
  const sprintId = "SP-TEST-PLA-WL-001";
  const events = [
    makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "replan" }),
    makeSprintFullRec(sprintId, "sprint_full_phase_started", { phase: "design-review" }),
  ];
  const r = computeFindings(events, { [sprintId]: POST_AUTHORING_DATE }, WIRE_DATE, []);
  ok(
    "pl-wl: phase 'replan'/'design-review' does NOT trip the signal (whitelist, not loose substring)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

// pl-nocross — a design-touch-only sprint (no plan/design phase event) must NOT trip authoring advisory
{
  const sprintId = "SP-TEST-PLA-NOCROSS-001";
  const events = [makeSprintFullRec(sprintId), makeManagerConsultRec(sprintId, "visual-review")];
  const r = computeFindings(events, { [sprintId]: POST_AUTHORING_DATE }, WIRE_DATE, []);
  ok(
    "pl-nocross: design-touch-only sprint (no plan/design phase event) → 0 authoring advisory (no cross-contamination)",
    (r.advisoryFindings || []).length === 0,
    `advisory=${JSON.stringify(r.advisoryFindings)}`,
  );
}

// pl-shape — module-shape sanity for the new constants
console.log("\n(pl-shape) ED-051 module exports:");
ok("AUTHORING_CUTOFF is 2026-06-12", AUTHORING_CUTOFF === "2026-06-12", `got ${AUTHORING_CUTOFF}`);
ok("AUTHORING_ROLE is product-lead", AUTHORING_ROLE === "product-lead", `got ${AUTHORING_ROLE}`);
ok(
  "AUTHORING_PHASES whitelists plan + design",
  Array.isArray(AUTHORING_PHASES) && AUTHORING_PHASES.includes("plan") && AUTHORING_PHASES.includes("design"),
);
ok(
  "AUTHORING_PHASES excludes execute/replan (bounded whitelist)",
  !AUTHORING_PHASES.includes("execute") && !AUTHORING_PHASES.includes("replan"),
);

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
