#!/usr/bin/env node

/**
 * scripts/sprint/routing.js — Sprint routing policy loader + enforcement CLI.
 *
 * Loads paths.sprintRouting and answers:
 *   - which model_class is declared for a given phase
 *   - which providers fall into that class
 *   - whether diff_review is required
 *
 * Enforcement subcommands (SP-20260514-002):
 *   record   — append a routing-trace row to paths.sprintDecisions/routing-trace.jsonl
 *              (schema mc/sprint/routing-trace/v1). Validates model is in the
 *              declared class. Honors single-vendor fallback (writes evidence
 *              "single_vendor_session" + decision-ledger row).
 *   check    — verify a matching trace row exists for (phase, artifact, sprint).
 *   coverage — summarize per-phase coverage for a sprint; exits non-zero when
 *              required phases are missing.
 *
 * Existing subcommands (preserved):
 *   phase <name>   — print policy for one phase as JSON.
 *   validate       — self-test references, plus enforcement block when present.
 *   (no arg)       — print full policy.
 *
 * Exit codes:
 *   0 ok
 *   1 contract violation (unknown phase, class mismatch, missing trace, …)
 *   2 bad usage
 *   3 missing prereq (policy missing, sprint not found)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");

let _loggerCache = null;
function logger() {
  if (_loggerCache !== null) return _loggerCache;
  try {
    _loggerCache = require("../hooks/lib/logger");
  } catch {
    _loggerCache = false;
  }
  return _loggerCache;
}

function emit(category, payload, extra) {
  const lg = logger();
  if (!lg || typeof lg.log !== "function") return;
  try {
    lg.log(category, payload, extra || {});
  } catch {
    // logging is best-effort
  }
}

function loadPolicy() {
  try {
    const raw = fs.readFileSync(SPRINT.routing, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.enforcement) {
      parsed.enforcement = {
        mode: "warn",
        rolled_out_at: null,
        soft_rollout_until: null,
        rationale: "default — no enforcement block present in policy.",
      };
    }
    return parsed;
  } catch {
    return null;
  }
}

function tracePath() {
  return path.join(SPRINT.decisions, "routing-trace.jsonl");
}

function decisionLedgerPath() {
  // paths.decisionLedger via the hooks lib path resolver
  try {
    const { PATHS, PROJECT } = require("../hooks/lib/paths");
    if (PATHS && PATHS.decisionLedger) {
      return path.isAbsolute(PATHS.decisionLedger)
        ? PATHS.decisionLedger
        : path.join(PROJECT, PATHS.decisionLedger);
    }
    return path.join(
      PROJECT,
      ".claude",
      "project",
      "decisions",
      "decision-ledger.jsonl",
    );
  } catch {
    return path.join(
      SPRINT.PROJECT,
      ".claude",
      "project",
      "decisions",
      "decision-ledger.jsonl",
    );
  }
}

function readTraceRows() {
  const tp = tracePath();
  if (!fs.existsSync(tp)) return [];
  const raw = fs.readFileSync(tp, "utf8");
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      rows.push(JSON.parse(t));
    } catch {
      // skip malformed line
    }
  }
  return rows;
}

function appendTraceRow(row) {
  const tp = tracePath();
  fs.mkdirSync(path.dirname(tp), { recursive: true });
  fs.appendFileSync(tp, JSON.stringify(row) + "\n");
}

function appendDecisionLedgerRow(row) {
  const lp = decisionLedgerPath();
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  fs.appendFileSync(lp, JSON.stringify(row) + "\n");
}

const SPRINT_ID_RE = /^(?:SP-\d{8}-\d{3,4}|S-[A-Z0-9]+-\d{2,3})$/;

// ── Validation ─────────────────────────────────────────

function validateTraceRow(row) {
  const errors = [];
  if (row.schema !== "mc/sprint/routing-trace/v1") {
    errors.push(`schema must be mc/sprint/routing-trace/v1`);
  }
  if (!row.sprint_id || !SPRINT_ID_RE.test(row.sprint_id)) {
    errors.push(`sprint_id missing or malformed: ${row.sprint_id}`);
  }
  if (!row.phase) errors.push("phase required");
  if (!row.artifact_id) errors.push("artifact_id required");
  if (!row.model || !/^[a-z][a-z0-9_-]*:[a-zA-Z0-9._:-]+$/.test(row.model)) {
    errors.push(`model malformed: ${row.model}`);
  }
  if (row.diff_reviewer && row.diff_reviewer !== "") {
    if (!/^[a-z][a-z0-9_-]*:[a-zA-Z0-9._:-]+$/.test(row.diff_reviewer)) {
      errors.push(`diff_reviewer malformed: ${row.diff_reviewer}`);
    }
  }
  if (!row.evidence) errors.push("evidence required");
  else if (
    !["ok", "single_vendor_session", "mismatch_override"].includes(row.evidence)
  ) {
    errors.push(`evidence invalid: ${row.evidence}`);
  }
  if (
    (row.evidence === "single_vendor_session" ||
      row.evidence === "mismatch_override") &&
    !row.decision_ledger_ref
  ) {
    errors.push(
      `decision_ledger_ref required when evidence is ${row.evidence}`,
    );
  }
  if (!row.recorded_at) errors.push("recorded_at required");
  if (!row.recorded_by) errors.push("recorded_by required");
  return errors;
}

function vendorOf(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  const i = modelId.indexOf(":");
  if (i < 0) return null;
  return modelId.slice(0, i);
}

function classOfPhase(policy, phase) {
  const pol = policy && policy.policies && policy.policies[phase];
  return pol ? pol.model_class : null;
}

function providersInClass(policy, klass) {
  return (policy && policy.model_classes && policy.model_classes[klass]) || [];
}

function classDeclaresModel(policy, klass, modelId) {
  return providersInClass(policy, klass).includes(modelId);
}

function diffReviewRequiredForPhase(policy, phase) {
  const pol = policy && policy.policies && policy.policies[phase];
  return !!(pol && pol.diff_review);
}

function escalateClassForPhase(policy, phase) {
  const pol = policy && policy.policies && policy.policies[phase];
  return pol ? pol.escalate_to || null : null;
}

// ── Phase classification for coverage ─────────────────

// Required phases for any sprint at release time.
const ALWAYS_REQUIRED = ["planning", "design", "release"];
// Conditionally required: only when the sprint has tickets and the gauntlet ran.
const REQUIRED_IF_TICKETS = ["execution", "qa", "redteam"];
// Conditionally required: only when sprint reached retro.
const REQUIRED_IF_RETROSPECTED = ["retrospective"];
// Optional / advisory phases — never block coverage.
const OPTIONAL_PHASES = [
  "docs_sync",
  "tracker_updates",
  "trace_updates",
  "plan_contract_review",
  "external_service_setup",
];

function loadSprintEntry(sprintId) {
  try {
    const fsm = require("./fs");
    const reg = fsm.readYamlMaybe(SPRINT.activeRegistry);
    if (!reg || !Array.isArray(reg.sprints)) return null;
    return reg.sprints.find((s) => s.id === sprintId) || null;
  } catch {
    return null;
  }
}

function loadSprintCurrent(sprintId) {
  try {
    const fsm = require("./fs");
    const per = SPRINT.forSprint(sprintId);
    return fsm.readYamlMaybe(per.current);
  } catch {
    return null;
  }
}

function classifyRequired(sprintId) {
  // Decide which phases are "required" for this sprint based on its state.
  const entry = loadSprintEntry(sprintId);
  const current = loadSprintCurrent(sprintId);
  const required = new Set(ALWAYS_REQUIRED);
  // Tickets exist?
  let hasTickets = false;
  if (current && current.tickets) {
    for (const bucket of Object.values(current.tickets)) {
      if (Array.isArray(bucket) && bucket.length) {
        hasTickets = true;
        break;
      }
    }
  }
  if (hasTickets) {
    for (const p of REQUIRED_IF_TICKETS) required.add(p);
  }
  if (entry && entry.status === "retrospected") {
    for (const p of REQUIRED_IF_RETROSPECTED) required.add(p);
  }
  return required;
}

// ── Subcommands ────────────────────────────────────────

function cmdPhase(name) {
  const p = loadPolicy();
  if (!p) {
    process.stderr.write(`policy missing: ${SPRINT.routing}\n`);
    return 3;
  }
  const pol = p.policies && p.policies[name];
  if (!pol) {
    process.stderr.write(
      `unknown phase ${name}. valid: ${Object.keys(p.policies).join(", ")}\n`,
    );
    return 1;
  }
  const cls = pol.model_class;
  const providers = providersInClass(p, cls);
  process.stdout.write(
    JSON.stringify(
      {
        phase: name,
        model_class: cls,
        diff_review: !!pol.diff_review,
        escalate_to: pol.escalate_to || null,
        providers,
        rationale: pol.rationale || "",
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

function cmdValidate() {
  const p = loadPolicy();
  if (!p) {
    process.stderr.write("missing policy file\n");
    return 3;
  }
  const errors = [];
  for (const [phase, pol] of Object.entries(p.policies || {})) {
    if (!pol.model_class) {
      errors.push(`phase ${phase}: no model_class`);
      continue;
    }
    if (!p.model_classes || !p.model_classes[pol.model_class]) {
      errors.push(
        `phase ${phase}: model_class ${pol.model_class} not declared in model_classes`,
      );
    }
    if (
      pol.escalate_to &&
      p.model_classes &&
      !p.model_classes[pol.escalate_to]
    ) {
      errors.push(
        `phase ${phase}: escalate_to ${pol.escalate_to} not declared`,
      );
    }
  }
  // Validate enforcement block.
  if (p.enforcement) {
    if (!["warn", "block"].includes(p.enforcement.mode)) {
      errors.push(
        `enforcement.mode invalid: ${p.enforcement.mode} (must be warn|block)`,
      );
    }
  }
  if (errors.length) {
    for (const e of errors) process.stderr.write(`routing: ${e}\n`);
    return 1;
  }
  process.stdout.write(
    `sprint routing policy ok (${Object.keys(p.policies).length} phases, enforcement=${p.enforcement ? p.enforcement.mode : "<absent>"})\n`,
  );
  return 0;
}

function parseRecordArgs(argv) {
  const out = {};
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      out[k] = true;
    } else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function cmdRecord(argv) {
  const f = parseRecordArgs(argv);
  if (!f.phase || !f.artifact || !f.sprint || !f.model) {
    process.stderr.write(
      "record requires --phase --artifact --sprint --model\n",
    );
    return 2;
  }
  const policy = loadPolicy();
  if (!policy) {
    process.stderr.write(`policy missing: ${SPRINT.routing}\n`);
    return 3;
  }
  // Phase exists?
  const klass = classOfPhase(policy, f.phase);
  if (!klass) {
    process.stderr.write(
      `unknown phase ${f.phase}. valid: ${Object.keys(policy.policies).join(", ")}\n`,
    );
    return 2;
  }
  // Sprint registered?
  if (!SPRINT_ID_RE.test(f.sprint)) {
    process.stderr.write(`malformed sprint id: ${f.sprint}\n`);
    return 2;
  }
  const sprintEntry = loadSprintEntry(f.sprint);
  if (!sprintEntry) {
    process.stderr.write(
      `unknown sprint: ${f.sprint}. See ${SPRINT.activeRegistry}.\n`,
    );
    return 2;
  }
  const evidence = f.evidence || "ok";
  if (
    !["ok", "single_vendor_session", "mismatch_override"].includes(evidence)
  ) {
    process.stderr.write(`invalid --evidence: ${evidence}\n`);
    return 2;
  }
  // Model in class?
  if (evidence === "ok" && !classDeclaresModel(policy, klass, f.model)) {
    const escalate = escalateClassForPhase(policy, f.phase);
    const valid = providersInClass(policy, klass);
    process.stderr.write(
      `routing: model ${f.model} not in class ${klass} for phase ${f.phase}.\n` +
        `declared providers for ${klass}: ${valid.join(", ") || "<none>"}.\n` +
        (escalate
          ? `escalate_to: ${escalate} (${providersInClass(policy, escalate).join(", ")}).\n`
          : "") +
        `fix: re-run with a model from the declared list, or update ${SPRINT.routing}#model_classes.${klass}.\n`,
    );
    return 1;
  }
  // Diff-reviewer requirements.
  let diffReviewer = f["diff-reviewer"] || null;
  if (
    diffReviewRequiredForPhase(policy, f.phase) &&
    evidence === "ok" &&
    !diffReviewer
  ) {
    // Auto-degrade to single_vendor_session (the policy's documented fallback).
    process.stderr.write(
      `routing: diff_review required for phase ${f.phase}, but no --diff-reviewer supplied.\n`,
    );
    if (f["allow-single-vendor"]) {
      process.stderr.write(`recorded with evidence=single_vendor_session.\n`);
    } else {
      process.stderr.write(
        `fix: pass --diff-reviewer <provider:model> from a different vendor, or pass --allow-single-vendor (records evidence=single_vendor_session).\n`,
      );
      return 1;
    }
  }
  // If diff_reviewer same vendor as model, that's a contract violation.
  if (diffReviewer && evidence === "ok") {
    if (vendorOf(diffReviewer) === vendorOf(f.model)) {
      process.stderr.write(
        `routing: diff_reviewer ${diffReviewer} has same vendor as model ${f.model}. ` +
          `Pass --evidence single_vendor_session or pick a different vendor.\n`,
      );
      return 1;
    }
  }
  // Resolve effective evidence + decision-ledger ref.
  let effectiveEvidence = evidence;
  let decisionRef = f["decision-ref"] || null;
  if (
    diffReviewRequiredForPhase(policy, f.phase) &&
    !diffReviewer &&
    evidence === "ok" &&
    f["allow-single-vendor"]
  ) {
    effectiveEvidence = "single_vendor_session";
    if (!decisionRef) decisionRef = `auto:${new Date().toISOString()}`;
  }
  if (
    (effectiveEvidence === "single_vendor_session" ||
      effectiveEvidence === "mismatch_override") &&
    !decisionRef
  ) {
    process.stderr.write(
      `routing: --decision-ref required when --evidence is ${effectiveEvidence}.\n`,
    );
    return 2;
  }
  // Build trace row.
  const now = new Date().toISOString();
  const row = {
    schema: "mc/sprint/routing-trace/v1",
    sprint_id: f.sprint,
    phase: f.phase,
    artifact_id: f.artifact,
    artifact_path: f["artifact-path"] || null,
    model: f.model,
    model_class: klass,
    diff_reviewer: diffReviewer || null,
    evidence: effectiveEvidence,
    decision_ledger_ref: decisionRef,
    recorded_at: now,
    recorded_by: f["recorded-by"] || "alpha",
    ticket_id: f.ticket || null,
    notes: f.notes || "",
  };
  const errors = validateTraceRow(row);
  if (errors.length) {
    for (const e of errors) process.stderr.write(`routing: ${e}\n`);
    return 1;
  }
  appendTraceRow(row);
  if (
    effectiveEvidence === "single_vendor_session" ||
    effectiveEvidence === "mismatch_override"
  ) {
    appendDecisionLedgerRow({
      ts: now,
      kind: "routing_evidence",
      evidence: effectiveEvidence,
      sprint: f.sprint,
      phase: f.phase,
      artifact_id: f.artifact,
      model: f.model,
      diff_reviewer: diffReviewer,
      recorded_by: row.recorded_by,
      decision_ledger_ref: decisionRef,
    });
    emit(
      "decision",
      {
        action: "routing.evidence",
        evidence: effectiveEvidence,
        sprint: f.sprint,
        phase: f.phase,
        artifact_id: f.artifact,
      },
      { actor: row.recorded_by },
    );
  }
  emit(
    "audit",
    {
      action: "sprint.routing.recorded",
      sprint: f.sprint,
      phase: f.phase,
      artifact_id: f.artifact,
      model: f.model,
      diff_reviewer: diffReviewer,
      evidence: effectiveEvidence,
    },
    { actor: row.recorded_by },
  );
  if (f.verbose) {
    process.stdout.write(
      `recorded: phase=${f.phase} artifact=${f.artifact} sprint=${f.sprint} model=${f.model} diff_reviewer=${diffReviewer || "none"} evidence=${effectiveEvidence}\n` +
        `  trace: ${tracePath()}\n`,
    );
  } else {
    process.stdout.write(
      `recorded: phase=${f.phase} artifact=${f.artifact} sprint=${f.sprint} model=${f.model} diff_reviewer=${diffReviewer || "none"} evidence=${effectiveEvidence}\n`,
    );
  }
  return 0;
}

function cmdCheck(argv) {
  const f = parseRecordArgs(argv);
  if (!f.phase || !f.artifact || !f.sprint) {
    process.stderr.write("check requires --phase --artifact --sprint\n");
    return 2;
  }
  const rows = readTraceRows();
  const hit = rows.find(
    (r) =>
      r &&
      r.sprint_id === f.sprint &&
      r.phase === f.phase &&
      r.artifact_id === f.artifact,
  );
  if (hit) {
    if (!f["exit-code"]) {
      process.stdout.write(
        `ok: trace exists for phase=${f.phase} artifact=${f.artifact} sprint=${f.sprint} model=${hit.model} evidence=${hit.evidence}\n`,
      );
    }
    return 0;
  }
  process.stderr.write(
    `routing: no trace row for phase=${f.phase} artifact=${f.artifact} sprint=${f.sprint}.\n` +
      `fix: re-run the artifact-producing command, or record manually with \`node scripts/sprint/routing.js record --phase ${f.phase} --artifact ${f.artifact} --sprint ${f.sprint} --model <provider:model>\`.\n`,
  );
  emit("audit", {
    action: "sprint.routing.check_failed",
    sprint: f.sprint,
    phase: f.phase,
    artifact_id: f.artifact,
  });
  return 1;
}

function cmdCoverage(argv) {
  const f = parseRecordArgs(argv);
  if (!f.sprint) {
    process.stderr.write("coverage requires --sprint\n");
    return 2;
  }
  if (!SPRINT_ID_RE.test(f.sprint)) {
    process.stderr.write(`malformed sprint id: ${f.sprint}\n`);
    return 2;
  }
  const policy = loadPolicy();
  if (!policy) {
    process.stderr.write(`policy missing: ${SPRINT.routing}\n`);
    return 3;
  }
  const rows = readTraceRows().filter((r) => r && r.sprint_id === f.sprint);
  const required = classifyRequired(f.sprint);
  const declared = Object.keys(policy.policies || {});
  // For each phase, collect rows.
  const byPhase = {};
  for (const ph of declared) byPhase[ph] = [];
  for (const r of rows) {
    if (!byPhase[r.phase]) byPhase[r.phase] = [];
    byPhase[r.phase].push(r);
  }
  const phaseResults = [];
  const missingRequired = [];
  const missingOptional = [];
  for (const ph of declared) {
    const arr = byPhase[ph] || [];
    const isReq = required.has(ph);
    const isOpt = OPTIONAL_PHASES.includes(ph);
    const ok = arr.length > 0;
    if (!ok && isReq) missingRequired.push(ph);
    else if (!ok && isOpt) missingOptional.push(ph);
    phaseResults.push({
      phase: ph,
      required: isReq,
      optional: isOpt,
      ok,
      count: arr.length,
      sample_model: ok ? arr[arr.length - 1].model : null,
      sample_evidence: ok ? arr[arr.length - 1].evidence : null,
    });
  }
  const okOverall = missingRequired.length === 0;
  const summary = {
    sprint: f.sprint,
    required_phases: Array.from(required),
    covered: phaseResults.filter((p) => p.ok).map((p) => p.phase),
    missing: missingRequired,
    optional_missing: missingOptional,
    phases: phaseResults,
    ok: okOverall,
    ts: new Date().toISOString(),
  };
  if (f.format === "json") {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    const reqList = Array.from(required).join(",");
    const missList = missingRequired.length
      ? missingRequired.join(",")
      : "none";
    process.stdout.write(
      `sprint=${f.sprint} coverage: ${summary.covered.length}/${required.size} required phases. missing: ${missList}.\n` +
        `required: ${reqList}\n` +
        `phases:\n`,
    );
    for (const p of phaseResults) {
      if (!f["include-optional"] && !p.required && !p.ok) continue;
      const tag = p.required ? "req" : p.optional ? "opt" : "—";
      const state = p.ok ? "pass" : "missing";
      const model = p.sample_model || "—";
      const ev = p.sample_evidence || "—";
      process.stdout.write(
        `  ${p.phase.padEnd(24)} ${tag.padEnd(4)} ${state.padEnd(8)} model=${model} evidence=${ev}\n`,
      );
    }
  }
  emit("audit", {
    action: "sprint.routing.coverage_report",
    sprint: f.sprint,
    required_count: required.size,
    covered_count: summary.covered.length,
    missing: missingRequired,
    optional_missing: missingOptional,
    ok: okOverall,
  });
  return okOverall ? 0 : 1;
}

// ── Main ───────────────────────────────────────────────

function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    const p = loadPolicy();
    if (!p) return 3;
    process.stdout.write(JSON.stringify(p, null, 2) + "\n");
    return 0;
  }
  if (cmd === "phase") return cmdPhase(process.argv[3]);
  if (cmd === "validate") return cmdValidate();
  if (cmd === "record") return cmdRecord(process.argv);
  if (cmd === "check") return cmdCheck(process.argv);
  if (cmd === "coverage") return cmdCoverage(process.argv);
  process.stderr.write(
    "usage: routing.js [phase <name> | validate | record … | check … | coverage …]\n",
  );
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

function concurrency() {
  const p = loadPolicy();
  if (!p) return null;
  return (
    p.concurrency || {
      max_lanes: 1,
      default_lane: "default",
      default_isolation: "worktree",
    }
  );
}

// ── Programmatic API for sprint scripts ───────────────

/**
 * recordTrace(opts) — programmatic equivalent of `record` subcommand.
 *
 * Used by plan.js / design.js / execute.js / release.js / retrospective.js
 * to record trace rows at artifact-finalize time WITHOUT shelling out.
 *
 * Returns { ok, exitCode, row?, message? }. Does NOT call process.exit.
 * Fail-open by default: callers should NOT treat a missing-policy or
 * unknown-phase as fatal (single-vendor users + ad-hoc projects must
 * keep working).
 *
 * opts:
 *   phase           required
 *   artifact_id     required
 *   sprint          required (SP-id)
 *   model           required (provider:name)
 *   diff_reviewer   optional
 *   evidence        optional ("ok" | "single_vendor_session" | "mismatch_override")
 *   decision_ledger_ref optional (required when evidence != "ok")
 *   recorded_by     optional (default "alpha")
 *   ticket_id       optional
 *   artifact_path   optional
 *   notes           optional
 *   allow_single_vendor optional (true → auto-degrade when diff_reviewer absent on diff-review-required phase)
 */
function recordTrace(opts) {
  if (
    !opts ||
    !opts.phase ||
    !opts.artifact_id ||
    !opts.sprint ||
    !opts.model
  ) {
    return {
      ok: false,
      exitCode: 2,
      message: "recordTrace requires phase, artifact_id, sprint, model",
    };
  }
  const policy = loadPolicy();
  if (!policy) {
    return {
      ok: false,
      exitCode: 3,
      message: `policy missing: ${SPRINT.routing}`,
    };
  }
  const klass = classOfPhase(policy, opts.phase);
  if (!klass) {
    return {
      ok: false,
      exitCode: 2,
      message: `unknown phase ${opts.phase}`,
    };
  }
  if (!SPRINT_ID_RE.test(opts.sprint)) {
    return {
      ok: false,
      exitCode: 2,
      message: `malformed sprint id: ${opts.sprint}`,
    };
  }
  const evidence0 = opts.evidence || "ok";
  if (
    !["ok", "single_vendor_session", "mismatch_override"].includes(evidence0)
  ) {
    return {
      ok: false,
      exitCode: 2,
      message: `invalid evidence: ${evidence0}`,
    };
  }
  let diffReviewer = opts.diff_reviewer || null;
  let effectiveEvidence = evidence0;
  let decisionRef = opts.decision_ledger_ref || null;
  // Class mismatch: hard-fail unless auto_override is set, in which case
  // downgrade evidence to mismatch_override + auto decision-ledger ref.
  if (evidence0 === "ok" && !classDeclaresModel(policy, klass, opts.model)) {
    if (opts.auto_override) {
      effectiveEvidence = "mismatch_override";
      if (!decisionRef) {
        decisionRef = `auto-override:model=${opts.model};class=${klass};phase=${opts.phase}`;
      }
    } else {
      return {
        ok: false,
        exitCode: 1,
        message: `model ${opts.model} not in class ${klass} for phase ${opts.phase}`,
      };
    }
  }
  if (
    diffReviewRequiredForPhase(policy, opts.phase) &&
    !diffReviewer &&
    evidence0 === "ok"
  ) {
    if (opts.allow_single_vendor) {
      effectiveEvidence = "single_vendor_session";
      if (!decisionRef) decisionRef = `auto:${new Date().toISOString()}`;
    } else {
      return {
        ok: false,
        exitCode: 1,
        message: `diff_review required for phase ${opts.phase}; pass diff_reviewer or allow_single_vendor`,
      };
    }
  }
  if (diffReviewer && evidence0 === "ok") {
    if (vendorOf(diffReviewer) === vendorOf(opts.model)) {
      return {
        ok: false,
        exitCode: 1,
        message: `diff_reviewer ${diffReviewer} same vendor as ${opts.model}`,
      };
    }
  }
  if (
    (effectiveEvidence === "single_vendor_session" ||
      effectiveEvidence === "mismatch_override") &&
    !decisionRef
  ) {
    return {
      ok: false,
      exitCode: 2,
      message: `decision_ledger_ref required when evidence=${effectiveEvidence}`,
    };
  }
  const now = new Date().toISOString();
  const row = {
    schema: "mc/sprint/routing-trace/v1",
    sprint_id: opts.sprint,
    phase: opts.phase,
    artifact_id: opts.artifact_id,
    artifact_path: opts.artifact_path || null,
    model: opts.model,
    model_class: klass,
    diff_reviewer: diffReviewer || null,
    evidence: effectiveEvidence,
    decision_ledger_ref: decisionRef,
    recorded_at: now,
    recorded_by: opts.recorded_by || "alpha",
    ticket_id: opts.ticket_id || null,
    notes: opts.notes || "",
  };
  const errors = validateTraceRow(row);
  if (errors.length) {
    return {
      ok: false,
      exitCode: 1,
      message: `trace row invalid: ${errors.join("; ")}`,
    };
  }
  appendTraceRow(row);
  if (
    effectiveEvidence === "single_vendor_session" ||
    effectiveEvidence === "mismatch_override"
  ) {
    appendDecisionLedgerRow({
      ts: now,
      kind: "routing_evidence",
      evidence: effectiveEvidence,
      sprint: opts.sprint,
      phase: opts.phase,
      artifact_id: opts.artifact_id,
      model: opts.model,
      diff_reviewer: diffReviewer,
      recorded_by: row.recorded_by,
      decision_ledger_ref: decisionRef,
    });
    emit(
      "decision",
      {
        action: "routing.evidence",
        evidence: effectiveEvidence,
        sprint: opts.sprint,
        phase: opts.phase,
        artifact_id: opts.artifact_id,
      },
      { actor: row.recorded_by },
    );
  }
  emit(
    "audit",
    {
      action: "sprint.routing.recorded",
      sprint: opts.sprint,
      phase: opts.phase,
      artifact_id: opts.artifact_id,
      model: opts.model,
      diff_reviewer: diffReviewer,
      evidence: effectiveEvidence,
    },
    { actor: row.recorded_by },
  );
  return { ok: true, exitCode: 0, row };
}

/**
 * coverageReport(sprintId) — programmatic equivalent of `coverage`.
 * Returns the summary object; callers decide how to surface it.
 */
function coverageReport(sprintId) {
  const policy = loadPolicy();
  if (!policy) {
    return { ok: false, error: `policy missing: ${SPRINT.routing}` };
  }
  if (!SPRINT_ID_RE.test(sprintId)) {
    return { ok: false, error: `malformed sprint id: ${sprintId}` };
  }
  const rows = readTraceRows().filter((r) => r && r.sprint_id === sprintId);
  const required = classifyRequired(sprintId);
  const declared = Object.keys(policy.policies || {});
  const byPhase = {};
  for (const ph of declared) byPhase[ph] = [];
  for (const r of rows) {
    if (!byPhase[r.phase]) byPhase[r.phase] = [];
    byPhase[r.phase].push(r);
  }
  const phaseResults = [];
  const missingRequired = [];
  const missingOptional = [];
  for (const ph of declared) {
    const arr = byPhase[ph] || [];
    const isReq = required.has(ph);
    const isOpt = OPTIONAL_PHASES.includes(ph);
    const ok = arr.length > 0;
    if (!ok && isReq) missingRequired.push(ph);
    else if (!ok && isOpt) missingOptional.push(ph);
    phaseResults.push({
      phase: ph,
      required: isReq,
      optional: isOpt,
      ok,
      count: arr.length,
    });
  }
  const okOverall = missingRequired.length === 0;
  return {
    ok: okOverall,
    sprint: sprintId,
    required_phases: Array.from(required),
    covered: phaseResults.filter((p) => p.ok).map((p) => p.phase),
    missing: missingRequired,
    optional_missing: missingOptional,
    phases: phaseResults,
  };
}

module.exports = {
  loadPolicy,
  cmdValidate,
  cmdRecord,
  cmdCheck,
  cmdCoverage,
  concurrency,
  classifyRequired,
  validateTraceRow,
  tracePath,
  recordTrace,
  coverageReport,
};
