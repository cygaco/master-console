#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "design-quality-gate";
const OWNER = "design_quality";
const DESIGN_BRIEF_PRECEDENCE = 30;

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function evaluate({ staticLane, judgment, designBrief, lane2Mode = "block" }) {
  const errors = [];
  const emits = [];
  const advisories = [];
  const advisory = lane2Mode === "advisory";

  if (!staticLane || staticLane.ran !== true) {
    return { result: "ARBITRATION", errors, emits: [{
      reason: "static-lane-unrunnable",
      decision: "park: lane 1 (design-system --strict) could not run",
      rationale: "the static design-system lane could not be executed; a two-lane gate cannot clear on a half it never ran (fail-closed)",
      confidence: 0,
      precedenceBasis: "lane 1 unrunnable",
    }], advisories };
  }
  if (staticLane.ok !== true || staticLane.exitCode !== 0) {
    errors.push(`static-fail: lane 1 (design-system.js --strict) exited ${staticLane.exitCode} — ${staticLane.summary || "design-system violations"} (the regex-catchable half rejects)`);
  }

  const pushJ = advisory ? (e) => advisories.push(e) : (e) => emits.push(e);
  const pushJErr = advisory
    ? (m) => advisories.push({ reason: "judgment-fail", decision: m })
    : (m) => errors.push(m);
  if (!judgment || typeof judgment !== "object") {
    pushJ({
      reason: "missing-judgment",
      decision: "park: no design-quality judgment result available",
      rationale: "lane 1 ran but no parseable lane-2 DesignQualityResult was supplied; the launcher will not clear the design gate on the static half alone — a regex-only pass is the 'valid but generic' hole the judgment lane exists to close (dispatch design-quality, then re-run)",
      confidence: 0.1,
      precedenceBasis: "two-lane gate: judgment half required",
    });
  } else {
    const verdict = String(judgment.verdict || "").toUpperCase();
    const rec = String(judgment.recommendation || "").toUpperCase();
    const requiresHuman = judgment.requiresHuman === true;

    if (rec === "INVESTIGATE" || requiresHuman) {
      pushJ({
        reason: "judgment-investigate",
        decision: `park: design-quality judgment is INVESTIGATE/requiresHuman for unit ${judgment.unit || "(?)"}`,
        rationale: `the design-quality judge returned recommendation=${rec || "(none)"} requiresHuman=${requiresHuman} (its oneshot stand-in for escalation — a missing/contradictory design_brief, not a guessed PASS): "${String(judgment.rationale || "").slice(0, 120)}"`,
        confidence: typeof judgment.confidence === "number" ? judgment.confidence : 0.3,
        precedenceBasis: "design-quality judge: oneshot arbitration-needed",
      });
    } else if (verdict === "FAIL") {
      const failedAxes = judgment.axes && typeof judgment.axes === "object"
        ? Object.entries(judgment.axes).filter(([, v]) => v && v.pass === false).map(([k]) => k)
        : [];
      pushJErr(`judgment-fail: design-quality verdict=FAIL for unit ${judgment.unit || "(?)"} — failing axes [${failedAxes.join(", ") || "unspecified"}] (critical/high finding is a gate failure)`);
    } else if (verdict !== "PASS" && verdict !== "SKIP") {
      pushJ({
        reason: "judgment-malformed",
        decision: `park: design-quality judgment verdict '${judgment.verdict}' is not recognized`,
        rationale: `the lane-2 result carried verdict='${judgment.verdict}' which is neither PASS, FAIL, SKIP, nor an INVESTIGATE/requiresHuman signal; an unrecognized verdict must not read green (fail-closed)`,
        confidence: 0,
        precedenceBasis: "malformed judgment result",
      });
    }

    if (designBrief && designBrief.id && judgment.design_brief_ref &&
        judgment.design_brief_ref !== designBrief.id &&
        judgment.design_brief_ref !== "null") {
      pushJ({
        reason: "design-brief-contradiction",
        decision: `park: judged design_brief '${judgment.design_brief_ref}' != supplied design_brief '${designBrief.id}'`,
        rationale: `the design-quality judge reviewed against design_brief '${judgment.design_brief_ref}' but the unit's supplied design_brief is '${designBrief.id}'; the launcher cannot reconcile which design intent governs and parks for arbitration`,
        confidence: 0.2,
        precedenceBasis: "design_brief contradiction across lane-2 vs supplied",
      });
    }
  }

  if (errors.length > 0) return { result: "REJECT", errors, emits, advisories };
  if (emits.length > 0) return { result: "ARBITRATION", errors, emits, advisories };
  return { result: "PASS", errors, emits, advisories };
}

function runStaticLane() {
  const script = path.join(ROOT, "scripts/checks/design-system.js");
  if (!fs.existsSync(script)) {
    return { ran: false, exitCode: null, ok: false, summary: "design-system.js not found" };
  }
  const r = spawnSync(process.execPath, [script, "--strict"], { encoding: "utf8" });
  if (r.error) {
    return { ran: false, exitCode: null, ok: false, summary: r.error.message };
  }
  const exitCode = typeof r.status === "number" ? r.status : 1;
  return {
    ran: true,
    exitCode,
    ok: exitCode === 0,
    summary: (r.stdout || "").trim().split("\n")[0] || (r.stderr || "").trim().split("\n")[0],
  };
}

function consultVerdict(out) {
  if (out.result === "PASS") return "APPROVE";
  if (out.result === "REJECT") return "REJECT";
  const reasons = (out.emits || []).map((e) => e.reason);
  if (reasons.includes("missing-judgment")) return "MISSING";
  if (reasons.includes("judgment-investigate")) return "INVESTIGATE";
  return "ARBITRATION";
}

function main(argv) {
  const json = argv.includes("--json");
  let judgmentPath = null;
  let designBriefPath = null;
  let lane2Mode = "block";
  let mode = "unknown";
  let unit = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--judgment") judgmentPath = path.resolve(argv[++i]);
    else if (argv[i] === "--design-brief") designBriefPath = path.resolve(argv[++i]);
    else if (argv[i] === "--lane2") lane2Mode = String(argv[++i] || "block").toLowerCase();
    else if (argv[i] === "--mode") mode = String(argv[++i] || "unknown").toLowerCase();
    else if (argv[i] === "--unit") unit = argv[++i] || null;
  }

  let out, emitted;
  try {
    const { emit } = require(path.join(ROOT, "scripts/arbitration/emit.js"));
    const staticLane = runStaticLane();
    const judgment = judgmentPath ? readJSON(judgmentPath) : null;
    const designBrief = designBriefPath ? readJSON(designBriefPath) : null;
    out = evaluate({ staticLane, judgment, designBrief, lane2Mode });

    try {
      const { log } = require(path.join(ROOT, "scripts/hooks/lib/logger.js"));
      const consultUnit = unit || (judgment && judgment.unit) || (designBrief && designBrief.id) || null;
      log("manager_consult", {
        manager: "design-quality",
        mode,
        unit: consultUnit,
        verdict: consultVerdict(out),
        lane2Mode,
        ts: new Date().toISOString(),
      });
    } catch {
    }

    emitted = [];
    const emitUnit = (judgment && judgment.unit) || (designBrief && designBrief.id) || "design-unit";
    for (const e of out.emits) {
      emitted.push(
        emit({
          unit: emitUnit,
          owner: OWNER,
          decision: e.decision,
          rationale: e.rationale,
          confidence: e.confidence,
          precedenceBasis: e.precedenceBasis,
          artifactPrecedence: DESIGN_BRIEF_PRECEDENCE,
        }),
      );
    }
  } catch (e) {
    process.stderr.write(`${NAME} error: ${e.message}\n`);
    return 2;
  }

  const { result, errors, emits, advisories } = out;

  if (advisories && advisories.length) {
    process.stderr.write(
      `ADVISORY [${NAME}] lane-2 (judgment) is ADVISORY (--lane2 advisory ramp — does NOT block ship; lane 1 still blocks) (${advisories.length}):\n${advisories.map((a) => "  ~ " + (a.decision || a.reason)).join("\n")}\n`,
    );
  }

  if (json) {
    process.stdout.write(
      JSON.stringify(
        { ok: result === "PASS", check: NAME, owner: OWNER, result, lane2Mode, errors, advisories,
          arbitration: emitted.map((r) => ({ id: r.id, unit: r.unit, decision: r.decision })) },
        null, 2,
      ) + "\n",
    );
    return result === "PASS" ? 0 : 1;
  }

  if (result === "REJECT") {
    process.stderr.write(
      `REJECT [${NAME}] design unit failed the two-lane design-quality gate (${errors.length}):\n${errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 1;
  }
  if (result === "ARBITRATION") {
    process.stderr.write(
      `ARBITRATION [${NAME}] design gate cannot clear (${emits.length}) — NOT approved:\n${emits.map((e) => "  ▸ " + e.decision).join("\n")}\n  (emitted to runtime/arbitration; the resolver gate will block ship-ready)\n`,
    );
    return 1;
  }
  process.stdout.write(`OK   [${NAME}] design unit clears BOTH lanes (static --strict + judgment PASS)\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, runStaticLane, NAME, OWNER };
