#!/usr/bin/env node
// scan:sprint-manager-consult — audit manager-consult coverage across /sprint:full runs.
//
// ADR-0007 Tier-4 enforcement (GAP 1): the named cross-domain design authority
// (`design-quality`) is now WIRED into both adhoc (gamma.md W1) and oneshot
// (oneshot/protocol.md Step 4 d.1). But a wired gate that is silently SKIPPED on a
// UI-touching sprint is invisible — there is no record that the design authority was
// ever consulted. This is the coverage enforcer: for every post-cutoff /sprint:full
// run that shows a DESIGN-TOUCH signal, it asserts a `manager_consult` record for
// `design-quality` exists in events.jsonl over the run window — else FAIL.
//
// SCOPE = SPRINTS (mirrors sprint-beta-honesty). The unit of audit is a /sprint:full
// run (attributed by sprint_id); the design authority must be consulted at least once
// per design-touching run.
//
// Detects one finding type:
//   missing_design_consult — a sprint shows a design-touch signal (a manager_consult
//     for a design-domain manager OTHER than design-quality — e.g. visual-review — OR
//     an explicit ui_touched:true on any sprint_full_* event) but NO manager_consult
//     record for `design-quality` exists for that sprint.
//
// The design-touch signal is INDEPENDENT of the design-quality consult itself (so the
// check is not circular): presence of UI work is established by a separate marker, and
// the absence of the design-quality consult is the finding — exactly parallel to
// sprint-beta-honesty's (phase_started ⇒ independent signal; consult-absence ⇒ finding).
//
// Date-cutoff: sprints whose start date is BEFORE the cutoff are LEGACY and exempt.
// Cutoff defaults to 2026-06-04 (the ADR-0007 wiring date) so only NEW runs are audited.
// Graceful empty: no applicable sprints → exit 0 with an informational message.
// Fail-closed: a bad --since (non-ISO / overflow / missing value) → exit 2.
//
// See .claude/commands/scan/sprint-manager-consult.md for the full spec.

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * ISO date of the ADR-0007 design-quality wiring — sprints before this predate the
 * mechanism and are LEGACY/exempt (flagging them would be a false positive, exactly
 * as sprint-beta-honesty exempts pre-SP-003 sprints).
 */
const WIRE_DATE = "2026-06-04";

/**
 * ISO date after which a matching manager_consult telemetry record alone is insufficient —
 * a backing ok:true dispatch completion record in dispatch-completions.jsonl is ALSO
 * required, correlated to the sprint via role + time window. Sprints started before this
 * date keep the old telemetry-only predicate (no retroactive reds).
 * Citing E-DISPATCH-INTEGRITY-001 F-1 (RC-2 sprint-theater prevention).
 */
const RECORD_BACKED_CUTOFF = "2026-06-10";

/**
 * ED-051 — product-lead authoring coverage. WG-3 (commit 1e2e6faf, 2026-06-12) routed
 * /sprint:plan + /sprint:design requirement authoring to the product-lead role (was: no
 * role owner → the orchestrator self-authored reqs). This enforcer makes that rule
 * self-detecting: a post-cutoff sprint that ran the plan/design phases but has no backing
 * product-lead authorship record is surfaced (REPORT-ONLY — see `advisoryFindings`).
 *
 * AUTHORING_CUTOFF = the WG-3 commit date, so the pre-WG-3 backlog is exempt exactly as
 * WIRE_DATE exempts pre-ADR-0007 sprints (no retroactive flags).
 * AUTHORING_ROLE   = the literal role string product-lead dispatch-completions carry
 *                    (verified in dispatch-completions.jsonl — NOT assumed).
 * AUTHORING_PHASES = the WG-3-routed phases; the in-scope signal is a sprint_full PHASE
 *                    event whose `phase` is EXACTLY one of these (whitelist, NOT a loose
 *                    substring — "replan"/"design-review" must not widen scope). Solo/adhoc
 *                    one-offs never invoke /sprint:full's plan/design phases, so they never
 *                    emit these events → never in-scope (a STRUCTURAL carve-out, not an
 *                    inference from record-absence — which would be circular).
 */
const AUTHORING_CUTOFF = "2026-06-12";
const AUTHORING_ROLE = "product-lead";
const AUTHORING_PHASES = Object.freeze(["plan", "design"]);

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
 * scripts/checks/sprint-hook-coverage.js (the same exploit, two sites). No shared-lib
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

/** The named manager this check enforces coverage for. */
const REQUIRED_MANAGER = "design-quality";

/**
 * Managers whose presence on a sprint constitutes an INDEPENDENT "this sprint touched
 * UI/app-design/web-design work" signal — distinct from design-quality itself, so the
 * check is non-circular. visual-review is the multimodal browser review that runs on
 * the same UI-diff condition as design-quality; a design-lead consult is design work.
 */
const DESIGN_TOUCH_MANAGERS = Object.freeze(["visual-review", "design-lead", "design-review"]);

// Synthetic/test sprint prefixes — exempt from the LIVE audit (they carry deliberate
// fixtures). The date-cutoff + undated-exempt already filters most; this scopes the
// corpus audit only (computeFindings still classifies them in unit tests).
const SYNTHETIC_SPRINT_PREFIXES = ["SP-J"];

function isSyntheticSprint(sprintId) {
  return SYNTHETIC_SPRINT_PREFIXES.some((p) => String(sprintId).startsWith(p));
}

// ── CLI flags ─────────────────────────────────────────────────────────────────

const JSON_OUT = process.argv.includes("--json");
const sinceIdx = process.argv.indexOf("--since");
const CUTOFF =
  sinceIdx !== -1 && process.argv[sinceIdx + 1]
    ? process.argv[sinceIdx + 1]
    : WIRE_DATE;

// ── Field extraction — robust to top-level and data-nested placement ──────────
//
// The logger writes: log("manager_consult", { manager, mode, unit, verdict, ... })
//   → event.cat = "manager_consult", event.data = { manager, mode, unit, ... }
// and log("audit", { kind: "sprint_full_*", ... }) → event.data = { kind, ... }.
// Be robust to both data-nested AND top-level placement.

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
  // Carry the top-level category + sprint_id (logger writes sprint_id at top level).
  if (rec.cat !== undefined) merged.cat = rec.cat;
  if (rec.sprint_id !== undefined && merged.sprint_id === undefined) merged.sprint_id = rec.sprint_id;
  for (const k of EVENT_FIELDS) {
    if (rec[k] !== undefined) merged[k] = rec[k];
  }
  return merged;
}

// ── Simple YAML date extractor (only needs created_at / start_date / start) ──

function extractYamlDate(text) {
  if (!text) return null;
  const m = text.match(/(?:created_at|start_date|start)\s*:\s*["']?([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  // R-4 (B4c): the regex matches a structurally-shaped string, NOT a real date —
  // "9999-99-99" / "2026-13-45" pass the shape but are not valid calendar dates.
  // Round-trip validate so an unparseable date never becomes a candidate anchor; an
  // invalid match → null (no anchor → fail closed) rather than a NaN anchor.
  return m && validateIsoDate(m[1]) ? m[1] : null;
}

// ── Timestamp parser ──────────────────────────────────────────────────────────

function parseTs(v) {
  if (!v) return null;
  const t = Date.parse(String(v));
  return isNaN(t) ? null : t;
}

// ── Backing dispatch-record check (F-1) ───────────────────────────────────────
// A record is correlated when: role matches AND completed_at (or started_at)
// falls within the sprint's event time window ± SPRINT_WINDOW_BUFFER_MS.
// Records with no timestamp cannot be correlated and are excluded.
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
  // liveness choke-point so a forged/unsigned record cannot back a sprint's manager-consult coverage.
  // Default TRUE (live); tests that inject unsigned fixture records pass opts.requireSignature:false.
  const requireSignature = opts.requireSignature !== false;
  if (!Array.isArray(dispatchRecords) || dispatchRecords.length === 0) return false;
  // Defense-in-depth (claude qa lane 2026-06-10, minor): if the sprint has NO
  // parseable event window at all, no record can be correlated to it — fail
  // closed rather than letting ANY historic ok:true record green the sprint.
  // (Not live-reachable today — the logger always writes top-level ts — but
  // the guard costs one line and closes the shape.)
  if (minTsMs === null && maxTsMs === null) return false;
  const wantSprint = sprintId !== undefined && sprintId !== null ? String(sprintId).trim() : null;
  return dispatchRecords.some((rec) => {
    if (!isVerifiedLivenessRecord(rec, { requireSignature })) return false; // ok:true AND valid origin-proof sig
    if (typeof rec.role !== "string" || rec.role.trim() !== role) return false;
    // R-5: sprint_id narrows. A record STAMPED for a sprint (a non-empty string id)
    // must match — a different stamped id never correlates. A record with NO stamp
    // (field absent, null, or empty — the pre-W0/unstamped sentinel) falls through to
    // the time-window fallback below (the dispatcher writes sprint_id:null when
    // WARPOS_SPRINT_ID is unset; null is "unstamped", NOT "stamped for sprint null").
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

// ── ISO date validator (round-trip; rejects V8 calendar rollovers) ───────────

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

// ── Core compute function (exported for test harness) ─────────────────────────

/**
 * Compute findings from an array of event records.
 *
 * @param {object[]} events          Parsed event records (as read from events.jsonl)
 * @param {Object}   sprintDates     Map of sprint_id → "YYYY-MM-DD" start date
 * @param {string}   cutoff          ISO date string — sprints before this are exempt
 * @param {object[]} dispatchRecords Parsed completion records from dispatch-completions.jsonl
 *                                   (F-1 record-backed check, post-RECORD_BACKED_CUTOFF only)
 * @returns {{ findings, applicable, checked, undatedExempt, malformedLines }}
 */
function computeFindings(events, sprintDates = {}, cutoff = WIRE_DATE, dispatchRecords = []) {
  const findings = [];
  let malformedLines = 0;

  // Bucket events by sprint_id. Null-prototype guards proto-pollution sprint ids
  // ("__proto__"/"constructor"/"toString") — same hardening as sprint-beta-honesty.
  const sprintData = Object.create(null);

  for (const rec of events) {
    if (!rec || typeof rec !== "object") {
      malformedLines++;
      continue;
    }
    const f = getEventFields(rec);
    const sprintId = f.sprint_id;
    if (!sprintId) continue; // can't attribute without a sprint_id

    const isManagerConsult = f.cat === "manager_consult" || (f.manager && !f.kind);
    const isSprintFull = typeof f.kind === "string" && f.kind.startsWith("sprint_full");

    // Only events that can establish either the design-touch signal OR the
    // design-quality consult are relevant. Skip everything else.
    if (!isManagerConsult && !isSprintFull) continue;

    if (!sprintData[sprintId]) {
      sprintData[sprintId] = {
        sawSprintFull: false,    // proof a /sprint:full run is attributed to this id
        designTouch: false,      // independent "touched UI" signal
        hasDesignQuality: false, // a design-quality manager_consult exists
        designTouchEvidence: null,
        minTsMs: null,           // F-1: min event timestamp for sprint window correlation
        maxTsMs: null,           // F-1: max event timestamp for sprint window correlation
        discardedTs: [],         // R-4: event ts the horizon clamp discarded (C-4 note)
        authoringArtifact: false,// ED-051: a plan/design PHASE event attributed to this sprint
        authoringEvidence: null, // ED-051: which event established the in-scope signal
      };
    }
    const sd = sprintData[sprintId];

    // F-1: track sprint event time window (used to correlate dispatch completion records).
    // R-4: clamp to the sane sprint horizon (trusted created_at ± hard cap) so an
    // UNTRUSTED spoofed ts (1970/2099) cannot widen the window. Out-of-horizon ts are
    // DISCARDED from window derivation (recorded for the C-4 note) rather than fail-open.
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
      // Explicit ui_touched marker on any sprint_full_* event is a design-touch signal.
      if (f.ui_touched === true) {
        sd.designTouch = true;
        if (!sd.designTouchEvidence) sd.designTouchEvidence = `ui_touched on ${f.kind}`;
      }
      // ED-051: a sprint_full PHASE event whose phase is EXACTLY plan/design is the
      // INDEPENDENT in-scope signal for product-lead authoring coverage. Whitelist match
      // (Array.includes on the exact phase value) — a phase like "replan"/"design-review"
      // is NOT matched, so the signal cannot silently widen scope (β rider).
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
        // A design-domain consult also proves a sprint_full run touched UI even if no
        // sprint_full_* event was attributed (the consult itself implies the run).
        if (!sd.designTouchEvidence) sd.designTouchEvidence = `${mgr} manager_consult`;
      }
    }
  }

  const applicableSprintIds = [];
  const windowDiscards = []; // R-4 (C-4): event ts discarded by the horizon clamp
  let undatedExempt = 0;
  let checked = 0;

  for (const sprintId of Object.keys(sprintData)) {
    const sd = sprintData[sprintId];

    // A sprint is in-scope only if it shows a DESIGN-TOUCH signal — otherwise the
    // design authority is legitimately not required (non-UI sprint).
    if (!sd.designTouch) continue;

    // Live-audit exemption for synthetic/test sprints.
    if (isSyntheticSprint(sprintId)) continue;

    // Date-cutoff: own-property guard against prototype-inherited dates.
    const sprintDate = Object.hasOwn(sprintDates, sprintId) ? sprintDates[sprintId] : undefined;
    if (!sprintDate) {
      undatedExempt++; // unknown date → exempt (fail-safe; don't false-flag)
      continue;
    }
    if (sprintDate < cutoff) {
      continue; // legacy sprint — exempt entirely
    }

    applicableSprintIds.push(sprintId);
    checked++;
    // R-4 (C-4): surface any event ts the horizon clamp discarded, so a spoof attempt
    // is diagnosable rather than silent.
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
    } else if (sprintDate >= RECORD_BACKED_CUTOFF) {
      // F-1: post-cutoff sprint — telemetry record present but ALSO require a backing
      // ok:true completion record. R-5: correlate by sprint_id first (a different
      // sprint_id never counts), then the R-4 clamped time-window fallback for legacy.
      const hasBacking = hasBackingDispatchRecord(
        dispatchRecords, REQUIRED_MANAGER, sd.minTsMs, sd.maxTsMs, sprintId,
      );
      if (!hasBacking) {
        findings.push({
          sprint_id: sprintId,
          manager: REQUIRED_MANAGER,
          evidence: `sprint has a manager_consult event for '${REQUIRED_MANAGER}' but no backing ok:true dispatch record correlated by sprint_id (or legacy clamped window) for this sprint (E-DISPATCH-INTEGRITY-001 F-1; post-${RECORD_BACKED_CUTOFF} record-backed coverage required)`,
          finding_type: "missing_design_consult",
        });
      }
    }
  }

  // ── ED-051: product-lead authoring coverage (REPORT-ONLY advisory pass) ─────────
  // Separate pass + separate return channel so this NEW finding surfaces WITHOUT flipping
  // the enforcer's exit code (ramp parity with the report-only E-LIFECYCLE guards; the
  // flip-to-blocking is operator-gated, never self-promoted). Independent in-scope signal
  // = a plan/design PHASE event attributed to the sprint (set during bucketing above);
  // solo/adhoc work never emits these, so it is never evaluated (structural carve-out, not
  // a circular record-absence inference). Own cutoff (AUTHORING_CUTOFF) exempts the
  // pre-WG-3 backlog. Each sprint is evaluated in isolation by sprint_id — a different
  // sprint's plan event can never attribute debt here.
  const advisoryFindings = [];
  const applicableSet = new Set(applicableSprintIds);
  for (const sprintId of Object.keys(sprintData)) {
    const sd = sprintData[sprintId];
    if (!sd.authoringArtifact) continue; // out of scope — no plan/design phase event for THIS sprint
    if (isSyntheticSprint(sprintId)) continue;
    const sprintDate = Object.hasOwn(sprintDates, sprintId) ? sprintDates[sprintId] : undefined;
    if (!sprintDate) continue; // unknown date → exempt (fail-safe; mirrors the design-finding path)
    if (sprintDate < AUTHORING_CUTOFF) continue; // pre-WG-3 backlog — exempt entirely
    // In-scope for authoring coverage — count it applicable (union with the design-touch set,
    // deduped so a both-signal sprint is not double-counted).
    if (!applicableSet.has(sprintId)) {
      applicableSet.add(sprintId);
      applicableSprintIds.push(sprintId);
      checked++;
    }
    // Require a backing ok:true product-lead authorship record correlated by sprint_id —
    // reuse hasBackingDispatchRecord AS-IS (same R-4 horizon clamp + R-5 sprint_id narrowing;
    // a different sprint's record never greens this one).
    if (!hasBackingDispatchRecord(dispatchRecords, AUTHORING_ROLE, sd.minTsMs, sd.maxTsMs, sprintId)) {
      advisoryFindings.push({
        sprint_id: sprintId,
        manager: AUTHORING_ROLE,
        evidence: `sprint produced a plan/design artifact (${sd.authoringEvidence}) but no backing ok:true '${AUTHORING_ROLE}' authorship dispatch record correlated by sprint_id was found (WG-3/ED-051; post-${AUTHORING_CUTOFF} product-lead authoring required; report-only ramp)`,
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

// ── Table formatter for human FAIL output ─────────────────────────────────────

function formatFindingsTable(findings) {
  if (findings.length === 0) return "";
  const EVIDENCE_MAX = 64;
  let w0 = 6; // SPRINT
  let w1 = 7; // MANAGER
  let w2 = 20; // FINDING_TYPE
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

// ── CLI entry point ───────────────────────────────────────────────────────────

if (require.main === module) {
  // Validate --since — fail-closed on bogus values (mirrors sprint-beta-honesty).
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

  // Env overrides for testing (production uses PATHS defaults).
  //   WARPOS_EVENTS_FILE                  — override path to events.jsonl
  //   WARPOS_SPRINT_DATES_JSON            — override sprint dates as a JSON string
  //   WARPOS_DISPATCH_COMPLETIONS_FILE    — override path to dispatch-completions.jsonl (F-1)

  // 1. Read and parse events.jsonl (missing file → graceful empty)
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

  // 2. Load dispatch completion records for F-1 backing-record check
  let dispatchRecords = [];
  const dispatchPath =
    mcEnv.readEnv("DISPATCH_COMPLETIONS_FILE") ||
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime || "", "dispatch-completions.jsonl");
  try {
    const raw = fs.readFileSync(dispatchPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { dispatchRecords.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
  } catch { /* missing or unreadable — graceful empty (some post-cutoff sprints may red) */ }

  // 3. Load sprint start dates
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

  // 4. Compute findings
  const result = computeFindings(rawEvents, sprintDates, CUTOFF, dispatchRecords);
  result.malformedLines = (result.malformedLines || 0) + malformedCount;

  // 5. Graceful empty — no applicable post-cutoff design-touching sprints
  if (result.applicable === 0) {
    if (JSON_OUT) {
      console.log(
        JSON.stringify({
          ok: true,
          applicable: 0,
          reason: "no_applicable_sprints",
          cutoff: CUTOFF,
          authoringCutoff: AUTHORING_CUTOFF,
          advisoryFindings: [],
          totalAdvisory: 0,
          undatedExempt: result.undatedExempt,
        }),
      );
    } else {
      console.log(
        `OK   [sprint-manager-consult] no applicable design-touching sprints in window (cutoff ${CUTOFF}) — nothing to audit`,
      );
    }
    process.exit(0);
  }

  // 6. Emit results
  // `ok` / exit code key on the BLOCKING `findings` only — `advisoryFindings`
  // (missing_product_lead_authoring, ED-051) are REPORT-ONLY and never flip the exit code.
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
      authoringCutoff: AUTHORING_CUTOFF,
      undatedExempt: result.undatedExempt,
      malformedLines: result.malformedLines,
      windowDiscards: windowDiscards.slice(0, 30),
    };
    if (result.findings.length > 30) jsonOut.truncated = true;
    console.log(JSON.stringify(jsonOut));
  } else {
    // R-4 (C-4): surface discarded outlier timestamps (informational; not a finding).
    for (const d of windowDiscards) {
      process.stderr.write(`INFO [sprint-manager-consult] ${d.sprint_id}: ${d.evidence}\n`);
    }
    if (ok) {
      console.log(
        `OK   [sprint-manager-consult] ${result.checked} design-touching sprint(s) checked, 0 findings`,
      );
    } else {
      process.stderr.write(
        `FAIL [sprint-manager-consult] ${result.findings.length} finding(s) (${result.checked} sprint(s) checked, cutoff ${CUTOFF}):\n\n`,
      );
      process.stderr.write(formatFindingsTable(result.findings.slice(0, 10)) + "\n");
      if (result.findings.length > 10) {
        process.stderr.write(`\n  ... and ${result.findings.length - 10} more\n`);
      }
    }
    // ED-051 report-only: surface authoring advisories as INFO (never affects exit code).
    if (advisoryFindings.length > 0) {
      process.stderr.write(
        `\nINFO [sprint-manager-consult] ${advisoryFindings.length} report-only authoring advisory(ies) (missing_product_lead_authoring, ED-051; post-${AUTHORING_CUTOFF}):\n\n`,
      );
      process.stderr.write(formatFindingsTable(advisoryFindings.slice(0, 10)) + "\n");
    }
  }
  process.exit(ok ? 0 : 1);
}

// ── Exports (for test harness) ────────────────────────────────────────────────

module.exports = {
  computeFindings,
  validateIsoDate,
  tsWithinHorizon,
  sprintAnchorMs,
  extractYamlDate,
  WIRE_DATE,
  RECORD_BACKED_CUTOFF,
  REQUIRED_MANAGER,
  DESIGN_TOUCH_MANAGERS,
  WINDOW_HARD_CAP_MS,
  AUTHORING_CUTOFF,
  AUTHORING_ROLE,
  AUTHORING_PHASES,
};
