#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PATHS } = require("../hooks/lib/paths");
const { excludeFixtureEvents } = require("../lib/fixture-event-ids");

const LEGACY_EXEMPT_BEFORE = null;

const EXPECTED_BOUNDARIES = Object.freeze([
  "before_design",
  "before_execute",
  "before_release-prep",
  "before_retro",
]);

const PHASE_TO_BOUNDARY = Object.freeze({
  design: "before_design",
  execute: "before_execute",
  "release-prep": "before_release-prep",
  retro: "before_retro",
});

const MIN_SUBSTANTIVE_LEN = 40;
const VERDICT_TOKEN_RE = /\b(DECIDE|DIRECTIVE|ESCALATE|DECISION|CLASS\s+[ABC]\b|conf(?:idence)?|0\.\d{2})\b/i;
const GROUNDING_RE = /\b(SP-\d|T-\d|EVT-|RI-\d|DP-|LRN-|L-20|ADR-|per\b|because\b|precedent|rubric|reversib|blast[- ]radius|trade-?off)\b/i;
const LANE_OPENING_RE = /\b(add(?:ing)? an? falsifier|vacuity|re-?run full|hermetic(?:ity)?)\b/i;
const ROADMAP_ID_RE = /(\bROADMAP:\s*\S|\bRI-[A-Za-z0-9]|\bED-[A-Za-z0-9])/;
const GAUNTLET_RELEASE_BOUNDARIES = Object.freeze(["before_release-prep", "gauntlet->release", "gauntlet→release"]);

function opensLaneWithoutRoadmapId(phaseBoundary, betaMessage) {
  if (!GAUNTLET_RELEASE_BOUNDARIES.includes(String(phaseBoundary || ""))) return false;
  const msg = String(betaMessage || "");
  return LANE_OPENING_RE.test(msg) && !ROADMAP_ID_RE.test(msg);
}

const CROSS_SPRINT_TEMPLATE_THRESHOLD = 3;
const SYNTHETIC_SPRINT_PREFIXES = ["SP-J"];

function isSyntheticSprint(sprintId) {
  return SYNTHETIC_SPRINT_PREFIXES.some((p) => String(sprintId).startsWith(p));
}

function normalizeMessage(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a NON-EMPTY beta_message as canned. Returns "canned_too_short" (C1),
 * "canned_unstructured" (C2), or null. C1 takes precedence over C2. Empty messages
 * return null (handled separately by placeholder_verdict). Exported for tests.
 */
function classifyCanned(betaMessage) {
  const trimmed = String(betaMessage || "").trim();
  if (!trimmed) return null;
  if (trimmed.length < MIN_SUBSTANTIVE_LEN) return "canned_too_short";
  const hasToken = VERDICT_TOKEN_RE.test(trimmed);
  const hasGrounding = GROUNDING_RE.test(trimmed);
  if (!hasToken && !hasGrounding) return "canned_unstructured";
  return null;
}

function fingerprintFinding({ sprint_id, finding_type, phase_boundary, beta_message, actual_event }) {
  const tuple = [
    String(sprint_id || ""),
    String(finding_type || ""),
    String(phase_boundary || ""),
    normalizeMessage(beta_message || ""),
    String(actual_event || ""),
  ].join("\u001f");
  return crypto.createHash("sha256").update(tuple).digest("hex");
}

function withFp(finding, rawBetaMessage) {
  finding.fingerprint = fingerprintFinding({
    sprint_id: finding.sprint_id,
    finding_type: finding.finding_type,
    phase_boundary: finding.expected_consult,
    beta_message: rawBetaMessage,
    actual_event: finding.actual_event,
  });
  return finding;
}

function isValidWaiver(w) {
  return !!(
    w &&
    typeof w === "object" &&
    typeof w.fingerprint === "string" &&
    /^[0-9a-f]{16,}$/i.test(w.fingerprint) &&
    typeof w.reason === "string" &&
    w.reason.trim() &&
    typeof w.approver === "string" &&
    w.approver.trim()
  );
}

function loadWaivers(filePath) {
  const set = new Set();
  if (!filePath || !fs.existsSync(filePath)) return set;
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return set;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let w;
    try {
      w = JSON.parse(line);
    } catch {
      continue;
    }
    if (isValidWaiver(w)) set.add(w.fingerprint.toLowerCase());
  }
  return set;
}

const JSON_OUT = process.argv.includes("--json");
const NO_WAIVERS = process.argv.includes("--no-waivers");
const sinceIdx = process.argv.indexOf("--since");
const CUTOFF =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1]
    : LEGACY_EXEMPT_BEFORE;

const EVENT_FIELDS = [
  "kind",
  "verdict",
  "beta_message",
  "latency_ms",
  "model",
  "phase_boundary",
  "sprint_id",
  "ts",
  "halt_reason",
  "phase",
];

function getEventFields(rec) {
  if (!rec || typeof rec !== "object") return {};
  const d = rec.data && typeof rec.data === "object" ? rec.data : {};
  const merged = { ...d };
  for (const k of EVENT_FIELDS) {
    if (rec[k] !== undefined) merged[k] = rec[k];
  }
  return merged;
}

function extractYamlDate(text) {
  if (!text) return null;
  const m = text.match(/(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m ? m[1] : null;
}

function validateIsoDate(val) {
  if (typeof val !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const d = new Date(val + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === val;
}

function loadSprintDates() {
  const dates = {};

  const sprintsDir = PATHS.sprintSprints;
  if (sprintsDir && fs.existsSync(sprintsDir)) {
    let entries = [];
    try {
      entries = fs.readdirSync(sprintsDir);
    } catch { }
    for (const entry of entries) {
      try {
        const currentYaml = path.join(sprintsDir, entry, "current.yaml");
        if (fs.existsSync(currentYaml)) {
          const text = fs.readFileSync(currentYaml, "utf8");
          const date = extractYamlDate(text);
          if (date) dates[entry] = date;
        }
      } catch { }
    }
  }

  const activeReg = PATHS.sprintActiveRegistry;
  if (activeReg && fs.existsSync(activeReg)) {
    try {
      const text = fs.readFileSync(activeReg, "utf8");
      const chunks = text.split(/^(?=\s*-\s)/m).filter(Boolean);
      for (const chunk of chunks) {
        const idM = chunk.match(/\bid\s*:\s*["']?(\S+?)["']?\s*$/m);
        const dateM = chunk.match(
          /(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/,
        );
        if (idM && dateM) {
          const id = idM[1].replace(/['"]/g, "");
          if (!dates[id]) dates[id] = dateM[1];
        }
      }
    } catch { }
  }

  return dates;
}

function parseReportContent(content, data) {
  if (!content || typeof content !== "string") return;

  for (const m of content.matchAll(/^\*\*Phase:\*\*\s+(\S+)/gm)) {
    const phase = m[1].trim();
    if (PHASE_TO_BOUNDARY[phase]) {
      data.phasesReached.add(phase);
    }
  }

  const betaIdx = content.indexOf("## Beta consultations");
  if (betaIdx !== -1) {
    const afterHeader = content.indexOf("\n", betaIdx) + 1;
    const nextSection = content.indexOf("\n##", afterHeader);
    const sectionContent = nextSection === -1
      ? content.slice(afterHeader)
      : content.slice(afterHeader, nextSection);

    for (const lm of sectionContent.matchAll(/^-\s+(before_[\w-]+)\s*:/gm)) {
      const boundary = lm[1].trim();
      if (EXPECTED_BOUNDARIES.includes(boundary)) {
        data.consultedBoundaries.add(boundary);
      }
    }
  }
}

function loadFullReportsData(overrideDir) {
  const result = Object.create(null);
  const reportsDir = overrideDir || PATHS.sprintFullReports;
  if (!reportsDir) return result;
  if (!fs.existsSync(reportsDir)) return result;

  let entries = [];
  try {
    entries = fs.readdirSync(reportsDir);
  } catch {
    return result;
  }

  for (const entry of entries) {
    try {
      const sprintDir = path.join(reportsDir, entry);
      let stat;
      try { stat = fs.statSync(sprintDir); } catch { continue; }
      if (!stat.isDirectory()) continue;

      const sprintEntry = { phasesReached: new Set(), consultedBoundaries: new Set() };

      let files = [];
      try { files = fs.readdirSync(sprintDir); } catch { }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        try {
          const content = fs.readFileSync(path.join(sprintDir, file), "utf8");
          parseReportContent(content, sprintEntry);
        } catch { }
      }

      result[entry] = sprintEntry;
    } catch { }
  }

  return result;
}

function formatFindingsTable(findings) {
  if (findings.length === 0) return "";

  const EVIDENCE_MAX = 50;
  let w0 = 6;
  let w1 = 5;
  let w2 = 7;
  let w3 = 12;

  for (const f of findings) {
    w0 = Math.min(28, Math.max(w0, (f.sprint_id || "").length));
    w1 = Math.min(14, Math.max(w1, (f.phase || "-").length));
    w2 = Math.min(12, Math.max(w2, (f.verdict || "-").length));
    w3 = Math.min(22, Math.max(w3, (f.finding_type || "").length));
  }

  const pad = (s, w) => String(s == null ? "-" : s).slice(0, w).padEnd(w);
  const trunc = (s, w) => {
    const str = String(s == null ? "" : s);
    return str.length > w ? str.slice(0, w - 1) + "…" : str.padEnd(w);
  };

  const header = [
    pad("SPRINT", w0), pad("PHASE", w1), pad("VERDICT", w2),
    pad("FINDING_TYPE", w3), "EVIDENCE",
  ].join("  ");
  const separator = [
    "-".repeat(w0), "-".repeat(w1), "-".repeat(w2),
    "-".repeat(w3), "-".repeat(EVIDENCE_MAX),
  ].join("  ");

  const rows = findings.map((f) => [
    pad(f.sprint_id, w0),
    pad(f.phase, w1),
    pad(f.verdict, w2),
    pad(f.finding_type, w3),
    trunc(f.evidence, EVIDENCE_MAX),
  ].join("  "));

  return [header, separator, ...rows].join("\n");
}

function computeFindings(events, sprintDates = {}, cutoff = LEGACY_EXEMPT_BEFORE, reportsData = null, waivers = null) {
  const findings = [];
  let malformedLines = 0;

  const sprintData = Object.create(null);

  for (const rec of events) {
    if (!rec || typeof rec !== "object") {
      malformedLines++;
      continue;
    }
    const f = getEventFields(rec);
    const kind = f.kind;
    if (!kind || !kind.startsWith("sprint_full")) continue;

    const sprintId = f.sprint_id;
    if (!sprintId) continue;

    if (!sprintData[sprintId]) {
      sprintData[sprintId] = {
        consults: [],
        legacyConsults: [],
        halts: [],
        phaseStarted: new Set(),
        _reportConsultedBoundaries: new Set(),
      };
    }
    const sd = sprintData[sprintId];

    if (kind === "sprint_full_beta_consult") {
      sd.consults.push(f);
    } else if (kind === "sprint_full_beta_consultation") {
      sd.legacyConsults.push(f);
    } else if (kind === "sprint_full_halt") {
      sd.halts.push(f);
    } else if (kind === "sprint_full_phase_started") {
      if (f.phase) sd.phaseStarted.add(f.phase);
    }
  }

  if (reportsData && typeof reportsData === "object") {
    for (const sprintId of Object.keys(reportsData)) {
      const rd = reportsData[sprintId];
      if (!rd) continue;

      if (!sprintData[sprintId]) {
        sprintData[sprintId] = {
          consults: [],
          legacyConsults: [],
          halts: [],
          phaseStarted: new Set(),
          _reportConsultedBoundaries: new Set(),
        };
      }
      const sd = sprintData[sprintId];

      if (rd.phasesReached) {
        for (const phase of rd.phasesReached) {
          sd.phaseStarted.add(phase);
        }
      }
      if (rd.consultedBoundaries) {
        for (const b of rd.consultedBoundaries) {
          sd._reportConsultedBoundaries.add(b);
        }
      }
    }
  }

  const applicableSprintIds = [];
  let undatedExempt = 0;
  let checked = 0;
  const crossSprintMsgs = Object.create(null);

  for (const sprintId of Object.keys(sprintData)) {
    const sd = sprintData[sprintId];
    const sprintDate = Object.hasOwn(sprintDates, sprintId) ? sprintDates[sprintId] : undefined;
    if (!sprintDate) {
      undatedExempt++;
      continue;
    }
    if (cutoff && sprintDate < cutoff) {
      continue;
    }

    applicableSprintIds.push(sprintId);
    checked++;

    for (const ev of sd.legacyConsults) {
      findings.push(withFp({
        sprint_id: sprintId,
        phase: ev.phase_boundary ? ev.phase_boundary.replace("before_", "") : null,
        expected_consult: ev.phase_boundary || null,
        actual_event: "sprint_full_beta_consultation",
        verdict: ev.verdict || null,
        evidence: "legacy sprint_full_beta_consultation kind (placeholder)",
        finding_type: "placeholder_verdict",
      }, ev.beta_message));
    }

    for (const ev of sd.consults) {
      const missing = [];
      if (!ev.beta_message || !String(ev.beta_message).trim())
        missing.push("beta_message");
      if (ev.latency_ms === undefined || ev.latency_ms === null)
        missing.push("latency_ms");
      if (!ev.model || !String(ev.model).trim())
        missing.push("model");

      if (missing.length > 0) {
        findings.push(withFp({
          sprint_id: sprintId,
          phase: ev.phase_boundary ? ev.phase_boundary.replace("before_", "") : null,
          expected_consult: ev.phase_boundary || null,
          actual_event: "sprint_full_beta_consult",
          verdict: ev.verdict || null,
          evidence: `missing or empty field(s): ${missing.join(", ")}`,
          finding_type: "placeholder_verdict",
        }, ev.beta_message));
      }
    }

    if (!isSyntheticSprint(sprintId)) {
      const boundariesByMsg = new Map();
      for (const ev of sd.consults) {
        const raw = ev.beta_message;
        if (!raw || !String(raw).trim()) continue;
        const trimmed = String(raw).trim();

        const cls = classifyCanned(raw);
        if (cls) {
          findings.push(withFp({
            sprint_id: sprintId,
            phase: ev.phase_boundary ? ev.phase_boundary.replace("before_", "") : null,
            expected_consult: ev.phase_boundary || null,
            actual_event: "sprint_full_beta_consult",
            verdict: ev.verdict || null,
            evidence:
              cls === "canned_too_short"
                ? `beta_message is ${trimmed.length} chars (< ${MIN_SUBSTANTIVE_LEN}): "${trimmed.slice(0, 40)}"`
                : `beta_message has no decision token AND no grounding reference: "${trimmed.slice(0, 40)}"`,
            finding_type: cls,
          }, raw));
        }

        // C5 (DISCHARGE rule): lane-opening verbs at gauntlet→release with no roadmap id
        if (opensLaneWithoutRoadmapId(ev.phase_boundary, raw)) {
          findings.push(withFp({
            sprint_id: sprintId,
            phase: ev.phase_boundary ? String(ev.phase_boundary).replace("before_", "") : null,
            expected_consult: ev.phase_boundary || null,
            actual_event: "sprint_full_beta_consult",
            verdict: ev.verdict || null,
            evidence: `gauntlet->release consult opens a lane (falsifier/vacuity/re-run full/hermetic) without a ROADMAP:/RI-/ED- id: "${trimmed.slice(0, 40)}"`,
            finding_type: "lane_open_no_roadmap_id",
          }, raw));
        }

        const norm = normalizeMessage(raw);
        if (norm) {
          if (!boundariesByMsg.has(norm)) boundariesByMsg.set(norm, new Set());
          if (ev.phase_boundary) boundariesByMsg.get(norm).add(ev.phase_boundary);
          if (!crossSprintMsgs[norm]) crossSprintMsgs[norm] = { sprints: new Set(), samples: [] };
          crossSprintMsgs[norm].sprints.add(sprintId);
          crossSprintMsgs[norm].samples.push({ sprintId, ev });
        }
      }
      // C3: a normalized message reused at ≥2 DISTINCT boundaries within one sprint.
      for (const [norm, boundaries] of boundariesByMsg) {
        if (boundaries.size >= 2) {
          findings.push(withFp({
            sprint_id: sprintId,
            phase: null,
            expected_consult: null,
            actual_event: "sprint_full_beta_consult",
            verdict: null,
            evidence: `identical verdict message reused across ${boundaries.size} boundaries (${[...boundaries].join(", ")})`,
            finding_type: "canned_cross_boundary_dup",
          }, norm));
        }
      }
    }

    const consultedBoundaries = new Set(
      [
        ...sd.consults.map((c) => c.phase_boundary),
        ...sd.legacyConsults.map((c) => c.phase_boundary),
        ...[...sd._reportConsultedBoundaries],
      ].filter(Boolean),
    );

    for (const phase of sd.phaseStarted) {
      const boundary = PHASE_TO_BOUNDARY[phase];
      if (!boundary) continue;
      if (!EXPECTED_BOUNDARIES.includes(boundary)) continue;
      if (!consultedBoundaries.has(boundary)) {
        findings.push(withFp({
          sprint_id: sprintId,
          phase,
          expected_consult: boundary,
          actual_event: null,
          verdict: null,
          evidence: `phase '${phase}' started but no sprint_full_beta_consult recorded for boundary '${boundary}'`,
          finding_type: "missing_consult",
        }, ""));
      }
    }

    for (const ev of sd.consults) {
      if (ev.verdict !== "ESCALATE") continue;
      const evTs = typeof ev.ts === "string" ? ev.ts : "";
      const hasMatchingHalt = sd.halts.some(
        (h) =>
          h.halt_reason === "beta_escalate" &&
          (!evTs || !h.ts || h.ts >= evTs),
      );
      if (!hasMatchingHalt) {
        findings.push(withFp({
          sprint_id: sprintId,
          phase: ev.phase_boundary ? ev.phase_boundary.replace("before_", "") : null,
          expected_consult: ev.phase_boundary || null,
          actual_event: "sprint_full_beta_consult",
          verdict: "ESCALATE",
          evidence: "no sprint_full_halt(halt_reason: beta_escalate) found for this sprint at/after consult timestamp",
          finding_type: "escalate_without_halt",
        }, ev.beta_message));
      }
    }
  }

  // ── Finding type 4 (C4): cross-sprint template reuse ──────────────────────
  for (const norm of Object.keys(crossSprintMsgs)) {
    const rec = crossSprintMsgs[norm];
    if (rec.sprints.size >= CROSS_SPRINT_TEMPLATE_THRESHOLD) {
      const emitted = new Set();
      for (const { sprintId, ev } of rec.samples) {
        if (emitted.has(sprintId)) continue;
        emitted.add(sprintId);
        findings.push(withFp({
          sprint_id: sprintId,
          phase: ev.phase_boundary ? ev.phase_boundary.replace("before_", "") : null,
          expected_consult: ev.phase_boundary || null,
          actual_event: "sprint_full_beta_consult",
          verdict: ev.verdict || null,
          evidence: `verdict message reused across ${rec.sprints.size} sprints (templated boilerplate): "${String(ev.beta_message).trim().slice(0, 40)}"`,
          finding_type: "canned_cross_sprint_template",
        }, ev.beta_message));
      }
    }
  }

  let outFindings = findings;
  let waived = 0;
  if (waivers && typeof waivers.has === "function") {
    outFindings = [];
    for (const f of findings) {
      if (f.fingerprint && waivers.has(String(f.fingerprint).toLowerCase())) {
        waived++;
        continue;
      }
      outFindings.push(f);
    }
  }

  return {
    findings: outFindings,
    applicable: applicableSprintIds.length,
    checked,
    undatedExempt,
    malformedLines,
    waived,
  };
}

function loadAuditContext() {
  let rawEvents = [];
  let malformedCount = 0;
  const eventsPath = mcEnv.readEnv("EVENTS_FILE") || PATHS.eventsFile;
  try {
    const raw = fs.readFileSync(eventsPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        rawEvents.push(JSON.parse(line));
      } catch {
        malformedCount++;
      }
    }
  } catch {
  }

  let sprintDates;
  if (mcEnv.readEnv("SPRINT_DATES_JSON")) {
    try {
      sprintDates = JSON.parse(mcEnv.readEnv("SPRINT_DATES_JSON"));
    } catch {
      sprintDates = {};
    }
  } else {
    sprintDates = loadSprintDates();
  }

  const reportsData = loadFullReportsData(
    mcEnv.readEnv("FULLREPORTS_DIR") || undefined,
  );

  rawEvents = excludeFixtureEvents(rawEvents);

  return { rawEvents, malformedCount, sprintDates, reportsData };
}

function waiverLedgerPath() {
  return mcEnv.readEnv("BETA_HONESTY_WAIVERS") || PATHS.betaHonestyWaivers;
}

if (require.main === module) {
  if (sinceIdx !== -1) {
    const sinceVal = process.argv[sinceIdx + 1];
    if (!sinceVal || sinceVal.startsWith("--")) {
      process.stderr.write(
        `ERROR [sprint-beta-honesty] --since requires a value (YYYY-MM-DD); none provided\n`,
      );
      process.exit(2);
    }
    if (!validateIsoDate(sinceVal)) {
      process.stderr.write(
        `ERROR [sprint-beta-honesty] invalid --since value: "${sinceVal}" — must be a valid ISO date YYYY-MM-DD\n`,
      );
      process.exit(2);
    }
  }

  const { rawEvents, malformedCount, sprintDates, reportsData } =
    loadAuditContext();

  const waivers = NO_WAIVERS ? null : loadWaivers(waiverLedgerPath());

  const result = computeFindings(rawEvents, sprintDates, CUTOFF, reportsData, waivers);
  result.malformedLines = (result.malformedLines || 0) + malformedCount;

  if (result.applicable === 0) {
    if (JSON_OUT) {
      console.log(
        JSON.stringify({
          ok: true,
          applicable: 0,
          reason: "no_applicable_sprints",
          cutoff: CUTOFF,
          undatedExempt: result.undatedExempt,
        }),
      );
    } else {
      console.log(
        `OK   [sprint-beta-honesty] no applicable sprints in window (cutoff ${CUTOFF || "none"}) — nothing to audit`,
      );
    }
    process.exit(0);
  }

  const ok = result.findings.length === 0;
  if (JSON_OUT) {
    const jsonOut = {
      ok,
      applicable: result.applicable,
      checked: result.checked,
      findings: result.findings.slice(0, 30),
      totalFindings: result.findings.length,
      cutoff: CUTOFF,
      undatedExempt: result.undatedExempt,
      malformedLines: result.malformedLines,
      waived: result.waived || 0,
    };
    if (result.findings.length > 30) jsonOut.truncated = true;
    console.log(JSON.stringify(jsonOut));
  } else {
    const waivedNote = result.waived ? ` (${result.waived} waived)` : "";
    if (ok) {
      console.log(
        `OK   [sprint-beta-honesty] ${result.checked} sprint(s) checked, 0 findings${waivedNote}`,
      );
    } else {
      process.stderr.write(
        `FAIL [sprint-beta-honesty] ${result.findings.length} finding(s) (${result.checked} sprint(s) checked, cutoff ${CUTOFF || "none"}${waivedNote}):\n\n`,
      );
      process.stderr.write(formatFindingsTable(result.findings.slice(0, 10)) + "\n");
      if (result.findings.length > 10) {
        process.stderr.write(`\n  ... and ${result.findings.length - 10} more\n`);
      }
    }
  }
  process.exit(ok ? 0 : 1);
}

module.exports = {
  computeFindings,
  loadFullReportsData,
  validateIsoDate,
  classifyCanned,
  opensLaneWithoutRoadmapId,
  normalizeMessage,
  fingerprintFinding,
  withFp,
  isValidWaiver,
  loadWaivers,
  loadAuditContext,
  loadSprintDates,
  waiverLedgerPath,
  CUTOFF,
  LEGACY_EXEMPT_BEFORE,
  EXPECTED_BOUNDARIES,
  PHASE_TO_BOUNDARY,
  MIN_SUBSTANTIVE_LEN,
};
