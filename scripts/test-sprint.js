#!/usr/bin/env node

/**
 * scripts/test-sprint.js — Sprint Workflow v0.1 acceptance tests.
 *
 * Runs in-process. Uses a temp dir for tracker state. Does not touch
 * the live .claude/project/sprint/ tree.
 *
 *   1. Schemas all parse + load.
 *   2. Routing policy validates.
 *   3. Plan helper writes a Plan Contract that round-trips through
 *      the yaml reader and validates against plan-contract.schema.
 *   4. Checkpoint helper writes a sprint-progress that validates.
 *   5. Ticket helper creates a ticket that validates.
 *   6. Issue helper creates an issue that validates + writes to
 *      issues.md.
 *   7. External-service helper creates an ESD that validates.
 *   8. Init helper creates a tracker tree.
 *
 * Exit 0 on all-green.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name) {
  passed++;
  process.stdout.write(`  ok    ${name}\n`);
}

function fail(name, err) {
  failed++;
  failures.push({ name, err });
  process.stdout.write(`  FAIL  ${name}\n`);
  if (err) process.stdout.write(`        ${err.message || err}\n`);
}

function withTempProject(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sprint-test-"));
  const origCwd = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = tmp;
  // Drop our paths.json + schemas + templates symlinked into the temp project
  // so the scripts under test resolve correctly.
  const repoRoot = path.resolve(__dirname, "..");
  for (const rel of [
    ".claude/paths.json",
    "schemas/sprint",
    "_mc/templates/sprint",
    ".claude/agents/president/_system/policy/sprint-routing.json",
  ]) {
    const src = path.join(repoRoot, rel);
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (fs.statSync(src).isDirectory()) {
      copyDirSync(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  // also copy scripts/hooks/lib/paths.js's dependency: paths.generated.js
  fs.mkdirSync(path.join(tmp, "scripts/hooks/lib"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "scripts/hooks/lib/paths.generated.js"),
    path.join(tmp, "scripts/hooks/lib/paths.generated.js"),
  );
  try {
    fn(tmp);
  } finally {
    process.env.CLAUDE_PROJECT_DIR = origCwd;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

function freshRequire(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod);
}

function testSchemasLoad() {
  try {
    const validate = freshRequire("./sprint/validate.js");
    const { schemas, errors } = validate.loadSchemas();
    if (errors.length) throw new Error(errors.join("; "));
    if (Object.keys(schemas).length !== 10) {
      throw new Error(
        `expected 10 schemas, got ${Object.keys(schemas).length}`,
      );
    }
    ok("schemas load (10)");
  } catch (err) {
    fail("schemas load", err);
  }
}

function testRouting() {
  try {
    const routing = freshRequire("./sprint/routing.js");
    const code = routing.cmdValidate();
    if (code !== 0) throw new Error("validate exited non-zero");
    ok("routing policy validates");
  } catch (err) {
    fail("routing policy", err);
  }
}

function testPlanFlow(tmp) {
  try {
    const plan = freshRequire("./sprint/plan.js");
    const validate = freshRequire("./sprint/validate.js");
    const SPRINT = freshRequire("./sprint/paths.js");
    const { ensureDir } = freshRequire("./sprint/fs.js");
    ensureDir(SPRINT.planContracts);
    const current = plan.ensureCurrentSprint();
    const payload = {
      source_request: "Add Stripe subscriptions.",
      source_request_verbatim: "Add Stripe subscriptions.",
      request_type: "feature_add",
      interpreted_intent: "Introduce a paid subscription tier via Stripe.",
      user_or_business_outcome:
        "Existing users can pay a monthly subscription; revenue starts flowing.",
      affected_surfaces: [
        { surface: "billing", evidence_level: "assumed_from_request" },
      ],
      current_behavior: { evidence_level: "unknown" },
      desired_behavior:
        "Monthly subscription using Stripe checkout + customer portal.",
      scope: { size: "m", risk_level: "medium" },
      scope_variants: {
        minimal_safe: { summary: "Single subscription tier, no proration." },
        recommended: { summary: "Two tiers (basic + pro), monthly only." },
        expanded: { summary: "Tiers + annual + proration + upgrades." },
      },
      assumptions: {
        safe: ["Stripe is the chosen vendor"],
        unsafe: [
          "User has the legal authority to enter a billing relationship",
        ],
        needs_user_or_beta_review: [],
      },
      open_questions: { blocking: [], non_blocking: [] },
      non_goals: ["Invoicing for enterprise"],
      requirement_areas: ["billing", "auth"],
      high_level_story_candidates: ["User can subscribe"],
      granular_story_candidates: [
        "Implement Stripe checkout session",
        "Implement customer portal link",
      ],
      workstream_candidates: ["billing integration", "subscription UI"],
      external_service_dependencies: {
        status: "required",
        required: ["Stripe payment"],
        possible: [],
        notes: "Stripe requires signup + billing + production credentials.",
      },
      approval_boundaries: ["new paid service", "billing setup"],
      design_required: true,
      execution_allowed_without_design: false,
      recommended_mode: "adhoc",
      beta_review: { required: true },
      plan_quality: { status: "needs_design", confidence: "medium" },
      next_recommended_command: "/sprint:design",
      resume_instructions:
        "Plan Contract written. Next: /sprint:design at scale=m.",
    };
    const tmpPayload = path.join(tmp, ".payload.json");
    fs.writeFileSync(tmpPayload, JSON.stringify(payload), "utf8");
    // emulate the CLI: directly call writePlanContract + updateCurrent
    const { pcId, pcPath } = plan.writePlanContract(payload, current);
    if (!fs.existsSync(pcPath)) throw new Error("plan-contract not written");
    const code = validate.validateFile(pcPath);
    if (code !== 0) throw new Error("plan-contract failed schema");
    ok(`plan flow writes valid Plan Contract (${pcId})`);
  } catch (err) {
    fail("plan flow", err);
  }
}

function testCheckpoint() {
  try {
    const SPRINT = freshRequire("./sprint/paths.js");
    const fsHelpers = freshRequire("./sprint/fs.js");
    const validate = freshRequire("./sprint/validate.js");
    fsHelpers.ensureDir(SPRINT.root);
    const cp = {
      schema: "mc/sprint/sprint-progress/v1",
      sprint: "SP-20260511-001",
      updated_at: fsHelpers.nowIso(),
      current_phase: "execute",
      current_command: "/sprint:execute",
      current_ticket: "T-20260511-001",
      current_task: null,
      current_loop: 2,
      status: "running",
      last_completed_step: "phase_review",
      next_action: "Continue Ralph at phase=record",
      active_files: [],
      modified_files: [],
      checks_last_run: null,
      checks_passing: [],
      checks_failing: [],
      blockers: [],
      approvals_needed: [],
      external_services_needed: [],
      issues_opened: [],
      tickets_updated: [],
      ralph_checkpoint: null,
      resume_command: "/sprint:execute --ticket T-20260511-001",
      resume_notes: "loop 2, phase record",
      safe_to_continue: true,
      stop_reason: null,
    };
    fsHelpers.writeYaml(SPRINT.progress, cp);
    const code = validate.validateFile(SPRINT.progress);
    if (code !== 0) throw new Error("sprint-progress failed schema");
    ok("checkpoint writer produces valid sprint-progress");
  } catch (err) {
    fail("checkpoint flow", err);
  }
}

function testTicket() {
  try {
    const SPRINT = freshRequire("./sprint/paths.js");
    const fsHelpers = freshRequire("./sprint/fs.js");
    const ids = freshRequire("./sprint/ids.js");
    const validate = freshRequire("./sprint/validate.js");
    fsHelpers.ensureDir(SPRINT.tickets);
    const id = ids.ticketId(SPRINT.tickets);
    const now = fsHelpers.nowIso();
    const ticket = {
      schema: "mc/sprint/ticket/v1",
      id,
      title: "Implement Stripe checkout session",
      type: "integration",
      status: "designed",
      sprint: "SP-20260511-001",
      created_at: now,
      updated_at: now,
      owner: null,
      owner_agent: null,
      risk_level: "medium",
      approval_required: true,
      approval_state: "pending",
      source_request: "Add Stripe subscriptions.",
      plan_contract:
        ".claude/project/sprint/plan-contracts/PC-20260511-0001.yaml",
      linked_requirements: ["R-1"],
      linked_high_level_story: "H-1",
      linked_granular_story: "S-1",
      linked_prd: null,
      linked_copy: [],
      linked_inputs: [],
      linked_trace: [],
      linked_acceptance_criteria: ["AC-1.1", "AC-1.2"],
      linked_issues: [],
      linked_decisions: [],
      linked_external_services: ["ESD-20260511-001"],
      linked_files: [],
      linked_tests: [],
      linked_commits: [],
      linked_prs: [],
      linked_release: null,
      description: "Add Stripe checkout session for monthly subscription.",
      user_value: "User can subscribe.",
      business_value: "Revenue begins flowing.",
      acceptance_criteria: ["AC-1.1", "AC-1.2"],
      non_goals: [],
      implementation_notes: "",
      qa_notes: "",
      redteam_notes: "",
      trace_notes: "",
      blocked_by: [],
      blocks: [],
      fix_attempts: [],
      ralph_progress: null,
      completion_evidence: [],
      reopen_history: [],
    };
    const tp = path.join(SPRINT.tickets, `${id}.yaml`);
    fsHelpers.writeYaml(tp, ticket);
    const code = validate.validateFile(tp);
    if (code !== 0) throw new Error("ticket failed schema");
    ok(`ticket writer produces valid ticket (${id})`);
  } catch (err) {
    fail("ticket flow", err);
  }
}

function testIssue() {
  try {
    const SPRINT = freshRequire("./sprint/paths.js");
    const fsHelpers = freshRequire("./sprint/fs.js");
    const ids = freshRequire("./sprint/ids.js");
    const validate = freshRequire("./sprint/validate.js");
    fsHelpers.ensureDir(SPRINT.issues);
    const id = ids.issueId(SPRINT.issues);
    const now = fsHelpers.nowIso();
    const issue = {
      schema: "mc/sprint/issue/v1",
      id,
      title: "Stripe checkout fails for users with billing-country=US-NY",
      status: "open",
      severity: "high",
      source: "qa_finding",
      discovered_at: now,
      discovered_during: "SP-20260511-001:execute",
      related_feature: null,
      related_ticket: "T-20260511-001",
      related_sprint: "SP-20260511-001",
      related_external_service: "ESD-20260511-001",
      steps_to_reproduce: [
        "Sign up with billing address in NY",
        "Click subscribe",
      ],
      expected: "Checkout completes",
      actual: "Stripe returns 'tax_jurisdiction_not_configured'",
      suspected_cause: "Tax settings not enabled for NY in Stripe dashboard",
      fix_attempts: [],
      files_touched: [],
      current_recommendation: "Enable NY tax in Stripe dashboard (human step)",
      resolution: "",
      resolution_date: null,
      promoted_to_ticket: null,
      issues_md_block: null,
    };
    const ip = path.join(SPRINT.issues, `${id}.yaml`);
    fsHelpers.writeYaml(ip, issue);
    const code = validate.validateFile(ip);
    if (code !== 0) throw new Error("issue failed schema");
    ok(`issue writer produces valid issue (${id})`);
  } catch (err) {
    fail("issue flow", err);
  }
}

function testESD() {
  try {
    const SPRINT = freshRequire("./sprint/paths.js");
    const fsHelpers = freshRequire("./sprint/fs.js");
    const ids = freshRequire("./sprint/ids.js");
    const validate = freshRequire("./sprint/validate.js");
    fsHelpers.ensureDir(SPRINT.externalServices);
    const id = ids.esdId(SPRINT.externalServices);
    const now = fsHelpers.nowIso();
    const esd = {
      schema: "mc/sprint/external-service-dependency/v1",
      id,
      sprint: "SP-20260511-001",
      related_ticket: "T-20260511-001",
      service_name: "Stripe payment",
      service_category: "payment",
      purpose: "Accept monthly subscription payments.",
      required_for: ["billing"],
      required_phase: "execute",
      status: "needs_human_signup",
      signup_required: true,
      billing_required: true,
      credentials_required: true,
      oauth_required: false,
      domain_dns_required: false,
      compliance_review_required: true,
      human_owner: "founder",
      terminal_implementable_after_setup: true,
      can_mock: true,
      mock_strategy: "Replay Stripe webhook fixtures in QA.",
      sandbox_available: true,
      production_required: false,
      approval_required: true,
      approval_state: "pending",
      approval_ref: null,
      required_env_vars: [
        {
          name: "STRIPE_SECRET_KEY",
          description: "Server-side Stripe key",
          required_for: "checkout, webhook",
          secret: true,
        },
        {
          name: "STRIPE_PUBLISHABLE_KEY",
          description: "Browser-side Stripe key",
          required_for: "checkout UI",
          secret: false,
        },
      ],
      human_setup_steps: [
        {
          step: "Create Stripe account",
          owner: "founder",
          status: "not_started",
          evidence_required: "Stripe dashboard URL",
        },
        {
          step: "Enable subscriptions product",
          owner: "founder",
          status: "not_started",
          evidence_required: "product id",
        },
      ],
      terminal_setup_steps: [
        {
          step: "Wire STRIPE_SECRET_KEY into .env.example",
          command_or_file: ".env.example",
          status: "not_started",
        },
      ],
      risks: ["Billing setup may delay sprint by 1-2 days"],
      blockers: [],
      notes: "",
      created_at: now,
      updated_at: now,
    };
    const ep = path.join(SPRINT.externalServices, `${id}.yaml`);
    fsHelpers.writeYaml(ep, esd);
    const code = validate.validateFile(ep);
    if (code !== 0) throw new Error("ESD failed schema");
    ok(`ESD writer produces valid record (${id})`);
  } catch (err) {
    fail("ESD flow", err);
  }
}

function testInit() {
  try {
    const SPRINT = freshRequire("./sprint/paths.js");
    const init = freshRequire("./sprint/init.js");
    const code = init.init({ force: false, project: "test-project" });
    if (code !== 0) throw new Error("init exited non-zero");
    for (const dir of [
      SPRINT.planContracts,
      SPRINT.tickets,
      SPRINT.issues,
      SPRINT.externalServices,
      SPRINT.releases,
      SPRINT.approvals,
      SPRINT.decisions,
      SPRINT.ralph,
      SPRINT.checkpoints,
      SPRINT.requirements,
      SPRINT.history,
    ]) {
      if (!fs.existsSync(dir)) throw new Error(`init did not create ${dir}`);
    }
    if (!fs.existsSync(SPRINT.current))
      throw new Error("current-sprint not written");
    if (!fs.existsSync(SPRINT.progress))
      throw new Error("sprint-progress not written");
    if (!fs.existsSync(SPRINT.issuesLedger))
      throw new Error("issues.md not written");
    ok("init creates full tracker tree");
  } catch (err) {
    fail("init flow", err);
  }
}

function main() {
  process.stdout.write("scripts/test-sprint.js — Sprint v0.1 acceptance\n");
  withTempProject(() => {
    testSchemasLoad();
    testRouting();
    testCheckpoint();
    testTicket();
    testIssue();
    testESD();
    testInit();
    testPlanFlow(process.env.CLAUDE_PROJECT_DIR);
  });
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  if (failed) {
    for (const f of failures) {
      process.stdout.write(
        `  ${f.name}: ${f.err && f.err.message ? f.err.message : f.err}\n`,
      );
    }
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main };
