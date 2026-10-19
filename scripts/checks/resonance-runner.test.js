#!/usr/bin/env node
"use strict";

const assert = require("assert");
const path = require("path");
const { evaluate } = require("./resonance-runner");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const rubric = {
  scoring: { pass_threshold_per_dimension: 3 },
  dimensions: [
    {
      dimension: "message-clarity", required: true,
      checks: [
        { kind: "must_reference", value: "message_brief.core_message", why: "spine" },
        { kind: "readability_grade_max", value: 8, why: "clarity floor" },
        { kind: "must_not_contain", value: ["lorem ipsum", "TODO", "{{"], why: "placeholder" },
      ],
    },
    {
      dimension: "proof-strength", required: true,
      checks: [
        { kind: "min_count", target: "proof_points", value: 1, why: "real proof" },
        { kind: "no_unsourced_metric", value: true, why: "no-invented-data" },
      ],
    },
    {
      dimension: "audience-specificity", required: true,
      checks: [
        { kind: "must_reference", value: "audience_dossier.id", why: "named dossier" },
        { kind: "must_not_contain", value: ["everyone", "anyone who"], why: "everyone anti-pattern" },
      ],
    },
    {
      dimension: "visual-hierarchy", required_for: ["landing_page"],
      checks: [{ kind: "single_primary_cta", value: true, why: "one CTA" }],
    },
  ],
};

function cleanBrief() {
  return {
    type: "message_brief",
    id: "m1",
    core_message: "Stop losing hours to flaky CI: isolate every run.",
    audience_ref: "dossier-eng-leads",
    proof_points: ["40% rerun-time cut, internal-benchmark-2026.md"],
    claims: [{ text: "40% faster", source: "internal-benchmark-2026.md", metric: true }],
    body: "Stop losing hours to flaky CI. Isolate every run. See the numbers.",
    readability_grade: 6,
    dimension_scores: { "message-clarity": 4, "proof-strength": 3, "audience-specificity": 4 },
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const hasReason = (emits, r) => emits.some((e) => e.reason === r);

test("clean message_brief + scores >=3 → PASS", () => {
  const out = evaluate({ artifact: cleanBrief(), rubric });
  assert.strictEqual(out.result, "PASS", `expected PASS, got ${out.result}: ${out.errors.join("; ")} / ${out.emits.map((e) => e.reason).join(",")}`);
});

test("required dimension scored 1 → REJECT (anti-generic, no compensating mean)", () => {
  const a = cleanBrief();
  a.dimension_scores = { "message-clarity": 4, "proof-strength": 1, "audience-specificity": 4 };
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "REJECT", `expected REJECT, got ${out.result}`);
  assert.ok(out.errors.some((e) => /dimension\[proof-strength\] scored 1 < 3/.test(e)), out.errors.join("; "));
});

test("placeholder token in artifact → REJECT (must_not_contain floor)", () => {
  const a = cleanBrief(); a.body = "Stop losing hours. TODO finish this section.";
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "REJECT");
  assert.ok(out.errors.some((e) => /forbidden token/.test(e)), out.errors.join("; "));
});

test("'everyone' anti-pattern → REJECT (audience-specificity floor)", () => {
  const a = cleanBrief(); a.body = "This is for everyone who writes code.";
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "REJECT");
  assert.ok(out.errors.some((e) => /forbidden token.*everyone/.test(e)), out.errors.join("; "));
});

test("empty proof_points → REJECT (min_count floor)", () => {
  const a = cleanBrief(); a.proof_points = [];
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "REJECT");
  assert.ok(out.errors.some((e) => /'proof_points' has 0 item/.test(e)), out.errors.join("; "));
});

test("unsourced metric claim → REJECT (no_unsourced_metric floor)", () => {
  const a = cleanBrief();
  a.claims = [{ text: "used by 9000 teams", source: null, metric: true }];
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "REJECT");
  assert.ok(out.errors.some((e) => /metric with no source/.test(e)), out.errors.join("; "));
});

test("landing_page with two primary CTAs → REJECT (single_primary_cta floor, required_for)", () => {
  const a = cleanBrief();
  a.type = "landing_page";
  a.ctas = [{ role: "primary" }, { role: "primary" }];
  a.dimension_scores = { "message-clarity": 4, "proof-strength": 3, "audience-specificity": 4, "visual-hierarchy": 4 };
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "REJECT");
  assert.ok(out.errors.some((e) => /expected exactly one primary CTA, found 2/.test(e)), out.errors.join("; "));
});

test("missing core_message + audience → ARBITRATION (fail-closed grounding)", () => {
  const a = cleanBrief();
  delete a.core_message; delete a.audience_ref;
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}`);
  assert.ok(hasReason(out.emits, "missing-grounding"), out.emits.map((e) => e.reason).join(","));
});

test("floor passes but no dimension_scores → ARBITRATION (no guessed PASS)", () => {
  const a = cleanBrief(); delete a.dimension_scores;
  const out = evaluate({ artifact: a, rubric });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}: ${out.errors.join("; ")}`);
  assert.ok(hasReason(out.emits, "missing-dimension-scores"), out.emits.map((e) => e.reason).join(","));
});

test("missing/empty rubric → ARBITRATION (false-green guard)", () => {
  const out = evaluate({ artifact: cleanBrief(), rubric: { dimensions: [] } });
  assert.strictEqual(out.result, "ARBITRATION");
  assert.ok(hasReason(out.emits, "no-rubric"), out.emits.map((e) => e.reason).join(","));
});

test("non-object artifact → REJECT (fail-closed)", () => {
  const out = evaluate({ artifact: 42, rubric });
  assert.strictEqual(out.result, "REJECT");
});

test("real rubric on disk → clean brief PASSes (rubric is loadable + coherent)", () => {
  const realRubric = require(path.join(
    process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."),
    ".claude/agents/_evals/resonance-conversion-rubric.json",
  ));
  const a = cleanBrief();
  a.objections_handled = ["price: amortized over rerun time saved"];
  a.necessary_beliefs = ["I believe that flaky tests cost me real time"];
  a.derived_from_message_brief = "m1";
  a.conversion_hypothesis = "isolating runs cuts reruns; expect 40% drop";
  a.dimension_scores = {
    "message-clarity": 4, "proof-strength": 3, "audience-specificity": 4,
    "objection-handling": 3, "conversion-hypothesis": 3,
  };
  const out = evaluate({ artifact: a, rubric: realRubric });
  assert.strictEqual(out.result, "PASS", `expected PASS on real rubric, got ${out.result}: ${out.errors.join("; ")} / emits ${out.emits.map((e) => e.reason).join(",")}`);
});

if (failures.length) {
  process.stderr.write(`resonance-runner bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`resonance-runner bite-test: ${passed}/${passed} passed (positive + anti-generic + 6 floor rejects + 3 arbitration emits + fail-closed + real-rubric integration)\n`);
process.exit(0);
