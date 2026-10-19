#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "adhoc-fail-override";

const registryRoles = require("../dispatch/registry-roles");
const REVIEWER_KEYS = Object.freeze(
  registryRoles.deriveOrFallback(
    () => registryRoles.reviewerGateKeys(),
    ["backend_reviewer", "frontend_reviewer", "qa_reviewer", "security_reviewer"],
    "adhoc-fail-override.REVIEWER_KEYS",
  ),
);

const DECLARED_SUCCESS = Object.freeze(new Set(["pass", "complete"]));

const DEFAULT_REVIEWERS_DIR = path.join(ROOT, ".claude", "runtime", "dispatch");

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function isFailVerdict(v) {
  return String(v || "").trim().toLowerCase() === "fail";
}

function reviewerJsonIsFail(obj) {
  if (!obj || typeof obj !== "object") return false;
  const verdictFields = ["verdict", "status", "result", "outcome"];
  for (const k of verdictFields) {
    const val = String(obj[k] || "").trim().toLowerCase();
    if (val === "fail" || val === "failed" || val === "reject" || val === "rejected") return true;
  }
  for (const k of ["critical_findings", "high_findings", "critical", "high"]) {
    const n = obj[k];
    if (typeof n === "number" && n > 0) return true;
  }
  const findings = Array.isArray(obj.findings)
    ? obj.findings
    : Array.isArray(obj.issues)
      ? obj.issues
      : null;
  if (findings) {
    for (const f of findings) {
      const sev = String((f && (f.severity || f.level)) || "").trim().toLowerCase();
      if (sev === "critical" || sev === "high") return true;
    }
  }
  return false;
}

function evaluate({ result, reviewerVerdicts = [] }) {
  const errors = [];
  let checked = 0;

  const topStatus = result ? String(result.status || "").trim().toLowerCase() : "";
  const declaredPass = DECLARED_SUCCESS.has(topStatus);
  const completedField =
    result && Array.isArray(result.units_completed) ? "units_completed" : "features_completed";
  const completed = new Set(
    result && Array.isArray(result[completedField])
      ? result[completedField].map((x) => String(x))
      : [],
  );

  const gateChecks = result && Array.isArray(result.gate_checks) ? result.gate_checks : [];
  for (const gc of gateChecks) {
    if (!gc || typeof gc !== "object") continue;
    const feature = String(gc.feature || gc.unit || "(unnamed)");
    const failedReviewers = REVIEWER_KEYS.filter((k) => isFailVerdict(gc[k]));
    if (failedReviewers.length === 0) continue;
    checked++;

    const featureCompleted = completed.has(feature);
    if (declaredPass || featureCompleted) {
      const why = [];
      if (declaredPass) why.push(`top-level status == "${topStatus}"`);
      if (featureCompleted) why.push(`"${feature}" is in ${completedField}`);
      errors.push(
        `override: "${feature}" has FAILING reviewer(s) [${failedReviewers.join(", ")}] yet ${why.join(" AND ")} — a dispatcher cannot override a binding FAIL (ADR-0007 independence invariant)`,
      );
    }
  }

  for (const rv of reviewerVerdicts) {
    if (!rv || !rv.fail) continue;
    checked++;
    const feature = rv.feature ? String(rv.feature) : null;
    const featureCompleted = feature ? completed.has(feature) : false;
    if (declaredPass || featureCompleted || (result == null)) {
      const why = [];
      if (declaredPass) why.push(`top-level status == "${topStatus}"`);
      if (featureCompleted) why.push(`"${feature}" is in ${completedField}`);
      errors.push(
        `override: reviewer output ${rv.source} reports a binding FAIL (fail/critical/high)${feature ? ` for "${feature}"` : ""} yet ${why.join(" AND ") || "the run was declared successful"} — dispatcher cannot override a binding FAIL`,
      );
    }
  }

  return { result: errors.length > 0 ? "REJECT" : "PASS", errors, checked };
}

function loadReviewerVerdicts(dir) {
  const out = [];
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    if (!e.isFile() || !e.name.endsWith(".json")) continue;
    if (!/(review|reviewer|qa|redteam|security|^rr|-rr)/i.test(e.name)) continue;
    const full = path.join(dir, e.name);
    let obj;
    try {
      obj = readJSON(full);
    } catch {
      continue;
    }
    out.push({
      source: e.name,
      fail: reviewerJsonIsFail(obj),
      feature: obj && (obj.feature || obj.scope) ? String(obj.feature || obj.scope) : null,
    });
  }
  return out;
}

function main(argv) {
  const json = argv.includes("--json");
  let resultPath = null;
  let reviewersDir = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--result") resultPath = path.resolve(argv[++i]);
    else if (argv[i] === "--reviewers") reviewersDir = path.resolve(argv[++i]);
  }

  let result = null;
  let reviewerVerdicts = [];
  try {
    if (resultPath) {
      if (!fs.existsSync(resultPath)) {
        process.stderr.write(`${NAME} error: --result file not found: ${resultPath}\n`);
        return 2;
      }
      result = readJSON(resultPath);
      if (!result || typeof result !== "object") {
        process.stderr.write(`${NAME} error: --result did not parse to an object\n`);
        return 2;
      }
    }
    const dir = reviewersDir || DEFAULT_REVIEWERS_DIR;
    reviewerVerdicts = loadReviewerVerdicts(dir);
  } catch (e) {
    process.stderr.write(`${NAME} error: ${e.message}\n`);
    return 2;
  }

  const haveReviewerSignal = reviewerVerdicts.some((r) => r.fail);
  if (!result && !haveReviewerSignal) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: true, check: NAME, reason: "no_adhoc_run", checked: 0 }) + "\n",
      );
    } else {
      process.stdout.write(
        `OK   [${NAME}] no adhoc GAMMA_RESULT to check (no --result, no failing reviewer output) — nothing to audit\n`,
      );
    }
    return 0;
  }

  if (!result) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ ok: true, check: NAME, reason: "reviewer_detail_only_no_result", checked: 0 }) + "\n",
      );
    } else {
      process.stdout.write(
        `OK   [${NAME}] reviewer FAIL detail present but no GAMMA_RESULT supplied — no declared-success surface to contradict (supply --result to audit override)\n`,
      );
    }
    return 0;
  }

  const out = evaluate({ result, reviewerVerdicts });

  if (json) {
    process.stdout.write(
      JSON.stringify(
        { ok: out.result === "PASS", check: NAME, result: out.result, checked: out.checked, errors: out.errors },
        null,
        2,
      ) + "\n",
    );
    return out.result === "PASS" ? 0 : 1;
  }

  if (out.result === "REJECT") {
    process.stderr.write(
      `REJECT [${NAME}] dispatcher overrode a binding FAIL (${out.errors.length}):\n${out.errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `OK   [${NAME}] no FAIL-override detected (${out.checked} verdict(s) checked; any FAIL is honestly reflected in status/features_completed)\n`,
  );
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, reviewerJsonIsFail, isFailVerdict, loadReviewerVerdicts, REVIEWER_KEYS, DECLARED_SUCCESS, NAME };
