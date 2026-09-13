#!/usr/bin/env node
// scan:sprint-beta-honesty — audit Beta consultation honesty across /sprint:full runs.
//
// Detects three finding types:
//   missing_consult       — a phase boundary was reached but no consult event recorded
//   placeholder_verdict   — consult event exists but is fake (legacy kind or empty fields)
//   escalate_without_halt — ESCALATE verdict with no corresponding beta_escalate halt
//
// Date-cutoff: sprints before SP003_SHIP_DATE are LEGACY and exempt.
// Graceful empty: no applicable sprints → exit 0 with informational message.
//
// See .claude/commands/scan/sprint-beta-honesty.md for full spec.

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PATHS } = require("../hooks/lib/paths");

// ── Constants ─────────────────────────────────────────────────────────────────

/** ISO date of SP-003 ship — sprints before this are LEGACY and exempt. */
const SP003_SHIP_DATE = "2026-05-25";

/**
 * The 4 phase boundaries where Beta MUST be consulted (per /sprint:full Step 5).
 * before_plan is NOT in this list — Beta gates apply to phases 2-5 only.
 */
const EXPECTED_BOUNDARIES = Object.freeze([
  "before_design",
  "before_execute",
  "before_release-prep",
  "before_retro",
]);

/**
 * Maps a phase name (from sprint_full_phase_started) to its consult boundary.
 * Only phases that have an expected boundary are included.
 */
const PHASE_TO_BOUNDARY = Object.freeze({
  design: "before_design",
  execute: "before_execute",
  "release-prep": "before_release-prep",
  retro: "before_retro",
});

// ── Canned-verdict detection (P-AP-1) ─────────────────────────────────────────
// β's /sprint:full phase-boundary verdicts were historically CANNED: across 1386+
// records they collapsed to ~3 hardcoded strings. The empty-message guard
// (placeholder_verdict) catches absent messages; this catches NON-SUBSTANTIVE ones.
// A substantive verdict is ≥40 chars AND carries SOME structure — a decision token
// OR a grounding reference (the LENIENT "or": classifyCanned flags only when BOTH
// are absent, keeping false-positives low; real verdicts carry both). Tuned against
// the real corpus: real verdicts ≥96 chars + structured; canned ≤34 chars + bare.
// This is a DETERMINISTIC string/structure check — NO model judgment, so β cannot
// influence, be prompted past, or rationalize around it (the self-reference trap the
// sleep-cycle abstraction names: "a self-checking thing cannot check itself").
const MIN_SUBSTANTIVE_LEN = 40;
// (a) decision/verdict token — the schema β is supposed to emit (beta.md DECISION/CLASS/CONFIDENCE).
const VERDICT_TOKEN_RE = /\b(DECIDE|DIRECTIVE|ESCALATE|DECISION|CLASS\s+[ABC]\b|conf(?:idence)?|0\.\d{2})\b/i;
// (b) grounding reference — a ticket/sprint/precedent id or an explicit reasoning connective.
const GROUNDING_RE = /\b(SP-\d|T-\d|EVT-|RI-\d|DP-|LRN-|L-20|ADR-|per\b|because\b|precedent|rubric|reversib|blast[- ]radius|trade-?off)\b/i;
// Cross-sprint template reuse threshold (C4).
const CROSS_SPRINT_TEMPLATE_THRESHOLD = 3;
// Synthetic/test sprint prefixes — exempt from the live AUDIT (they carry deliberate
// canned fixtures). classifyCanned still classifies them in unit tests; this exemption
// only scopes the corpus audit. The date-cutoff + undated-exempt already filters most.
const SYNTHETIC_SPRINT_PREFIXES = ["SP-J"];

function isSyntheticSprint(sprintId) {
  return SYNTHETIC_SPRINT_PREFIXES.some((p) => String(sprintId).startsWith(p));
}

/**
 * Normalize a message for duplicate detection (C3/C4): lowercase, strip punctuation,
 * collapse whitespace. Conservative (exact-after-normalize) to avoid flagging two
 * genuinely-different verdicts that merely share a phrase. Exported for tests.
 */
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
  if (trimmed.length < MIN_SUBSTANTIVE_LEN) return "canned_too_short"; // C1
  const hasToken = VERDICT_TOKEN_RE.test(trimmed);
  const hasGrounding = GROUNDING_RE.test(trimmed);
  if (!hasToken && !hasGrounding) return "canned_unstructured"; // C2: bare boilerplate
  return null;
}

// ── Finding fingerprint (ED-049 waiver identity) ──────────────────────────────
//
// A waiver (see beta-honesty-triage.js) sanctions ONE finding by its fingerprint,
// so the audit can drop already-triaged historical findings while still blocking
// on NEW ones. The fingerprint MUST be invariant to:
//   • checker version   (don't hash the rendered `evidence` string)
//   • threshold retunes  (e.g. MIN_SUBSTANTIVE_LEN — its literal appears in evidence)
//   • corpus growth      (cross-boundary/cross-sprint evidence embeds a live COUNT —
//                         "across N sprints" — that changes as more sprints match)
// β's HOW-fix (DECIDE B 0.88, 2026-06-12): hash STABLE RECORD FIELDS ONLY, never the
// checker-rendered evidence. The raw beta_message is an immutable record field; the
// rendered count/threshold literals are not. For findings with no beta_message
// (missing_consult), the (sprint_id | finding_type | phase_boundary) tuple already
// uniquely identifies the finding.
function fingerprintFinding({ sprint_id, finding_type, phase_boundary, beta_message, actual_event }) {
  const tuple = [
    String(sprint_id || ""),
    String(finding_type || ""),
    String(phase_boundary || ""),
    normalizeMessage(beta_message || ""), // raw message, normalized (idempotent)
    String(actual_event || ""),
  ].join("\u001f");
  return crypto.createHash("sha256").update(tuple).digest("hex");
}

/**
 * Stamp a finding object with its stable fingerprint and return it. phase_boundary
 * is taken from the finding's own `expected_consult` (the `before_*` boundary, or
 * null → ""); `rawBetaMessage` is the IMMUTABLE record message (not the rendered
 * evidence). Used at every finding-emit site so the fingerprint is computed from
 * record fields, never from the checker-rendered prose.
 */
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

// ── Waiver ledger (ED-049) ────────────────────────────────────────────────────
//
// A VALID waiver carries a hex fingerprint + a non-empty reason + a non-empty
// approver. Anything else is IGNORED (fail-closed): a malformed/incomplete waiver
// never drops a finding — the finding still blocks. This matches the false-green
// hardening rule (malformed → fail-closed, never fail-open).
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

/**
 * Load the waiver ledger into a Set of valid waived fingerprints.
 * Fail-closed per-line: a corrupt/unparseable JSONL line drops THAT waiver only,
 * never throws, never wildcards. A missing file → empty Set (nothing waived).
 * Exported for tests.
 */
function loadWaivers(filePath) {
  const set = new Set();
  if (!filePath || !fs.existsSync(filePath)) return set;
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return set; // unreadable ledger → waive nothing (fail-closed)
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let w;
    try {
      w = JSON.parse(line);
    } catch {
      continue; // corrupt line dropped — never throws, the rest still audits
    }
    if (isValidWaiver(w)) set.add(w.fingerprint.toLowerCase());
  }
  return set;
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

const JSON_OUT = process.argv.includes("--json");
// --no-waivers: audit the RAW findings, ignoring the ED-049 waiver ledger. Used by
// the triage tool to enumerate everything (waived + un-waived) before waiving.
const NO_WAIVERS = process.argv.includes("--no-waivers");
const sinceIdx = process.argv.indexOf("--since");
const CUTOFF =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1]
    : SP003_SHIP_DATE;

// ── Field extraction — robust to top-level and data-nested placement ──────────
//
// The logger writes: log("audit", { kind, ...data }, ...) → event.data = { kind, ...data }
// So sprint_full_* fields live under rec.data in the canonical format.
// Be robust to both data-nested AND top-level placement (e.g. future schema changes).

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
  // Start from data-nested fields, then let top-level override (top-level wins)
  const merged = { ...d };
  for (const k of EVENT_FIELDS) {
    if (rec[k] !== undefined) merged[k] = rec[k];
  }
  return merged;
}

// ── Simple YAML date extractor (only needs created_at / start_date / start) ──

function extractYamlDate(text) {
  if (!text) return null;
  const m = text.match(/(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return m ? m[1] : null;
}

// ── ISO date validator ─────────────────────────────────────────────────────────

/**
 * Returns true iff val is a real ISO date string (YYYY-MM-DD with valid calendar date).
 * Used to fail-closed on bogus --since values. Exported for tests.
 *
 * Round-trip check: V8 silently rolls over impossible calendar dates rather than
 * returning NaN (e.g. "2026-02-30" → Date for 2026-03-02). We parse the string as
 * a UTC Date, re-format it back to YYYY-MM-DD (UTC), and require equality with the
 * input. If they differ, the input contained an overflow/rollover date → invalid.
 */
function validateIsoDate(val) {
  if (typeof val !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const d = new Date(val + "T00:00:00Z");
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === val;
}

// ── Load sprint start dates from filesystem ───────────────────────────────────

function loadSprintDates() {
  const dates = {};

  // 1. Per-sprint current.yaml under paths.sprintSprints/<SP-id>/current.yaml
  const sprintsDir = PATHS.sprintSprints;
  if (sprintsDir && fs.existsSync(sprintsDir)) {
    let entries = [];
    try {
      entries = fs.readdirSync(sprintsDir);
    } catch { /* ignore */ }
    for (const entry of entries) {
      try {
        const currentYaml = path.join(sprintsDir, entry, "current.yaml");
        if (fs.existsSync(currentYaml)) {
          const text = fs.readFileSync(currentYaml, "utf8");
          const date = extractYamlDate(text);
          if (date) dates[entry] = date;
        }
      } catch { /* skip unreadable entries */ }
    }
  }

  // 2. active-sprints.yaml as supplemental source
  const activeReg = PATHS.sprintActiveRegistry;
  if (activeReg && fs.existsSync(activeReg)) {
    try {
      const text = fs.readFileSync(activeReg, "utf8");
      // Split on YAML list entries (lines starting with "- " or "  id:")
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
    } catch { /* ignore unreadable registry */ }
  }

  return dates;
}

// ── Parse a single report file (halt-*.md or sprint-full-report.md) ───────────

/**
 * Parses report markdown content and mutates the data object:
 *   data.phasesReached        — Set of phase names from **Phase:** lines
 *   data.consultedBoundaries  — Set of boundary names from ## Beta consultations section
 *
 * Tolerates absent/malformed reports (just returns without adding anything).
 */
function parseReportContent(content, data) {
  if (!content || typeof content !== "string") return;

  // Extract **Phase:** <phase> lines (halt-report header format)
  for (const m of content.matchAll(/^\*\*Phase:\*\*\s+(\S+)/gm)) {
    const phase = m[1].trim();
    if (PHASE_TO_BOUNDARY[phase]) {
      data.phasesReached.add(phase);
    }
  }

  // Extract "## Beta consultations" section (final report only)
  // Lines look like: "- before_design: DECIDE (2026-05-22T...)"
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

// ── Load full-reports data from filesystem ────────────────────────────────────

/**
 * Reads PATHS.sprintFullReports (or overrideDir) and returns a map of:
 *   { [sprintId]: { phasesReached: Set<string>, consultedBoundaries: Set<string> } }
 *
 * All sprints are returned regardless of cutoff — computeFindings applies the cutoff filter.
 * Missing or unreadable dir → returns empty map (graceful, never throws).
 *
 * @param {string} [overrideDir]  Override the full-reports directory path.
 *   Also settable via WARPOS_FULLREPORTS_DIR env var in the CLI entry point.
 */
function loadFullReportsData(overrideDir) {
  // Use null-prototype object to avoid prototype-pollution on sprint IDs
  const result = Object.create(null);
  const reportsDir = overrideDir || PATHS.sprintFullReports;
  if (!reportsDir) return result;
  if (!fs.existsSync(reportsDir)) return result; // graceful-empty: missing dir is fine

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
      try { files = fs.readdirSync(sprintDir); } catch { /* skip */ }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        try {
          const content = fs.readFileSync(path.join(sprintDir, file), "utf8");
          parseReportContent(content, sprintEntry);
        } catch { /* skip unreadable files */ }
      }

      result[entry] = sprintEntry;
    } catch { /* skip bad entries */ }
  }

  return result;
}

// ── Table formatter for human FAIL output ─────────────────────────────────────

/**
 * Format an array of findings as a compact aligned table.
 * Columns: SPRINT | PHASE | VERDICT | FINDING_TYPE | EVIDENCE
 * Evidence is truncated to 50 chars. Returns a multi-line string.
 */
function formatFindingsTable(findings) {
  if (findings.length === 0) return "";

  const EVIDENCE_MAX = 50;
  let w0 = 6;   // SPRINT
  let w1 = 5;   // PHASE
  let w2 = 7;   // VERDICT
  let w3 = 12;  // FINDING_TYPE

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

// ── Core compute function (exported for test harness) ─────────────────────────

/**
 * Compute findings from an array of event records.
 *
 * @param {object[]} events      Parsed event records (as read from events.jsonl)
 * @param {Object}   sprintDates  Map of sprint_id → "YYYY-MM-DD" start date
 * @param {string}   cutoff      ISO date string — sprints before this are exempt
 * @param {Object|null} reportsData  Optional corroborating data from PATHS.sprintFullReports.
 *   Shape: { [sprintId]: { phasesReached: Set<string>, consultedBoundaries: Set<string> } }
 *   Produced by loadFullReportsData(). If null/undefined, full-reports corroboration is skipped
 *   (backward-compatible — existing callers that pass 2 or 3 args are unaffected).
 * @param {Set<string>|null} waivers  Optional Set of waived fingerprints (lowercased hex),
 *   produced by loadWaivers(). Findings whose fingerprint is in the Set are DROPPED from the
 *   returned `findings` and counted in `waived` (ED-049 triage). null/undefined → no waivers.
 * @returns {{ findings, applicable, checked, undatedExempt, malformedLines, waived }}
 */
function computeFindings(events, sprintDates = {}, cutoff = SP003_SHIP_DATE, reportsData = null, waivers = null) {
  const findings = [];
  let malformedLines = 0;

  // Bucket events by sprint_id.
  // FIX 3: use Object.create(null) — a sprint_id equal to "__proto__", "constructor", or
  // "toString" would resolve truthy on a plain {} and skip bucket creation, then crash on
  // sd.consults.push(...) with "Cannot read properties of undefined". Null-prototype avoids this.
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
    if (!sprintId) continue; // can't attribute without a sprint_id

    if (!sprintData[sprintId]) {
      sprintData[sprintId] = {
        consults: [],       // sprint_full_beta_consult (real, post-SP-003)
        legacyConsults: [], // sprint_full_beta_consultation (pre-SP-003 placeholder kind)
        halts: [],          // sprint_full_halt
        phaseStarted: new Set(), // phase names that were started (from events)
        _reportConsultedBoundaries: new Set(), // boundaries confirmed by full-reports
      };
    }
    const sd = sprintData[sprintId];

    if (kind === "sprint_full_beta_consult") {
      sd.consults.push(f);
    } else if (kind === "sprint_full_beta_consultation") {
      // Legacy / placeholder kind emitted before SP-003
      sd.legacyConsults.push(f);
    } else if (kind === "sprint_full_halt") {
      sd.halts.push(f);
    } else if (kind === "sprint_full_phase_started") {
      if (f.phase) sd.phaseStarted.add(f.phase);
    }
  }

  // FIX 1: Augment sprintData with full-reports corroboration.
  //
  // For each sprint in reportsData:
  //  • Create a skeleton bucket if the sprint has no events (sprint known only via full-reports).
  //    Its presence in full-reports is evidence that /sprint:full ran for it.
  //  • Merge phasesReached from halt/final reports into phaseStarted (additional evidence that
  //    a boundary was cleared). If that boundary has no consult event → missing_consult finding.
  //  • Store consultedBoundaries from the final report's "## Beta consultations" section into
  //    _reportConsultedBoundaries. If the final report confirms a consult happened, we don't
  //    flag it as missing even if the event is absent (reduce false-positives, not false-negatives).
  //
  // The cutoff filter is applied below in the main loop — no pre-filtering here.
  if (reportsData && typeof reportsData === "object") {
    for (const sprintId of Object.keys(reportsData)) {
      const rd = reportsData[sprintId];
      if (!rd) continue;

      if (!sprintData[sprintId]) {
        // Sprint found only in full-reports — skeleton bucket
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
  // C4 accumulator: normalized message → { sprints:Set, samples:[{sprintId, ev}] }
  // across all applicable, non-synthetic sprints. Populated in the loop, evaluated after.
  const crossSprintMsgs = Object.create(null);

  for (const sprintId of Object.keys(sprintData)) {
    const sd = sprintData[sprintId];
    // Determine sprint start date for cutoff comparison.
    // FIX B: use Object.hasOwn to guard against prototype-inherited properties.
    // A sprint_id equal to "constructor" / "toString" / "valueOf" etc. would resolve
    // a truthy inherited function on a plain {} object, bypassing the undated fail-safe
    // and feeding a garbage value into the cutoff comparison. Own-property check ensures
    // only explicitly set dates are used.
    const sprintDate = Object.hasOwn(sprintDates, sprintId) ? sprintDates[sprintId] : undefined;
    if (!sprintDate) {
      // Cannot determine date — exempt (fail-safe: don't false-flag unknown sprints)
      undatedExempt++;
      continue;
    }
    // Lexicographic ISO date comparison (YYYY-MM-DD format sorts correctly)
    if (sprintDate < cutoff) {
      // Legacy sprint — exempt entirely
      continue;
    }

    applicableSprintIds.push(sprintId);
    checked++;

    // ── Finding type 1: placeholder_verdict ───────────────────────────────
    //
    // (a) Legacy kind — sprint_full_beta_consultation instead of sprint_full_beta_consult
    for (const ev of sd.legacyConsults) {
      findings.push(withFp({
        sprint_id: sprintId,
        phase: ev.phase_boundary ? ev.phase_boundary.replace("before_", "") : null,
        expected_consult: ev.phase_boundary || null,
        actual_event: "sprint_full_beta_consultation",
        verdict: ev.verdict || null,
        evidence: "legacy sprint_full_beta_consultation kind (pre-SP-003 placeholder)",
        finding_type: "placeholder_verdict",
      }, ev.beta_message));
    }

    // (b) Real kind but missing/empty required fields.
    // FIX 4: treat whitespace-only strings as empty — a beta_message of " " is a fake consult.
    for (const ev of sd.consults) {
      const missing = [];
      // beta_message: flag if absent, empty string, or whitespace-only
      if (!ev.beta_message || !String(ev.beta_message).trim())
        missing.push("beta_message");
      // latency_ms = 0 is valid (CLI resume has no live round-trip); only flag undefined/null
      if (ev.latency_ms === undefined || ev.latency_ms === null)
        missing.push("latency_ms");
      // model: flag if absent, empty string, or whitespace-only
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

    // ── Finding type 4: canned / non-substantive verdict (P-AP-1) ─────────────
    //
    // The empty-message case is placeholder_verdict above; this catches a NON-EMPTY
    // but non-substantive message. Synthetic/test sprints are exempt from the audit
    // (they carry deliberate canned fixtures; classifyCanned still flags them in unit
    // tests). C1 (too short) / C2 (unstructured) are per-message; C3 (cross-boundary
    // duplicate) is per-sprint; C4 (cross-sprint template) is computed after the loop.
    if (!isSyntheticSprint(sprintId)) {
      const boundariesByMsg = new Map(); // normalized message → Set<phase_boundary>
      for (const ev of sd.consults) {
        const raw = ev.beta_message;
        if (!raw || !String(raw).trim()) continue; // empty → placeholder_verdict
        const trimmed = String(raw).trim();

        // C1 + C2
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

        // C3 (per-sprint) + C4 (cross-sprint) accumulation
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
          // Fingerprint from the normalized message (norm), NOT the evidence string
          // — the evidence embeds `boundaries.size`, a corpus-derived count that moves.
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

    // ── Finding type 2: missing_consult ───────────────────────────────────
    //
    // Evidence that a boundary was cleared comes from TWO sources (union):
    //   1. sprint_full_phase_started events (primary)
    //   2. **Phase:** lines in halt/final reports via reportsData (FIX 1 corroboration)
    //
    // consultedBoundaries also unions THREE sources:
    //   1. Real consult events (sprint_full_beta_consult)
    //   2. Legacy consult events (sprint_full_beta_consultation) — avoids double-flagging
    //   3. Final-report "## Beta consultations" confirmations — reduces false-positives
    const consultedBoundaries = new Set(
      [
        ...sd.consults.map((c) => c.phase_boundary),
        ...sd.legacyConsults.map((c) => c.phase_boundary),
        ...[...sd._reportConsultedBoundaries],
      ].filter(Boolean),
    );

    for (const phase of sd.phaseStarted) {
      const boundary = PHASE_TO_BOUNDARY[phase];
      if (!boundary) continue; // phase has no expected consult boundary (e.g. "plan")
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

    // ── Finding type 3: escalate_without_halt ─────────────────────────────
    //
    // A sprint_full_beta_consult with verdict ESCALATE must be followed by a
    // sprint_full_halt with halt_reason: beta_escalate for the same sprint.
    for (const ev of sd.consults) {
      if (ev.verdict !== "ESCALATE") continue;
      const evTs = typeof ev.ts === "string" ? ev.ts : "";
      const hasMatchingHalt = sd.halts.some(
        (h) =>
          h.halt_reason === "beta_escalate" &&
          // Halt must be at/after the consult timestamp (or either ts is unknown)
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
  // A normalized message appearing across ≥3 DISTINCT applicable, non-synthetic
  // sprints is a propagating boilerplate template, not a per-sprint consult. One
  // finding per sprint occurrence (de-duped by sprint), so each is actionable.
  for (const norm of Object.keys(crossSprintMsgs)) {
    const rec = crossSprintMsgs[norm];
    if (rec.sprints.size >= CROSS_SPRINT_TEMPLATE_THRESHOLD) {
      const emitted = new Set();
      for (const { sprintId, ev } of rec.samples) {
        if (emitted.has(sprintId)) continue;
        emitted.add(sprintId);
        // Fingerprint from the raw beta_message, NOT the evidence — the evidence
        // embeds `rec.sprints.size`, a corpus-derived count that grows over time.
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

  // ── ED-049 waiver application ─────────────────────────────────────────────
  // Drop findings whose stable fingerprint matches a VALID waiver. New (un-waived)
  // findings stay → release-build blocks only on what hasn't been triaged. The
  // `waived` count is REPORTED (not just computed) so an audit can see the gate is
  // doing something — an invisible waiver count is its own false-green (β rider).
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

// ── Audit input loader (shared by the CLI + the triage tool) ──────────────────
//
// Reads events.jsonl, sprint dates, and full-reports corroboration using the same
// env overrides everywhere, so the triage tool (beta-honesty-triage.js) computes
// findings over EXACTLY the inputs the gate sees. Returns the raw inputs; the
// caller runs computeFindings() with whatever waiver/ cutoff policy it wants.
//   WARPOS_EVENTS_FILE       — override path to events.jsonl
//   WARPOS_SPRINT_DATES_JSON — override sprint dates as a JSON string
//   WARPOS_FULLREPORTS_DIR   — override path to the full-reports directory
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
    // Missing or unreadable events file → treat as empty (graceful)
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

  return { rawEvents, malformedCount, sprintDates, reportsData };
}

/** Resolve the waiver-ledger path (env override → paths.betaHonestyWaivers). */
function waiverLedgerPath() {
  return mcEnv.readEnv("BETA_HONESTY_WAIVERS") || PATHS.betaHonestyWaivers;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  // FIX 2: Validate --since — fail-closed on bogus values.
  // A bad --since like "bogus" makes every sprint compare as "before cutoff"
  // (since "2026-..." < "bogus" lexicographically), silently exempting all sprints
  // and disabling the audit. Reject non-ISO-dates up front with exit 2 (usage error).
  // Also reject a trailing --since with no following value (undefined) or a following
  // flag (starts with "--") — both indicate the user forgot to provide the date.
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

  // 1-3. Load audit inputs (events, sprint dates, full-reports) — shared loader.
  const { rawEvents, malformedCount, sprintDates, reportsData } =
    loadAuditContext();

  // 3.5 Load the ED-049 waiver ledger (unless --no-waivers).
  const waivers = NO_WAIVERS ? null : loadWaivers(waiverLedgerPath());

  // 4. Compute findings (waived findings are dropped + counted)
  const result = computeFindings(rawEvents, sprintDates, CUTOFF, reportsData, waivers);
  result.malformedLines = (result.malformedLines || 0) + malformedCount;

  // 5. Graceful empty — no applicable post-cutoff sprints with activity
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
        `OK   [sprint-beta-honesty] no applicable sprints in window (cutoff ${CUTOFF}) — nothing to audit`,
      );
    }
    process.exit(0);
  }

  // 6. Emit results
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
      // FIX 5: compact aligned table for human-readable FAIL output
      process.stderr.write(
        `FAIL [sprint-beta-honesty] ${result.findings.length} finding(s) (${result.checked} sprint(s) checked, cutoff ${CUTOFF}${waivedNote}):\n\n`,
      );
      process.stderr.write(formatFindingsTable(result.findings.slice(0, 10)) + "\n");
      if (result.findings.length > 10) {
        process.stderr.write(`\n  ... and ${result.findings.length - 10} more\n`);
      }
    }
  }
  process.exit(ok ? 0 : 1);
}

// ── Exports (for test harness) ────────────────────────────────────────────────

module.exports = {
  computeFindings,
  loadFullReportsData,
  validateIsoDate,
  classifyCanned,
  normalizeMessage,
  fingerprintFinding,
  withFp,
  isValidWaiver,
  loadWaivers,
  loadAuditContext,
  loadSprintDates,
  waiverLedgerPath,
  CUTOFF,
  SP003_SHIP_DATE,
  EXPECTED_BOUNDARIES,
  PHASE_TO_BOUNDARY,
  MIN_SUBSTANTIVE_LEN,
};
