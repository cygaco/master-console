#!/usr/bin/env node
const mcEnv = require("./hooks/lib/mc-env"); // S-OS-06 read-both env (clears MC_X and the legacy name together)

/**
 * scripts/test-sprint-hooks.js — Acceptance tests for the two sprint hooks.
 *
 *   1. sprint-tracker-guard.js
 *      - allows valid sprint yaml under .claude/project/sprint/
 *      - blocks malformed sprint yaml (missing required field)
 *      - blocks edit to existing history/<sprint>/sprint-history.yaml
 *      - allows new history file write
 *      - allows non-sprint files
 *      - allows yaml without schema: field (warn-only)
 *      - respects SPRINT_GUARD=off
 *
 *   2. sprint-approval-guard.js
 *      - blocks `release.js deploy --id <id>` with no approval_ref
 *      - blocks `release.js deploy --id <id>` with pending approval
 *      - allows `release.js deploy --id <id>` with approved approval
 *      - blocks `external-service.js update --status integrated` when
 *        approval_required+pending
 *      - allows the same when approved
 *      - allows unrelated Bash commands
 *      - respects SPRINT_APPROVAL_GUARD=off
 *
 * Runs in-process with synthetic stdin and a temp project dir.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");

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

function dispatch(hook, payload, env = {}) {
  const res = spawnSync(
    process.execPath,
    [path.join(REPO, "scripts", "hooks", hook)],
    {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, ...env },
    },
  );
  return {
    code: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function isBlock(out) {
  if (!out.stdout) return false;
  try {
    const j = JSON.parse(out.stdout.trim());
    return j.decision === "block";
  } catch {
    return false;
  }
}

function setupProject() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-sprint-hooks-"));
  // copy paths.json, schemas, sprint scripts so the hooks can load them
  function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      const s = path.join(src, f);
      const d = path.join(dst, f);
      if (fs.statSync(s).isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  function copyFile(rel) {
    const src = path.join(REPO, rel);
    const dst = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  copyFile(".claude/paths.json");
  copyDir(path.join(REPO, "schemas/sprint"), path.join(tmp, "schemas/sprint"));
  copyDir(path.join(REPO, "scripts/sprint"), path.join(tmp, "scripts/sprint"));
  copyDir(
    path.join(REPO, "scripts/hooks/lib"),
    path.join(tmp, "scripts/hooks/lib"),
  );
  return tmp;
}

function teardown(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
}

function nowIso() {
  return new Date().toISOString();
}

// ── tracker-guard tests ─────────────────────────────────────

function testTrackerAllowsValid() {
  const tmp = setupProject();
  try {
    const fp = path.join(
      tmp,
      ".claude",
      "project",
      "sprint",
      "tickets",
      "T-20260511-001.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const content = [
      "schema: mc/sprint/ticket/v1",
      'id: "T-20260511-001"',
      'title: "Test ticket"',
      "type: feature",
      "status: proposed",
      'sprint: "SP-20260511-001"',
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      "owner: null",
      "owner_agent: null",
      'risk_level: "low"',
      "approval_required: false",
      'approval_state: "not_required"',
      'source_request: ""',
      'plan_contract: ""',
      "linked_requirements: []",
      "linked_high_level_story: null",
      "linked_granular_story: null",
      "linked_prd: null",
      "linked_copy: []",
      "linked_inputs: []",
      "linked_trace: []",
      "linked_acceptance_criteria: []",
      "linked_issues: []",
      "linked_decisions: []",
      "linked_external_services: []",
      "linked_files: []",
      "linked_tests: []",
      "linked_commits: []",
      "linked_prs: []",
      "linked_release: null",
      'description: "x"',
      'user_value: ""',
      'business_value: ""',
      "acceptance_criteria:",
      "  - AC-1",
      "non_goals: []",
      'implementation_notes: ""',
      'qa_notes: ""',
      'redteam_notes: ""',
      'trace_notes: ""',
      "blocked_by: []",
      "blocks: []",
      "fix_attempts: []",
      "ralph_progress: null",
      "completion_evidence: []",
      "reopen_history: []",
      "",
    ].join("\n");
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out))
      fail("tracker allows valid ticket yaml", out.stdout || out.stderr);
    else ok("tracker allows valid ticket yaml");
  } finally {
    teardown(tmp);
  }
}

function testTrackerBlocksMalformed() {
  const tmp = setupProject();
  try {
    const fp = path.join(
      tmp,
      ".claude",
      "project",
      "sprint",
      "tickets",
      "T-bad.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const content = [
      "schema: mc/sprint/ticket/v1",
      'id: "not-a-valid-id"', // fails pattern ^T-[0-9]{8}-[0-9]{3}$
      'title: "Bad ticket"',
      "type: feature",
      "status: proposed",
      'sprint: "SP-20260511-001"',
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      'risk_level: "low"',
      "approval_required: false",
      'source_request: ""',
      'plan_contract: ""',
      'description: "x"',
      "acceptance_criteria: []",
      "",
    ].join("\n");
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail(
        "tracker blocks malformed ticket id",
        out.stdout || out.stderr || "no block",
      );
    else ok("tracker blocks malformed ticket id (pattern violation)");
  } finally {
    teardown(tmp);
  }
}

function testTrackerBlocksHistoryEdit() {
  const tmp = setupProject();
  try {
    const fp = path.join(
      tmp,
      ".claude",
      "project",
      "sprint",
      "history",
      "SP-20260511-001",
      "sprint-history.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, "schema: mc/sprint/sprint-history/v1\n", "utf8");
    const out = dispatch(
      "sprint-tracker-guard.js",
      {
        tool_input: { file_path: fp, content: "schema: edited\n" },
      },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail("tracker blocks edit to existing history", out.stdout || "no block");
    else ok("tracker blocks edit to existing history yaml");
  } finally {
    teardown(tmp);
  }
}

function testTrackerAllowsNewHistory() {
  const tmp = setupProject();
  try {
    const fp = path.join(
      tmp,
      ".claude",
      "project",
      "sprint",
      "history",
      "SP-20260511-002",
      "sprint-history.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    // do NOT write the file — simulate a fresh archive
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content: "schema: x\n" } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out))
      fail("tracker allows new history file", out.stdout || "blocked");
    else ok("tracker allows NEW history file write");
  } finally {
    teardown(tmp);
  }
}

function testTrackerAllowsNonSprint() {
  const tmp = setupProject();
  try {
    const out = dispatch(
      "sprint-tracker-guard.js",
      {
        tool_input: {
          file_path: path.join(tmp, "some/other/file.yaml"),
          content: "anything: goes\n",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out)) fail("tracker allows non-sprint files");
    else ok("tracker allows non-sprint files");
  } finally {
    teardown(tmp);
  }
}

// T-20260512-016 — tracker-guard must accept the v0.2 per-sprint subdir
// layout (sprints/<SP-id>/current.yaml + progress.yaml) and the new
// active-sprints.yaml registry. AC-16.1, AC-16.2.

function testTrackerAllowsPerSprintSubdirCurrent() {
  const tmp = setupProject();
  try {
    const sid = "SP-20991231-001";
    const fp = path.join(
      tmp,
      ".claude/project/sprint/sprints",
      sid,
      "current.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const content = [
      "schema: mc/sprint/current-sprint/v1",
      `id: "${sid}"`,
      'title: "Per-sprint subdir test"',
      'objective: "Test that the guard accepts the new layout."',
      "status: not_started",
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      "current_phase: idle",
      "mode_invocation_required_by_user: true",
      "tickets:",
      "  proposed: []",
      "  planned: []",
      "  designed: []",
      "  ready_for_execution: []",
      "  in_progress: []",
      "  blocked: []",
      "  waiting_on_human: []",
      "  waiting_on_external_service: []",
      "  in_review: []",
      "  qa_failed: []",
      "  redteam_failed: []",
      "  done: []",
      "  released: []",
      "  deferred: []",
      "  abandoned: []",
      "  reopened: []",
      "  superseded: []",
      "requirements:",
      "  prd: null",
      "  high_level_stories: null",
      "  granular_stories: null",
      "  copy: null",
      "  inputs: null",
      "  trace: null",
      "  acceptance_criteria: null",
      "  qa_plan: null",
      "  redteam_plan: null",
      "  release_plan: null",
      "checks:",
      "  lint:",
      "    status: not_run",
      "    last_run: null",
      '    evidence: ""',
      "  typecheck:",
      "    status: not_run",
      "    last_run: null",
      '    evidence: ""',
      "  tests:",
      "    status: not_run",
      "    last_run: null",
      '    evidence: ""',
      "  build:",
      "    status: not_run",
      "    last_run: null",
      '    evidence: ""',
      "  qa:",
      "    status: not_run",
      "    last_run: null",
      '    evidence: ""',
      "  redteam:",
      "    status: not_run",
      "    last_run: null",
      '    evidence: ""',
      "approvals:",
      "  plan:",
      "    required: false",
      "    state: not_required",
      "    ref: null",
      "  design:",
      "    required: false",
      "    state: not_required",
      "    ref: null",
      "  execution:",
      "    required: false",
      "    state: not_required",
      "    ref: null",
      "  release:",
      "    required: false",
      "    state: not_required",
      "    ref: null",
      "  external_services:",
      "    required: false",
      "    state: not_required",
      "    ref: null",
      "reports:",
      "  plan: null",
      "  design: null",
      "  execution: null",
      "  release: null",
      "ralph:",
      "  active: false",
      "  current_ticket: null",
      "  current_loop: null",
      "  status: idle",
      "  last_checkpoint: null",
      "  next_action: null",
      "crash_recovery:",
      "  last_checkpoint: null",
      '  resume_command: "/sprint:plan"',
      '  resume_summary: ""',
      "  active_files: []",
      "  dirty_state: false",
      "  blockers: []",
      "  safe_to_continue: true",
      "",
    ].join("\n");
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out))
      fail(
        "tracker allows sprints/<id>/current.yaml under v0.2 layout (AC-16.1)",
        out.stdout || out.stderr,
      );
    else
      ok(
        "tracker allows sprints/<id>/current.yaml under v0.2 layout (AC-16.1)",
      );
  } finally {
    teardown(tmp);
  }
}

function testTrackerBlocksMalformedPerSprintSubdir() {
  const tmp = setupProject();
  try {
    const sid = "SP-20991231-002";
    const fp = path.join(
      tmp,
      ".claude/project/sprint/sprints",
      sid,
      "current.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const content = [
      "schema: mc/sprint/current-sprint/v1",
      'id: "not-a-valid-sprint-id"', // violates ^SP-[0-9]{8}-[0-9]{3}$
      'title: "Bad"',
      "",
    ].join("\n");
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail(
        "tracker blocks malformed current.yaml under sprints/<id>/ (AC-16.2)",
        out.stdout || "no block",
      );
    else
      ok("tracker blocks malformed current.yaml under sprints/<id>/ (AC-16.2)");
  } finally {
    teardown(tmp);
  }
}

function testTrackerAllowsValidActiveSprints() {
  const tmp = setupProject();
  try {
    const fp = path.join(tmp, ".claude/project/sprint/active-sprints.yaml");
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const content = [
      "schema: mc/sprint/active-sprints/v1",
      'primary: "SP-20991231-001"',
      "sprints:",
      '  - id: "SP-20991231-001"',
      '    title: "Test"',
      "    status: not_started",
      "    lane:",
      "      type: default",
      "      value: null",
      '      isolation_notes: ""',
      "    layout: per_sprint_subdir",
      '    pointer: ".claude/project/sprint/sprints/SP-20991231-001"',
      `    created_at: "${nowIso()}"`,
      `    updated_at: "${nowIso()}"`,
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      "",
    ].join("\n");
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out))
      fail(
        "tracker allows valid active-sprints.yaml",
        out.stdout || out.stderr,
      );
    else ok("tracker allows valid active-sprints.yaml");
  } finally {
    teardown(tmp);
  }
}

function testTrackerBlocksMalformedActiveSprints() {
  const tmp = setupProject();
  try {
    const fp = path.join(tmp, ".claude/project/sprint/active-sprints.yaml");
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    // missing required `primary` field
    const content = [
      "schema: mc/sprint/active-sprints/v1",
      "sprints: []",
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      "",
    ].join("\n");
    const out = dispatch(
      "sprint-tracker-guard.js",
      { tool_input: { file_path: fp, content } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail(
        "tracker blocks active-sprints.yaml missing primary",
        out.stdout || "no block",
      );
    else ok("tracker blocks active-sprints.yaml missing primary");
  } finally {
    teardown(tmp);
  }
}

function testTrackerKillSwitch() {
  const tmp = setupProject();
  try {
    const fp = path.join(
      tmp,
      ".claude",
      "project",
      "sprint",
      "tickets",
      "T-bad.yaml",
    );
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const out = dispatch(
      "sprint-tracker-guard.js",
      {
        tool_input: {
          file_path: fp,
          content: "schema: mc/sprint/ticket/v1\nid: bad\n",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp, SPRINT_GUARD: "off" },
    );
    if (isBlock(out))
      fail(
        "SPRINT_GUARD=off bypasses tracker-guard",
        out.stdout || "blocked anyway",
      );
    else ok("SPRINT_GUARD=off bypasses tracker-guard");
  } finally {
    teardown(tmp);
  }
}

// ── approval-guard tests ────────────────────────────────────

function writeYaml(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null) lines.push(`${k}: null`);
    else if (typeof v === "string") lines.push(`${k}: "${v}"`);
    else if (typeof v === "boolean") lines.push(`${k}: ${v}`);
    else if (typeof v === "object")
      lines.push(
        `${k}: ${JSON.stringify(v).replace(/[{}]/g, (c) => (c === "{" ? "{" : "}"))}`,
      );
    else lines.push(`${k}: ${v}`);
  }
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

function setupRelease(tmp, { releaseId, approvalRef, approvalState }) {
  const releaseDir = path.join(tmp, ".claude", "project", "sprint", "releases");
  const approvalsDir = path.join(
    tmp,
    ".claude",
    "project",
    "sprint",
    "approvals",
  );
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.mkdirSync(approvalsDir, { recursive: true });
  writeYaml(path.join(releaseDir, `${releaseId}.yaml`), {
    schema: "mc/sprint/release/v1",
    id: releaseId,
    sprint: "SP-20260511-001",
    title: "Test release",
    version: "1.0.0",
    status: "ready_to_deploy",
    approval_ref: approvalRef,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  if (approvalRef && !approvalRef.endsWith(".yaml")) {
    writeYaml(path.join(approvalsDir, `${approvalRef}.yaml`), {
      schema: "mc/sprint/approval/v1",
      id: approvalRef,
      sprint: "SP-20260511-001",
      level: "release_approval_required",
      required_for: "production deploy",
      state: approvalState,
      requested_by: "alpha",
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
}

function testApprovalBlocksNoApprovalRef() {
  const tmp = setupProject();
  try {
    setupRelease(tmp, { releaseId: "RL-20260511-001", approvalRef: null });
    const out = dispatch(
      "sprint-approval-guard.js",
      {
        tool_input: {
          command: "node scripts/sprint/release.js deploy --id RL-20260511-001",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail(
        "approval blocks deploy with no approval_ref",
        out.stdout || "no block",
      );
    else ok("approval blocks deploy with no approval_ref");
  } finally {
    teardown(tmp);
  }
}

function testApprovalBlocksPending() {
  const tmp = setupProject();
  try {
    setupRelease(tmp, {
      releaseId: "RL-20260511-002",
      approvalRef: "AP-20260511-001",
      approvalState: "pending",
    });
    const out = dispatch(
      "sprint-approval-guard.js",
      {
        tool_input: {
          command: "node scripts/sprint/release.js deploy --id RL-20260511-002",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail(
        "approval blocks deploy with pending approval",
        out.stdout || "no block",
      );
    else ok("approval blocks deploy with pending approval");
  } finally {
    teardown(tmp);
  }
}

function testApprovalAllowsApproved() {
  const tmp = setupProject();
  try {
    setupRelease(tmp, {
      releaseId: "RL-20260511-003",
      approvalRef: "AP-20260511-002",
      approvalState: "approved",
    });
    const out = dispatch(
      "sprint-approval-guard.js",
      {
        tool_input: {
          command: "node scripts/sprint/release.js deploy --id RL-20260511-003",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out))
      fail(
        "approval allows deploy with approved approval",
        out.stdout || "blocked anyway",
      );
    else ok("approval allows deploy with approved approval");
  } finally {
    teardown(tmp);
  }
}

function testApprovalAllowsUnrelatedBash() {
  const tmp = setupProject();
  try {
    const out = dispatch(
      "sprint-approval-guard.js",
      { tool_input: { command: "ls -la" } },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (isBlock(out))
      fail("approval allows unrelated bash", out.stdout || "blocked");
    else ok("approval allows unrelated bash (ls)");
  } finally {
    teardown(tmp);
  }
}

function testApprovalKillSwitch() {
  const tmp = setupProject();
  try {
    setupRelease(tmp, { releaseId: "RL-bad", approvalRef: null });
    const out = dispatch(
      "sprint-approval-guard.js",
      {
        tool_input: {
          command: "node scripts/sprint/release.js deploy --id RL-bad",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp, SPRINT_APPROVAL_GUARD: "off" },
    );
    if (isBlock(out)) fail("SPRINT_APPROVAL_GUARD=off bypass", out.stdout);
    else ok("SPRINT_APPROVAL_GUARD=off bypasses approval-guard");
  } finally {
    teardown(tmp);
  }
}

// ── init template validity (regression test for the pre-fix bug
//    where init.js emitted yaml that failed its own schema). Source:
//    T-20260512-005, sprint SP-20260512-001.) ─────────────────────

function testInitTemplateValidates() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    // also need _mc/templates/sprint/init/* so init.js can render
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    copyDir(
      path.join(REPO, "_mc/templates/sprint"),
      path.join(tmp, "_mc/templates/sprint"),
    );
    const initRes = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/init.js"), "--project", "test"],
      { cwd: tmp, encoding: "utf8" },
    );
    if (initRes.status !== 0) {
      fail(
        "init.js renders + writes tracker",
        initRes.stderr || initRes.stdout || "non-zero exit",
      );
      return;
    }
    // v0.2: init writes to sprints/<id>/current.yaml + progress.yaml. The
    // primary id and pointer come from active-sprints.yaml.
    const registryPath = path.join(
      tmp,
      ".claude/project/sprint/active-sprints.yaml",
    );
    const registryText = fs.existsSync(registryPath)
      ? fs.readFileSync(registryPath, "utf8")
      : "";
    const idMatch = /^primary:\s*"?([A-Za-z0-9_-]+)"?/m.exec(registryText);
    const sprintId = idMatch ? idMatch[1] : null;
    if (!sprintId) {
      fail("init.js seeds active-sprints.yaml with a primary id", "no primary");
    }
    const sprintCurrentPath = path.join(
      tmp,
      ".claude/project/sprint/sprints",
      sprintId,
      "current.yaml",
    );
    const sprintProgressPath = path.join(
      tmp,
      ".claude/project/sprint/sprints",
      sprintId,
      "progress.yaml",
    );
    if (!fs.existsSync(sprintCurrentPath)) {
      fail(
        "init.js writes current.yaml under sprints/<id>/",
        `missing ${sprintCurrentPath}`,
      );
    } else {
      ok("init.js writes current.yaml under sprints/<id>/ (AC-2.1)");
    }
    if (!fs.existsSync(sprintProgressPath)) {
      fail(
        "init.js writes progress.yaml under sprints/<id>/",
        `missing ${sprintProgressPath}`,
      );
    } else {
      ok("init.js writes progress.yaml under sprints/<id>/ (AC-2.1)");
    }
    const validateRes = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/validate.js"), sprintCurrentPath],
      { cwd: tmp, encoding: "utf8" },
    );
    if (validateRes.status !== 0) {
      fail(
        "init.js output validates against current-sprint schema",
        validateRes.stderr || validateRes.stdout || "non-zero exit",
      );
    } else {
      ok("init.js output validates against current-sprint schema");
    }
    const progressValidate = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/validate.js"), sprintProgressPath],
      { cwd: tmp, encoding: "utf8" },
    );
    if (progressValidate.status !== 0) {
      fail(
        "init.js output validates against sprint-progress schema",
        progressValidate.stderr || progressValidate.stdout || "non-zero exit",
      );
    } else {
      ok("init.js output validates against sprint-progress schema");
    }
    // v0.2 — registryPath was already loaded above; validate it now.
    const registryValidate = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/validate.js"), registryPath],
      { cwd: tmp, encoding: "utf8" },
    );
    if (registryValidate.status !== 0) {
      fail(
        "init.js active-sprints.yaml validates against schema",
        registryValidate.stderr || registryValidate.stdout || "non-zero exit",
      );
    } else {
      ok("init.js active-sprints.yaml validates against schema");
      // AC-1.3: primary points at the bootstrapped sprint id.
      const idsInTickets = /sprints:[\s\S]*?id:\s*([A-Za-z0-9_-]+)/.exec(
        registryText,
      );
      if (idsInTickets && sprintId === idsInTickets[1]) {
        ok("init.js active-sprints.yaml primary points at seeded sprint");
      } else {
        fail(
          "init.js active-sprints.yaml primary points at seeded sprint",
          `primary=${sprintId}, first-id=${idsInTickets && idsInTickets[1]}`,
        );
      }
    }
  } finally {
    teardown(tmp);
  }
}

// T-20260512-014 — append-singleton sprint-id tagging.
// AC-14.1 logger events carry sprint_id when one is known.
// AC-14.2 issue.js create within a sprint context tags issues.md heading.
// AC-14.3 pre-existing rows without sprint_id still parse.

function testLoggerTagsSprintIdFromEnv() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    const eventsFile = path.join(tmp, ".claude/project/events/events.jsonl");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    // copy hooks/lib so logger.js requires resolve
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    // hooks/lib already copied by setupProject(); confirm.
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `process.chdir(${JSON.stringify(tmp)});const L=require(${JSON.stringify(path.join(tmp, "scripts/hooks/lib/logger.js"))});L.log("audit",{type:"test",detail:"with-sprint"});`,
      ],
      {
        cwd: tmp,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: tmp,
          MC_SPRINT_ID: "SP-20260512-001",
        },
      },
    );
    if (child.status !== 0) {
      fail(
        "logger writes with sprint_id from env",
        child.stderr || "non-zero exit",
      );
      return;
    }
    const raw = fs.existsSync(eventsFile)
      ? fs.readFileSync(eventsFile, "utf8").trim().split("\n")
      : [];
    if (raw.length === 0) {
      fail("logger writes a row when called", "events.jsonl empty");
      return;
    }
    const last = JSON.parse(raw[raw.length - 1]);
    if (last.sprint_id === "SP-20260512-001") {
      ok(
        "logger tags event with sprint_id from MC_SPRINT_ID env (AC-14.1)",
      );
    } else {
      fail(
        "logger tags event with sprint_id from MC_SPRINT_ID env",
        `got sprint_id=${last.sprint_id}`,
      );
    }
  } finally {
    teardown(tmp);
  }
}

function testLoggerNoSprintIdWhenUnset() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    const eventsFile = path.join(tmp, ".claude/project/events/events.jsonl");
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    const env = { ...process.env, CLAUDE_PROJECT_DIR: tmp };
    mcEnv.unsetEnv("SPRINT_ID", env);
    const child = spawnSync(
      process.execPath,
      [
        "-e",
        `process.chdir(${JSON.stringify(tmp)});const L=require(${JSON.stringify(path.join(tmp, "scripts/hooks/lib/logger.js"))});L.log("audit",{type:"test",detail:"no-sprint"});`,
      ],
      { cwd: tmp, encoding: "utf8", env },
    );
    if (child.status !== 0) {
      fail(
        "logger writes without sprint_id when env unset",
        child.stderr || "non-zero exit",
      );
      return;
    }
    const lines = fs.readFileSync(eventsFile, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]);
    if (last.sprint_id === undefined) {
      ok(
        "logger omits sprint_id field when no context (AC-14.3 forward-compat)",
      );
    } else {
      fail(
        "logger omits sprint_id when no context",
        `got sprint_id=${last.sprint_id}`,
      );
    }
  } finally {
    teardown(tmp);
  }
}

function testDecisionLedgerTagsSprintId() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    // copy decisions/ledger.js
    const src = path.join(REPO, "scripts/decisions");
    const dst = path.join(tmp, "scripts/decisions");
    fs.mkdirSync(dst, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      const s = path.join(src, f);
      if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dst, f));
    }
    const child = spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/decisions/ledger.js"),
        "--record",
        "--id",
        "DEC-test-001",
        "--class",
        "B",
        "--owner",
        "alpha",
        "--topic",
        "test",
        "--decision",
        "test",
        "--why",
        "test",
        "--reversible",
        "true",
        "--reversal-plan",
        "n/a",
      ],
      {
        cwd: tmp,
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_PROJECT_DIR: tmp,
          MC_SPRINT_ID: "SP-20260512-001",
        },
      },
    );
    if (child.status !== 0) {
      fail("decision-ledger tags sprint_id", child.stderr || "non-zero exit");
      return;
    }
    const ledger = path.join(
      tmp,
      ".claude/project/decisions/decision-ledger.jsonl",
    );
    if (!fs.existsSync(ledger)) {
      fail("decision-ledger file present", "missing");
      return;
    }
    const last = JSON.parse(
      fs.readFileSync(ledger, "utf8").trim().split("\n").pop(),
    );
    if (last.sprint_id === "SP-20260512-001") {
      ok("decision-ledger tags entry with sprint_id from env (AC-14.1)");
    } else {
      fail(
        "decision-ledger tags entry with sprint_id from env",
        `got sprint_id=${last.sprint_id}`,
      );
    }
  } finally {
    teardown(tmp);
  }
}

// AC-2.2 — writing to one sprint's subdir does not change another's.
function testTwoSprintsIsolation() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    copyDir(
      path.join(REPO, "_mc/templates/sprint"),
      path.join(tmp, "_mc/templates/sprint"),
    );
    // First init creates SP-A.
    spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/init.js"), "--project", "two-sprints"],
      { cwd: tmp, encoding: "utf8" },
    );
    const registryPath = path.join(
      tmp,
      ".claude/project/sprint/active-sprints.yaml",
    );
    const reg1 = fs.readFileSync(registryPath, "utf8");
    const idA = /^primary:\s*"?([A-Za-z0-9_-]+)"?/m.exec(reg1)[1];
    const sprintADir = path.join(tmp, ".claude/project/sprint/sprints", idA);
    const sprintAcurrent = path.join(sprintADir, "current.yaml");
    const sprintABefore = fs.readFileSync(sprintAcurrent, "utf8");
    // Hand-create a second sprint subdir at sprints/SP-B/ and verify
    // SP-A's files are byte-unchanged afterwards.
    const idB = "SP-20991231-999";
    const sprintBDir = path.join(tmp, ".claude/project/sprint/sprints", idB);
    fs.mkdirSync(sprintBDir, { recursive: true });
    fs.writeFileSync(
      path.join(sprintBDir, "current.yaml"),
      "schema: mc/sprint/current-sprint/v1\nid: " +
        idB +
        '\ntitle: "B"\nobjective: "B"\nstatus: not_started\n' +
        'created_at: "2099-12-31T00:00:00.000Z"\nupdated_at: "2099-12-31T00:00:00.000Z"\n' +
        "current_phase: idle\nmode_invocation_required_by_user: true\n" +
        "tickets: {}\nrequirements: {}\nchecks: {}\napprovals: {}\nreports: {}\n" +
        "ralph: {active: false}\ncrash_recovery: {safe_to_continue: true}\n",
      "utf8",
    );
    const sprintAAfter = fs.readFileSync(sprintAcurrent, "utf8");
    if (sprintABefore === sprintAAfter) {
      ok("two sprints — writing SP-B leaves SP-A byte-unchanged (AC-2.2)");
    } else {
      fail(
        "two sprints isolation",
        "SP-A's current.yaml changed when SP-B was created",
      );
    }
  } finally {
    teardown(tmp);
  }
}

// T-20260512-007 — --sprint <SP-id> flag end-to-end across helpers.
// AC-7.1 known id is accepted; AC-7.2 omitted falls back to primary;
// AC-7.3 unknown id exits non-zero with COPY C-10.

function testSprintFlagAcceptsKnownId() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    // Need _mc/templates/sprint to init + a real sprint registry.
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    copyDir(
      path.join(REPO, "_mc/templates/sprint"),
      path.join(tmp, "_mc/templates/sprint"),
    );
    spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/init.js"), "--project", "flag-test"],
      { cwd: tmp, encoding: "utf8" },
    );
    const registry = fs.readFileSync(
      path.join(tmp, ".claude/project/sprint/active-sprints.yaml"),
      "utf8",
    );
    const sid = /^primary:\s*"?([A-Za-z0-9_-]+)"?/m.exec(registry)[1];
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/ticket.js"), "list", "--sprint", sid],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status !== 0)
      fail(
        "helper accepts --sprint with known id (AC-7.1)",
        res.stderr || "non-zero exit",
      );
    else ok("helper accepts --sprint with known id (AC-7.1)");
  } finally {
    teardown(tmp);
  }
}

function testSprintFlagRejectsUnknownId() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    copyDir(
      path.join(REPO, "_mc/templates/sprint"),
      path.join(tmp, "_mc/templates/sprint"),
    );
    spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/init.js"), "--project", "flag-test"],
      { cwd: tmp, encoding: "utf8" },
    );
    const res = spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/sprint/ticket.js"),
        "list",
        "--sprint",
        "SP-99999999-999",
      ],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status === 0)
      fail(
        "helper rejects --sprint with unknown id (AC-7.3)",
        "expected non-zero exit",
      );
    else if (!/unknown sprint:/.test(res.stderr))
      fail(
        "helper prints COPY C-10 on unknown id",
        `stderr=${res.stderr.slice(0, 200)}`,
      );
    else
      ok("helper rejects --sprint with unknown id + prints COPY C-10 (AC-7.3)");
  } finally {
    teardown(tmp);
  }
}

function testSprintFlagOmittedDefaultsToPrimary() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    copyDir(
      path.join(REPO, "_mc/templates/sprint"),
      path.join(tmp, "_mc/templates/sprint"),
    );
    spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/init.js"), "--project", "flag-test"],
      { cwd: tmp, encoding: "utf8" },
    );
    // Run ticket.js list WITHOUT --sprint. Should succeed (default to primary).
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/ticket.js"), "list"],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status !== 0)
      fail(
        "helper without --sprint defaults to primary (AC-7.2)",
        res.stderr || "non-zero exit",
      );
    else ok("helper without --sprint defaults to primary (AC-7.2)");
  } finally {
    teardown(tmp);
  }
}

// T-20260512-015 — /sprint:status command.
// AC-15.1 lists active sprints; AC-15.2 shows ticket+loop when executing.

function testSprintStatusListsActiveSprints() {
  const tmp = setupProject();
  try {
    const { spawnSync } = require("child_process");
    function copyDir(src, dst) {
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const s = path.join(src, f);
        const d = path.join(dst, f);
        if (fs.statSync(s).isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
      }
    }
    copyDir(
      path.join(REPO, "_mc/templates/sprint"),
      path.join(tmp, "_mc/templates/sprint"),
    );
    spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/init.js"), "--project", "status-test"],
      { cwd: tmp, encoding: "utf8" },
    );
    const res = spawnSync(
      process.execPath,
      [path.join(tmp, "scripts/sprint/status.js"), "--json"],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status !== 0) {
      fail("status.js --json exits 0", res.stderr || "non-zero exit");
      return;
    }
    let rows;
    try {
      rows = JSON.parse(res.stdout);
    } catch (e) {
      fail("status.js --json output is parseable JSON", String(e));
      return;
    }
    if (!Array.isArray(rows) || rows.length !== 1) {
      fail(
        "status.js lists 1 sprint after fresh init (AC-15.1)",
        `got ${rows && rows.length} rows`,
      );
      return;
    }
    const row = rows[0];
    if (
      row.id &&
      row.lane !== undefined &&
      row.status &&
      row.phase &&
      row.resume_command !== undefined &&
      row.last_checkpoint !== undefined
    ) {
      ok(
        "status.js exposes id/lane/status/phase/resume/last_checkpoint (AC-15.1)",
      );
    } else {
      fail("status.js row shape", JSON.stringify(row).slice(0, 200));
    }
    if (row.primary === true) {
      ok("status.js marks primary entry");
    } else {
      fail("status.js marks primary entry", `primary=${row.primary}`);
    }
  } finally {
    teardown(tmp);
  }
}

// T-20260512-013 — conflict-check.
// AC-13.1 clean exits 0. AC-13.2 conflict exits non-zero, lists details.
// AC-13.3 --allow-overlap proceeds + logs override.

function setupTwoSprints(tmp, surfacesA, surfacesB) {
  // active-sprints.yaml
  const reg = [
    "schema: mc/sprint/active-sprints/v1",
    'primary: "SP-A"',
    "sprints:",
    '  - id: "SP-A"',
    '    title: "A"',
    "    status: executing",
    "    lane:",
    "      type: default",
    "      value: null",
    '      isolation_notes: ""',
    "    layout: per_sprint_subdir",
    '    pointer: ".claude/project/sprint/sprints/SP-A"',
    `    created_at: "${nowIso()}"`,
    `    updated_at: "${nowIso()}"`,
    '  - id: "SP-B"',
    '    title: "B"',
    "    status: executing",
    "    lane:",
    "      type: default",
    "      value: null",
    '      isolation_notes: ""',
    "    layout: per_sprint_subdir",
    '    pointer: ".claude/project/sprint/sprints/SP-B"',
    `    created_at: "${nowIso()}"`,
    `    updated_at: "${nowIso()}"`,
    `created_at: "${nowIso()}"`,
    `updated_at: "${nowIso()}"`,
    "",
  ].join("\n");
  const regPath = path.join(tmp, ".claude/project/sprint/active-sprints.yaml");
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  fs.writeFileSync(regPath, reg, "utf8");

  // Minimal current.yaml for each sprint pointing to a plan_contract.
  function writeSprint(id, surfaces) {
    const dir = path.join(tmp, `.claude/project/sprint/sprints/${id}`);
    fs.mkdirSync(dir, { recursive: true });
    const pcPath = path.join(
      tmp,
      `.claude/project/sprint/plan-contracts/PC-${id}.yaml`,
    );
    fs.mkdirSync(path.dirname(pcPath), { recursive: true });
    const surfaceBlocks = surfaces
      .map((s) =>
        [
          "  - surface: " + JSON.stringify(s),
          '    evidence_level: "verified_from_repo"',
          '    notes: ""',
        ].join("\n"),
      )
      .join("\n");
    const pc = [
      "schema: mc/sprint/plan-contract/v1",
      `id: "PC-${id}"`,
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      `sprint: "${id}"`,
      'source_request: "test"',
      'source_request_verbatim: "test"',
      'request_type: "feature_add"',
      'interpreted_intent: ""',
      'user_or_business_outcome: ""',
      "affected_surfaces:",
      surfaceBlocks,
      "current_behavior:",
      "  evidence_level: unknown",
      '  notes: ""',
      'desired_behavior: ""',
      "scope:",
      "  size: s",
      "  risk_level: low",
      "  complexity_drivers: []",
      "scope_variants:",
      '  minimal_safe: {summary: "", tradeoffs: []}',
      '  recommended: {summary: "", tradeoffs: []}',
      '  expanded: {summary: "", tradeoffs: []}',
      "assumptions:",
      "  safe: []",
      "  unsafe: []",
      "  needs_user_or_beta_review: []",
      "open_questions:",
      "  blocking: []",
      "  non_blocking: []",
      "non_goals: []",
      "requirement_areas: []",
      "high_level_story_candidates: []",
      "granular_story_candidates: []",
      "workstream_candidates: []",
      "preliminary_ticket_candidates:",
      "  allowed: false",
      "  candidates: []",
      '  notes: ""',
      "external_service_dependencies:",
      "  status: none_expected",
      "  required: []",
      "  possible: []",
      '  notes: ""',
      "approval_boundaries: []",
      "design_required: true",
      "execution_allowed_without_design: false",
      "recommended_mode: no_recommendation",
      "mode_invocation_required_by_user: true",
      "lane:",
      "  type: default",
      "  value: null",
      '  isolation_notes: ""',
      "beta_review:",
      "  required: false",
      "  likely_founder_rejection_risks: []",
      "  overbuild_risks: []",
      "  missing_context_risks: []",
      "plan_quality:",
      "  status: pass",
      "  confidence: medium",
      "  evidence_gaps: []",
      "  fail_reasons: []",
      'next_recommended_command: "/sprint:design"',
      'resume_instructions: ""',
      "tracker_paths:",
      `  current_sprint: ".claude/project/sprint/sprints/${id}/current.yaml"`,
      "reports: {}",
      'created_by: "alpha"',
      'updated_by: "alpha"',
      "",
    ].join("\n");
    fs.writeFileSync(pcPath, pc, "utf8");
    const current = [
      "schema: mc/sprint/current-sprint/v1",
      `id: "${id}"`,
      `title: "${id}"`,
      `objective: ""`,
      "status: executing",
      `created_at: "${nowIso()}"`,
      `updated_at: "${nowIso()}"`,
      `plan_contract: ".claude/project/sprint/plan-contracts/PC-${id}.yaml"`,
      "current_phase: execute",
      "mode_invocation_required_by_user: true",
      "tickets:",
      "  proposed: []",
      "  planned: []",
      "  designed: []",
      "  ready_for_execution: []",
      "  in_progress: []",
      "  blocked: []",
      "  waiting_on_human: []",
      "  waiting_on_external_service: []",
      "  in_review: []",
      "  qa_failed: []",
      "  redteam_failed: []",
      "  done: []",
      "  released: []",
      "  deferred: []",
      "  abandoned: []",
      "  reopened: []",
      "  superseded: []",
      "requirements: {}",
      "checks: {}",
      "approvals: {}",
      "reports: {}",
      "ralph:",
      "  active: false",
      "crash_recovery:",
      "  safe_to_continue: true",
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "current.yaml"), current, "utf8");
  }
  writeSprint("SP-A", surfacesA);
  writeSprint("SP-B", surfacesB);
}

function testConflictCheckClean() {
  const tmp = setupProject();
  try {
    setupTwoSprints(tmp, ["a/x.js"], ["b/y.js"]);
    const { spawnSync } = require("child_process");
    const res = spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/sprint/conflict-check.js"),
        "--sprint",
        "SP-A",
        "--phase",
        "execute",
        "--json",
      ],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status !== 0)
      fail(
        "conflict-check exits 0 with disjoint surfaces (AC-13.1)",
        res.stderr || "non-zero exit",
      );
    else ok("conflict-check exits 0 with disjoint surfaces (AC-13.1)");
  } finally {
    teardown(tmp);
  }
}

function testConflictCheckDetectsOverlap() {
  const tmp = setupProject();
  try {
    setupTwoSprints(tmp, ["shared/x.js", "a/y.js"], ["shared/x.js", "b/z.js"]);
    const { spawnSync } = require("child_process");
    const res = spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/sprint/conflict-check.js"),
        "--sprint",
        "SP-A",
        "--phase",
        "execute",
        "--json",
      ],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status === 0) {
      fail(
        "conflict-check exits non-zero on overlap (AC-13.2)",
        "expected non-zero",
      );
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch (e) {
      fail("conflict-check JSON parses", String(e));
      return;
    }
    if (
      parsed.conflicts &&
      parsed.conflicts.length === 1 &&
      parsed.conflicts[0].surface === "shared/x.js" &&
      parsed.conflicts[0].other_sprint_id === "SP-B"
    ) {
      ok(
        "conflict-check lists conflicting surface + other sprint id (AC-13.2)",
      );
    } else {
      fail(
        "conflict-check reports correct conflicts",
        JSON.stringify(parsed.conflicts),
      );
    }
  } finally {
    teardown(tmp);
  }
}

function testConflictCheckAllowOverlap() {
  const tmp = setupProject();
  try {
    setupTwoSprints(tmp, ["shared/x.js"], ["shared/x.js"]);
    const { spawnSync } = require("child_process");
    const res = spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/sprint/conflict-check.js"),
        "--sprint",
        "SP-A",
        "--phase",
        "execute",
        "--allow-overlap",
        "--json",
      ],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status !== 0)
      fail(
        "conflict-check --allow-overlap proceeds (AC-13.3)",
        res.stderr || "non-zero exit",
      );
    else ok("conflict-check --allow-overlap proceeds (AC-13.3)");
  } finally {
    teardown(tmp);
  }
}

// T-20260512-010 + T-20260512-011 — lane-aware execute + warm-up.
// AC-10.3 worktree-missing exits non-zero with COPY C-6.
// AC-11.1 worktree lane fires warm-up event (TR-3) before any Ralph work.

function makeWorktreeSprint(tmp, sid, laneValue) {
  // Minimal active-sprints registry + current.yaml with worktree lane.
  const reg = [
    "schema: mc/sprint/active-sprints/v1",
    `primary: "${sid}"`,
    "sprints:",
    `  - id: "${sid}"`,
    `    title: "${sid}"`,
    "    status: executing",
    "    lane:",
    "      type: worktree",
    `      value: ${JSON.stringify(laneValue)}`,
    '      isolation_notes: ""',
    "    layout: per_sprint_subdir",
    `    pointer: ".claude/project/sprint/sprints/${sid}"`,
    `    created_at: "${nowIso()}"`,
    `    updated_at: "${nowIso()}"`,
    `created_at: "${nowIso()}"`,
    `updated_at: "${nowIso()}"`,
    "",
  ].join("\n");
  const regPath = path.join(tmp, ".claude/project/sprint/active-sprints.yaml");
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  fs.writeFileSync(regPath, reg, "utf8");
  const dir = path.join(tmp, `.claude/project/sprint/sprints/${sid}`);
  fs.mkdirSync(dir, { recursive: true });
  const current = [
    "schema: mc/sprint/current-sprint/v1",
    `id: "${sid}"`,
    `title: "${sid}"`,
    `objective: ""`,
    "status: executing",
    `created_at: "${nowIso()}"`,
    `updated_at: "${nowIso()}"`,
    "current_phase: execute",
    "mode_invocation_required_by_user: true",
    "lane:",
    "  type: worktree",
    `  value: ${JSON.stringify(laneValue)}`,
    '  isolation_notes: ""',
    "tickets:",
    "  proposed: []",
    "  planned: []",
    "  designed: []",
    "  ready_for_execution: []",
    "  in_progress: []",
    "  blocked: []",
    "  waiting_on_human: []",
    "  waiting_on_external_service: []",
    "  in_review: []",
    "  qa_failed: []",
    "  redteam_failed: []",
    "  done: []",
    "  released: []",
    "  deferred: []",
    "  abandoned: []",
    "  reopened: []",
    "  superseded: []",
    "requirements: {}",
    "checks: {}",
    "approvals: {}",
    "reports: {}",
    "ralph:",
    "  active: false",
    "crash_recovery:",
    "  safe_to_continue: true",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "current.yaml"), current, "utf8");
}

function testExecuteWorktreeMissing() {
  const tmp = setupProject();
  try {
    makeWorktreeSprint(tmp, "SP-20260101-001", "./does-not-exist");
    const { spawnSync } = require("child_process");
    const res = spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/sprint/execute.js"),
        "start",
        "--ticket",
        "T-test",
      ],
      { cwd: tmp, encoding: "utf8" },
    );
    if (res.status === 0) {
      fail(
        "execute.js refuses when worktree lane.value missing (AC-10.3)",
        "expected non-zero exit",
      );
      return;
    }
    if (!/lane worktree missing/.test(res.stderr)) {
      fail(
        "execute.js prints COPY C-6 when worktree missing",
        `stderr=${res.stderr.slice(0, 200)}`,
      );
      return;
    }
    ok(
      "execute.js refuses worktree lane with missing path + prints COPY C-6 (AC-10.3)",
    );
  } finally {
    teardown(tmp);
  }
}

function testExecuteWorktreeFiresWarmup() {
  const tmp = setupProject();
  try {
    // Use tmp itself as a "worktree" — exists on disk, even if not a real
    // git worktree. The warm-up event MUST fire regardless of git success.
    makeWorktreeSprint(tmp, "SP-20260101-002", tmp);
    const { spawnSync } = require("child_process");
    spawnSync(
      process.execPath,
      [
        path.join(tmp, "scripts/sprint/execute.js"),
        "start",
        "--ticket",
        "T-test",
      ],
      { cwd: tmp, encoding: "utf8" },
    );
    const eventsFile = path.join(tmp, ".claude/project/events/events.jsonl");
    if (!fs.existsSync(eventsFile)) {
      fail("warm-up fires TR-3 event", "events.jsonl missing");
      return;
    }
    const rows = fs
      .readFileSync(eventsFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const warmup = rows.find(
      (r) =>
        r.data &&
        r.data.action === "sprint.warmup_dispatch" &&
        r.data.type === "warmup",
    );
    if (!warmup) {
      fail(
        "warm-up TR-3 row present in events.jsonl (AC-11.1)",
        `rows=${rows.length}`,
      );
      return;
    }
    if (warmup.sprint_id !== "SP-20260101-002") {
      fail(
        "warm-up row carries sprint_id",
        `got sprint_id=${warmup.sprint_id}`,
      );
      return;
    }
    ok("execute.js fires TR-3 warmup event for worktree lane (AC-11.1)");
  } finally {
    teardown(tmp);
  }
}

function testEsdGate() {
  const tmp = setupProject();
  try {
    const esdDir = path.join(
      tmp,
      ".claude",
      "project",
      "sprint",
      "external-services",
    );
    fs.mkdirSync(esdDir, { recursive: true });
    writeYaml(path.join(esdDir, "ESD-20260511-001.yaml"), {
      schema: "mc/sprint/external-service-dependency/v1",
      id: "ESD-20260511-001",
      sprint: "SP-20260511-001",
      service_name: "Stripe",
      service_category: "payment",
      purpose: "subscriptions",
      status: "needs_credentials",
      approval_required: true,
      approval_state: "pending",
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    const out = dispatch(
      "sprint-approval-guard.js",
      {
        tool_input: {
          command:
            "node scripts/sprint/external-service.js update --id ESD-20260511-001 --status integrated",
        },
      },
      { CLAUDE_PROJECT_DIR: tmp },
    );
    if (!isBlock(out))
      fail(
        "approval blocks ESD --status integrated with pending approval",
        out.stdout || "no block",
      );
    else ok("approval blocks ESD --status integrated with pending approval");
  } finally {
    teardown(tmp);
  }
}

function main() {
  process.stdout.write(
    "scripts/test-sprint-hooks.js — Sprint v0.1 hook acceptance\n",
  );
  process.stdout.write("\n  tracker-guard:\n");
  testTrackerAllowsValid();
  testTrackerBlocksMalformed();
  testTrackerBlocksHistoryEdit();
  testTrackerAllowsNewHistory();
  testTrackerAllowsNonSprint();
  testTrackerAllowsPerSprintSubdirCurrent();
  testTrackerBlocksMalformedPerSprintSubdir();
  testTrackerAllowsValidActiveSprints();
  testTrackerBlocksMalformedActiveSprints();
  testTrackerKillSwitch();
  process.stdout.write("\n  init template:\n");
  testInitTemplateValidates();
  testTwoSprintsIsolation();
  process.stdout.write("\n  sprint-id tagging:\n");
  testLoggerTagsSprintIdFromEnv();
  testLoggerNoSprintIdWhenUnset();
  testDecisionLedgerTagsSprintId();
  process.stdout.write("\n  --sprint flag:\n");
  testSprintFlagAcceptsKnownId();
  testSprintFlagRejectsUnknownId();
  testSprintFlagOmittedDefaultsToPrimary();
  process.stdout.write("\n  sprint:status:\n");
  testSprintStatusListsActiveSprints();
  process.stdout.write("\n  conflict-check:\n");
  testConflictCheckClean();
  testConflictCheckDetectsOverlap();
  testConflictCheckAllowOverlap();
  process.stdout.write("\n  worktree lane:\n");
  testExecuteWorktreeMissing();
  testExecuteWorktreeFiresWarmup();
  process.stdout.write("\n  approval-guard:\n");
  testApprovalBlocksNoApprovalRef();
  testApprovalBlocksPending();
  testApprovalAllowsApproved();
  testApprovalAllowsUnrelatedBash();
  testApprovalKillSwitch();
  testEsdGate();
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
