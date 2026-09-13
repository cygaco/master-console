#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * tests/regression/SP-20260518-007/schemas-and-paths.test.js
 *
 * Sprint A — Sprint Goal Verification regression corpus.
 *
 * Covers ACs:
 *   - AC-1.1.1: plan-contract.schema.json accepts the additive goal_verification field (omit case)
 *   - AC-1.1.2: empty justification with reproduction=not_applicable is rejected by validate.js
 *   - AC-1.2.1: schemas/sprint/regression-fixture.schema.json parses + registers $id
 *   - AC-1.2.2: regression-fixture YAML with empty justification + reproduction_kind=not_applicable is rejected
 *   - AC-1.3.1: .claude/paths.json has sprintRegressionCorpus
 *   - AC-1.3.2: scripts/hooks/lib/paths.js exposes sprintRegressionCorpus in lockstep
 *   - AC-2.1.1: _mc/templates/sprint/requirements/acceptance-criteria.md.tmpl documents verified_by:
 *
 * Convention (Sprint A): bespoke node script with passed/failed counters
 * + per-case lines (`ok    <name>` / `FAIL  <name>`). Same as
 * scripts/sprint/test-plan-honors-registry-primary.js. Exit 0 on all pass.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..", "..", "..");
let passed = 0;
let failed = 0;
function ok(name) {
  passed++;
  process.stdout.write(`  ok    ${name}\n`);
}
function fail(name, detail) {
  failed++;
  process.stdout.write(`  FAIL  ${name}\n`);
  if (detail) process.stdout.write(`        ${detail}\n`);
}

// ── AC-1.1.1 / AC-1.1.2 ────────────────────────────────────────────
function test_plan_contract_omits_goal_verification_field() {
  const schemaPath = path.join(
    REPO,
    "schemas",
    "sprint",
    "plan-contract.schema.json",
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  // The block is additive — should be in `properties` but NOT in `required`.
  if (!schema.properties || !schema.properties.goal_verification) {
    return fail(
      "test_plan_contract_omits_goal_verification_field",
      "schema.properties.goal_verification missing",
    );
  }
  if (
    Array.isArray(schema.required) &&
    schema.required.includes("goal_verification")
  ) {
    return fail(
      "test_plan_contract_omits_goal_verification_field",
      "goal_verification appears in required[] — must be optional",
    );
  }
  ok("test_plan_contract_omits_goal_verification_field");
}

function test_empty_justification_treated_as_missing() {
  const tmp = path.join(os.tmpdir(), `sp007-pc-${Date.now()}.yaml`);
  // Construct a minimal Plan Contract with the offending block.
  // The yaml writer in the helpers uses scripts/sprint/fs.js writeYaml; here we
  // write raw YAML directly for the test.
  const yaml = [
    'schema: "mc/sprint/plan-contract/v1"',
    'id: "PC-99999999-9999"',
    'created_at: "2026-05-18T00:00:00Z"',
    'updated_at: "2026-05-18T00:00:00Z"',
    'sprint: "SP-99999999-999"',
    'source_request: "test"',
    'source_request_verbatim: "test"',
    'request_type: "research"',
    'interpreted_intent: "fixture"',
    'user_or_business_outcome: "fixture"',
    "affected_surfaces: []",
    'current_behavior: { evidence_level: "unknown" }',
    'desired_behavior: "fixture"',
    'scope: { size: "s", risk_level: "low" }',
    'scope_variants: { minimal_safe: { summary: "" }, recommended: { summary: "" }, expanded: { summary: "" } }',
    "assumptions: { safe: [], unsafe: [], needs_user_or_beta_review: [] }",
    "open_questions: { blocking: [], non_blocking: [] }",
    "non_goals: []",
    "requirement_areas: []",
    "high_level_story_candidates: []",
    "granular_story_candidates: []",
    "workstream_candidates: []",
    'preliminary_ticket_candidates: { allowed: false, notes: "" }',
    'external_service_dependencies: { status: "none_expected" }',
    "approval_boundaries: []",
    "design_required: true",
    "execution_allowed_without_design: false",
    'recommended_mode: "no_recommendation"',
    "mode_invocation_required_by_user: true",
    'lane: { type: "default", value: null, isolation_notes: "" }',
    "beta_review: { required: false }",
    'plan_quality: { status: "needs_design" }',
    "goal_verification:",
    '  origin_evidence: "fixture for AC-1.1.2"',
    "  bug_classes_closed: []",
    '  reproduction: "not_applicable"',
    '  justification: ""',
    'next_recommended_command: "/sprint:design"',
    'resume_instructions: "test"',
    "tracker_paths: {}",
    "reports: {}",
    'created_by: "test"',
    'updated_by: "test"',
    "",
  ].join("\n");
  fs.writeFileSync(tmp, yaml);
  const r = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "sprint", "validate.js"), tmp],
    { encoding: "utf8" },
  );
  fs.unlinkSync(tmp);
  if (r.status === 0) {
    return fail(
      "test_empty_justification_treated_as_missing",
      `validate.js exited 0; expected non-zero. stdout=${r.stdout}`,
    );
  }
  if (!/justification/i.test(r.stderr || "")) {
    return fail(
      "test_empty_justification_treated_as_missing",
      `stderr did not mention 'justification'. stderr=${r.stderr}`,
    );
  }
  ok("test_empty_justification_treated_as_missing");
}

// ── AC-1.2.1 ────────────────────────────────────────────────────────
function test_regression_fixture_schema_parses() {
  const schemaPath = path.join(
    REPO,
    "schemas",
    "sprint",
    "regression-fixture.schema.json",
  );
  if (!fs.existsSync(schemaPath)) {
    return fail(
      "test_regression_fixture_schema_parses",
      `missing ${schemaPath}`,
    );
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  if (schema.$id !== "mc/sprint/regression-fixture/v1") {
    return fail(
      "test_regression_fixture_schema_parses",
      `$id mismatch: ${schema.$id}`,
    );
  }
  ok("test_regression_fixture_schema_parses");
}

// ── AC-1.2.2 ────────────────────────────────────────────────────────
function test_valid_fixture_passes_and_empty_justification_fails() {
  // Valid case: reproduction_kind=executable, full fields.
  const tmpValid = path.join(os.tmpdir(), `sp007-rf-valid-${Date.now()}.yaml`);
  const validYaml = [
    'schema: "mc/sprint/regression-fixture/v1"',
    'id: "RF-20260518-001"',
    'sprint_id: "SP-20260518-007"',
    'origin: { kind: "ticket_id", ref: "T-20260518-103" }',
    "bug_classes_closed: []",
    "cited_tests:",
    '  - { file: "tests/regression/SP-20260518-007/x.test.js", test_name: "y" }',
    'reproduction_kind: "executable"',
    "fixture_path: null",
    'created_at: "2026-05-18T00:00:00Z"',
    'updated_at: "2026-05-18T00:00:00Z"',
    "",
  ].join("\n");
  fs.writeFileSync(tmpValid, validYaml);
  const rValid = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "sprint", "validate.js"), tmpValid],
    { encoding: "utf8" },
  );
  fs.unlinkSync(tmpValid);
  if (rValid.status !== 0) {
    return fail(
      "test_valid_fixture_passes_and_empty_justification_fails",
      `valid case rejected: stderr=${rValid.stderr}`,
    );
  }
  // Empty-justification case.
  const tmpBad = path.join(os.tmpdir(), `sp007-rf-bad-${Date.now()}.yaml`);
  const badYaml = [
    'schema: "mc/sprint/regression-fixture/v1"',
    'id: "RF-20260518-002"',
    'sprint_id: "SP-20260518-007"',
    'origin: { kind: "ticket_id", ref: "T-20260518-103" }',
    "bug_classes_closed: []",
    "cited_tests:",
    '  - { file: "tests/regression/SP-20260518-007/x.test.js", test_name: "y" }',
    'reproduction_kind: "not_applicable"',
    'justification: ""',
    "fixture_path: null",
    'created_at: "2026-05-18T00:00:00Z"',
    'updated_at: "2026-05-18T00:00:00Z"',
    "",
  ].join("\n");
  fs.writeFileSync(tmpBad, badYaml);
  const rBad = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "sprint", "validate.js"), tmpBad],
    { encoding: "utf8" },
  );
  fs.unlinkSync(tmpBad);
  if (rBad.status === 0) {
    return fail(
      "test_valid_fixture_passes_and_empty_justification_fails",
      `empty-justification accepted: stdout=${rBad.stdout}`,
    );
  }
  if (!/justification/i.test(rBad.stderr || "")) {
    return fail(
      "test_valid_fixture_passes_and_empty_justification_fails",
      `stderr did not mention 'justification'. stderr=${rBad.stderr}`,
    );
  }
  ok("test_valid_fixture_passes_and_empty_justification_fails");
}

// ── AC-1.3.1 / AC-1.3.2 ────────────────────────────────────────────
function test_paths_json_has_sprint_regression_corpus() {
  const paths = JSON.parse(
    fs.readFileSync(path.join(REPO, ".claude", "paths.json"), "utf8"),
  );
  if (paths.sprintRegressionCorpus !== "tests/regression") {
    return fail(
      "test_paths_json_has_sprint_regression_corpus",
      `expected tests/regression, got ${paths.sprintRegressionCorpus}`,
    );
  }
  ok("test_paths_json_has_sprint_regression_corpus");
}

function test_hookslib_paths_has_sprint_regression_corpus_in_lockstep() {
  // The hook lib reads from .claude/paths.json dynamically, so the in-memory
  // PATHS object will expose the key if and only if paths.json has it.
  const { PATHS } = require(
    path.join(REPO, "scripts", "hooks", "lib", "paths.js"),
  );
  if (
    !PATHS.sprintRegressionCorpus ||
    !PATHS.sprintRegressionCorpus.endsWith(path.join("tests", "regression"))
  ) {
    return fail(
      "test_hookslib_paths_has_sprint_regression_corpus_in_lockstep",
      `got ${PATHS.sprintRegressionCorpus}`,
    );
  }
  // Also verify the generated fallback table mirrors the key (paths.generated.js).
  const gen = require(
    path.join(REPO, "scripts", "hooks", "lib", "paths.generated.js"),
  );
  if (!gen.PATHS || !gen.PATHS.sprintRegressionCorpus) {
    return fail(
      "test_hookslib_paths_has_sprint_regression_corpus_in_lockstep",
      `paths.generated.js missing sprintRegressionCorpus`,
    );
  }
  ok("test_hookslib_paths_has_sprint_regression_corpus_in_lockstep");
}

// ── AC-2.1.1 ────────────────────────────────────────────────────────
function test_ac_template_documents_verified_by_convention() {
  const tmpl = fs.readFileSync(
    path.join(
      REPO,
      "_mc",
      "templates",
      "sprint",
      "requirements",
      "acceptance-criteria.md.tmpl",
    ),
    "utf8",
  );
  if (!/verified_by:/.test(tmpl)) {
    return fail(
      "test_ac_template_documents_verified_by_convention",
      `template does not contain 'verified_by:'`,
    );
  }
  if (!/not_applicable/.test(tmpl)) {
    return fail(
      "test_ac_template_documents_verified_by_convention",
      `template does not document the not_applicable form`,
    );
  }
  if (!/<test-file>::<test-name>/.test(tmpl)) {
    return fail(
      "test_ac_template_documents_verified_by_convention",
      `template does not show the <file>::<test-name> form`,
    );
  }
  ok("test_ac_template_documents_verified_by_convention");
}

// ── Run all ────────────────────────────────────────────────────────
test_plan_contract_omits_goal_verification_field();
test_empty_justification_treated_as_missing();
test_regression_fixture_schema_parses();
test_valid_fixture_passes_and_empty_justification_fails();
test_paths_json_has_sprint_regression_corpus();
test_hookslib_paths_has_sprint_regression_corpus_in_lockstep();
test_ac_template_documents_verified_by_convention();

process.stdout.write(`\n# ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
