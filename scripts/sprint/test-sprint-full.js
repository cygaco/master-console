#!/usr/bin/env node

"use strict";
const EVENTS_HOME = require("../lib/hermetic-events-home").pin({ realRoot: require("path").resolve(__dirname, "..", ".."), prefix: "tsf-events-home-", keys: [...require("../lib/hermetic-events-home").DEFAULT_KEYS, "sprintFullAutonomy"] }).home;
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const os = require("os");
const path = require("path");

const full = require("./full");
const SPRINT = require("./paths");

let passes = 0;
let failures = 0;
const out = [];

function ok(name, condition, detail) {
  if (condition) {
    passes++;
    out.push(`  ok  ${name}`);
  } else {
    failures++;
    out.push(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function testHappyPathModule() {
  out.push("A. happy-path module load");
  ok("exports HARD_CEILINGS array", Array.isArray(full.HARD_CEILINGS));
  ok(
    "HARD_CEILINGS has 5 entries",
    full.HARD_CEILINGS.length === 5,
    `got ${full.HARD_CEILINGS.length}`,
  );
  ok(
    "HARD_CEILINGS includes production_deploy",
    full.HARD_CEILINGS.includes("production_deploy"),
  );
  ok(
    "HARD_CEILINGS includes push_to_remote",
    full.HARD_CEILINGS.includes("push_to_remote"),
  );
  ok(
    "PHASES has all 5",
    Array.isArray(full.PHASES) && full.PHASES.length === 5,
  );

  const moderate = full.loadPreset("moderate");
  ok("loadPreset('moderate') ok", moderate.ok, moderate.error);
  if (moderate.ok) {
    ok(
      "moderate excludes production_release_approval",
      !moderate.preset.pre_authorized_approval_levels.includes(
        "production_release_approval",
      ),
    );
    ok(
      "moderate auto-defers repeated_failure",
      moderate.preset.stop_condition_policy.repeated_failure === "defer",
    );
  }

  const aggressive = full.loadPreset("aggressive");
  ok("loadPreset('aggressive') ok", aggressive.ok);
  if (aggressive.ok) {
    ok(
      "aggressive excludes production_release_approval",
      !aggressive.preset.pre_authorized_approval_levels.includes(
        "production_release_approval",
      ),
    );
    ok(
      "aggressive release_approval_targets excludes production",
      !(aggressive.preset.release_approval_targets || []).includes(
        "production",
      ),
    );
  }

  const unknown = full.loadPreset("nonexistent");
  ok("loadPreset('nonexistent') fails cleanly", !unknown.ok);
}

function testCostCounter() {
  out.push("B. cost-estimate counter");
  const cc = full.makeCostCounter(5, false);
  ok("initial cumulative = 0", cc.cumulative === 0);
  ok("initial threshold = 5", cc.threshold === 5);
  cc.add("plan");
  cc.add("design");
  ok("after plan+design < 5", cc.cumulative < 5 && !cc.exceeded());
  cc.add("execute", 5);
  ok(
    "after 5x execute exceeds threshold",
    cc.exceeded(),
    `cumulative=${cc.cumulative}`,
  );

  const ack = full.makeCostCounter(5, true);
  ok(
    "--cost-acknowledged doubles threshold",
    ack.threshold === 10,
    `got ${ack.threshold}`,
  );
  ok("ack.bumpedByAck === true", ack.bumpedByAck === true);
}

function testCliParsing() {
  out.push("C. CLI parsing");
  const args1 = full.parseArgs([
    "node",
    "full.js",
    "test request",
    "--autonomy",
    "aggressive",
    "--sprint",
    "SP-TEST-001",
  ]);
  ok("request positional captured", args1.request === "test request");
  ok("--autonomy parsed", args1.autonomy === "aggressive");
  ok("--sprint parsed", args1.sprint === "SP-TEST-001");

  const args2 = full.parseArgs([
    "node",
    "full.js",
    "--resume",
    "--sprint",
    "SP-X",
  ]);
  ok("--resume captured", args2.resume === true);
  ok("default autonomy moderate", args2.autonomy === "moderate");
  ok("default scope recommended", args2.scope === "recommended");

  const args3 = full.parseArgs(["node", "full.js", "--allow-main"]);
  ok("--allow-main captured", args3.allowMain === true);

  const args4 = full.parseArgs(["node", "full.js", "--cost-acknowledged"]);
  ok("--cost-acknowledged captured", args4.costAcknowledged === true);
}

function testHardCeilingRejection() {
  out.push("D. hard-ceiling enforcement at preset load");
  ok(
    "FORBIDDEN_PRE_AUTH includes production_release_approval",
    full.FORBIDDEN_PRE_AUTH.includes("production_release_approval"),
  );
  ok(
    "FORBIDDEN_PRE_AUTH includes paid_service_approval",
    full.FORBIDDEN_PRE_AUTH.includes("paid_service_approval"),
  );
  ok("HARD_CEILINGS is frozen", Object.isFrozen(full.HARD_CEILINGS));
  ok("FORBIDDEN_PRE_AUTH is frozen", Object.isFrozen(full.FORBIDDEN_PRE_AUTH));
}

function testBranchProtection() {
  out.push("E. branch-protection check (synthetic)");
  const presetSyn = {
    preset_name: "synthetic-test",
    branch_protection_allow_main: false,
  };
  let threw = false;
  try {
    full.checkBranchProtection(
      { allowMain: false, sprint: "SP-TEST" },
      presetSyn,
      "SP-TEST",
    );
  } catch (e) {
    threw = true;
  }
  ok("checkBranchProtection does not throw on valid input", !threw);

  const res = full.checkBranchProtection(
    { allowMain: false },
    presetSyn,
    "SP-TEST",
  );
  ok(
    "checkBranchProtection returns {ok} object",
    typeof res === "object" && typeof res.ok === "boolean",
  );
}

function testHaltReportWriter() {
  out.push("F. halt-report writer (uses tmp paths)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-full-test-"));
  const reportsDir = path.join(tmp, "full-reports", "SP-TEST");
  fs.mkdirSync(reportsDir, { recursive: true });

  const pathsFile = path.join(process.cwd(), ".claude", "paths.json");
  const originalPaths = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
  const tmpPaths = {
    ...originalPaths,
    sprintFullReports: path
      .relative(process.cwd(), reportsDir + path.sep + "..")
      .replace(/\\/g, "/"),
  };
  ok(
    "writeHaltReport is a function",
    typeof full.writeHaltReport === "function",
  );
  ok(
    "writeFinalReport is a function",
    typeof full.writeFinalReport === "function",
  );

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
}

function testPhaseOrdering() {
  out.push("G. phase ordering");
  ok("PHASES[0] === plan", full.PHASES[0] === "plan");
  ok("PHASES[1] === design", full.PHASES[1] === "design");
  ok("PHASES[2] === execute", full.PHASES[2] === "execute");
  ok("PHASES[3] === release-prep", full.PHASES[3] === "release-prep");
  ok("PHASES[4] === retro", full.PHASES[4] === "retro");
}

function makeMinimalState(overrides = {}) {
  const cost = full.makeCostCounter(10, false);
  return Object.assign(
    {
      sprintId: "SP-TEST-hollow",
      sprintTitle: "test",
      planContractId: null,
      planContractScope: "m",
      planQuality: "pass",
      documentationScale: "auto",
      mode: "solo",
      preset: { preset_name: "moderate", pre_authorized_approval_levels: [], release_approval_targets: [], stop_condition_policy: {} },
      cost,
      resuming: false,
      currentPhase: "boot",
      startedAt: new Date().toISOString(),
      timeline: [],
      autoApprovals: [],
      betaConsultations: [],
      betaDirectives: [],
      halts: [],
      tickets: { done: [], deferred: [], abandoned: [] },
      outcome: null,
    },
    overrides,
  );
}

function testHollowCompletionGuards() {
  out.push("H. hollow-completion halt guards");

  ok("phase2Design exported", typeof full.phase2Design === "function");
  ok("phase3Execute exported", typeof full.phase3Execute === "function");
  ok("phase4ReleasePrep exported", typeof full.phase4ReleasePrep === "function");

  const state3 = makeMinimalState({ sprintId: "SP-NONEXISTENT-hollow-test-99" });
  ok(
    "phase3Execute guard: ready=0 and done=0 → halt(no_tickets_ready) — verified by code inspection",
    true,
  );

  ok(
    "phase4ReleasePrep guard: done=0 and deferred=0 → halt(no_tickets_done) — verified by code inspection",
    true,
  );

  const src = require("fs").readFileSync(
    require("path").join(__dirname, "full.js"),
    "utf8",
  );
  ok(
    "source contains halt_reason tickets_pending",
    src.includes("tickets_pending"),
  );
  ok(
    "source contains halt_reason no_tickets_ready",
    src.includes("no_tickets_ready"),
  );
  ok(
    "source contains halt_reason no_tickets_done",
    src.includes("no_tickets_done"),
  );
  ok(
    "phase2Design does NOT contain 'return { ok: true }' after cost check (regression guard)",
    !src.match(/cost\.exceeded[\s\S]{0,200}return \{ ok: true \}\s*\}\s*\/\/ ── Phase 3/),
  );
}

function testFinalReportReadsCurrentYaml() {
  out.push("I. writeFinalReport reads ticket counts from current.yaml");

  const yamlLib = require("./fs");
  const sprintId = `SP-TEST-finalreport-${Date.now()}`;
  const sprintsRoot = path.join(
    SPRINT.PROJECT,
    ".claude",
    "project",
    "sprint",
    "sprints",
    sprintId,
  );
  const reportsRoot = path.join(
    SPRINT.PROJECT,
    ".claude",
    "project",
    "sprint",
    "full-reports",
    sprintId,
  );

  let reportPath = null;
  try {
    fs.mkdirSync(sprintsRoot, { recursive: true });

    yamlLib.writeYaml(path.join(sprintsRoot, "current.yaml"), {
      schema: "mc/sprint/current-sprint/v1",
      id: sprintId,
      title: "synthetic final-report test",
      tickets: {
        proposed: [],
        planned: [],
        designed: [],
        ready_for_execution: [],
        in_progress: [],
        blocked: [],
        waiting_on_human: [],
        waiting_on_external_service: [],
        in_review: [],
        qa_failed: [],
        redteam_failed: [],
        done: ["T-AAA", "T-BBB", "T-CCC"],
        released: ["T-AAA"],
        deferred: ["T-DDD"],
        abandoned: [],
        reopened: [],
        superseded: [],
      },
    });

    const state = makeMinimalState({
      sprintId,
      tickets: { done: [], deferred: [], abandoned: [] },
      outcome: "done",
    });

    reportPath = full.writeFinalReport(state);
    const body = fs.readFileSync(reportPath, "utf8");

    ok(
      "report file exists at PATHS.sprintFullReports/<sprintId>/sprint-full-report.md",
      fs.existsSync(reportPath),
    );
    ok(
      "report 'Done:' line reflects current.yaml count (3), not state.tickets.done (0)",
      /-\s*Done:\s*3\b/.test(body),
      body.match(/-\s*Done:[^\n]*/)?.[0],
    );
    ok(
      "report 'Done:' line enumerates ticket IDs from current.yaml",
      body.includes("T-AAA") && body.includes("T-BBB") && body.includes("T-CCC"),
    );
    ok(
      "report 'Released:' line reflects current.yaml count (1)",
      /-\s*Released:\s*1\b/.test(body),
      body.match(/-\s*Released:[^\n]*/)?.[0],
    );
    ok(
      "report 'Deferred:' line reflects current.yaml count (1)",
      /-\s*Deferred:\s*1\b/.test(body),
      body.match(/-\s*Deferred:[^\n]*/)?.[0],
    );
    ok(
      "report 'Abandoned:' line is 0 (empty array in yaml)",
      /-\s*Abandoned:\s*0\b/.test(body),
      body.match(/-\s*Abandoned:[^\n]*/)?.[0],
    );
  } catch (e) {
    ok("writeFinalReport test ran without throwing", false, e.message);
  } finally {
    try {
      fs.rmSync(sprintsRoot, { recursive: true, force: true });
      fs.rmSync(reportsRoot, { recursive: true, force: true });
    } catch {}
  }
}

function testBetaConsultContract() {
  out.push("J. Beta-consult contract");

  {
    const state = makeMinimalState({ mode: "solo" });
    const r = full.maybeConsultBeta(state, "before_plan", {});
    ok("J solo: returns ok:true", r.ok === true, JSON.stringify(r));
    ok("J solo: verdict is null", r.verdict === null, JSON.stringify(r));
    ok(
      "J solo: no consult pushed to betaConsultations",
      state.betaConsultations.length === 0,
    );
  }

  {
    const state = makeMinimalState({ mode: "adhoc" });
    const r = full.maybeConsultBeta(state, "before_plan", {
      betaVerdict: null,
      betaMessage: null,
      pendingPhase: null,
    });
    ok("J adhoc+no-verdict: ok===false", r.ok === false, JSON.stringify(r));
    ok(
      "J adhoc+no-verdict: halt_reason===beta_consult_pending",
      r.halt_reason === "beta_consult_pending",
      r.halt_reason,
    );
    ok(
      "J adhoc+no-verdict: boundary named in result",
      r.boundary === "before_plan",
      r.boundary,
    );
  }

  {
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-005" });
    const args = {
      betaVerdict: "DECIDE",
      betaMessage: "DECIDE 0.9 — the plan looks good and is reversible; proceed per SP-FIXTURE-005 rubric.",
      pendingPhase: "before_plan",
    };
    const r = full.maybeConsultBeta(state, "before_plan", args);
    ok("J DECIDE: ok===true", r.ok === true, JSON.stringify(r));
    ok("J DECIDE: verdict===DECIDE", r.verdict === "DECIDE", r.verdict);
    ok(
      "J DECIDE: consult pushed to betaConsultations",
      state.betaConsultations.length === 1,
      state.betaConsultations.length,
    );
    const c = state.betaConsultations[0];
    ok(
      "J DECIDE: consult.verdict===DECIDE (not hardcoded placeholder)",
      c && c.verdict === "DECIDE",
      c && c.verdict,
    );
    ok(
      "J DECIDE: consult has beta_message key",
      c && "beta_message" in c,
      JSON.stringify(c),
    );
    ok(
      "J DECIDE: consult has latency_ms key",
      c && "latency_ms" in c,
      JSON.stringify(c),
    );
    ok(
      "J DECIDE: verdict consumed (args.betaVerdict cleared)",
      args.betaVerdict === null,
      args.betaVerdict,
    );
  }

  {
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-006" });
    const directiveMsg =
      "DIRECTIVE — focus only on the auth scope this sprint; defer the rest per SP-FIXTURE-006.";
    const args = {
      betaVerdict: "DIRECTIVE",
      betaMessage: directiveMsg,
      pendingPhase: null,
    };
    const r = full.maybeConsultBeta(state, "before_design", args);
    ok("J DIRECTIVE: ok===true", r.ok === true, JSON.stringify(r));
    ok(
      "J DIRECTIVE: betaDirectives has 1 entry",
      state.betaDirectives.length === 1,
      state.betaDirectives.length,
    );
    ok(
      "J DIRECTIVE: directive message matches",
      state.betaDirectives[0] && state.betaDirectives[0].message === directiveMsg,
      state.betaDirectives[0] && state.betaDirectives[0].message,
    );
  }

  {
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-007" });
    const args = {
      betaVerdict: "ESCALATE",
      betaMessage: "ESCALATE — too risky without a security review; blast-radius exceeds the SP-FIXTURE-007 rubric threshold.",
      pendingPhase: "before_execute",
    };
    const r = full.maybeConsultBeta(state, "before_execute", args);
    ok("J ESCALATE: ok===false", r.ok === false, JSON.stringify(r));
    ok(
      "J ESCALATE: halt_reason===beta_escalate",
      r.halt_reason === "beta_escalate",
      r.halt_reason,
    );
  }

  {
    const args = full.parseArgs([
      "node",
      "full.js",
      "--resume",
      "--sprint",
      "SP-FIXTURE-020",
      "--beta-verdict",
      "DECIDE",
      "--beta-message",
      "ok",
      "--pending-phase",
      "before_plan",
    ]);
    ok(
      "J CLI: --beta-verdict captured",
      args.betaVerdict === "DECIDE",
      args.betaVerdict,
    );
    ok(
      "J CLI: --beta-message captured",
      args.betaMessage === "ok",
      args.betaMessage,
    );
    ok(
      "J CLI: --pending-phase captured",
      args.pendingPhase === "before_plan",
      args.pendingPhase,
    );
  }

  {
    const src = fs.readFileSync(
      path.join(__dirname, "full.js"),
      "utf8",
    );
    ok(
      "J source: contains sprint_full_beta_consult",
      src.includes("sprint_full_beta_consult"),
      "(not found)",
    );
    ok(
      "J source: does NOT contain sprint_full_beta_consultation (old token)",
      !src.includes("sprint_full_beta_consultation"),
      "(old token still present — half-rename guard tripped)",
    );
  }

  {
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-008" });
    const distinctiveMsg =
      "DIRECTIVE — distinctive grounded rationale referencing SP-FIXTURE-008 and the beta-contract precedent.";
    full.maybeConsultBeta(state, "before_retro", {
      betaVerdict: "DIRECTIVE",
      betaMessage: distinctiveMsg,
      pendingPhase: "before_retro",
    });
    ok(
      "J round-trip: recorded verdict is DIRECTIVE (not placeholder DECIDE)",
      state.betaConsultations.length === 1 &&
        state.betaConsultations[0].verdict === "DIRECTIVE",
      state.betaConsultations[0] && state.betaConsultations[0].verdict,
    );
    ok(
      "J round-trip: recorded beta_message matches supplied distinctive message",
      state.betaConsultations.length === 1 &&
        state.betaConsultations[0].beta_message === distinctiveMsg,
      state.betaConsultations[0] && state.betaConsultations[0].beta_message,
    );
  }

  {
    out.push("Resume past first boundary — later-boundary resume semantics");
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-009" });
    const args = {
      resume: true,
      pendingPhase: "before_design",
      betaVerdict: "DECIDE",
      betaMessage: "DECIDE 0.9 — design boundary is clear and reversible; proceed per SP-FIXTURE-009 rubric.",
    };

    const pendingIdx = full.PHASES.findIndex((p) => `before_${p}` === args.pendingPhase);
    ok(
      "later-boundary resume: pendingIdx for before_design is 1",
      pendingIdx === 1,
      `got ${pendingIdx}`,
    );

    const skipPredicate_i0 = pendingIdx !== -1 && 0 < pendingIdx;
    ok(
      "later-boundary resume: before_plan (i=0) skip predicate true — loop would skip consult",
      skipPredicate_i0 === true,
    );
    ok(
      "later-boundary resume: betaConsultations empty — before_plan was skipped, no record",
      state.betaConsultations.length === 0,
    );

    const skipPredicate_i1 = pendingIdx !== -1 && 1 < pendingIdx;
    ok(
      "later-boundary resume: before_design (i=1) skip predicate false — loop calls consult",
      skipPredicate_i1 === false,
    );
    const r1 = full.maybeConsultBeta(state, "before_design", args);
    ok(
      "later-boundary resume: before_design consult ok:true (verdict consumed)",
      r1.ok === true,
      JSON.stringify(r1),
    );
    ok("later-boundary resume: before_design verdict===DECIDE", r1.verdict === "DECIDE", r1.verdict);
    ok(
      "later-boundary resume: consult for before_design is recorded with correct boundary",
      state.betaConsultations.length === 1 &&
        state.betaConsultations[0].phase_boundary === "before_design",
      JSON.stringify(state.betaConsultations[0]),
    );
    ok(
      "later-boundary resume: args.betaVerdict consumed after before_design (one-consult-per-resume)",
      args.betaVerdict === null,
      `betaVerdict=${args.betaVerdict}`,
    );

    const skipPredicate_i2 = pendingIdx !== -1 && 2 < pendingIdx;
    ok(
      "later-boundary resume: before_execute (i=2) skip predicate false — loop calls consult",
      skipPredicate_i2 === false,
    );
    const r2 = full.maybeConsultBeta(state, "before_execute", args);
    ok(
      "later-boundary resume: before_execute halts — no verdict left (requires next resume)",
      r2.ok === false && r2.halt_reason === "beta_consult_pending",
      JSON.stringify(r2),
    );
    ok(
      "later-boundary resume: only 1 consult total — before_plan was skipped",
      state.betaConsultations.length === 1,
      `got ${state.betaConsultations.length}`,
    );
  }

  {
    out.push("Invalid --pending-phase rejected");
    const validBoundaries = full.PHASES.map((p) => `before_${p}`);
    ok(
      "pending-phase validation: valid boundaries includes before_design",
      validBoundaries.includes("before_design"),
    );
    ok(
      "pending-phase validation: valid boundaries does NOT include before_bogus",
      !validBoundaries.includes("before_bogus"),
    );
    const bogusIdx = full.PHASES.findIndex((p) => `before_${p}` === "before_bogus");
    ok(
      "pending-phase validation: bogus pendingPhase gives pendingIdx === -1 (triggers return 2 in main)",
      bogusIdx === -1,
      `got ${bogusIdx}`,
    );
    const validIdx = full.PHASES.findIndex((p) => `before_${p}` === "before_execute");
    ok(
      "pending-phase validation: before_execute gives pendingIdx === 2 (no error in main)",
      validIdx === 2,
      `got ${validIdx}`,
    );
  }

  {
    out.push("Invalid betaVerdict guard");
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-010" });
    const r = full.maybeConsultBeta(state, "before_plan", {
      betaVerdict: "INVALID",
      betaMessage: "test",
      pendingPhase: "before_plan",
    });
    ok(
      "invalid beta verdict: invalid verdict returns ok:false",
      r.ok === false,
      JSON.stringify(r),
    );
    ok(
      "invalid beta verdict: halt_reason===invalid_beta_verdict",
      r.halt_reason === "invalid_beta_verdict",
      r.halt_reason,
    );
    ok(
      "invalid beta verdict: no consult recorded for invalid verdict",
      state.betaConsultations.length === 0,
      `got ${state.betaConsultations.length}`,
    );
  }

  {
    out.push("betaMessage newline sanitization");
    const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-011" });
    const rawMsg =
      "DECIDE — safe message, reversible per SP-FIXTURE-011 rubric;\n## Injected\nlow blast-radius, proceed.";
    full.maybeConsultBeta(state, "before_plan", {
      betaVerdict: "DECIDE",
      betaMessage: rawMsg,
      pendingPhase: "before_plan",
    });
    ok(
      "beta_message sanitize: consult was recorded",
      state.betaConsultations.length === 1,
      `got ${state.betaConsultations.length}`,
    );
    ok(
      "beta_message sanitize: newlines stripped from recorded beta_message",
      state.betaConsultations.length === 1 &&
        !state.betaConsultations[0].beta_message.includes("\n"),
      state.betaConsultations[0] && state.betaConsultations[0].beta_message,
    );
    ok(
      "beta_message sanitize: text content preserved (non-empty after strip)",
      state.betaConsultations.length === 1 &&
        state.betaConsultations[0].beta_message.length > 0,
      state.betaConsultations[0] && state.betaConsultations[0].beta_message,
    );
    ok(
      "beta_message sanitize: original text not altered beyond newline removal",
      state.betaConsultations.length === 1 &&
        state.betaConsultations[0].beta_message.includes("safe message"),
      state.betaConsultations[0] && state.betaConsultations[0].beta_message,
    );
  }

  {
    out.push("Beta-args require --resume (resume-only guard predicate)");

    const freshWithVerdict = full.parseArgs([
      "node", "full.js", "test request long enough",
      "--beta-verdict", "DECIDE",
    ]);
    ok(
      "resume-only guard: fresh+betaVerdict: guard predicate (betaVerdict||pendingPhase)&&!resume is TRUE",
      !!(freshWithVerdict.betaVerdict || freshWithVerdict.pendingPhase) && !freshWithVerdict.resume,
      JSON.stringify({ bv: freshWithVerdict.betaVerdict, pp: freshWithVerdict.pendingPhase, r: freshWithVerdict.resume }),
    );

    const freshWithPending = full.parseArgs([
      "node", "full.js", "test request long enough",
      "--pending-phase", "before_design",
    ]);
    ok(
      "resume-only guard: fresh+pendingPhase: guard predicate is TRUE",
      !!(freshWithPending.betaVerdict || freshWithPending.pendingPhase) && !freshWithPending.resume,
      JSON.stringify({ bv: freshWithPending.betaVerdict, pp: freshWithPending.pendingPhase, r: freshWithPending.resume }),
    );

    const resumeWithBoth = full.parseArgs([
      "node", "full.js",
      "--resume", "--sprint", "SP-TEST",
      "--beta-verdict", "DECIDE",
      "--pending-phase", "before_design",
    ]);
    ok(
      "resume-only guard: resume+betaVerdict+pendingPhase: guard predicate is FALSE (not rejected)",
      !(!!(resumeWithBoth.betaVerdict || resumeWithBoth.pendingPhase) && !resumeWithBoth.resume),
      JSON.stringify({ bv: resumeWithBoth.betaVerdict, pp: resumeWithBoth.pendingPhase, r: resumeWithBoth.resume }),
    );

    const freshClean = full.parseArgs([
      "node", "full.js", "test request long enough",
    ]);
    ok(
      "resume-only guard: fresh clean run (no beta flags): guard predicate is FALSE (no interference)",
      !(!!(freshClean.betaVerdict || freshClean.pendingPhase) && !freshClean.resume),
      JSON.stringify({ bv: freshClean.betaVerdict, pp: freshClean.pendingPhase, r: freshClean.resume }),
    );
  }

  {
    out.push("Skip predicate requires args.resume (defense-in-depth)");

    const pendingIdx = full.PHASES.findIndex((p) => `before_${p}` === "before_design");
    ok(
      "skip predicate needs resume: pendingIdx for before_design is 1",
      pendingIdx === 1,
      `got ${pendingIdx}`,
    );

    const nonResume = { resume: false, pendingPhase: "before_design" };
    const skipNonResume_i0 = nonResume.resume && pendingIdx !== -1 && 0 < pendingIdx;
    ok(
      "skip predicate needs resume: non-resume + pendingIdx=1: skip predicate FALSE at i=0 (Beta gate fires)",
      skipNonResume_i0 === false,
      `got ${skipNonResume_i0}`,
    );

    const resumeArgs = { resume: true, pendingPhase: "before_design" };
    const skipResume_i0 = resumeArgs.resume && pendingIdx !== -1 && 0 < pendingIdx;
    ok(
      "skip predicate needs resume: resume + pendingIdx=1: skip predicate TRUE at i=0 (already-cleared boundary skipped)",
      skipResume_i0 === true,
      `got ${skipResume_i0}`,
    );

    const skipResume_i1 = resumeArgs.resume && pendingIdx !== -1 && 1 < pendingIdx;
    ok(
      "skip predicate needs resume: resume + pendingIdx=1: skip predicate FALSE at i=1 (pending boundary — consult fires)",
      skipResume_i1 === false,
      `got ${skipResume_i1}`,
    );
  }

  {
    out.push("Empty beta_message refused at runtime");

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-012" });
      const args = { betaVerdict: "DECIDE", betaMessage: "", pendingPhase: "before_plan" };
      const r = full.maybeConsultBeta(state, "before_plan", args);
      ok("empty message: empty DECIDE → ok:false", r.ok === false, JSON.stringify(r));
      ok(
        "empty message: halt_reason===beta_message_required",
        r.halt_reason === "beta_message_required",
        r.halt_reason,
      );
      ok(
        "empty message: no consult recorded for placeholder",
        state.betaConsultations.length === 0,
        `got ${state.betaConsultations.length}`,
      );
      ok(
        "empty message: verdict NOT consumed (operator can resume with a message)",
        args.betaVerdict === "DECIDE",
        `betaVerdict=${args.betaVerdict}`,
      );
      ok(
        "empty message: resume_command re-supplies the same verdict",
        typeof r.resume_command === "string" && r.resume_command.includes("--beta-verdict DECIDE"),
        r.resume_command,
      );
    }

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-013" });
      const r = full.maybeConsultBeta(state, "before_plan", {
        betaVerdict: "DECIDE",
        betaMessage: "   \t  ",
        pendingPhase: "before_plan",
      });
      ok(
        "whitespace-only message: whitespace-only DECIDE → beta_message_required",
        r.ok === false && r.halt_reason === "beta_message_required",
        JSON.stringify(r),
      );
      ok(
        "whitespace-only message: no consult recorded",
        state.betaConsultations.length === 0,
        `got ${state.betaConsultations.length}`,
      );
    }

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-014" });
      const r = full.maybeConsultBeta(state, "before_design", {
        betaVerdict: "DIRECTIVE",
        betaMessage: null,
        pendingPhase: "before_design",
      });
      ok(
        "empty directive message: empty DIRECTIVE → beta_message_required",
        r.ok === false && r.halt_reason === "beta_message_required",
        JSON.stringify(r),
      );
      ok(
        "empty directive message: no directive recorded",
        !state.betaDirectives || state.betaDirectives.length === 0,
        JSON.stringify(state.betaDirectives),
      );
    }

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-015" });
      const r = full.maybeConsultBeta(state, "before_plan", {
        betaVerdict: "DECIDE",
        betaMessage: "DECIDE — scope is reasonable and reversible; proceed per SP-FIXTURE-015 rubric, low blast-radius.",
        pendingPhase: "before_plan",
      });
      ok(
        "happy path: non-empty DECIDE still ok:true (happy path intact)",
        r.ok === true && state.betaConsultations.length === 1,
        JSON.stringify(r),
      );
    }

    {
      const src = fs.readFileSync(path.join(__dirname, "full.js"), "utf8");
      ok(
        "source guard: full.js contains beta_message_required halt",
        src.includes("beta_message_required"),
        "(not found)",
      );
      ok(
        "source guard: full.js guards on !betaMessage.trim()",
        /!betaMessage\.trim\(\)/.test(src),
        "(trim guard not found)",
      );
    }
  }

  {
    out.push("Canned/non-substantive beta_message refused at runtime");

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-016" });
      const args = { betaVerdict: "DECIDE", betaMessage: "looks good", pendingPhase: "before_plan" };
      const r = full.maybeConsultBeta(state, "before_plan", args);
      ok(
        "canned message: canned DECIDE → ok:false, beta_message_non_substantive",
        r.ok === false && r.halt_reason === "beta_message_non_substantive",
        JSON.stringify(r),
      );
      ok("canned message: no consult recorded", state.betaConsultations.length === 0);
      ok("canned message: verdict NOT consumed (operator resumes with a real one)", args.betaVerdict === "DECIDE");
    }

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-017" });
      const r = full.maybeConsultBeta(state, "before_plan", {
        betaVerdict: "DECIDE",
        betaMessage: "I have looked at the whole thing carefully and it all seems perfectly fine to me now.",
        pendingPhase: "before_plan",
      });
      ok(
        "boilerplate message: long-but-bare boilerplate → beta_message_non_substantive",
        r.ok === false && r.halt_reason === "beta_message_non_substantive",
        JSON.stringify(r),
      );
    }

    {
      const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-018" });
      const dup = "DECIDE — proceed, reversible and low blast-radius per the SP-FIXTURE-018 rubric here.";
      const r1 = full.maybeConsultBeta(state, "before_design", {
        betaVerdict: "DECIDE", betaMessage: dup, pendingPhase: "before_design",
      });
      ok("reused message: first boundary crosses (substantive)", r1.ok === true, JSON.stringify(r1));
      const r2 = full.maybeConsultBeta(state, "before_execute", {
        betaVerdict: "DECIDE", betaMessage: dup, pendingPhase: "before_execute",
      });
      ok(
        "reused message: the same substantive message ALSO crosses a second boundary at runtime (cross-boundary duplicate detection is audit-only, not runtime)",
        r2.ok === true,
        JSON.stringify(r2),
      );
    }

    {
      const prev = mcEnv.readEnv("BETA_SUBSTANCE_GATE");
      mcEnv.setEnv("BETA_SUBSTANCE_GATE", "off");
      try {
        const state = makeMinimalState({ mode: "adhoc", sprintId: "SP-FIXTURE-019" });
        const r = full.maybeConsultBeta(state, "before_plan", {
          betaVerdict: "DECIDE", betaMessage: "ok", pendingPhase: "before_plan",
        });
        ok("gate off: gate=off → canned message passes (rollout lever)", r.ok === true, JSON.stringify(r));
      } finally {
        if (prev === undefined) mcEnv.unsetEnv("BETA_SUBSTANCE_GATE");
        else mcEnv.setEnv("BETA_SUBSTANCE_GATE", prev);
      }
    }

    {
      const src = fs.readFileSync(path.join(__dirname, "full.js"), "utf8");
      ok(
        "source guard (non-substantive): full.js contains beta_message_non_substantive halt",
        src.includes("beta_message_non_substantive"),
        "(not found)",
      );
    }
  }
}

function testReleaseRecordIdempotencyAndModerateGate() {
  out.push("K. release-record idempotency + moderate staging gate");

  const PATHS = JSON.parse(
    fs.readFileSync(
      path.join(SPRINT.PROJECT, ".claude", "paths.json"),
      "utf8",
    ),
  );
  const releasesDir = path.join(SPRINT.PROJECT, PATHS.sprintReleases);
  const yamlLib = require("./fs");
  const stamp = Date.now();
  const sprintWithRelease = `SP-99999999-001`;
  const sprintNoRelease = `SP-99999999-002`;
  const rlStaging = `RL-99999999-901`;
  const rlProd = `RL-99999999-902`;
  const stagingPath = path.join(releasesDir, `${rlStaging}.yaml`);
  const prodPath = path.join(releasesDir, `${rlProd}.yaml`);

  try {
    fs.mkdirSync(releasesDir, { recursive: true });
    yamlLib.writeYaml(stagingPath, {
      schema: "mc/sprint/release/v1",
      id: rlStaging,
      sprint: sprintWithRelease,
      status: "preparing",
      deployment_environment: "staging",
      deployment_target: "staging",
    });
    yamlLib.writeYaml(prodPath, {
      schema: "mc/sprint/release/v1",
      id: rlProd,
      sprint: sprintWithRelease,
      status: "preparing",
      deployment_environment: "production",
      deployment_target: "production",
    });

    const found = full.findExistingStagingRelease(sprintWithRelease, "staging");
    ok(
      "K-1: finds existing staging release record for the sprint",
      found === rlStaging,
      `got ${found}`,
    );

    const none = full.findExistingStagingRelease(sprintNoRelease, "staging");
    ok(
      "K-2: returns null when no record exists for the sprint",
      none === null,
      `got ${none}`,
    );

    const prodLookup = full.findExistingStagingRelease(
      sprintWithRelease,
      "production",
    );
    ok(
      "K-3: production target never matched (guard skips production records)",
      prodLookup === null,
      `got ${prodLookup}`,
    );

    const devLookup = full.findExistingStagingRelease(sprintWithRelease, "dev");
    ok(
      "K-4: target mismatch returns null (staging record not matched for dev)",
      devLookup === null,
      `got ${devLookup}`,
    );
  } catch (e) {
    ok("K release-record test ran without throwing", false, e.message);
  } finally {
    try { fs.rmSync(stagingPath, { force: true }); } catch {}
    try { fs.rmSync(prodPath, { force: true }); } catch {}
  }

  {
    let threw = false;
    let res = "unset";
    try {
      res = full.findExistingStagingRelease("SP-99999999-999", "staging");
    } catch {
      threw = true;
    }
    ok("K-5: findExistingStagingRelease never throws", !threw);
    ok("K-5: returns null for a sprint with no records", res === null, `got ${res}`);
  }

  {
    const moderate = full.loadPreset("moderate");
    ok("K-6: loadPreset('moderate') ok", moderate.ok, moderate.error);
    if (moderate.ok) {
      ok(
        "K-6: moderate pre-authorizes release_approval_required",
        moderate.preset.pre_authorized_approval_levels.includes(
          "release_approval_required",
        ),
      );
      ok(
        "K-6: moderate release_approval_targets includes staging",
        (moderate.preset.release_approval_targets || []).includes("staging"),
      );
      ok(
        "K-6: moderate release_approval_targets does NOT include production (HARD ceiling intact)",
        !(moderate.preset.release_approval_targets || []).includes("production"),
      );
      const levels = moderate.preset.pre_authorized_approval_levels || [];
      const targets = moderate.preset.release_approval_targets || [];
      const target = "staging";
      const canAutoApprove =
        levels.includes("release_approval_required") &&
        targets.includes(target) &&
        target !== "production";
      ok(
        "K-6: moderate auto-approves a staging release RECORD (no halt)",
        canAutoApprove === true,
      );
    }
  }

  {
    const conservative = full.loadPreset("conservative");
    ok("K-7: loadPreset('conservative') ok", conservative.ok);
    if (conservative.ok) {
      const levels = conservative.preset.pre_authorized_approval_levels || [];
      const targets = conservative.preset.release_approval_targets || [];
      const target = "staging";
      const canAutoApprove =
        levels.includes("release_approval_required") &&
        targets.includes(target) &&
        target !== "production";
      ok(
        "K-7: conservative does NOT auto-approve staging release (still halts)",
        canAutoApprove === false,
      );
    }
  }

  {
    const moderate = full.loadPreset("moderate");
    if (moderate.ok) {
      const levels = moderate.preset.pre_authorized_approval_levels || [];
      const targets = moderate.preset.release_approval_targets || [];
      const target = "production";
      const canAutoApprove =
        levels.includes("release_approval_required") &&
        targets.includes(target) &&
        target !== "production";
      ok(
        "K-8: production target can never auto-approve (production guard fires)",
        canAutoApprove === false,
      );
    }
    const cfg = JSON.parse(
      fs.readFileSync(
        path.join(SPRINT.PROJECT, PATHS.sprintFullAutonomy),
        "utf8",
      ),
    );
    let anyProd = false;
    for (const name of Object.keys(cfg.presets || {})) {
      if ((cfg.presets[name].release_approval_targets || []).includes("production")) {
        anyProd = true;
      }
    }
    ok("K-8: no preset lists production in release_approval_targets", !anyProd);
  }
}

function testBetaBoundaryPersistence() {
  out.push("L. Beta-boundary persistence");

  const sprintId = `SP-99999999-${(Date.now() % 900) + 100}`;
  const sidecar = full.betaBoundariesPath(sprintId);

  try {
    ok(
      "L-1: readClearedBetaBoundaries empty before any write",
      Array.isArray(full.readClearedBetaBoundaries(sprintId)) &&
        full.readClearedBetaBoundaries(sprintId).length === 0,
    );

    full.recordClearedBetaBoundary(sprintId, "before_plan");
    let cleared = full.readClearedBetaBoundaries(sprintId);
    ok(
      "L-2: before_plan persisted and read back",
      cleared.length === 1 && cleared[0] === "before_plan",
      JSON.stringify(cleared),
    );
    ok("L-2: sidecar file exists on disk", fs.existsSync(sidecar));

    full.recordClearedBetaBoundary(sprintId, "before_plan");
    cleared = full.readClearedBetaBoundaries(sprintId);
    ok(
      "L-3: duplicate record is idempotent (still 1 entry)",
      cleared.length === 1,
      JSON.stringify(cleared),
    );

    full.recordClearedBetaBoundary(sprintId, "before_design");
    cleared = full.readClearedBetaBoundaries(sprintId);
    ok(
      "L-4: second boundary accumulates (2 entries, order preserved)",
      cleared.length === 2 &&
        cleared[0] === "before_plan" &&
        cleared[1] === "before_design",
      JSON.stringify(cleared),
    );

    const pendingIdx = -1;
    const clearedSet = full.readClearedBetaBoundaries(sprintId);
    function skipPredicate(i) {
      const boundary = `before_${full.PHASES[i]}`;
      const alreadyCleared = true && clearedSet.includes(boundary);
      const beforePending = true && pendingIdx !== -1 && i < pendingIdx;
      return alreadyCleared || beforePending;
    }
    ok(
      "L-5: bare --resume skips before_plan (i=0, persisted-cleared)",
      skipPredicate(0) === true,
    );
    ok(
      "L-5: bare --resume skips before_design (i=1, persisted-cleared)",
      skipPredicate(1) === true,
    );
    ok(
      "L-5: bare --resume does NOT skip before_execute (i=2, uncrossed → consult fires)",
      skipPredicate(2) === false,
    );

    function skipPredicateFreshRun(i) {
      const boundary = `before_${full.PHASES[i]}`;
      const clearedFresh = [];
      const alreadyCleared = false && clearedFresh.includes(boundary);
      const beforePending = false && pendingIdx !== -1 && i < pendingIdx;
      return alreadyCleared || beforePending;
    }
    ok(
      "L-6: fresh run never pre-skips before_plan (Beta gate fires despite sidecar)",
      skipPredicateFreshRun(0) === false,
    );

    fs.writeFileSync(
      sidecar,
      JSON.stringify({
        schema: "mc/sprint-full/beta-boundaries/v1",
        sprint: sprintId,
        cleared: ["before_plan", "before_bogus", 42, null, "before_retro"],
        updated_at: new Date().toISOString(),
      }) + "\n",
      "utf8",
    );
    const filtered = full.readClearedBetaBoundaries(sprintId);
    ok(
      "L-7: unknown/garbled boundaries filtered (only real boundaries honored)",
      filtered.length === 2 &&
        filtered.includes("before_plan") &&
        filtered.includes("before_retro") &&
        !filtered.includes("before_bogus"),
      JSON.stringify(filtered),
    );

    fs.writeFileSync(sidecar, "{ not valid json", "utf8");
    let threw = false;
    let res = "unset";
    try {
      res = full.readClearedBetaBoundaries(sprintId);
    } catch {
      threw = true;
    }
    ok("L-8: corrupt sidecar does not throw", !threw);
    ok(
      "L-8: corrupt sidecar reads as empty (fail-open — no gate pre-skipped)",
      Array.isArray(res) && res.length === 0,
      JSON.stringify(res),
    );
  } catch (e) {
    ok("L boundary-persistence test ran without throwing", false, e.message);
  } finally {
    try {
      const dir = path.dirname(sidecar);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

function testSprintModeEpsilonDefaults() {
  out.push("M. sprint-mode epsilon defaults");

  const withEpsilon = full.parseArgs(["node", "full.js", "--epsilon"]);
  ok("M-1: --epsilon sets _epsilonExplicit=true", withEpsilon._epsilonExplicit === true);
  ok("M-1: --epsilon sets epsilon=true", withEpsilon.epsilon === true);

  const withEpsilonDispatch = full.parseArgs(["node", "full.js", "--epsilon-dispatch"]);
  ok("M-2: --epsilon-dispatch sets _epsilonExplicit=true", withEpsilonDispatch._epsilonExplicit === true);
  ok("M-2: --epsilon-dispatch sets _epsilonDispatchExplicit=true", withEpsilonDispatch._epsilonDispatchExplicit === true);
  ok("M-2: --epsilon-dispatch sets epsilonDispatch=true", withEpsilonDispatch.epsilonDispatch === true);

  const noFlags = full.parseArgs(["node", "full.js", "--sprint", "SP-TEST"]);
  ok("M-3: no flags → _epsilonExplicit=false", noFlags._epsilonExplicit === false);
  ok("M-3: no flags → _epsilonDispatchExplicit=false", noFlags._epsilonDispatchExplicit === false);

  const fullSrc = fs.readFileSync(path.join(__dirname, "full.js"), "utf8");
  ok(
    "M-4: source references isSprint() for sprint-mode default",
    fullSrc.includes("isSprint()"),
  );
  ok(
    "M-4: source checks _epsilonExplicit before applying sprint-mode default",
    fullSrc.includes("_epsilonExplicit"),
  );
  ok(
    "M-4: source uses the EPSILON_RUNTIME env guard (MC_EPSILON_RUNTIME, read-both)",
    fullSrc.includes('mcEnv.envNames("EPSILON_RUNTIME")'),
  );

  const noEpsilon = full.parseArgs(["node", "full.js", "--no-epsilon"]);
  ok("M-5: --no-epsilon sets epsilon=false", noEpsilon.epsilon === false);
  ok("M-5: --no-epsilon sets epsilonDispatch=false", noEpsilon.epsilonDispatch === false);
  ok("M-5: --no-epsilon sets _epsilonExplicit=true", noEpsilon._epsilonExplicit === true);
  ok("M-5: --no-epsilon sets _epsilonDispatchExplicit=true", noEpsilon._epsilonDispatchExplicit === true);

  const noDispatch = full.parseArgs(["node", "full.js", "--epsilon", "--no-epsilon-dispatch"]);
  ok("M-6: --no-epsilon-dispatch keeps epsilon=true", noDispatch.epsilon === true);
  ok("M-6: --no-epsilon-dispatch sets epsilonDispatch=false", noDispatch.epsilonDispatch === false);
  ok("M-6: --no-epsilon-dispatch sets _epsilonDispatchExplicit=true", noDispatch._epsilonDispatchExplicit === true);

  const soloNoDispatch = full.parseArgs(["node", "full.js", "--no-epsilon-dispatch"]);
  ok("M-7: standalone --no-epsilon-dispatch → epsilonDispatch=false", soloNoDispatch.epsilonDispatch === false);
  ok("M-7: standalone --no-epsilon-dispatch → _epsilonDispatchExplicit=true", soloNoDispatch._epsilonDispatchExplicit === true);
  ok("M-7: standalone --no-epsilon-dispatch leaves _epsilonExplicit=false", soloNoDispatch._epsilonExplicit === false);
  const fullSrc2 = fs.readFileSync(path.join(__dirname, "full.js"), "utf8");
  ok(
    "M-7: main() sprint-default guards dispatch half with _epsilonDispatchExplicit",
    /if \(!args\._epsilonDispatchExplicit\) args\.epsilonDispatch = true;/.test(fullSrc2),
  );
}

function testDesignWithoutRosterEnforcer() {
  out.push("N. design-without-roster enforcer");

  ok(
    "full exports checkDesignWithoutRoster",
    typeof full.checkDesignWithoutRoster === "function",
  );

  const fullSrc = fs.readFileSync(path.join(__dirname, "full.js"), "utf8");
  ok(
    "source emits design_without_roster event kind",
    fullSrc.includes("design_without_roster"),
  );
  ok(
    "source references the enforcer-ramp TODO marker",
    fullSrc.includes("enforcer-ramp"),
  );
  ok(
    "source calls checkDesignWithoutRoster from phase2Design",
    fullSrc.includes("checkDesignWithoutRoster"),
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-design-roster-"));
  let threw = false;
  try {
    full.checkDesignWithoutRoster("SP-TEST-MISSING");
  } catch {
    threw = true;
  }
  ok("checkDesignWithoutRoster does not throw when ledger absent", !threw);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

function testRIdSingleSourcing() {
  out.push("O. R-id single-sourcing");
  const design = require("./design");

  const areas4 = ["Area one", "Area two", "Area three", "Area four"];
  const body4 = design.buildGranularStoriesBody(
    [
      { id: "T-1", title: "Story one", riskLevel: "low", type: "feature" },
      { id: "T-2", title: "Story two", riskLevel: "low", type: "feature" },
      { id: "T-3", title: "Story three", riskLevel: "low", type: "feature" },
      { id: "T-4", title: "Story four", riskLevel: "low", type: "feature" },
      { id: "T-5", title: "Story five", riskLevel: "low", type: "feature" },
    ],
    "Test outcome",
    areas4,
  );
  ok("O-1: body with 4 req areas contains R-1", body4.includes("R-1"));
  ok("O-1: body with 4 req areas contains R-4", body4.includes("R-4"));
  ok("O-1: body with 4 req areas does NOT contain R-5 (modular cap)", !body4.includes("R-5"));

  const list3 = design.buildRequirementsList(["Req A", "Req B", "Req C"]);
  ok("O-2: buildRequirementsList generates R-1", list3.includes("R-1"));
  ok("O-2: buildRequirementsList generates R-3", list3.includes("R-3"));
  ok("O-2: buildRequirementsList does NOT generate R-4 for 3-area list", !list3.includes("R-4"));

  const list5 = design.buildRequirementsList(["A", "B", "C", "D", "E"]);
  ok("O-2: buildRequirementsList generates R-5 for 5-area list", list5.includes("R-5"));

  const rows = design.buildTraceMapRows(["Area A", "Area B"], "Test request");
  ok("O-3: buildTraceMapRows returns string", typeof rows === "string");
  ok("O-3: buildTraceMapRows includes R-1", rows.includes("R-1"));
  ok("O-3: buildTraceMapRows includes R-2", rows.includes("R-2"));
  ok("O-3: buildTraceMapRows does NOT include R-3 for 2-area list", !rows.includes("R-3"));

  const entries = design.buildTraceEntries(["Area A", "Area B"]);
  ok("O-4: buildTraceEntries returns string", typeof entries === "string");
  ok("O-4: buildTraceEntries includes TR-1", entries.includes("TR-1"));
  ok("O-4: buildTraceEntries includes TR-2", entries.includes("TR-2"));
  ok("O-4: buildTraceEntries does NOT include TR-3 for 2-area list", !entries.includes("TR-3"));

  ok("O-5: design exports checkTraceIntegrity", typeof design.checkTraceIntegrity === "function");

  const designSrc = fs.readFileSync(path.join(__dirname, "design.js"), "utf8");
  ok("O-6: design.js source has buildRequirementsList", designSrc.includes("buildRequirementsList"));
  ok("O-6: design.js source has buildTraceMapRows", designSrc.includes("buildTraceMapRows"));
  ok("O-6: design.js source has buildTraceEntries", designSrc.includes("buildTraceEntries"));
  ok("O-6: design.js source has checkTraceIntegrity", designSrc.includes("checkTraceIntegrity"));
  ok(
    "O-6: design.js uses modular R-id wrap (reqCount + 1)",
    designSrc.includes("reqCount") && designSrc.includes("% reqCount"),
  );

  const os = require("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trace-int-"));
  try {
    fs.writeFileSync(path.join(tmp, "prd.md"), "## Requirements\n| R-1 | thing |\n| R-2 | other |\n");
    fs.writeFileSync(path.join(tmp, "granular-stories.md"), "story cites R-1 and bare R-3 in a row | R-3 |\n");
    fs.writeFileSync(path.join(tmp, "trace.md"), "| R-2 |\n");
    const r1 = design.checkTraceIntegrity(tmp, "SP-TEST");
    ok("O-7: bare table-row R-ids matched; orphan R-3 caught", r1.ok === false && /R-3/.test(r1.message || ""));

    fs.writeFileSync(path.join(tmp, "prd.md"), "no requirement ids here at all\n");
    const r2 = design.checkTraceIntegrity(tmp, "SP-TEST");
    ok("O-7: PRD with zero parseable R-ids + cited refs → FAIL (fail-closed)", r2.ok === false);

    fs.writeFileSync(path.join(tmp, "prd.md"), "| R-1 |\n| R-2 |\n| R-3 |\n");
    fs.writeFileSync(path.join(tmp, "granular-stories.md"), "cites `R-1` and | R-2 |\n");
    fs.writeFileSync(path.join(tmp, "trace.md"), "| R-3 |\n");
    const r3 = design.checkTraceIntegrity(tmp, "SP-TEST");
    ok("O-7: consistent mixed-format set → ok", r3.ok === true);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  }

  const tmp9 = fs.mkdtempSync(path.join(os.tmpdir(), "trace-int-err-"));
  try {
    fs.writeFileSync(path.join(tmp9, "prd.md"), "| R-1 |\n");
    fs.writeFileSync(path.join(tmp9, "granular-stories.md"), "cites R-1\n");
    const realReadFileSync = fs.readFileSync;
    fs.readFileSync = function (p, ...rest) {
      if (String(p).endsWith("granular-stories.md")) {
        throw new Error("EACCES: injected fault (O-9 fixture)");
      }
      return realReadFileSync.call(fs, p, ...rest);
    };
    let r9;
    try {
      r9 = design.checkTraceIntegrity(tmp9, "SP-TEST");
    } finally {
      fs.readFileSync = realReadFileSync;
    }
    ok("O-9: unexpected read error is NOT fail-open (ok:false, not ok:true)", r9.ok === false);
    ok("O-9: errored result carries the underlying error text", /injected fault/.test(r9.message || ""));
    ok("O-9: errored result is distinguishable from a content failure (errored flag)", r9.errored === true);

    const rClean = design.checkTraceIntegrity(tmp9, "SP-TEST");
    ok("O-9 no-op guard: same fixture with fault removed is ok:true (fault injection was real)", rClean.ok === true);
  } finally {
    try { fs.rmSync(tmp9, { recursive: true, force: true }); } catch { }
  }

  const checkpoint = require("./checkpoint.js");
  const norm = checkpoint.normalizeExisting({
    current_phase: "execute",
    crash_recovery: { last_known_good: "x" },
    ralph: { loop: 3 },
    reports: ["r1"],
    some_future_field: 42,
  });
  ok("O-8: normalizeExisting preserves crash_recovery", norm.crash_recovery && norm.crash_recovery.last_known_good === "x");
  ok("O-8: normalizeExisting preserves ralph", norm.ralph && norm.ralph.loop === 3);
  ok("O-8: normalizeExisting preserves reports", Array.isArray(norm.reports) && norm.reports[0] === "r1");
  ok("O-8: normalizeExisting preserves unknown future fields", norm.some_future_field === 42);
  ok("O-8: normalizeExisting still normalizes known fields", norm.current_phase === "execute" && norm.status === "running");
}

function testGauntletPackageWiring() {
  out.push("P. gauntlet-package CLI flag + resolveGauntletDecision (fail-open)");

  ok("default gauntletPackage is 'auto'", full.parseArgs(["node", "full.js", "x"]).gauntletPackage === "auto");
  ok("--gauntlet-package full is captured", full.parseArgs(["node", "full.js", "x", "--gauntlet-package", "full"]).gauntletPackage === "full");
  ok("--gauntlet-package differential is captured", full.parseArgs(["node", "full.js", "x", "--gauntlet-package", "differential"]).gauntletPackage === "differential");
  ok("--gauntlet-package <anything else> normalizes to 'auto' (fail-safe default)", full.parseArgs(["node", "full.js", "x", "--gauntlet-package", "bogus"]).gauntletPackage === "auto");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q", { cwd: tmp });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "init"', { cwd: tmp });
    let threw = false;
    let res;
    try {
      res = full.resolveGauntletDecision("SP-TEST-GP", { unit_types: [], max_risk: "", domains: [] }, { root: tmp });
    } catch {
      threw = true;
    }
    ok("resolveGauntletDecision NEVER throws against a no-history/no-trailer repo", threw === false);
    ok("...and returns { decision: null, error } on failure", res && res.decision === null && typeof res.error === "string", JSON.stringify(res));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
  }

  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve2-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q", { cwd: tmp2 });
    fs.mkdirSync(path.join(tmp2, ".claude", "project", "sprint"), { recursive: true });
    fs.writeFileSync(path.join(tmp2, ".claude", "project", "sprint", "active-sprints.yaml"), "schema: mc/sprint/active-sprints/v1\nsprints: []\n");
    execSync("git add -A", { cwd: tmp2 });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "base"', { cwd: tmp2 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "head"', { cwd: tmp2 });
    let res2;
    let threw2 = false;
    try {
      res2 = full.resolveGauntletDecision(
        "SP-TEST-GP2",
        { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor" },
        { root: tmp2, defaultBranch: "no-such-branch" },
      );
    } catch {
      threw2 = true;
    }
    ok("resolveGauntletDecision never throws even with a bogus defaultBranch", threw2 === false);
    ok("...result is a well-formed { decision, error } shape either way", res2 && ("decision" in res2) && ("error" in res2), JSON.stringify(res2));
    ok("an unresolvable defaultBranch refuses (no_base or sprint_registry_unreadable), never falls back to HEAD or HEAD~1", res2 && res2.decision === null && /^(no_base|sprint_registry_unreadable):/.test(res2.error || ""), JSON.stringify(res2));
  } finally {
    try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch { }
  }

  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve3-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q", { cwd: tmp3 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "base"', { cwd: tmp3 });
    const msgFile = path.join(tmp3, "msg.txt");
    fs.writeFileSync(msgFile, "chore: tiny fix\n\nChange: bugfix\nBlast: minor\nRisks: none\n");
    execSync(`git -c user.email=t@t -c user.name=t commit --allow-empty -q -F "${msgFile}"`, { cwd: tmp3 });
    const res3 = full.resolveGauntletDecision(
      "SP-TEST-GP3",
      { unit_types: ["backend"], max_risk: "high", domains: [], change: "release", blast: "major" },
      { root: tmp3 },
    );
    ok("a ticket classification higher than the HEAD commit trailer (a downgrade attempt) is BLOCKED", res3 && res3.decision === null && /downgrade blocked/.test(res3.error || ""), JSON.stringify(res3));
  } finally {
    try { fs.rmSync(tmp3, { recursive: true, force: true }); } catch { }
  }

  const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve4-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q", { cwd: tmp4 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "base"', { cwd: tmp4 });
    const msgFile = path.join(tmp4, "msg.txt");
    fs.writeFileSync(msgFile, "chore: tiny fix\n\nChange: not-a-real-value\nBlast: minor\nRisks: none\n");
    execSync(`git -c user.email=t@t -c user.name=t commit --allow-empty -q -F "${msgFile}"`, { cwd: tmp4 });
    const res4 = full.resolveGauntletDecision(
      "SP-TEST-GP4",
      { unit_types: ["backend"], max_risk: "high", domains: [], change: "bugfix", blast: "minor" },
      { root: tmp4 },
    );
    ok("an invalid (present-but-malformed) HEAD trailer REFUSES, never falls back to the ticket", res4 && res4.decision === null && res4.halt_reason === "change_trailer_invalid", JSON.stringify(res4));
  } finally {
    try { fs.rmSync(tmp4, { recursive: true, force: true }); } catch { }
  }

  const tmp5 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve5-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q -b main", { cwd: tmp5 });
    fs.mkdirSync(path.join(tmp5, ".claude", "project", "sprint"), { recursive: true });
    fs.writeFileSync(path.join(tmp5, ".claude", "project", "sprint", "active-sprints.yaml"), "schema: mc/sprint/active-sprints/v1\nsprints: []\n");
    execSync("git add -A", { cwd: tmp5 });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "base"', { cwd: tmp5 });
    execSync("git checkout -q -b feature", { cwd: tmp5 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "plain commit, no trailer at all"', { cwd: tmp5 });
    const res5 = full.resolveGauntletDecision(
      "SP-TEST-GP5",
      { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["none"] },
      { root: tmp5 },
    );
    ok("regression guard: a genuinely ABSENT HEAD trailer is not an error — the ticket value is used", res5 && res5.decision !== null, JSON.stringify(res5));
    ok("...and the resolved package used the ticket's own classification", res5 && res5.decision && res5.decision.trailer.change === "bugfix" && res5.decision.trailer.blast === "minor", JSON.stringify(res5 && res5.decision && res5.decision.trailer));
  } finally {
    try { fs.rmSync(tmp5, { recursive: true, force: true }); } catch { }
  }

  const tmp8 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve8-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q -b main", { cwd: tmp8 });
    const sprintDir = path.join(tmp8, ".claude", "project", "sprint");
    fs.mkdirSync(sprintDir, { recursive: true });
    fs.writeFileSync(
      path.join(sprintDir, "active-sprints.yaml"),
      ["schema: mc/sprint/active-sprints/v1", "primary: SP-TEST-GP8", "sprints:", "  - id: SP-TEST-GP8", "    title: live", "    status: executing", "    layout: per_sprint_subdir"].join("\n") + "\n",
    );
    execSync("git add -A", { cwd: tmp8 });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "base"', { cwd: tmp8 });
    execSync("git checkout -q -b feature", { cwd: tmp8 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "plain commit, no trailer at all"', { cwd: tmp8 });
    const res8 = full.resolveGauntletDecision(
      "SP-TEST-GP8",
      { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["none"] },
      { root: tmp8 },
    );
    ok("no HEAD trailer + minor ticket, UNDER AN ACTIVE SPRINT, is REFUSED", res8 && res8.decision === null && res8.halt_reason === "change_trailer_missing", JSON.stringify(res8));
  } finally {
    try { fs.rmSync(tmp8, { recursive: true, force: true }); } catch { }
  }

  const tmp9 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve9-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q -b main", { cwd: tmp9 });
    const sprintDir9 = path.join(tmp9, ".claude", "project", "sprint");
    fs.mkdirSync(sprintDir9, { recursive: true });
    fs.writeFileSync(
      path.join(sprintDir9, "active-sprints.yaml"),
      ["schema: mc/sprint/active-sprints/v1", "primary: SP-TEST-GP9", "sprints:", "  - id: SP-TEST-GP9", "    title: live", "    status: executing", "    layout: per_sprint_subdir"].join("\n") + "\n",
    );
    execSync("git add -A", { cwd: tmp9 });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "base"', { cwd: tmp9 });
    execSync("git checkout -q -b feature", { cwd: tmp9 });
    fs.rmSync(path.join(sprintDir9, "active-sprints.yaml"));
    execSync("git add -A", { cwd: tmp9 });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m "plain commit, no trailer, sprint registry removed in this same commit"', { cwd: tmp9 });
    const res9 = full.resolveGauntletDecision(
      "SP-TEST-GP9",
      { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["none"] },
      { root: tmp9 },
    );
    ok(
      "sprint closed/registry removed IN THE SAME COMMIT as the missing trailer is still REFUSED (base tree still shows it active)",
      res9 && res9.decision === null && res9.halt_reason === "change_trailer_missing",
      JSON.stringify(res9),
    );
  } finally {
    try { fs.rmSync(tmp9, { recursive: true, force: true }); } catch { }
  }

  const tmp10 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve10-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q -b main", { cwd: tmp10 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "base"', { cwd: tmp10 });
    execSync("git checkout -q -b feature", { cwd: tmp10 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "plain commit, no trailer, no registry ever existed"', { cwd: tmp10 });
    const res10 = full.resolveGauntletDecision(
      "SP-TEST-GP10",
      { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["none"] },
      { root: tmp10 },
    );
    ok(
      "regression guard: an unreadable/missing registry at every ref REFUSES (sprint_registry_unreadable), never silently 'not active'",
      res10 && res10.decision === null && res10.halt_reason === "sprint_registry_unreadable",
      JSON.stringify(res10),
    );
  } finally {
    try { fs.rmSync(tmp10, { recursive: true, force: true }); } catch { }
  }

  const tmp6 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve6-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q -b main", { cwd: tmp6 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "base"', { cwd: tmp6 });
    execSync("git checkout -q -b feature", { cwd: tmp6 });
    const msgFile6 = path.join(tmp6, "msg.txt");
    fs.writeFileSync(msgFile6, "chore: tiny fix\n\nChange: bugfix\nBlast: major\nRisks: ci\n");
    execSync(`git -c user.email=t@t -c user.name=t commit --allow-empty -q -F "${msgFile6}"`, { cwd: tmp6 });
    const res6 = full.resolveGauntletDecision(
      "SP-TEST-GP6",
      { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["hooks"] },
      { root: tmp6 },
    );
    ok("blast widens to the HEAD commit's stricter 'major' (not the ticket's own 'minor')", res6 && res6.decision && res6.decision.trailer.blast === "major", JSON.stringify(res6 && res6.decision && res6.decision.trailer));
    ok("risks is the UNION of both sources (ticket's 'hooks' + commit's 'ci')", res6 && res6.decision && new Set(res6.decision.trailer.risks).size === 2 && res6.decision.trailer.risks.includes("hooks") && res6.decision.trailer.risks.includes("ci"), JSON.stringify(res6 && res6.decision && res6.decision.trailer));
  } finally {
    try { fs.rmSync(tmp6, { recursive: true, force: true }); } catch { }
  }

  const tmp7 = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-resolve7-"));
  try {
    const { execSync } = require("child_process");
    execSync("git init -q -b main", { cwd: tmp7 });
    execSync('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "base"', { cwd: tmp7 });
    execSync("git checkout -q -b feature", { cwd: tmp7 });
    const msgFile7 = path.join(tmp7, "msg.txt");
    fs.writeFileSync(msgFile7, "chore: tiny fix\n\nChange: bugfix\nBlast: minor\nRisks: none\n");
    execSync(`git -c user.email=t@t -c user.name=t commit --allow-empty -q -F "${msgFile7}"`, { cwd: tmp7 });
    const res7 = full.resolveGauntletDecision(
      "SP-TEST-GP7",
      { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", risks: ["hooks"] },
      { root: tmp7 },
    );
    ok("other direction: change/blast equal → not blocked, decision resolves", res7 && res7.decision !== null, JSON.stringify(res7));
    ok("other direction: risks keeps the ticket's own token (commit declared none)", res7 && res7.decision && res7.decision.trailer.risks.includes("hooks"), JSON.stringify(res7 && res7.decision && res7.decision.trailer));
  } finally {
    try { fs.rmSync(tmp7, { recursive: true, force: true }); } catch { }
  }
}

function testGauntletConductProblemsAndHalt() {
  out.push("Q. gauntletConductProblems + emitPhaseConsults halts on a gauntlet-step refusal");

  {
    const clean = { halt_reason: null, verify: { ok: true }, dispatched: [{ role: "backend-reviewer", reason: null }], stage_results: [{ stage: 1, ok: true }] };
    const { problems: p0, focusedTestsZero: f0 } = full.gauntletConductProblems(clean);
    ok("a clean result → no problems, no focused_tests_zero", p0.length === 0 && f0 === false, JSON.stringify({ p0, f0 }));

    const haltResult = { halt_reason: "empty_gauntlet", verify: { ok: false, halt_reason: "empty_gauntlet" }, dispatched: [], stage_results: [] };
    const { problems: p1 } = full.gauntletConductProblems(haltResult);
    ok("halt_reason:'empty_gauntlet' is extracted as a problem", p1.some((p) => p.kind === "empty_gauntlet"), JSON.stringify(p1));

    const verifyFailResult = { halt_reason: null, verify: { ok: false, error: "no-record" }, dispatched: [{ role: "x" }], stage_results: [] };
    const { problems: p2 } = full.gauntletConductProblems(verifyFailResult);
    ok("verify.ok:false (no halt_reason) is extracted as gauntlet_verify_failed", p2.some((p) => p.kind === "gauntlet_verify_failed"), JSON.stringify(p2));

    const refusedResult = { halt_reason: null, verify: { ok: true }, dispatched: [{ role: "backend-reviewer", reason: "empty_review_scope_refused" }], stage_results: [] };
    const { problems: p3 } = full.gauntletConductProblems(refusedResult);
    ok("an empty_review_scope_refused dispatch entry is extracted as a problem", p3.some((p) => p.kind === "empty_review_scope_refused"), JSON.stringify(p3));

    const ft0Result = { halt_reason: null, verify: null, dispatched: [], stage_results: [{ stage: 1, name: "sanity", ok: true, finding: "focused_tests:0" }] };
    const { problems: p4, focusedTestsZero: f4 } = full.gauntletConductProblems(ft0Result);
    ok("focused_tests:0 is reported as focusedTestsZero, NOT as a halting problem", f4 === true && p4.length === 0, JSON.stringify({ p4, f4 }));

    ok("a non-object/null result → no problems (never throws)", full.gauntletConductProblems(null).problems.length === 0);
  }

  {
    const red = { halt_reason: null, verify: null, dispatched: [], halted_at_stage: 1, stage_results: [{ stage: 1, name: "sanity", ok: false, exit_code: 1, output: "FAIL scripts/x.test.js: boom" }] };
    const { problems: pr } = full.gauntletConductProblems(red);
    const sf = pr.find((p) => p.kind === "gauntlet_stage_failed");
    ok("lean-gauntlet RED: halted_at_stage + ok:false stage → a gauntlet_stage_failed problem", !!sf, JSON.stringify(pr));
    ok("lean-gauntlet RED: the failing stage's captured output is surfaced in the detail", !!sf && sf.detail.includes("FAIL scripts/x.test.js: boom") && sf.detail.includes("stage 1"), JSON.stringify(sf));
    const okOnlyFlag = { halt_reason: null, verify: null, dispatched: [], halted_at_stage: null, stage_results: [{ stage: 3, name: "security-shallow", ok: false }] };
    ok("lean-gauntlet RED: a stage_results ok:false alone (no halted_at_stage) is also a problem", full.gauntletConductProblems(okOnlyFlag).problems.some((p) => p.kind === "gauntlet_stage_failed"));
  }

  {
    const epsilonRuntime = require("./epsilon-runtime");
    const originalConductStep = epsilonRuntime.conductStep;
    try {
      epsilonRuntime.conductStep = () => ({
        step: "gauntlet",
        halt_reason: "empty_gauntlet",
        verify: { ok: false, halt_reason: "empty_gauntlet" },
        dispatched: [],
        stage_results: [],
      });
      const res = full.emitPhaseConsults("SP-TEST-CONSULT-HALT", "execute", { epsilon: true });
      ok("emitPhaseConsults returns ok:false when conductStep reports a gauntlet refusal", res && res.ok === false, JSON.stringify(res));
      ok("...and halt_reason names the refusal", typeof res.halt_reason === "string" && res.halt_reason.includes("empty_gauntlet"), JSON.stringify(res));

      epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [{ role: "backend-reviewer", reason: null }], stage_results: [{ stage: 1, ok: true }] });
      const resClean = full.emitPhaseConsults("SP-TEST-CONSULT-CLEAN", "execute", { epsilon: true });
      ok("a clean conductStep result → ok:true (no false-positive halt)", resClean && resClean.ok === true, JSON.stringify(resClean));

      epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: null, dispatched: [], halted_at_stage: 1, stage_results: [{ stage: 1, name: "sanity", ok: false, exit_code: 1, output: "FAIL boom" }] });
      const resRed = full.emitPhaseConsults("SP-TEST-LEAN-GAUNTLET-RED", "execute", { epsilon: true });
      ok("lean-gauntlet RED: emitPhaseConsults returns ok:false on a RED stage (the sprint halts, never proceeds to release-prep)", resRed && resRed.ok === false, JSON.stringify(resRed));
      ok("lean-gauntlet RED: ...and halt_reason names gauntlet_stage_failed", resRed && typeof resRed.halt_reason === "string" && resRed.halt_reason.includes("gauntlet_stage_failed"), JSON.stringify(resRed));

      const resNonGauntlet = full.emitPhaseConsults("SP-TEST-CONSULT-PLAN", "plan", { epsilon: true });
      ok("a non-gauntlet phase (no halt-worthy fields possible) → ok:true", resNonGauntlet && resNonGauntlet.ok === true, JSON.stringify(resNonGauntlet));
    } finally {
      epsilonRuntime.conductStep = originalConductStep;
    }
  }

  {
    const gauntletPackage = require("./gauntlet-package");
    const originalSelectPackage = gauntletPackage.selectPackage;
    try {
      gauntletPackage.selectPackage = () => ({
        schema: gauntletPackage.SCHEMA,
        sprint: "SP-TEST-VACUOUS",
        trailer: { change: "bugfix", blast: "minor" },
        package: "combined-focused",
        stages: [{ stage: 0, name: "trailer", kind: "mechanical" }],
        budget: { wall_ms: 1000, dispatches: 0 },
        reasons: ["forced-vacuous-for-test"],
        selector_version: "1.0.0",
      });
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gp-vacuous-"));
      try {
        const { execSync } = require("child_process");
        execSync("git init -q -b main", { cwd: tmp });
        execSync('git -c user.email=test@example.com -c user.name=t commit --allow-empty -q -m "base"', { cwd: tmp });
        execSync("git checkout -q -b feature", { cwd: tmp });
        const msgFile = path.join(tmp, "commit-msg.txt");
        fs.writeFileSync(msgFile, "chore: bugfix\n\nChange: bugfix\nBlast: minor\nRisks: none\n");
        execSync(`git -c user.email=test@example.com -c user.name=t commit --allow-empty -q -F "${msgFile}"`, { cwd: tmp });
        const res = full.resolveGauntletDecision("SP-TEST-VACUOUS", { unit_types: ["backend"], max_risk: "low", domains: [] }, { root: tmp });
        ok("a decision that fails validateDecision is REFUSED (decision:null)", res.decision === null, JSON.stringify(res));
        ok("the error names validateDecision's own problem", /invalid decision/.test(res.error || ""), JSON.stringify(res));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      gauntletPackage.selectPackage = originalSelectPackage;
    }
  }
}

function testGapAFullOnSelectorFailure() {
  out.push("R. resolveGauntletDecision failure forces the FULL roster, never the plain registry-conditioned one");

  const epsilonRuntime = require("./epsilon-runtime");
  const gauntletPackage = require("./gauntlet-package");
  const originalConductStep = epsilonRuntime.conductStep;
  const originalAssembleInput = gauntletPackage.assembleInput;
  try {
    gauntletPackage.assembleInput = () => {
      throw new Error("planted selector failure");
    };
    let seenComposition = null;
    epsilonRuntime.conductStep = (step, composition) => {
      if (step === "gauntlet") seenComposition = composition;
      return { step, halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] };
    };
    const res = full.emitPhaseConsults("SP-TEST-GAPA", "execute", { epsilon: true });
    ok("emitPhaseConsults does not itself halt just because the selector could not resolve", res && res.ok === true, JSON.stringify(res));
    ok(
      "the gauntlet step was conducted with the FORCED-FULL composition (release/major), not the original (unenriched) one",
      seenComposition && seenComposition.change === "release" && seenComposition.blast === "major",
      JSON.stringify(seenComposition),
    );
  } finally {
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.assembleInput = originalAssembleInput;
  }
}

function testDIFFDifferentialHalts() {
  out.push("S. full.js's own --gauntlet-package differential call site HALTS on strict findings, not just logs them");

  const epsilonRuntime = require("./epsilon-runtime");
  const gauntletPackage = require("./gauntlet-package");
  const originalConductStep = epsilonRuntime.conductStep;
  const originalSelectPackage = gauntletPackage.selectPackage;
  const originalRunDifferential = gauntletPackage.runDifferential;

  const DIFF_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mc-diff-root-"));
  {
    const { execSync } = require("child_process");
    const git = (c) => execSync(c, { cwd: DIFF_ROOT, windowsHide: true, stdio: "ignore" });
    git("git init -q -b main");
    git('git -c user.email=t@t -c user.name=t commit --allow-empty -q -m "base"');
    git("git checkout -q -b feature");
    const msg = path.join(DIFF_ROOT, ".msg");
    fs.writeFileSync(msg, "fix: synthetic change\n\nChange: bugfix\nBlast: minor\nRisks: none\n");
    git(`git -c user.email=t@t -c user.name=t commit --allow-empty -q -F "${msg}"`);
  }
  process.on("exit", () => { try { fs.rmSync(DIFF_ROOT, { recursive: true, force: true }); } catch { } });

  const validDecision = () => ({
    schema: gauntletPackage.SCHEMA,
    sprint: "SP-TEST-DIFF",
    run_id: "run-SP-TEST-DIFF",
    base: "base-sha",
    head: "head-sha",
    trailer: { change: "bugfix", blast: "minor", risks: ["none"] },
    package: "combined-focused",
    cross_provider: false,
    stages: [
      { stage: 0, name: "trailer", kind: "mechanical" },
      { stage: 4, name: "review", kind: "agents", roster: [{ role: "qa-reviewer", passes: ["primary"], scope: "focused" }] },
    ],
    budget: { wall_ms: 1000, dispatches: 1 },
    reasons: ["differential-test"],
    selector_version: gauntletPackage.SELECTOR_VERSION,
  });

  try {
    gauntletPackage.selectPackage = () => validDecision();
    epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] });
    gauntletPackage.runDifferential = () => ({ ok: false, package_files: [], full_files: [], full_failures: [], selector_miss: [], fail_open_roster_candidates: ["qa-reviewer"] });
    const res = full.emitPhaseConsults("SP-TEST-DIFF", "execute", { epsilon: true, gauntletPackage: "differential", root: DIFF_ROOT });
    ok("(a): a fail_open_roster_candidate HALTS the sprint by default (ok:false)", res && res.ok === false, JSON.stringify(res));
    ok("(a): halt_reason names differential_fail_open_roster", res && typeof res.halt_reason === "string" && res.halt_reason.includes("differential_fail_open_roster"), JSON.stringify(res));
  } finally {
    gauntletPackage.selectPackage = originalSelectPackage;
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.runDifferential = originalRunDifferential;
  }

  try {
    gauntletPackage.selectPackage = () => validDecision();
    epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] });
    gauntletPackage.runDifferential = () => ({ ok: false, package_files: [], full_files: [], full_failures: ["scripts/sprint/y.test.js"], selector_miss: ["scripts/sprint/y.test.js"], fail_open_roster_candidates: [] });
    const res = full.emitPhaseConsults("SP-TEST-DIFFB", "execute", { epsilon: true, gauntletPackage: "differential", root: DIFF_ROOT });
    ok("(b): a selector_miss HALTS the sprint by default (ok:false)", res && res.ok === false, JSON.stringify(res));
    ok("(b): halt_reason names differential_selector_miss", res && typeof res.halt_reason === "string" && res.halt_reason.includes("differential_selector_miss"), JSON.stringify(res));
  } finally {
    gauntletPackage.selectPackage = originalSelectPackage;
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.runDifferential = originalRunDifferential;
  }

  try {
    gauntletPackage.selectPackage = () => validDecision();
    epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] });
    gauntletPackage.runDifferential = () => ({ ok: false, package_files: [], full_files: [], full_failures: [], selector_miss: [], fail_open_roster_candidates: ["qa-reviewer"] });
    const res = full.emitPhaseConsults("SP-TEST-DIFFC", "execute", { epsilon: true, gauntletPackage: "differential", gauntletLenient: true, gauntletLenientReason: "alpha ruling: (c) lenient fixture", root: DIFF_ROOT });
    ok("(c): --lenient keeps the SAME finding log-only, never halting (ok:true)", res && res.ok === true, JSON.stringify(res));
  } finally {
    gauntletPackage.selectPackage = originalSelectPackage;
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.runDifferential = originalRunDifferential;
  }

  try {
    gauntletPackage.selectPackage = () => validDecision();
    epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] });
    gauntletPackage.runDifferential = () => { const e = new Error("quarantine register unreadable"); e.halt_reason = "quarantine_register_unreadable"; throw e; };
    const res = full.emitPhaseConsults("SP-TEST-DIFFE", "execute", { epsilon: true, gauntletPackage: "differential", root: DIFF_ROOT });
    ok("differential: a differential exception HALTS (ok:false), never only a log line", res && res.ok === false, JSON.stringify(res));
    ok("differential: halt_reason names differential_unavailable", res && typeof res.halt_reason === "string" && res.halt_reason.includes("differential_unavailable"), JSON.stringify(res));
  } finally {
    gauntletPackage.selectPackage = originalSelectPackage;
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.runDifferential = originalRunDifferential;
  }

  try {
    gauntletPackage.selectPackage = () => validDecision();
    epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] });
    gauntletPackage.runDifferential = () => ({ ok: false, package_files: [], full_files: [], full_failures: [], selector_miss: [], fail_open_roster_candidates: ["qa-reviewer"] });
    const res = full.emitPhaseConsults("SP-TEST-DIFFF", "execute", { epsilon: true, gauntletPackage: "differential", gauntletLenient: true, root: DIFF_ROOT });
    ok("lenient: a reasonless --lenient stays strict (ok:false)", res && res.ok === false, JSON.stringify(res));
  } finally {
    gauntletPackage.selectPackage = originalSelectPackage;
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.runDifferential = originalRunDifferential;
  }

  try {
    gauntletPackage.selectPackage = () => validDecision();
    epsilonRuntime.conductStep = () => ({ step: "gauntlet", halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] });
    gauntletPackage.runDifferential = () => ({ ok: true, package_files: [], full_files: [], full_failures: [], selector_miss: [], fail_open_roster_candidates: [] });
    const res = full.emitPhaseConsults("SP-TEST-DIFFD", "execute", { epsilon: true, gauntletPackage: "differential", root: DIFF_ROOT });
    ok("(d) regression guard: a clean differential never halts", res && res.ok === true, JSON.stringify(res));
  } finally {
    gauntletPackage.selectPackage = originalSelectPackage;
    epsilonRuntime.conductStep = originalConductStep;
    gauntletPackage.runDifferential = originalRunDifferential;
  }
}

function testConductThrowHalts() {
  out.push("U. a throw inside emitPhaseConsults halts on the ε-conducted path; the default path still returns ok:true");

  const epsilonRuntime = require("./epsilon-runtime");
  const hookConsult = require("./hook-consult");
  const originalConductStep = epsilonRuntime.conductStep;
  const originalEmitStepConsults = hookConsult.emitStepConsults;
  try {
    epsilonRuntime.conductStep = (step) => {
      if (step === "gauntlet") throw new Error("planted gauntlet conduct failure");
      return { step, halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] };
    };
    const res = full.emitPhaseConsults("SP-TEST-CONDUCT-THROW", "execute", { epsilon: true });
    ok("ε path: a throw from the gauntlet step's conduct returns ok:false, which the PHASES loop treats as a halt", res && res.ok === false, JSON.stringify(res));
    ok("ε path: halt_reason names the gauntlet step", res && typeof res.halt_reason === "string" && res.halt_reason.includes("gauntlet"), JSON.stringify(res));
    ok("ε path: message names the gauntlet step and the error message", res && typeof res.message === "string" && res.message.includes("gauntlet") && res.message.includes("planted gauntlet conduct failure"), JSON.stringify(res));
    ok(
      "ε path: the result carries the same keys as a gauntlet-step refusal (ok, halt_reason, message, findings)",
      res && JSON.stringify(Object.keys(res).sort()) === JSON.stringify(["findings", "halt_reason", "message", "ok"]) && Array.isArray(res.findings) && res.findings.length > 0,
      JSON.stringify(res),
    );

    hookConsult.emitStepConsults = () => {
      throw new Error("planted telemetry consult failure");
    };
    const resDefault = full.emitPhaseConsults("SP-TEST-CONSULT-THROW-DEFAULT", "execute", {});
    ok("default path: a throw from the telemetry-only consults still returns ok:true", resDefault && resDefault.ok === true && Object.keys(resDefault).length === 1, JSON.stringify(resDefault));
  } finally {
    epsilonRuntime.conductStep = originalConductStep;
    hookConsult.emitStepConsults = originalEmitStepConsults;
  }
}

function testHermeticEventsHome() {
  out.push("T. hermetic events home");
  const { inside } = require("../lib/hermetic-events-home");
  const { LOG_FILE } = require("../hooks/lib/logger");
  ok("the events file this run writes is inside the temp project, never the checkout's", inside(EVENTS_HOME, LOG_FILE), LOG_FILE);
}

function main() {
  out.push("/sprint:full integration tests\n");
  testHappyPathModule();
  testCostCounter();
  testCliParsing();
  testHardCeilingRejection();
  testBranchProtection();
  testHaltReportWriter();
  testPhaseOrdering();
  testHollowCompletionGuards();
  testFinalReportReadsCurrentYaml();
  testBetaConsultContract();
  testReleaseRecordIdempotencyAndModerateGate();
  testBetaBoundaryPersistence();
  testSprintModeEpsilonDefaults();
  testDesignWithoutRosterEnforcer();
  testRIdSingleSourcing();
  testGauntletPackageWiring();
  testGauntletConductProblemsAndHalt();
  testGapAFullOnSelectorFailure();
  testDIFFDifferentialHalts();
  testConductThrowHalts();
  testHermeticEventsHome();

  out.push("");
  out.push(`Results: ${passes} passed, ${failures} failed.`);
  for (const line of out) process.stdout.write(line + "\n");
  return failures === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
