#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/checks/epsilon-liveness.js — detect a stalled sprint conductor (WG-6).
 *
 * A stalled conductor is self-detecting: in-process evidence files exist but have
 * no matching completion record in the dispatch ledger after N minutes. This happens
 * when a teammate-ε dispatches subprocesses and goes idle waiting for returns that
 * will never re-wake it (WG-6 — observed ×3 as 25-minute stalls; the harness only
 * re-wakes a teammate on an incoming SendMessage, never on a subprocess completing).
 *
 * Logic:
 *   - Scan the evidence dir for *.return.txt files older than --stale-minutes (default 10).
 *   - For each stale file, look for a ledger record in dispatch-completions.jsonl that:
 *       (a) has evidence_sha matching the file's sha256 (primary match), OR
 *       (b) has sprint_id+step+role that reconstruct the file's basename (fallback match).
 *   - Missing record → epsilon-stalled finding → exit 1 (fail-closed).
 *   - Empty/missing dirs → exit 0 with "nothing to check" (not an error).
 *   - Malformed ledger line → count + warn; do NOT crash.
 *   - Fully unreadable ledger WITH evidence present → exit 1 (fail-closed; a gate must
 *     not green on a lying input).
 *
 * Usage:
 *   node scripts/checks/epsilon-liveness.js [--evidence-dir <path>]
 *       [--ledger <path>] [--stale-minutes <N>] [--now <ISO>] [--json]
 *
 * The pure evaluate() is exported for deterministic fixture tests.
 * Linked: doogle WG-6 / ED-041 / T-291 / epsilon.md TEAMMATE STALL RULES
 */

const fs = require("fs");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const { isStartedRow } = require("../dispatch/dispatch-record-fields");
const { verifyRecord } = require("../dispatch/attest-signing");
const path = require("path");
const crypto = require("crypto");

const START = Date.now();
const NAME = "epsilon-liveness";

// Resolve from this script's own location so the check validates the tree it lives in —
// correct in a worktree (uncommitted edits) and when shipped.
const ROOT = path.resolve(__dirname, "..", "..");

// Default evidence directories to probe in order (first that exists wins, unless --evidence-dir).
const DEFAULT_EVIDENCE_DIRS = [
  path.join(ROOT, ".claude", "runtime", "epsilon-prompts"),
  path.join(ROOT, "runtime", "epsilon-prompts"),
];
const DEFAULT_LEDGER = path.join(ROOT, ".claude", "runtime", "dispatch-completions.jsonl");
const DEFAULT_STALE_MINUTES = 10;
// A canonical ISO-8601 instant, as recordCompletion writes completed_at ("2026-07-23T09:25:47.127Z").
// backend-7G-007 (r3e): Date.parse COERCES non-strings (completed_at:0 → a finite ms), so the terminal
// check must require a real ISO STRING, not merely a Date.parse-able value.
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
// backend-7G-012 (r3g): ISO_TS_RE validates SHAPE, not CALENDAR validity — a signed "2026-02-31T00:00:00.000Z"
// (Feb 31, impossible) passes the regex, Date-normalizes to Mar 3, and suppresses the waiter. The EXACT
// toISOString() ROUND-TRIP accepts ONLY a real producer timestamp: a calendar-invalid (or non-canonical, e.g.
// non-Z-offset) value normalizes to a DIFFERENT string and fails. Validated: 0 round-trip failures across all
// 760 completed_at + 753 started_at real production timestamps. Same positive/exact-validation lesson as the
// msg_id allowlist — accept only the producer's exact canonical form, never shape-only.
function isCanonicalIso(x) {
  if (typeof x !== "string" || !ISO_TS_RE.test(x)) return false;
  const d = new Date(x);
  return Number.isFinite(d.getTime()) && d.toISOString() === x;
}
// Clock-skew tolerance for the temporal bound (backend-7G-013): a completion/start at most SKEW_MS in the
// FUTURE of the scan clock is allowed (minor cross-host skew); beyond it is impossible -> fail-closed. nowMs
// is the SCAN clock (Date.now() at the CLI, or --now for tests), NEVER a record-supplied field.
const SKEW_MS = 5 * 60 * 1000;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

const JSON_OUT = process.argv.includes("--json");

// ── Pure core ──────────────────────────────────────────────────────────────

/**
 * Pure evaluation — no filesystem I/O.
 *
 * @param {object} opts
 * @param {Array<{path:string, mtimeMs:number, sha256:string}>} opts.evidenceFiles
 *   Evidence files already older than the stale threshold, with pre-computed sha256.
 * @param {string[]|null} opts.ledgerLines
 *   Raw lines from the completions ledger, or null if the ledger is unreadable.
 * @param {number} opts.nowMs
 *   Reference "now" in milliseconds (enables deterministic tests via --now).
 * @returns {{ ok:boolean, findings:Array, malformedLines:number, ledgerUnreadable:boolean }}
 */
function evaluate({ evidenceFiles, ledgerLines, nowMs, requireSignature = true }) {
  // Fail-closed: unreadable ledger + evidence present = cannot confirm completions.
  if (ledgerLines === null && evidenceFiles.length > 0) {
    return {
      ok: false,
      findings: evidenceFiles.map((f) => ({
        type: "epsilon-stalled",
        evidenceFile: f.path,
        reason: `ledger unreadable — cannot verify completion for stale evidence file (${Math.round((nowMs - f.mtimeMs) / 60000)}m old)`,
      })),
      malformedLines: 0,
      ledgerUnreadable: true,
    };
  }

  // No stale evidence → nothing to check.
  if (!evidenceFiles.length) {
    return { ok: true, findings: [], malformedLines: 0, ledgerUnreadable: false };
  }

  // Parse ledger records — warn on malformed lines; do NOT crash (partial ledger is usable).
  const records = [];
  let malformedLines = 0;
  for (const line of ledgerLines || []) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      malformedLines++;
    }
  }

  const findings = [];
  for (const ef of evidenceFiles) {
    // FAIL-CLOSED (gauntlet 2026-06-10 qa lane): unreadable evidence cannot be
    // matched — always a finding, never a silent skip.
    if (ef.unreadable) {
      findings.push({
        type: "epsilon-stalled",
        evidenceFile: ef.path,
        reason: ef.mtimeMs === null
          ? "evidence file is un-stat-able — cannot verify freshness or completion (fail-closed)"
          : `evidence file aged ${Math.round((nowMs - ef.mtimeMs) / 60000)}m is unreadable — cannot verify completion (fail-closed)`,
      });
      continue;
    }
    const ageMins = Math.round((nowMs - ef.mtimeMs) / 60000);

    // Primary: sha256-based match — the ledger records evidence_sha for in-process spawns. The matching
    // record must be a VERIFIED liveness record (SP-20260718-004 R4 same-session choke-point) — a forged
    // ok:true record can't hide a stall. requireSignature is an INJECTED param (default true) — the old
    // ambient MC_LIVENESS_REQUIRE_SIG=0 runtime env was a settable unsigned-record opt-out (hunter r3
    // #2: reachable false-green in this evidence-file path); test-injection is now the only bypass.
    const _reqSig = requireSignature;
    const shaMatch = records.find(
      (r) => r.evidence_sha === ef.sha256 && isVerifiedLivenessRecord(r, { requireSignature: _reqSig }),
    );
    if (shaMatch) continue;

    // Fallback: filename-based match.  Evidence filenames follow the convention
    // <sprint_id>-<step>-<role>.return.txt (epsilon-runtime record-inprocess pattern).
    const basename = path.basename(ef.path, ".return.txt");
    const filenameMatch = records.find((r) => {
      // SP-20260718-004 R6 (SR-R6-001): the filename-fallback backing record must ALSO be a VERIFIED
      // liveness record (the sha256 primary above already is) — a forged/unsigned record can't hide a stall.
      if (!isVerifiedLivenessRecord(r, { requireSignature: _reqSig })) return false;
      if (!r.sprint_id || !r.step || !r.role) return false;
      return basename === `${r.sprint_id}-${r.step}-${r.role}`;
    });
    if (filenameMatch) continue;

    findings.push({
      type: "epsilon-stalled",
      evidenceFile: ef.path,
      reason: `no ledger record for evidence file aged ${ageMins}m — conductor may be stalled (WG-6)`,
    });
  }

  return { ok: findings.length === 0, findings, malformedLines, ledgerUnreadable: false };
}

/**
 * evaluatePairedWaiter({ records, nowMs, staleMs, windowMs, artifactProduced, isVerified }) -> { findings }
 * ED-256 (SP-20260723-003, DoE design-lock): the WG-6 stall check, scoped from LEDGER STATE — NOT a
 * row-settable opt-in (the earlier `background` predicate stamped by no producer left the check inert on
 * production). OUTSTANDING = a phase:"started" row whose dispatch_id has NO TERMINAL completion (a
 * non-started row with completed_at); an ok:FALSE honest death OR a VERIFIED ok:true completion suppresses.
 * For a STALE (older than staleMs) + RECENT (within windowMs) outstanding row, require POSITIVE liveness:
 * a recorded artifact_path that RESOLVES to a real non-empty file produced after start (artifactProduced),
 * never a stamped field. No terminal completion + no produced artifact ⇒ probable stall / kill-before-
 * record (T-322).
 */
function evaluatePairedWaiter({ records, nowMs, staleMs, windowMs = 2 * 60 * 60 * 1000, artifactProduced, isVerified } = {}) {
  // BOTH terminal branches require ORIGIN VERIFICATION (7G-004: a forged UNSIGNED ok:false suppressed a
  // stall — the settable-label asymmetry). But the verifier DIFFERS by ok value: an ok:TRUE SUCCESS needs
  // a verified LIVENESS record (isVerifiedLivenessRecord = ok:true + signature); an ok:FALSE DEATH needs
  // only a valid SIGNATURE (verifyRecord) — recordCompletion signs both, but isVerifiedLivenessRecord
  // REQUIRES ok:true so it wrongly rejects a real signed death (verified on 144 production deaths → all
  // fail the liveness check; a same-session signed ok:false passes verifyRecord). Always require the sig
  // (QA-R2-001: no MC_LIVENESS_REQUIRE_SIG env downgrade); test-injection via isVerified is the only bypass.
  const verify = typeof isVerified === "function"
    ? isVerified
    : (r) => (r.ok === false ? verifyRecord(r) : isVerifiedLivenessRecord(r, { requireSignature: true }));
  const byId = new Map();
  for (const r of records || []) {
    if (!r || !r.dispatch_id) continue;
    if (!byId.has(r.dispatch_id)) byId.set(r.dispatch_id, []);
    byId.get(r.dispatch_id).push(r);
  }
  const findings = [];
  for (const [dispatchId, rows] of byId) {
    const started = rows.find((r) => r.phase === "started");
    if (!started) continue;
    // SCOPE FROM LEDGER STATE, not a row-settable opt-in field (security r2 #4 / DoE design-lock:
    // `background`/`waiter_required` were stamped by NO production writer → the check was inert on 103/103
    // real started rows). OUTSTANDING = a started row with NO terminal completion. A terminal completion
    // means the wrapper LIVED to write it → not a stall: an honest ok:FALSE death suppresses unconditionally
    // (backend r2 #4 — a handled foreground reap writes its death record), while a SUCCESS (ok:true) must be
    // VERIFIED (security r2 #1: an unsigned ok:true could be forged to hide a stall). Started-with-NO-terminal
    // is the WG-6 / T-322 kill-before-record stall — the case this check exists to catch.
    // liveness-verified: `verify()` routes the ok:true read through isVerifiedLivenessRecord (default;
    // a test may inject a mock) — origin-proof verified, parity with the primary evaluate() (choke-point).
    // A TERMINAL completion matches the REAL production writer shape (hunter r3 HIGH): recordCompletion
    // stamps NO `phase` field — a completion is a NON-started row (isStartedRow false) with `completed_at`
    // (the startedRowSuperseded predicate), NOT `phase:"completion"` (which no producer emits, so keying
    // on it over-fired on every completed dispatch). An ok:FALSE death suppresses unconditionally; a
    // SUCCESS (ok:true) only when VERIFIED.
    // A terminal completion = a non-started row with a CANONICAL ISO completion timestamp AT/AFTER the
    // dispatch's own start, a boolean ok, AND origin verification. The timestamp guard has TWO teeth:
    // 7G-004 rejected completed_at:null/garbage (typeof!=="undefined" wrongly accepted it); backend-7G-007
    // (r3e) adds that Date.parse COERCES NON-strings — completed_at:0/any number yielded a finite ms and
    // suppressed — so require typeof "string" + an ISO shape, AND completedMs >= startedMs (a death CANNOT
    // precede its own start; combined with dispatch_id now being SIGNED, a replayed signed death can't be
    // re-pointed at an earlier-started dispatch). verify() = verifyRecord for ok:false / isVerifiedLivenessRecord ok:true.
    // started_at gets the SAME complete validation as completed_at (backend-7G-013 SYMMETRIC: the r3e/r3g
    // timestamp guards were applied to completed_at ONLY — a calendar-invalid/unparseable/future started_at
    // coercively normalized or SILENTLY skipped the row, hiding an outstanding dispatch). A malformed or
    // future started_at is NOT a free pass — FLAG it (fail-closed), never silent-continue.
    if (!isCanonicalIso(started.started_at)) {
      findings.push({
        type: "outstanding-dispatch-malformed-start", dispatch_id: dispatchId, role: started.role || null,
        reason: `started_at '${started.started_at}' is not a canonical ISO timestamp — cannot establish the stall window (fail-closed, backend-7G-013)`,
      });
      continue;
    }
    const startedMs = Date.parse(started.started_at);
    if (startedMs > nowMs + SKEW_MS) {
      findings.push({
        type: "outstanding-dispatch-future-start", dispatch_id: dispatchId, role: started.role || null,
        reason: `started_at '${started.started_at}' is in the future (> now + ${SKEW_MS / 60000}m skew) — impossible (fail-closed, backend-7G-013)`,
      });
      continue;
    }
    const terminated = rows.some((r) => {
      // A terminal completion = a non-started row with a CANONICAL producer completion timestamp BOUNDED in
      // [startedMs, nowMs+skew] (backend-7G-012 exact toISOString round-trip rejects calendar-invalid;
      // backend-7G-013 the interval rejects a FUTURE completion — "2099" is a valid ISO and >= start, so an
      // ordering-only check suppressed it), a boolean ok, AND origin verification. verify() = verifyRecord
      // for ok:false / isVerifiedLivenessRecord ok:true.
      if (isStartedRow(r) || !isCanonicalIso(r.completed_at)) return false;
      const completedMs = Date.parse(r.completed_at);
      if (completedMs < startedMs || completedMs > nowMs + SKEW_MS) return false; // bounded interval
      return typeof r.ok === "boolean" && verify(r);
    });
    if (terminated) continue;
    const age = nowMs - startedMs;
    if (age < staleMs || age > windowMs) continue; // not stale yet, or historical
    // β LOAD-BEARING + qa r2 #1/#2 + security r2 #1: liveness = the artifact was PRODUCED, never a
    // stamped field. artifact_path ONLY (expected_artifact/artifact are INTENT, not produced-proof — an
    // alias let a settable path point at a pre-existing file). artifactProduced verifies a real FILE,
    // non-empty, modified AFTER started_at (a directory / 0-byte / pre-start file cannot spoof liveness).
    const artifactPath = typeof started.artifact_path === "string" && started.artifact_path ? started.artifact_path : null;
    const produced = !!(artifactPath && typeof artifactProduced === "function" && artifactProduced(artifactPath, startedMs));
    if (produced) continue;
    findings.push({
      type: "outstanding-dispatch-no-terminal",
      dispatch_id: dispatchId,
      role: started.role || null,
      reason: artifactPath
        ? `outstanding dispatch aged ${Math.round(age / 60000)}m with NO terminal completion record, and artifact_path '${artifactPath}' is not a real non-empty file produced after start — probable WG-6 stall / kill-before-record (T-322)`
        : `outstanding dispatch aged ${Math.round(age / 60000)}m with NO terminal completion record (no ok:false death, no verified ok:true) and no produced artifact — probable WG-6 stall / kill-before-record (T-322)`,
    });
  }
  return { findings };
}

/**
 * artifactProducedFs(p, startedMs) — the real fs resolver for evaluatePairedWaiter: TRUE only when `p`
 * is a regular FILE (not a directory), NON-EMPTY (size>0), and modified AT/AFTER started_at (mtime >=
 * startedMs) — so a pre-existing file a settable path points at, a directory, or a 0-byte reaped touch
 * all FAIL. (qa r2 #2 directory; R1a size>0; security r2 #1 produced-after-start.)
 */
function artifactProducedFs(p, startedMs) {
  try {
    const st = fs.lstatSync(p); // lstat (not stat): a SYMLINK to a concurrently-written file must NOT spoof
    return st.isFile() && st.size > 0 && st.mtimeMs >= (typeof startedMs === "number" ? startedMs : 0);
  } catch {
    return false;
  }
}

// ── Filesystem helpers ────────────────────────────────────────────────────

function sha256ofFile(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/** Collect *.return.txt files older than staleMs in dir. Returns [] if dir missing/unreadable. */
function collectEvidence(evidenceDir, staleMs, nowMs) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(evidenceDir);
  } catch {
    return files;
  }
  for (const name of entries) {
    if (!name.endsWith(".return.txt")) continue;
    const full = path.join(evidenceDir, name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      // FAIL-CLOSED (gauntlet 2026-06-10 qa lane): an un-stat-able evidence file
      // can prove neither freshness nor a ledger match — surface it, don't hide it.
      files.push({ path: full, mtimeMs: null, sha256: null, unreadable: true });
      continue;
    }
    const mtimeMs = stat.mtimeMs;
    if (nowMs - mtimeMs < staleMs) continue; // not stale yet
    let buf;
    try {
      buf = fs.readFileSync(full);
    } catch {
      // FAIL-CLOSED: stale AND unreadable — cannot be matched against the ledger.
      files.push({ path: full, mtimeMs, sha256: null, unreadable: true });
      continue;
    }
    files.push({ path: full, mtimeMs, sha256: sha256ofFile(buf) });
  }
  return files;
}

/** Read the completions ledger. Returns string[] on success, null if file is unreadable/missing. */
function readLedger(ledgerPath) {
  try {
    return fs.readFileSync(ledgerPath, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
}

// ── Output ────────────────────────────────────────────────────────────────

// SINGLE emit (backend r2 #6): one envelope for BOTH the evidence-file stall check AND the ED-256
// paired-waiter check — never a process.exit before the JSON is written. Exit: 2 system-error (fail-
// closed) · 1 red · 0 green. Advisory paired-waiter findings (non-enforce) print as WARN but stay green.
function emit({ result, pw, waiterEnforce }, evidenceDir, ledgerPath) {
  const waiterBlocking = waiterEnforce && pw.findings.length > 0;
  const systemError = pw.systemError || null;
  const ok = result.ok && !waiterBlocking && !systemError;
  const exitCode = systemError ? 2 : ok ? 0 : 1;
  const out = {
    name: NAME,
    status: ok ? "green" : "red",
    evidenceDir,
    ledger: ledgerPath,
    findings: result.findings,
    pairedWaiterFindings: pw.findings,
    pairedWaiterEnforced: !!waiterEnforce,
    systemError,
    malformedLedgerLines: result.malformedLines,
    ledgerUnreadable: result.ledgerUnreadable,
    durationMs: Date.now() - START,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else {
    if (systemError) console.error(`ERROR [${NAME}] ${systemError}`);
    if (!result.ok) {
      console.error(`FAIL [${NAME}] ${result.findings.length} stale evidence file(s) with no completion record:`);
      for (const f of result.findings) console.error(`     - ${path.basename(f.evidenceFile)}: ${f.reason}`);
      if (result.ledgerUnreadable) console.error(`     fix: check dispatch-completions.jsonl is readable; run record-inprocess if conductor ran`);
    }
    if (pw.findings.length) {
      console.error(`${waiterBlocking ? "FAIL" : "WARN"} [${NAME}] (ED-256 paired-waiter) ${pw.findings.length} outstanding dispatch(es) with no terminal completion:`);
      for (const f of pw.findings) console.error(`     - ${f.dispatch_id} (${f.role || "?"}): ${f.reason}`);
    }
    if (result.malformedLines > 0) console.error(`     (${result.malformedLines} malformed ledger line(s) skipped)`);
    if (ok && pw.findings.length === 0) console.log(`OK   [${NAME}] no stale unmatched evidence + no outstanding-dispatch findings`);
  }
  process.exit(exitCode);
}

// ── CLI entrypoint ────────────────────────────────────────────────────────

if (require.main === module) {
  const nowArg = arg("--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (nowArg && isNaN(nowMs)) {
    process.stderr.write(`[${NAME}] invalid --now value: ${nowArg}\n`);
    process.exit(2);
  }

  const staleMinutes =
    parseInt(arg("--stale-minutes") || String(DEFAULT_STALE_MINUTES), 10) ||
    DEFAULT_STALE_MINUTES;
  const staleMs = staleMinutes * 60 * 1000;

  // Resolve evidence directory.
  let evidenceDir = arg("--evidence-dir");
  if (!evidenceDir) {
    evidenceDir =
      DEFAULT_EVIDENCE_DIRS.find((d) => {
        try {
          fs.accessSync(d);
          return true;
        } catch {
          return false;
        }
      }) || DEFAULT_EVIDENCE_DIRS[0];
  }
  evidenceDir = path.resolve(evidenceDir);

  const ledgerPath = path.resolve(arg("--ledger") || DEFAULT_LEDGER);

  const evidenceFiles = collectEvidence(evidenceDir, staleMs, nowMs);
  const ledgerLines = readLedger(ledgerPath);

  const result = evaluate({ evidenceFiles, ledgerLines, nowMs });

  // ED-256 paired-waiter check — ADVISORY by default (WARN); under MC_WAITER_ENFORCE it BLOCKS.
  const waiterEnforce = mcEnv.readEnv("WAITER_ENFORCE") === "1" || mcEnv.readEnv("WAITER_ENFORCE") === "true";
  const pw = { findings: [], systemError: null };
  if (ledgerLines === null) {
    // backend r2 #3: under enforce an unreadable ledger is a SYSTEM ERROR (fail-closed exit 2), never a
    // silent green — the check cannot verify outstanding dispatches without the ledger.
    if (waiterEnforce) pw.systemError = `ledger unreadable (${ledgerPath}) under MC_WAITER_ENFORCE — cannot verify outstanding dispatches (fail-closed)`;
  } else {
    const records = [];
    for (const line of ledgerLines) {
      const t = (line || "").trim();
      if (!t) continue;
      try { records.push(JSON.parse(t)); } catch { /* malformed already counted by evaluate() */ }
    }
    // backend r2 #5: resolve a RELATIVE artifact_path against the repo ROOT, not process.cwd (a scan may
    // run from anywhere). isFile + size>0 + mtime>=started_at is inside artifactProducedFs.
    const rootArtifactProduced = (p, startedMs) => artifactProducedFs(path.isAbsolute(p) ? p : path.join(ROOT, p), startedMs);
    pw.findings = evaluatePairedWaiter({ records, nowMs, staleMs, artifactProduced: rootArtifactProduced }).findings;
  }

  emit({ result, pw, waiterEnforce }, evidenceDir, ledgerPath); // single emit (backend r2 #6)
}

module.exports = { evaluate, evaluatePairedWaiter, artifactProducedFs };
