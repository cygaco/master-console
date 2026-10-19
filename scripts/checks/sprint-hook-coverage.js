#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const hookPoints = require("../sprint/hook-points");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const { excludeFixtureEvents } = require("../lib/fixture-event-ids");

const LEGACY_EXEMPT_BEFORE = null;

const TELEMETRY_ONLY_BEFORE = null;

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

const SYNTHETIC_SPRINT_PREFIXES = ["SP-J", "SP-TEST"];
function isSyntheticSprint(sprintId) {
  return SYNTHETIC_SPRINT_PREFIXES.some((p) => String(sprintId).startsWith(p));
}

const JSON_OUT = process.argv.includes("--json");
const sinceIdx = process.argv.indexOf("--since");
const CUTOFF = sinceIdx !== -1 && process.argv[sinceIdx + 1] ? process.argv[sinceIdx + 1] : LEGACY_EXEMPT_BEFORE;

const EVENT_FIELDS = ["kind", "manager", "mode", "unit", "verdict", "sprint_id", "ui_touched", "phase", "ts"];
function getEventFields(rec) {
  if (!rec || typeof rec !== "object") return {};
  const d = rec.data && typeof rec.data === "object" ? rec.data : {};
  const merged = { ...d };
  if (rec.cat !== undefined) merged.cat = rec.cat;
  if (rec.sprint_id !== undefined && merged.sprint_id === undefined) merged.sprint_id = rec.sprint_id;
  for (const k of EVENT_FIELDS) if (rec[k] !== undefined) merged[k] = rec[k];
  return merged;
}

function validateIsoDate(val) {
  if (typeof val !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const d = new Date(val + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === val;
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

function extractYamlDate(text) {
  if (!text) return null;
  const m = text.match(/(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m && validateIsoDate(m[1]) ? m[1] : null;
}

function loadSprintDates() {
  const dates = {};
  const sprintsDir = PATHS.sprintSprints;
  if (sprintsDir && fs.existsSync(sprintsDir)) {
    let entries = [];
    try { entries = fs.readdirSync(sprintsDir); } catch { }
    for (const entry of entries) {
      try {
        const cur = path.join(sprintsDir, entry, "current.yaml");
        if (fs.existsSync(cur)) {
          const date = extractYamlDate(fs.readFileSync(cur, "utf8"));
          if (date) dates[entry] = date;
        }
      } catch { }
    }
  }
  const reg = PATHS.sprintActiveRegistry;
  if (reg && fs.existsSync(reg)) {
    try {
      const text = fs.readFileSync(reg, "utf8");
      for (const chunk of text.split(/^(?=\s*-\s)/m).filter(Boolean)) {
        const idM = chunk.match(/\bid\s*:\s*["']?(\S+?)["']?\s*$/m);
        const dM = chunk.match(/(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        if (idM && dM) { const id = idM[1].replace(/['"]/g, ""); if (!dates[id]) dates[id] = dM[1]; }
      }
    } catch { }
  }
  return dates;
}

function ticketFieldsFor(sprintId) {
  const out = [];
  const dir = PATHS.sprintTickets;
  if (!dir || !fs.existsSync(dir)) return out;
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!/\.(ya?ml|json)$/.test(f)) continue;
    let text;
    try { text = fs.readFileSync(path.join(dir, f), "utf8"); } catch { continue; }
    const get = (k) => {
      const m = text.match(new RegExp(`^\\s*${k}\\s*:\\s*["']?([A-Za-z0-9_-]+)`, "m"));
      return m ? m[1] : null;
    };
    if (get("sprint") !== sprintId) continue;
    out.push({ unit_type: get("unit_type"), domain: get("domain"), type: get("type"), risk_level: get("risk_level") });
  }
  return out;
}

function computeFindings(events, registry, compositionBySprint = {}, sprintDates = {}, cutoff = LEGACY_EXEMPT_BEFORE, dispatchRecords = [], opts = {}) {
  const telemetryOnlyBefore = opts.telemetryOnlyBefore !== undefined ? opts.telemetryOnlyBefore : TELEMETRY_ONLY_BEFORE;
  const findings = [];
  const info = [];

  const bySprint = Object.create(null);
  for (const rec of events) {
    const f = getEventFields(rec);
    const sid = f.sprint_id;
    if (!sid) continue;
    const isConsult = f.cat === "manager_consult" || (f.manager && !f.kind);
    const isRun = typeof f.kind === "string" && f.kind.startsWith("sprint_full");
    if (!isConsult && !isRun) continue;
    if (!bySprint[sid]) bySprint[sid] = { run: false, consulted: new Set(), minTsMs: null, maxTsMs: null, discardedTs: [] };
    if (isRun) bySprint[sid].run = true;
    if (isConsult && f.manager) bySprint[sid].consulted.add(String(f.manager));
    const evTs = parseTs(f.ts);
    if (evTs !== null) {
      const anchorMs = sprintAnchorMs(sprintDates, sid);
      if (!tsWithinHorizon(evTs, anchorMs)) {
        bySprint[sid].discardedTs.push(new Date(evTs).toISOString());
      } else {
        if (bySprint[sid].minTsMs === null || evTs < bySprint[sid].minTsMs) bySprint[sid].minTsMs = evTs;
        if (bySprint[sid].maxTsMs === null || evTs > bySprint[sid].maxTsMs) bySprint[sid].maxTsMs = evTs;
      }
    }
  }

  const applicable = [];
  let undatedExempt = 0;
  let checked = 0;
  const STEPS = hookPoints.STEPS;

  for (const sid of Object.keys(bySprint)) {
    const sd = bySprint[sid];
    if (!sd.run) continue;
    if (isSyntheticSprint(sid)) continue;
    const date = Object.hasOwn(sprintDates, sid) ? sprintDates[sid] : undefined;
    if (!date) { undatedExempt++; continue; }
    if (cutoff && date < cutoff) continue;

    applicable.push(sid);
    checked++;
    if (sd.discardedTs.length) {
      for (const iso of sd.discardedTs) {
        info.push({
          sprint_id: sid,
          finding_type: "window_ts_discarded",
          evidence: `event ts ${iso} outside sane sprint horizon (created_at ± cap) — discarded from window derivation`,
        });
      }
    }
    const composition = compositionBySprint[sid] || {};
    const isPostRecordBacked = !telemetryOnlyBefore || date >= telemetryOnlyBefore;
    for (const step of STEPS) {
      for (const row of hookPoints.agentsForStep(step, composition, registry)) {
        const hasTelemetry = sd.consulted.has(row.role);
        if (row.mode === "block") {
          let covered = hasTelemetry;
          if (hasTelemetry && isPostRecordBacked) {
            covered = hasBackingDispatchRecord(dispatchRecords, row.role, sd.minTsMs, sd.maxTsMs, sid, opts);
          }
          if (!covered) {
            findings.push({
              sprint_id: sid, role: row.role, step, mode: row.mode,
              finding_type: "missing_block_agent",
              evidence: hasTelemetry
                ? `block-row ${row.role}@${step} has a manager_consult record but no backing ok:true dispatch record correlated by sprint_id (or legacy clamped window) for this sprint (record-backed predicate)`
                : `block-row ${row.role}@${step} matched the composition but no manager_consult record exists for this run`,
            });
          }
        } else {
          if (!hasTelemetry) {
            info.push({
              sprint_id: sid, role: row.role, step, mode: row.mode,
              finding_type: "missing_advisory_agent",
              evidence: `advisory-row ${row.role}@${step} matched but did not run (informational)`,
            });
          }
        }
      }
    }
  }

  return { findings, info, applicable: applicable.length, checked, undatedExempt };
}

function reverseCoverage(registry, roleIds) {
  return hookPoints.validate(registry, roleIds);
}

function knownSprintIds() {
  const ids = new Set();
  const dir = PATHS.sprintSprints;
  if (dir && fs.existsSync(dir)) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { }
    for (const e of entries) if (e.isDirectory()) ids.add(e.name);
  }
  const reg = PATHS.sprintActiveRegistry;
  if (reg && fs.existsSync(reg)) {
    try {
      const text = fs.readFileSync(reg, "utf8");
      for (const m of text.matchAll(/^\s*-\s*id\s*:\s*["']?(\S+?)["']?\s*$/gm)) ids.add(m[1].replace(/['"]/g, ""));
    } catch { }
  }
  return [...ids].filter((id) => !isSyntheticSprint(id));
}

function emptyGauntletRosterFindings(registry) {
  const findings = [];
  for (const sid of knownSprintIds()) {
    let comp;
    try {
      comp = hookPoints.compositionFromTickets(ticketFieldsFor(sid));
    } catch {
      continue;
    }
    const agents = hookPoints.agentsForStep("gauntlet", comp, registry);
    const blockAgents = agents.filter((a) => a.mode === "block");
    if (blockAgents.length === 0) {
      findings.push({
        sprint_id: sid,
        kind: "empty_gauntlet_roster",
        evidence: `gauntlet step resolves to ${agents.length === 0 ? "ZERO agents" : "zero BLOCK agents"} for composition ${JSON.stringify(comp)} — a vacuous-green gauntlet`,
      });
    }
  }
  return findings;
}

function main() {
  if (sinceIdx !== -1) {
    const v = process.argv[sinceIdx + 1];
    if (!v || v.startsWith("--") || !validateIsoDate(v)) {
      process.stderr.write(`ERROR [sprint-hook-coverage] invalid --since (need YYYY-MM-DD)\n`);
      return 2;
    }
  }

  let registry, roleIds;
  try {
    registry = hookPoints.load();
    roleIds = hookPoints.loadRoleIds();
  } catch (e) {
    process.stderr.write(`ERROR [sprint-hook-coverage] cannot read registry/roster: ${e.message}\n`);
    return 2;
  }

  const rev = reverseCoverage(registry, roleIds);
  if (!rev.ok) {
    process.stderr.write(
      `FAIL [sprint-hook-coverage] registry structurally incoherent (${rev.errors.length}):\n${rev.errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 2;
  }

  const emptyRosterFindings = emptyGauntletRosterFindings(registry);
  if (emptyRosterFindings.length) {
    process.stderr.write(`FAIL [sprint-hook-coverage] ${emptyRosterFindings.length} sprint(s) resolve to an empty/zero-block gauntlet roster:\n`);
    for (const f of emptyRosterFindings.slice(0, 15)) process.stderr.write(`  - ${f.sprint_id}: ${f.evidence}\n`);
    if (emptyRosterFindings.length > 15) process.stderr.write(`  ... and ${emptyRosterFindings.length - 15} more\n`);
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, reason: "empty_gauntlet_roster", findings: emptyRosterFindings }));
    return 1;
  }

  let rawEvents = [];
  const eventsPath = mcEnv.readEnv("EVENTS_FILE") || PATHS.eventsFile;
  try {
    for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rawEvents.push(JSON.parse(line)); } catch { }
    }
  } catch { }

  rawEvents = excludeFixtureEvents(rawEvents);

  let dispatchRecords = [];
  const dispatchPath =
    mcEnv.readEnv("DISPATCH_COMPLETIONS_FILE") ||
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime || "", "dispatch-completions.jsonl");
  try {
    for (const line of fs.readFileSync(dispatchPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { dispatchRecords.push(JSON.parse(line)); } catch { }
    }
  } catch { }

  const sprintDates = loadSprintDates();
  const compositionBySprint = {};
  const seen = new Set(rawEvents.map((r) => getEventFields(r).sprint_id).filter(Boolean));
  for (const sid of seen) {
    compositionBySprint[sid] = hookPoints.compositionFromTickets(ticketFieldsFor(sid));
  }

  const res = computeFindings(rawEvents, registry, compositionBySprint, sprintDates, CUTOFF, dispatchRecords);

  if (res.applicable === 0) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, applicable: 0, reason: "no_applicable_sprints", cutoff: CUTOFF }));
    else console.log(`OK   [sprint-hook-coverage] registry coherent (${registry.rows.length} rows); no applicable sprint runs to audit (cutoff ${CUTOFF || "none"})`);
    return 0;
  }

  const ok = res.findings.length === 0;
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok, applicable: res.applicable, checked: res.checked, findings: res.findings.slice(0, 50), info: res.info.length, totalFindings: res.findings.length, cutoff: CUTOFF }));
  } else if (ok) {
    console.log(`OK   [sprint-hook-coverage] ${res.checked} sprint run(s) checked, 0 forward gaps (${res.info.length} advisory-not-run, informational); registry coherent`);
  } else {
    process.stderr.write(`FAIL [sprint-hook-coverage] ${res.findings.length} forward coverage gap(s) (${res.checked} run(s) checked, cutoff ${CUTOFF || "none"}):\n`);
    for (const f of res.findings.slice(0, 15)) process.stderr.write(`  - ${f.sprint_id}: ${f.evidence}\n`);
    if (res.findings.length > 15) process.stderr.write(`  ... and ${res.findings.length - 15} more\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { computeFindings, reverseCoverage, getEventFields, validateIsoDate, tsWithinHorizon, sprintAnchorMs, extractYamlDate, LEGACY_EXEMPT_BEFORE, TELEMETRY_ONLY_BEFORE, WINDOW_HARD_CAP_MS, knownSprintIds, emptyGauntletRosterFindings };
