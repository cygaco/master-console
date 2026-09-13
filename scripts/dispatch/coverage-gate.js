#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * coverage-gate.js — N-1: the dispatch-coverage gate ("sprint theater" killer).
 *
 * PLAN §2(i) / §17.4 / E-DISPATCH-INTEGRITY RC-2: a sprint phase can today record
 * "coverage" with ZERO real dispatch behind it, or skip a binding reviewer, or run
 * a Claude clone in place of a cross-provider reviewer — all read green. This gate
 * makes a backing `ok:true` completion record the PRECONDITION for "covered":
 *
 *   - every EXPECTED role must have an `ok:true`, BACKED (dispatch_id +
 *     cmdline_checksum) completion record for the run — else it's an unbacked
 *     coverage claim (sprint theater),
 *   - a role whose contract requires cross-provider review must NOT be satisfied
 *     by a provider=claude record (diversity / no-verdict-on-own-work),
 *   - a record claiming ok:true WITHOUT a dispatch_id/cmdline_checksum is a
 *     hand-authored phantom row and is REJECTED.
 *
 * §17.4 strengthening — a record's mere EXISTENCE is not coverage. A satisfying
 * record must ALSO be stamped at the CURRENT argv schema version (a stale or
 * backfilled record is rejected) AND carry artifact proof (a non-empty output_digest
 * or an artifacts[] digest — proof it actually produced output). A named `artifact`
 * can be re-hashed on disk (--verify-artifacts) to prove it appeared. A role may be
 * AUDITABLY waived (with a reason), never silently dropped.
 *
 * Expected obligations are read from the dispatch-contract keystone (§17.1) per
 * role. `evaluate()` is pure (synthetic records + expectations -> verdict) so it
 * is P5-testable with planted violations. BLOCKING by default (PLAN §4 ramp FLIPPED,
 * now that §17.4 makes the gate non-fakeable); --report-only /
 * MC_COVERAGE_GATE_ENFORCE=report surfaces violations WITHOUT exiting non-zero.
 *
 * Zero runtime deps (Node core only).
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { contractForRole, ARGV_SCHEMA_VERSION } = require("./dispatch-contract");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

/** A real dispatch record is BACKED iff a wrapper wrote it (not hand-authored). */
function isBackedRecord(r) {
  return !!(r && typeof r.dispatch_id === "string" && r.dispatch_id && typeof r.cmdline_checksum === "string" && r.cmdline_checksum);
}

/**
 * A waiver is PROVENANCED iff it carries an accountable trail, not just free text
 * (R-5 AC-5.1). A provenance-free `{ reason: "..." }` waiver is REJECTED the same
 * way an unbacked coverage record is — a silenced role must name WHO silenced it,
 * WHEN, and against WHAT auditable trail, so the flip-to-blocking gate's escape is
 * accountable instead of a free-text loophole. Required:
 *   - reason     : non-empty free text (WHY the role is skipped),
 *   - operator   : an operator / source id (WHO authorized the waiver) — accepted
 *                  under `operator` or `source` (either names the authorizer),
 *   - ts         : a timestamp (WHEN), and
 *   - a backing trail: a `record` / `dispatch_id` / `ticket` / `audit_ref` — SOME
 *                  pointer to where the waiver is recorded (the auditable trail).
 * Returns { ok, provenance?, missing[] } — `provenance` is the normalized,
 * scan-surfaceable shape (so AC-5.2 can render the silenced role at /scan).
 */
function waiverProvenance(waiver) {
  const w = waiver && typeof waiver === "object" ? waiver : {};
  const reason = typeof w.reason === "string" ? w.reason.trim() : "";
  const operator =
    (typeof w.operator === "string" && w.operator.trim()) ||
    (typeof w.source === "string" && w.source.trim()) ||
    "";
  const ts = typeof w.ts === "string" && w.ts.trim() ? w.ts.trim() : "";
  // The auditable trail: any one of these names where the waiver is recorded.
  const trail =
    (typeof w.record === "string" && w.record.trim()) ||
    (typeof w.dispatch_id === "string" && w.dispatch_id.trim()) ||
    (typeof w.ticket === "string" && w.ticket.trim()) ||
    (typeof w.audit_ref === "string" && w.audit_ref.trim()) ||
    "";
  const missing = [];
  if (!reason) missing.push("reason");
  if (!operator) missing.push("operator/source");
  if (!ts) missing.push("ts");
  if (!trail) missing.push("record/dispatch_id/ticket/audit_ref");
  return {
    ok: missing.length === 0,
    missing,
    provenance: missing.length === 0 ? { reason, operator, ts, trail } : null,
  };
}

// §17.4 "a record's existence ≠ covered" — a coverage record must prove it produced
// SOMETHING: a non-empty output_digest (the universal proof for reviewer/skill/build
// stdout) OR at least one artifacts[] entry carrying a digest. A backed ok:true
// record with neither is "blind coverage" and does NOT satisfy a role.
function hasArtifactProof(r) {
  if (r && typeof r.output_digest === "string" && r.output_digest) return true;
  if (r && Array.isArray(r.artifacts) && r.artifacts.some((a) => a && a.sha256)) return true;
  return false;
}

/** sha256 (matching the wrappers' 32-hex truncation) of a file, or null if unreadable. */
function sha256File(p) {
  try {
    return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 32);
  } catch {
    return null;
  }
}

/**
 * evaluate({ records, expected, runId, schemaVersion?, verifyArtifacts? })
 *   -> { ok, violations[], covered[], missing[], waived[] }
 *
 *   records         : completion records (objects) from the ledger.
 *   expected        : [{ role, shape?, plan_item_id?, artifact?, waiver?{reason} }]
 *                     — the roles a phase CLAIMS it covered. `artifact` names a file
 *                     the role must have produced; `waiver` AUDITABLY excuses a role.
 *   runId           : when set, only records with this run_id count.
 *   schemaVersion   : the CURRENT argv/stamp schema a record must carry (default the
 *                     keystone's ARGV_SCHEMA_VERSION) — a record at an older/unknown
 *                     version is stale or backfilled and does NOT satisfy coverage.
 *   verifyArtifacts : when true, a named `artifact` is re-hashed on disk and must
 *                     EXIST with a digest matching the record (proof it appeared).
 *
 * §17.4: a backed ok:true record's mere EXISTENCE is not coverage. A satisfying
 * record must ALSO be at the current schema AND prove it produced output
 * (output_digest / artifacts). This closes the "backfillable, fakeable, blind to
 * whether the artifact appeared" hole — the precondition for flipping to blocking.
 */
const { isVerifiedLivenessRecord } = require("./verified-liveness-read");

function evaluate(input) {
  const {
    records = [],
    expected = [],
    runId = null,
    schemaVersion = ARGV_SCHEMA_VERSION,
    verifyArtifacts = false,
    // SP-20260718-004 gauntlet R4 (β DIRECTIVE): this BLOCKING same-session reader must not trust a
    // field-only ok:true record — a valid origin-proof signature is required. Default TRUE (the CLI/live
    // path); unit tests that inject unsigned fixture records opt out with requireSignature:false.
    requireSignature = true,
  } = input || {};
  // The trusted-liveness predicate every ok:true match below routes through (the shared choke-point).
  const isLive = (r) => isVerifiedLivenessRecord(r, { requireSignature });
  const violations = [];
  const covered = [];
  const missing = [];
  const waived = [];
  const pool = (runId ? records.filter((r) => r && r.run_id === runId) : records.slice()).filter(Boolean);

  for (const exp of expected) {
    const role = exp && exp.role;
    if (!role) {
      violations.push("expected entry with no role");
      continue;
    }

    // Waiver: a role may be explicitly, AUDITABLY excused (a known skip / tolerated
    // failure) instead of silently missing — but ONLY with full PROVENANCE (R-5
    // AC-5.1): WHO (operator/source), WHEN (ts), WHY (reason), and an auditable
    // trail (record/dispatch_id/ticket/audit_ref). A provenance-free free-text
    // waiver is REJECTED the same way an unbacked coverage record is, so the
    // flip-to-blocking gate's escape is accountable, never a silent loophole. The
    // honored waiver's provenance is SURFACED in `waived[]` (AC-5.2) so a silenced
    // role is VISIBLE at /scan, not hidden.
    if (exp.waiver) {
      const p = waiverProvenance(exp.waiver);
      if (!p.ok) {
        violations.push(
          `role '${role}' is waived but the waiver lacks provenance (missing: ${p.missing.join(", ")}) — an unaccountable waiver is REJECTED. A waiver must name WHO (operator/source), WHEN (ts), WHY (reason), and an auditable trail (record/dispatch_id/ticket/audit_ref).`,
        );
      } else {
        waived.push({ role, reason: p.provenance.reason, provenance: p.provenance });
      }
      continue;
    }

    let c = null;
    try {
      c = contractForRole(role);
    } catch {
      /* contract unavailable — still enforce backed-record presence */
    }

    // Candidate records: right role, ok:true, BACKED, shape + plan_item match if
    // required. A satisfying HIT must ALSO be at the current schema AND carry
    // artifact proof — split out so the failure message names the real reason.
    const roleRecs = pool.filter(
      (r) =>
        r.role === role &&
        isLive(r) && // ok:true AND a valid origin-proof signature (same-session choke-point)
        isBackedRecord(r) &&
        (!exp.shape || r.shape === exp.shape) &&
        (!exp.plan_item_id || r.plan_item_id === exp.plan_item_id),
    );
    const hit = roleRecs.find((r) => r.argv_schema_version === schemaVersion && hasArtifactProof(r));

    if (!hit) {
      missing.push(role);
      const noProof = roleRecs.find((r) => r.argv_schema_version === schemaVersion && !hasArtifactProof(r));
      const staleOnly = roleRecs.find((r) => r.argv_schema_version !== schemaVersion);
      if (noProof) {
        violations.push(`expected role '${role}' has an ok:true backed record but NO output_digest/artifact proof — it shows a role 'ran' without proving it produced output (blind coverage). REJECTED (§17.4).`);
      } else if (staleOnly) {
        violations.push(`expected role '${role}' has only a record at argv_schema_version=${JSON.stringify(staleOnly.argv_schema_version ?? null)} (current is ${JSON.stringify(schemaVersion)}) — a stale/backfilled record does not satisfy coverage.`);
      } else {
        violations.push(`expected role '${role}'${exp.shape ? ` (shape ${exp.shape})` : ""} has NO ok:true backed completion record${runId ? ` for run ${runId}` : ""} — coverage claim is UNBACKED (sprint-theater guard).`);
      }
      continue;
    }

    if (c && c.coverage && c.coverage.cross_provider_required && hit.provider === "claude") {
      violations.push(`role '${role}' requires cross-provider review but its record shows provider=claude — a Claude clone graded Claude's work (diversity violation).`);
    }

    // Named-artifact obligation: when the expected entry names a file artifact, the
    // record must carry its digest, and (when verifyArtifacts) the file must EXIST
    // on disk with a MATCHING digest — proof it actually appeared, not just that a
    // digest string was stamped.
    if (exp.artifact) {
      const arts = Array.isArray(hit.artifacts) ? hit.artifacts : [];
      const a = arts.find((x) => x && x.path === exp.artifact);
      if (!a || !a.sha256) {
        violations.push(`role '${role}' was expected to produce artifact ${JSON.stringify(exp.artifact)} but its record carries no matching artifact digest.`);
      } else if (verifyArtifacts) {
        const onDisk = sha256File(path.isAbsolute(exp.artifact) ? exp.artifact : path.join(PROJECT_ROOT, exp.artifact));
        if (onDisk === null) {
          violations.push(`role '${role}' artifact ${JSON.stringify(exp.artifact)} does not exist on disk — the record claims it but it never appeared.`);
        } else if (onDisk !== a.sha256) {
          violations.push(`role '${role}' artifact ${JSON.stringify(exp.artifact)} on disk (${onDisk}) does not match the record's digest (${a.sha256}) — content drift / faked digest.`);
        }
      }
    }

    covered.push({ role, dispatch_id: hit.dispatch_id, provider: hit.provider || null, shape: hit.shape || null, output_digest: hit.output_digest || null });
  }

  // phantom-coverage guard: any ok:true record in the pool that is NOT backed OR (same-session) NOT signed.
  // liveness-verified: this block REJECTS untrustworthy records (unbacked, or ok:true without a valid signature
  // via isLive = isVerifiedLivenessRecord) — it never TRUSTS an unsigned record as liveness; the trust path is
  // the roleRecs filter above, which routes through isLive.
  for (const r of pool) {
    if (r.ok === true && !isBackedRecord(r)) {
      violations.push(`a completion record (role=${r.role || "?"}) claims ok:true but lacks dispatch_id/cmdline_checksum — hand-authored phantom coverage row REJECTED.`);
    } else if (r.ok === true && requireSignature && !isLive(r)) {
      violations.push(`a completion record (role=${r.role || "?"}) claims ok:true and is field-backed but carries NO valid origin-proof signature — a forged/unsigned liveness record REJECTED (ED-231 same-session verification).`);
    }
  }

  return { ok: violations.length === 0, violations, covered, missing, waived };
}

/** Read the canonical dispatch-completions ledger as an array of records. */
function readLedger(file) {
  const f = file || mcEnv.readEnv("COVERAGE_LEDGER") || path.join(PROJECT_ROOT, ".claude", "runtime", "dispatch-completions.jsonl");
  let txt;
  try {
    txt = fs.readFileSync(f, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      /* skip malformed line */
    }
  }
  return out;
}

/** Parse `role:shape,role2` into [{role, shape?}]. */
function parseExpect(spec) {
  return String(spec || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const [role, shape] = tok.split(":");
      return shape ? { role, shape } : { role };
    });
}

// ── W3 (SP-20260627-001): per-failure-class minimum review-lane policy ──────────────
// β pin: each risk class declares the MINIMUM review lanes a change in that class needs.
// REPORT-ONLY ramp — `reviewLanePolicy()` READS this map and ACTS (emits warnings); it is
// a REAL consumer, not a declarative key no loop reads (β: Policy-key-must-fire, DP-gap #41(b)).
// The report-only→blocking flip is a future ramp gated on a green per-class fixture; both
// declared classes ship WITH a fixture (w3-lane-policy.test.js), so neither is an aspirational
// blocking rule. A class lacking a testable fixture must carry logged enforcement-debt instead
// of a declared minimum (β: honesty-ceiling P-061).
const W3_REVIEW_LANE_MIN = Object.freeze({
  // Enforcer / gate changes must be EXERCISED, not merely code-read.
  enforcer_or_gate_change: ["execution_access"],
  // Distribution-sensitive logic (ships to installs) needs a cross-family second opinion.
  distribution_sensitive: ["cross_family_diff"],
});

/**
 * W3 review-lane policy consumer (REPORT-ONLY ramp). For each risk class in
 * `classesUnderChange`, checks `lanesRun` includes the class's minimum lanes from
 * W3_REVIEW_LANE_MIN. Returns { ok, warnings[], enforce }. ok is always true in the
 * report-only default (it ACTS by emitting warnings); when opts.enforce, ok flips false
 * on any missing required lane (the gated blocking ramp). This is the named consumer the
 * AC-3.1 fixture asserts FIRES on the lane-min key.
 *   reviewLanePolicy(["enforcer_or_gate_change"], [])               → warnings:[…], ok:true (report)
 *   reviewLanePolicy(["enforcer_or_gate_change"], ["execution_access"]) → warnings:[], ok:true
 */
function reviewLanePolicy(classesUnderChange, lanesRun, opts) {
  const enforce = !!(opts && opts.enforce);
  const run = new Set(Array.isArray(lanesRun) ? lanesRun : []);
  const warnings = [];
  for (const cls of Array.isArray(classesUnderChange) ? classesUnderChange : []) {
    const min = W3_REVIEW_LANE_MIN[cls];
    if (!min) continue; // no declared minimum (or the class carries enforcement-debt)
    for (const lane of min) {
      if (!run.has(lane)) {
        warnings.push(
          `W3 review-lane policy: risk class '${cls}' requires lane '${lane}' but it was not run (lanes run: ${[...run].join(", ") || "<none>"}).`,
        );
      }
    }
  }
  return { ok: enforce ? warnings.length === 0 : true, warnings, enforce };
}

module.exports = { evaluate, readLedger, isBackedRecord, hasArtifactProof, waiverProvenance, sha256File, parseExpect, reviewLanePolicy, W3_REVIEW_LANE_MIN };

// ── CLI ─────────────────────────────────────────────────────
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };
  const runId = flag("--run");
  const expected = parseExpect(flag("--expect"));
  // FLIPPED (PLAN §4 ramp, §17.4): BLOCKING is now the default. Opt OUT with
  // --report-only or MC_COVERAGE_GATE_ENFORCE=report. (--enforce / =block stay
  // accepted as explicit no-ops for back-compat with existing call sites.)
  const reportOnly = argv.includes("--report-only") || mcEnv.readEnv("COVERAGE_GATE_ENFORCE") === "report";
  const enforce = !reportOnly;
  const verifyArtifacts = argv.includes("--verify-artifacts");
  const records = readLedger(flag("--ledger"));
  const res = evaluate({ records, expected, runId, verifyArtifacts });
  process.stdout.write(
    JSON.stringify({ mode: enforce ? "blocking" : "report-only", run: runId, ...res }, null, 2) + "\n",
  );
  // Blocking: exit non-zero on any violation. Report-only: always exit 0 (surface
  // the violations without blocking).
  process.exit(enforce && !res.ok ? 1 : 0);
}
