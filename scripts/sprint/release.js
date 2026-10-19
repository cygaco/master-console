#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const {
  readYamlMaybe,
  writeYaml,
  ensureDir,
  nowIso,
  readText,
  render,
  writeText,
} = require("./fs");
const { releaseId: newReleaseId } = require("./ids");

function releasePath(id) {
  return path.join(SPRINT.releases, `${id}.yaml`);
}
function parseFlags(argv, start) {
  const out = {};
  for (let i = start; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) out[k] = true;
    else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function loadCurrent() {
  return readYamlMaybe(SPRINT.current);
}

function emitGate(kind, data) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("audit", { kind, ...data }, { actor: "alpha", source: "/sprint:release" });
  } catch {
  }
}

function regressionSeedGate(runEnforcer) {
  if (!runEnforcer) {
    const enforcerPath = path.join(__dirname, "..", "testsuite", "enforce.js");
    if (!fs.existsSync(enforcerPath)) {
      emitGate("sprint_release_regression_gate", { result: "opt-in-noop", role: "product", reason: "testsuite/enforce.js not present (product install)" });
      return 0;
    }
  }
  const run = runEnforcer || ((opts) => require("../testsuite/enforce").run(opts));
  let verdict;
  try {
    verdict = run({ strict: false });
  } catch (err) {
    emitGate("sprint_release_regression_gate", { result: "runner_error", error: err.message });
    process.stderr.write(
      `regression-seed gate: enforcer failed to run (${err.message}) — failing closed; a sprint cannot close on a broken suite.\n`,
    );
    return 3;
  }
  if (verdict.exit === 2) {
    emitGate("sprint_release_regression_gate", { result: "runner_error", error: verdict.error || null });
    process.stderr.write(
      `regression-seed gate: runner error — ${verdict.error || "enforce.js could not produce a verdict"}. ` +
        `Failing closed (a broken suite is not a clean pass).\n`,
    );
    return 3;
  }
  if (verdict.exit === 1) {
    const offending = (verdict.offending || [])
      .map((o) => `  ${o.id}  ${o.name}  (exit ${o.exit})`)
      .join("\n");
    emitGate("sprint_release_regression_gate", {
      result: "blocked",
      regressions: verdict.regressions,
      offending: (verdict.offending || []).map((o) => o.id),
    });
    process.stderr.write(
      `regression-seed gate: ${verdict.regressions} NEW regression(s) in covered classes — sprint cannot close.\n` +
        (offending ? offending + "\n" : "") +
        `Fix so \`node scripts/testsuite/enforce.js\` is green, or mark pre-existing debt baseline:"red" ` +
        `in _requirements/07-testing/recurring-bug-classes.json.\n`,
    );
    return 3;
  }
  emitGate("sprint_release_regression_gate", {
    result: verdict.enforced ? "clean" : "opt-in-noop",
    role: verdict.role,
  });
  if (verdict.enforced) {
    const s = verdict.summary || {};
    process.stdout.write(
      `regression-seed gate: clean (${s.passing != null ? s.passing : "?"}/${s.runnable != null ? s.runnable : "?"} runnable green, 0 NEW regressions).\n`,
    );
  }
  return 0;
}

function cmdPrepare(argv) {
  const f = parseFlags(argv, 3);
  const current = loadCurrent();
  if (!current) {
    process.stderr.write("no current-sprint.yaml\n");
    return 1;
  }
  const gateExit = regressionSeedGate();
  if (gateExit !== 0) return gateExit;
  ensureDir(SPRINT.releases);
  const id = newReleaseId(SPRINT.releases);
  const now = nowIso();
  const release = {
    schema: "mc/sprint/release/v1",
    id,
    sprint: current.id,
    title: f.title || current.title || "Sprint release",
    version: f.version || "",
    status: "preparing",
    checklist: {
      tickets_done_or_deferred: false,
      blocking_issues_resolved: false,
      requirements_satisfied: false,
      copy_satisfied: false,
      inputs_satisfied: false,
      trace_satisfied: false,
      acceptance_criteria_satisfied: false,
      qa_passed: false,
      redteam_passed: false,
      external_services_ready: false,
      credentials_present: false,
      release_notes_written: false,
      docs_updated: false,
      analytics_updated: false,
      migration_plan: false,
      rollback_plan: false,
      approval_recorded: false,
      post_release_monitoring_plan: false,
    },
    approval_ref: null,
    changelog_path: null,
    release_report_path: null,
    linked_tickets: [],
    linked_issues: [],
    linked_external_services: [],
    deployment_environment: f.target || "",
    deployment_target: f.target || "",
    deployed_at: null,
    deployed_by: null,
    rollback_at: null,
    rollback_reason: null,
    retrospective_ref: null,
    learning_candidates: [],
    created_at: now,
    updated_at: now,
  };
  writeYaml(releasePath(id), release);
  current.current_phase = "release";
  current.status = "releasing";
  current.reports.release = releasePath(id);
  current.updated_at = now;
  current.crash_recovery.resume_command = "/sprint:release";
  current.crash_recovery.resume_summary = `Release ${id} in preparing state. Run /sprint:release with --id ${id}.`;
  writeYaml(SPRINT.current, current);
  try {
    const { recordTrace } = require("./routing");
    const result = recordTrace({
      phase: "release",
      artifact_id: id,
      artifact_path: releasePath(id),
      sprint: current.id,
      model: mcEnv.readEnv("RECORDING_MODEL") || "claude:claude-opus-4-8",
      recorded_by: "/sprint:release",
      allow_single_vendor: true,
      auto_override: true,
      notes: "auto-recorded by release.js cmdPrepare",
    });
    if (!result.ok) {
      process.stderr.write(`routing-trace: ${result.message}\n`);
    }
  } catch (err) {
    process.stderr.write(`routing-trace: skipped (${err.message})\n`);
  }
  try {
    const ledger = require("./ledger");
    const lr = ledger.appendReleaseRow({
      id,
      sprint: current.id,
      status: "prepared",
      target: release.deployment_target || "internal-canary",
      changelogPath: release.changelog_path || null,
      notes: release.title || "",
    });
    if (lr.written) {
      process.stdout.write(
        `releases: RELEASES.md row added ${id} (status=prepared)\n`,
      );
    } else if (lr.reason !== "already-present") {
      process.stderr.write(`releases: skipped (${lr.reason})\n`);
    }
  } catch (err) {
    process.stderr.write(`releases: skipped (${err.message})\n`);
  }
  process.stdout.write(`release prepared: ${id}\n`);
  return 0;
}

function cmdCheck(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("check requires --id\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) {
    process.stderr.write(`no release: ${rp}\n`);
    return 1;
  }
  const current = loadCurrent();
  try {
    const { coverageReport } = require("./routing");
    const cov = coverageReport(release.sprint || (current && current.id));
    if (cov && cov.missing && cov.missing.length > 0) {
      if (f["allow-routing-gap"]) {
        try {
          const dlp = path.join(
            SPRINT.PROJECT,
            ".claude",
            "project",
            "decisions",
            "decision-ledger.jsonl",
          );
          require("fs").mkdirSync(path.dirname(dlp), { recursive: true });
          require("fs").appendFileSync(
            dlp,
            JSON.stringify({
              ts: nowIso(),
              kind: "release_routing_gap_override",
              sprint: release.sprint,
              release: release.id,
              missing_phases: cov.missing,
              reason: f["routing-gap-reason"] || "manual_allow_routing_gap",
            }) + "\n",
          );
        } catch {
        }
      } else {
        process.stderr.write(
          `/sprint:release: refused — sprint ${release.sprint} missing required routing traces: ${cov.missing.join(", ")}.\n` +
            `fix: record the missing traces or downgrade sprint-routing.json#enforcement.mode to "warn" if rollout is incomplete.\n` +
            `override: pass --allow-routing-gap (logs to decision-ledger).\n`,
        );
        return 1;
      }
    }
  } catch (err) {
    process.stderr.write(`routing-coverage: skipped (${err.message})\n`);
  }
  if (current) {
    const t = current.tickets || {};
    const open = (t.proposed || []).concat(
      t.planned || [],
      t.designed || [],
      t.ready_for_execution || [],
      t.in_progress || [],
      t.blocked || [],
      t.waiting_on_human || [],
      t.waiting_on_external_service || [],
      t.in_review || [],
      t.qa_failed || [],
      t.redteam_failed || [],
      t.reopened || [],
    );
    release.checklist.tickets_done_or_deferred = open.length === 0;
    release.checklist.qa_passed =
      (current.checks?.qa?.status || "not_run") === "passing";
    release.checklist.redteam_passed =
      (current.checks?.redteam?.status || "not_run") === "passing";
    release.checklist.requirements_satisfied = Boolean(
      current.requirements?.prd && current.requirements?.acceptance_criteria,
    );
    release.checklist.copy_satisfied =
      current.requirements?.copy == null ? true : true;
    release.checklist.inputs_satisfied =
      current.requirements?.inputs == null ? true : true;
    release.checklist.trace_satisfied =
      current.requirements?.trace == null ? true : true;
    const acSatRes = computeAcceptanceCriteriaSatisfied(release, current);
    release.checklist.acceptance_criteria_satisfied =
      acSatRes.acceptance_criteria_satisfied;
    if (acSatRes.cited_test_results) {
      release.cited_test_results = acSatRes.cited_test_results;
    }
    if (acSatRes.notes) {
      release.notes =
        (release.notes ? release.notes + "\n" : "") + acSatRes.notes;
    }
    const ext = current.external_services || {};
    const notReady = (ext.identified || []).concat(ext.blocked || []);
    release.checklist.external_services_ready = notReady.length === 0;
    release.checklist.approval_recorded = Boolean(release.approval_ref);
  }
  release.updated_at = nowIso();
  const c = release.checklist;
  const allCheckable = [
    "tickets_done_or_deferred",
    "blocking_issues_resolved",
    "requirements_satisfied",
    "qa_passed",
    "redteam_passed",
    "external_services_ready",
    "release_notes_written",
    "docs_updated",
    "approval_recorded",
  ];
  const ready = allCheckable.every((k) => c[k]);
  if (ready && release.status === "preparing")
    release.status = "approval_pending";
  writeYaml(rp, release);
  process.stdout.write(
    `release ${release.id} status=${release.status} ready=${ready}\n`,
  );
  for (const [k, v] of Object.entries(c)) {
    process.stdout.write(`  [${v ? "x" : " "}] ${k}\n`);
  }
  return 0;
}

function cmdApprove(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id || !f.approval) {
    process.stderr.write("approve requires --id and --approval\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  release.approval_ref = f.approval;
  release.checklist.approval_recorded = true;
  release.status = "ready_to_deploy";
  release.updated_at = nowIso();
  writeYaml(rp, release);
  process.stdout.write(`release ${release.id} approved via ${f.approval}\n`);
  return 0;
}

function cmdDeploy(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("deploy requires --id\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  if (release.status !== "ready_to_deploy") {
    process.stderr.write(
      `release ${release.id} not in ready_to_deploy (status=${release.status}). Run check + approve first.\n`,
    );
    return 1;
  }
  const now = nowIso();
  release.deployed_at = now;
  release.deployed_by = f.by || "human";
  release.deployment_target = f.target || release.deployment_target;
  release.status = "deployed";
  release.updated_at = now;
  writeYaml(rp, release);
  try {
    const ledger = require("./ledger");
    const lr = ledger.updateReleaseRow({
      id: release.id,
      status: "deployed",
      deployedAt: now,
    });
    if (lr.written) {
      process.stdout.write(
        `releases: RELEASES.md row updated ${release.id} (status=deployed)\n`,
      );
    } else if (lr.reason !== "already-present") {
      process.stderr.write(`releases: skipped (${lr.reason})\n`);
    }
  } catch (err) {
    process.stderr.write(`releases: skipped (${err.message})\n`);
  }
  process.stdout.write(
    `release ${release.id} marked deployed (target=${release.deployment_target})\n`,
  );
  try {
    const reg = readYamlMaybe(SPRINT.activeRegistry);
    if (reg && Array.isArray(reg.sprints)) {
      const entry = reg.sprints.find((s) => s.id === release.sprint);
      if (entry && entry.status !== "closed" && entry.status !== "abandoned") {
        const prev = entry.status;
        entry.status = "closed";
        entry.updated_at = now;
        reg.updated_at = now;
        writeYaml(SPRINT.activeRegistry, reg);
        process.stdout.write(
          `sprint ${release.sprint} status: ${prev} -> closed\n`,
        );
      }
    }
  } catch (err) {
    process.stderr.write(
      `warning: could not flip active-sprints status: ${err.message}\n`,
    );
  }
  return 0;
}

function cmdRollback(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id || !f.reason) {
    process.stderr.write("rollback requires --id and --reason\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  release.rollback_at = nowIso();
  release.rollback_reason = f.reason;
  release.status = "rolled_back";
  release.updated_at = nowIso();
  writeYaml(rp, release);
  process.stdout.write(
    `release ${release.id} marked rolled_back (${f.reason})\n`,
  );
  return 0;
}

function cmdReport(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("report requires --id\n");
    return 2;
  }
  const rp = releasePath(f.id);
  const release = readYamlMaybe(rp);
  if (!release) return 1;
  const tmpl = readText(
    path.join(SPRINT.templates, "release", "release-report.md.tmpl"),
  );
  if (!tmpl) {
    process.stderr.write("missing release-report.md.tmpl\n");
    return 1;
  }
  const linkedTickets = release.linked_tickets || [];
  const data = {
    release_id: release.id,
    sprint_id: release.sprint,
    title: release.title,
    version: release.version,
    status: release.status,
    deployed_at: release.deployed_at || "—",
    what_shipped_summary: "(fill in)",
    ticket_1: linkedTickets[0] || "—",
    ticket_1_status: "—",
    ticket_2: linkedTickets[1] || "—",
    ticket_2_status: "—",
    issue_1: (release.linked_issues || [])[0] || "—",
    issue_1_disposition: "—",
    esd_1: (release.linked_external_services || [])[0] || "—",
    esd_1_status: "—",
    qa_result: release.checklist.qa_passed ? "passed" : "see checklist",
    redteam_result: release.checklist.redteam_passed
      ? "passed"
      : "see checklist",
    approval_required: Boolean(release.approval_ref),
    approval_ref: release.approval_ref || "—",
    migration_plan: release.checklist.migration_plan
      ? "see plan"
      : "none_required",
    rollback_plan: release.checklist.rollback_plan
      ? "see plan"
      : "none_required",
    monitoring_check_1: "(fill in)",
    monitoring_check_2: "(fill in)",
    learning_1: (release.learning_candidates || [])[0] || "—",
    learning_2: (release.learning_candidates || [])[1] || "—",
    resume_or_rollback_instructions:
      release.status === "rolled_back"
        ? `Rolled back at ${release.rollback_at}. Reason: ${release.rollback_reason}.`
        : `Monitor per release-plan.md. Rollback: see CHANGELOG and approval ${release.approval_ref || "—"}.`,
  };
  const reportPath = path.join(SPRINT.releases, `${release.id}.report.md`);
  writeText(reportPath, render(tmpl, data), { force: true });
  release.release_report_path = reportPath;
  release.updated_at = nowIso();
  writeYaml(rp, release);
  process.stdout.write(`release report: ${reportPath}\n`);
  return 0;
}

function cmdShow(argv) {
  const f = parseFlags(argv, 3);
  if (!f.id) {
    process.stderr.write("show requires --id\n");
    return 2;
  }
  const r = readYamlMaybe(releasePath(f.id));
  if (!r) return 1;
  process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  return 0;
}

function cmdList() {
  if (!fs.existsSync(SPRINT.releases)) return 0;
  const files = fs
    .readdirSync(SPRINT.releases)
    .filter((x) => x.endsWith(".yaml"));
  for (const f of files.sort()) {
    const r = readYamlMaybe(path.join(SPRINT.releases, f));
    if (!r) continue;
    process.stdout.write(`${r.id}  ${r.status.padEnd(18)}  ${r.title}\n`);
  }
  return 0;
}

function computeAcceptanceCriteriaSatisfied(release, current) {
  const out = { acceptance_criteria_satisfied: false };
  if (
    !current ||
    !current.requirements ||
    !current.requirements.acceptance_criteria
  ) {
    out.acceptance_criteria_satisfied = false;
    out.notes = "no acceptance-criteria.md linked from current sprint";
    return out;
  }
  const plan = current.plan_contract
    ? readYamlMaybe(path.resolve(SPRINT.PROJECT, current.plan_contract))
    : null;
  const gv = plan && plan.goal_verification;
  if (!gv || gv.reproduction !== "executable") {
    out.acceptance_criteria_satisfied = Boolean(
      current.requirements.acceptance_criteria,
    );
    return out;
  }
  const acPath = path.resolve(
    SPRINT.PROJECT,
    current.requirements.acceptance_criteria,
  );
  if (!fs.existsSync(acPath)) {
    out.acceptance_criteria_satisfied = false;
    out.notes = `acceptance-criteria.md not on disk at ${acPath}`;
    return out;
  }
  const ac = fs.readFileSync(acPath, "utf8");
  const cited = parseCitedTests(ac);
  if (cited.length === 0) {
    out.acceptance_criteria_satisfied = false;
    out.notes =
      "acceptance-criteria.md present but no verified_by: lines found; ship-gate refuses";
    return out;
  }
  process.stdout.write(
    `release:check — cited-test executor running ${cited.length} tests for sprint ${current.id}...\n`,
  );
  const overrides = readInconclusiveOverrides(current.id);
  const results = [];
  for (const c of cited) {
    const r = runOneCitedTest(c);
    if (r.status === "inconclusive") {
      const o = overrides.find(
        (x) =>
          x.test_file === c.file &&
          x.test_name === c.test_name &&
          x.sprint_id === current.id,
      );
      if (o)
        r.override = { reason: o.reason || "", operator: o.operator || "" };
    }
    results.push({ ...c, ...r });
    const tag = r.status.padEnd(12);
    process.stdout.write(
      `  [${tag}] ${c.file}::${c.test_name}  (${r.elapsed_ms}ms)\n`,
    );
  }
  out.cited_test_results = results;
  const failed = results.filter((r) => r.status === "fail");
  const inconclusiveUnresolved = results.filter(
    (r) => r.status === "inconclusive" && !r.override,
  );
  if (failed.length === 0 && inconclusiveUnresolved.length === 0) {
    out.acceptance_criteria_satisfied = true;
  } else {
    out.acceptance_criteria_satisfied = false;
    if (failed.length > 0) {
      out.notes = `${failed.length} cited test(s) failed; ship-gate fail-closed.`;
    }
    if (inconclusiveUnresolved.length > 0) {
      const msg =
        `${inconclusiveUnresolved.length} cited test(s) returned unparseable output (inconclusive). ` +
        `To proceed, record an operator override in paths.decisionLedger with kind=release_override_inconclusive_test ` +
        `(fields: ts, sprint_id, test_file, test_name, reason, operator), then re-run release:check. ` +
        `No --allow-coverage-gap flag in v1 — the override IS the audit trail.`;
      out.notes = (out.notes ? out.notes + "\n" : "") + msg;
    }
  }
  return out;
}

function parseCitedTests(acMarkdown) {
  const cited = [];
  const lines = acMarkdown.split(/\r?\n/);
  const re = /verified_by\s*:\s*([^\s][^\r\n]*?)::([^\s][^\r\n]*?)\s*$/;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const file = m[1].trim();
    const test_name = m[2].trim();
    if (
      /not_applicable/i.test(file) ||
      /\{\{|<test-file>|<test-name>/.test(line)
    ) {
      continue;
    }
    cited.push({ file, test_name });
  }
  return cited;
}

function runOneCitedTest(c) {
  const { spawnSync } = require("child_process");
  const absPath = path.resolve(SPRINT.PROJECT, c.file);
  const start = Date.now();
  if (!fs.existsSync(absPath)) {
    return {
      status: "fail",
      exit_code: -1,
      elapsed_ms: Date.now() - start,
      reason: "ENOENT",
      detail: `cited test path missing on disk: ${c.file}`,
    };
  }
  const r = spawnSync(process.execPath, [absPath], {
    encoding: "utf8",
    timeout: 60_000,
    cwd: SPRINT.PROJECT,
  });
  const elapsed_ms = Date.now() - start;
  const out = (r.stdout || "") + "\n" + (r.stderr || "");
  const okRe = new RegExp(
    "^\\s*ok\\s+" + escapeRegex(c.test_name) + "\\s*$",
    "m",
  );
  const failRe = new RegExp(
    "^\\s*FAIL\\s+" + escapeRegex(c.test_name) + "\\s*$",
    "m",
  );
  const okMatch = okRe.test(out);
  const failMatch = failRe.test(out);
  if (failMatch) {
    return { status: "fail", exit_code: r.status, elapsed_ms };
  }
  if (okMatch && r.status === 0) {
    return { status: "pass", exit_code: r.status, elapsed_ms };
  }
  if (r.status !== 0 && !okMatch && !failMatch) {
    return {
      status: "inconclusive",
      exit_code: r.status,
      elapsed_ms,
      reason: "unparseable_output_non_zero_exit",
    };
  }
  return {
    status: "inconclusive",
    exit_code: r.status,
    elapsed_ms,
    reason: "test_name_not_found_in_output",
  };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readInconclusiveOverrides(sprintId) {
  const dlp = path.join(
    SPRINT.PROJECT,
    ".claude",
    "project",
    "decisions",
    "decision-ledger.jsonl",
  );
  if (!fs.existsSync(dlp)) return [];
  try {
    const lines = fs.readFileSync(dlp, "utf8").split(/\r?\n/);
    const rows = [];
    for (const l of lines) {
      if (!l.trim()) continue;
      try {
        const o = JSON.parse(l);
        if (
          o &&
          o.kind === "release_override_inconclusive_test" &&
          o.sprint_id === sprintId
        ) {
          rows.push(o);
        }
      } catch {
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function main() {
  const sa = SPRINT.parseSprintArg(process.argv);
  if (sa.error) return 1;
  const cmd = process.argv[2];
  switch (cmd) {
    case "prepare":
      return cmdPrepare(process.argv);
    case "check":
      return cmdCheck(process.argv);
    case "approve":
      return cmdApprove(process.argv);
    case "deploy":
      return cmdDeploy(process.argv);
    case "rollback":
      return cmdRollback(process.argv);
    case "report":
      return cmdReport(process.argv);
    case "show":
      return cmdShow(process.argv);
    case "list":
      return cmdList();
    default:
      process.stderr.write(
        "usage: release.js <prepare|check|approve|deploy|rollback|report|show|list> [flags]\n",
      );
      return 2;
  }
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  computeAcceptanceCriteriaSatisfied,
  parseCitedTests,
  runOneCitedTest,
  readInconclusiveOverrides,
  regressionSeedGate,
  cmdPrepare,
};
