#!/usr/bin/env node
"use strict";
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * skills-bench.js — the §13.7 "is it WORTH IT + are the results GOOD?" A/B harness.
 *
 * The SECOND gate of the earn-it ladder. §13.6 (scripts/skills-test.js) proves a
 * subprocess skill RUNS headless and stamps subprocess_verified:{date,run_id} — an
 * OBJECT. But the dispatch-contract reader (dispatch-contract.js#skillExecution)
 * fail-closed treats anything other than `subprocess_verified === true` as inline. So
 * §13.6 alone NEVER finalizes a skill to subprocess; it only proves runnability.
 *
 * §13.7 is what FINALIZES. A skill earns `execution: subprocess` (the strict
 * `subprocess_verified: true`) ONLY when BOTH axes pass, measured per-skill:
 *
 *   Axis 1 — token/context savings (the premise check). A/B the ORCHESTRATOR-side
 *     cost: INLINE (full skill output enters Alpha's context) vs SUBPROCESS (only the
 *     ≤8-line envelope enters). net_savings = inline_orchestrator_tokens −
 *     (envelope_tokens + dispatch_overhead), where overhead = background-task
 *     notification + envelope read + completion-record check (grounded in
 *     .claude/agents/_system/guides/oneshot-token-guide.md). Qualify only above BOTH
 *     thresholds (min_tokens_saved AND min_pct_saved). Light skills whose output is
 *     already small save ≈nothing (envelope ≈ inline) → they STAY inline.
 *
 *   Axis 2 — result quality. Run the skill INLINE and SUBPROCESS on the same input;
 *     compare. A fresh subprocess lacks Alpha's live conversation, so some skills
 *     degrade. Score equivalence with an INDEPENDENT CROSS-PROVIDER judge (no
 *     self-grading — the diff-model-review pattern, GPT Pro §9.4). Pass = subprocess
 *     quality ≥ inline quality within quality_tolerance. On a gold expectation, grade
 *     against it FIRST; the judge is for the subjective delta (§17.5 — the judge is
 *     not the sole oracle).
 *
 *   Decision rule (FAIL-CLOSED): finalize subprocess_verified:true ONLY when BOTH
 *     hold. Otherwise → inline (or inline-required). Stamp the skill-weight registry
 *     per skill: { subprocess_verified:true, tokens_saved, quality_verdict,
 *     context_needed?, measured_at, run_id }.
 *
 * HONEST SCOPE (operator-directed, recorded in the epic): this file is THE MECHANISM,
 * fixture-proven. It is NOT run against the 6 real heavy subprocess skills (scan:full /
 * research:deep / qa:audit / redteam:full / sleep:deep / learn:deep) — a real A/B of
 * each replays the skill twice + a cross-provider judge call, which is $-heavy and
 * DEFERRED. See scripts/dispatch/benchmark-pack/README.md for how a future $-budgeted
 * session runs the real measurement. The fixture test (skills-bench.test.js) drives
 * SYNTHETIC token counts + a STUBBED judge against a FIXTURE registry — it never spends
 * and never mutates the live .claude/runtime/skill-weight.json.
 *
 * Usage (mechanism + fixtures — NOT a real heavy run):
 *   node scripts/skills-bench.js --registry <fixture.json> --benchset <set.json>
 *   node scripts/skills-bench.js --registry <fixture.json> --benchset <set.json> --json
 *   node scripts/skills-bench.js --registry <fixture.json> --benchset <set.json> --no-finalize
 *
 * A benchset is { schema, skill, thresholds, judge?, measurements: [...] } — the
 * task-set (benchmark-pack/task-set.schema.json) carries the INPUT side (tasks +
 * thresholds); a run-record carries the MEASURED side (the per-task A/B token counts +
 * arms). The bench-result schema (benchmark-pack/bench-result.schema.json) is the
 * OUTPUT this harness computes/stamps. For the fixture path, measurements are supplied
 * directly (synthetic) so no real replay is needed.
 *
 * Test/injection seams (no real replay, no real judge, no spend):
 *   SKILLS_BENCH_JUDGE_OVERRIDE — JSON map { <skill>: { verdict, score?, reason? } }
 *     so the fixture stubs the cross-provider judge deterministically (P5 isolation).
 *     verdict ∈ {"subprocess>=inline","subprocess<inline"}; the harness NEVER
 *     self-grades — without an override and without a real judge wired, Axis 2 is
 *     UNGRADED (fail-closed: an ungraded skill is NOT finalized).
 *
 * Exit codes:
 *   0 — every skill in the benchset earned subprocess (BOTH axes passed) and was
 *       finalized (or --no-finalize: would-finalize).
 *   1 — at least one skill did NOT earn subprocess (one/both axes failed) — fail-closed.
 *   2 — usage / registry-load / benchset-load failure.
 */

const fs = require("fs");
const path = require("path");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  path.resolve(__dirname, "..");

const DEFAULT_REGISTRY = path.join(PROJECT, ".claude", "runtime", "skill-weight.json");

// ── Dispatch-overhead model (PLAN §13.7; grounded in oneshot-token-guide.md) ──
// The orchestrator-side cost of taking the SUBPROCESS arm, beyond the envelope it
// reads. Per the guide's orchestrator-tokens-per-activity table:
//   - Background task notification        ~300–800   (use the high end — conservative)
//   - Reading a small JSON envelope        ~500–1500  (counted SEPARATELY as envelope_tokens)
//   - Completion-record (ledger) check     small read (~200, conservative)
// We DELIBERATELY use the conservative (high) end so net_savings is UNDER-stated —
// a skill that clears the bar with pessimistic overhead clears it for real. envelope
// read is NOT folded in here (it is the measured envelope_tokens, per-skill).
const DEFAULT_DISPATCH_OVERHEAD = {
  background_notification: 800, // high end of ~300–800
  completion_record_check: 200, // a small ledger read
  source: ".claude/agents/_system/guides/oneshot-token-guide.md (orchestrator-tokens-per-activity)",
};

function dispatchOverheadTokens(model) {
  const m = model || DEFAULT_DISPATCH_OVERHEAD;
  return (m.background_notification || 0) + (m.completion_record_check || 0);
}

// ── Registry load (NO regen — bench always runs against an explicit registry) ──
// Unlike skills-test.js, bench NEVER regenerates the live registry: a missing
// registry is a hard error so a fixture path typo can't silently fall through to the
// live one (fail-closed; the live registry must never be mutated by a test).
function loadRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) {
    throw new Error(`--registry path does not exist: ${registryPath}`);
  }
  const reg = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  if (!reg || typeof reg !== "object" || !reg.candidates) {
    throw new Error(`registry has no candidates block: ${registryPath}`);
  }
  return reg;
}

function loadBenchset(benchsetPath) {
  if (!fs.existsSync(benchsetPath)) {
    throw new Error(`--benchset path does not exist: ${benchsetPath}`);
  }
  const bs = JSON.parse(fs.readFileSync(benchsetPath, "utf8"));
  if (!bs || typeof bs !== "object" || !bs.skill || !bs.thresholds || !Array.isArray(bs.measurements)) {
    throw new Error(`benchset must carry { skill, thresholds, measurements[] }: ${benchsetPath}`);
  }
  return bs;
}

// ── Axis 1 — token/context savings (the premise check) ──────
/**
 * measureAxis1(measurements[], thresholds, overheadModel?) ->
 *   { pass, tokens_saved, pct_saved, per_task[], inline_total, subprocess_total,
 *     overhead_per_task, threshold }
 *
 * Pure. measurements is an array of per-task arms:
 *   { task_id, inline_orchestrator_tokens, envelope_tokens }
 * net per task = inline − (envelope + dispatch_overhead). Aggregate (mean) tokens
 * saved AND pct saved must BOTH clear the thresholds. A measurement with envelope ≈
 * inline (a light skill) yields ≈0 net → correctly fails Axis 1 → stays inline.
 *
 * FAIL-CLOSED: zero measurements, a non-finite count, or a negative inline cost is a
 * hard FAIL (you cannot earn subprocess on no/garbage data) — never a silent pass.
 */
function measureAxis1(measurements, thresholds, overheadModel) {
  const overhead = dispatchOverheadTokens(overheadModel);
  const per_task = [];
  let inlineSum = 0;
  let subprocessSum = 0;
  let bad = null;

  if (!Array.isArray(measurements) || measurements.length === 0) {
    return { pass: false, reason: "no A/B measurements supplied — cannot earn Axis 1 on zero data (fail-closed)", tokens_saved: 0, pct_saved: 0, per_task: [], overhead_per_task: overhead };
  }
  for (const m of measurements) {
    const inline = Number(m && m.inline_orchestrator_tokens);
    const env = Number(m && m.envelope_tokens);
    if (!Number.isFinite(inline) || !Number.isFinite(env) || inline < 0 || env < 0) {
      bad = m && m.task_id ? m.task_id : "(unnamed task)";
      break;
    }
    const subprocessCost = env + overhead;
    const net = inline - subprocessCost;
    inlineSum += inline;
    subprocessSum += subprocessCost;
    per_task.push({ task_id: m.task_id || null, inline_orchestrator_tokens: inline, envelope_tokens: env, dispatch_overhead: overhead, net_savings: net });
  }
  if (bad) {
    return { pass: false, reason: `task '${bad}' has a non-finite/negative token count — fail-closed (cannot measure savings on garbage)`, tokens_saved: 0, pct_saved: 0, per_task, overhead_per_task: overhead };
  }
  const n = per_task.length;
  const tokens_saved = Math.round((inlineSum - subprocessSum) / n); // mean net per task
  const pct_saved = inlineSum > 0 ? (inlineSum - subprocessSum) / inlineSum : 0;
  const minTokens = Number(thresholds.min_tokens_saved);
  const minPct = Number(thresholds.min_pct_saved);
  const pass = tokens_saved >= minTokens && pct_saved >= minPct;
  return {
    pass,
    tokens_saved,
    pct_saved: Number(pct_saved.toFixed(4)),
    per_task,
    inline_total: inlineSum,
    subprocess_total: subprocessSum,
    overhead_per_task: overhead,
    threshold: { min_tokens_saved: minTokens, min_pct_saved: minPct },
    reason: pass
      ? undefined
      : tokens_saved < minTokens
        ? `mean net savings ${tokens_saved} tok < min_tokens_saved ${minTokens} (envelope ≈ inline — too light to subprocess)`
        : `pct saved ${(pct_saved * 100).toFixed(1)}% < min_pct_saved ${(minPct * 100).toFixed(1)}%`,
  };
}

// ── Axis 2 — result quality (independent cross-provider judge) ──
/**
 * The judge seam. Returns a verdict for one skill WITHOUT self-grading. Resolution
 * order:
 *   1. SKILLS_BENCH_JUDGE_OVERRIDE[skill]  (the fixture/test stub — deterministic)
 *   2. (future) a real cross-provider judge dispatch (dispatch-agent.js reviewer/
 *      consult on a DIFFERENT provider, anonymized arms). NOT wired this session —
 *      DEFERRED with the heavy A/B.
 *   3. otherwise → UNGRADED (null). Fail-closed: an ungraded skill is NOT finalized.
 *
 * A verdict is { verdict, score?, reason?, provider?, anonymized? }. verdict ∈
 * {"subprocess>=inline" (pass), "subprocess<inline" (fail)}. The harness itself NEVER
 * decides quality — it only READS the independent judge's verdict (no self-grading).
 */
function judgeQuality(skill) {
  let override = null;
  try {
    override = JSON.parse(process.env.SKILLS_BENCH_JUDGE_OVERRIDE || "null");
  } catch {
    override = null;
  }
  if (override && Object.prototype.hasOwnProperty.call(override, skill)) {
    const o = override[skill] || {};
    return {
      source: "override",
      verdict: o.verdict || null,
      score: typeof o.score === "number" ? o.score : null,
      reason: o.reason || null,
      provider: o.provider || "stub",
      anonymized: o.anonymized !== false,
    };
  }
  // No real cross-provider judge is wired this session (heavy A/B deferred). Return
  // an UNGRADED verdict so the both-axes gate fails closed rather than self-grading.
  return { source: "unwired", verdict: null, reason: "no cross-provider judge wired (heavy A/B deferred) and no override supplied — UNGRADED (fail-closed)" };
}

/**
 * gradeAxis2(skill, thresholds, judgeFn?) -> { pass, verdict, score?, reason,
 *   provider?, anonymized? }
 *
 * Pure given an injected judgeFn (defaults to the env-driven judgeQuality). PASS =
 * the INDEPENDENT judge ruled subprocess quality ≥ inline (within quality_tolerance,
 * encoded in the judge's score when present). FAIL-CLOSED on an ungraded/unknown
 * verdict — quality is NEVER assumed and NEVER self-graded.
 */
function gradeAxis2(skill, thresholds, judgeFn) {
  const judge = (judgeFn || judgeQuality)(skill);
  const tol = Number(thresholds && thresholds.quality_tolerance != null ? thresholds.quality_tolerance : 0);
  if (!judge || judge.verdict == null) {
    return { pass: false, verdict: null, reason: (judge && judge.reason) || "UNGRADED — no independent judge verdict (fail-closed)", provider: judge && judge.provider, source: judge && judge.source };
  }
  // A numeric score (subprocess minus inline, normalized) refines the verdict: pass
  // when the subprocess arm is within `quality_tolerance` BELOW inline (score >= -tol).
  let pass;
  if (typeof judge.score === "number") {
    pass = judge.score >= -tol;
  } else {
    pass = judge.verdict === "subprocess>=inline";
  }
  return {
    pass,
    verdict: judge.verdict,
    score: typeof judge.score === "number" ? judge.score : undefined,
    quality_tolerance: tol,
    provider: judge.provider,
    anonymized: judge.anonymized,
    source: judge.source,
    reason: pass ? undefined : `judge verdict '${judge.verdict}'${typeof judge.score === "number" ? ` (score ${judge.score} < -tolerance ${-tol})` : ""} — subprocess quality below inline (fail-closed)`,
  };
}

// ── Both-axes decision (fail-closed) ────────────────────────
/**
 * decideBoth(axis1, axis2) -> { earned, reason }
 * Finalize subprocess ONLY when BOTH axes pass. Either axis failing → NOT earned.
 */
function decideBoth(axis1, axis2) {
  const earned = !!(axis1 && axis1.pass && axis2 && axis2.pass);
  return {
    earned,
    reason: earned
      ? undefined
      : !axis1 || !axis1.pass
        ? `Axis 1 (savings) failed: ${(axis1 && axis1.reason) || "unknown"}`
        : `Axis 2 (quality) failed: ${(axis2 && axis2.reason) || "unknown"}`,
  };
}

// ── Finalize (atomic; BOTH-axes pass only) ──────────────────
/**
 * finalizeSubprocess(registryPath, reg, skill, stampBlock) — write the §13.7
 * finalization for `skill` and atomically replace the registry file. ONLY called when
 * decideBoth().earned === true. Sets subprocess_verified:true (the STRICT boolean the
 * dispatch-contract reader requires to actually route subprocess) PLUS the §13.7
 * measurement block { tokens_saved, quality_verdict, context_needed?, measured_at,
 * run_id }. A skill that fails either axis is NEVER finalized — it keeps whatever it
 * had (inline / a §13.6 object stamp), so the contract reader keeps treating it inline.
 */
function finalizeSubprocess(registryPath, reg, skill, stampBlock) {
  const cand = reg.candidates[skill];
  if (!cand) return false;
  cand.subprocess_verified = true; // STRICT boolean — the contract reader's finalize gate
  cand.earn_it = {
    tokens_saved: stampBlock.tokens_saved,
    quality_verdict: stampBlock.quality_verdict,
    ...(stampBlock.context_needed ? { context_needed: stampBlock.context_needed } : {}),
    measured_at: stampBlock.measured_at || new Date().toISOString(),
    run_id: stampBlock.run_id || null,
    axis1: stampBlock.axis1 || null,
    axis2: stampBlock.axis2 || null,
  };
  const tmp = registryPath + ".tmp." + process.pid + "." + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, registryPath);
  return true;
}

// ── Orchestration ───────────────────────────────────────────
/**
 * runBench({ registryPath, benchset|benchsetPath, judgeFn?, finalize?, overheadModel? })
 *   -> { skill, axis1, axis2, decision, finalized, stamp? }
 *
 * The A/B for ONE skill (a benchset is per-skill, mirroring task-set.schema.json).
 *  - measure Axis 1 from the benchset's synthetic/real per-task token counts,
 *  - grade Axis 2 via the INDEPENDENT judge (injected/stubbed; never self-graded),
 *  - decide BOTH (fail-closed),
 *  - finalize the registry ONLY on earned (unless finalize:false → dry decision).
 *
 * `finalize` defaults true. The fixture test passes finalize:false to assert the
 * decision without mutating, or true to assert the stamp landed in the FIXTURE
 * registry. The registry is loaded fresh and the skill must be a real candidate in it.
 */
function runBench(opts) {
  const registryPath = opts.registryPath || DEFAULT_REGISTRY;
  const reg = loadRegistry(registryPath);
  const benchset = opts.benchset || loadBenchset(opts.benchsetPath);
  const skill = benchset.skill;
  const cand = reg.candidates[skill];
  const run_id = `bench-${skill.replace(/[^a-z0-9]+/gi, "-")}-${Date.now()}`;

  // Fail-closed pre-gate: the skill must be a real candidate AND classified
  // subprocess in the registry under test. A bench against a non-candidate, an
  // inline, or an inline-required skill cannot finalize subprocess.
  if (!cand) {
    return notEarned(skill, run_id, { pass: false, reason: `skill '${skill}' is not a candidate in the registry under test (fail-closed)` }, null);
  }
  if (cand.execution !== "subprocess") {
    return notEarned(skill, run_id, { pass: false, reason: `registry classifies '${skill}' as '${cand.execution}', not subprocess — §13.7 only finalizes a subprocess candidate (fail-closed)` }, null);
  }

  const axis1 = measureAxis1(benchset.measurements, benchset.thresholds, opts.overheadModel || benchset.dispatch_overhead);
  const axis2 = gradeAxis2(skill, benchset.thresholds, opts.judgeFn);
  const decision = decideBoth(axis1, axis2);

  const result = {
    skill,
    run_id,
    axis1,
    axis2,
    decision,
    finalized: false,
  };

  const finalize = opts.finalize != null ? opts.finalize : true;
  if (decision.earned && finalize) {
    const stamp = {
      tokens_saved: axis1.tokens_saved,
      quality_verdict: axis2.verdict,
      context_needed: benchset.context_needed || (axis2 && axis2.context_needed) || null,
      measured_at: new Date().toISOString(),
      run_id,
      axis1: { tokens_saved: axis1.tokens_saved, pct_saved: axis1.pct_saved },
      axis2: { verdict: axis2.verdict, score: axis2.score, provider: axis2.provider, anonymized: axis2.anonymized },
    };
    result.finalized = finalizeSubprocess(registryPath, reg, skill, stamp);
    result.stamp = stamp;
  }
  return result;
}

function notEarned(skill, run_id, axis1, axis2) {
  return {
    skill,
    run_id,
    axis1,
    axis2,
    decision: { earned: false, reason: (axis1 && axis1.reason) || "not earned" },
    finalized: false,
  };
}

// ── arg parsing ─────────────────────────────────────────────
function parseArgs(argv) {
  const out = { registryPath: DEFAULT_REGISTRY, benchsetPath: null, json: false, finalize: true };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--registry") out.registryPath = path.resolve(argv[++i] || "");
    else if (a === "--benchset") out.benchsetPath = path.resolve(argv[++i] || "");
    else if (a === "--json") out.json = true;
    else if (a === "--no-finalize") out.finalize = false;
  }
  return out;
}

module.exports = {
  runBench,
  measureAxis1,
  gradeAxis2,
  judgeQuality,
  decideBoth,
  finalizeSubprocess,
  loadRegistry,
  loadBenchset,
  dispatchOverheadTokens,
  parseArgs,
  DEFAULT_REGISTRY,
  DEFAULT_DISPATCH_OVERHEAD,
};

// ── CLI ─────────────────────────────────────────────────────
if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (!opts.benchsetPath) {
    process.stderr.write("usage: skills-bench.js --registry <fixture.json> --benchset <set.json> [--json] [--no-finalize]\n");
    process.stderr.write("  (mechanism + fixtures — the 6 real heavy skills are NOT benched here; see benchmark-pack/README.md)\n");
    process.exit(2);
  }
  let result;
  try {
    result = runBench(opts);
  } catch (e) {
    process.stderr.write(`[skills-bench] ${e && e.message ? e.message : e}\n`);
    process.exit(2);
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write(`# skills-bench §13.7 — ${result.skill}\n`);
    process.stdout.write(
      `  Axis 1 (savings): ${result.axis1.pass ? "PASS" : "FAIL"} — ` +
        `${result.axis1.tokens_saved} tok mean net, ${(((result.axis1.pct_saved) || 0) * 100).toFixed(1)}%` +
        `${result.axis1.reason ? "  (" + result.axis1.reason + ")" : ""}\n`,
    );
    process.stdout.write(
      `  Axis 2 (quality): ${result.axis2 && result.axis2.pass ? "PASS" : "FAIL"} — ` +
        `verdict=${result.axis2 ? result.axis2.verdict : "n/a"}${result.axis2 && result.axis2.provider ? " judge=" + result.axis2.provider : ""}` +
        `${result.axis2 && result.axis2.reason ? "  (" + result.axis2.reason + ")" : ""}\n`,
    );
    process.stdout.write(
      `  DECISION: ${result.decision.earned ? "EARNED subprocess (BOTH axes)" : "NOT earned → stays inline"}` +
        `${result.decision.reason ? "  — " + result.decision.reason : ""}\n`,
    );
    if (result.finalized) {
      process.stdout.write(`  FINALIZED: subprocess_verified:true stamped (run_id ${result.run_id})\n`);
    } else if (result.decision.earned) {
      process.stdout.write(`  (--no-finalize: would finalize subprocess_verified:true)\n`);
    }
  }
  process.exit(result.decision.earned ? 0 : 1);
}
