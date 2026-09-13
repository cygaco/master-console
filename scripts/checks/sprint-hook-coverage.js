#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

// scan:sprint-hook-coverage — BIDIRECTIONAL coverage of the sprint hook-point registry
// (.claude/agents/_org/sprint-hook-points.json). Phase D F3c. The "easily find gaps"
// enforcer the operator asked for, made self-detecting on the agent<->sprint surface.
//
// FORWARD (per /sprint:full run): for every hook-point row whose condition MATCHED the
//   run's composition with mode:"block", a manager_consult record for that role must
//   exist over the run window — else `missing_block_agent` (a required agent declared at
//   a step never ran). Advisory rows that didn't run are reported as info, not findings.
//
// REVERSE (static, registry-only): the registry is structurally coherent — every row's
//   role exists in role-registry, every step is canonical, no step is orphaned. Delegates
//   to hook-points.validate() (the same tripwire its own test asserts).
//
// SCOPE = SPRINTS (mirrors sprint-manager-consult): the unit of audit is a /sprint:full
//   run, attributed by sprint_id; per-sprint composition is derived from the sprint's
//   ticket files (the same source full.js feeds the router).
//
// Date-cutoff: sprints before the F3b wiring date are LEGACY/exempt (flagging them would
//   be a false positive). Graceful-empty: no applicable sprints -> exit 0. Fail-closed:
//   a bad --since, or an unreadable/structurally-broken registry -> exit 2.
//
// See .claude/commands/scan/sprint-hook-coverage.md for the full spec.

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const hookPoints = require("../sprint/hook-points");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");

// ── Constants ─────────────────────────────────────────────────────────────────

// The F3b manager_consult emitter wiring date — sprints before predate the mechanism.
const WIRE_DATE = "2026-06-05";

/**
 * ISO date after which a matching manager_consult telemetry record alone is insufficient
 * for block-row coverage — a backing ok:true dispatch completion record is ALSO required,
 * correlated by role + sprint event time window. Sprints before this date keep the old
 * telemetry-only predicate (no retroactive reds).
 * Citing E-DISPATCH-INTEGRITY-001 F-1 (RC-2 sprint-theater prevention).
 */
const RECORD_BACKED_CUTOFF = "2026-06-10";

/** Buffer (ms) around the sprint event time window when correlating dispatch records. */
const SPRINT_WINDOW_BUFFER_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * R-4 (SP-20260611-001) — spoofed-ts window clamp. events.jsonl `f.ts` is UNTRUSTED
 * (spoofable). A planted extreme ts (1970/2099) would widen the derived sprint window
 * to ~infinity, capturing any historic ok:true record. The window is therefore clamped
 * to a sane horizon anchored on the sprint's TRUSTED created_at (from the sprint dates
 * map): event ts outside [created_at - cap, created_at + cap] are DISCARDED from window
 * derivation. If no trusted anchor exists for a sprint, EVERY ts is DISCARDED (fail
 * closed) — an unverifiable ts must never widen the window, so an all-outlier / no-anchor
 * set derives an empty window and the downstream null-window guard fails closed.
 *
 * NOTE (AC-X.2, β design HOW): this clamp is DUPLICATED byte-for-byte in
 * scripts/checks/sprint-manager-consult.js (the same exploit, two sites). No shared-lib
 * extraction this sprint (blast-radius bound); the duplication is a logged follow-up.
 */
const WINDOW_HARD_CAP_MS = 14 * 24 * 60 * 60 * 1000; // 14 days each side of created_at

/**
 * Resolve a sprint's TRUSTED horizon anchor (created_at) to epoch ms, or null when no
 * trusted date is known. sprintDates carries "YYYY-MM-DD" (date-only) per sprint id.
 */
function sprintAnchorMs(sprintDates, sprintId) {
  if (!sprintDates || !Object.hasOwn(sprintDates, sprintId)) return null;
  const d = sprintDates[sprintId];
  if (typeof d !== "string") return null;
  const t = Date.parse(d + "T00:00:00Z");
  return isNaN(t) ? null : t;
}

/**
 * R-4 clamp predicate: is `evTs` inside the sane sprint horizon (anchor ± hard cap)?
 * With NO trusted anchor the ts cannot be validated against a sane window, so it is
 * UNTRUSTED and DISCARDED (fail closed). Keeping it (the old fail-OPEN) let a planted
 * extreme ts widen the window to ~infinity and neutralize the clamp — the very exploit
 * R-4 closes. An all-outlier / no-anchor set therefore derives an EMPTY window, and the
 * downstream `minTsMs === null` fail-closed guard correctly fires (no false-green).
 */
function tsWithinHorizon(evTs, anchorMs) {
  if (anchorMs === null) return false; // no trusted anchor — DISCARD (an unverifiable ts must never widen the window)
  return evTs >= anchorMs - WINDOW_HARD_CAP_MS && evTs <= anchorMs + WINDOW_HARD_CAP_MS;
}

// Synthetic/test sprint prefixes — exempt from the LIVE corpus audit.
const SYNTHETIC_SPRINT_PREFIXES = ["SP-J", "SP-TEST"];
function isSyntheticSprint(sprintId) {
  return SYNTHETIC_SPRINT_PREFIXES.some((p) => String(sprintId).startsWith(p));
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

const JSON_OUT = process.argv.includes("--json");
const sinceIdx = process.argv.indexOf("--since");
const CUTOFF = sinceIdx !== -1 && process.argv[sinceIdx + 1] ? process.argv[sinceIdx + 1] : WIRE_DATE;

// ── Field extraction (robust to top-level + data-nested placement) ────────────

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

// F-1: check whether a backing ok:true dispatch record exists for `role` within the
// sprint event time window ± SPRINT_WINDOW_BUFFER_MS.
//
// R-5 (SP-20260611-001) — sprint_id-preferring correlation. The time window alone lets
// a CONCURRENT sprint's record (overlapping window, DIFFERENT sprint_id) falsely green
// this sprint. So sprint_id NARROWS the match (never widens it):
//   - rec carries sprint_id → it MUST equal `sprintId` (a different sprint_id NEVER
//     correlates, even inside the window) — this is the preferred correlation.
//   - rec lacks sprint_id (legacy/pre-W0) → time-window fallback, on the R-4 CLAMPED
//     window passed in (the fallback does not re-open the spoof-widening leak).
//   - In BOTH cases the (clamped) time-window check still applies — a sprint_id match
//     OUTSIDE the window does NOT correlate (defense-in-depth, redteam case).
// `sprintId` is optional: when absent (legacy callers), behavior is the original
// time-window-only correlation.
function hasBackingDispatchRecord(dispatchRecords, role, minTsMs, maxTsMs, sprintId, opts = {}) {
  // SP-20260718-004 gauntlet R4 (β DIRECTIVE): route the ok:true backing check through the SAME-SESSION
  // liveness choke-point so a forged/unsigned record cannot back a hook-coverage claim. Default TRUE (live);
  // tests injecting unsigned fixture records pass opts.requireSignature:false.
  const requireSignature = opts.requireSignature !== false;
  if (!Array.isArray(dispatchRecords) || dispatchRecords.length === 0) return false;
  // Defense-in-depth (claude qa lane 2026-06-10): no parseable sprint window →
  // no record can be correlated → fail closed (mirror of sprint-manager-consult).
  if (minTsMs === null && maxTsMs === null) return false;
  const wantSprint = sprintId !== undefined && sprintId !== null ? String(sprintId).trim() : null;
  return dispatchRecords.some((rec) => {
    if (!isVerifiedLivenessRecord(rec, { requireSignature })) return false; // ok:true AND valid origin-proof sig
    if (typeof rec.role !== "string" || rec.role.trim() !== role) return false;
    // R-5: sprint_id narrows. A record STAMPED for a sprint (a non-empty string id)
    // must match — a different stamped id never correlates. A record with NO stamp
    // (field absent, null, or empty — the pre-W0/unstamped sentinel) falls through to
    // the time-window fallback below (the dispatcher writes sprint_id:null when
    // MC_SPRINT_ID is unset; null is "unstamped", NOT "stamped for sprint null").
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
  // R-4 (B4c): the regex matches a structurally-shaped string, NOT a real date —
  // "9999-99-99" / "2026-13-45" pass the shape but are not valid calendar dates.
  // Round-trip validate so an unparseable date never becomes a candidate anchor; an
  // invalid match → null (no anchor → fail closed) rather than a NaN anchor.
  return m && validateIsoDate(m[1]) ? m[1] : null;
}

// ── Filesystem loaders (sprint dates + per-sprint composition) ────────────────

function loadSprintDates() {
  const dates = {};
  const sprintsDir = PATHS.sprintSprints;
  if (sprintsDir && fs.existsSync(sprintsDir)) {
    let entries = [];
    try { entries = fs.readdirSync(sprintsDir); } catch { /* ignore */ }
    for (const entry of entries) {
      try {
        const cur = path.join(sprintsDir, entry, "current.yaml");
        if (fs.existsSync(cur)) {
          const date = extractYamlDate(fs.readFileSync(cur, "utf8"));
          if (date) dates[entry] = date;
        }
      } catch { /* skip */ }
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
    } catch { /* ignore */ }
  }
  return dates;
}

// Minimal ticket-field reader (avoids a YAML dep): pull sprint, unit_type, domain, type,
// risk_level out of each ticket file under paths.sprintTickets. compositionFromTickets
// then aggregates. Best-effort — unreadable files are skipped.
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

// ── Core compute (exported, pure given its inputs) ────────────────────────────

/**
 * @param {object[]} events              parsed event records
 * @param {object}   registry            the hook-point registry
 * @param {object}   compositionBySprint map sprint_id -> { unit_types, max_risk, domains }
 * @param {object}   sprintDates         map sprint_id -> "YYYY-MM-DD"
 * @param {string}   cutoff              ISO date — sprints before are exempt
 * @param {object[]} dispatchRecords     completion records from dispatch-completions.jsonl
 *                                        (F-1 record-backed check, post-RECORD_BACKED_CUTOFF only)
 * @returns {{ findings, info, applicable, checked, undatedExempt }}
 */
function computeFindings(events, registry, compositionBySprint = {}, sprintDates = {}, cutoff = WIRE_DATE, dispatchRecords = []) {
  const findings = [];
  const info = [];

  // bucket: per sprint — was there a run, which managers were consulted, and event time window.
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
    // F-1: track sprint event time window for backing-record correlation.
    // R-4: clamp to the sane sprint horizon (trusted created_at ± hard cap) so an
    // UNTRUSTED spoofed ts (1970/2099) cannot widen the window. Out-of-horizon ts are
    // DISCARDED from window derivation (recorded for the C-4 note) rather than fail-open.
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
    if (!sd.run) continue; // only audit attributed /sprint:full runs
    if (isSyntheticSprint(sid)) continue;
    const date = Object.hasOwn(sprintDates, sid) ? sprintDates[sid] : undefined;
    if (!date) { undatedExempt++; continue; }
    if (date < cutoff) continue;

    applicable.push(sid);
    checked++;
    // R-4 (C-4): surface any event ts the horizon clamp discarded, so a spoof attempt
    // is diagnosable rather than silent.
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
    const isPostRecordBacked = date >= RECORD_BACKED_CUTOFF;
    for (const step of STEPS) {
      for (const row of hookPoints.agentsForStep(step, composition, registry)) {
        const hasTelemetry = sd.consulted.has(row.role);
        if (row.mode === "block") {
          // F-1: post-RECORD_BACKED_CUTOFF block rows require BOTH telemetry AND backing record.
          // R-5: correlate by sprint_id first (a different sprint_id never counts), then
          // the R-4 clamped time-window fallback for legacy records.
          let covered = hasTelemetry;
          if (hasTelemetry && isPostRecordBacked) {
            covered = hasBackingDispatchRecord(dispatchRecords, row.role, sd.minTsMs, sd.maxTsMs, sid);
          }
          if (!covered) {
            findings.push({
              sprint_id: sid, role: row.role, step, mode: row.mode,
              finding_type: "missing_block_agent",
              evidence: hasTelemetry
                ? `block-row ${row.role}@${step} has a manager_consult record but no backing ok:true dispatch record correlated by sprint_id (or legacy clamped window) for this sprint (E-DISPATCH-INTEGRITY-001 F-1, post-${RECORD_BACKED_CUTOFF})`
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

/** REVERSE: registry structural coherence (delegates to hook-points.validate). */
function reverseCoverage(registry, roleIds) {
  return hookPoints.validate(registry, roleIds);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  if (sinceIdx !== -1) {
    const v = process.argv[sinceIdx + 1];
    if (!v || v.startsWith("--") || !validateIsoDate(v)) {
      process.stderr.write(`ERROR [sprint-hook-coverage] invalid --since (need YYYY-MM-DD)\n`);
      return 2;
    }
  }

  // Load the registry + roster (fail-closed on unreadable/broken).
  let registry, roleIds;
  try {
    registry = hookPoints.load();
    roleIds = hookPoints.loadRoleIds();
  } catch (e) {
    process.stderr.write(`ERROR [sprint-hook-coverage] cannot read registry/roster: ${e.message}\n`);
    return 2;
  }

  // REVERSE first — a structurally broken registry is fail-closed (exit 2) regardless of runs.
  const rev = reverseCoverage(registry, roleIds);
  if (!rev.ok) {
    process.stderr.write(
      `FAIL [sprint-hook-coverage] registry structurally incoherent (${rev.errors.length}):\n${rev.errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 2;
  }

  // FORWARD — read events + per-sprint composition.
  let rawEvents = [];
  const eventsPath = mcEnv.readEnv("EVENTS_FILE") || PATHS.eventsFile;
  try {
    for (const line of fs.readFileSync(eventsPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rawEvents.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  } catch { /* missing events -> graceful empty */ }

  // Load dispatch completion records for F-1 backing-record check (post-RECORD_BACKED_CUTOFF)
  let dispatchRecords = [];
  const dispatchPath =
    mcEnv.readEnv("DISPATCH_COMPLETIONS_FILE") ||
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime || "", "dispatch-completions.jsonl");
  try {
    for (const line of fs.readFileSync(dispatchPath, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { dispatchRecords.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  } catch { /* missing or unreadable — graceful empty */ }

  const sprintDates = loadSprintDates();
  // Build composition per sprint that appears in events (cheap; only seen sprints).
  const compositionBySprint = {};
  const seen = new Set(rawEvents.map((r) => getEventFields(r).sprint_id).filter(Boolean));
  for (const sid of seen) {
    compositionBySprint[sid] = hookPoints.compositionFromTickets(ticketFieldsFor(sid));
  }

  const res = computeFindings(rawEvents, registry, compositionBySprint, sprintDates, CUTOFF, dispatchRecords);

  if (res.applicable === 0) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, applicable: 0, reason: "no_applicable_sprints", cutoff: CUTOFF }));
    else console.log(`OK   [sprint-hook-coverage] registry coherent (${registry.rows.length} rows); no applicable post-cutoff sprint runs to audit (cutoff ${CUTOFF})`);
    return 0;
  }

  const ok = res.findings.length === 0;
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok, applicable: res.applicable, checked: res.checked, findings: res.findings.slice(0, 50), info: res.info.length, totalFindings: res.findings.length, cutoff: CUTOFF }));
  } else if (ok) {
    console.log(`OK   [sprint-hook-coverage] ${res.checked} sprint run(s) checked, 0 forward gaps (${res.info.length} advisory-not-run, informational); registry coherent`);
  } else {
    process.stderr.write(`FAIL [sprint-hook-coverage] ${res.findings.length} forward coverage gap(s) (${res.checked} run(s) checked, cutoff ${CUTOFF}):\n`);
    for (const f of res.findings.slice(0, 15)) process.stderr.write(`  - ${f.sprint_id}: ${f.evidence}\n`);
    if (res.findings.length > 15) process.stderr.write(`  ... and ${res.findings.length - 15} more\n`);
  }
  return ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = { computeFindings, reverseCoverage, getEventFields, validateIsoDate, tsWithinHorizon, sprintAnchorMs, extractYamlDate, WIRE_DATE, RECORD_BACKED_CUTOFF, WINDOW_HARD_CAP_MS };
