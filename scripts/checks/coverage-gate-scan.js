#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * coverage-gate-scan.js — the LIVE CALLER for coverage-gate.js evaluate()
 * (S-LC-06 / PLAN §2.6 + §8.7). `coverage-gate.js evaluate()` is built + P5-tested
 * but had NO live caller — this wires it into the `/scan:full` runtime as a
 * report-only ledger audit (the "low-hanging wiring" the plan names).
 *
 * WHAT IT DOES: reads the dispatch-completions ledger (the same JSONL the wrappers
 * write), groups records by run_id, and for each run derives `expected` = the
 * distinct roles that CLAIM coverage (an ok:true record) in that run, then runs
 * `evaluate()` to surface the sprint-theater class WITHOUT a per-run --expect:
 *   - a role that CLAIMS ok:true but the claim is unbacked / blind (no artifact
 *     proof) / stale-schema → a coverage GAP,
 *   - a cross-provider role satisfied by a provider=claude record (diversity),
 *   - a hand-authored phantom ok:true row (no dispatch_id/cmdline_checksum).
 * This is the static-scan complement to the per-phase runtime gate (which needs an
 * explicit --run/--expect); here the ledger audits ITSELF.
 *
 * RAMP: REPORT-ONLY this sprint — it reports gaps and ALWAYS exits 0 (it does not
 * block /scan:full). The `--enforce` flag (exit 1 on a gap) is the documented ramp
 * tail, not wired into any gate yet. FAIL-OPEN: a malformed/unreadable ledger or
 * any internal error yields a note and exit 0 — an advisory audit must never break
 * the scan. (This is a deliberate departure from the fail-CLOSED posture of the
 * BLOCKING /scan:full enforcers; it matches the brief's report-only + fail-open.)
 *
 *   node scripts/checks/coverage-gate-scan.js [--json] [--enforce] [--ledger <path>]
 */

const fs = require("fs");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const path = require("path");
const { evaluate, readLedger } = require("../dispatch/coverage-gate");
const { LEGACY_CUTOFF, cutoffFor, isLegacyDate } = require("../dispatch/legacy-cutoff");

const NAME = "coverage-gate-scan";

function flagVal(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : dflt;
}

/**
 * AC-5.3 — EXTERNAL expected-roles source. The old self-audit derived `expected`
 * ONLY from the roles that CLAIM ok:true in the run, so a role that produced NO
 * record was never expected and its omission read clean (the "omitted-role slip").
 * The expected set must come from an EXTERNAL source (registry / sprint composition)
 * so a role that ran NOTHING is still expected → still a gap.
 *
 * `expectedSource` is resolved per-run as one of:
 *   - a function (runId, runRecs) => [roleString | {role,...}]   (caller-supplied),
 *   - a plain map { [runId]: [...] }  (e.g. sprint-composition derived), or
 *   - an array  [...]                 (one external set for ALL runs).
 * When NO external source is supplied, the legacy self-derive (roles that claim
 * ok:true) is the FALLBACK — but it is UNION'd with any external set so a supplied
 * source can only ADD expectations, never shrink them below the claimed set.
 */
function resolveExpected(expectedSource, runId, runRecs) {
  let external = null;
  if (typeof expectedSource === "function") {
    external = expectedSource(runId, runRecs);
  } else if (expectedSource && typeof expectedSource === "object" && !Array.isArray(expectedSource)) {
    external = expectedSource[runId] != null ? expectedSource[runId] : expectedSource["*"];
  } else if (Array.isArray(expectedSource)) {
    external = expectedSource;
  }
  // claimed = the legacy self-derive (distinct roles with a VERIFIED ok:true record in this run — a
  // forged/unsigned record can't inject a phantom claimed role; SP-20260718-004 R4 same-session choke-point).
  const _reqSig = mcEnv.readEnv("LIVENESS_REQUIRE_SIG") !== "0";
  const claimed = [
    ...new Set(runRecs.filter((r) => r && r.role && isVerifiedLivenessRecord(r, { requireSignature: _reqSig })).map((r) => r.role)),
  ];
  const normExternal = Array.isArray(external)
    ? external.map((e) => (typeof e === "string" ? { role: e } : e)).filter((e) => e && e.role)
    : [];
  // UNION external ∪ claimed, external entries (which may carry shape/plan_item/waiver)
  // taking precedence over a bare claimed role of the same name.
  const byRole = new Map();
  for (const role of claimed) byRole.set(role, { role });
  for (const e of normExternal) byRole.set(e.role, e);
  return [...byRole.values()];
}

const CANONICAL_STEPS = Object.freeze(["plan", "design", "build", "gauntlet", "release", "retro"]);

let _runtimeDeps = null;
function runtimeDeps() {
  if (_runtimeDeps) return _runtimeDeps;
  _runtimeDeps = {
    hookPoints: require("../sprint/hook-points"),
    sprintPaths: require("../sprint/paths"),
    sprintFs: require("../sprint/fs"),
  };
  return _runtimeDeps;
}

function stepsForPhaseId(phaseId, registry) {
  const phase = String(phaseId || "").trim();
  if (!phase) return [];
  if (CANONICAL_STEPS.includes(phase)) return [phase];
  const phaseMap = registry && registry.phase_map && typeof registry.phase_map === "object"
    ? registry.phase_map
    : {};
  const out = [];
  for (const [step, mappedPhase] of Object.entries(phaseMap)) {
    if (String(mappedPhase) === phase && CANONICAL_STEPS.includes(step)) out.push(step);
  }
  return out;
}

function compositionForSprintId(sprintId, opts = {}) {
  const deps = opts.deps || runtimeDeps();
  const ticketsDir = opts.ticketsDir || deps.sprintPaths.tickets;
  const tickets = [];
  for (const f of fs.readdirSync(ticketsDir)) {
    if (!/\.(ya?ml|json)$/.test(f)) continue;
    const t = deps.sprintFs.readYamlMaybe(path.join(ticketsDir, f));
    if (t && t.sprint === sprintId) tickets.push(t);
  }
  return deps.hookPoints.compositionFromTickets(tickets);
}

function runtimeExpectedForRun(_runId, runRecs, opts = {}) {
  const recs = Array.isArray(runRecs) ? runRecs.filter(Boolean) : [];
  const sprintIds = new Set();
  const phases = new Set();
  for (const r of recs) {
    if (r.sprint_id) sprintIds.add(String(r.sprint_id));
    if (r.phase_id) phases.add(String(r.phase_id));
    if (r.step) phases.add(String(r.step));
  }
  if (!sprintIds.size && mcEnv.readEnv("SPRINT_ID")) sprintIds.add(mcEnv.readEnv("SPRINT_ID"));
  if (!phases.size && mcEnv.readEnv("PHASE_ID")) phases.add(mcEnv.readEnv("PHASE_ID"));
  if (!sprintIds.size || !phases.size) return [];

  const deps = opts.deps || runtimeDeps();
  const registry = opts.registry || deps.hookPoints.load();
  const byRole = new Map();
  for (const sprintId of sprintIds) {
    const composition = compositionForSprintId(sprintId, { ...opts, deps });
    for (const phase of phases) {
      for (const step of stepsForPhaseId(phase, registry)) {
        const rows = deps.hookPoints.agentsForStep(step, composition, registry);
        for (const row of rows) {
          if (!row || !row.role) continue;
          if (row.mode !== "block" && !opts.includeAdvisory) continue;
          byRole.set(row.role, { role: row.role });
        }
      }
    }
  }
  return [...byRole.values()];
}

function defaultRuntimeExpectedSource(opts = {}) {
  return (runId, runRecs) => runtimeExpectedForRun(runId, runRecs, opts);
}

/**
 * Audit a ledger's records run-by-run. Pure given `records`. Returns
 *   { runs: [{ runId, ok, violations[], covered[], missing[], waived[], legacyExempt }],
 *     totalViolations, totalCovered, runCount, cutoff, legacyExemptRuns }
 * Records lacking a run_id are bucketed under "(no-run-id)" and evaluated as a pool.
 *
 * opts:
 *   expectedSource : AC-5.3 external expected-roles source (see resolveExpected).
 *   cutoff         : AC-5.5 legacy-scoping cutoff (default the SHARED LEGACY_CUTOFF
 *                    for this consumer). A run whose date is STRICTLY BEFORE the
 *                    cutoff is LEGACY — its violations are reported as INFO, not
 *                    counted as gaps. A run dated ON/AFTER the cutoff (or undated)
 *                    still REDS — scope-then-flip, never scope-as-loophole.
 *   runDateOf      : (runId, runRecs) => ISO date | null — how to date a run. Default
 *                    = the max record `ts`/`date` in the run (an undatable run is NOT
 *                    legacy → still in scope, fail-closed).
 */
function auditLedger(records, opts = {}) {
  const recs = Array.isArray(records) ? records.filter(Boolean) : [];
  const expectedSource = opts.expectedSource || null;
  const cutoff = opts.cutoff || cutoffFor("coverage-gate-scan");
  const runDateOf =
    typeof opts.runDateOf === "function"
      ? opts.runDateOf
      : (_runId, runRecs) => {
          // Default run date = the newest record date in the run (so a single
          // post-cutoff record keeps the whole run in scope — the safe direction).
          let newest = null;
          for (const r of runRecs) {
            const d = r && (r.ts || r.date || r.created_at);
            if (d && (newest === null || String(d) > String(newest))) newest = d;
          }
          return newest;
        };
  const buckets = new Map();
  for (const r of recs) {
    const id = r && typeof r.run_id === "string" && r.run_id ? r.run_id : "(no-run-id)";
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(r);
  }
  const runs = [];
  let totalViolations = 0;
  let totalCovered = 0;
  let legacyExemptRuns = 0;
  for (const [id, runRecs] of buckets) {
    const runId = id === "(no-run-id)" ? null : id;
    let res;
    try {
      // AC-5.3: expected derives from the EXTERNAL source (∪ the claimed-roles
      // fallback). A throwing external source must FAIL-CLOSED to a per-run
      // violation — never a silent green, never a whole-audit crash.
      const expected = resolveExpected(expectedSource, id, runRecs);
      res = evaluate({ records: runRecs, expected, runId });
    } catch (e) {
      res = { ok: false, violations: [`coverage audit FAILED-CLOSED for run ${id}: ${e && e.message ? e.message : e}`], covered: [], missing: [], waived: [] };
    }
    // AC-5.5: legacy scoping. A run dated STRICTLY BEFORE the cutoff is historic —
    // its violations are INFO, not gaps (so the flip doesn't red genuinely old runs).
    // An undated/on-after run still REDS (scope-then-flip).
    const runDate = runDateOf(id, runRecs);
    const legacyExempt = isLegacyDate(runDate, cutoff);
    if (legacyExempt) {
      legacyExemptRuns++;
      runs.push({ runId: id, ...res, legacyExempt: true, legacyViolations: res.violations, violations: [] });
    } else {
      totalViolations += res.violations.length;
      runs.push({ runId: id, ...res, legacyExempt: false });
    }
    totalCovered += res.covered.length;
  }
  return { runs, totalViolations, totalCovered, runCount: runs.length, cutoff, legacyExemptRuns };
}

function main() {
  const asJson = process.argv.includes("--json");
  const enforce = process.argv.includes("--enforce");
  const ledgerPath = flagVal("--ledger", null);
  const expectedSourcePath = flagVal("--expected-source", null);

  let records;
  try {
    // readLedger is itself fail-open (skips malformed lines, returns [] if
    // unreadable) — so a corrupt/absent ledger degrades to an empty audit.
    records = readLedger(ledgerPath || undefined);
  } catch (e) {
    // FAIL-OPEN: never break /scan:full on a ledger read error.
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: true, check: NAME, reportOnly: true, note: `ledger unreadable (fail-open): ${msg}` })
        : `OK   [${NAME}] ledger unreadable — fail-open, nothing to audit (${msg})`) + "\n",
    );
    return 0;
  }

  // AC-5.3 (LIVE PATH) — resolve expectedSource from the external registry /
  // sprint-composition file. If --expected-source <path> is supplied, that file is
  // authoritative. Otherwise production /scan derives expected roles from the
  // ledger's sprint_id + phase_id/step fields through the sprint hook-point registry
  // and ticket composition. Without that default, the audit self-derives expected
  // from the ledger's own ok:true records, so a role that produced NO record is
  // never expected and its omission reads clean (the "omitted-role slip").
  //
  // Format of the JSON file (same shape as the `expectedSource` the pure seam takes):
  //   ["role1", "role2"]                  — applies to ALL runs as a universal set
  //   { "run-id": ["role1","role2"], ... } — per-run sets (wildcard key "*" for all)
  //
  // FAIL-OPEN: an unreadable / malformed expected-source file is warned and
  // proceeds without — never breaks /scan:full, falls back to self-derive only.
  let liveExpectedSource = null;
  if (expectedSourcePath) {
    try {
      const raw = fs.readFileSync(expectedSourcePath, "utf8").replace(/^﻿/, "");
      liveExpectedSource = JSON.parse(raw);
    } catch (e) {
      const msg = String((e && e.message) || e);
      process.stdout.write(
        (asJson
          ? JSON.stringify({ ok: true, check: NAME, reportOnly: true, note: `expected-source unreadable (fail-open, self-derive fallback): ${msg}` })
          : `WARN [${NAME}] --expected-source unreadable — proceeding with self-derive fallback (${msg})`) + "\n",
      );
      // liveExpectedSource stays null → self-derive fallback
    }
  } else {
    liveExpectedSource = defaultRuntimeExpectedSource();
  }

  let audit;
  try {
    audit = auditLedger(records, { expectedSource: liveExpectedSource });
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: true, check: NAME, reportOnly: true, note: `audit error (fail-open): ${msg}` })
        : `OK   [${NAME}] audit error — fail-open (${msg})`) + "\n",
    );
    return 0;
  }

  const gaps = audit.totalViolations;
  // AC-5.2: every ACTIVE waiver (a silenced role) is SURFACED — visible at /scan,
  // not hidden — with its provenance, so an operator can see WHO silenced WHAT.
  const allWaived = [];
  for (const run of audit.runs) {
    for (const w of run.waived || []) allWaived.push({ runId: run.runId, ...w });
  }
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: gaps === 0,
          check: NAME,
          reportOnly: !enforce,
          cutoff: audit.cutoff,
          counts: {
            runs: audit.runCount,
            covered: audit.totalCovered,
            gaps,
            waived: allWaived.length,
            legacyExemptRuns: audit.legacyExemptRuns,
          },
          waived: allWaived,
          runs: audit.runs.filter((r) => r.violations.length),
        },
        null,
        2,
      ) + "\n",
    );
  } else if (gaps === 0) {
    process.stdout.write(
      `OK   [${NAME}] ${audit.runCount} run(s), ${audit.totalCovered} role(s) covered, 0 coverage gaps (ledger self-audit)\n`,
    );
    surfaceWaivers(allWaived);
  } else {
    process.stdout.write(
      `WARN [${NAME}] ${gaps} coverage gap(s) across ${audit.runCount} run(s)` +
        `${enforce ? "" : " (REPORT-ONLY — not blocking /scan:full this sprint)"}:\n`,
    );
    let shown = 0;
    for (const run of audit.runs) {
      for (const v of run.violations) {
        if (shown++ >= 25) break;
        process.stdout.write(`  - [run ${run.runId}] ${v}\n`);
      }
      if (shown >= 25) break;
    }
    if (gaps > 25) process.stdout.write(`  ... and ${gaps - 25} more\n`);
    surfaceWaivers(allWaived);
  }

  // REPORT-ONLY: exit 0 unless --enforce (the ramp tail). Fail-open already
  // returned 0 above on any read/audit error.
  if (gaps === 0) return 0;
  return enforce ? 1 : 0;
}

// AC-5.2: render the active waivers (silenced roles) so they are VISIBLE at /scan.
// A provenance-backed waiver is legitimate — but it must never be HIDDEN, so the
// operator can audit WHO silenced WHAT, WHEN, and against WHAT trail.
function surfaceWaivers(allWaived) {
  if (!allWaived || !allWaived.length) return;
  process.stdout.write(
    `INFO [${NAME}] ${allWaived.length} active waiver(s) (silenced role(s), surfaced — not hidden):\n`,
  );
  for (const w of allWaived) {
    const p = w.provenance || {};
    const who = p.operator || "?";
    const when = p.ts || "?";
    const trail = p.trail || "?";
    process.stdout.write(
      `  - [run ${w.runId}] role '${w.role}' WAIVED by ${who} @ ${when} (trail ${trail}): ${w.reason || p.reason || ""}\n`,
    );
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  auditLedger,
  resolveExpected,
  runtimeExpectedForRun,
  defaultRuntimeExpectedSource,
  stepsForPhaseId,
  compositionForSprintId,
  surfaceWaivers,
  LEGACY_CUTOFF,
};
