#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

// scan:mode-lifecycle-hooks-coverage — coverage of the VIRTUAL mode-lifecycle
// EVENT registry (.claude/agents/_org/mode-lifecycle-hooks.json, paths.modeLifecycleHooks).
// E-LIFECYCLE-001 / S-LC-02. The SIBLING of scan:sprint-hook-coverage, mirroring its
// structure: a REVERSE structural check + a FORWARD coverage check.
//
// REVERSE (static, registry-only): the registry is structurally coherent — it parses,
//   every row has event/when/mode/payload_fields, mode ∈ {block,advisory}, harness_fires
//   is the literal false (these are VIRTUAL events — the harness fires NONE of them), and
//   no event id is duplicated. A parse error / unreadable / structurally-broken registry
//   is FAIL-CLOSED (exit 2) — a broken registry must never silently report "0 gaps".
//
// FORWARD: every declared (harness_fires:false) event must have an EMITTER —
//   a `lifecycle-events.emit("<event>")` reference in the codebase AND/OR a real
//   `lifecycle-event` record in paths.eventsFile. (We do NOT look for a harness
//   PreToolUse/PostToolUse record — these events are virtual.) An event with no emitter
//   that is listed in the wiring-pending allowlist (mode-lifecycle-hooks-coverage.allowlist.json)
//   is reported as INFO (its emit-site is a documented future sprint — S-LC-03/04), not a
//   gap — the RAMP seam. An event that is NEITHER emitted NOR pending is a coverage GAP.
//
// REPORT-ONLY (P-053 loud-fail exit contract):
//   clean (0 gaps)            -> exit 0
//   gap-only (default)        -> exit 0  (print the gap list; do NOT block this sprint)
//   gap + --enforce           -> exit 1  (ramp tail; what the planted-gap test asserts)
//   parse / unreadable / broken registry -> exit 2  (FAIL LOUD — never a false-green)
//
// Usage:
//   node scripts/checks/mode-lifecycle-hooks-coverage.js [--enforce] [--json]
//        [--registry <path>] [--allowlist <path>] [--events <path>]
//   (--registry/--allowlist/--events override inputs; used ONLY by the sealed
//    planted-fixture tests — defaults are the real tree.)

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");

const ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_REGISTRY =
  // PATHS.modeLifecycleHooks is already an ABSOLUTE resolved path (lib/paths) —
  // use it directly; path.join(ROOT, <absolute>) doubled the root (ENOENT in
  // canonical, masked in the build worktree where the tests passed --registry).
  PATHS.modeLifecycleHooks ||
  path.join(ROOT, ".claude", "agents", "_org", "mode-lifecycle-hooks.json");
const DEFAULT_ALLOWLIST = path.join(__dirname, "mode-lifecycle-hooks-coverage.allowlist.json");

const VALID_MODES = ["block", "advisory"];

// ── CLI flags ───────────────────────────────────────────────────────────────
const ENFORCE = process.argv.includes("--enforce");
const JSON_OUT = process.argv.includes("--json");
function flagVal(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : dflt;
}

// ── Registry IO ───────────────────────────────────────────────────────────────
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, "")); // strip BOM
}

/**
 * REVERSE: validate the registry's structural coherence. Pure.
 * @returns {{ ok:boolean, errors:string[] }}
 */
function validateRegistry(registry) {
  const errors = [];
  if (!registry || typeof registry !== "object") {
    return { ok: false, errors: ["registry is not an object"] };
  }
  if (!Array.isArray(registry.events)) {
    return { ok: false, errors: ["registry.events missing or not an array"] };
  }
  if (registry.events.length === 0) {
    errors.push("registry.events is empty");
  }
  const seen = new Set();
  registry.events.forEach((row, i) => {
    const at = `events[${i}] (${row && row.event})`;
    if (!row || typeof row !== "object") {
      errors.push(`${at}: not an object`);
      return;
    }
    if (!row.event || typeof row.event !== "string") errors.push(`${at}: missing/invalid 'event'`);
    if (!row.when || typeof row.when !== "string") errors.push(`${at}: missing/invalid 'when'`);
    if (!VALID_MODES.includes(row.mode)) errors.push(`${at}: mode '${row.mode}' not one of ${VALID_MODES.join("|")}`);
    if (!Array.isArray(row.payload_fields)) errors.push(`${at}: 'payload_fields' must be an array`);
    // VIRTUAL invariant: the harness fires none of these — harness_fires is the literal false.
    if (row.harness_fires !== false) errors.push(`${at}: 'harness_fires' must be the literal false (virtual event)`);
    if (typeof row.event === "string") {
      if (seen.has(row.event)) errors.push(`${at}: duplicate event id '${row.event}'`);
      seen.add(row.event);
    }
  });
  return { ok: errors.length === 0, errors };
}

// ── FORWARD: emitter discovery ─────────────────────────────────────────────────

// Scan the codebase for static `emit("<event>")` references in files that import
// the lifecycle-events module. Excludes the logger itself (its JSDoc carries an
// example call), this enforcer, and test files — so a doc example / a test is not
// mistaken for a real wired emitter.
const SCAN_ROOTS = ["scripts", ".claude"];
const SCAN_SKIP_DIRS = new Set(["node_modules", ".git", ".worktrees", "releases"]);
const EMIT_RE = /\bemit\(\s*["']([^"']+)["']/g;
const SELF_BASENAMES = new Set([
  "lifecycle-events.js", // the logger (defines emit + a JSDoc example)
  "mode-lifecycle-hooks-coverage.js", // this enforcer
]);
function isExcludedFromEmitScan(file) {
  const base = path.basename(file);
  if (SELF_BASENAMES.has(base)) return true;
  if (/\.test\.js$/.test(base) || /^test-/.test(base)) return true;
  return false;
}

function* walkJs(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SCAN_SKIP_DIRS.has(e.name) || e.name.startsWith(".worktrees")) continue;
      yield* walkJs(full);
    } else if (e.isFile() && e.name.endsWith(".js")) {
      yield full;
    }
  }
}

/** Set of event ids referenced by a static `emit("…")` in lifecycle-events consumers. */
function findStaticEmitters(root = ROOT) {
  const emitted = new Set();
  for (const sub of SCAN_ROOTS) {
    const dir = path.join(root, sub);
    for (const file of walkJs(dir)) {
      if (isExcludedFromEmitScan(file)) continue;
      let text;
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      if (!text.includes("lifecycle-events")) continue; // scope: only consumers
      let m;
      EMIT_RE.lastIndex = 0;
      while ((m = EMIT_RE.exec(text))) emitted.add(m[1]);
    }
  }
  return emitted;
}

/** Set of event ids that have a runtime `lifecycle-event` record in the events file. */
function findRuntimeEmitters(eventsPath) {
  const emitted = new Set();
  if (!eventsPath || !fs.existsSync(eventsPath)) return emitted;
  let raw;
  try {
    raw = fs.readFileSync(eventsPath, "utf8");
  } catch {
    return emitted;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || !line.includes("lifecycle-event")) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const d = rec && rec.data;
    if (d && d.kind === "lifecycle-event" && typeof d.event === "string") emitted.add(d.event);
  }
  return emitted;
}

/**
 * Validate the wiring-pending allowlist SCHEMA (SP-20260611-002 R-9 / S-9).
 * Each entry MUST be an object `{ owner, review_by|expiry, reason }`:
 *   AC-9.1: a schemaless entry (bare string, or missing owner/expiry/reason) is
 *           REJECTED — NOT honored as pending → it falls through to a coverage gap.
 *   AC-9.2: an entry whose review_by/expiry is in the PAST is FLAGGED — also NOT
 *           honored as pending → falls through to a gap (so --enforce fails on it).
 *           An UNPARSEABLE expiry is treated as expired (fail-closed — a malformed
 *           date can never silently extend an allowlist).
 *   AC-9.3: a well-formed, in-date entry (owner + future expiry + reason) is honored
 *           as pending → reported as INFO, never over-flagged.
 *
 * Pure. @returns {{ pending:Set<string>, flagged:Array<{event,problem}> }}
 *   pending = the events the allowlist legitimately suppresses (honored INFO).
 *   flagged = the events whose entry was rejected (schemaless / expired) — surfaced
 *             so the downgrade-to-gap is visible, not silent.
 */
function loadAllowlistSchema(al, now = new Date()) {
  const pending = new Set();
  const flagged = [];
  const wp = al && al.wiring_pending;
  if (!wp || typeof wp !== "object") return { pending, flagged };
  const todayIso = (now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date())
    .toISOString()
    .slice(0, 10);
  for (const [event, entry] of Object.entries(wp)) {
    // AC-9.1: a bare string (legacy) or non-object is schemaless → reject.
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      flagged.push({ event, problem: "schemaless (not an object; needs { owner, review_by|expiry, reason })" });
      continue;
    }
    const owner = typeof entry.owner === "string" ? entry.owner.trim() : "";
    const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
    const rawExpiry = entry.review_by != null ? entry.review_by : entry.expiry;
    const expiry = typeof rawExpiry === "string" ? rawExpiry.trim() : "";
    const missing = [];
    if (!owner) missing.push("owner");
    if (!expiry) missing.push("review_by/expiry");
    if (!reason) missing.push("reason");
    if (missing.length) {
      flagged.push({ event, problem: `schemaless (missing ${missing.join(", ")})` });
      continue;
    }
    // AC-9.2: the expiry must parse to a YYYY-MM-DD and be >= today. An unparseable
    // date is treated as expired (fail-closed). A PAST date is flagged.
    const m = expiry.match(/^(\d{4}-\d{2}-\d{2})/);
    const expiryDay = m ? m[1] : null;
    if (!expiryDay) {
      flagged.push({ event, problem: `unparseable review_by/expiry '${expiry}' (treated as expired — fail-closed)` });
      continue;
    }
    if (expiryDay < todayIso) {
      flagged.push({ event, problem: `EXPIRED review_by/expiry ${expiryDay} (past ${todayIso}) — downgraded to a gap` });
      continue;
    }
    // AC-9.3: well-formed + in-date → honored as pending (INFO).
    pending.add(event);
  }
  return { pending, flagged };
}

/**
 * Core coverage compute. Pure given its inputs.
 * @param {object} registry     the parsed registry
 * @param {Set<string>} emitted the union of static + runtime emitters
 * @param {Set<string>} pending the wiring-pending allowlist event set
 * @returns {{ covered:string[], pending:string[], gaps:string[], total:number }}
 */
function computeCoverage(registry, emitted, pending) {
  const covered = [];
  const pend = [];
  const gaps = [];
  for (const row of (registry.events || [])) {
    const ev = row && row.event;
    if (!ev) continue;
    if (emitted.has(ev)) covered.push(ev);
    else if (pending.has(ev)) pend.push(ev);
    else gaps.push(ev);
  }
  return { covered, pending: pend, gaps, total: (registry.events || []).length };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const registryPath = flagVal("--registry", DEFAULT_REGISTRY);
  const allowlistPath = flagVal("--allowlist", DEFAULT_ALLOWLIST);
  const eventsPath = flagVal("--events", mcEnv.readEnv("EVENTS_FILE") || PATHS.eventsFile);

  // Load + validate the registry — FAIL-CLOSED (exit 2) on unreadable/parse/broken.
  let registry;
  try {
    registry = readJson(registryPath);
  } catch (e) {
    process.stderr.write(`ERROR [mode-lifecycle-hooks-coverage] registry unreadable/unparseable (${registryPath}): ${e.message}\n`);
    return 2;
  }
  const rev = validateRegistry(registry);
  if (!rev.ok) {
    process.stderr.write(
      `FAIL [mode-lifecycle-hooks-coverage] registry structurally incoherent (${rev.errors.length}):\n` +
        rev.errors.map((e) => "  - " + e).join("\n") + "\n",
    );
    return 2;
  }

  // Wiring-pending allowlist (a missing/broken allowlist is non-fatal — treat as empty,
  // which only makes the check STRICTER, never a false-green). R-9: each entry is
  // SCHEMA-VALIDATED ({ owner, review_by|expiry, reason }); a schemaless or expired
  // entry is NOT honored as pending — it is flagged and falls through to a coverage
  // gap (AC-9.1/9.2), so a permanent silent allowlist cannot suppress an emitter-gap.
  let pending = new Set();
  let allowlistFlagged = [];
  try {
    const al = readJson(allowlistPath);
    const loaded = loadAllowlistSchema(al);
    pending = loaded.pending;
    allowlistFlagged = loaded.flagged;
  } catch {
    /* no allowlist -> stricter, not a false-green */
  }

  // FORWARD: emitters = static refs ∪ runtime records.
  const emitted = new Set([...findStaticEmitters(ROOT), ...findRuntimeEmitters(eventsPath)]);
  const res = computeCoverage(registry, emitted, pending);

  const ok = res.gaps.length === 0;
  if (JSON_OUT) {
    console.log(JSON.stringify({
      ok,
      total: res.total,
      covered: res.covered.length,
      pending: res.pending.length,
      gaps: res.gaps,
      // R-9: schemaless/expired allowlist entries that were rejected (downgraded to a
      // gap if the event has no emitter) — surfaced so the downgrade is never silent.
      allowlistFlagged,
      enforce: ENFORCE,
    }));
  } else if (ok) {
    console.log(
      `OK   [mode-lifecycle-hooks-coverage] ${res.total} virtual event(s); ` +
        `${res.covered.length} emitted, ${res.pending.length} wiring-pending (info), 0 gaps`,
    );
  } else {
    const sink = ENFORCE ? process.stderr : process.stdout;
    sink.write(
      `${ENFORCE ? "FAIL" : "WARN"} [mode-lifecycle-hooks-coverage] ${res.gaps.length} ` +
        `event(s) declared with NO emitter and NOT wiring-pending` +
        `${ENFORCE ? "" : " (REPORT-ONLY — not blocking this sprint)"}:\n`,
    );
    for (const g of res.gaps.slice(0, 25)) sink.write(`  - ${g}\n`);
    if (res.gaps.length > 25) sink.write(`  ... and ${res.gaps.length - 25} more\n`);
  }
  // R-9: always surface a rejected (schemaless/expired) allowlist entry — even when
  // the event happens to be covered by an emitter — so a malformed allowlist row is
  // visible, not silently ignored.
  if (!JSON_OUT && allowlistFlagged.length) {
    const sink = ENFORCE && !ok ? process.stderr : process.stdout;
    sink.write(
      `note [mode-lifecycle-hooks-coverage] ${allowlistFlagged.length} allowlist entry(ies) REJECTED ` +
        `(schemaless/expired — not honored as wiring-pending; an uncovered such event is a GAP):\n`,
    );
    for (const f of allowlistFlagged.slice(0, 25)) sink.write(`  - ${f.event}: ${f.problem}\n`);
  }

  // REPORT-ONLY: gaps exit 0 unless --enforce. Parse/unreadable already returned 2 above.
  if (ok) return 0;
  return ENFORCE ? 1 : 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  validateRegistry,
  computeCoverage,
  loadAllowlistSchema,
  findStaticEmitters,
  findRuntimeEmitters,
  readJson,
  DEFAULT_REGISTRY,
  DEFAULT_ALLOWLIST,
};
