#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

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

function resolveExpected(expectedSource, runId, runRecs) {
  let external = null;
  if (typeof expectedSource === "function") {
    external = expectedSource(runId, runRecs);
  } else if (expectedSource && typeof expectedSource === "object" && !Array.isArray(expectedSource)) {
    external = expectedSource[runId] != null ? expectedSource[runId] : expectedSource["*"];
  } else if (Array.isArray(expectedSource)) {
    external = expectedSource;
  }
  const _reqSig = mcEnv.readEnv("LIVENESS_REQUIRE_SIG") !== "0";
  const claimed = [
    ...new Set(runRecs.filter((r) => r && r.role && isVerifiedLivenessRecord(r, { requireSignature: _reqSig })).map((r) => r.role)),
  ];
  const normExternal = Array.isArray(external)
    ? external.map((e) => (typeof e === "string" ? { role: e } : e)).filter((e) => e && e.role)
    : [];
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

function auditLedger(records, opts = {}) {
  const recs = Array.isArray(records) ? records.filter(Boolean) : [];
  const expectedSource = opts.expectedSource || null;
  const cutoff = opts.cutoff || cutoffFor("coverage-gate-scan");
  const runDateOf =
    typeof opts.runDateOf === "function"
      ? opts.runDateOf
      : (_runId, runRecs) => {
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
      const expected = resolveExpected(expectedSource, id, runRecs);
      res = evaluate({ records: runRecs, expected, runId });
    } catch (e) {
      res = { ok: false, violations: [`coverage audit FAILED-CLOSED for run ${id}: ${e && e.message ? e.message : e}`], covered: [], missing: [], waived: [] };
    }
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
    records = readLedger(ledgerPath || undefined);
  } catch (e) {
    const msg = String((e && e.message) || e);
    process.stdout.write(
      (asJson ? JSON.stringify({ ok: true, check: NAME, reportOnly: true, note: `ledger unreadable (fail-open): ${msg}` })
        : `OK   [${NAME}] ledger unreadable — fail-open, nothing to audit (${msg})`) + "\n",
    );
    return 0;
  }

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
        `${enforce ? "" : " (REPORT-ONLY — exit 0 without --enforce)"}:\n`,
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

  if (gaps === 0) return 0;
  return enforce ? 1 : 0;
}

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
