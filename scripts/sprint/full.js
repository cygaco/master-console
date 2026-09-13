#!/usr/bin/env node

/**
 * scripts/sprint/full.js — /sprint:full orchestrator.
 *
 * Single-invocation execution of the full sprint pipeline:
 *   plan → design → execute → release-prep → retro
 *
 * Composition over duplication: shells out to existing helpers
 * (plan.js, design.js, ticket.js, external-service.js, execute.js,
 * release.js, retrospective.js, checkpoint.js, routing.js).
 *
 * Bounded autonomy via preset bundle at paths.sprintFullAutonomy.
 * Hard-ceiling enum (HARD_CEILINGS below) is authoritative and
 * cannot be overridden by any preset.
 *
 * Usage:
 *   node scripts/sprint/full.js "<request>" \
 *     [--autonomy conservative|moderate|aggressive] \
 *     [--scope minimal_safe|recommended|expanded] \
 *     [--documentation-scale auto|xs|s|m|l|xl] \
 *     [--mode solo|adhoc] \
 *     [--sprint <SP-id>] \
 *     [--resume] \
 *     [--allow-main] \
 *     [--cost-acknowledged]
 *
 * Exit codes:
 *   0  done (all 5 phases completed)
 *   1  halt (a stop condition fired; halt report written)
 *   2  bad usage (CLI parse error, missing preset config, etc.)
 *
 * See .claude/commands/sprint/full.md for the full skill body and
 * _docs/sprint/AUTONOMY.md for plain-English preset documentation.
 */

"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const { isVerifiedLivenessRecord } = require("../dispatch/verified-liveness-read");
const path = require("path");
const crypto = require("crypto");
const { spawnSync, execSync } = require("child_process");

const SPRINT = require("./paths");
const {
  readYamlMaybe,
  writeYaml,
  ensureDir,
  nowIso,
  writeText,
} = require("./fs");
const heartbeat = require("./heartbeat"); // ε liveness heartbeat (Phase D d)
const hookPoints = require("./hook-points"); // composition→agent-set router (Phase D F1/F2)
const hookConsult = require("./hook-consult"); // manager_consult emitter (Phase D F3b)
const epsilonRuntime = require("./epsilon-runtime"); // ε sprint-conductor runtime (ADR-0009)

// full.js PHASES are coarser than the hook-point lifecycle: 'execute' covers build+
// gauntlet, 'release-prep' is release. Map each completed phase to its step set so the
// orchestrator emits a manager_consult per engaged agent (Phase D F3b — closes ED-022).
const PHASE_TO_HOOK_STEPS = Object.freeze({
  plan: ["plan"],
  design: ["design"],
  execute: ["build", "gauntlet"],
  "release-prep": ["release"],
  retro: ["retro"],
});

// Best-available sprint composition from the sprint's ticket files (empty early, full by
// the gauntlet step — which is when the design authority must be present, so ED-022
// closes correctly). Reads ticket YAML directly, decoupled from phase ticket-loading.
function sprintComposition(sprintId) {
  const tickets = [];
  try {
    for (const f of fs.readdirSync(SPRINT.tickets)) {
      if (!/\.(ya?ml|json)$/.test(f)) continue;
      const t = readYamlMaybe(path.join(SPRINT.tickets, f));
      if (t && t.sprint === sprintId) tickets.push(t);
    }
  } catch {
    /* no tickets dir yet → empty composition (only always-on agents fire) */
  }
  return hookPoints.compositionFromTickets(tickets);
}

// Emit the manager_consult records for a completed phase's hook-point step(s) (the ε
// materialization: who was engaged at each step). Non-fatal — telemetry, never a halt.
//
// ADR-0009 (ε-conducted, ADDITIVE): when `epsilon` is set, each step is run through the ε
// sprint-conductor RUNTIME (conductStep) instead of the bare consult emitter. The runtime
// emits the IDENTICAL manager_consult coverage records (so every existing enforcer keeps
// seeing them) AND — under `epsilonDispatch` — writes a REAL per-agent completion record
// to the canonical ledger gauntlet-verify reads (the liveness proof full.js's telemetry-
// only path never produced). The default path (epsilon unset) is byte-for-byte the prior
// behavior: conductStep with {dispatch:false} delegates straight back to the same
// hookConsult emitter, so the script-driven sprint is unchanged.
function emitPhaseConsults(sprintId, phase, opts = {}) {
  const steps = PHASE_TO_HOOK_STEPS[phase] || [];
  if (!steps.length || !sprintId) return;
  try {
    const composition = sprintComposition(sprintId);
    if (opts.epsilon) {
      // ε-conducted: the runtime owns the per-step dispatch. It re-emits the same coverage
      // consults + design-touch internally, so we do NOT also call hookConsult here.
      for (const step of steps) {
        epsilonRuntime.conductStep(step, composition, sprintId, { dispatch: !!opts.epsilonDispatch });
      }
      return;
    }
    // Default (script-driven) path — telemetry-only consults, unchanged.
    for (const step of steps) hookConsult.emitStepConsults(step, composition, sprintId);
    if (steps.includes("build") || steps.includes("gauntlet")) {
      hookConsult.emitDesignTouch(composition, sprintId);
    }
  } catch {
    /* emission must never break the pipeline */
  }
}

const REPO_ROOT = SPRINT.PROJECT;
const PATHS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
);

// ── Hardcoded contract — authoritative regardless of preset ──────────

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

// Coarse cost-estimate per phase (USD). Calibrate from real telemetry later.
const PHASE_TYPICAL_SPEND_USD = Object.freeze({
  plan: 0.75,
  design: 2.0,
  execute: 1.5, // per ticket, multiplied by ticket count
  "release-prep": 0.5,
  retro: 0.5,
});

// ── CLI parsing ─────────────────────────────────────────────────────

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
    // ε-conducted mode (ADR-0009): when set, each completed phase's hook-point step(s) are
    // run through the ε sprint-conductor RUNTIME (registry-driven REAL dispatch + completion
    // records) instead of full.js's telemetry-only emitPhaseConsults. ADDITIVE — the default
    // (flag absent / MC_EPSILON_RUNTIME unset) is the unchanged script path.
    // `--epsilon-dispatch` additionally writes real per-agent completion records.
    // T-297: in sprint mode these default ON (sprint-mode default applied in main() after
    // mode detection; explicit CLI flags and MC_EPSILON_RUNTIME env always win).
    epsilon: mcEnv.readEnv("EPSILON_RUNTIME") === "on",
    epsilonDispatch: false,
    // Tracks whether epsilon/epsilonDispatch were set via explicit CLI flag (vs env/default).
    // Used by main() to determine whether to apply the sprint-mode default.
    _epsilonExplicit: false,
    _epsilonDispatchExplicit: false,
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
    else if (a === "--epsilon") { out.epsilon = true; out._epsilonExplicit = true; }
    else if (a === "--epsilon-dispatch") {
      out.epsilon = true; out.epsilonDispatch = true;
      out._epsilonExplicit = true; out._epsilonDispatchExplicit = true;
    }
    // Explicit OPT-OUT (gauntlet 2026-06-10, qa+security lanes): without these,
    // the sprint-mode default-ON would silently override a user's opt-out intent
    // — there'd be no way to run the legacy path in sprint mode.
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

See _docs/sprint/AUTONOMY.md for preset details.
`);
}

// ── Logger (uses scripts/hooks/lib/logger when available) ─────────────

function emit(kind, data) {
  try {
    const { log } = require("../hooks/lib/logger");
    log("audit", { kind, ...data }, { actor: "alpha", source: "/sprint:full" });
  } catch {
    // Fail-open: events are nice-to-have, not load-bearing.
  }
}

// ── Preset loading + ceiling enforcement ──────────────────────────────

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

  // Hard-ceiling contract — refuse to load any preset that includes
  // a forbidden pre-auth level. This protects against operator-edited
  // configs that try to lift ceilings.
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
  // hard_ceilings declared in the config must match the hardcoded enum.
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

// ── Branch protection ─────────────────────────────────────────────────

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
  if (!branch) return { ok: true }; // no git repo? skip
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

// ── Cost-estimate counter ─────────────────────────────────────────────

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
      // Gate OFF (toggled via scripts/sprint/cost-gate.js or --cost-gate off):
      // the heuristic never halts. Hard ceilings + the real >$5 operator rule
      // are enforced elsewhere and are unaffected by this toggle.
      if (!this.gateEnabled) return false;
      return this.cumulative > this.threshold;
    },
  };
}

// ── Subprocess wrapper (Windows-safe) ─────────────────────────────────

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

// ── Halt report writer ────────────────────────────────────────────────

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

// ── Final report writer ───────────────────────────────────────────────

function writeFinalReport(state) {
  const dir = path.join(REPO_ROOT, PATHS.sprintFullReports, state.sprintId);
  ensureDir(dir);
  const filePath = path.join(dir, "sprint-full-report.md");
  const dur =
    state.timeline.length > 0 && state.startedAt
      ? (Date.now() - new Date(state.startedAt).getTime()) / 1000
      : 0;

  // Ticket counts come from the per-sprint current.yaml (the source of truth),
  // not state.tickets. Phase 3's resume-aware path no longer fans out tickets
  // through the in-memory orchestrator state, so state.tickets.* stays empty
  // even when current.yaml has real done/deferred/abandoned entries.
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

// ── Checkpoint helper ────────────────────────────────────────────────

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

// ── Beta verdict validator ────────────────────────────────────────────

const BETA_VERDICTS = Object.freeze(["DECIDE", "DIRECTIVE", "ESCALATE"]);

function validateBetaVerdict(v) {
  return BETA_VERDICTS.includes(v);
}

// ── Beta message sanitizer ────────────────────────────────────────────
// Strips CR/LF to prevent injection of fake markdown sections or fence
// delimiters when betaMessage is interpolated into reports or messages.
// Capped at 500 chars — operator free text is advisory, not load-bearing.
const sanitizeBetaMessage = (m) => (m || "").replace(/[\r\n]+/g, " ").slice(0, 500);

// ── Beta-boundary persistence (FIX G2.10) ─────────────────────────────
//
// Each adhoc /sprint:full resume cycle halts at the next Beta phase boundary
// and exits; the operator supplies a verdict and resumes. Without persistence,
// a plain `--resume` (no --pending-phase) restarts the consult loop at
// before_plan every time — so a ~5-boundary sprint needed the operator to
// re-thread --pending-phase on each resume to advance. We persist the set of
// boundaries that have ALREADY been consulted-and-cleared into an orchestrator-
// owned sidecar so a bare `--resume` advances straight to the first uncrossed
// boundary.
//
// Why a sidecar and not progress.yaml: the sprint-progress schema is
// additionalProperties:false and does not declare a cleared-boundaries field,
// so writing into progress.yaml would produce schema-invalid trackers. The
// sidecar lives under paths.sprintFullReports/<sprintId>/ — a directory wholly
// owned by this orchestrator, not governed by any sprint-tracker schema.
//
// Fail-open throughout: a read/write error degrades to the prior behavior
// (operator threads --pending-phase manually) rather than crashing the run.

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
    // Only honor recognized boundaries — a stale/garbled entry can't skip a gate.
    return arr.filter((b) => PHASES.some((p) => `before_${p}` === b));
  } catch {
    return [];
  }
}

function recordClearedBetaBoundary(sprintId, boundary) {
  try {
    const cleared = readClearedBetaBoundaries(sprintId);
    if (cleared.includes(boundary)) return; // idempotent
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
    // Fail-open: persistence is an optimization, not a correctness invariant.
    // Worst case the operator threads --pending-phase manually as before.
  }
}

// ── Phase boundary Beta consultation (adhoc mode only) ────────────────
//
// ADR option (b): halt-at-each-Beta-boundary.
// A spawnSync-d node subprocess cannot reach the in-process SendMessage/
// Agent surface. Instead, the orchestrator halts here and lets the
// foreground (Alpha) drive the real consult, then resumes with the verdict
// passed via --beta-verdict / --pending-phase on the CLI.
//
// Call site MUST pass `args` (the parsed CLI args object) so this function
// can inspect a supplied verdict. It MAY mutate args.betaVerdict to null
// after consuming it — one-consult-per-resume semantics.

function maybeConsultBeta(state, boundary, args) {
  // Solo mode: skip Beta entirely — no halts, no events, no consult records.
  if (state.mode !== "adhoc") return { ok: true, verdict: null };

  // Determine whether a verdict has been supplied that applies to THIS boundary:
  //   - args.betaVerdict must be present (non-null)
  //   - AND args.pendingPhase is null (apply to first boundary encountered)
  //     OR args.pendingPhase equals this boundary (targeted resume)
  const hasVerdict =
    args && args.betaVerdict !== null && args.betaVerdict !== undefined;
  const verdictAppliesHere =
    hasVerdict &&
    (args.pendingPhase === null ||
      args.pendingPhase === undefined ||
      args.pendingPhase === boundary);

  if (!verdictAppliesHere) {
    // No verdict supplied for this boundary — halt and let the foreground
    // (Alpha) perform the real Beta consultation, then resume with the result.
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

  // Verdict supplied and applies here — record the REAL consult.
  const verdict = args.betaVerdict;
  // FIX 3: guard against an invalid verdict even when the caller bypasses
  // main()'s upstream validation — maybeConsultBeta is exported and may be
  // called programmatically. Return halt-shaped so the caller can handle it
  // without poisoning state.betaConsultations.
  if (!validateBetaVerdict(verdict)) {
    return {
      ok: false,
      halt_reason: "invalid_beta_verdict",
      boundary,
      message: `Unrecognized Beta verdict '${verdict}'. Must be DECIDE | DIRECTIVE | ESCALATE.`,
    };
  }
  // FIX 4: sanitize operator free text before any interpolation or storage.
  const betaMessage = sanitizeBetaMessage(args.betaMessage);
  // #437 (0.11.0 honesty): refuse an empty/whitespace beta_message at runtime.
  // A verdict with no rationale is a placeholder consult — the exact pattern
  // /scan:sprint-beta-honesty caught after the fact (SP-20260525-018 logged a
  // DECIDE with an empty beta_message). Halting here BEFORE the consult is
  // recorded (emit + state.betaConsultations + verdict consumption all happen
  // below) turns it from detectable-after-the-fact into impossible-at-runtime:
  // no boundary can be crossed without a real verdict AND a real message. The
  // verdict is NOT consumed, so the operator simply resumes with a rationale.
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
        `A consult without a rationale is a placeholder consult — refused at runtime (0.11.0 honesty, #437). ` +
        `Re-consult Beta (Alex β) and resume with the real one-line rationale: ${resumeCmd}`,
      resume_command: resumeCmd,
      next_human_action:
        `Obtain Beta's actual rationale for the '${verdict}' verdict at '${boundary}', then resume with a non-empty --beta-message.`,
    };
  }

  // β-VERDICT-HONESTY (P-AP-1): refuse a NON-SUBSTANTIVE (canned) beta_message at
  // runtime. The empty-message guard above only catches ABSENT messages, but β's
  // /sprint:full verdicts historically collapsed to ~3 hardcoded strings across
  // 1386+ records. A substantive verdict is >=40 chars AND carries SOME structure
  // (a decision token OR a grounding reference — the lenient OR, to keep the runtime
  // false-positive rate low; real verdicts carry both). This is a DETERMINISTIC
  // string/structure check (NO model judgment) so β cannot be prompted past or
  // rationalize around it — the self-reference trap. Inlined (not required from
  // scripts/checks) to keep the orchestrator subprocess isolated. Mirrors
  // classifyCanned() C1+C2 in scripts/checks/sprint-beta-honesty.js.
  //
  // SCOPE: runtime enforces only the PER-MESSAGE checks (C1 length, C2 structure).
  // Cross-boundary (C3) and cross-sprint (C4) DUPLICATE detection is NOT done here:
  // each /sprint:full resume is a SEPARATE process with state.betaConsultations
  // freshly [] (one-consult-per-resume), so the orchestrator has no prior-consult
  // history to compare against. C3/C4 are enforced fail-closed by the AUDIT layer
  // (scripts/mc/release-build.js betaHonestyGate + /scan:sprint-beta-honesty),
  // which reads the full events corpus and BLOCKS the release on a duplicate.
  // Kill switch MC_BETA_SUBSTANCE_GATE=off (default ON) — fail-closed, never warn-only;
  // an off-switch (like dispatch-route-guard's) is a rollout/emergency lever, not a soften.
  //
  // SINGLE READ (task #12 — β single-read hygiene): the gate below and the row stamp further
  // down MUST agree. Two independent process.env reads can disagree if anything mutates the
  // env between them, letting the gate run while the row records "off" (or the reverse) —
  // invisible to the exact audit designed to catch an off-switch flip (AP-15 in env-var costume).
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
          `Canned/boilerplate verdicts are refused at runtime (P-AP-1: β verdicts must be real consults, not templated strings). ` +
          `Re-consult Beta (Alex β) for a specific, grounded rationale and resume: ${resumeCmd}`,
        resume_command: resumeCmd,
        next_human_action:
          `Obtain Beta's actual, specific rationale (the decision + WHY — reference the ticket/risk/precedent) for '${verdict}' at '${boundary}', then resume with a substantive --beta-message.`,
      };
    }
  }

  const ts = nowIso();
  const latencyMs = 0; // no live round-trip in this subprocess; elapsed is ~0
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
    via_cli_resume: !!(args && args.resume), // RT-1: audit marker for /scan:sprint-beta-honesty
    // β finding 2026-08-04 (c17d5e92): the substance gate must stamp its own state into the
    // row on BOTH paths — an off-switch flip is otherwise invisible to the exact audit
    // designed to catch it (AP-15 in env-var costume). Written whether the gate ran or not.
    // Reads the SAME const the gate above branched on — never a second process.env read.
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

  // Consume the verdict so subsequent boundaries in this process run do NOT
  // reuse it — one-consult-per-resume semantics. Each additional Beta boundary
  // will halt with beta_consult_pending and require its own resume invocation.
  args.betaVerdict = null;
  args.betaMessage = null;
  if (args.pendingPhase === boundary) args.pendingPhase = null;

  // Act on verdict.
  if (verdict === "DECIDE") {
    return { ok: true, verdict: "DECIDE" };
  }

  if (verdict === "DIRECTIVE") {
    // Record the directive. Hook point: state.betaDirectives is surfaced in
    // the final report's "Beta consultations" section and is available for
    // future phase logic to inspect (e.g. phase adjustments, scope changes).
    // Full downstream behavior wiring is out of scope for this ticket, but
    // the recording contract is established here.
    if (!state.betaDirectives) state.betaDirectives = [];
    state.betaDirectives.push({ boundary, message: betaMessage, ts });
    return { ok: true, verdict: "DIRECTIVE", directive: betaMessage };
  }

  if (verdict === "ESCALATE") {
    // ESCALATE is a hard halt regardless of preset — operator must resolve.
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

  // Unreachable — validateBetaVerdict guard above covers all three valid values.
  // Return a halt rather than silently ok:true so any future code-path that
  // slips past the guard fails loudly instead of hiding a bad verdict.
  /* c8 ignore next */
  return { ok: false, halt_reason: "invalid_beta_verdict", boundary, message: `Unexpected verdict state for '${verdict}'.` };
}

// ── T-297: design-without-roster enforcer (report-only) ──────────────
//
// When ε-dispatch is active and the design scaffold succeeds, verify that at
// least one design-step dispatch completion record exists on the ledger. If
// requirement artifacts were written but no roster records exist, emit a
// `design_without_roster` warning event (never halts — report-only this sprint).
//
// TODO(T-297-enforcer-ramp): promote to halt once ε-dispatch is the default
// for a full sprint cycle and the ledger consistently carries design records.
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
          // SP-20260718-004 R4 same-session choke-point: a VERIFIED ok:true record (not a forged one).
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
          "design step — consult records may be telemetry-only (report-only, T-297-enforcer-ramp)",
        enforcement: "report-only",
      });
    }
  } catch {
    /* fail-open: a report-only check must never break the pipeline */
  }
}

// ── Phase 1: plan ─────────────────────────────────────────────────────

function phase1Plan(state, args) {
  state.currentPhase = "plan";
  mcEnv.setEnv("PHASE_ID", state.currentPhase); // T-303 (N8): phase context for child dispatches
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "plan",
    phase_index: 0,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();

  // If --resume and Plan Contract already exists for this sprint, skip.
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

  // The skill body is responsible for constructing the Plan Contract
  // payload from the verbatim request (Alpha's reasoning). The
  // orchestrator can't infer it from argv alone. So this phase
  // requires the skill body to have written .mc/plan-payload-<slug>.json
  // BEFORE invoking full.js, OR the caller can pass an explicit payload
  // file path. For v0.1 we expect the skill body to have done so.
  const payloadGlob = `${REPO_ROOT}/.mc/plan-payload-*.json`;
  let payloadFile = null;
  // Use the most recent matching file by mtime as a best-effort.
  try {
    const candidates = fs
      .readdirSync(path.join(REPO_ROOT, ".mc"))
      .filter((f) => f.startsWith("plan-payload-") && f.endsWith(".json"))
      .map((f) => path.join(REPO_ROOT, ".mc", f))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    payloadFile = candidates[0] || null;
  } catch {
    /* .mc missing */
  }
  if (!payloadFile) {
    return {
      ok: false,
      halt_reason: "plan_payload_missing",
      message:
        "Phase 1 (plan) requires a payload JSON at .mc/plan-payload-*.json constructed by Alpha from the verbatim request. None found. /sprint:full's skill body is the right place to construct this — see .claude/commands/sprint/full.md.",
    };
  }

  // Stale-payload guard (SP-20260525-018, learn:integrate). The payload is
  // chosen by mtime — which silently grabs a DIFFERENT sprint's stale payload
  // when the skill body skipped Step 1.1 for THIS sprint. Observed 2026-05-25:
  // 31 stale payloads on disk → Phase 1 planned the wrong sprint. Refuse on a
  // sprint mismatch so a wrong-sprint plan can never be designed silently.
  try {
    const pl = JSON.parse(fs.readFileSync(payloadFile, "utf8"));
    if (pl && pl.sprint && pl.sprint !== state.sprintId) {
      return {
        ok: false,
        halt_reason: "plan_payload_sprint_mismatch",
        message:
          `Most-recent plan-payload (${path.basename(payloadFile)}) targets sprint '${pl.sprint}', ` +
          `not '${state.sprintId}'. The skill body likely skipped Step 1.1 (write ` +
          `.mc/plan-payload-<slug>.json for THIS sprint) — Phase 1 would plan the WRONG sprint. ` +
          `Write the correct payload for ${state.sprintId}, then resume.`,
      };
    }
  } catch {
    /* payload unreadable — scripts/sprint/plan.js will surface the parse error */
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
  // Capture PC id from stdout
  const pcMatch = (res.stdout || "").match(/plan-contract:.*?(PC-\d{8}-\d{4})/);
  if (pcMatch) state.planContractId = pcMatch[1];

  // Read Plan Contract for plan_quality + scope
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

// ── Phase 2: design ──────────────────────────────────────────────────

function phase2Design(state) {
  state.currentPhase = "design";
  mcEnv.setEnv("PHASE_ID", state.currentPhase); // T-303 (N8)

  // On --resume, if tickets are already minted from a prior run, skip
  // the rescaffold + tickets_pending halt and advance to Phase 3.
  // Otherwise resume can never get past Phase 2 once tickets exist.
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
  // T-297: design-without-roster enforcer — check only when ε-dispatch is active.
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
  // Advancing without minted ready_for_execution tickets produces a hollow
  // sprint record (0 work done, Phase 3 no-ops, Phase 4 mints a ghost RL).
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
  mcEnv.setEnv("PHASE_ID", state.currentPhase); // T-303 (N8)
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "execute",
    phase_index: 2,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();

  // ESD pre-flight gate — refuse to execute on any ESD that needs signup/billing/credentials.
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

  // Read current.yaml to get ready_for_execution tickets.
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
    // Honest halt. Previously this branch silently returned ok:true, which
    // let Phase 4 (release-prep) mint a release record and Phase 5 (retro)
    // produce a hollow retrospective for a sprint where 0 tickets were
    // ever minted or executed. See task: "Fix /sprint:full hollow-completion
    // bug" / SP-20260522-001 ghost run / RL-20260522-017.
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
    // Resume case: tickets are already done/deferred from a prior run.
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
    // Update ticket to in_progress
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

    // Hand off to execute.js — the skill body drives the Ralph loop.
    // The orchestrator's job is to handle stop_reasons, not to live
    // inside the loop. For v0.1 we mark the ticket and continue;
    // the skill body invokes execute.js start/phase/stop interactively.
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

// ── Phase 4: release-prep ────────────────────────────────────────────

/**
 * FIX (G2.8) resume-idempotency helper. Scan paths.sprintReleases for an
 * existing release record minted for `sprintId` at the given non-production
 * `target`. Returns the release id (e.g. RL-20260526-001) of the first match,
 * or null when none exists. Idempotent + fail-open: any read/parse error
 * returns null so phase4 falls through to a fresh prepare (never duplicates
 * silently, never throws).
 *
 * A "match" is a record whose `sprint` equals sprintId and whose target
 * (deployment_target OR deployment_environment — release.js writes both) is
 * the same non-production target phase4 prepares. Production records are never
 * matched here (target is always non-production in phase4), so this can never
 * mask a production release.
 */
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
      if (recTarget === "production") continue; // never match production
      if (recTarget === target) return rel.id || path.basename(f, ".yaml");
    }
    return null;
  } catch {
    return null;
  }
}

function phase4ReleasePrep(state) {
  state.currentPhase = "release-prep";
  mcEnv.setEnv("PHASE_ID", state.currentPhase); // T-303 (N8)
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "release-prep",
    phase_index: 3,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  const startTs = Date.now();

  // Refuse to mint a release record when zero tickets ever reached `done`.
  // Otherwise the orchestrator produces a hollow RL- record + retrospective
  // for a sprint that did no work. See SP-20260522-001 ghost run.
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

  // release-prep is gated by preset. moderate now pre-authorizes a non-
  // production (staging) release RECORD; aggressive additionally pre-authorizes
  // execution. Production release approval and any deploy/push stay HARD-
  // blocked regardless of preset (loadPreset rejects production targets;
  // FORBIDDEN_PRE_AUTH guards production_release_approval).
  const levels = state.preset.pre_authorized_approval_levels || [];
  const includesReleaseApproval = levels.includes("release_approval_required");
  const targets = state.preset.release_approval_targets || [];
  const target = "staging"; // default for autonomous prep; real deploy is operator's
  // FIX (G2.11): a non-production local/staging release RECORD is reversible
  // and has no external effect (release.js prepare never deploys). It is auto-
  // approved iff the preset pre-authorizes release_approval_required AND lists
  // this target in release_approval_targets, AND the target is non-production.
  // moderate's config now grants this for staging; conservative still has an
  // empty target list, so it continues to halt. The explicit production guard
  // is defense-in-depth: production is never a valid value here (schema enum is
  // staging|internal-canary|dev; loadPreset rejects production targets), so a
  // production release record can never auto-approve through this branch.
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

  // FIX (G2.8): resume-idempotency. phase4 is reached again on every --resume;
  // calling release.js prepare each time mints a fresh RL- record, duplicating
  // the release on disk + in RELEASES.md. Symmetric with phases 1-3's resume
  // skips: scan paths.sprintReleases for an existing record for THIS sprint at
  // a non-production target and, if found, skip prepare and advance.
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

  // Non-production prep path: prepare + check. Skip deploy (hard ceiling).
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
    // Sprint-close regression-seed gate (release.js cmdPrepare → regressionSeedGate)
    // blocked: a NEW regression in a covered class, or a runner error. The suite
    // must be green before a sprint can mint a release record. (0.17.0 per-sprint
    // enforcer — closes the BC-15 gap where the enforcer ran only at /mc:release;
    // commit 5870a0c.) The detail (which classes / runner error) is on the helper's
    // stdout+stderr — surface it verbatim so the halt report is actionable.
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
  // (release.js check + approve handled by skill body or operator)

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

// ── Phase 5: retrospective ────────────────────────────────────────────

/**
 * SP-20260523-001 helper. Flip active-sprints.yaml#sprints[id].status to
 * `closed` if it's not already in {`closed`, `abandoned`, `retrospected`}.
 * Mirrors release.js#cmdDeploy's auto-flip pattern (line 369-393).
 *
 * Idempotent + fail-open: never blocks Phase 5 if the registry can't be
 * updated. The retrospective will report its own status-gate-blocked
 * error if the flip didn't take.
 */
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
  mcEnv.setEnv("PHASE_ID", state.currentPhase); // T-303 (N8)
  emit("sprint_full_phase_started", {
    sprint_id: state.sprintId,
    phase: "retro",
    phase_index: 4,
    cumulative_cost_estimate: state.cost.cumulative,
    ts: nowIso(),
  });
  // SP-20260523-001 fix: retrospective.js' status gate (line 771-782) refuses
  // any status not in {closed, abandoned, retrospected}. /sprint:full's
  // Phase 4 calls `release.js prepare`, which mints a release record but
  // does NOT flip the active-sprints status (only `release.js deploy` does
  // that, and Phase 4 never calls deploy). Without this, retrospective
  // exits 3, flipStatusToRetrospected never runs, and active-sprints.yaml
  // stays stuck at `planning`/`releasing` — caught manually during SP-004
  // and SP-005 today. Auto-flip the registry status to `closed` here so
  // Phase 5 can complete and the retrospective updates it to `retrospected`.
  // Idempotent + fail-open per release.js#cmdDeploy precedent.
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
  // retro is fail-open per its own contract; even non-zero is recoverable.
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

// ── Main orchestrator ────────────────────────────────────────────────

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
  // RESUME-ONLY GUARD: --beta-verdict / --pending-phase are resume-only inputs.
  // Honoring them on a fresh run would silently skip Beta gates that were never
  // consulted — the skip branch would bypass N-1 gates with only the last one
  // recorded. Reject immediately so the skip branch is unreachable on fresh runs.
  if ((args.betaVerdict || args.pendingPhase) && !args.resume) {
    process.stderr.write(
      "--beta-verdict / --pending-phase are resume-only. Re-run with --resume (and --sprint <id>).\n",
    );
    return 2;
  }
  // FIX 1+2: compute pendingIdx from --pending-phase so the phase loop can
  // skip already-cleared Beta boundaries on resume. Validate the value
  // immediately so operators get a clear error on typos (not a silent re-halt).
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

  // T-297: Sprint-mode default — when the active session mode is sprint, enable
  // ε-conduct (epsilon + epsilonDispatch) by default. Explicit CLI flags
  // (_epsilonExplicit tracks them) and MC_EPSILON_RUNTIME env always win.
  // Non-sprint modes: behavior byte-identical to today. Fail-open on mode error.
  // Read-both (S-OS-06): "explicitly set" means EITHER name is present — MC_EPSILON_RUNTIME or its legacy twin.
  const _envEpsilonSet = Object.values(mcEnv.envNames("EPSILON_RUNTIME")).some((n) => Object.prototype.hasOwnProperty.call(process.env, n));
  if (!args._epsilonExplicit && !_envEpsilonSet) {
    try {
      const modeLib = require("../hooks/lib/mode");
      if (modeLib.isSprint()) {
        args.epsilon = true;
        // Re-review fix (gauntlet 2026-06-10, qa lane): respect a standalone
        // --no-epsilon-dispatch — the dispatch half has its own explicit tracker.
        if (!args._epsilonDispatchExplicit) args.epsilonDispatch = true;
      }
    } catch {
      /* fail-open: mode detection unavailable — do not default ON */
    }
  }

  const presetResult = loadPreset(args.autonomy);
  if (!presetResult.ok) {
    process.stderr.write(presetResult.error + "\n");
    return 2;
  }
  const preset = presetResult.preset;

  // Resolve sprint id. Resume requires --sprint; new run uses registry primary
  // or expects a pre-created sprint via add-sprint.js (skill body's job).
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

  // RI-007: when --sprint was OMITTED and we auto-resolved to the registry primary,
  // refuse if that primary is a CLOSED sprint. Otherwise a fresh run (esp. the Master
  // Console driving full.js programmatically without --sprint) silently absorbs the
  // request into a finished sprint and it never ships. An EXPLICIT --sprint is honored
  // (the caller chose it deliberately).
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

  // T-303 (N8): establish run-context env vars so all child dispatches (runHelper
  // spreads ...process.env) carry the same run identity. Rule: respect an inherited
  // MC_RUN_ID — a parent orchestrator's run_id wins; only generate when absent.
  // Format mirrors makeDispatchId() but prefixed `run-` to distinguish orchestrator
  // runs from per-dispatch ids.
  if (!mcEnv.readEnv("RUN_ID")) {
    mcEnv.setEnv(
      "RUN_ID",
      "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex")
    );
  }
  // Stamp the sprint id so dispatch wrappers' runContext() returns the correct sprint.
  mcEnv.setEnv("SPRINT_ID", sprintId);
  // MC_PHASE_ID is set at each phase entry (below in each phase function).

  // Cost gate: per-run --cost-gate on|off overrides the persistent toggle
  // (scripts/sprint/cost-gate.js -> .claude/runtime/sprint-cost-gate.json).
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
    // ε-conducted mode (ADR-0009) — additive; default false. When true, emitPhaseConsults
    // routes each completed phase's step(s) through the ε runtime (real registry-driven
    // dispatch) instead of telemetry-only consults.
    epsilon: !!args.epsilon,
    epsilonDispatch: !!args.epsilonDispatch,
  };

  // Branch protection
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

  // FIX (G2.10): load the persisted set of Beta boundaries already consulted-
  // and-cleared on earlier resume cycles. On a bare `--resume` (no
  // --pending-phase) the loop uses this to advance straight to the first
  // uncrossed boundary instead of re-halting at before_plan every cycle. Only
  // consulted on resume — a fresh run ignores it so no gate is ever pre-skipped.
  const clearedBoundaries = args.resume ? readClearedBetaBoundaries(sprintId) : [];

  // Phase pipeline
  const phaseFns = [
    () => phase1Plan(state, args),
    () => phase2Design(state),
    () => phase3Execute(state),
    () => phase4ReleasePrep(state),
    () => phase5Retro(state),
  ];

  for (let i = 0; i < phaseFns.length; i++) {
    // Derive boundary from the UPCOMING phase (the one about to run at index i),
    // not from state.currentPhase which names the last completed phase.
    const boundary = `before_${PHASES[i]}`;
    // Resume-boundary skip semantics:
    //   A boundary is skipped (no re-halt, no event, no duplication) when, on a
    //   resume, EITHER:
    //     (a) it was persisted as already-cleared on an earlier resume cycle
    //         (FIX G2.10 — lets a bare `--resume` advance to the next uncrossed
    //         boundary without re-threading --pending-phase each time), OR
    //     (b) it is strictly before an explicitly-threaded --pending-phase
    //         (i < pendingIdx — back-compat with the one-verdict-per-resume
    //         CLI flow).
    //   The phase fns are resume-aware and self-skip already-done work.
    //   Otherwise the consult runs: a supplied verdict is consumed here; with
    //   none left it halts with beta_consult_pending (one verdict per resume).
    const alreadyCleared =
      args.resume && clearedBoundaries.includes(boundary);
    const beforePending = args.resume && pendingIdx !== -1 && i < pendingIdx;
    if (alreadyCleared || beforePending) {
      // Already cleared — run the phase fn (which will self-skip on resume).
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
      // A non-null verdict means this boundary was genuinely consulted-and-
      // cleared in THIS process (solo mode returns verdict:null and has no
      // boundaries to track). Persist it so the next bare `--resume` skips it.
      if (consult.verdict) {
        recordClearedBetaBoundary(sprintId, boundary);
        clearedBoundaries.push(boundary);
      }
    }
    // ε liveness heartbeat — stamp the phase transition so an external observer, a
    // resume, or `heartbeat.js check` can tell a live run from a hung one (Phase D d).
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
    emitPhaseConsults(sprintId, PHASES[i], { epsilon: state.epsilon, epsilonDispatch: state.epsilonDispatch });
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
  sprintComposition,
  checkDesignWithoutRoster,
};
