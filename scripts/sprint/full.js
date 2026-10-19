#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execSync, execFileSync } = require("child_process");

const SPRINT = require("./paths");
const {
  readYamlMaybe,
  writeYaml,
  ensureDir,
  nowIso,
  writeText,
} = require("./fs");
const heartbeat = require("./heartbeat");
const hookPoints = require("./hook-points");
const hookConsult = require("./hook-consult");
const epsilonRuntime = require("./epsilon-runtime");

const PHASE_TO_HOOK_STEPS = Object.freeze({
  plan: ["plan"],
  design: ["design"],
  execute: ["build", "gauntlet"],
  "release-prep": ["release"],
  retro: ["retro"],
});

function sprintComposition(sprintId) {
  const tickets = [];
  try {
    for (const f of fs.readdirSync(SPRINT.tickets)) {
      if (!/\.(ya?ml|json)$/.test(f)) continue;
      const t = readYamlMaybe(path.join(SPRINT.tickets, f));
      if (t && t.sprint === sprintId) tickets.push(t);
    }
  } catch {
  }
  return hookPoints.compositionFromTickets(tickets);
}

function resolveGauntletDecision(sprintId, composition, opts = {}) {
  try {
    const gauntletPackage = require("./gauntlet-package");
    const changeTrailer = require("../checks/change-trailer");
    const { execSync } = require("child_process");
    const root = opts.root || REPO_ROOT;

    let trailer = null;
    if (composition.change && composition.blast) {
      let headMsg = null;
      try {
        headMsg = execSync("git log -1 --format=%B HEAD", { cwd: root, encoding: "utf8", windowsHide: true });
      } catch {
        headMsg = null;
      }
      const ticketTrailer = { change: composition.change, blast: composition.blast, risks: composition.risks || ["none"] };
      const parsedHead = headMsg === null ? null : changeTrailer.parse(headMsg);
      const headTrailerPresent = Boolean(
        parsedHead && (parsedHead.change !== null || parsedHead.blast !== null || parsedHead.risks !== null || (parsedHead.errors || []).length > 0),
      );
      const hv = parsedHead === null ? null : changeTrailer.validate(parsedHead);
      if (headTrailerPresent && hv && !hv.ok) {
        return {
          decision: null,
          halt_reason: "change_trailer_invalid",
          error: `change_trailer_invalid: HEAD commit carries an invalid change-classification trailer (cannot reconcile against the ticket's ${JSON.stringify(ticketTrailer)}): ${hv.errors.join("; ")}`,
        };
      }
      if (!headTrailerPresent) {
        let baseForSprintCheck = null;
        try {
          baseForSprintCheck = execFileSync("git", ["merge-base", "HEAD", opts.defaultBranch || "main"], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
        } catch {
          baseForSprintCheck = null;
        }
        let headForSprintCheck = null;
        try {
          headForSprintCheck = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8", windowsHide: true }).trim();
        } catch {
          headForSprintCheck = null;
        }
        const sprint = changeTrailer.activeSprintAtRef(root, { base: baseForSprintCheck, head: headForSprintCheck });
        if (!sprint.ok) {
          return {
            decision: null,
            halt_reason: "sprint_registry_unreadable",
            error: `sprint_registry_unreadable: ${sprint.reason}`,
          };
        }
        if (sprint.active) {
          return {
            decision: null,
            halt_reason: "change_trailer_missing",
            error: `change_trailer_missing: HEAD commit carries no change-classification trailer while sprint ${sprint.id} is active — the ticket's own classification (${JSON.stringify(ticketTrailer)}) may only widen an existing HEAD trailer, never substitute for a missing one`,
          };
        }
      }
      if (hv && hv.ok) {
        const cmp = changeTrailer.compareClassification(ticketTrailer, hv.value);
        if (cmp.blocked) {
          return { decision: null, error: `change-trailer downgrade blocked: ticket declared ${JSON.stringify(ticketTrailer)}, HEAD commit trailer is lower (${cmp.downgrades.join(", ")})` };
        }
        Object.assign(ticketTrailer, changeTrailer.widenClassification(ticketTrailer, hv.value));
      }
      trailer = { ...ticketTrailer, source: "ticket" };
    } else {
      const headMsg = execSync("git log -1 --format=%B HEAD", { cwd: root, encoding: "utf8", windowsHide: true });
      const v = changeTrailer.validate(headMsg);
      if (!v.ok) return { decision: null, error: `no ticket classification and HEAD trailer invalid: ${v.errors.join("; ")}` };
      trailer = { ...v.value, source: "commit" };
    }

    const defaultBranch = opts.defaultBranch || "main";
    const head = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    let base;
    try {
      base = execFileSync("git", ["merge-base", "HEAD", defaultBranch], { cwd: root, encoding: "utf8", windowsHide: true }).trim();
    } catch {
      return { decision: null, error: `no_base: could not resolve merge-base HEAD ${defaultBranch} (missing/unreachable default branch)` };
    }
    if (!base || base === head) return { decision: null, error: "base === head (nothing to diff yet) — skipping the selector for this run" };

    const assembled = gauntletPackage.assembleInput({ root, trailer, composition, base, head, sprint: sprintId, runId: `run-${sprintId}-${Date.now()}` });
    const decision = gauntletPackage.selectPackage(assembled);
    if (decision.halt_reason) return { decision: null, error: decision.error || decision.halt_reason };
    const problems = gauntletPackage.validateDecision(decision);
    if (problems.length) return { decision: null, error: `selectPackage produced an invalid decision: ${problems.join("; ")}` };
    return { decision, error: null };
  } catch (e) {
    return { decision: null, error: `resolveGauntletDecision failed: ${e.message}` };
  }
}

function gauntletConductProblems(result) {
  if (!result || typeof result !== "object") return { problems: [], focusedTestsZero: false };
  const problems = [];
  if (result.halt_reason) problems.push({ kind: result.halt_reason, detail: `gauntlet step halted: ${result.halt_reason}` });
  if (result.verify && result.verify.ok === false) {
    problems.push({ kind: "gauntlet_verify_failed", detail: result.verify.halt_reason || result.verify.error || "gauntlet-verify reported ok:false" });
  }
  for (const d of Array.isArray(result.dispatched) ? result.dispatched : []) {
    if (d && d.reason === "empty_review_scope_refused") {
      problems.push({ kind: "empty_review_scope_refused", detail: `role '${d.role}' refused an empty review scope` });
    }
  }
  const stageResults = Array.isArray(result.stage_results) ? result.stage_results : [];
  const failedStages = stageResults.filter((sr) => sr && sr.ok === false);
  if (Number.isInteger(result.halted_at_stage) || failedStages.length) {
    const failing = failedStages.find((sr) => sr.stage === result.halted_at_stage) || failedStages[0] || null;
    const out = failing && typeof failing.output === "string" && failing.output.trim() ? `\n${failing.output.trim()}` : "";
    const where = Number.isInteger(result.halted_at_stage) ? result.halted_at_stage : failing && failing.stage;
    problems.push({ kind: "gauntlet_stage_failed", detail: `gauntlet stage ${where}${failing && failing.name ? ` (${failing.name})` : ""} failed${failing && failing.failed_cmd ? ` [${failing.failed_cmd}]` : ""}${failing && failing.exit_code !== undefined ? ` exit ${failing.exit_code}` : ""}${out}` });
  }
  const focusedTestsZero = (Array.isArray(result.stage_results) ? result.stage_results : []).some((sr) => sr && sr.finding === "focused_tests:0");
  return { problems, focusedTestsZero };
}

function emitPhaseConsults(sprintId, phase, opts = {}) {
  const steps = PHASE_TO_HOOK_STEPS[phase] || [];
  if (!steps.length || !sprintId) return { ok: true };
  let gauntletResult = null;
  const differentialProblems = [];
  let conductingStep = null;
  try {
    const composition = sprintComposition(sprintId);
    if (opts.epsilon) {
      for (const step of steps) {
        conductingStep = step;
        if (step === "gauntlet") {
          if (opts.gauntletPackage === "full") {
            process.stderr.write(`[full.js] gauntlet-package: "full" escape hatch — skipping the lean selector, forcing today's full roster (sprint ${sprintId}).\n`);
            gauntletResult = epsilonRuntime.conductStep(step, { ...composition, change: "release", blast: "major" }, sprintId, { dispatch: !!opts.epsilonDispatch });
            continue;
          }
          const { decision, error } = resolveGauntletDecision(sprintId, composition, { root: opts.root });
          if (decision) {
            gauntletResult = epsilonRuntime.conductStep(step, composition, sprintId, { dispatch: !!opts.epsilonDispatch, gauntletDecision: decision });
            if (opts.gauntletPackage === "differential") {
              try {
                const gauntletPackage = require("./gauntlet-package");
                const diff = gauntletPackage.runDifferential(decision, { root: opts.root || REPO_ROOT, strict: true });
                const lenientReason = typeof opts.gauntletLenientReason === "string" ? opts.gauntletLenientReason.trim() : "";
                const lenient = Boolean(opts.gauntletLenient) && Boolean(lenientReason);
                if (opts.gauntletLenient && !lenientReason) {
                  process.stderr.write(`[full.js] gauntlet-package: --lenient REFUSED without --lenient-reason <text> — staying strict (sprint ${sprintId}).\n`);
                }
                if (diff.selector_miss.length) {
                  process.stderr.write(`[full.js] gauntlet-package: --differential found ${diff.selector_miss.length} selector_miss file(s) the "${decision.package}" package never covered: ${diff.selector_miss.join(", ")} (sprint ${sprintId}).\n`);
                  if (!lenient) differentialProblems.push({ kind: "differential_selector_miss", detail: `--differential found ${diff.selector_miss.length} selector_miss file(s) the "${decision.package}" package never covered: ${diff.selector_miss.join(", ")}` });
                }
                if (diff.fail_open_roster_candidates && diff.fail_open_roster_candidates.length) {
                  process.stderr.write(`[full.js] gauntlet-package: --differential found fail_open_roster_candidate(s) (matched_via:"unknown-open"): ${diff.fail_open_roster_candidates.join(", ")} (sprint ${sprintId}).\n`);
                  if (!lenient) differentialProblems.push({ kind: "differential_fail_open_roster", detail: `--differential found fail_open_roster_candidate(s) (matched_via:"unknown-open"): ${diff.fail_open_roster_candidates.join(", ")}` });
                }
                if (lenient && (diff.selector_miss.length || (diff.fail_open_roster_candidates && diff.fail_open_roster_candidates.length))) {
                  try {
                    const { log } = require("../hooks/lib/logger");
                    log("audit", { kind: "gauntlet-differential-lenient", sprint: sprintId, lenient_reason: lenientReason, selector_miss: diff.selector_miss, fail_open_roster_candidates: diff.fail_open_roster_candidates || [] }, { actor: "full.js", source: "scripts/sprint/full.js" });
                  } catch { }
                  process.stderr.write(`[full.js] gauntlet-package: --lenient — the finding(s) above are logged, not gating, for sprint ${sprintId}.\n`);
                }
              } catch (e) {
                process.stderr.write(`[full.js] gauntlet-package: --differential could not run (${e.message}) — differential_unavailable HALTS under strict (sprint ${sprintId}).\n`);
                differentialProblems.push({ kind: "differential_unavailable", detail: `--differential could not run: ${e.message}${e.halt_reason ? ` (${e.halt_reason})` : ""}` });
              }
            }
          } else {
            process.stderr.write(`[full.js] gauntlet-package: selector unavailable this run (${error}) — forcing the FULL roster (never falling open to a narrower gauntlet) (sprint ${sprintId}).\n`);
            gauntletResult = epsilonRuntime.conductStep(step, { ...composition, change: "release", blast: "major" }, sprintId, { dispatch: !!opts.epsilonDispatch });
          }
          continue;
        }
        epsilonRuntime.conductStep(step, composition, sprintId, { dispatch: !!opts.epsilonDispatch });
      }
    } else {
      for (const step of steps) hookConsult.emitStepConsults(step, composition, sprintId);
      if (steps.includes("build") || steps.includes("gauntlet")) {
        hookConsult.emitDesignTouch(composition, sprintId);
      }
    }
  } catch (e) {
    if (opts.epsilon) {
      const where = conductingStep ? `the ${conductingStep} step` : "reading the sprint composition";
      const detail = `${where} threw: ${e && e.message ? e.message : String(e)}`;
      const kind = `conduct_threw:${conductingStep || "composition"}`;
      return { ok: false, halt_reason: kind, message: detail, findings: [{ kind, detail }] };
    }
  }

  const { problems: conductProblems, focusedTestsZero } = gauntletConductProblems(gauntletResult);
  const problems = [...conductProblems, ...differentialProblems];
  if (focusedTestsZero) {
    process.stderr.write(`[full.js] gauntlet: stage 1 (sanity) finding focused_tests:0 — an empty Focused test set (sprint ${sprintId}).\n`);
  }
  if (problems.length) {
    return {
      ok: false,
      halt_reason: `gauntlet_step_refused:${problems.map((p) => p.kind).join(",")}`,
      message: problems.map((p) => p.detail).join("; "),
      findings: problems,
    };
  }
  return { ok: true };
}

const REPO_ROOT = SPRINT.PROJECT;
const PATHS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
);

const HARD_CEILINGS = Object.freeze([
  "push_to_remote",
  "paid_service_signup",
  "production_deploy",
  "destructive_migration",
  "secret_to_remote",
]);

const FORBIDDEN_PRE_AUTH = Object.freeze([
  "production_release_approval",
  "paid_service_approval",
]);

const PHASES = Object.freeze([
  "plan",
  "design",
  "execute",
  "release-prep",
  "retro",
]);

const PHASE_TYPICAL_SPEND_USD = Object.freeze({
  plan: 0.75,
  design: 2.0,
  execute: 1.5,
  "release-prep": 0.5,
  retro: 0.5,
});

function parseArgs(argv) {
  const out = {
    request: null,
    autonomy: "moderate",
    scope: "recommended",
    documentationScale: "auto",
    mode: null,
    sprint: null,
    resume: false,
    allowMain: false,
    costAcknowledged: false,
    help: false,
    betaVerdict: null,
    betaMessage: null,
    pendingPhase: null,
    costGate: null,
    epsilon: mcEnv.readEnv("EPSILON_RUNTIME") === "on",
    epsilonDispatch: false,
    _epsilonExplicit: false,
    _epsilonDispatchExplicit: false,
    gauntletPackage: "auto",
    gauntletLenient: false,
    gauntletLenientReason: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--autonomy") out.autonomy = argv[++i];
    else if (a === "--scope") out.scope = argv[++i];
    else if (a === "--documentation-scale") out.documentationScale = argv[++i];
    else if (a === "--mode") out.mode = argv[++i];
    else if (a === "--sprint") out.sprint = argv[++i];
    else if (a === "--resume") out.resume = true;
    else if (a === "--allow-main") out.allowMain = true;
    else if (a === "--cost-acknowledged") out.costAcknowledged = true;
    else if (a === "--beta-verdict") out.betaVerdict = argv[++i];
    else if (a === "--beta-message") out.betaMessage = argv[++i];
    else if (a === "--pending-phase") out.pendingPhase = argv[++i];
    else if (a === "--cost-gate") out.costGate = argv[++i];
    else if (a === "--gauntlet-package") {
      const v = argv[++i];
      out.gauntletPackage = v === "full" ? "full" : v === "differential" ? "differential" : "auto";
    }
    else if (a === "--lenient-reason") out.gauntletLenientReason = argv[++i];
    else if (a === "--lenient") out.gauntletLenient = true;
    else if (a === "--epsilon") { out.epsilon = true; out._epsilonExplicit = true; }
    else if (a === "--epsilon-dispatch") {
      out.epsilon = true; out.epsilonDispatch = true;
      out._epsilonExplicit = true; out._epsilonDispatchExplicit = true;
    }
    else if (a === "--no-epsilon") {
      out.epsilon = false; out.epsilonDispatch = false;
      out._epsilonExplicit = true; out._epsilonDispatchExplicit = true;
    }
    else if (a === "--no-epsilon-dispatch") {
      out.epsilonDispatch = false; out._epsilonDispatchExplicit = true;
    }
    else if (!a.startsWith("--") && out.request === null) out.request = a;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`
/sprint:full — autonomous sprint orchestrator

Usage:
  node scripts/sprint/full.js "<request>" [flags]

Flags:
  --autonomy <preset>           conservative | moderate (default) | aggressive
  --scope <variant>             minimal_safe | recommended (default) | expanded
  --documentation-scale <s>     auto (default) | xs | s | m | l | xl
  --mode <m>                    solo | adhoc (default: current session mode)
  --sprint <SP-id>              target a specific sprint (default: new sprint)
  --resume                      resume an in-progress run; requires --sprint
  --allow-main                  override branch-protection (requires aggressive)
  --cost-acknowledged           raise cost threshold 2x for this run only
  --cost-gate <on|off>          override the cost-estimate halt for this run
                                (persistent toggle: scripts/sprint/cost-gate.js)
  --beta-verdict <v>            DECIDE | DIRECTIVE | ESCALATE — verdict from Beta consultation
  --beta-message "<text>"       message accompanying the Beta verdict
  --pending-phase <boundary>    phase boundary the verdict applies to (e.g. before_plan)
  --epsilon                     ε-conduct the sprint: run each phase's hook-points through
                                the ε runtime (registry-driven) instead of telemetry-only
                                consults (ADR-0009; additive — default is the script path)
  --epsilon-dispatch            as --epsilon, and ALSO write a real per-agent completion
                                record per dispatched agent (the liveness ledger)
  --help, -h                    show this message

Hard ceilings (never bypassable by any preset):
  ${HARD_CEILINGS.join(", ")}

Preset semantics documentation is not included in this release.
`);
}

function emit(kind, data) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("audit", { kind, ...data }, { actor: "alpha", source: "/sprint:full" });
  } catch {
  }
}

function loadPreset(name) {
  const cfgPath = path.join(REPO_ROOT, PATHS.sprintFullAutonomy);
  if (!fs.existsSync(cfgPath)) {
    return {
      ok: false,
      error: `autonomy config missing at ${cfgPath}. /sprint:full cannot run without a preset bundle.`,
    };
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (err) {
    return { ok: false, error: `autonomy config parse error: ${err.message}` };
  }
  if (!cfg.presets || !cfg.presets[name]) {
    const available = Object.keys(cfg.presets || {}).join(", ") || "(none)";
    return {
      ok: false,
      error: `unknown preset '${name}'. Valid: ${available}.`,
    };
  }
  const preset = cfg.presets[name];

  for (const level of preset.pre_authorized_approval_levels || []) {
    if (FORBIDDEN_PRE_AUTH.includes(level)) {
      return {
        ok: false,
        error: `preset '${name}' attempts to pre-authorize forbidden level '${level}'. HARD CEILING. Fix the preset config.`,
      };
    }
  }
  for (const target of preset.release_approval_targets || []) {
    if (target === "production") {
      return {
        ok: false,
        error: `preset '${name}' attempts to pre-authorize production release. HARD CEILING. Fix the preset config.`,
      };
    }
  }
  const declared = (cfg.hard_ceilings || []).slice().sort();
  const expected = HARD_CEILINGS.slice().sort();
  const match =
    declared.length === expected.length &&
    declared.every((v, i) => v === expected[i]);
  if (!match) {
    return {
      ok: false,
      error: `autonomy config hard_ceilings[] drift from hardcoded enum. Declared=${JSON.stringify(declared)} expected=${JSON.stringify(expected)}.`,
    };
  }
  return { ok: true, preset };
}

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function checkBranchProtection(args, preset, sprintId) {
  const branch = currentBranch();
  if (!branch) return { ok: true };
  const onMain = branch === "main" || branch === "master";
  if (!onMain) return { ok: true };
  const allowMainEffective =
    args.allowMain && preset.branch_protection_allow_main === true;
  if (allowMainEffective) {
    emit("sprint_full_branch_protection_override", {
      sprint_id: sprintId,
      current_branch: branch,
      preset: preset.preset_name,
    });
    return { ok: true };
  }
  emit("sprint_full_branch_protection_blocked", {
    sprint_id: sprintId,
    current_branch: branch,
    allow_main_set: args.allowMain,
    preset: preset.preset_name,
    ts: nowIso(),
  });
  return {
    ok: false,
    halt_reason: "branch_protection",
    message: `/sprint:full refused to start: current branch is ${branch}. /sprint:full commits locally throughout the run — committing to ${branch} can leak partial work. Action: switch to a feature branch via \`git switch -c sprint/<SP-id>\` then re-run. Override with --allow-main (requires --autonomy aggressive).`,
  };
}

function makeCostCounter(thresholdUsd, costAcknowledged, gateEnabled = true) {
  const effective = costAcknowledged ? thresholdUsd * 2 : thresholdUsd;
  return {
    cumulative: 0,
    threshold: effective,
    bumpedByAck: costAcknowledged,
    gateEnabled,
    add(phase, ticketCount = 1) {
      const per = PHASE_TYPICAL_SPEND_USD[phase] || 0;
      const inc = phase === "execute" ? per * ticketCount : per;
      this.cumulative += inc;
      return inc;
    },
    exceeded() {
      if (!this.gateEnabled) return false;
      return this.cumulative > this.threshold;
    },
  };
}

function runHelper(scriptRel, args, opts = {}) {
  const scriptAbs = path.join(REPO_ROOT, scriptRel);
  const result = spawnSync(process.execPath, [scriptAbs, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
  };
}

function writeHaltReport(state, halt) {
  const dir = path.join(REPO_ROOT, PATHS.sprintFullReports, state.sprintId);
  ensureDir(dir);
  const ts = nowIso();
  const safeTs = ts.replace(/[:.]/g, "-");
  const filename = `halt-${safeTs}.md`;
  const filePath = path.join(dir, filename);
  const body = `# /sprint:full halt — ${state.sprintId}

**Phase:** ${state.currentPhase}
**Halt reason:** ${halt.halt_reason}
**Preset:** ${state.preset.preset_name}
**Beta verdict (if any):** ${halt.beta_verdict || "—"}
**Resume command:** \`${halt.resume_command || `/sprint:full --sprint ${state.sprintId} --resume`}\`
**Next human action:** ${halt.next_human_action || halt.message || "Investigate halt reason and resume."}
**Timestamp:** ${ts}

## Details

${halt.message || "(no additional details)"}

## Links

- Plan Contract: ${state.planContractId ? `paths.sprintPlanContracts/${state.planContractId}.yaml` : "—"}
- Current sprint: paths.sprintSprints/${state.sprintId}/current.yaml
- Progress: paths.sprintSprints/${state.sprintId}/progress.yaml
- Run timeline so far: see events.jsonl filter kind=sprint_full_*
`;
  writeText(filePath, body, { force: true });
  emit("sprint_full_halt", {
    sprint_id: state.sprintId,
    phase: state.currentPhase,
    halt_reason: halt.halt_reason,
    resume_command:
      halt.resume_command || `/sprint:full --sprint ${state.sprintId} --resume`,
    beta_verdict: halt.beta_verdict || null,
    halt_report_path: filePath,
  });
  return filePath;
}

function writeFinalReport(state) {
  const dir = path.join(REPO_ROOT, PATHS.sprintFullReports, state.sprintId);
  ensureDir(dir);
  const filePath = path.join(dir, "sprint-full-report.md");
  const dur =
    state.timeline.length > 0 && state.startedAt
      ? (Date.now() - new Date(state.startedAt).getTime()) / 1000
      : 0;

  const currentPath = path.join(
    REPO_ROOT,
    ".claude",
    "project",
    "sprint",
    "sprints",
    state.sprintId,
    "current.yaml",
  );
  const current = readYamlMaybe(currentPath) || {};
  const lane = (k) =>
    (current.tickets && Array.isArray(current.tickets[k])
      ? current.tickets[k]
      : []);
  const doneTickets = lane("done");
  const deferredTickets = lane("deferred");
  const abandonedTickets = lane("abandoned");
  const releasedTickets = lane("released");
  let body = `# /sprint:full report — ${state.sprintId}

**Title:** ${state.sprintTitle || "(unknown)"}
**Preset:** ${state.preset.preset_name}
**Started:** ${state.startedAt}
**Completed:** ${nowIso()}
**Total duration:** ${dur.toFixed(1)}s
**Cost estimate:** $${state.cost.cumulative.toFixed(2)} (threshold $${state.cost.threshold.toFixed(2)}${state.cost.bumpedByAck ? ", bumped 2× via --cost-acknowledged" : ""})
**Outcome:** ${state.outcome || "done"}

## Phase timeline

| # | Phase | Duration | Exit | Auto-approvals | Notes |
|---|---|---|---|---|---|
`;
  for (const row of state.timeline) {
    body += `| ${row.idx} | ${row.phase} | ${row.duration_ms}ms | ${row.exit_code} | ${row.auto_approvals_recorded || 0} | ${row.notes || ""} |\n`;
  }
  body += `
## Decisions auto-approved

${
  state.autoApprovals.length === 0
    ? "(none)"
    : state.autoApprovals
        .map((a) => `- ${a.level} for ${a.linked_to} (${a.ts})`)
        .join("\n")
}

## Tickets

- Done: ${doneTickets.length}${doneTickets.length ? ` (${doneTickets.join(", ")})` : ""}
- Released: ${releasedTickets.length}${releasedTickets.length ? ` (${releasedTickets.join(", ")})` : ""}
- Deferred: ${deferredTickets.length}${deferredTickets.length ? ` (${deferredTickets.join(", ")})` : ""}
- Abandoned: ${abandonedTickets.length}${abandonedTickets.length ? ` (${abandonedTickets.join(", ")})` : ""}

## Beta consultations

${
  state.betaConsultations.length === 0
    ? "(none — solo mode or skipped)"
    : state.betaConsultations
        .map(
          (c) =>
            `- ${c.phase_boundary}: ${c.verdict}` +
            `${c.beta_message ? ` — ${c.beta_message}` : ""} (${c.ts})`,
        )
        .join("\n")
}

## Halts (recoverable)

${
  state.halts.length === 0
    ? "(none — clean run)"
    : state.halts
        .map((h) => `- ${h.phase}: ${h.halt_reason} → ${h.resume_command}`)
        .join("\n")
}
`;
  writeText(filePath, body, { force: true });
  emit("sprint_full_done", {
    sprint_id: state.sprintId,
    total_duration_ms: dur * 1000,
    tickets_done: doneTickets.length,
    tickets_released: releasedTickets.length,
    tickets_deferred: deferredTickets.length,
    tickets_abandoned: abandonedTickets.length,
    beta_consultations: state.betaConsultations.length,
    auto_approvals_total: state.autoApprovals.length,
    cumulative_cost_estimate: state.cost.cumulative,
    report_path: filePath,
  });
  return filePath;
}

function checkpoint(state, status, nextAction, resumeNotes) {
  runHelper("scripts/sprint/checkpoint.js", [
    "--sprint",
    state.sprintId,
    "--phase",
    state.currentPhase,
    "--command",
    "/sprint:full",
    "--status",
    status,
    "--last-completed-step",
    `sprint_full_${state.currentPhase}_${status}`,
    "--next-action",
    nextAction || `Continue /sprint:full --sprint ${state.sprintId} --resume`,
    "--resume-command",
    `/sprint:full --sprint ${state.sprintId} --resume`,
    "--resume-notes",
    resumeNotes ||
      `phase=${state.currentPhase} status=${status} preset=${state.preset.preset_name}`,
    "--safe-to-continue",
    "true",
  ]);
}

const BETA_VERDICTS = Object.freeze(["DECIDE", "DIRECTIVE", "ESCALATE"]);

function validateBetaVerdict(v) {
  return BETA_VERDICTS.includes(v);
}

const sanitizeBetaMessage = (m) => (m || "").replace(/[\r\n]+/g, " ").slice(0, 500);

function betaBoundariesPath(sprintId) {
  return path.join(
    REPO_ROOT,
    PATHS.sprintFullReports,
    sprintId,
    "beta-boundaries.json",
  );
}

function readClearedBetaBoundaries(sprintId) {
  try {
    const fp = betaBoundariesPath(sprintId);
    if (!fs.existsSync(fp)) return [];
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    const arr = parsed && Array.isArray(parsed.cleared) ? parsed.cleared : [];
    return arr.filter((b) => PHASES.some((p) => `before_${p}` === b));
  } catch {
    return [];
  }
}

function recordClearedBetaBoundary(sprintId, boundary) {
  try {
    const cleared = readClearedBetaBoundaries(sprintId);
    if (cleared.includes(boundary)) return;
    cleared.push(boundary);
    const fp = betaBoundariesPath(sprintId);
    ensureDir(path.dirname(fp));
    fs.writeFileSync(
      fp,
      JSON.stringify(
        { schema: "mc/sprint-full/beta-boundaries/v1", sprint: sprintId, cleared, updated_at: nowIso() },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch {
  }
}

function maybeConsultBeta(state, boundary, args) {
  if (state.mode !== "adhoc") return { ok: true, verdict: null };

  const hasVerdict =
    args && args.betaVerdict !== null && args.betaVerdict !== undefined;
  const verdictAppliesHere =
    hasVerdict &&
    (args.pendingPhase === null ||
      args.pendingPhase === undefined ||
      args.pendingPhase === boundary);

  if (!verdictAppliesHere) {
    const resumeCmd =
      `/sprint:full --sprint ${state.sprintId} --resume` +
      ` --pending-phase ${boundary}` +
      ` --beta-verdict <DECIDE|DIRECTIVE|ESCALATE>` +
      ` --beta-message "<response from Beta>"`;
    return {
      ok: false,
      halt_reason: "beta_consult_pending",
      boundary,
      message:
        `Beta consultation required at phase boundary '${boundary}'. ` +
        `Consult Beta (Alex β) about the upcoming phase, then resume: ${resumeCmd}`,
      resume_command: resumeCmd,
      next_human_action:
        `Consult Beta (Alex β) about '${boundary}', obtain a verdict ` +
        `(DECIDE | DIRECTIVE | ESCALATE), then resume with the verdict.`,
    };
  }

  const verdict = args.betaVerdict;
  if (!validateBetaVerdict(verdict)) {
    return {
      ok: false,
      halt_reason: "invalid_beta_verdict",
      boundary,
      message: `Unrecognized Beta verdict '${verdict}'. Must be DECIDE | DIRECTIVE | ESCALATE.`,
    };
  }
  const betaMessage = sanitizeBetaMessage(args.betaMessage);
  if (!betaMessage.trim()) {
    const resumeCmd =
      `/sprint:full --sprint ${state.sprintId} --resume` +
      ` --pending-phase ${boundary}` +
      ` --beta-verdict ${verdict}` +
      ` --beta-message "<Beta's actual rationale>"`;
    return {
      ok: false,
      halt_reason: "beta_message_required",
      boundary,
      beta_verdict: verdict,
      message:
        `Beta verdict '${verdict}' at phase boundary '${boundary}' was supplied with an empty beta_message. ` +
        `A consult without a rationale is a placeholder consult — refused at runtime. ` +
        `Re-consult Beta (Alex β) and resume with the real one-line rationale: ${resumeCmd}`,
      resume_command: resumeCmd,
      next_human_action:
        `Obtain Beta's actual rationale for the '${verdict}' verdict at '${boundary}', then resume with a non-empty --beta-message.`,
    };
  }

  const substanceGateOn = mcEnv.readEnv("BETA_SUBSTANCE_GATE") !== "off";
  if (substanceGateOn) {
    const m = betaMessage.trim();
    const tokenRe = /\b(DECIDE|DIRECTIVE|ESCALATE|DECISION|CLASS\s+[ABC]\b|conf(?:idence)?|0\.\d{2})\b/i;
    const groundRe = /\b(SP-\d|T-\d|EVT-|RI-\d|DP-|LRN-|L-20|ADR-|per\b|because\b|precedent|rubric|reversib|blast[- ]radius|trade-?off)\b/i;
    let cannedReason = null;
    if (m.length < 40) {
      cannedReason = `only ${m.length} chars (< 40) — too terse to be a real consult`;
    } else if (!tokenRe.test(m) && !groundRe.test(m)) {
      cannedReason = "no decision token nor grounding reference — boilerplate";
    }
    if (cannedReason) {
      const resumeCmd =
        `/sprint:full --sprint ${state.sprintId} --resume` +
        ` --pending-phase ${boundary}` +
        ` --beta-verdict ${verdict}` +
        ` --beta-message "<Beta's actual, specific rationale>"`;
      return {
        ok: false,
        halt_reason: "beta_message_non_substantive",
        boundary,
        beta_verdict: verdict,
        message:
          `Beta verdict '${verdict}' at phase boundary '${boundary}' was supplied with a NON-SUBSTANTIVE beta_message (${cannedReason}). ` +
          `Canned/boilerplate verdicts are refused at runtime (β verdicts must be real consults, not templated strings). ` +
          `Re-consult Beta (Alex β) for a specific, grounded rationale and resume: ${resumeCmd}`,
        resume_command: resumeCmd,
        next_human_action:
          `Obtain Beta's actual, specific rationale (the decision + WHY — reference the ticket/risk/precedent) for '${verdict}' at '${boundary}', then resume with a substantive --beta-message.`,
      };
    }
  }

  const ts = nowIso();
  const latencyMs = 0;
  const model = mcEnv.readEnv("BETA_MODEL") || "claude-opus-4-8";

  emit("sprint_full_beta_consult", {
    verdict,
    beta_message: betaMessage,
    latency_ms: latencyMs,
    model,
    phase_boundary: boundary,
    topic_tags: ["sprint_full_phase_boundary"],
    sprint_id: state.sprintId,
    ts,
    via_cli_resume: !!(args && args.resume),
    substance_gate: substanceGateOn ? "on" : "off",
  });

  state.betaConsultations.push({
    phase_boundary: boundary,
    verdict,
    beta_message: betaMessage,
    latency_ms: latencyMs,
    model,
    ts,
  });

  args.betaVerdict = null;
  args.betaMessage = null;
  if (args.pendingPhase === boundary) args.pendingPhase = null;

  if (verdict === "DECIDE") {
    return { ok: true, verdict: "DECIDE" };
  }

  if (verdict === "DIRECTIVE") {
    if (!state.betaDirectives) state.betaDirectives = [];
    state.betaDirectives.push({ boundary, message: betaMessage, ts });
    return { ok: true, verdict: "DIRECTIVE", directive: betaMessage };
  }

  if (verdict === "ESCALATE") {
    return {
      ok: false,
      halt_reason: "beta_escalate",
      boundary,
      beta_verdict: "ESCALATE",
      message:
        `Beta ESCALATE at phase boundary '${boundary}': ${betaMessage}. ` +
        `Resolve the escalation with Alpha (${boundary} phase cannot proceed until ` +
        `Beta clears it), then resume with a DECIDE or DIRECTIVE verdict.`,
      resume_command:
        `/sprint:full --sprint ${state.sprintId} --resume` +
        ` --pending-phase ${boundary}` +
        ` --beta-verdict <DECIDE|DIRECTIVE>` +
        ` --beta-message "<resolution>"`,
      next_human_action:
        `Resolve Beta escalation for '${boundary}', then resume with DECIDE or DIRECTIVE.`,
    };
  }

  /* c8 ignore next */
  return { ok: false, halt_reason: "invalid_beta_verdict", boundary, message: `Unexpected verdict state for '${verdict}'.` };
}

function checkDesignWithoutRoster(sprintId) {
  try {
    const completionsPath = path.join(REPO_ROOT, PATHS.dispatchCompletionsFile);
    const hasLedger = fs.existsSync(completionsPath);
    let hasDesignRecord = false;
    if (hasLedger) {
      const lines = fs.readFileSync(completionsPath, "utf8").split(/\r?\n/).filter(Boolean);
      const _reqSig = mcEnv.readEnv("LIVENESS_REQUIRE_SIG") !== "0";
      hasDesignRecord = lines.some((line) => {
        try {
          const rec = JSON.parse(line);
          return rec.sprint === sprintId && rec.step === "design" && isVerifiedLivenessRecord(rec, { requireSignature: _reqSig });
        } catch { return false; }
      });
    }
    if (!hasDesignRecord) {
      emit("design_without_roster", {
        sprint_id: sprintId,
        ledger_exists: hasLedger,
        warning:
          "design artifacts scaffolded but no ε-dispatch roster records found for " +
          "design step — consult records may be telemetry-only (report-only, enforcer-ramp)",
        enforcement: "report-only",
      });
    }
  } catch {
  }
}

function phase1Plan(state, args) {
  state.currentPhase = "plan";
  mcEnv.setEnv("PHASE_ID", state.currentPhase);
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "plan",
    phase_index: 0,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();

  const current = readYamlMaybe(
    path.join(
      REPO_ROOT,
      ".claude",
      "project",
      "sprint",
      "sprints",
      state.sprintId,
      "current.yaml",
    ),
  );
  if (state.resuming && current && current.plan_contract) {
    state.planContractId = path.basename(current.plan_contract, ".yaml");
    state.sprintTitle = current.title;
    state.timeline.push({
      idx: 1,
      phase: "plan",
      duration_ms: 0,
      exit_code: 0,
      notes: "skipped (resume)",
    });
    state.cost.add("plan");
    return { ok: true, skipped: true };
  }

  const payloadGlob = `${REPO_ROOT}/.mc/plan-payload-*.json`;
  let payloadFile = null;
  try {
    const candidates = fs
      .readdirSync(path.join(REPO_ROOT, ".mc"))
      .filter((f) => f.startsWith("plan-payload-") && f.endsWith(".json"))
      .map((f) => path.join(REPO_ROOT, ".mc", f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    payloadFile = candidates[0] || null;
  } catch {
  }
  if (!payloadFile) {
    return {
      ok: false,
      halt_reason: "plan_payload_missing",
      message:
        "Phase 1 (plan) requires a payload JSON at .mc/plan-payload-*.json constructed by Alpha from the verbatim request. None found. /sprint:full's skill body is the right place to construct this — see .claude/commands/sprint/full.md.",
    };
  }

  try {
    const pl = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
    if (pl && pl.sprint && pl.sprint !== state.sprintId) {
      return {
        ok: false,
        halt_reason: "plan_payload_sprint_mismatch",
        message:
          `Most-recent plan-payload (${path.basename(payloadFile)}) targets sprint '${pl.sprint}', ` +
          `not '${state.sprintId}'. The skill body likely skipped item 1 of "Step 1 — Skill body ` +
          `responsibilities" in .claude/commands/sprint/full.md (write .mc/plan-payload-<slug>.json ` +
          `for THIS sprint) — Phase 1 (plan) would plan the WRONG sprint. ` +
          `Write the correct payload for ${state.sprintId}, then resume.`,
      };
    }
  } catch {
  }

  const res = runHelper("scripts/sprint/plan.js", [
    "--sprint",
    state.sprintId,
    "--payload",
    payloadFile,
  ]);
  state.cost.add("plan");
  if (res.code !== 0) {
    return {
      ok: false,
      halt_reason: "plan_payload_invalid",
      message: `scripts/sprint/plan.js exited ${res.code}.\nstderr: ${res.stderr}`,
    };
  }
  const pcMatch = (res.stdout || "").match(/plan-contract:.*?(PC-\d{8}-\d{4})/);
  if (pcMatch) state.planContractId = pcMatch[1];

  if (state.planContractId) {
    const pcPath = path.join(
      REPO_ROOT,
      ".claude",
      "project",
      "sprint",
      "plan-contracts",
      `${state.planContractId}.yaml`,
    );
    const pc = readYamlMaybe(pcPath);
    if (pc) {
      const status =
        (pc.plan_quality && pc.plan_quality.status) || "needs_design";
      state.planQuality = status;
      state.planContractScope = pc.scope ? pc.scope.size : "m";
      if (status !== "pass" && status !== "needs_design") {
        return {
          ok: false,
          halt_reason: "plan_quality_fail",
          message: `Plan Contract ${state.planContractId} returned plan_quality=${status}. Blocking questions need operator input. See ${pc.tracker_paths && pc.tracker_paths.plan_contract}#open_questions.blocking.`,
        };
      }
    }
  }

  const dur = Date.now() - startTs;
  state.timeline.push({
    idx: 1,
    phase: "plan",
    duration_ms: dur,
    exit_code: 0,
    notes: state.planContractId
      ? `PC=${state.planContractId} quality=${state.planQuality}`
      : "",
  });
  emit("sprint_full_phase_completed", {
    sprint_id: state.sprintId,
    phase: "plan",
    duration_ms: dur,
    helper_exit_code: 0,
    auto_approvals_recorded: 0,
  });
  checkpoint(
    state,
    "running",
    `Phase 2: design (--documentation-scale ${deriveDocScale(state)})`,
    `Plan Contract ${state.planContractId} created`,
  );
  if (state.cost.exceeded()) {
    return {
      ok: false,
      halt_reason: "cost_threshold",
      message: `Cumulative cost estimate $${state.cost.cumulative.toFixed(2)} exceeds threshold $${state.cost.threshold.toFixed(2)}.`,
    };
  }
  return { ok: true };
}

function deriveDocScale(state) {
  if (state.documentationScale && state.documentationScale !== "auto") {
    return state.documentationScale;
  }
  const map = { xs: "xs", s: "s", m: "m", l: "m", xl: "l" };
  return map[state.planContractScope || "m"] || "m";
}

function phase2Design(state) {
  state.currentPhase = "design";
  mcEnv.setEnv("PHASE_ID", state.currentPhase);

  if (state.resuming) {
    const currentPath = path.join(
      REPO_ROOT,
      ".claude",
      "project",
      "sprint",
      "sprints",
      state.sprintId,
      "current.yaml",
    );
    const cur = readYamlMaybe(currentPath) || {};
    const buckets = cur.tickets || {};
    const tixCount =
      (buckets.ready_for_execution || []).length +
      (buckets.in_progress || []).length +
      (buckets.done || []).length +
      (buckets.deferred || []).length +
      (buckets.proposed || []).length +
      (buckets.planned || []).length +
      (buckets.designed || []).length;
    if (tixCount > 0) {
      state.timeline.push({
        idx: 2,
        phase: "design",
        duration_ms: 0,
        exit_code: 0,
        notes: `resume: ${tixCount} ticket(s) already minted — skipping rescaffold + halt`,
      });
      emit("sprint_full_phase_completed", {
        sprint_id: state.sprintId,
        phase: "design",
        duration_ms: 0,
        helper_exit_code: 0,
        auto_approvals_recorded: 0,
        notes: "skipped on resume (tickets exist)",
      });
      return { ok: true, skipped: true };
    }
  }

  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "design",
    phase_index: 1,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();
  const scale = deriveDocScale(state);
  const res = runHelper("scripts/sprint/design.js", [
    "--sprint",
    state.sprintId,
    "--documentation-scale",
    scale,
  ]);
  state.cost.add("design");
  if (res.code !== 0) {
    return {
      ok: false,
      halt_reason: "design_scaffold_failed",
      message: `scripts/sprint/design.js exited ${res.code}.\nstderr: ${res.stderr}`,
    };
  }
  if (state.epsilonDispatch) checkDesignWithoutRoster(state.sprintId);
  const dur = Date.now() - startTs;
  state.timeline.push({
    idx: 2,
    phase: "design",
    duration_ms: dur,
    exit_code: 0,
    notes: `scale=${scale}; skill body owns hand-edit + ticket minting`,
  });
  emit("sprint_full_phase_completed", {
    sprint_id: state.sprintId,
    phase: "design",
    duration_ms: dur,
    helper_exit_code: 0,
    auto_approvals_recorded: 0,
  });
  checkpoint(
    state,
    "halted",
    `Skill body: review design scaffold, fill placeholders, mint tickets via ticket.js, then /sprint:full --sprint ${state.sprintId} --resume`,
    `Design scaffolded at scale=${scale}; awaiting ticket minting`,
  );
  if (state.cost.exceeded()) {
    return {
      ok: false,
      halt_reason: "cost_threshold",
      message: `Cumulative cost estimate $${state.cost.cumulative.toFixed(2)} exceeds threshold $${state.cost.threshold.toFixed(2)}.`,
    };
  }
  return {
    ok: false,
    halt_reason: "tickets_pending",
    message:
      `Phase 2 (design) scaffolded requirements at scale=${scale}. ` +
      `The skill body must now: (1) review and fill the rendered templates in ` +
      `.claude/project/sprint/requirements/${state.sprintId}/, ` +
      `(2) mint tickets via \`node scripts/sprint/ticket.js create --sprint ${state.sprintId} --title "<title>" --type <type> --risk <level>\` ` +
      `for each story, setting status=ready_for_execution. ` +
      `Then resume: \`/sprint:full --sprint ${state.sprintId} --resume\`.`,
    next_human_action: `Review design scaffold, fill placeholders, mint tickets, then run: /sprint:full --sprint ${state.sprintId} --resume`,
    resume_command: `/sprint:full --sprint ${state.sprintId} --resume`,
  };
}

// ── Phase 3: execute ─────────────────────────────────────────────────

function phase3Execute(state) {
  state.currentPhase = "execute";
  mcEnv.setEnv("PHASE_ID", state.currentPhase);
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "execute",
    phase_index: 2,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();

  const esdGate = runHelper("scripts/sprint/external-service.js", [
    "gate",
    "--phase",
    "execute",
  ]);
  if (esdGate.code !== 0) {
    return {
      ok: false,
      halt_reason: "esd_signup",
      message: `external-service.js gate failed.\nstderr: ${esdGate.stderr}\nstdout: ${esdGate.stdout}`,
    };
  }

  const currentPath = path.join(
    REPO_ROOT,
    ".claude",
    "project",
    "sprint",
    "sprints",
    state.sprintId,
    "current.yaml",
  );
  const current = readYamlMaybe(currentPath) || {};
  const ready = (
    (current.tickets && current.tickets.ready_for_execution) ||
    []
  ).slice();
  const done = ((current.tickets && current.tickets.done) || []).slice();
  const deferred = (
    (current.tickets && current.tickets.deferred) ||
    []
  ).slice();
  const inProgress = (
    (current.tickets && current.tickets.in_progress) ||
    []
  ).slice();
  const allTicketsAccountedFor =
    ready.length === 0 &&
    inProgress.length === 0 &&
    (done.length > 0 || deferred.length > 0);
  if (ready.length === 0 && !allTicketsAccountedFor) {
    state.timeline.push({
      idx: 3,
      phase: "execute",
      duration_ms: 0,
      exit_code: 1,
      notes:
        "0 ready_for_execution tickets and 0 done — halting (skill body must mint tickets via /sprint:design)",
    });
    return {
      ok: false,
      halt_reason: "no_tickets_ready",
      message:
        `Phase 3 (execute) found 0 tickets in ready_for_execution AND 0 in done/deferred for sprint ${state.sprintId}. ` +
        `This means /sprint:design scaffolded the requirement templates but the skill body (Alpha) did not mint tickets. ` +
        `Action: (a) hand-edit .claude/project/sprint/requirements/${state.sprintId}/{prd,acceptance-criteria,granular-stories,...}.md to reflect real scope, then (b) mint tickets via \`node scripts/sprint/ticket.js create --sprint ${state.sprintId} --title "<title>" ...\` setting status=ready_for_execution. Resume with \`/sprint:full --sprint ${state.sprintId} --resume\`.`,
    };
  }
  if (ready.length === 0 && allTicketsAccountedFor) {
    state.timeline.push({
      idx: 3,
      phase: "execute",
      duration_ms: 0,
      exit_code: 0,
      notes: `resume: ${done.length} done, ${deferred.length} deferred — advancing`,
    });
    return { ok: true };
  }

  const policy = state.preset.stop_condition_policy;
  let autoApprovalsThisPhase = 0;
  for (const ticketId of ready) {
    runHelper("scripts/sprint/ticket.js", [
      "update",
      "--sprint",
      state.sprintId,
      "--id",
      ticketId,
      "--status",
      "in_progress",
      "--owner-agent",
      "alpha",
    ]);

    state.cost.add("execute", 1);
    if (state.cost.exceeded()) {
      return {
        ok: false,
        halt_reason: "cost_threshold",
        message: `Cumulative cost estimate $${state.cost.cumulative.toFixed(2)} exceeds threshold $${state.cost.threshold.toFixed(2)}.`,
      };
    }
  }

  const dur = Date.now() - startTs;
  state.timeline.push({
    idx: 3,
    phase: "execute",
    duration_ms: dur,
    exit_code: 0,
    auto_approvals_recorded: autoApprovalsThisPhase,
    notes: `${ready.length} ticket(s) handed off to Ralph loops`,
  });
  emit("sprint_full_phase_completed", {
    sprint_id: state.sprintId,
    phase: "execute",
    duration_ms: dur,
    helper_exit_code: 0,
    auto_approvals_recorded: autoApprovalsThisPhase,
  });
  checkpoint(
    state,
    "running",
    "Phase 4: release-prep (prepare + check, never deploy)",
    `Execute handed off ${ready.length} ticket(s)`,
  );
  return { ok: true };
}

function findExistingStagingRelease(sprintId, target) {
  try {
    const releasesDir = path.join(REPO_ROOT, PATHS.sprintReleases);
    if (!fs.existsSync(releasesDir)) return null;
    const files = fs
      .readdirSync(releasesDir)
      .filter((f) => /^RL-\d{8}-\d{3,4}\.yaml$/.test(f));
    for (const f of files) {
      const rel = readYamlMaybe(path.join(releasesDir, f));
      if (!rel || rel.sprint !== sprintId) continue;
      const recTarget = rel.deployment_target || rel.deployment_environment;
      if (recTarget === "production") continue;
      if (recTarget === target) return rel.id || path.basename(f, ".yaml");
    }
    return null;
  } catch {
    return null;
  }
}

function phase4ReleasePrep(state) {
  state.currentPhase = "release-prep";
  mcEnv.setEnv("PHASE_ID", state.currentPhase);
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "release-prep",
    phase_index: 3,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();

  const currentPath = path.join(
    REPO_ROOT,
    ".claude",
    "project",
    "sprint",
    "sprints",
    state.sprintId,
    "current.yaml",
  );
  const currentForCheck = readYamlMaybe(currentPath) || {};
  const ticketsDone = (
    (currentForCheck.tickets && currentForCheck.tickets.done) ||
    []
  ).slice();
  const ticketsDeferred = (
    (currentForCheck.tickets && currentForCheck.tickets.deferred) ||
    []
  ).slice();
  if (ticketsDone.length === 0 && ticketsDeferred.length === 0) {
    return {
      ok: false,
      halt_reason: "no_tickets_done",
      message:
        `Phase 4 (release-prep) refuses to mint a release record for sprint ${state.sprintId}: 0 tickets in 'done' and 0 in 'deferred'. ` +
        `A release for zero completed work is not a release. ` +
        `Action: complete at least one ticket (mark it 'done' via \`node scripts/sprint/ticket.js update --sprint ${state.sprintId} --id <T-id> --status done\`), or formally abandon the sprint via /sprint:retrospective with no release. ` +
        `Resume with \`/sprint:full --sprint ${state.sprintId} --resume\`.`,
    };
  }

  const levels = state.preset.pre_authorized_approval_levels || [];
  const includesReleaseApproval = levels.includes("release_approval_required");
  const targets = state.preset.release_approval_targets || [];
  const target = "staging";
  const isNonProductionTarget = target !== "production";
  const canAutoApprove =
    includesReleaseApproval && targets.includes(target) && isNonProductionTarget;
  if (!canAutoApprove) {
    return {
      ok: false,
      halt_reason: "approval_beyond_preset",
      message: `release_approval_required is outside preset '${state.preset.preset_name}' pre-authorization (or target '${target}' not in release_approval_targets). Operator action: record approval via scripts/sprint/release.js approve, OR re-run with --autonomy aggressive (subject to hard ceilings — never auto-deploys to production).`,
    };
  }

  const existingRelease = findExistingStagingRelease(state.sprintId, target);
  if (existingRelease) {
    emit("sprint_full_release_prep_resume_skip", {
      sprint_id: state.sprintId,
      release_id: existingRelease,
      target,
      ts: nowIso(),
    });
    const dur = Date.now() - startTs;
    state.timeline.push({
      idx: 4,
      phase: "release-prep",
      duration_ms: dur,
      exit_code: 0,
      auto_approvals_recorded: 0,
      notes: `resume: release record ${existingRelease} already prepared (target=${target}) — skipping`,
    });
    emit("sprint_full_phase_completed", {
      sprint_id: state.sprintId,
      phase: "release-prep",
      duration_ms: dur,
      helper_exit_code: 0,
      auto_approvals_recorded: 0,
      notes: "skipped on resume (release record exists)",
    });
    checkpoint(
      state,
      "running",
      "Phase 5: retrospective",
      `resume: release record already prepared — skipping (target=${target})`,
    );
    process.stdout.write(
      `resume: release record already prepared (${existingRelease}) — skipping\n`,
    );
    return { ok: true, skipped: true };
  }

  const prepRes = runHelper("scripts/sprint/release.js", [
    "prepare",
    "--title",
    state.sprintTitle || `Sprint ${state.sprintId}`,
    "--version",
    `${state.sprintId}-staging`,
    "--target",
    target,
  ]);
  state.cost.add("release-prep");
  if (prepRes.code === 3) {
    return {
      ok: false,
      halt_reason: "regression_seed_failed",
      message:
        `Phase 4 (release-prep) blocked by the regression-seed gate for sprint ${state.sprintId}.\n` +
        `${prepRes.stdout || ""}${prepRes.stderr || ""}` +
        `\nResume after fixing with \`/sprint:full --sprint ${state.sprintId} --resume\`.`,
    };
  }
  if (prepRes.code !== 0) {
    return {
      ok: false,
      halt_reason: "release_prepare_failed",
      message: `release.js prepare exited ${prepRes.code}.\nstderr: ${prepRes.stderr}`,
    };
  }

  const dur = Date.now() - startTs;
  state.timeline.push({
    idx: 4,
    phase: "release-prep",
    duration_ms: dur,
    exit_code: 0,
    auto_approvals_recorded: 0,
    notes: `prepared for target=${target}; deploy is operator-invoked`,
  });
  emit("sprint_full_phase_completed", {
    sprint_id: state.sprintId,
    phase: "release-prep",
    duration_ms: dur,
    helper_exit_code: 0,
    auto_approvals_recorded: 0,
  });
  checkpoint(
    state,
    "running",
    "Phase 5: retrospective",
    `Release prepared (target=${target})`,
  );
  return { ok: true };
}

function flipActiveSprintsStatusForRetro(sprintId) {
  try {
    const reg = readYamlMaybe(SPRINT.activeRegistry);
    if (!reg || !Array.isArray(reg.sprints)) return { changed: false, reason: "no_registry" };
    const entry = reg.sprints.find((s) => s.id === sprintId);
    if (!entry) return { changed: false, reason: "not_in_registry" };
    if (["closed", "abandoned", "retrospected"].includes(entry.status)) {
      return { changed: false, reason: "already_terminal", from: entry.status };
    }
    const prev = entry.status;
    const now = nowIso();
    entry.status = "closed";
    entry.updated_at = now;
    reg.updated_at = now;
    writeYaml(SPRINT.activeRegistry, reg);
    return { changed: true, from: prev, to: "closed", reason: "ok" };
  } catch (err) {
    return { changed: false, reason: `error: ${err.message}` };
  }
}

function phase5Retro(state) {
  state.currentPhase = "retro";
  mcEnv.setEnv("PHASE_ID", state.currentPhase);
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "retro",
    phase_index: 4,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  flipActiveSprintsStatusForRetro(state.sprintId);
  const startTs = Date.now();
  const res = runHelper("scripts/sprint/retrospective.js", [
    "--sprint",
    state.sprintId,
    "--signed-off-by",
    "alpha",
    "--no-synth",
  ]);
  state.cost.add("retro");
  const dur = Date.now() - startTs;
  state.timeline.push({
    idx: 5,
    phase: "retro",
    duration_ms: dur,
    exit_code: res.code,
    notes:
      res.code === 0
        ? "retro.yaml + retro.md written"
        : `retro exited ${res.code} (skeleton fallback)`,
  });
  emit("sprint_full_phase_completed", {
    sprint_id: state.sprintId,
    phase: "retro",
    duration_ms: dur,
    helper_exit_code: res.code,
    auto_approvals_recorded: 0,
  });
  return { ok: true };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.resume && (!args.request || args.request.length < 10)) {
    process.stderr.write(
      'Usage: /sprint:full "<request>" [...]\n\nRun with --help for full options.\n',
    );
    return 2;
  }
  if (args.allowMain && args.autonomy !== "aggressive") {
    process.stderr.write("--allow-main requires --autonomy aggressive.\n");
    return 2;
  }
  if (args.betaVerdict !== null && !validateBetaVerdict(args.betaVerdict)) {
    process.stderr.write(
      `--beta-verdict must be one of DECIDE, DIRECTIVE, ESCALATE. Got: ${args.betaVerdict}\n`,
    );
    return 2;
  }
  if ((args.betaVerdict || args.pendingPhase) && !args.resume) {
    process.stderr.write(
      "--beta-verdict / --pending-phase are resume-only. Re-run with --resume (and --sprint <id>).\n",
    );
    return 2;
  }
  const pendingIdx = args.pendingPhase
    ? PHASES.findIndex((p) => `before_${p}` === args.pendingPhase)
    : -1;
  if (args.pendingPhase && pendingIdx === -1) {
    process.stderr.write(
      `--pending-phase '${args.pendingPhase}' is not a valid phase boundary. ` +
      `Valid: ${PHASES.map((p) => `before_${p}`).join(", ")}.\n`,
    );
    return 2;
  }

  const _envEpsilonSet = Object.values(mcEnv.envNames("EPSILON_RUNTIME")).some((n) => Object.prototype.hasOwnProperty.call(process.env, n));
  if (!args._epsilonExplicit && !_envEpsilonSet) {
    try {
      const modeLib = require("../hooks/lib/mode");
      if (modeLib.isSprint()) {
        args.epsilon = true;
        if (!args._epsilonDispatchExplicit) args.epsilonDispatch = true;
      }
    } catch {
    }
  }

  const presetResult = loadPreset(args.autonomy);
  if (!presetResult.ok) {
    process.stderr.write(presetResult.error + "\n");
    return 2;
  }
  const preset = presetResult.preset;

  let sprintId = args.sprint;
  if (!sprintId) {
    sprintId = SPRINT.active();
  }
  if (!sprintId) {
    process.stderr.write(
      "No sprint id resolved. Pass --sprint <SP-id> or have the skill body run scripts/sprint/add-sprint.js first.\n",
    );
    return 2;
  }

  if (!args.sprint) {
    const closedStatus = SPRINT.statusOf(sprintId);
    if (closedStatus && SPRINT.CLOSED_STATUSES.has(closedStatus)) {
      process.stderr.write(
        `Auto-resolved sprint '${sprintId}' is '${closedStatus}' (closed). Refusing to absorb new work into a finished sprint. ` +
          `Pass --sprint <open-SP-id> to target a specific sprint, or mint a new one via scripts/sprint/add-sprint.js.\n`,
      );
      return 2;
    }
  }

  if (!mcEnv.readEnv("RUN_ID")) {
    mcEnv.setEnv(
      "RUN_ID",
      "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex")
    );
  }
  mcEnv.setEnv("SPRINT_ID", sprintId);

  const costGateEnabled =
    args.costGate === "off"
      ? false
      : args.costGate === "on"
        ? true
        : require("./cost-gate").isCostGateEnabled();
  const cost = makeCostCounter(
    preset.cost_estimate_threshold_usd,
    args.costAcknowledged,
    costGateEnabled,
  );
  if (!costGateEnabled) {
    process.stdout.write(
      "[sprint:full] cost-gate OFF — heuristic cost halts disabled for this run " +
        "(hard ceilings + the real >$5 operator rule are unaffected).\n",
    );
  }
  const state = {
    sprintId,
    sprintTitle: null,
    planContractId: null,
    planContractScope: null,
    planQuality: null,
    documentationScale: args.documentationScale,
    mode: args.mode || "adhoc",
    preset,
    cost,
    resuming: args.resume,
    currentPhase: "boot",
    startedAt: nowIso(),
    timeline: [],
    autoApprovals: [],
    betaConsultations: [],
    betaDirectives: [],
    halts: [],
    tickets: { done: [], deferred: [], abandoned: [] },
    outcome: null,
    epsilon: !!args.epsilon,
    epsilonDispatch: !!args.epsilonDispatch,
    gauntletPackage: args.gauntletPackage || "auto",
    gauntletLenient: !!args.gauntletLenient,
    gauntletLenientReason: args.gauntletLenientReason || null,
  };

  const bp = checkBranchProtection(args, preset, sprintId);
  if (!bp.ok) {
    process.stderr.write(bp.message + "\n");
    writeHaltReport(state, bp);
    return 1;
  }

  emit("sprint_full_started", {
    sprint_id: sprintId,
    preset_name: preset.preset_name,
    scope: args.scope,
    documentation_scale: args.documentationScale,
    mode: state.mode,
    branch: currentBranch(),
    started_at: state.startedAt,
  });
  if (args.resume) {
    emit("sprint_full_resume", {
      sprint_id: sprintId,
      ts: nowIso(),
    });
  }

  const clearedBoundaries = args.resume ? readClearedBetaBoundaries(sprintId) : [];

  const phaseFns = [
    () => phase1Plan(state, args),
    () => phase2Design(state),
    () => phase3Execute(state),
    () => phase4ReleasePrep(state),
    () => phase5Retro(state),
  ];

  for (let i = 0; i < phaseFns.length; i++) {
    const boundary = `before_${PHASES[i]}`;
    const alreadyCleared =
      args.resume && clearedBoundaries.includes(boundary);
    const beforePending = args.resume && pendingIdx !== -1 && i < pendingIdx;
    if (alreadyCleared || beforePending) {
    } else {
      const consult = maybeConsultBeta(state, boundary, args);
      if (!consult.ok) {
        state.halts.push({
          phase: state.currentPhase,
          halt_reason: consult.halt_reason,
          resume_command:
            consult.resume_command || `/sprint:full --sprint ${sprintId} --resume`,
        });
        state.outcome = `halted:${consult.halt_reason}`;
        heartbeat.emit(sprintId, { phase: state.currentPhase, status: "halted", reason: consult.halt_reason });
        const haltPath = writeHaltReport(state, consult);
        process.stderr.write(
          `/sprint:full halted (${consult.halt_reason}). See ${haltPath}\n`,
        );
        checkpoint(
          state,
          "halted",
          consult.message || "halt",
          `halt_reason=${consult.halt_reason}`,
        );
        return 1;
      }
      if (consult.verdict) {
        recordClearedBetaBoundary(sprintId, boundary);
        clearedBoundaries.push(boundary);
      }
    }
    heartbeat.emit(sprintId, { phase: PHASES[i], status: "running" });
    const result = phaseFns[i]();
    if (!result.ok) {
      state.halts.push({
        phase: state.currentPhase,
        halt_reason: result.halt_reason,
        resume_command: `/sprint:full --sprint ${sprintId} --resume`,
      });
      state.outcome = `halted:${result.halt_reason}`;
      heartbeat.emit(sprintId, { phase: state.currentPhase, status: "halted", reason: result.halt_reason });
      const haltPath = writeHaltReport(state, result);
      process.stderr.write(
        `/sprint:full halted (${result.halt_reason}). See ${haltPath}\n`,
      );
      checkpoint(
        state,
        "halted",
        result.message || "halt",
        `halt_reason=${result.halt_reason}`,
      );
      return 1;
    }
    const consultResult = emitPhaseConsults(sprintId, PHASES[i], { epsilon: state.epsilon, epsilonDispatch: state.epsilonDispatch, gauntletPackage: state.gauntletPackage, gauntletLenient: state.gauntletLenient, gauntletLenientReason: state.gauntletLenientReason });
    if (consultResult && consultResult.ok === false) {
      state.halts.push({
        phase: state.currentPhase,
        halt_reason: consultResult.halt_reason,
        resume_command: `/sprint:full --sprint ${sprintId} --resume`,
      });
      state.outcome = `halted:${consultResult.halt_reason}`;
      heartbeat.emit(sprintId, { phase: state.currentPhase, status: "halted", reason: consultResult.halt_reason });
      const haltPath = writeHaltReport(state, consultResult);
      process.stderr.write(
        `/sprint:full halted (${consultResult.halt_reason}). See ${haltPath}\n`,
      );
      checkpoint(
        state,
        "halted",
        consultResult.message || "halt",
        `halt_reason=${consultResult.halt_reason}`,
      );
      return 1;
    }
  }

  state.outcome = "done";
  heartbeat.emit(sprintId, { phase: "retro", status: "done" });
  const reportPath = writeFinalReport(state);
  process.stdout.write(`/sprint:full done. Report: ${reportPath}\n`);
  checkpoint(state, "completed", "Sprint pipeline complete", `Outcome=done`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  main,
  parseArgs,
  loadPreset,
  HARD_CEILINGS,
  FORBIDDEN_PRE_AUTH,
  PHASES,
  PHASE_TYPICAL_SPEND_USD,
  makeCostCounter,
  checkBranchProtection,
  writeHaltReport,
  writeFinalReport,
  phase2Design,
  phase3Execute,
  phase4ReleasePrep,
  findExistingStagingRelease,
  flipActiveSprintsStatusForRetro,
  maybeConsultBeta,
  validateBetaVerdict,
  BETA_VERDICTS,
  readClearedBetaBoundaries,
  recordClearedBetaBoundary,
  betaBoundariesPath,
  emitPhaseConsults,
  gauntletConductProblems,
  resolveGauntletDecision,
  sprintComposition,
  checkDesignWithoutRoster,
};
