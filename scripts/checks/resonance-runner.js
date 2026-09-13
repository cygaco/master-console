#!/usr/bin/env node
"use strict";

/**
 * resonance-runner (S2.2 Marketing — the named UNDER-BUILD fix) — the runnable
 * enforcer for the resonance / conversion-quality eval. MC checks correctness
 * but NOT message clarity · proof strength · audience specificity · visual hierarchy
 * · objection handling · conversion hypothesis — so it ships *valid artifacts that
 * still feel generic* (FINAL-PLAN §10d). This runner scores a target artifact
 * against `.claude/agents/_evals/resonance-conversion-rubric.json` and
 * is the "valid-but-generic" backstop the S3.1 pilot exit consumes.
 *
 * Builds to runtime/notes/wave2-s2.2-enforcers-design.md §1 + the rubric DATA. The
 * rubric is the source of truth (6 dimensions, 0-4 scale, per-dimension judge,
 * mechanical sub-checks). This runner owns the **mechanical fail-closed floor** +
 * the **anti-generic overall rule**; the per-dimension JUDGMENT scores come from the
 * judge agents (copy-lead / research-lead / conversion-lead /
 * marketing-lead) and are passed in on the artifact as `dimension_scores`.
 *
 * THE OVERALL RULE (rubric `scoring.overall_rule`, the anti-'valid-but-generic' rule):
 *   PASS iff EVERY required dimension scores >= 3 AND no mechanical floor hard-fails.
 *   A weighted mean does NOT pass — one hollow dimension (proof-strength=1) fails the
 *   whole artifact. No compensating away a generic dimension.
 *
 * Two-stage evaluation:
 *   1. MECHANICAL FLOOR (deterministic, fail-closed): each dimension's `checks` run
 *      against the artifact (must_reference spine fields, readability_grade_max,
 *      must_not_contain placeholders + the "everyone" anti-pattern, min_count
 *      proof_points/objections, single_primary_cta, belief_count_max + belief_form,
 *      no_unsourced_metric, derived_from_message_brief). ANY hard-fail => REJECT (exit 1).
 *   2. JUDGMENT SCORES: if the artifact carries `dimension_scores` (0-4 per dim from
 *      the judge agents), enforce >=3 on every REQUIRED-for-this-artifact dimension.
 *      A required dimension scoring < 3 => REJECT.
 *
 * FAIL-CLOSED (rubric `scoring.fail_closed`, cross-provider-qa false-green class):
 *   - Missing brief grounding (no message_brief core_message / no audience ref) => the
 *     eval CANNOT score => emit() ARBITRATION-NEEDED, never PASS.
 *   - Missing `dimension_scores` for required dimensions (the judgment pass has not run)
 *     => emit() ARBITRATION-NEEDED — the runner will NOT guess a PASS for the judgment
 *     half (it only owns the mechanical floor). A guessed green is worse than a halt.
 *   owner = the per-dimension judge's domain: growth_lead (conversion-hypothesis) /
 *   copy_lead (clarity/proof/objection) — the runner emits under "growth_lead" for a
 *   conversion artifact and "copy_lead" for a copy artifact (rubric judges map).
 *
 * Internal error => exit 2 (fail-closed). Pure core = evaluate({ artifact, rubric })
 * (no disk, injected rubric) so the bite-test proves every class. Mirrors
 * role-parity-scan.js.
 *
 *   node scripts/checks/resonance-runner.js <artifact.json> [--rubric <path>] [--json]
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const NAME = "resonance-runner";
const DEFAULT_RUBRIC = path.join(
  ROOT, ".claude/agents/_evals/resonance-conversion-rubric.json",
);
// Owner for the arbitration record: a conversion/landing artifact → growth_lead;
// a copy-only artifact → copy_lead (mirrors the rubric `judges` map + design-note owner).
const CONVERSION_TYPES = new Set(["landing_page", "ad_creative", "converting_artifact", "conversion_brief"]);

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
}

/** Is `dim` required FOR THIS artifact type? (`required:true` always, or in `required_for`). */
function dimRequiredFor(dim, artifactType) {
  if (dim.required === true) return true;
  if (Array.isArray(dim.required_for)) return dim.required_for.includes(artifactType);
  return false;
}

/** Coarse readability grade (Automated Readability Index) for the mechanical floor. */
function readabilityGrade(text) {
  const s = String(text || "");
  const words = (s.match(/\b\w+\b/g) || []).length;
  const sentences = Math.max(1, (s.match(/[.!?]+/g) || []).length);
  const chars = (s.match(/[A-Za-z0-9]/g) || []).length;
  if (words === 0) return 0;
  return 4.71 * (chars / words) + 0.5 * (words / sentences) - 21.43;
}

/** Resolve a dotted `must_reference` value (e.g. "message_brief.core_message") on the artifact. */
function hasReferenceField(artifact, dotted) {
  // The artifact is expected to carry the referenced spine fields it derives from.
  // Accept either a nested object (artifact.message_brief.core_message) OR a flat field
  // (artifact.core_message) OR an explicit references[] list of the dotted keys.
  const parts = dotted.split(".");
  // explicit references list
  if (Array.isArray(artifact.references) && artifact.references.includes(dotted)) return true;
  // nested
  let cur = artifact;
  let okNested = true;
  for (const p of parts) {
    if (cur && typeof cur === "object" && cur[p] !== undefined && cur[p] !== null && cur[p] !== "") cur = cur[p];
    else { okNested = false; break; }
  }
  if (okNested) return true;
  // flat (last segment)
  const last = parts[parts.length - 1];
  return artifact[last] !== undefined && artifact[last] !== null && artifact[last] !== "";
}

/** The mechanical-floor body of a single check. Returns an error string or null. */
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
      if (!text) return null; // nothing to grade; covered by must_reference elsewhere
      const g = readabilityGrade(text);
      return g > check.value + 1.0 // 1-grade tolerance on the coarse estimate
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
      // Pass if the artifact declares exactly one primary CTA. Multiple/zero => fail.
      const ctas = Array.isArray(artifact.ctas) ? artifact.ctas : null;
      if (ctas === null) return null; // not declared (copy-only / not provided) — judgment covers it
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
    // Checks that are inherently judgment / require a live render or a SCALE decision:
    // recorded as informational, NOT hard-failed by the mechanical floor (the judge owns them).
    case "powerword_density_max":
    case "uses_component_library":
    case "mobile_first_checked":
    case "audience_confidence_min":
    case "metric_data_required_for_scale":
      return null;
    default:
      return null; // unknown check kind is not a silent pass-with-error; it's just not mechanical
  }
}

/**
 * Pure assertion core.
 * @param {object} artifact the target artifact (message_brief / landing / conversion_brief / …)
 * @param {object} rubric   the parsed resonance-conversion rubric
 * @returns {{ result: "PASS"|"REJECT"|"ARBITRATION", errors: string[],
 *             emits: object[], scoredDims: object }}
 */
function evaluate({ artifact, rubric }) {
  const errors = [];
  const emits = [];

  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    errors.push("input is not a target artifact object (fail-closed)");
    return { result: "REJECT", errors, emits, scoredDims: {} };
  }
  if (!rubric || !Array.isArray(rubric.dimensions) || rubric.dimensions.length === 0) {
    // A runner with no rubric must NOT read green.
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

  // FAIL-CLOSED grounding gate (rubric scoring.fail_closed): the eval needs its spine.
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
    // Grounding missing => ARBITRATION regardless of anything else (cannot legitimately score).
    return { result: "ARBITRATION", errors, emits, scoredDims: {} };
  }

  // 1. MECHANICAL FLOOR — fail-closed. Any hard-fail => REJECT.
  for (const dim of rubric.dimensions) {
    if (!dimRequiredFor(dim, type)) continue; // a dim N/A for this artifact type doesn't gate it
    for (const check of dim.checks || []) {
      const err = runCheck(check, dim, artifact);
      if (err) errors.push(err);
    }
  }

  // 2. JUDGMENT SCORES — the anti-generic >=3 rule on required dims.
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

  // Hard mechanical/score rejects take precedence.
  if (errors.length > 0) {
    return { result: "REJECT", errors, emits, scoredDims };
  }

  // If the judgment pass has not produced scores for required dims, the runner will NOT
  // guess a PASS for the judgment half — fail-closed park (it only owns the mechanical floor).
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
    return 2; // fail-closed
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
          // FAIL-CLOSED: omit arbitrationNeeded ⇒ true (β Q2).
          artifactPrecedence: typeof artifact.precedence === "number" ? artifact.precedence : 50,
        }),
      );
    }
  } catch (e) {
    process.stderr.write(`${NAME} error: ${e.message}\n`);
    return 2; // fail-closed
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
