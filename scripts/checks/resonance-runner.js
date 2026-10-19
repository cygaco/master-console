#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "resonance-runner";
const DEFAULT_RUBRIC = path.join(
  ROOT, ".claude/agents/_evals/resonance-conversion-rubric.json",
);
const CONVERSION_TYPES = new Set(["landing_page", "ad_creative", "converting_artifact", "conversion_brief"]);

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function dimRequiredFor(dim, artifactType) {
  if (dim.required === true) return true;
  if (Array.isArray(dim.required_for)) return dim.required_for.includes(artifactType);
  return false;
}

function readabilityGrade(text) {
  const s = String(text || "");
  const words = (s.match(/\b\w+\b/g) || []).length;
  const sentences = Math.max(1, (s.match(/[.!?]+/g) || []).length);
  const chars = (s.match(/[A-Za-z0-9]/g) || []).length;
  if (words === 0) return 0;
  return 4.71 * (chars / words) + 0.5 * (words / sentences) - 21.43;
}

function hasReferenceField(artifact, dotted) {
  const parts = dotted.split(".");
  if (Array.isArray(artifact.references) && artifact.references.includes(dotted)) return true;
  let cur = artifact;
  let okNested = true;
  for (const p of parts) {
    if (cur && typeof cur === "object" && cur[p] !== undefined && cur[p] !== null && cur[p] !== "") cur = cur[p];
    else { okNested = false; break; }
  }
  if (okNested) return true;
  const last = parts[parts.length - 1];
  return artifact[last] !== undefined && artifact[last] !== null && artifact[last] !== "";
}

function runCheck(check, dim, artifact) {
  const where = `${dim.dimension}`;
  switch (check.kind) {
    case "must_reference":
      return hasReferenceField(artifact, check.value)
        ? null
        : `floor[${where}]: missing required reference '${check.value}' (${check.why})`;
    case "readability_grade_max": {
      const text = artifact.body || artifact.core_message || "";
      if (typeof artifact.readability_grade === "number") {
        return artifact.readability_grade > check.value
          ? `floor[${where}]: readability_grade ${artifact.readability_grade} > ${check.value} (${check.why})`
          : null;
      }
      if (!text) return null;
      const g = readabilityGrade(text);
      return g > check.value + 1.0
        ? `floor[${where}]: estimated readability grade ${g.toFixed(1)} > ${check.value} (${check.why})`
        : null;
    }
    case "must_not_contain": {
      const hay = JSON.stringify(artifact).toLowerCase();
      const banned = (Array.isArray(check.value) ? check.value : [check.value])
        .filter((v) => hay.includes(String(v).toLowerCase()));
      return banned.length
        ? `floor[${where}]: contains forbidden token(s) ${JSON.stringify(banned)} (${check.why})`
        : null;
    }
    case "min_count": {
      const arr = artifact[check.target];
      const n = Array.isArray(arr) ? arr.length : 0;
      return n < check.value
        ? `floor[${where}]: '${check.target}' has ${n} item(s) < required ${check.value} (${check.why})`
        : null;
    }
    case "single_primary_cta": {
      const ctas = Array.isArray(artifact.ctas) ? artifact.ctas : null;
      if (ctas === null) return null;
      const primaries = ctas.filter((c) => c && (c.primary === true || c.role === "primary"));
      return primaries.length === 1
        ? null
        : `floor[${where}]: expected exactly one primary CTA, found ${primaries.length} (${check.why})`;
    }
    case "belief_count_max": {
      const beliefs = Array.isArray(artifact.necessary_beliefs) ? artifact.necessary_beliefs : [];
      return beliefs.length > check.value
        ? `floor[${where}]: ${beliefs.length} necessary beliefs > ${check.value} (${check.why})`
        : null;
    }
    case "belief_form_regex": {
      const re = new RegExp(check.value, "i");
      const beliefs = Array.isArray(artifact.necessary_beliefs) ? artifact.necessary_beliefs : [];
      const bad = beliefs.findIndex((b) => !re.test(String(b).trim()));
      return bad >= 0
        ? `floor[${where}]: belief[${bad}] not in required form /${check.value}/ (${check.why})`
        : null;
    }
    case "no_unsourced_metric": {
      const claims = Array.isArray(artifact.claims) ? artifact.claims : [];
      const bad = claims.findIndex((c) => {
        if (!c || typeof c !== "object") return false;
        const isMetric = c.metric === true || /\b\d+(\.\d+)?\s?%|\b\d{2,}\b/.test(String(c.text || ""));
        const hasSource = typeof c.source === "string" && c.source.trim() !== "";
        return isMetric && !hasSource && c.synthetic !== true;
      });
      return bad >= 0
        ? `floor[${where}]: claim[${bad}] is a metric with no source and not labelled synthetic (${check.why})`
        : null;
    }
    case "derived_from_message_brief": {
      const v = artifact.derived_from_message_brief;
      return typeof v === "string" && v.trim() !== ""
        ? null
        : `floor[${where}]: artifact does not declare derived_from_message_brief (${check.why})`;
    }
    case "powerword_density_max":
    case "uses_component_library":
    case "mobile_first_checked":
    case "audience_confidence_min":
    case "metric_data_required_for_scale":
      return null;
    default:
      return null;
  }
}

function evaluate({ artifact, rubric }) {
  const errors = [];
  const emits = [];

  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    errors.push("input is not a target artifact object (fail-closed)");
    return { result: "REJECT", errors, emits, scoredDims: {} };
  }
  if (!rubric || !Array.isArray(rubric.dimensions) || rubric.dimensions.length === 0) {
    return { result: "ARBITRATION", errors, scoredDims: {}, emits: [{
      reason: "no-rubric",
      decision: "park: resonance rubric missing/empty — cannot score",
      rationale: "the resonance-conversion rubric could not be loaded or has no dimensions; the eval cannot score and must not read green (false-green guard)",
      confidence: 0,
      precedenceBasis: "rubric absent",
    }] };
  }

  const type = artifact.type || "(untyped)";
  const passThreshold = (rubric.scoring && rubric.scoring.pass_threshold_per_dimension) || 3;

  const hasCoreMessage = hasReferenceField(artifact, "message_brief.core_message") ||
    (typeof artifact.core_message === "string" && artifact.core_message.trim() !== "");
  const hasAudience = hasReferenceField(artifact, "audience_dossier.id") ||
    (typeof artifact.audience_ref === "string" && artifact.audience_ref.trim() !== "");
  if (!hasCoreMessage || !hasAudience) {
    emits.push({
      reason: "missing-grounding",
      decision: `park: ${type}#${artifact.id || "(no id)"} lacks brief grounding`,
      rationale: `the resonance eval cannot score without its grounding — ${!hasCoreMessage ? "no message_brief.core_message" : ""}${!hasCoreMessage && !hasAudience ? " and " : ""}${!hasAudience ? "no audience_dossier reference" : ""}; an eval that can't see its grounding must never read green (rubric fail_closed)`,
      confidence: 0.1,
      precedenceBasis: "rubric scoring.fail_closed: missing brief inputs",
    });
    return { result: "ARBITRATION", errors, emits, scoredDims: {} };
  }

  for (const dim of rubric.dimensions) {
    if (!dimRequiredFor(dim, type)) continue;
    for (const check of dim.checks || []) {
      const err = runCheck(check, dim, artifact);
      if (err) errors.push(err);
    }
  }

  const scoredDims = {};
  const scores = artifact.dimension_scores && typeof artifact.dimension_scores === "object"
    ? artifact.dimension_scores : null;
  const missingScores = [];
  for (const dim of rubric.dimensions) {
    if (!dimRequiredFor(dim, type)) continue;
    const s = scores ? scores[dim.dimension] : undefined;
    if (typeof s !== "number") {
      missingScores.push(dim.dimension);
      continue;
    }
    scoredDims[dim.dimension] = s;
    if (s < passThreshold) {
      errors.push(`dimension[${dim.dimension}] scored ${s} < ${passThreshold} (anti-generic rule: a hollow required dimension fails the artifact — no compensating mean)`);
    }
  }

  if (errors.length > 0) {
    return { result: "REJECT", errors, emits, scoredDims };
  }

  if (missingScores.length > 0) {
    emits.push({
      reason: "missing-dimension-scores",
      decision: `park: ${type}#${artifact.id || "(no id)"} has no judge scores for ${missingScores.join(", ")}`,
      rationale: `the mechanical floor passes, but the judgment pass has not scored required dimension(s) [${missingScores.join(", ")}]; the runner owns only the mechanical floor and will not guess a PASS for the judgment half — dispatch the per-dimension judge agents, then re-run (rubric fail_closed: never a guessed PASS)`,
      confidence: 0.2,
      precedenceBasis: "rubric: judgment dimensions require the judge agents' scores",
    });
    return { result: "ARBITRATION", errors, emits, scoredDims };
  }

  return { result: "PASS", errors, emits, scoredDims };
}

function ownerFor(artifact) {
  return CONVERSION_TYPES.has(artifact && artifact.type) ? "growth_lead" : "copy_lead";
}

function main(argv) {
  const json = argv.includes("--json");
  let rubricPath = DEFAULT_RUBRIC;
  let file = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--rubric") rubricPath = path.resolve(argv[++i]);
    else if (!argv[i].startsWith("--")) file = argv[i];
  }
  if (!file) {
    process.stderr.write("usage: resonance-runner.js <artifact.json> [--rubric <path>] [--json]\n");
    return 2;
  }

  let out, emitted;
  try {
    const { emit } = require(path.join(ROOT, "scripts/arbitration/emit.js"));
    const rubric = readJSON(rubricPath);
    const artifact = readJSON(path.resolve(file));
    out = evaluate({ artifact, rubric });
    emitted = [];
    const unit = artifact && artifact.id ? artifact.id : path.basename(file);
    const owner = ownerFor(artifact);
    for (const e of out.emits) {
      emitted.push(
        emit({
          unit,
          owner,
          decision: e.decision,
          rationale: e.rationale,
          confidence: e.confidence,
          precedenceBasis: e.precedenceBasis,
          artifactPrecedence: typeof artifact.precedence === "number" ? artifact.precedence : 50,
        }),
      );
    }
  } catch (e) {
    process.stderr.write(`${NAME} error: ${e.message}\n`);
    return 2;
  }

  const { result, errors, scoredDims } = out;

  if (json) {
    process.stdout.write(
      JSON.stringify(
        { ok: result === "PASS", check: NAME, result, scoredDims, errors,
          arbitration: emitted.map((r) => ({ id: r.id, unit: r.unit, owner: r.owner, decision: r.decision })) },
        null, 2,
      ) + "\n",
    );
    return result === "PASS" ? 0 : 1;
  }

  if (result === "REJECT") {
    process.stderr.write(
      `REJECT [${NAME}] artifact fails the resonance/conversion bar (${errors.length}) — valid but generic:\n${errors.map((e) => "  - " + e).join("\n")}\n`,
    );
    return 1;
  }
  if (result === "ARBITRATION") {
    process.stderr.write(
      `ARBITRATION [${NAME}] resonance eval cannot complete (${out.emits.length}) — NOT a PASS:\n${out.emits.map((e) => "  ▸ " + e.decision).join("\n")}\n  (emitted to runtime/arbitration; the resolver gate will block ship-ready)\n`,
    );
    return 1;
  }
  process.stdout.write(`OK   [${NAME}] artifact PASSES the resonance/conversion eval (every required dim >=3, no mechanical floor hard-fail)\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { evaluate, runCheck, dimRequiredFor, readabilityGrade, hasReferenceField, ownerFor, NAME };
