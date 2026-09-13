#!/usr/bin/env node
/**
 * scripts/checks/test-sprint-beta-honesty.js
 *
 * Fixture-driven tests for the sprint-beta-honesty check engine.
 * Drives computeFindings() directly with in-memory event records — no live
 * events.jsonl dependency.
 *
 * Scenarios:
 *   (a) CLEAN         — 4 real consults, 0 findings expected
 *   (b) PLACEHOLDER   — legacy kind + missing beta_message, placeholder_verdict finding
 *   (c) MISSING       — phase started but no consult recorded, missing_consult finding
 *   (d) ESCALATE-WITHOUT-HALT — ESCALATE consult + no halt, escalate_without_halt finding
 *   (e) LEGACY-ONLY   — pre-cutoff sprint with placeholder consult → 0 findings (exempt)
 *   (e2) EMPTY        — no events → 0 findings
 *   (e3) UNDATED      — sprint with no known date → exempt (fail-safe)
 *   (f) ESCALATE-WITH-HALT — ESCALATE + correct halt → 0 escalate_without_halt findings
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
  loadFullReportsData,
  validateIsoDate,
  classifyCanned,
  fingerprintFinding,
  isValidWaiver,
  loadWaivers,
  EXPECTED_BOUNDARIES,
  SP003_SHIP_DATE,
  PHASE_TO_BOUNDARY,
} = require("./sprint-beta-honesty");

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

// ── Fixture builder helpers ───────────────────────────────────────────────────

const POST_CUTOFF_DATE = "2026-05-26"; // day AFTER SP003_SHIP_DATE → applicable
const PRE_CUTOFF_DATE = "2026-05-20"; // well before SP003_SHIP_DATE → exempt
const BASE_TS = "2026-05-26T10:00:00.000Z";
const LATER_TS = "2026-05-26T10:05:00.000Z";

/**
 * Wrap event data in the canonical logger format:
 *   { id, ts, cat:"audit", actor:"alpha", session, data: { kind, ...payload } }
 *
 * Uses data-nested placement (matches logger.js behaviour).
 */
function makeRec(kind, payload) {
  return {
    id: `EVT-test-${kind}-${Math.random().toString(36).slice(2)}`,
    ts: BASE_TS,
    cat: "audit",
    actor: "alpha",
    session: "s-test",
    data: { kind, ...payload },
  };
}

function makeConsultRec(sprintId, boundary, opts = {}) {
  return makeRec("sprint_full_beta_consult", {
    sprint_id: sprintId,
    phase_boundary: boundary,
    verdict: opts.verdict !== undefined ? opts.verdict : "DECIDE",
    // Default is a SUBSTANTIVE, per-boundary-distinct verdict (decision token +
    // grounding + >40 chars) so the canned detectors (P-AP-1) treat it as clean.
    // A bare/reused message like the old "Beta says proceed" is exactly what the
    // canned-verdict gate now flags — tests that want a canned message pass it explicitly.
    beta_message:
      opts.beta_message !== undefined
        ? opts.beta_message
        : `DECIDE 0.9 at ${boundary} — proceed; reversible, blast-radius small (per SP rubric).`,
    latency_ms: opts.latency_ms !== undefined ? opts.latency_ms : 0,
    model: opts.model !== undefined ? opts.model : "claude-opus-4-8",
    ts: opts.ts || BASE_TS,
    via_cli_resume: true,
  });
}

function makeHaltRec(sprintId, phase, haltReason, ts) {
  return makeRec("sprint_full_halt", {
    sprint_id: sprintId,
    phase,
    halt_reason: haltReason,
    ts: ts || LATER_TS,
  });
}

function makePhaseStartedRec(sprintId, phase) {
  return makeRec("sprint_full_phase_started", {
    sprint_id: sprintId,
    phase,
    ts: BASE_TS,
  });
}

function makeLegacyConsultRec(sprintId, boundary) {
  return makeRec("sprint_full_beta_consultation", {
    sprint_id: sprintId,
    phase_boundary: boundary,
    verdict: "DECIDE",
    ts: BASE_TS,
  });
}

// ── Module shape sanity ───────────────────────────────────────────────────────

console.log("Module exports:");
ok(
  "EXPECTED_BOUNDARIES is frozen array of 4",
  Array.isArray(EXPECTED_BOUNDARIES) && EXPECTED_BOUNDARIES.length === 4,
  `got ${EXPECTED_BOUNDARIES}`,
);
ok(
  "EXPECTED_BOUNDARIES includes before_design",
  EXPECTED_BOUNDARIES.includes("before_design"),
);
ok(
  "EXPECTED_BOUNDARIES includes before_execute",
  EXPECTED_BOUNDARIES.includes("before_execute"),
);
ok(
  "EXPECTED_BOUNDARIES includes before_release-prep",
  EXPECTED_BOUNDARIES.includes("before_release-prep"),
);
ok(
  "EXPECTED_BOUNDARIES includes before_retro",
  EXPECTED_BOUNDARIES.includes("before_retro"),
);
ok(
  "SP003_SHIP_DATE is 2026-05-25",
  SP003_SHIP_DATE === "2026-05-25",
  `got ${SP003_SHIP_DATE}`,
);
ok(
  "PHASE_TO_BOUNDARY maps design → before_design",
  PHASE_TO_BOUNDARY["design"] === "before_design",
);

// ── (a) CLEAN — post-cutoff sprint with all 4 real consults ──────────────────

console.log("\n(a) CLEAN — post-cutoff sprint, all 4 boundaries consulted:");
{
  const sprintId = "SP-TEST-CLEAN-001";
  const events = [
    ...EXPECTED_BOUNDARIES.map((b) => makeConsultRec(sprintId, b)),
    ...Object.keys(PHASE_TO_BOUNDARY).map((p) =>
      makePhaseStartedRec(sprintId, p),
    ),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok("CLEAN: 0 findings", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("CLEAN: 1 applicable", r.applicable === 1, `got ${r.applicable}`);
  ok("CLEAN: derived exit code 0", r.findings.length === 0);
}

// ── (b) PLACEHOLDER — legacy kind ────────────────────────────────────────────

console.log("\n(b) PLACEHOLDER — legacy sprint_full_beta_consultation kind:");
{
  const sprintId = "SP-TEST-PH-LEGACY-001";
  const events = [
    makeLegacyConsultRec(sprintId, "before_design"),
    makePhaseStartedRec(sprintId, "design"),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok("PH-LEGACY: has finding", r.findings.length > 0, `got ${r.findings.length}`);
  ok(
    "PH-LEGACY: finding_type is placeholder_verdict",
    r.findings.some((f) => f.finding_type === "placeholder_verdict"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  ok(
    "PH-LEGACY: no missing_consult (legacy consult covers boundary)",
    !r.findings.some((f) => f.finding_type === "missing_consult"),
  );
  ok("PH-LEGACY: derived exit code 1", r.findings.length > 0);
}

console.log("\n(b2) PLACEHOLDER — missing beta_message:");
{
  const sprintId = "SP-TEST-PH-MSG-001";
  const events = [
    makeConsultRec(sprintId, "before_design", { beta_message: "" }),
    makePhaseStartedRec(sprintId, "design"),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "PH-EMPTY-MSG: has finding",
    r.findings.length > 0,
    `got ${r.findings.length}`,
  );
  ok(
    "PH-EMPTY-MSG: finding_type is placeholder_verdict",
    r.findings.some((f) => f.finding_type === "placeholder_verdict"),
  );
  ok(
    "PH-EMPTY-MSG: evidence mentions beta_message",
    r.findings.some(
      (f) => f.finding_type === "placeholder_verdict" && f.evidence && f.evidence.includes("beta_message"),
    ),
    `evidence: ${r.findings.map((f) => f.evidence).join("|")}`,
  );
}

console.log("\n(b3) PLACEHOLDER — missing model field:");
{
  const sprintId = "SP-TEST-PH-MODEL-001";
  const events = [
    makeConsultRec(sprintId, "before_execute", { model: "" }),
    makePhaseStartedRec(sprintId, "execute"),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "PH-EMPTY-MODEL: has placeholder_verdict finding",
    r.findings.some((f) => f.finding_type === "placeholder_verdict"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

console.log("\n(b4) VALID latency_ms=0 is NOT a placeholder:");
{
  // The real emit always sets latency_ms=0 for CLI resume; must not be flagged
  const sprintId = "SP-TEST-LATENCY-ZERO-001";
  const events = [
    makeConsultRec(sprintId, "before_design", { latency_ms: 0 }),
    makePhaseStartedRec(sprintId, "design"),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "LATENCY-ZERO: latency_ms=0 does NOT trigger placeholder_verdict",
    !r.findings.some((f) => f.finding_type === "placeholder_verdict"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

// ── (c) MISSING — phase started but no consult event ─────────────────────────

console.log("\n(c) MISSING — boundary reached (phase started) but no consult:");
{
  const sprintId = "SP-TEST-MISSING-001";
  const events = [
    makePhaseStartedRec(sprintId, "design"), // before_design was cleared but no consult
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok("MISSING: has finding", r.findings.length > 0, `got ${r.findings.length}`);
  ok(
    "MISSING: finding_type is missing_consult",
    r.findings.some((f) => f.finding_type === "missing_consult"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  ok(
    "MISSING: expected_consult is before_design",
    r.findings.some((f) => f.expected_consult === "before_design"),
    `expected_consults: ${r.findings.map((f) => f.expected_consult).join(",")}`,
  );
  ok("MISSING: derived exit code 1", r.findings.length > 0);
}

console.log("\n(c2) MISSING — multiple phases started, 2 missing consults:");
{
  const sprintId = "SP-TEST-MISSING-MULTI-001";
  const events = [
    makePhaseStartedRec(sprintId, "design"),
    makePhaseStartedRec(sprintId, "execute"),
    // no consults at all
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "MISSING-MULTI: 2 missing_consult findings",
    r.findings.filter((f) => f.finding_type === "missing_consult").length === 2,
    `got ${r.findings.filter((f) => f.finding_type === "missing_consult").length}`,
  );
}

// ── (d) ESCALATE-WITHOUT-HALT ─────────────────────────────────────────────────

console.log("\n(d) ESCALATE-WITHOUT-HALT — ESCALATE consult but no beta_escalate halt:");
{
  const sprintId = "SP-TEST-ESC-001";
  const events = [
    makeConsultRec(sprintId, "before_design", {
      verdict: "ESCALATE",
      beta_message: "This looks risky, escalate.",
    }),
    // No sprint_full_halt(halt_reason: beta_escalate)
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "ESC-WITHOUT-HALT: has finding",
    r.findings.length > 0,
    `got ${r.findings.length}`,
  );
  ok(
    "ESC-WITHOUT-HALT: finding_type is escalate_without_halt",
    r.findings.some((f) => f.finding_type === "escalate_without_halt"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  ok(
    "ESC-WITHOUT-HALT: verdict field is ESCALATE",
    r.findings.some(
      (f) => f.finding_type === "escalate_without_halt" && f.verdict === "ESCALATE",
    ),
  );
  ok("ESC-WITHOUT-HALT: derived exit code 1", r.findings.length > 0);
}

// ── (f) ESCALATE-WITH-HALT (counter case) ─────────────────────────────────────

console.log("\n(f) ESCALATE-WITH-HALT — ESCALATE consult + correct halt → clean:");
{
  const sprintId = "SP-TEST-ESC-WITH-HALT-001";
  const events = [
    makeConsultRec(sprintId, "before_design", {
      verdict: "ESCALATE",
      beta_message: "Escalate to operator.",
      ts: BASE_TS,
    }),
    makeHaltRec(sprintId, "plan", "beta_escalate", LATER_TS),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "ESC-WITH-HALT: no escalate_without_halt finding",
    !r.findings.some((f) => f.finding_type === "escalate_without_halt"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

// ── (e) LEGACY-ONLY — pre-cutoff sprints are fully exempt ────────────────────

console.log("\n(e) LEGACY-ONLY — pre-cutoff sprint with placeholder consult → 0 findings:");
{
  const sprintId = "SP-LEGACY-TEST-001";
  const events = [
    makeLegacyConsultRec(sprintId, "before_design"),
    makePhaseStartedRec(sprintId, "design"),
    makeConsultRec(sprintId, "before_execute", { beta_message: "" }), // placeholder
  ];
  const sprintDates = { [sprintId]: PRE_CUTOFF_DATE }; // BEFORE cutoff → exempt
  const r = computeFindings(events, sprintDates);

  ok(
    "LEGACY: 0 findings (all exempt)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
  ok("LEGACY: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
  ok("LEGACY: derived exit code 0", r.findings.length === 0);
}

// ── (e2) EMPTY — no events ────────────────────────────────────────────────────

console.log("\n(e2) EMPTY — no events at all:");
{
  const r = computeFindings([], {});

  ok("EMPTY: 0 findings", r.findings.length === 0);
  ok("EMPTY: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
  ok("EMPTY: derived exit code 0", r.findings.length === 0);
}

// ── (e3) UNDATED — sprint with activity but no known date ────────────────────

console.log("\n(e3) UNDATED — sprint has activity but no date in registry:");
{
  const sprintId = "SP-UNDATED-TEST-001";
  const events = [
    makeLegacyConsultRec(sprintId, "before_design"),
    makeConsultRec(sprintId, "before_execute", { beta_message: "" }),
  ];
  // No entry in sprintDates → exempt (fail-safe)
  const r = computeFindings(events, {});

  ok(
    "UNDATED: 0 findings (exempted)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
  ok(
    "UNDATED: undatedExempt > 0",
    r.undatedExempt > 0,
    `got undatedExempt=${r.undatedExempt}`,
  );
}

// ── (g) MIXED — pre- and post-cutoff sprints in same dataset ─────────────────

console.log("\n(g) MIXED — pre- and post-cutoff sprints: only post fires findings:");
{
  const legacyId = "SP-LEGACY-MIX-001";
  const activeId = "SP-ACTIVE-MIX-001";
  const events = [
    // Legacy sprint: placeholder consult — must NOT fire
    makeLegacyConsultRec(legacyId, "before_design"),
    makePhaseStartedRec(legacyId, "design"),
    // Active sprint: real consults for all boundaries (clean)
    ...EXPECTED_BOUNDARIES.map((b) => makeConsultRec(activeId, b)),
    ...Object.keys(PHASE_TO_BOUNDARY).map((p) =>
      makePhaseStartedRec(activeId, p),
    ),
  ];
  const sprintDates = {
    [legacyId]: PRE_CUTOFF_DATE,
    [activeId]: POST_CUTOFF_DATE,
  };
  const r = computeFindings(events, sprintDates);

  ok("MIXED: 0 findings (active sprint clean)", r.findings.length === 0, `got ${JSON.stringify(r.findings)}`);
  ok("MIXED: 1 applicable", r.applicable === 1, `got ${r.applicable}`);
}

// ── (h) CUSTOM CUTOFF — --since override works ───────────────────────────────

console.log("\n(h) CUSTOM CUTOFF — sprint after base cutoff but before custom cutoff → exempt:");
{
  const sprintId = "SP-CUSTOM-CUTOFF-001";
  const events = [
    makeLegacyConsultRec(sprintId, "before_design"),
  ];
  // Sprint date is POST_CUTOFF_DATE (2026-05-26) but custom cutoff is 2026-06-01
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const customCutoff = "2026-06-01";
  const r = computeFindings(events, sprintDates, customCutoff);

  ok(
    "CUSTOM-CUTOFF: sprint before custom cutoff is exempt",
    r.findings.length === 0,
    `got ${r.findings.length}`,
  );
  ok("CUSTOM-CUTOFF: 0 applicable", r.applicable === 0, `got ${r.applicable}`);
}

// ── (i) FULL-REPORTS CORROBORATION ────────────────────────────────────────────

console.log("\n(i) FULL-REPORTS CORROBORATION — halt-report shows design phase, no consult event:");
{
  // FIX 1: a post-cutoff sprint whose full-report shows the design phase was entered,
  // but events.jsonl has no sprint_full_beta_consult for before_design → missing_consult.
  // This is the false-clean FIX 1 closes: without full-reports, an audit with empty events
  // would silently report "0 findings" even though /sprint:full ran and skipped the consult.
  const sprintId = "SP-TEST-FR-MISS-001";
  const reportsData = {
    [sprintId]: {
      phasesReached: new Set(["design"]),
      consultedBoundaries: new Set(),
    },
  };
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings([], sprintDates, SP003_SHIP_DATE, reportsData);

  ok(
    "FR-CORR-MISS: has missing_consult finding (false-clean closed)",
    r.findings.some((f) => f.finding_type === "missing_consult"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
  ok(
    "FR-CORR-MISS: expected_consult is before_design",
    r.findings.some((f) => f.expected_consult === "before_design"),
    `expected_consults: ${r.findings.map((f) => f.expected_consult).join(",")}`,
  );
  ok(
    "FR-CORR-MISS: 1 applicable sprint (discovered via full-reports only)",
    r.applicable === 1,
    `got ${r.applicable}`,
  );
}

console.log("\n(i2) FULL-REPORTS CLEAN — final-report has Beta consultations confirming consult:");
{
  // If the final report's ## Beta consultations section lists before_design,
  // that counts as evidence of a consult → no missing_consult finding.
  const sprintId = "SP-TEST-FR-CLEAN-001";
  const reportsData = {
    [sprintId]: {
      phasesReached: new Set(["design"]),
      consultedBoundaries: new Set(["before_design"]), // final report confirmed it
    },
  };
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings([], sprintDates, SP003_SHIP_DATE, reportsData);

  ok(
    "FR-CORR-CLEAN: no missing_consult (final report confirms consult)",
    !r.findings.some((f) => f.finding_type === "missing_consult"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

// ── (i3) MISSING FULL-REPORTS DIR — null reportsData + no applicable events ───

console.log("\n(i3) MISSING FULL-REPORTS DIR — null reportsData + no event-applicable sprints:");
{
  // null reportsData AND no applicable events → graceful-empty (applicable=0, no crash)
  const r = computeFindings([], {}, SP003_SHIP_DATE, null);

  ok(
    "FR-MISSING-DIR: 0 findings",
    r.findings.length === 0,
    `got ${r.findings.length}`,
  );
  ok(
    "FR-MISSING-DIR: 0 applicable",
    r.applicable === 0,
    `got ${r.applicable}`,
  );
}

// ── (j) EXACT CUTOFF DATE ─────────────────────────────────────────────────────

console.log("\n(j) EXACT CUTOFF DATE — sprint dated exactly SP003_SHIP_DATE is CHECKED:");
{
  // Lexicographic: "2026-05-25" < "2026-05-25" is false → NOT exempt → applicable
  const sprintId = "SP-TEST-EXACT-CUTOFF-001";
  const events = [
    makePhaseStartedRec(sprintId, "design"), // boundary reached, no consult
  ];
  const sprintDates = { [sprintId]: SP003_SHIP_DATE }; // exactly on the cutoff
  const r = computeFindings(events, sprintDates);

  ok(
    "EXACT-CUTOFF: sprint at cutoff is applicable (not exempt)",
    r.applicable === 1,
    `got ${r.applicable}`,
  );
  ok(
    "EXACT-CUTOFF: missing_consult fires for at-cutoff sprint",
    r.findings.some((f) => f.finding_type === "missing_consult"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

// ── (k) PROTO-POLLUTION ───────────────────────────────────────────────────────

console.log("\n(k) PROTO-POLLUTION — sprint_id '__proto__' does NOT crash computeFindings:");
{
  // On a plain {} bucket map, sprint_id="__proto__" resolves truthy → bucket never created
  // → sd.consults.push(...) crashes on undefined. Object.create(null) prevents this.
  const poisonRec = makeRec("sprint_full_phase_started", {
    sprint_id: "__proto__",
    phase: "design",
  });
  const sprintDates = { "__proto__": POST_CUTOFF_DATE };
  let threw = false;
  let r;
  try {
    r = computeFindings([poisonRec], sprintDates);
  } catch (e) {
    threw = true;
  }
  ok(
    "PROTO-POLLUTION: does not throw",
    !threw,
    "threw exception",
  );
  ok(
    "PROTO-POLLUTION: returns a result object with findings array",
    r && typeof r === "object" && Array.isArray(r.findings),
    `got ${JSON.stringify(r)}`,
  );
}

// ── (l) WHITESPACE PLACEHOLDER ───────────────────────────────────────────────

console.log("\n(l) WHITESPACE PLACEHOLDER — beta_message='   ' (whitespace only) flagged:");
{
  const sprintId = "SP-TEST-WS-MSG-001";
  const events = [
    makeConsultRec(sprintId, "before_design", { beta_message: "   " }),
    makePhaseStartedRec(sprintId, "design"),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "WS-PH-MSG: whitespace-only beta_message → placeholder_verdict",
    r.findings.some((f) => f.finding_type === "placeholder_verdict"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
  ok(
    "WS-PH-MSG: evidence mentions beta_message",
    r.findings.some(
      (f) => f.finding_type === "placeholder_verdict" && f.evidence && f.evidence.includes("beta_message"),
    ),
    `evidence: ${r.findings.map((f) => f.evidence).join("|")}`,
  );
}

console.log("\n(l2) WHITESPACE PLACEHOLDER — model=' ' (whitespace only) flagged:");
{
  const sprintId = "SP-TEST-WS-MODEL-001";
  const events = [
    makeConsultRec(sprintId, "before_execute", { model: " " }),
    makePhaseStartedRec(sprintId, "execute"),
  ];
  const sprintDates = { [sprintId]: POST_CUTOFF_DATE };
  const r = computeFindings(events, sprintDates);

  ok(
    "WS-PH-MODEL: whitespace-only model → placeholder_verdict",
    r.findings.some((f) => f.finding_type === "placeholder_verdict"),
    `findings: ${JSON.stringify(r.findings)}`,
  );
}

// ── (m) --SINCE VALIDATION ────────────────────────────────────────────────────

console.log("\n(m) --SINCE VALIDATION — validateIsoDate predicate:");
{
  ok("SINCE-VALID: '2026-05-25' → true", validateIsoDate("2026-05-25"));
  ok("SINCE-VALID: '2026-01-01' → true", validateIsoDate("2026-01-01"));
  ok("SINCE-VALID: '2000-12-31' → true", validateIsoDate("2000-12-31"));
  ok("SINCE-INVALID: 'bogus' → false", !validateIsoDate("bogus"));
  ok("SINCE-INVALID: '2026-13-01' → false (invalid month)", !validateIsoDate("2026-13-01"));
  ok("SINCE-INVALID: '' → false", !validateIsoDate(""));
  ok("SINCE-INVALID: 'not-a-date' → false", !validateIsoDate("not-a-date"));
  ok("SINCE-INVALID: '20260525' → false (no dashes)", !validateIsoDate("20260525"));
}

// ── (n) CLI EXIT CODES — subprocess tests ────────────────────────────────────

console.log("\n(n) CLI EXIT CODES — subprocess tests:");
{
  const ENGINE = path.join(__dirname, "sprint-beta-honesty.js");

  // Test 1: --since bogus → exit 2 (FIX 2 validation)
  {
    const r = cp.spawnSync(process.execPath, [ENGINE, "--since", "bogus"], { encoding: "utf8" });
    ok(
      "CLI-EXIT: --since bogus → exit 2",
      r.status === 2,
      `got status=${r.status} stderr=${r.stderr}`,
    );
  }

  // Test 2: empty events + empty sprint-dates + empty full-reports dir → exit 0 (graceful-empty)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wos-sbh-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    fs.writeFileSync(tmpEvents, "");

    const r = cp.spawnSync(process.execPath, [ENGINE], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...mcEnv.envPair("EVENTS_FILE", tmpEvents),
        ...mcEnv.envPair("SPRINT_DATES_JSON", "{}"),
        ...mcEnv.envPair("FULLREPORTS_DIR", tmpDir), // tmpDir is empty (contains only events.jsonl file)
      },
    });
    ok(
      "CLI-EXIT: empty events → exit 0 (graceful-empty)",
      r.status === 0,
      `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`,
    );

    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }

  // Test 3: phase_started event with no consult → exit 1 (missing_consult finding)
  // Uses WARPOS_SPRINT_DATES_JSON to inject a post-cutoff date for the sprint.
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wos-sbh-"));
    const tmpEvents = path.join(tmpDir, "events.jsonl");
    const event = {
      id: "EVT-cli-test-001",
      ts: BASE_TS,
      cat: "audit",
      actor: "alpha",
      session: "s-cli-test",
      data: {
        kind: "sprint_full_phase_started",
        sprint_id: "SP-CLI-FINDING-001",
        phase: "design",
      },
    };
    fs.writeFileSync(tmpEvents, JSON.stringify(event) + "\n");

    const r = cp.spawnSync(process.execPath, [ENGINE], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...mcEnv.envPair("EVENTS_FILE", tmpEvents),
        // Sprint date 2026-05-26 >= cutoff 2026-05-25 → applicable
        ...mcEnv.envPair("SPRINT_DATES_JSON", JSON.stringify({ "SP-CLI-FINDING-001": POST_CUTOFF_DATE })),
        ...mcEnv.envPair("FULLREPORTS_DIR", tmpDir), // no report files → no corroboration
      },
    });
    ok(
      "CLI-EXIT: phase_started with no consult → exit 1 (finding)",
      r.status === 1,
      `got status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`,
    );

    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
}

// ── (m2) validateIsoDate ROUND-TRIP ───────────────────────────────────────────
//
// FIX A: V8 silently rolls over impossible dates (e.g. 2026-02-30 → 2026-03-02)
// without returning NaN. The round-trip check (parse → re-format → compare) catches
// these. All five assertions from the fix brief are verified here.

console.log("\n(m2) validateIsoDate ROUND-TRIP — overflow/invalid calendar dates rejected:");
{
  ok(
    "SINCE-RT-OVERFLOW: '2026-02-30' → false (Feb 30 rolls over, round-trip catches it)",
    !validateIsoDate("2026-02-30"),
  );
  ok(
    "SINCE-RT-OVERFLOW: '2026-13-01' → false (month 13 invalid — also in (m))",
    !validateIsoDate("2026-13-01"),
  );
  ok(
    "SINCE-RT-OVERFLOW: '2026-00-10' → false (month 00 invalid)",
    !validateIsoDate("2026-00-10"),
  );
  ok(
    "SINCE-RT-VALID: '2026-05-25' → true (round-trip consistent)",
    validateIsoDate("2026-05-25"),
  );
  ok(
    "SINCE-RT-VALID: '2024-02-29' → true (real leap day in 2024)",
    validateIsoDate("2024-02-29"),
  );
}

// ── (n2) --since MISSING VALUE ────────────────────────────────────────────────
//
// FIX A(2): a trailing --since with no following value (undefined) or with
// a flag as value (starts with --) must write to stderr and exit 2.

console.log("\n(n2) --since MISSING VALUE — no value or flag-as-value → exit 2:");
{
  const ENGINE = path.join(__dirname, "sprint-beta-honesty.js");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wos-sbh-since-"));
  const tmpEvents = path.join(tmpDir, "events.jsonl");
  fs.writeFileSync(tmpEvents, "");
  try {
    // --since with no following arg
    const r1 = cp.spawnSync(process.execPath, [ENGINE, "--since"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...mcEnv.envPair("EVENTS_FILE", tmpEvents),
        ...mcEnv.envPair("SPRINT_DATES_JSON", "{}"),
        ...mcEnv.envPair("FULLREPORTS_DIR", tmpDir),
      },
    });
    ok(
      "CLI-SINCE-MISSING: --since (no value) → exit 2",
      r1.status === 2,
      `got status=${r1.status} stderr=${r1.stderr}`,
    );

    // --since followed by another flag (flag treated as value)
    const r2 = cp.spawnSync(process.execPath, [ENGINE, "--since", "--json"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...mcEnv.envPair("EVENTS_FILE", tmpEvents),
        ...mcEnv.envPair("SPRINT_DATES_JSON", "{}"),
        ...mcEnv.envPair("FULLREPORTS_DIR", tmpDir),
      },
    });
    ok(
      "CLI-SINCE-FLAG: --since --json (flag as value) → exit 2",
      r2.status === 2,
      `got status=${r2.status} stderr=${r2.stderr}`,
    );
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
}

// ── (n3) --since OVERFLOW DATE via CLI ───────────────────────────────────────
//
// FIX A: validateIsoDate round-trip now rejects overflow dates, so
// --since 2026-02-30 must also exit 2 end-to-end via the CLI.

console.log("\n(n3) --since OVERFLOW DATE via CLI — 2026-02-30 → exit 2:");
{
  const ENGINE = path.join(__dirname, "sprint-beta-honesty.js");
  const r = cp.spawnSync(
    process.execPath,
    [ENGINE, "--since", "2026-02-30"],
    { encoding: "utf8" },
  );
  ok(
    "CLI-SINCE-OVERFLOW: --since 2026-02-30 → exit 2 (round-trip rejects V8 rollover date)",
    r.status === 2,
    `got status=${r.status} stderr=${r.stderr}`,
  );
}

// ── (k2) PROTO-SAFE DATES ─────────────────────────────────────────────────────
//
// FIX B: with a plain {} sprintDates, sprintDates["constructor"] resolves to
// Object.prototype.constructor (a truthy function) — without the Object.hasOwn guard
// this sprint would bypass the undated fail-safe and feed a garbage value into the
// cutoff comparison. The guard must treat it as undated → exempt.

console.log("\n(k2) PROTO-SAFE DATES — sprint_id 'constructor' treated as undated (not dated via proto):");
{
  const events = [
    makeRec("sprint_full_phase_started", {
      sprint_id: "constructor",
      phase: "design",
    }),
  ];
  // Plain {} — "constructor" is inherited from Object.prototype, NOT an own property.
  const sprintDates = {};
  let threw = false;
  let r;
  try {
    r = computeFindings(events, sprintDates);
  } catch (e) {
    threw = true;
  }
  ok(
    "PROTO-DATE-SAFE: does not throw with sprint_id='constructor'",
    !threw,
    "threw exception",
  );
  ok(
    "PROTO-DATE-SAFE: 'constructor' sprint is exempted as undated (not treated as dated via prototype)",
    r && r.undatedExempt > 0,
    `got undatedExempt=${r && r.undatedExempt} findings=${JSON.stringify(r && r.findings)}`,
  );
  ok(
    "PROTO-DATE-SAFE: no findings produced (undated → exempt, no false-positive date-based finding)",
    r && r.findings.length === 0,
    `got findings: ${JSON.stringify(r && r.findings)}`,
  );
}

// ── (o) CANNED-VERDICT DETECTION (P-AP-1) ─────────────────────────────────────

console.log("\n(o) CANNED — classifyCanned unit behavior:");
{
  ok("CANNED-CLS: 'ok' → canned_too_short", classifyCanned("ok") === "canned_too_short");
  ok("CANNED-CLS: 'looks good' → canned_too_short", classifyCanned("looks good") === "canned_too_short");
  ok(
    "CANNED-CLS: 'scope is reasonable, proceed' → canned_too_short",
    classifyCanned("scope is reasonable, proceed") === "canned_too_short",
  );
  ok(
    "CANNED-CLS: long-but-bare boilerplate → canned_unstructured",
    classifyCanned("I have looked at the whole thing and it all seems perfectly fine to proceed now.") ===
      "canned_unstructured",
  );
  ok(
    "CANNED-CLS: real structured verdict → null (not canned)",
    classifyCanned("DECIDE 0.92. ship-coverage + framework-purity green. RI-001: engine sprint, defer retro.") === null,
  );
  ok(
    "CANNED-CLS: borderline 40-char structured → null (length floor is exclusive)",
    classifyCanned("DECIDE — proceed per SP-1 rubric, reversible.") === null,
  );
  ok("CANNED-CLS: empty → null (placeholder_verdict owns it)", classifyCanned("") === null);
}

console.log("\n(o1) CANNED — short message in a real sprint → canned_too_short + exit 1:");
{
  const sprintId = "SP-TEST-CANNED-001";
  const events = [
    makeConsultRec(sprintId, "before_design", { beta_message: "ok" }),
    makePhaseStartedRec(sprintId, "design"),
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "CANNED-SHORT: has canned_too_short finding",
    r.findings.some((f) => f.finding_type === "canned_too_short"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  ok("CANNED-SHORT: derived exit 1", r.findings.length > 0);
}

console.log("\n(o2) CANNED — cross-boundary duplicate (same message at 2+ boundaries):");
{
  const sprintId = "SP-TEST-CANNED-DUP-001";
  const dup = "DECIDE — proceed, reversible and low blast-radius per the rubric here.";
  const events = [
    makeConsultRec(sprintId, "before_design", { beta_message: dup }),
    makeConsultRec(sprintId, "before_execute", { beta_message: dup }),
    makePhaseStartedRec(sprintId, "design"),
    makePhaseStartedRec(sprintId, "execute"),
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "CANNED-DUP: has canned_cross_boundary_dup finding",
    r.findings.some((f) => f.finding_type === "canned_cross_boundary_dup"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
}

console.log("\n(o3) CANNED — cross-sprint template reuse across 3 sprints:");
{
  const tmpl = "DECIDE — proceed, reversible and low blast-radius per the rubric here.";
  const ids = ["SP-TEST-CST-001", "SP-TEST-CST-002", "SP-TEST-CST-003"];
  const events = [];
  const dates = {};
  for (const id of ids) {
    events.push(makeConsultRec(id, "before_design", { beta_message: tmpl }));
    events.push(makePhaseStartedRec(id, "design"));
    dates[id] = POST_CUTOFF_DATE;
  }
  const r = computeFindings(events, dates);
  ok(
    "CANNED-CST: has canned_cross_sprint_template finding",
    r.findings.some((f) => f.finding_type === "canned_cross_sprint_template"),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
}

console.log("\n(o4) CANNED — synthetic SP-J* sprint is EXEMPT from the audit:");
{
  const sprintId = "SP-J9-SYNTH-001"; // synthetic prefix → exempt
  const events = [
    makeConsultRec(sprintId, "before_design", { beta_message: "ok" }), // would be canned
    makePhaseStartedRec(sprintId, "design"),
  ];
  const r = computeFindings(events, { [sprintId]: POST_CUTOFF_DATE });
  ok(
    "CANNED-SYNTH: no canned_* findings for synthetic sprint (audit-exempt)",
    !r.findings.some((f) => String(f.finding_type).startsWith("canned_")),
    `types: ${r.findings.map((f) => f.finding_type).join(",")}`,
  );
  // ...but classifyCanned still flags the string directly (the detector itself isn't exempt)
  ok("CANNED-SYNTH: classifyCanned('ok') still flags directly", classifyCanned("ok") === "canned_too_short");
}

console.log("\n(o5) CANNED — pre-cutoff sprint with a canned verdict is EXEMPT:");
{
  const sprintId = "SP-TEST-CANNED-LEGACY-001";
  const events = [
    makeConsultRec(sprintId, "before_design", { beta_message: "ok" }),
    makePhaseStartedRec(sprintId, "design"),
  ];
  const r = computeFindings(events, { [sprintId]: PRE_CUTOFF_DATE });
  ok(
    "CANNED-LEGACY: no findings (pre-cutoff exempt)",
    r.findings.length === 0,
    `got ${JSON.stringify(r.findings)}`,
  );
}

// ── (ED-049) Fingerprint stability + waiver ledger ────────────────────────────

console.log("\n(w1) FINGERPRINT — deterministic for identical record fields:");
{
  const a = fingerprintFinding({ sprint_id: "SP-X", finding_type: "canned_too_short", phase_boundary: "before_design", beta_message: "ok", actual_event: "sprint_full_beta_consult" });
  const b = fingerprintFinding({ sprint_id: "SP-X", finding_type: "canned_too_short", phase_boundary: "before_design", beta_message: "ok", actual_event: "sprint_full_beta_consult" });
  ok("FP-DETERMINISTIC: same inputs → same 64-hex fingerprint", a === b && /^[0-9a-f]{64}$/.test(a), a);
  const c = fingerprintFinding({ sprint_id: "SP-Y", finding_type: "canned_too_short", phase_boundary: "before_design", beta_message: "ok", actual_event: "sprint_full_beta_consult" });
  ok("FP-DISTINCT: different sprint → different fingerprint", a !== c);
}

console.log("\n(w2) FINGERPRINT — INVARIANT to corpus growth (β's HOW-fix):");
{
  // The cross_sprint_template evidence embeds "across N sprints" — a corpus-derived
  // count. β's catch: the fingerprint must NOT move when N grows, or a waiver would
  // silently stop matching and the finding would re-block. Build the SAME finding in a
  // 3-sprint corpus and a 4-sprint corpus; the fingerprint for SP-T1 must be identical.
  const MSG = "DECIDE 0.9 — proceed; reversible per SP rubric, blast-radius small.";
  function corpus(ids) {
    const events = [];
    const dates = {};
    for (const id of ids) {
      events.push(makeConsultRec(id, "before_design", { beta_message: MSG }));
      events.push(makePhaseStartedRec(id, "design"));
      dates[id] = POST_CUTOFF_DATE;
    }
    return { events, dates };
  }
  const a = corpus(["SP-T1", "SP-T2", "SP-T3"]);
  const b = corpus(["SP-T1", "SP-T2", "SP-T3", "SP-T4"]);
  const fa = computeFindings(a.events, a.dates).findings.find(
    (f) => f.sprint_id === "SP-T1" && f.finding_type === "canned_cross_sprint_template",
  );
  const fb = computeFindings(b.events, b.dates).findings.find(
    (f) => f.sprint_id === "SP-T1" && f.finding_type === "canned_cross_sprint_template",
  );
  ok("FP-CORPUS: cross_sprint_template finding exists in both corpora", !!fa && !!fb, `fa=${!!fa} fb=${!!fb}`);
  ok(
    "FP-INVARIANT: fingerprint identical across 3-sprint vs 4-sprint corpus (count not hashed)",
    fa && fb && fa.fingerprint === fb.fingerprint,
    fa && fb ? `${fa.fingerprint.slice(0, 12)} vs ${fb.fingerprint.slice(0, 12)} | evidence differs: "${fa.evidence}" / "${fb.evidence}"` : "missing finding",
  );
}

console.log("\n(w3) WAIVER — a valid waiver drops ONLY its finding; others still block:");
{
  // Two sprints, each a missing_consult. Waive finding #1 → it drops, #2 still blocks.
  const events = [
    makePhaseStartedRec("SP-W1", "design"),
    makePhaseStartedRec("SP-W2", "design"),
  ];
  const dates = { "SP-W1": POST_CUTOFF_DATE, "SP-W2": POST_CUTOFF_DATE };
  const raw = computeFindings(events, dates);
  ok("WAIVER-SETUP: 2 raw findings before any waiver", raw.findings.length === 2, `got ${raw.findings.length}`);
  const fp1 = raw.findings.find((f) => f.sprint_id === "SP-W1").fingerprint;
  const waived = computeFindings(events, dates, SP003_SHIP_DATE, null, new Set([fp1.toLowerCase()]));
  ok("WAIVER-DROP: waived finding removed (1 remains)", waived.findings.length === 1, `got ${waived.findings.length}`);
  ok("WAIVER-COUNT: waived count reported as 1", waived.waived === 1, `got ${waived.waived}`);
  ok(
    "WAIVER-NEW-STILL-BLOCKS: the un-waived sprint still appears",
    waived.findings.length === 1 && waived.findings[0].sprint_id === "SP-W2",
    JSON.stringify(waived.findings.map((f) => f.sprint_id)),
  );
}

console.log("\n(w4) isValidWaiver — fail-closed on incomplete/malformed waivers:");
{
  const goodFp = "a".repeat(64);
  ok("VALID: fingerprint+reason+approver → valid", isValidWaiver({ fingerprint: goodFp, reason: "r", approver: "op" }) === true);
  ok("INVALID: missing reason → invalid", isValidWaiver({ fingerprint: goodFp, approver: "op" }) === false);
  ok("INVALID: blank approver → invalid", isValidWaiver({ fingerprint: goodFp, reason: "r", approver: "  " }) === false);
  ok("INVALID: non-hex fingerprint → invalid", isValidWaiver({ fingerprint: "not-hex", reason: "r", approver: "op" }) === false);
  ok("INVALID: null → invalid", isValidWaiver(null) === false);
}

console.log("\n(w5) loadWaivers — per-line fail-closed parse (corrupt line dropped, no throw):");
{
  const tmp = path.join(os.tmpdir(), `bhw-test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  const fpA = "a".repeat(64);
  const fpB = "b".repeat(64);
  fs.writeFileSync(
    tmp,
    [
      JSON.stringify({ fingerprint: fpA, reason: "r", approver: "op" }), // valid
      "{ this is not json",                                              // corrupt → dropped
      JSON.stringify({ fingerprint: fpB, reason: "r" }),                 // missing approver → invalid
      "",                                                                // blank → skipped
      JSON.stringify({ fingerprint: fpB, reason: "r", approver: "op" }), // valid
    ].join("\n") + "\n",
  );
  let threw = false;
  let set;
  try { set = loadWaivers(tmp); } catch { threw = true; }
  fs.rmSync(tmp, { force: true });
  ok("LOADW-NOTHROW: corrupt line does not throw", threw === false);
  ok("LOADW-VALID-ONLY: only the 2 valid fingerprints loaded", set && set.size === 2 && set.has(fpA) && set.has(fpB), set ? `size ${set.size}` : "no set");
  ok("LOADW-MISSING: missing ledger file → empty set", loadWaivers(path.join(os.tmpdir(), "does-not-exist-bhw.jsonl")).size === 0);
}

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
