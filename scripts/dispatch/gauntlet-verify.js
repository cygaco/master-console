#!/usr/bin/env node
/**
 * gauntlet-verify.js — the enforcer for "absence of a completion record IS the
 * death signal — never trust orchestrator narration."
 *
 * BC-16 TYPED-SUCCESS ENFORCER: "green" means BOTH (a) the action/run occurred
 * AND (b) a well-formed telemetry record exists with all required typed fields.
 * Malformed/ill-typed/no-record all fail-CLOSED. This is the runtime enforcer
 * for the typed-success policy — violation is non-zero exit, not a warning.
 *
 * A gauntlet orchestrator (γ / δ) narrates "all review agents passed". But a
 * dispatched agent can die silently (LRN-2026-04-17 / LRN-2026-04-30 binding-gap
 * class): the process exits 0 bytes, the orchestrator's optimistic loop moves on,
 * and the gauntlet reports green on a role that never ran. The only ground truth
 * is the durable completion ledger that `scripts/dispatch-agent.js` appends to
 * `.claude/runtime/dispatch-completions.jsonl` — one record per dispatch with
 * `{ role, provider, model, ok, ... }`. If a required gauntlet role has no
 * `ok:true` well-formed record for this run, it did NOT run. That absence is the
 * signal.
 *
 * This module reads that ledger and, given a run id + the list of expected
 * gauntlet roles, returns for each role:
 *   - "ran"       — an ok:true WELL-FORMED completion record exists for this run.
 *   - "fell-back" — a well-formed ok:true fallback record (ran on fallback provider).
 *   - "ill-typed" — ok:true record exists but MISSING required typed fields
 *                   (role, provider, parseable timestamp) — NOT a valid success.
 *   - "failed"    — a record exists but ok:false and not a clean fallback
 *                   (dispatched, errored — distinct from never-dispatched).
 *   - "no-record" — NO record at all (silent death / never dispatched). The
 *                   death signal. Fails the CLI.
 *
 * RUN-ID CORRELATION
 * ------------------
 * The completion record does NOT today carry a sprint/run id (schema:
 * dispatch_id, pid, role, provider, model, started_at, completed_at, elapsed_ms,
 * prompt_bytes, cmdline_checksum, exit_code, stdout_bytes, stderr_bytes,
 * fallback, ok). So we cannot filter by an embedded runId field. Instead the
 * caller passes the wall-clock window the run occupied — `since` (and optional
 * `until`) ISO timestamps or epoch ms — and we treat any completion whose
 * `completed_at` falls in that window as belonging to the run. The `runId` is
 * carried through to the result purely as a label for telemetry/printing.
 *
 * This matches how a real gauntlet is verified: the orchestrator knows when it
 * started the gauntlet phase, snapshots that timestamp, dispatches the roles,
 * then calls verifyGauntlet({ runId, roles, since: phaseStart }). Anything that
 * completed before phaseStart belongs to an earlier phase and is ignored.
 *
 * Usage (module):
 *   const { verifyGauntlet } = require("./dispatch/gauntlet-verify");
 *   const res = verifyGauntlet({
 *     runId: "SP-20260526-001",
 *     roles: ["reviewer", "compliance", "qa", "redteam"],
 *     since: phaseStartIso,        // optional but strongly recommended
 *   });
 *   if (!res.ok) // some required role is no-record → halt, do not trust narration
 *
 * Usage (CLI):
 *   node scripts/dispatch/gauntlet-verify.js \
 *     --run SP-20260526-001 \
 *     --roles reviewer,compliance,qa,redteam \
 *     [--since 2026-05-26T18:00:00.000Z] [--until <iso>] \
 *     [--completions <path>] [--json]
 *
 * Exit codes:
 *   0 — every required role has a well-formed completion record (ran / fell-back).
 *   1 — at least one required role is no-record / ill-typed / ledger malformed-tainted.
 *   2 — usage / internal error (fail-closed).
 *
 * By default a role that is "ran" OR "fell-back" satisfies the gauntlet (it was
 * dispatched and produced a well-formed record). "failed" (dispatched-but-errored),
 * "ill-typed" (ok:true but missing required fields), and "no-record" (never ran)
 * all fail the CLI. Pass --allow-failed to treat "failed" as satisfied (the
 * orchestrator handled the failure itself and just wants the never-ran check).
 * Pass --strict-fallback to fail when any role only fell back to Claude.
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");
const { PATHS } = require("../hooks/lib/paths");
const { normalizeRole } = require("../hooks/lib/role-aliases");
// ED-231 whole-ledger signing (SP-20260718-004 Phase 2, β RIDER-1 — MISTAKE-CLASS priority): the
// liveness reader must not trust a FIELD-ONLY ok:true record. A forged UNSIGNED record has the right
// fields but no valid origin-proof signature (attest-signing.js / ADR-0025). verifyRecord is the SAME
// verifier cert-attest uses on the binding surface — extending it here closes the same mistake class
// one reader over (a hand-authored ok:true liveness record fooling the release gate).
const { verifyRecord } = require("./attest-signing");

// ── FIX1: Future-timestamp clamp constant ─────────────────
// A legitimate completion record cannot be from the future. A small skew
// allowance tolerates system clock drift across machines. Records whose
// completed_at exceeds now + FUTURE_SKEW_ALLOWANCE_MS are excluded even
// when an explicit `until` is set absurdly high (defense-in-depth against
// the "Golden Ticket" attack — injecting a far-future record to permanently
// satisfy a role for all future windowed verifies).
// DEFERRED: per-runId correlation (no embedded runId in schema today);
// the time-window fix closes the practical exploit. See brief notes.
const FUTURE_SKEW_ALLOWANCE_MS = 24 * 60 * 60 * 1000; // 24 h clock-skew allowance

// ── Ledger location ────────────────────────────────────────
// paths.dispatchCompletionsFile is the registered key the dispatch wrapper
// writes to; paths.runtime is the registered fallback dir for the bare-
// bootstrap case where the completions key is somehow unset. No raw string
// literals — both come from the paths registry (CLAUDE.md paths rule).
function defaultCompletionsFile() {
  return (
    PATHS.dispatchCompletionsFile ||
    path.join(PATHS.runtime, "dispatch-completions.jsonl")
  );
}

// ── Time-window helpers ────────────────────────────────────
// Accept ISO strings or epoch-ms numbers/strings. Returns ms or null.
function toMs(v) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// R-6 (SP-20260611-001) — a window bound is "PROVIDED" when it is a non-empty value
// the caller actually passed (not undefined/null/empty). Absent bounds keep the
// existing whole-ledger semantics; a PROVIDED-but-unparseable bound is a hard error
// (it would otherwise silently degrade to null → the forbidden whole-ledger scan).
function isProvidedBound(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "number") return true; // a number (even NaN/Infinity) is a provided bound
  return String(v).trim() !== ""; // non-empty string is provided; "" / whitespace is absent
}

function recordCompletedMs(rec) {
  // Prefer completed_at; fall back to started_at; then null (unknown time).
  return toMs(rec.completed_at) ?? toMs(rec.started_at);
}

// ── Typed-success shape check (BC-16) ─────────────────────
/**
 * Check whether an ok:true record satisfies the typed-success predicate.
 * A record counts as "ran" (or "fell-back") ONLY when ALL required fields
 * are well-formed:
 *   - role:      non-empty string
 *   - ok:        exactly true
 *   - provider:  non-empty string
 *   - timestamp: at least one parseable completed_at or started_at
 *
 * An ok:true record missing or garbling any required field is NOT a valid
 * success → caller classifies it as "ill-typed" → fail-closed (BC-16).
 */
function isWellFormedOkRecord(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (typeof rec.role !== "string" || !rec.role.trim()) return false;
  // liveness-verified: shape-only typed-success predicate; origin-proof SIGNATURE verification is applied in
  // verifyGauntlet (the sigOk/requireSignature gate) before a record counts as "ran" — not trusted here.
  if (rec.ok !== true) return false;
  if (typeof rec.provider !== "string" || !rec.provider.trim()) return false;
  // Must have at least one parseable timestamp (even when no window is specified,
  // typed-success requires a timestamp so the record is time-attributable).
  const t = toMs(rec.completed_at) ?? toMs(rec.started_at);
  if (t === null) return false;
  return true;
}

// ── Ledger reader ──────────────────────────────────────────
/**
 * Read + parse the completions JSONL.
 *
 * FAIL-CLOSED POLICY (BC-16): malformed/unparseable lines are COUNTED and
 * surfaced so the verifier can fail-closed when a run window is active. When
 * a window IS specified, we cannot time-attribute a corrupt line; it COULD be
 * the missing record for a required role, so we treat its presence as
 * "ledger tainted" → ok:false. When no window is specified (caller sees the
 * whole ledger) we are lenient: valid lines are returned, malformed count is
 * reported but does NOT force a fail.
 *
 * Returns { records, malformed, missing } where:
 *   records   — successfully parsed records
 *   malformed — count of unparseable non-blank lines
 *   missing   — true when the file did not exist / could not be read
 */
function readCompletions(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { records: [], malformed: 0, malformedLineIndices: [], recordLineIndices: [], missing: true };
  }
  const records = [];
  // FIX2: track 0-based file-line index for each parsed record and each malformed
  // line so the verifier can do positional taint scoping (historic corruption before
  // the run window does NOT taint a windowed verify).
  const recordLineIndices = [];   // parallel to records: line index of each parsed record
  const malformedLineIndices = []; // line indices of unparseable non-blank lines
  let malformed = 0;
  let lineIdx = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { lineIdx++; continue; }
    try {
      records.push(JSON.parse(trimmed));
      recordLineIndices.push(lineIdx);
    } catch {
      malformedLineIndices.push(lineIdx);
      malformed++;
    }
    lineIdx++;
  }
  return { records, malformed, malformedLineIndices, recordLineIndices, missing: false };
}

// ── Core verification ──────────────────────────────────────
/**
 * Verify that each expected gauntlet role produced a well-formed completion
 * record in the given run window. Implements typed-success (BC-16):
 * malformed, ill-typed, and no-record all fail-closed.
 *
 * @param {object}   args
 * @param {string}   args.runId          - label for the run (telemetry/printing only)
 * @param {string[]} args.roles          - expected gauntlet roles (legacy names ok; normalized)
 * @param {string}   [args.sprintId]     - F-3 correlation: sprint id to match against record's
 *   sprint_id field. Records with a non-matching sprint_id are excluded; records without a
 *   sprint_id fall through to time-window correlation (backwards compat for pre-F-3 ledgers).
 * @param {string|number} [args.since]   - window start (ISO or epoch ms); records before are ignored
 * @param {string|number} [args.until]   - window end (ISO or epoch ms); records after are ignored
 * @param {string}   [args.completionsFile] - override ledger path (default: paths.dispatchCompletionsFile)
 * @param {object[]} [args.records]      - inject pre-parsed records (testing); bypasses file read
 * @param {boolean}  [args.allowFailed]  - DEPRECATED (BC-16 FIX3): accepted for backward compat
 *   but no longer greens a role whose only record is ok:false. A pure-failed role is never
 *   satisfied regardless of this flag. It remains accepted at CLI level to avoid breaking
 *   existing call sites.
 * @param {boolean}  [args.strictFallback] - treat fell-back-to-claude as unsatisfied (default false)
 * @returns {{
 *   ok: boolean,
 *   runId: string,
 *   sprintId: string|undefined,
 *   window: { sinceMs: number|null, untilMs: number|null },
 *   completionsFile: string|null,
 *   ledgerMissing: boolean,
 *   malformedLines: number,
 *   malformedTainted: boolean,
 *   considered: number,
 *   roles: Array<{
 *     role: string,
 *     status: string,
 *     satisfied: boolean,
 *     record: object|null,
 *     count: number,
 *     wellFormed: boolean|null
 *   }>,
 *   missingRoles: string[],
 *   noRolesRequested?: boolean,
 * }}
 */
function verifyGauntlet(args = {}) {
  const runId = args.runId || "(unlabeled)";

  // R-6 (SP-20260611-001) — programmatic parse refusal. The CLI already refuses an
  // unparseable --since/--until (with its own message) BEFORE calling here, but a
  // PROGRAMMATIC caller passing garbage since/until previously degraded silently:
  // toMs() → null → no window → the forbidden whole-ledger scan. The enforcement point
  // belongs in the library. When since/until is PROVIDED (a non-empty value the caller
  // passed) but unparseable, THROW — never silently widen. Absent/null/empty bounds keep
  // the existing whole-ledger semantics. (ED-043 class: refusals self-identify.)
  for (const [name, val] of [["since", args.since], ["until", args.until]]) {
    if (isProvidedBound(val) && toMs(val) === null) {
      throw new Error(
        `verifyGauntlet: unparseable window (${name}=${JSON.stringify(val)}) — refusing ` +
        "(whole-ledger scan is forbidden); pass valid ISO timestamps or epoch ms",
      );
    }
  }

  // F-3: sprint correlation — records with a non-matching sprint_id are excluded.
  // Records without sprint_id fall through to time-window correlation (backwards compat).
  const sprintId = args.sprintId ? String(args.sprintId).trim() : null;
  const allowFailed = !!args.allowFailed;
  const strictFallback = !!args.strictFallback;
  // ED-231 whole-ledger signing (β RIDER-1). When true, an ok:true WELL-FORMED record must ALSO carry
  // a valid origin-proof signature (attest-signing.verifyRecord) or it is demoted to "unsigned"
  // (fail-closed) — a forged unsigned liveness record can no longer read as "ran". Default FALSE in
  // this programmatic API (preserves the shape-focused unit tests, which construct unsigned records);
  // the CLI — the actual release/WG-19 gate — defaults it TRUE (env MC_GAUNTLET_REQUIRE_SIG=0 to
  // disable). Any programmatic caller reading liveness across a trust boundary MUST pass true.
  const requireSignature = args.requireSignature === true;

  const rolesIn = Array.isArray(args.roles) ? args.roles : [];
  // Normalize legacy names (evaluator→reviewer, auditor→learner) and de-dupe
  // while preserving first-seen order.
  const seen = new Set();
  const roles = [];
  for (const r of rolesIn) {
    const canon = normalizeRole(String(r).trim());
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    roles.push(canon);
  }

  // FIX4: An empty roles list cannot vacuously be "all satisfied".
  // The CLI already errors on --roles with empty list; the module API must also guard.
  // Return ok:false with a clear noRolesRequested signal so callers can't misread green.
  if (roles.length === 0) {
    const sinceMs0 = toMs(args.since);
    const untilMs0 = toMs(args.until);
    return {
      ok: false,
      runId,
      sprintId: sprintId || undefined,
      window: { sinceMs: sinceMs0, untilMs: untilMs0 },
      completionsFile: null,
      ledgerMissing: false,
      malformedLines: 0,
      malformedTainted: false,
      considered: 0,
      roles: [],
      missingRoles: [],
      noRolesRequested: true,
    };
  }

  const sinceMs = toMs(args.since);
  const untilMs = toMs(args.until);
  // A "window" is active when at least one bound is specified.
  const hasWindow = sinceMs !== null || untilMs !== null;

  let records;
  let malformed = 0;
  let malformedLineIndices = []; // FIX2: line indices of unparseable lines in the file
  let recordLineIndices = [];    // FIX2: line indices of successfully parsed records (parallel to records)
  let ledgerMissing = false;
  let completionsFile = null;
  if (Array.isArray(args.records)) {
    records = args.records;
  } else {
    completionsFile = args.completionsFile || defaultCompletionsFile();
    const read = readCompletions(completionsFile);
    records = read.records;
    malformed = read.malformed;
    malformedLineIndices = read.malformedLineIndices || [];
    recordLineIndices = read.recordLineIndices || [];
    ledgerMissing = read.missing;
  }

  // FIX1: Stable "now" for this verify call — computed once so all checks are
  // consistent. Used as the default upper bound (no explicit `until`) and as the
  // base for the hard ceiling that blocks injected far-future records even when
  // an explicit `until` is set absurdly high (Golden Ticket defense-in-depth).
  const nowMs = Date.now();
  // When a window is active and no explicit `until` was given, default to
  // nowMs + FUTURE_SKEW_ALLOWANCE_MS so that legitimate completion records from
  // machines whose clock is slightly AHEAD of the verifier (e.g. a few seconds
  // to several minutes) are still accepted. Without the skew allowance, even a
  // 1-second clock difference causes a false-RED because `t > nowMs` fires before
  // the hardCeiling check. The allowance is 24h — same constant used by the
  // hard ceiling — so clock-skew records are accepted while far-future injection
  // (t >> now+24h) is still blocked by the hardCeilingMs line below.
  const effectiveUntilMs = untilMs ?? (hasWindow ? nowMs + FUTURE_SKEW_ALLOWANCE_MS : null);
  // Hard ceiling: records > nowMs + 24h are excluded regardless of explicit `until`
  // (defense-in-depth against an absurdly large explicit until).
  const hardCeilingMs = nowMs + FUTURE_SKEW_ALLOWANCE_MS;

  // Filter to the run window. A record with an unknown timestamp is kept only
  // when no window was specified (so a caller who passes neither since nor until
  // sees the whole ledger); when a window IS specified, unknown-time records are
  // dropped (they can't be proven to belong to this run).
  // FIX1: future-dated records are excluded via effectiveUntilMs + hardCeilingMs.
  // F-3: sprint-ID correlation — if a record carries sprint_id and it doesn't match
  //   the requested sprintId, exclude it. Records without sprint_id fall through to
  //   time-window correlation (backwards compat for pre-F-3 ledgers).
  const inWindow = (rec) => {
    // F-3: sprint-ID mismatch filter (additive on top of time-window).
    if (sprintId && rec.sprint_id !== undefined && rec.sprint_id !== sprintId) return false;
    // F-3 fix-cycle (claude backend lane, 2026-06-10, CONFIRMED via live CLI):
    // when sprint correlation is the SOLE bound (no time window), a record
    // LACKING sprint_id must NOT count — otherwise any historic pre-F-3 ok:true
    // record greens a never-ran lane (exactly the T3 class F-3 exists to close).
    // Pre-F-3 sprint_id-less ledgers are verified via window mode (--since/--until).
    if (sprintId && rec.sprint_id === undefined && sinceMs === null && untilMs === null) return false;
    const t = recordCompletedMs(rec);
    if (sinceMs === null && untilMs === null) return true; // whole-ledger view
    if (t === null) return false; // unknown timestamp: cannot prove in-window
    if (sinceMs !== null && t < sinceMs) return false;
    // FIX1: apply effective upper bound (defaults to now when no explicit until)
    if (effectiveUntilMs !== null && t > effectiveUntilMs) return false;
    // FIX1: hard ceiling — defense-in-depth against injected far-future records
    if (t > hardCeilingMs) return false;
    return true;
  };
  const considered = records.filter(inWindow);

  // FIX2: Positional malformed-taint scoping.
  //
  // OLD (buggy): filemalformedTainted = malformed > 0 && hasWindow
  //   Bug (a) FALSE-RED: one historic malformed line bricks ALL windowed verifies forever.
  //   Bug (b) FALSE-OPEN: no-window → malformed lines ignored entirely.
  //
  // NEW (FIX2 + leading/trailing-edge closure, BC-16):
  //   (a) No window active → any malformed line taints (fail-closed, BC-16).
  //   (b) Window active → taint when a malformed line falls in the span
  //       [firstInWindowIdx - 1 .. ∞):
  //         • leading edge  (idx == firstInWindowIdx - 1): immediately before the
  //           run's first valid record could be a half-written record from THIS
  //           run's start → taint (leading-edge hole fixed here).
  //         • in-window / trailing (idx >= firstInWindowIdx): already taints.
  //         • historic safe zone (idx < firstInWindowIdx - 1): clearly predates
  //           this run → does NOT taint (preserves DoS-blast-radius fix).
  //       Edge: no in-window valid records AND malformed>0 → taint (the malformed
  //       line COULD be the missing record for a required role).
  let filemalformedTainted = false;
  if (malformed > 0) {
    if (!hasWindow) {
      // No window: fail-closed on any malformed line (FIX2 bug-b fix).
      filemalformedTainted = true;
    } else {
      // Window active: positional scoping (FIX2 bug-a fix).
      // Build the set of line indices belonging to in-window valid records.
      const inWindowLineIdxs = [];
      for (let i = 0; i < records.length; i++) {
        if (inWindow(records[i]) && i < recordLineIndices.length) {
          inWindowLineIdxs.push(recordLineIndices[i]);
        }
      }
      if (inWindowLineIdxs.length === 0) {
        // No valid in-window records AND malformed lines exist → the malformed line
        // could BE the missing record for a required role → taint.
        filemalformedTainted = true;
      } else {
        const firstInWindowIdx = Math.min(...inWindowLineIdxs);
        const lastInWindowIdx  = Math.max(...inWindowLineIdxs);
        // Taint span (FIX2 leading+trailing-edge closure, BC-16):
        //   [firstInWindowIdx - 1 .. ∞)
        //
        //   Leading edge:  a malformed line immediately before the first in-window
        //                  record (idx == firstInWindowIdx - 1) could be a
        //                  half-written/corrupt record from THIS run's start
        //                  (append-only does NOT prove a leading-edge malformed
        //                  line is historic) → taint.
        //   Trailing edge: a malformed line after the last in-window record
        //                  (idx > lastInWindowIdx) could be a crash-mid-write
        //                  from THIS run → taint. The simplified span covers this
        //                  automatically (anything >= firstInWindowIdx-1).
        //   Historic safe zone: malformed lines more than 1 line before the first
        //                  in-window record (idx < firstInWindowIdx - 1) predate
        //                  this run → do NOT taint (preserves DoS-blast-radius
        //                  fix from FIX2a — ancient corruption does not brick the
        //                  gate permanently).
        void lastInWindowIdx; // computed for documentation; span simplifies to idx >= fI-1
        filemalformedTainted = malformedLineIndices.some((idx) => idx >= firstInWindowIdx - 1);
      }
    }
  }

  // Bucket considered records by canonical role. Records with a null/empty
  // canonical role are silently skipped (they can't match any requested role).
  const byRole = new Map();
  for (const rec of considered) {
    const canon = normalizeRole(rec.role);
    if (!canon) continue;
    if (!byRole.has(canon)) byRole.set(canon, []);
    byRole.get(canon).push(rec);
  }

  // Track whether any role's best-available ok:true record is ill-typed
  // (ok:true but fails the typed-success shape check). This contributes to
  // malformedTainted independently of the file-level malformed count.
  let illTypedTaint = false;

  const roleResults = roles.map((role) => {
    const recs = byRole.get(role) || [];
    let status;
    let record = null;
    let wellFormed = null; // null = no ok:true record to evaluate

    if (recs.length === 0) {
      status = "no-record";
    } else {
      // Among this role's records, the best outcome wins (a later successful
      // retry should count as ran even if an earlier attempt failed).
      // Typed-success (BC-16): ok:true records are only counted as "ran" or
      // "fell-back" when they pass isWellFormedOkRecord(). Records that are
      // ok:true but malformed/ill-typed are demoted to "ill-typed".
      // ED-231 (β RIDER-1): when requireSignature, an ok:true well-formed record ALSO needs a valid
      // origin-proof signature. sigOk gates the "ran"/"fell-back" success paths; an ok:true well-formed
      // record that fails verifyRecord is a forged/unsigned liveness record → the "unsigned" fail-closed
      // status below. When requireSignature is false, sigOk is a no-op (preserves legacy behavior).
      const sigOk = (r) => !requireSignature || verifyRecord(r);
      const okRec = recs.find((r) => r.ok === true && !r.fallback && isWellFormedOkRecord(r) && sigOk(r));
      const fbRec = recs.find((r) => r.ok === true && r.fallback && isWellFormedOkRecord(r) && sigOk(r));
      const illTypedRec = recs.find((r) => r.ok === true && !isWellFormedOkRecord(r));
      // A well-formed ok:true record that FAILS signature verification (only reachable when
      // requireSignature): the forged/unsigned liveness record the release gate must never trust.
      const unsignedRec = requireSignature
        ? recs.find((r) => r.ok === true && isWellFormedOkRecord(r) && !verifyRecord(r))
        : null;
      const failRec = recs.find((r) => r.ok !== true);

      if (okRec) {
        status = "ran";
        record = okRec;
        wellFormed = true;
      } else if (fbRec) {
        status = "fell-back";
        record = fbRec;
        wellFormed = true;
      } else if (unsignedRec) {
        // ok:true + well-formed but NO valid origin-proof signature → forged/unsigned liveness record.
        // Fail-closed (ED-231 whole-ledger signing, β RIDER-1); taints the ledger like ill-typed.
        status = "unsigned";
        record = unsignedRec;
        wellFormed = false;
        illTypedTaint = true;
      } else if (illTypedRec) {
        // ok:true exists but fails the typed-success shape check → ill-typed
        status = "ill-typed";
        record = illTypedRec;
        wellFormed = false;
        illTypedTaint = true;
      } else {
        status = "failed";
        record = failRec || recs[recs.length - 1];
        wellFormed = null;
      }
    }

    let satisfied;
    if (status === "ran") satisfied = true;
    else if (status === "fell-back") satisfied = !strictFallback;
    else if (status === "failed") satisfied = false; // FIX3: allowFailed can no longer green a
    // pure-failed role (BC-16 typed-success). A role whose best record is ok:false has no
    // well-formed success → never satisfied. --allow-failed is kept at CLI level for backward
    // compat (accepted, no error) but is now a no-op for pure-failed roles. allowFailed is
    // intentionally unused here.
    else satisfied = false; // no-record and ill-typed both fail

    return { role, status, satisfied, record, count: recs.length, wellFormed };
  });

  const missingRoles = roleResults
    .filter((r) => !r.satisfied)
    .map((r) => r.role);

  // malformedTainted: true when the ledger has taint that could hide a missing
  // record. Forces ok:false regardless of role-level satisfaction.
  //   (a) file had unparseable lines AND a window was active (time-unattributable
  //       malformed line could be the missing record)
  //   (b) any role's best ok:true record failed the typed-success shape check
  const malformedTainted = filemalformedTainted || illTypedTaint;

  return {
    ok: missingRoles.length === 0 && !malformedTainted,
    runId,
    sprintId: sprintId || undefined,
    window: { sinceMs, untilMs },
    completionsFile,
    ledgerMissing,
    malformedLines: malformed,
    malformedTainted,
    considered: considered.length,
    roles: roleResults,
    missingRoles,
  };
}

module.exports = {
  verifyGauntlet,
  readCompletions,
  defaultCompletionsFile,
  isWellFormedOkRecord,
};

// ── CLI ────────────────────────────────────────────────────
if (require.main === module) {
  try {
    const argv = process.argv.slice(2);

    function getFlag(name) {
      const i = argv.indexOf(`--${name}`);
      if (i === -1) return undefined;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return true; // boolean flag
      return next;
    }

    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(
        [
          "gauntlet-verify — verify each gauntlet role produced a well-formed completion record.",
          "",
          "BC-16 typed-success enforcer: absence of an ok:true well-formed record for a required",
          "role IS the death signal. Malformed/ill-typed/no-record all fail-CLOSED.",
          "Never trust orchestrator narration; trust the ledger.",
          "",
          "F-3 (E-DISPATCH-INTEGRITY-001): unbounded whole-ledger verification is REFUSED.",
          "Pass --sprint <id> or a time window (--since/--until) to correlate records to the",
          "current sprint/run. A historic ok:true must never green a never-ran lane.",
          "",
          "Usage:",
          "  node scripts/dispatch/gauntlet-verify.js --run <id> --roles a,b,c \\",
          "    [--sprint <sprint-id>] [--since <iso|ms>] [--until <iso|ms>] \\",
          "    [--completions <path>] [--allow-failed] [--strict-fallback] [--json]",
          "",
          "Exit: 0 = all roles have a well-formed record; 1 = no-record/ill-typed/malformed-tainted; 2 = usage/internal error.",
          "",
          "Flags:",
          "  --sprint <id>       F-3 correlation: records with a non-matching sprint_id are excluded.",
          "                      Records without sprint_id fall through to time-window correlation.",
          "                      Required when --since/--until are not provided.",
          "  --allow-failed      Accepted for backward compat; no longer greens a pure-failed role (BC-16 FIX3).",
          "                      A role whose only record is ok:false is never satisfied regardless of this flag.",
          "  --strict-fallback   Fail when any role only fell back to Claude (default: fell-back counts as ran).",
          "  --no-require-sig    Disable origin-proof signature verification (ED-231). Default is ON — a",
          "                      forged UNSIGNED ok:true record is fail-closed as 'unsigned'. Escape for",
          "                      transition/debug only; also MC_GAUNTLET_REQUIRE_SIG=0.",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }

    const runId = getFlag("run") || getFlag("run-id");
    const sprintIdArg = getFlag("sprint");
    const rolesArg = getFlag("roles");
    const since = getFlag("since");
    const until = getFlag("until");
    const completionsFile = getFlag("completions");
    const jsonMode = argv.includes("--json");
    const allowFailed = argv.includes("--allow-failed");
    const strictFallback = argv.includes("--strict-fallback");
    // ED-231 whole-ledger signing (β RIDER-1, MISTAKE-CLASS priority): the CLI IS the release/WG-19
    // liveness gate, so it requires origin-proof signatures BY DEFAULT — a forged unsigned ok:true
    // record can never green a lane here. Opt out with --no-require-sig or MC_GAUNTLET_REQUIRE_SIG=0
    // (a named, deliberate escape for a transition/debug, never a silent default).
    const requireSignature =
      !argv.includes("--no-require-sig") && mcEnv.readEnv("GAUNTLET_REQUIRE_SIG") !== "0";

    if (!rolesArg || rolesArg === true) {
      process.stderr.write(
        "Usage error: --roles <comma,separated,list> is required. See --help.\n",
      );
      process.exit(2);
    }
    const roles = String(rolesArg)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (roles.length === 0) {
      process.stderr.write("Usage error: --roles resolved to an empty list.\n");
      process.exit(2);
    }

    // F-3 (E-DISPATCH-INTEGRITY-001): refuse unbounded whole-ledger verification.
    // A historic ok:true record must never satisfy a never-ran lane for the current sprint.
    // Callers MUST supply either --sprint <id> or a time window (--since/--until).
    const hasSprintCorrelation = sprintIdArg && sprintIdArg !== true;
    const hasWindow = (since !== undefined && since !== true) || (until !== undefined && until !== true);
    if (!hasSprintCorrelation && !hasWindow) {
      process.stderr.write(
        "Usage error (F-3): gauntlet-verify requires --sprint <id> or a time window " +
        "(--since and/or --until) to prevent a historic ok:true record from satisfying " +
        "a never-ran lane. Unbounded whole-ledger verification is refused. " +
        "See E-DISPATCH-INTEGRITY-001 F-3.\n",
      );
      process.exit(2);
    }
    // F-3 fix-cycle (claude qa lane 2026-06-10, REPRODUCED on the real ledger): a
    // PRESENT-but-UNPARSEABLE --since/--until value passed the presence-based refusal
    // above while parsing to null inside verifyGauntlet — silently widening to a
    // whole-ledger scan (the exact T3 class). Validate parseability HERE; refuse loud.
    for (const [flagName, flagVal] of [["--since", since], ["--until", until]]) {
      if (flagVal !== undefined && flagVal !== true && toMs(flagVal) === null) {
        process.stderr.write(
          `Usage error (F-3): ${flagName} value "${flagVal}" is not a parseable timestamp ` +
          "(ISO 8601 or epoch ms). Refusing — an unparseable window would silently widen " +
          "to an unbounded whole-ledger scan.\n",
        );
        process.exit(2);
      }
    }

    const result = verifyGauntlet({
      runId: runId && runId !== true ? runId : undefined,
      sprintId: hasSprintCorrelation ? String(sprintIdArg) : undefined,
      roles,
      since: since === true ? undefined : since,
      until: until === true ? undefined : until,
      completionsFile:
        completionsFile && completionsFile !== true ? completionsFile : undefined,
      allowFailed,
      strictFallback,
      requireSignature,
    });

    if (jsonMode) {
      process.stdout.write(JSON.stringify(result) + "\n");
    } else {
      const SEP = "─".repeat(60);
      const lines = [];
      lines.push(
        `Gauntlet verification — run ${result.runId} — ${result.ok ? "PASS" : "FAIL"}`,
      );
      lines.push(SEP);
      if (result.ledgerMissing) {
        lines.push(
          `  (!) completions ledger not found: ${result.completionsFile}`,
        );
        lines.push(
          "      No dispatch ever recorded — every role reads as no-record.",
        );
      }
      if (result.malformedTainted) {
        lines.push(
          `  (!) MALFORMED-TAINTED: ${result.malformedLines} unparseable ledger line(s) — ` +
          `ledger cannot be trusted (BC-16 typed-success: fail-CLOSED).`,
        );
      } else if (result.malformedLines > 0) {
        lines.push(
          `  (i) skipped ${result.malformedLines} malformed ledger line(s) (no window active — lenient)`,
        );
      }
      for (const r of result.roles) {
        const icon =
          r.status === "ran"
            ? "ok"
            : r.status === "fell-back"
              ? "fb"
              : r.status === "failed"
                ? "xx"
                : r.status === "ill-typed"
                  ? "~~" // ill-typed: ok:true but missing required fields (BC-16)
                  : r.status === "unsigned"
                    ? "$$" // unsigned: ok:true well-formed but no valid origin-proof sig (ED-231)
                    : "!!"; // no-record
        const role = String(r.role).padEnd(12);
        const status = String(r.status).padEnd(10);
        let detail = "";
        if (r.status === "ill-typed" && r.record) {
          const provider = r.record.provider || "(missing)";
          const ts = r.record.completed_at || r.record.started_at || "(no timestamp)";
          detail = `ok:true but ILL-TYPED — provider=${provider}, ts=${ts} — NOT a valid success (BC-16)`;
        } else if (r.status === "unsigned" && r.record) {
          const provider = r.record.provider || "?";
          detail = `ok:true well-formed but UNSIGNED/forged — no valid origin-proof signature (provider=${provider}) — NOT trusted (ED-231, fail-closed)`;
        } else if (r.record) {
          const provider = r.record.provider || "?";
          const model = r.record.model || "?";
          detail = `${provider}/${model}`;
          if (r.count > 1) detail += ` (${r.count} records)`;
        } else {
          detail = "NO COMPLETION RECORD — silent death or never dispatched";
        }
        lines.push(`  ${icon}  ${role} ${status} ${detail}`.trimEnd());
      }
      lines.push(SEP);
      lines.push(`  considered ${result.considered} record(s) in window`);
      if (result.ok) {
        lines.push("  All required gauntlet roles produced a well-formed completion record.");
      } else {
        if (result.missingRoles.length > 0) {
          lines.push(
            `  MISSING/UNSATISFIED: ${result.missingRoles.join(", ")} — do NOT trust "all passed". Re-dispatch these roles.`,
          );
        }
        if (result.malformedTainted) {
          lines.push(
            "  LEDGER TAINTED by malformed/ill-typed records — re-inspect ledger before trusting any result.",
          );
        }
      }
      process.stdout.write(lines.join("\n") + "\n");
    }

    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    // Internal error → fail-CLOSED (exit 2, never 0). A crash in the verifier
    // must not be interpreted as a passing gauntlet. (BC-16 typed-success)
    process.stderr.write(
      `[gauntlet-verify] internal error: ${err && err.message ? err.message : String(err)}\n`,
    );
    process.exit(2);
  }
}
