#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const { excludeFixtureEvents } = require("../lib/fixture-event-ids");

const LEGACY_EXEMPT_BEFORE = null;

const TELEMETRY_ONLY_BEFORE = null;

const AUTHORING_EXEMPT_BEFORE = null;
const AUTHORING_ROLE = "product-lead";
const AUTHORING_PHASES = Object.freeze(["plan", "design"]);

const SPRINT_WINDOW_BUFFER_MS = 2 * 60 * 60 * 1000;

const WINDOW_HARD_CAP_MS = 14 * 24 * 60 * 60 * 1000;

function sprintAnchorMs(sprintDates, sprintId) {
  if (!sprintDates || !Object.hasOwn(sprintDates, sprintId)) return null;
  const d = sprintDates[sprintId];
  if (typeof d !== "string") return null;
  const t = Date.parse(d + "T00:00:00Z");
  return isNaN(t) ? null : t;
}

function tsWithinHorizon(evTs, anchorMs) {
  if (anchorMs === null) return false;
  return evTs >= anchorMs - WINDOW_HARD_CAP_MS && evTs <= anchorMs + WINDOW_HARD_CAP_MS;
}

const REQUIRED_MANAGER = "design-quality";

const DESIGN_TOUCH_MANAGERS = Object.freeze(["visual-review", "design-lead", "design-review"]);

const SYNTHETIC_SPRINT_PREFIXES = ["SP-J"];

function isSyntheticSprint(sprintId) {
  return SYNTHETIC_SPRINT_PREFIXES.some((p) => String(sprintId).startsWith(p));
}

const JSON_OUT = process.argv.includes("--json");
const sinceIdx = process.argv.indexOf("--since");
const CUTOFF =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1]
    : LEGACY_EXEMPT_BEFORE;
const telemetryIdx = process.argv.indexOf("--telemetry-only-before");
const TELEMETRY_CUTOFF =
  telemetryIdx !== -1 && process.argv[telemetryIdx + 1] ? process.argv[telemetryIdx + 1] : TELEMETRY_ONLY_BEFORE;

const EVENT_FIELDS = [
  "kind",
  "manager",
  "mode",
  "unit",
  "verdict",
  "sprint_id",
  "ui_touched",
  "ts",
  "phase",
];

function getEventFields(rec) {
  if (!rec || typeof rec !== "object") return {};
  const d = rec.data && typeof rec.data === "object" ? rec.data : {};
  const merged = { ...d };
  if (rec.cat !== undefined) merged.cat = rec.cat;
  if (rec.sprint_id !== undefined && merged.sprint_id === undefined) merged.sprint_id = rec.sprint_id;
  for (const k of EVENT_FIELDS) {
    if (rec[k] !== undefined) merged[k] = rec[k];
  }
  return merged;
}

function extractYamlDate(text) {
  if (!text) return null;
  const m = text.match(/(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m && validateIsoDate(m[1]) ? m[1] : null;
}

function parseTs(v) {
  if (!v) return null;
  const t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}

function hasBackingDispatchRecord(dispatchRecords, role, minTsMs, maxTsMs, sprintId, opts = {}) {
  const requireSignature = opts.requireSignature !== false;
  if (!Array.isArray(dispatchRecords) || dispatchRecords.length === 0) return false;
  if (minTsMs === null && maxTsMs === null) return false;
  const wantSprint = sprintId !== undefined && sprintId !== null ? String(sprintId).trim() : null;
  return dispatchRecords.some((rec) => {
    if (!isVerifiedLivenessRecord(rec, { requireSignature })) return false;
    if (typeof rec.role !== "string" || rec.role.trim() !== role) return false;
    const recSprint =
      typeof rec.sprint_id === "string" && rec.sprint_id.trim() ? rec.sprint_id.trim() : null;
    if (wantSprint !== null && recSprint !== null && recSprint !== wantSprint) return false;
    const t = parseTs(rec.completed_at) ?? parseTs(rec.started_at);
    if (t === null) return false;
    if (minTsMs !== null && t < minTsMs - SPRINT_WINDOW_BUFFER_MS) return false;
    if (maxTsMs !== null && t > maxTsMs + SPRINT_WINDOW_BUFFER_MS) return false;
    return true;
  });
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

function computeFindings(events, sprintDates = {}, cutoff = LEGACY_EXEMPT_BEFORE, dispatchRecords = [], opts = {}) {
  const telemetryOnlyBefore = opts.telemetryOnlyBefore !== undefined ? opts.telemetryOnlyBefore : TELEMETRY_ONLY_BEFORE;
  const authoringExemptBefore = opts.authoringExemptBefore !== undefined ? opts.authoringExemptBefore : AUTHORING_EXEMPT_BEFORE;
  const findings = [];
  let malformedLines = 0;

  const sprintData = Object.create(null);

  for (const rec of events) {
    if (!rec || typeof rec !== "object") {
      malformedLines++;
      continue;
    }
    const f = getEventFields(rec);
    const sprintId = f.sprint_id;
    if (!sprintId) continue;

    const isManagerConsult = f.cat === "manager_consult" || (f.manager && !f.kind);
    const isSprintFull = typeof f.kind === "string" && f.kind.startsWith("sprint_full");

    if (!isManagerConsult && !isSprintFull) continue;

    if (!sprintData[sprintId]) {
      sprintData[sprintId] = {
        sawSprintFull: false,
        designTouch: false,
        hasDesignQuality: false,
        designTouchEvidence: null,
        minTsMs: null,
        maxTsMs: null,
        discardedTs: [],
        authoringArtifact: false,
        authoringEvidence: null,
      };
    }
    const sd = sprintData[sprintId];

    const evTs = parseTs(f.ts);
    if (evTs !== null) {
      const anchorMs = sprintAnchorMs(sprintDates, sprintId);
      if (!tsWithinHorizon(evTs, anchorMs)) {
        sd.discardedTs.push(new Date(evTs).toISOString());
      } else {
        if (sd.minTsMs === null || evTs < sd.minTsMs) sd.minTsMs = evTs;
        if (sd.maxTsMs === null || evTs > sd.maxTsMs) sd.maxTsMs = evTs;
      }
    }

    if (isSprintFull) {
      sd.sawSprintFull = true;
      if (f.ui_touched === true) {
        sd.designTouch = true;
        if (!sd.designTouchEvidence) sd.designTouchEvidence = `ui_touched on ${f.kind}`;
      }
      if (AUTHORING_PHASES.includes(f.phase)) {
        sd.authoringArtifact = true;
        if (!sd.authoringEvidence) sd.authoringEvidence = `${f.kind}:${f.phase}`;
      }
    }

    if (isManagerConsult && f.manager) {
      const mgr = String(f.manager);
      if (mgr === REQUIRED_MANAGER) {
        sd.hasDesignQuality = true;
      } else if (DESIGN_TOUCH_MANAGERS.includes(mgr)) {
        sd.designTouch = true;
        if (!sd.designTouchEvidence) sd.designTouchEvidence = `${mgr} manager_consult`;
      }
    }
  }

  const applicableSprintIds = [];
  const windowDiscards = [];
  let undatedExempt = 0;
  let checked = 0;

  for (const sprintId of Object.keys(sprintData)) {
    const sd = sprintData[sprintId];

    if (!sd.designTouch) continue;

    if (isSyntheticSprint(sprintId)) continue;

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
    for (const iso of sd.discardedTs) {
      windowDiscards.push({
        sprint_id: sprintId,
        evidence: `event ts ${iso} outside sane sprint horizon (created_at ± cap) — discarded from window derivation`,
      });
    }

    if (!sd.hasDesignQuality) {
      findings.push({
        sprint_id: sprintId,
        manager: REQUIRED_MANAGER,
        evidence: `sprint shows a design-touch signal (${sd.designTouchEvidence || "design work"}) but no manager_consult record for '${REQUIRED_MANAGER}' was found for this sprint`,
        finding_type: "missing_design_consult",
      });
    } else if (!telemetryOnlyBefore || sprintDate >= telemetryOnlyBefore) {
      const hasBacking = hasBackingDispatchRecord(
        dispatchRecords, REQUIRED_MANAGER, sd.minTsMs, sd.maxTsMs, sprintId,
      );
      if (!hasBacking) {
        findings.push({
          sprint_id: sprintId,
          manager: REQUIRED_MANAGER,
          evidence: `sprint has a manager_consult event for '${REQUIRED_MANAGER}' but no backing ok:true dispatch record correlated by sprint_id (or legacy clamped window) for this sprint (record-backed coverage required)`,
          finding_type: "missing_design_consult",
        });
      }
    }
  }

  const advisoryFindings = [];
  const applicableSet = new Set(applicableSprintIds);
  for (const sprintId of Object.keys(sprintData)) {
    const sd = sprintData[sprintId];
    if (!sd.authoringArtifact) continue;
    if (isSyntheticSprint(sprintId)) continue;
    const sprintDate = Object.hasOwn(sprintDates, sprintId) ? sprintDates[sprintId] : undefined;
    if (!sprintDate) continue;
    if (authoringExemptBefore && sprintDate < authoringExemptBefore) continue;
    if (!applicableSet.has(sprintId)) {
      applicableSet.add(sprintId);
      applicableSprintIds.push(sprintId);
      checked++;
    }
    if (!hasBackingDispatchRecord(dispatchRecords, AUTHORING_ROLE, sd.minTsMs, sd.maxTsMs, sprintId)) {
      advisoryFindings.push({
        sprint_id: sprintId,
        manager: AUTHORING_ROLE,
        evidence: `sprint produced a plan/design artifact (${sd.authoringEvidence}) but no backing ok:true '${AUTHORING_ROLE}' authorship dispatch record correlated by sprint_id was found (product-lead authoring required; report-only ramp)`,
        finding_type: "missing_product_lead_authoring",
      });
    }
  }

  return {
    findings,
    advisoryFindings,
    applicable: applicableSprintIds.length,
    checked,
    undatedExempt,
    malformedLines,
    windowDiscards,
  };
}

function formatFindingsTable(findings) {
  if (findings.length === 0) return "";
  const EVIDENCE_MAX = 64;
  let w0 = 6;
  let w1 = 7;
  let w2 = 20;
  for (const f of findings) {
    w0 = Math.min(28, Math.max(w0, (f.sprint_id || "").length));
    w1 = Math.min(16, Math.max(w1, (f.manager || "").length));
    w2 = Math.min(24, Math.max(w2, (f.finding_type || "").length));
  }
  const pad = (s, w) => String(s == null ? "-" : s).slice(0, w).padEnd(w);
  const trunc = (s, w) => {
    const str = String(s == null ? "" : s);
    return str.length > w ? str.slice(0, w - 1) + "…" : str.padEnd(w);
  };
  const header = [pad("SPRINT", w0), pad("MANAGER", w1), pad("FINDING_TYPE", w2), "EVIDENCE"].join("  ");
  const separator = ["-".repeat(w0), "-".repeat(w1), "-".repeat(w2), "-".repeat(EVIDENCE_MAX)].join("  ");
  const rows = findings.map((f) =>
    [pad(f.sprint_id, w0), pad(f.manager, w1), pad(f.finding_type, w2), trunc(f.evidence, EVIDENCE_MAX)].join("  "),
  );
  return [header, separator, ...rows].join("\n");
}

if (require.main === module) {
  if (sinceIdx !== -1) {
    const sinceVal = process.argv[sinceIdx + 1];
    if (!sinceVal || sinceVal.startsWith("--")) {
      process.stderr.write(
        `ERROR [sprint-manager-consult] --since requires a value (YYYY-MM-DD); none provided\n`,
      );
      process.exit(2);
    }
    if (!validateIsoDate(sinceVal)) {
      process.stderr.write(
        `ERROR [sprint-manager-consult] invalid --since value: "${sinceVal}" — must be a valid ISO date YYYY-MM-DD\n`,
      );
      process.exit(2);
    }
  }
  if (telemetryIdx !== -1) {
    const v = process.argv[telemetryIdx + 1];
    if (!v || v.startsWith("--") || !validateIsoDate(v)) {
      process.stderr.write(`ERROR [sprint-manager-consult] --telemetry-only-before requires a valid ISO date YYYY-MM-DD\n`);
      process.exit(2);
    }
  }

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

  rawEvents = excludeFixtureEvents(rawEvents);

  let dispatchRecords = [];
  const dispatchPath =
    mcEnv.readEnv("DISPATCH_COMPLETIONS_FILE") ||
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime || "", "dispatch-completions.jsonl");
  try {
    const raw = fs.readFileSync(dispatchPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { dispatchRecords.push(JSON.parse(line)); } catch { }
    }
  } catch { }

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

  const result = computeFindings(rawEvents, sprintDates, CUTOFF, dispatchRecords, { telemetryOnlyBefore: TELEMETRY_CUTOFF });
  result.malformedLines = (result.malformedLines || 0) + malformedCount;

  if (result.applicable === 0) {
    if (JSON_OUT) {
      console.log(
        JSON.stringify({
          ok: true,
          applicable: 0,
          reason: "no_applicable_sprints",
          cutoff: CUTOFF,
          authoringCutoff: AUTHORING_EXEMPT_BEFORE,
          advisoryFindings: [],
          totalAdvisory: 0,
          undatedExempt: result.undatedExempt,
        }),
      );
    } else {
      console.log(
        `OK   [sprint-manager-consult] no applicable design-touching sprints in window (cutoff ${CUTOFF || "none"}) — nothing to audit`,
      );
    }
    process.exit(0);
  }

  const ok = result.findings.length === 0;
  const windowDiscards = result.windowDiscards || [];
  const advisoryFindings = result.advisoryFindings || [];
  if (JSON_OUT) {
    const jsonOut = {
      ok,
      applicable: result.applicable,
      checked: result.checked,
      findings: result.findings.slice(0, 30),
      totalFindings: result.findings.length,
      advisoryFindings: advisoryFindings.slice(0, 30),
      totalAdvisory: advisoryFindings.length,
      cutoff: CUTOFF,
      authoringCutoff: AUTHORING_EXEMPT_BEFORE,
      undatedExempt: result.undatedExempt,
      malformedLines: result.malformedLines,
      windowDiscards: windowDiscards.slice(0, 30),
    };
    if (result.findings.length > 30) jsonOut.truncated = true;
    console.log(JSON.stringify(jsonOut));
  } else {
    for (const d of windowDiscards) {
      process.stderr.write(`INFO [sprint-manager-consult] ${d.sprint_id}: ${d.evidence}\n`);
    }
    if (ok) {
      console.log(
        `OK   [sprint-manager-consult] ${result.checked} design-touching sprint(s) checked, 0 findings`,
      );
    } else {
      process.stderr.write(
        `FAIL [sprint-manager-consult] ${result.findings.length} finding(s) (${result.checked} sprint(s) checked, cutoff ${CUTOFF || "none"}):\n\n`,
      );
      process.stderr.write(formatFindingsTable(result.findings.slice(0, 10)) + "\n");
      if (result.findings.length > 10) {
        process.stderr.write(`\n  ... and ${result.findings.length - 10} more\n`);
      }
    }
    if (advisoryFindings.length > 0) {
      process.stderr.write(
        `\nINFO [sprint-manager-consult] ${advisoryFindings.length} report-only authoring advisory(ies) (missing_product_lead_authoring):\n\n`,
      );
      process.stderr.write(formatFindingsTable(advisoryFindings.slice(0, 10)) + "\n");
    }
  }
  process.exit(ok ? 0 : 1);
}

module.exports = {
  computeFindings,
  validateIsoDate,
  tsWithinHorizon,
  sprintAnchorMs,
  extractYamlDate,
  LEGACY_EXEMPT_BEFORE,
  TELEMETRY_ONLY_BEFORE,
  REQUIRED_MANAGER,
  DESIGN_TOUCH_MANAGERS,
  WINDOW_HARD_CAP_MS,
  AUTHORING_EXEMPT_BEFORE,
  AUTHORING_ROLE,
  AUTHORING_PHASES,
};
