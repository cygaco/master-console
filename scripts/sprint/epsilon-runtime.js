#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * scripts/sprint/epsilon-runtime.js — the ε (Alex Epsilon) sprint-conductor RUNTIME
 * (ADR-0007 Phase D / ADR-0009). The registry-driven lifecycle engine that makes ε
 * actually CONDUCT a sprint, instead of full.js emitting telemetry-only "consulted"
 * records while a human-or-script drives the dispatch.
 *
 * WHAT IT IS (epsilon.md, the locked design):
 *   ε reads a DECLARATIVE hook-point registry — one row per agent attachment
 *   { role, step, condition, mode, order } — and at each of the six lifecycle steps
 *   (plan → design → build → gauntlet → release → retro) it:
 *     1. resolves the matched agent-set for the step under THIS sprint's composition
 *        (hook-points.js#agentsForStep — the composition→agent-set router), then
 *     2. resolves each matched role to a concrete DISPATCH PLAN from the role-registry
 *        keystone (route + provider + model + residency + can_dispatch_builders), then
 *     3. DISPATCHES each agent on its resolved route and writes a REAL completion
 *        record to the canonical ledger gauntlet-verify reads — NOT a bare "consulted"
 *        telemetry stamp. Absence of an ok:true record = the agent did not run.
 *
 *   "Adding an agent to the sprint = adding a registry ROW. ε is never edited." The
 *   route is DERIVED from the registry row (ADR-0008 derive-from-registry pattern), so
 *   a role's provider/model/build-chain membership is single-sourced — ε hard-codes
 *   none of it.
 *
 * THE INVARIANTS IT ENFORCES STRUCTURALLY (epsilon.md "Restrictions" + Independence):
 *   - ε is the SOLE builder-dispatcher. Only the `build` step's builder rows carry
 *     can_dispatch_builders semantics; author-consults at `design` are marked
 *     can_dispatch_builders:false in their plan (the structural guarantee a consult
 *     cannot dispatch — mirrors the advisory-row-that-dispatched PostToolUse hook).
 *   - The gauntlet roster is REGISTRY-FIXED, sourced from agentsForStep, never
 *     constructed ad-hoc (a dynamically-built reviewer list is the override the
 *     dispatch-route-guard rejects). planStep returns exactly the registry's rows.
 *   - A dispatcher CANNOT override a binding FAIL. After the gauntlet the runtime runs
 *     the verdict-content override gate (adhoc-fail-override evaluate-core, ED-025) over
 *     its own EPSILON_RESULT before declaring success — a FAIL coexisting with
 *     status:"complete" / a unit in units_completed HALTS the run.
 *   - β is consulted at every phase boundary (full.js#maybeConsultBeta owns the halt-
 *     and-resume protocol; the runtime defers to it — ε has α+β above it).
 *
 * ADDITIVE + GATED (the load-bearing safety property):
 *   This module does NOT replace full.js. full.js's script-driven path is unchanged and
 *   remains the default. ε-conducted dispatch is OPT-IN — full.js runs the runtime only
 *   when `--epsilon` (or MC_EPSILON_RUNTIME=on) is set. The runtime has two modes:
 *     - PLAN mode (default for tests / dry runs): resolve the full per-step dispatch
 *       PLAN without spawning. Pure given its seams (registry + composition) — the
 *       bite-test drives every branch off disk.
 *     - DISPATCH mode (--dispatch): actually spawn each agent on its route + write the
 *       real completion record. Guarded so a missing dispatch toolkit degrades to PLAN.
 *
 *   node scripts/sprint/epsilon-runtime.js plan   --sprint <id> [--composition <json>] [--json]
 *   node scripts/sprint/epsilon-runtime.js conduct --sprint <id> [--dispatch] [--step <step>]
 *
 * Exit codes: 0 ok · 1 halt (an invariant tripped / a required lane no-record) · 2 usage.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SPRINT = require("./paths"); // worktree CLAUDE_PROJECT_DIR rescue runs on require
const hookPoints = require("./hook-points"); // registry reader + composition→agent-set router
const hookConsult = require("./hook-consult"); // manager_consult emitter (telemetry coverage)
const registryRoles = require("../dispatch/registry-roles"); // role-registry field reader

// T-20260610-304 (G8/N1): foreground-aware timeout clamp. spawnAgent used hardcoded
// 15m/20m bounds that exceeded the 600s harness FOREGROUND kill — a foreground
// wrapper was killed before its own bound fired and never wrote its death record. The
// policy helper clamps to 540s unless an explicit background signal is present
// (opts.background === true or MC_DISPATCH_BACKGROUND=1). FAIL-CLOSED.
const { foregroundAwareTimeout, WRAPPER_DEFAULTS } = require("../dispatch/timeout-policy");

// T-20260611-310 (R-1): parent spawnSync grace over the CHILD wrapper's own bound.
// spawnAgent passes foregroundAwareTimeout(...) as spawnSync's `timeout` — but the child
// wrapper (dispatch-claude.js / dispatch-agent.js) self-bounds at the SAME value, so the
// parent's hard SIGTERM fired at the exact instant the child started writing its graceful
// death record, racing (and often killing) that write. The parent bound must EXCEED the
// child bound so the child's death-record write wins; we keep a parent bound (NOT
// backstop-only — β plan-phase HOW) so a genuinely-hung child is still reaped, just with
// PARENT_GRACE_MS of headroom. Both spawn sites read this SAME constant.
const PARENT_GRACE_MS = 45000; // 45s grace (β-decided window: 30–60s)

// The six canonical lifecycle steps ε conducts, in order (epsilon.md "The Six Steps").
const LIFECYCLE = Object.freeze(["plan", "design", "build", "gauntlet", "release", "retro"]);

// The phase boundaries β is consulted at (epsilon.md "β Consultation"). full.js owns the
// halt-and-resume protocol; the runtime only records that the boundary is a β gate.
const BETA_BOUNDARIES = Object.freeze([
  "plan->design",
  "design->build",
  "gauntlet->release",
  "release->retro",
]);

// ── Route resolution (DERIVED from the role-registry row, not hardcoded) ────────
//
// The dispatch ROUTE for a role is a function of its registry fields, exactly as the
// canonical dispatch pattern (epsilon.md "Dispatch Method") prescribes:
//   - build_chain:true                       → "dispatch-claude"  (reap-guarded wrapper; -w)
//   - provider claude + claude_pinned:true   → "agent-tool"       (multimodal visual judges)
//   - provider claude (managers/leads/dirs)  → "claude-agent"     (in-process Agent dispatch)
//   - provider claude + kind tool            → "claude-raw"       (e.g. test-runner / learner-on-claude)
//   - provider openai|gemini                 → "dispatch-agent"   (cross-provider CLI wrapper)
// A role with no registry row is "unresolved" (the planner flags it — a row referencing a
// non-registered role is exactly what hook-points.validate() already rejects upstream).

const ROUTE = Object.freeze({
  DISPATCH_CLAUDE: "dispatch-claude",
  CLAUDE_AGENT: "claude-agent",
  CLAUDE_RAW: "claude-raw",
  AGENT_TOOL: "agent-tool",
  DISPATCH_AGENT: "dispatch-agent",
  UNRESOLVED: "unresolved",
});

/**
 * Resolve ONE role to its dispatch route + provider/model/residency, purely from the
 * role-registry row. Injectable `roles` (the registry roles object) so the bite-test can
 * drive every branch without reading disk.
 *
 * @param {string} role
 * @param {object} roles  registry roles object (default = the real registry)
 * @returns {{ role, route, provider, model, residency, build_chain, claude_pinned, kind, resolved }}
 */
function resolveRoute(role, roles) {
  const r = roles && roles[role];
  if (!r || typeof r !== "object") {
    return {
      role,
      route: ROUTE.UNRESOLVED,
      provider: null,
      model: null,
      residency: "ephemeral",
      build_chain: false,
      claude_pinned: false,
      kind: null,
      resolved: false,
    };
  }
  const provider = r.provider || "claude";
  const build_chain = r.build_chain === true;
  const claude_pinned = r.claude_pinned === true;
  const kind = r.kind || null;
  const residency = String(r.residency || "").toLowerCase() === "persistent" ? "persistent" : "ephemeral";

  let route;
  if (build_chain) {
    route = ROUTE.DISPATCH_CLAUDE; // builders/fixers — reap-guarded, isolated worktree
  } else if (provider === "claude" && claude_pinned) {
    route = ROUTE.AGENT_TOOL; // design-quality / visual-review — multimodal, Claude-pinned
  } else if (provider === "claude" && kind === "tool") {
    route = ROUTE.CLAUDE_RAW; // non-build Claude tools (test-runner, learner-on-claude)
  } else if (provider === "claude") {
    route = ROUTE.CLAUDE_AGENT; // managers/leads/directors — in-process Agent dispatch
  } else {
    route = ROUTE.DISPATCH_AGENT; // openai/gemini — cross-provider CLI wrapper
  }

  return { role, route, provider, model: r.model || null, residency, build_chain, claude_pinned, kind, resolved: true };
}

/**
 * Whether a matched row, at its step, is permitted to dispatch builders. The structural
 * encoding of the "author-consults cannot dispatch; ε is the sole builder-dispatcher"
 * invariant (epsilon.md design §2 + §3): ONLY rows at the `build` step whose role is a
 * build-chain builder carry dispatch authority. Every author-consult at `design`
 * (product-lead, director-of-engineering, design-lead, quality-lead, copy-lead) returns
 * false — a consult that attempts a builder dispatch is an invariant violation.
 */
function canDispatchBuilders(step, routeInfo) {
  return step === "build" && routeInfo.build_chain === true;
}

/**
 * Plan ONE lifecycle step: resolve the registry's matched agent-set for the step under a
 * composition, then attach each row's dispatch plan (route + invariant flags). PURE given
 * its seams — no spawn, no disk write. This is the registry-driven core the runtime acts
 * on and the bite-test asserts against.
 *
 * @param {string} step        a canonical lifecycle step
 * @param {object} composition { unit_types, max_risk, domains }
 * @param {object} [opts]      { registry, roles } injectable seams
 * @returns {{ step, agents:Array, block_roles:string[], advisory_roles:string[],
 *             builder_roles:string[], gauntlet_fixed:boolean, beta_boundary:string|null }}
 */
function planStep(step, composition, opts = {}) {
  const registry = opts.registry || hookPoints.load();
  const roles = opts.roles || hookPoints.loadRoles();
  const rows = hookPoints.agentsForStep(step, composition, registry);

  const agents = rows.map((row) => {
    const routeInfo = resolveRoute(row.role, roles);
    return {
      role: row.role,
      step,
      mode: row.mode, // block | advisory (the registry row's mode)
      // REPORT-ONLY contract (SP-20260614-001 AC-design): an additive registry boolean,
      // surfaced here so a consumer/test can assert REPORT-ONLY explicitly — distinct from
      // plain advisory. A report_only row is composed + runs but its verdict NEVER gates.
      // Fail-open: default false; a report_only row is forced advisory-not-block below so a
      // report-only lane can never block even if a future edit flips its mode (belt + braces).
      report_only: row.report_only === true,
      order: row.order,
      route: routeInfo.route,
      provider: routeInfo.provider,
      model: routeInfo.model,
      residency: routeInfo.residency,
      resolved: routeInfo.resolved,
      // Structural invariant flags:
      can_dispatch_builders: canDispatchBuilders(step, routeInfo),
      is_author_consult: step === "design", // design rows author specs; they never dispatch
      is_builder: routeInfo.build_chain === true,
      is_reviewer: routeInfo.kind === "reviewer",
    };
  });

  return {
    step,
    agents,
    // A report_only row can NEVER be a blocker, even if its mode were flipped to block by a
    // future edit (the operator-gated blocking flip must drop report_only first). So exclude
    // report_only rows from block_roles unconditionally — fail-open toward not-gating.
    block_roles: agents.filter((a) => a.mode === "block" && !a.report_only).map((a) => a.role),
    advisory_roles: agents.filter((a) => a.mode === "advisory").map((a) => a.role),
    // REPORT-ONLY roster: composed + runs, never gates. Surfaced for assertability.
    report_only_roles: agents.filter((a) => a.report_only).map((a) => a.role),
    builder_roles: agents.filter((a) => a.is_builder).map((a) => a.role),
    reviewer_roles: agents.filter((a) => a.is_reviewer).map((a) => a.role),
    // The gauntlet roster is registry-fixed iff it is exactly the matched rows (it always
    // is here — planStep never augments the set). Surfaced so a caller/test can assert it.
    gauntlet_fixed: step === "gauntlet",
    beta_boundary: betaBoundaryAfter(step),
  };
}

/** The β boundary that FOLLOWS a step (epsilon.md calls β at these four transitions). */
function betaBoundaryAfter(step) {
  switch (step) {
    case "plan":
      return "plan->design";
    case "design":
      return "design->build";
    case "gauntlet":
      return "gauntlet->release";
    case "release":
      return "release->retro";
    default:
      return null; // build (no β between build/gauntlet — same phase) + retro (terminal)
  }
}

/**
 * Plan the FULL lifecycle: one planStep per canonical step. The complete registry-driven
 * conducting plan for a sprint composition — what ε will dispatch, step by step, with the
 * route + invariant flags already resolved. PURE.
 */
function planLifecycle(composition, opts = {}) {
  const registry = opts.registry || hookPoints.load();
  const roles = opts.roles || hookPoints.loadRoles();
  const steps = LIFECYCLE.map((step) => planStep(step, composition, { registry, roles }));
  // normalizeComposition returns Sets (correct for matching); serialize them to arrays so
  // the plan is honest JSON (a Set stringifies to {} — a silent "empty composition" lie).
  const nc = hookPoints.normalizeComposition(composition);
  return {
    composition: { unit_types: [...nc.unit_types], max_risk: nc.max_risk, domains: [...nc.domains] },
    steps,
    beta_boundaries: BETA_BOUNDARIES.slice(),
    // Roll-up invariants the conductor depends on (asserted by the bite-test):
    sole_builder_dispatcher: assertSoleBuilderDispatcher(steps),
    consults_cannot_dispatch: assertConsultsCannotDispatch(steps),
  };
}

/**
 * INVARIANT 1 — ε is the sole builder-dispatcher: no step OTHER than `build` contains a
 * row flagged can_dispatch_builders. Returns { ok, violations[] }.
 */
function assertSoleBuilderDispatcher(steps) {
  const violations = [];
  for (const s of steps) {
    for (const a of s.agents) {
      if (a.can_dispatch_builders && a.step !== "build") {
        violations.push(`${a.role}@${a.step} carries builder-dispatch authority outside the build step`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * INVARIANT 2 — author-consults cannot dispatch: every `design`-step row is an author-
 * consult and MUST NOT carry can_dispatch_builders. Returns { ok, violations[] }.
 */
function assertConsultsCannotDispatch(steps) {
  const violations = [];
  const design = steps.find((s) => s.step === "design");
  if (design) {
    for (const a of design.agents) {
      if (a.can_dispatch_builders) {
        violations.push(`design author-consult ${a.role} must not carry builder-dispatch authority`);
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Composition loader (from a sprint's tickets — the same source full.js feeds) ─

/**
 * Best-available sprint composition from the sprint's ticket files. Identical semantics to
 * full.js#sprintComposition so the conducted path and the script path agree on which rows
 * fire. Reads ticket YAML/JSON directly; empty early in the lifecycle, full by gauntlet.
 */
function compositionForSprint(sprintId, ticketsDir = SPRINT.tickets) {
  const tickets = [];
  try {
    for (const f of fs.readdirSync(ticketsDir)) {
      if (!/\.(ya?ml|json)$/.test(f)) continue;
      const { readYamlMaybe } = require("./fs");
      const t = readYamlMaybe(path.join(ticketsDir, f));
      if (t && t.sprint === sprintId) tickets.push(t);
    }
  } catch {
    /* no tickets dir yet → empty composition (only always-on rows fire) */
  }
  return hookPoints.compositionFromTickets(tickets);
}

// ── DISPATCH layer (real spawns + real completion records) ──────────────────────
//
// Guarded so a missing toolkit degrades to PLAN-only rather than crashing a conduct run.
// Every dispatched agent writes the SAME completion record gauntlet-verify reads, so a
// silent reap is loud (absence = death). This is the concrete replacement of full.js's
// telemetry-only "consulted" stamp: a dispatch RECORD, not just a consult marker.

let _telemetry = null;
function telemetry() {
  if (_telemetry) return _telemetry;
  try {
    const da = require("../dispatch-agent"); // canonical record/path helpers (ED-016-safe)
    _telemetry = {
      recordCompletion: da.recordCompletion,
      makeDispatchId: da.makeDispatchId,
      cmdlineChecksum: da.cmdlineChecksum,
      AGENT_ROOT: da.AGENT_ROOT,
      // T-303 (N8): single-source runContext() for run/phase/sprint env reads.
      // in-process recordAgentDispatch uses this to stamp run_id + sprint_id.
      runContext: da.runContext,
      ok: true,
    };
  } catch (e) {
    _telemetry = { ok: false, error: e.message };
  }
  return _telemetry;
}

/**
 * Record a REAL dispatch completion for one agent on its resolved route. In a real conduct
 * run this is written AFTER the agent's spawn returns; here the runtime writes the record
 * with the spawn outcome so the ledger reflects what ran. The record is the SAME shape
 * dispatch-agent/dispatch-claude write — so gauntlet-verify sees ε's reviewers exactly as
 * it sees γ/δ's. `ok` reflects the spawn outcome the caller passes (a reap → ok:false).
 *
 * @returns {{ recorded:boolean, dispatch_id?:string, reason?:string }}
 */
function recordAgentDispatch(
  agentPlan,
  sprintId,
  { ok, promptBytes = 0, evidenceBytes, evidenceSha, elapsedMs = 0, via = "epsilon-runtime", verdict, shape = "in-process-agent" } = {},
) {
  // FAKE-GREEN GUARD: refuse to write a completion record without an EXPLICIT boolean
  // outcome from a real spawn. The prior `{ ok = true }` default let conductStep stamp
  // ok:true liveness records with no spawn behind them (the bug the operator caught).
  if (typeof ok !== "boolean") {
    return { recorded: false, reason: "refusing to record without a real spawn outcome (ok must be a boolean returned by spawnAgent / derived from real evidence bytes)" };
  }
  const t = telemetry();
  if (!t.ok) return { recorded: false, reason: `telemetry unavailable: ${t.error}` };
  const now = new Date().toISOString();
  // Backdate started_at by the REAL elapsed (in-process path passes the Agent-tool wall-clock)
  // so the record reflects actual duration, not elapsed_ms:0 (a synthetic 0 is a fake-tell).
  const startedAt = elapsedMs > 0 ? new Date(Date.parse(now) - elapsedMs).toISOString() : now;
  const dispatchId = t.makeDispatchId();
  // stdout_bytes carries REAL output size: the subprocess stdout for CLI routes (caller sets
  // evidenceBytes from the Agent-tool return for in-process), falling back to the 1/0 liveness
  // bit only when no real byte count is available.
  const stdoutBytes = typeof evidenceBytes === "number" ? evidenceBytes : ok ? 1 : 0;
  t.recordCompletion({
    dispatch_id: dispatchId,
    pid: process.pid,
    role: agentPlan.role,
    provider: agentPlan.provider || "claude",
    model: agentPlan.model || null,
    started_at: startedAt,
    completed_at: now,
    elapsed_ms: elapsedMs,
    prompt_bytes: promptBytes,
    cmdline_checksum: t.cmdlineChecksum(agentPlan.role, agentPlan.provider || "claude", promptBytes),
    exit_code: ok ? 0 : 1,
    stdout_bytes: stdoutBytes,
    stderr_bytes: 0,
    fallback: false,
    ok,
    // SR-016 sweep: the record carries its STRUCTURAL channel shape, exactly as the subprocess wrappers do
    // (dispatch-agent → subprocess-cross-provider, dispatch-claude → subprocess-claude). This is the
    // non-settable identity the panel hunter attestation keys on. `shape` is WRITER-DETERMINED BY ROUTE
    // (this internal function's two trusted call sites: the in-process path defaults to "in-process-agent";
    // the CLAUDE_RAW `claude -p --agent` path passes "subprocess-claude" — CLAUDE-RAW-SHAPE-STAMP hunter LOW,
    // channel-faithful). It is NOT settable from a dispatch payload — a subprocess record can never
    // masquerade as the in-process hunter (isHunterRecord also requires role === security_claude_hunter,
    // which no CLAUDE_RAW tool role carries).
    shape,
    // T-303 (N8): run-context for §17.4 coverage-gate run-scoped filtering.
    // run_id from env (set by full.js or inherited — null when dispatched standalone).
    // phase_id derived from agentPlan.step (authoritative for in-process records;
    // also set on mcEnv.readEnv("PHASE_ID") by full.js before each phase entry so
    // runContext() would agree, but we use the explicit value for reliability).
    // sprint_id: use the explicit sprintId arg (reliable even when env not set);
    //   the runContext() single-source reads env, but the arg is always present here.
    run_id: mcEnv.readEnv("RUN_ID") || null,
    // SAME-RUN panel correlation (SP-20260718-003 Unit H activation): the in-process hunter record MUST carry
    // the panel_run_id the runner minted (MC_PANEL_RUN_ID) + the code_sha it ran against (git HEAD), exactly
    // as dispatch-agent stamps its CLI records — otherwise applyPanelGate / attestPanelRun cannot same-run
    // correlate the hunter lane into a panel-3lab attestation (ADR-0022 teeth-5: binding-green needs one REAL
    // same-run hunter record). Both are null when the hunter is dispatched outside a panel run (standalone).
    panel_run_id: mcEnv.readEnv("PANEL_RUN_ID") || null,
    code_sha: (() => { try { return require("../dispatch/git-head").readGitHead(agentRoot()) || null; } catch { return null; } })(),
    phase_id: agentPlan.step,
    // ε-conductor provenance (extra fields are ignored by gauntlet-verify's typed check):
    sprint_id: sprintId,
    via,
    step: agentPlan.step,
    route: agentPlan.route,
    // in-process evidence binding (Increment B): sha256 of the Agent-tool return that backs ok.
    ...(evidenceSha ? { evidence_sha: evidenceSha } : {}),
    // SR-019 (ADR-0022): the REVIEW verdict (pass/fail/warn) extracted from the Agent-tool return, so the
    // panel gate can bind the binding claude lane to the HUNTER's verdict. Only stamped when a real verdict
    // was parsed from the evidence — an absent verdict leaves the field off → the gate treats it as BLOCK.
    ...(verdict ? { verdict } : {}),
  });
  return { recorded: true, dispatch_id: dispatchId };
}

// ── REAL spawn (Increment A — ADR-0009 Mitigation #4; β DECIDE 0.88/0.89) ─────────
//
// ε --dispatch ACTUALLY spawns each agent on its resolved route; the completion record
// reflects the REAL outcome. The 3 routes a node process CAN spawn:
//   - DISPATCH_AGENT (openai/gemini) → scripts/dispatch-agent.js  (writes its own record)
//   - DISPATCH_CLAUDE (build-chain)  → scripts/dispatch-claude.js (writes its own record)
//   - CLAUDE_RAW                     → `claude -p --agent`         (writes NO record per
//                                       ED-018 → ε records the REAL outcome here)
// The 2 in-process routes a node process CANNOT spawn (CLAUDE_AGENT managers/leads,
// AGENT_TOOL design-quality/visual-review — in-process Claude teammates spawned only by the
// harness Agent tool) return spawned:false / requires-orchestrator and write NO record. The
// full ε-the-agent conductor (those routes, via the Agent tool) is the next named increment.

const { spawnSync: _spawnSync } = require("child_process");

function agentRoot() {
  const t = telemetry();
  return (t.ok && t.AGENT_ROOT) || path.resolve(__dirname, "..", "..");
}

/** The ordered provider passes for a role (primary + second_pass + third_pass), or [] if it can't
 *  be resolved. Multi-pass roles (length > 1, e.g. security-reviewer) route through dispatch-review.js
 *  so every declared pass FIRES as a reap-safe single-pass child (E-DISPATCH-PERFECT-001 W1). */
function passesForRole(role) {
  try {
    return require(path.join(agentRoot(), "scripts", "dispatch", "registry-roles")).passesOf(role);
  } catch {
    return [];
  }
}

// WG-10 (doogle-verified, REPRODUCES): the dispatched prompt must carry the sprint's REAL
// requirement artifacts, not a ~215-byte stub — otherwise a builder returns trivially and the
// phase advances on ok:true with zero product work (a hollow build). The artifacts live at
// `.claude/project/sprint/requirements/<sprintId>/{prd,granular-stories,acceptance-criteria,...}.md`
// (the same location full.js's script path writes/consumes). Load the step-relevant set.
const REQ_FILES_BY_STEP = Object.freeze({
  design: ["prd.md", "high-level-stories.md", "inputs.md"],
  build: ["prd.md", "granular-stories.md", "acceptance-criteria.md", "inputs.md", "copy.md"],
  gauntlet: ["acceptance-criteria.md", "granular-stories.md", "qa-plan.md", "redteam-plan.md"],
  release: ["acceptance-criteria.md"],
});

/** Load the step-relevant sprint requirement artifacts (those that exist + are non-empty). */
function loadRequirementArtifacts(sprintId, step) {
  const reqDir = path.join(agentRoot(), ".claude", "project", "sprint", "requirements", sprintId);
  const wanted = REQ_FILES_BY_STEP[step] || ["prd.md", "acceptance-criteria.md"];
  const chunks = [];
  for (const f of wanted) {
    try {
      const txt = fs.readFileSync(path.join(reqDir, f), "utf8").trim();
      if (txt) chunks.push(`===== ${f} =====\n${txt}`);
    } catch {
      /* artifact absent for this sprint/step — skip (a partial set is still real content) */
    }
  }
  return { reqDir, chunks };
}

/** Write a real per-agent prompt for the step; returns the file path. */
function writeStepPrompt(agentPlan, sprintId) {
  const dir = path.join(agentRoot(), ".claude", "runtime", "epsilon-prompts");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sprintId}-${agentPlan.step}-${agentPlan.role}.txt`);
  const header =
    `Sprint ${sprintId} — lifecycle step "${agentPlan.step}". You are dispatched as role ` +
    `"${agentPlan.role}" (route ${agentPlan.route}). Carry out your ${agentPlan.step}-step ` +
    `responsibility per your role spec and return your result envelope.`;
  const { reqDir, chunks } = loadRequirementArtifacts(sprintId, agentPlan.step);
  const body = chunks.length
    ? `\n\n--- SPRINT REQUIREMENT ARTIFACTS (${chunks.length} loaded from ${path.relative(agentRoot(), reqDir)}/) ---\n\n${chunks.join("\n\n")}\n`
    : // LOUD, not hollow: no artifacts → the dispatch is honest about carrying only the directive,
      // and names the precondition (the design phase must author the requirements first).
      `\n\n[WG-10: no requirement artifacts at ${path.relative(agentRoot(), reqDir)}/ — dispatching with the step directive ONLY. A real build needs prd.md / granular-stories.md / acceptance-criteria.md authored by the design phase first.]\n`;
  fs.writeFileSync(file, header + body);
  return file;
}

/** Normalize a spawnSync result into a uniform outcome. ok requires exit 0 AND non-empty
 *  stdout (0-byte-on-exit-0 is the ED-018 reap signature — a reap, not a success). */
function interpretSpawn(r, agentPlan, recordedByCli) {
  if (!r || r.error) {
    return { spawned: false, ok: false, recorded: false, route: agentPlan.route, reason: `spawn failed: ${(r && r.error && r.error.message) || "no result"}` };
  }
  const exit = typeof r.status === "number" ? r.status : 1;
  const outBytes = Buffer.byteLength(r.stdout || "");
  const ok = exit === 0 && outBytes > 0;
  return { spawned: true, ok, recorded: recordedByCli, route: agentPlan.route, exit_code: exit, output_bytes: outBytes, reaped: !ok };
}

/**
 * REALLY spawn one agent on its route + return the real outcome. opts.run is injectable
 * (default child_process spawnSync) so the bite-test drives every branch deterministically.
 * NEVER returns ok:true without an actual spawn — the fake-green this replaces.
 */
function spawnAgent(agentPlan, sprintId, opts = {}) {
  const run = opts.run || _spawnSync;
  const root = agentRoot();
  const env = { ...process.env, ...(opts.env || {}) };
  // T-303 (N8): stamp run-context vars on the child env so CLI-routed wrappers'
  // runContext() picks them up and stamps run_id/phase_id/sprint_id onto every
  // completion record. Respect an inherited MC_RUN_ID — only generate when
  // absent (parent orchestrator's run_id wins over per-dispatch generation; if full.js
  // set it on process.env it is already in the spread above, but guard anyway for
  // standalone invocations where mcEnv.readEnv("RUN_ID") may be absent).
  if (!mcEnv.readEnv("RUN_ID", env)) {
    mcEnv.setEnv("RUN_ID", "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex"), env);
  }
  mcEnv.setEnv("PHASE_ID", agentPlan.step, env);
  mcEnv.setEnv("SPRINT_ID", sprintId, env);
  // T-322 (attempt #3): when ε computes a BACKGROUND bound (opts.background === true),
  // propagate the background SIGNAL to the child env. The child wrappers re-clamp the
  // propagated childBaseMs via foregroundAwareTimeout(n, {}) (empty opts → it reads
  // mcEnv.readEnv("DISPATCH_BACKGROUND")), so without this stamp a background childBaseMs
  // (900s) would be silently re-clamped back to the 540s foreground ceiling on the child —
  // the "background unaffected" guarantee would hold only when the signal happened to be in
  // the ambient env. Setting it here makes the guarantee hold via the ε spawn path's OWN
  // construction. (process.env passthrough above is preserved; we only ADD the signal.)
  if (opts.background === true) mcEnv.setEnv("DISPATCH_BACKGROUND", "1", env);
  // T-20260610-304: clamp to FOREGROUND_CEILING_MS (540s) when not explicitly backgrounded.
  // opts.background === true or MC_DISPATCH_BACKGROUND=1 passes through the full bound.
  // The per-route child base (childBaseMs) + the env-propagation that single-sources it on
  // the child are computed at each spawn site below — they differ per route (epsilon-agent vs
  // epsilon-claude defaults), so `timeout`/env are NOT set here in `common`.
  const common = {
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
  };

  // In-process Claude teammates — a node script CANNOT spawn these (harness Agent tool only).
  if (agentPlan.route === ROUTE.CLAUDE_AGENT || agentPlan.route === ROUTE.AGENT_TOOL) {
    return { spawned: false, ok: false, recorded: false, route: agentPlan.route, reason: "requires-orchestrator: in-process Claude teammate — dispatched by ε-the-agent / α via the harness Agent tool, not from a node script (next increment: --epsilon-dispatch)" };
  }
  if (agentPlan.route === ROUTE.UNRESOLVED) {
    return { spawned: false, ok: false, recorded: false, route: agentPlan.route, reason: "unresolved route (no role-registry row)" };
  }

  const promptFile = opts.promptFile || writeStepPrompt(agentPlan, sprintId);

  if (agentPlan.route === ROUTE.DISPATCH_AGENT) {
    // T-310/R-1 (FIX-A1): single-source the child bound BY CONSTRUCTION. Compute the child
    // base ONCE, PROPAGATE it to the child via DISPATCH_BUILDER_TIMEOUT_MS, and set the parent
    // SIGTERM bound = childBaseMs + PARENT_GRACE_MS. This holds parent = child + grace for EVERY
    // opts.timeoutMs (small/huge/unset), closing the death-record race the old code only closed
    // on the happy path (opts.timeoutMs unset). foregroundAwareTimeout is idempotent, so the
    // child re-clamp of the propagated value can never lift it above childBaseMs.
    const childBaseMs = foregroundAwareTimeout(opts.timeoutMs || WRAPPER_DEFAULTS["epsilon-agent"], opts);
    env.DISPATCH_BUILDER_TIMEOUT_MS = String(childBaseMs);
    // W1 (E-DISPATCH-PERFECT-001): a role with declared extra passes (second_pass/third_pass) routes
    // through dispatch-review.js — it FIRES one reap-safe single-pass dispatch-agent child PER PASS
    // in parallel, each self-recording a provider-stamped completion record (so gauntlet-verify +
    // security-pass-count see N lanes). Single-pass roles go direct. Both self-record
    // (recordedByCli=true) — ε never double-records.
    const reviewScript =
      passesForRole(agentPlan.role).length > 1 ? "scripts/dispatch-review.js" : "scripts/dispatch-agent.js";
    const r = run(process.execPath, [path.join(root, reviewScript), agentPlan.role, promptFile], {
      ...common,
      timeout: childBaseMs + PARENT_GRACE_MS,
    });
    return interpretSpawn(r, agentPlan, /*recordedByCli=*/ true);
  }
  if (agentPlan.route === ROUTE.DISPATCH_CLAUDE) {
    const args = [path.join(root, "scripts/dispatch-claude.js"), agentPlan.role, promptFile];
    if (opts.worktree) args.push("--worktree", opts.worktree);
    // T-20260610-304: DISPATCH_CLAUDE uses the longer 20m default but still clamps to 540s foreground.
    // T-310/R-1 (FIX-A1): single-source the child bound BY CONSTRUCTION — identical discipline to
    // the epsilon-agent site (the two-site rename-hygiene bug class: fix both, miss neither).
    // Compute childBaseMs ONCE, PROPAGATE it via DISPATCH_BUILDER_TIMEOUT_MS — dispatch-claude.js
    // reads exactly this env for its own bound (TIMEOUT_MS at ~line 313) — and set the parent
    // SIGTERM bound = childBaseMs + PARENT_GRACE_MS so parent = child + grace for EVERY
    // opts.timeoutMs value, not only when opts.timeoutMs is unset.
    const childBaseMs = foregroundAwareTimeout(opts.timeoutMs || WRAPPER_DEFAULTS["epsilon-claude"], opts);
    env.DISPATCH_BUILDER_TIMEOUT_MS = String(childBaseMs);
    const r = run(process.execPath, args, {
      ...common,
      timeout: childBaseMs + PARENT_GRACE_MS,
    });
    return interpretSpawn(r, agentPlan, /*recordedByCli=*/ true);
  }
  // CLAUDE_RAW — `claude -p --agent` writes NO completion record (ED-018) → ε records the REAL outcome.
  // No child wrapper here (raw claude), so nothing reads DISPATCH_BUILDER_TIMEOUT_MS — but the parent
  // must still be BOUNDED (the `timeout` no longer lives in `common`). Use the epsilon-claude base +
  // grace so the raw route keeps the same bound it had before FIX-A1.
  // ── Shape-resolver self-detection (W2-core) ──────────────────────────────────
  // CLAUDE_RAW is the ONE epsilon spawn that does NOT delegate to an already-doored
  // wrapper (the DISPATCH_AGENT/DISPATCH_CLAUDE routes above shell to dispatch-agent.js/
  // dispatch-claude.js, which own the door — consulting here too would double-consult and
  // risk a divergent verdict). It spawns `claude -p --agent <role>` raw → transport =
  // subprocess-claude. Door-gated (NOT pinned — it rides the enforce ramp); on REFUSE,
  // abort THIS spawn (a failed dispatch), never process.exit (ε is a long-running conductor).
  try {
    const { shapeDoor } = require(path.join(root, "scripts/dispatch/dispatch-shape.js"));
    // W2/N2 ENFORCE FLIP (2026-06-16): CLAUDE_RAW enforces by default (it rides the ramp).
    // Safe-by-construction (a real role resolves proven:true + 'subprocess-claude' MATCH → never
    // refused). On REFUSE ε aborts THIS spawn (never process.exit). Per-wrapper kill:
    // MC_SHAPE_DOOR_EPSILON=report; fleet kill: MC_SHAPE_DOOR=report; ultimate: MC_DISABLE_SHAPE_DOOR=1.
    // Per-wrapper env is a TRUE kill (W2 gauntlet MED-1): report → force report via reportOnlyPin
    // (beats a global enforce); unset → enforceDefault (the ramp default).
    const killThis = /^(report|off|0)$/i.test(String(mcEnv.readEnv("SHAPE_DOOR_EPSILON", env) || ""));
    const door = shapeDoor("subprocess-claude", { kind: "agent", id: agentPlan.role }, env, killThis ? { reportOnlyPin: true } : { enforceDefault: true });
    if (door.mismatch && door.mismatch.mismatch && !door.suppressed) {
      process.stderr.write(
        `[epsilon-runtime] CLAUDE_RAW shape-resolver ${door.action === "refuse" ? "VIOLATION" : "advisory"} (${door.mode}): role '${agentPlan.role}' spawned raw as 'subprocess-claude' but the resolver picks '${door.mismatch.expected}' (${door.mismatch.expectedReason || door.mismatch.reason}).\n`,
      );
    }
    if (door.action === "refuse") {
      return { spawned: false, ok: false, recorded: false, reason: "dispatch_shape_mismatch", expected: door.mismatch.expected, actual: "subprocess-claude", severity: door.mismatch.severity, role: agentPlan.role };
    }
  } catch {
    /* fail-open — the resolver consult never crashes a conduct */
  }
  const bin = env.DISPATCH_CLAUDE_BIN || "claude";
  const binArgs = env.DISPATCH_CLAUDE_BIN_ARGS ? JSON.parse(env.DISPATCH_CLAUDE_BIN_ARGS) : [];
  const prompt = fs.readFileSync(promptFile, "utf8");
  const rawBaseMs = foregroundAwareTimeout(opts.timeoutMs || WRAPPER_DEFAULTS["epsilon-claude"], opts);
  const r = run(bin, [...binArgs, "-p", "--agent", agentPlan.role], { ...common, input: prompt, timeout: rawBaseMs + PARENT_GRACE_MS });
  const out = interpretSpawn(r, agentPlan, /*recordedByCli=*/ false);
  if (out.spawned) {
    // CLAUDE-RAW-SHAPE-STAMP (hunter LOW, channel-faithful): a `claude -p --agent` raw dispatch is a
    // SUBPROCESS-claude channel, not in-process — stamp its true channel shape (the record can never be
    // mistaken for the in-process hunter; role != security_claude_hunter + no evidence digest already
    // exclude it — this is faithfulness/defense-in-depth, not a fix for an exploitable path).
    recordAgentDispatch(agentPlan, sprintId, { ok: out.ok, promptBytes: Buffer.byteLength(prompt), shape: "subprocess-claude" });
    out.recorded = true;
  }
  return out;
}

// ── In-process dispatch record (Increment B — ADR-0009 Mitigation #4, the named next step) ──
//
// The 2 in-process Claude-teammate routes (CLAUDE_AGENT — managers/leads/directors;
// AGENT_TOOL — design-quality/visual-review) CANNOT be spawned by a node process; only the
// harness Agent tool can (ε-the-agent / α). So those are dispatched by ε-the-agent via the
// Agent tool, which captures the agent's RETURNED ENVELOPE to a file; ε then calls this to
// write the SAME completion record gauntlet-verify reads (absence of an ok:true record = the
// lane silently died, per epsilon.md).
//
// The honesty guarantee is preserved exactly as for the CLI routes: `ok` is DERIVED FROM the
// real evidence bytes, never self-asserted. A 0-byte Agent return = the in-process analog of
// the ED-018 reap (a dispatch that produced nothing → ok:false). NO evidence file at all =
// no proof a spawn happened → REFUSE (no record). This is what keeps ε-the-agent from
// re-introducing the fake-green the operator caught — it cannot stamp ok:true out of thin
// air; it must produce the Agent tool's actual return, whose byte count decides ok.

function recordInProcessCompletion(agentPlan, sprintId, { evidenceFile, elapsedMs = 0 } = {}) {
  if (agentPlan.route !== ROUTE.CLAUDE_AGENT && agentPlan.route !== ROUTE.AGENT_TOOL) {
    return {
      recorded: false,
      reason: `record-inprocess is for in-process routes only (CLAUDE_AGENT / AGENT_TOOL); role '${agentPlan.role}' resolves to route '${agentPlan.route}', a CLI/subprocess role — dispatch it via 'node scripts/dispatch-agent.js ${agentPlan.role} <prompt-file>' (or spawnAgent), which capture real subprocess output. NB: design-lead is the common case here — it is a deliberate cross-provider consult lead (RULE 4), not an in-process teammate, so this refusal is correct (ED-055).`,
    };
  }
  // No evidence file → there is NO proof an Agent-tool spawn happened. Refuse — the in-process
  // mirror of recordAgentDispatch's "ok must be a real outcome" guard (the anti-fake-green floor).
  if (!evidenceFile || !fs.existsSync(evidenceFile)) {
    return { recorded: false, reason: "refusing to record without the Agent-tool return evidence (--evidence <file>): no spawn behind it" };
  }
  let buf;
  try {
    buf = fs.readFileSync(evidenceFile);
  } catch (e) {
    return { recorded: false, reason: `evidence unreadable: ${e.message}` };
  }
  const evidenceBytes = buf.length;
  const evidenceSha = crypto.createHash("sha256").update(buf).digest("hex");
  const ok = evidenceBytes > 0; // 0-byte return = reap (ED-018 analog), NOT a success
  // SR-019 (ADR-0022): extract the hunter's REVIEW verdict from the Agent-tool return so the panel gate
  // can bind the binding claude lane to the HUNTER's verdict (dispatch-review#applyPanelGate). The evidence
  // is the hunter's ReviewResult JSON; read its top-level `verdict`. Fail-CLOSED: a non-JSON return or an
  // absent/invalid verdict leaves `verdict` undefined → the record carries no verdict → the gate BLOCKS the
  // hunter lane (a hunter that produced no parseable verdict must never read as a pass). `ok` (did it RUN)
  // stays independent of the verdict (did it PASS) — a hunter that ran and FAILED is ok:true + verdict:fail.
  let verdict;
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    const v = parsed && typeof parsed.verdict === "string" ? parsed.verdict.toLowerCase() : null;
    if (v === "pass" || v === "fail" || v === "warn") verdict = v;
  } catch {
    /* non-JSON evidence → no verdict → the panel gate treats the hunter lane as BLOCK (fail-closed) */
  }
  const result = recordAgentDispatch(agentPlan, sprintId, {
    ok,
    evidenceBytes,
    evidenceSha,
    elapsedMs,
    via: "epsilon-agent",
    verdict,
  });
  // Surface the DERIVED outcome so callers (CLI + tests) see what ok was bound to — proves
  // ok came from the evidence bytes, not an assertion.
  return { ...result, ok, evidence_bytes: evidenceBytes, evidence_sha: evidenceSha };
}

/**
 * Conduct ONE step: emit the manager_consult coverage records (telemetry — what
 * sprint-manager-consult / sprint-hook-coverage read) AND, in dispatch mode, write a real
 * completion record per matched agent. Returns the step plan + the dispatch outcome.
 *
 * The two record kinds are complementary, NOT redundant:
 *   - manager_consult   → COVERAGE proof "the right agent was engaged at the right step"
 *     (hook-consult.js, already wired; ED-022's design-touch loop lives here).
 *   - completion record → LIVENESS proof "the agent actually ran" (gauntlet-verify reads
 *     it; absence = death). This is what full.js's telemetry-only path never produced.
 *
 * @param {object} opts { dispatch:boolean, registry, roles, logFn }
 */
function conductStep(step, composition, sprintId, opts = {}) {
  const plan = planStep(step, composition, opts);

  // (1) COVERAGE — emit the manager_consult per matched agent (+ the ED-022 design-touch
  //     signal at build/gauntlet). hook-consult is injectable via opts.logFn for tests.
  const consulted = hookConsult.emitStepConsults(step, composition, sprintId, opts.logFn);
  if (step === "build" || step === "gauntlet") {
    hookConsult.emitDesignTouch(composition, sprintId, opts.logFn);
  }

  // (2) LIVENESS — in dispatch mode, REALLY SPAWN each agent on its route (spawnAgent) so the
  //     completion record reflects the real outcome. PLAN mode stops at coverage (no spawn).
  //     NO ok:true record is ever written without an actual spawn; in-process routes honestly
  //     return requires-orchestrator and write nothing. opts.run/opts.spawn are injectable for tests.
  const dispatched = [];
  if (opts.dispatch) {
    const spawn = opts.spawn || spawnAgent;
    for (const a of plan.agents) {
      const out = spawn(a, sprintId, opts);
      dispatched.push({ role: a.role, route: a.route, spawned: out.spawned, ok: out.ok, recorded: out.recorded, reason: out.reason });
    }
  }

  return { step, plan, consulted, dispatched, beta_boundary: plan.beta_boundary };
}

/**
 * The verdict-content override gate over ε's OWN result (ED-025). The runtime MUST run this
 * before declaring a sprint complete: a binding reviewer FAIL coexisting with
 * status:"complete" / a unit in units_completed is a dispatcher overriding a binding FAIL,
 * which is forbidden (epsilon.md Independence invariant #2). Delegates to the SAME
 * evaluate-core the adhoc gate uses (schema-tolerant across GAMMA/DELTA/EPSILON) so the ε
 * path inherits the identical can't-override guarantee. Returns { ok, errors[] }.
 */
function assertNoFailOverride(epsilonResult, reviewerVerdicts = []) {
  let evaluate;
  try {
    ({ evaluate } = require("../checks/adhoc-fail-override"));
  } catch (e) {
    // Fail-CLOSED: if the override gate can't load, we cannot certify no-override.
    return { ok: false, errors: [`override gate unavailable (fail-closed): ${e.message}`] };
  }
  const out = evaluate({ result: epsilonResult, reviewerVerdicts });
  return { ok: out.result === "PASS", errors: out.errors };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────

function parseCliComposition(argv) {
  const ci = argv.indexOf("--composition");
  if (ci !== -1 && argv[ci + 1]) {
    try {
      return JSON.parse(argv[ci + 1]);
    } catch (e) {
      process.stderr.write(`bad --composition JSON: ${e.message}\n`);
      process.exit(2);
    }
  }
  const si = argv.indexOf("--sprint");
  const sprintId = si !== -1 ? argv[si + 1] : SPRINT.active();
  if (!sprintId) {
    process.stderr.write("no --sprint <id> and no active sprint — cannot derive composition\n");
    process.exit(2);
  }
  return compositionForSprint(sprintId);
}

function main(argv) {
  const cmd = argv[2] || "plan";
  const json = argv.includes("--json");
  const si = argv.indexOf("--sprint");
  const sprintId = si !== -1 ? argv[si + 1] : SPRINT.active() || "SP-EPSILON-DRYRUN";

  if (cmd === "plan") {
    const composition = parseCliComposition(argv);
    const lifecycle = planLifecycle(composition);
    if (json) {
      process.stdout.write(JSON.stringify(lifecycle, null, 2) + "\n");
    } else {
      process.stdout.write(`ε lifecycle plan — composition ${JSON.stringify(lifecycle.composition)}\n`);
      for (const s of lifecycle.steps) {
        const tags = s.agents
          .map((a) => `${a.role}[${a.route}${a.mode === "block" ? ",block" : ""}${a.can_dispatch_builders ? ",dispatch" : ""}]`)
          .join(", ");
        process.stdout.write(`  ${s.step.padEnd(9)} → ${tags || "(none)"}${s.beta_boundary ? `   βǁ ${s.beta_boundary}` : ""}\n`);
      }
      const inv = [];
      if (!lifecycle.sole_builder_dispatcher.ok) inv.push(...lifecycle.sole_builder_dispatcher.violations);
      if (!lifecycle.consults_cannot_dispatch.ok) inv.push(...lifecycle.consults_cannot_dispatch.violations);
      process.stdout.write(
        inv.length === 0
          ? `  invariants: OK (ε sole builder-dispatcher; consults cannot dispatch)\n`
          : `  invariants: VIOLATED:\n${inv.map((v) => "    - " + v).join("\n")}\n`,
      );
    }
    const invOk = lifecycle.sole_builder_dispatcher.ok && lifecycle.consults_cannot_dispatch.ok;
    return invOk ? 0 : 1;
  }

  if (cmd === "conduct") {
    const dispatch = argv.includes("--dispatch");
    const stepIdx = argv.indexOf("--step");
    const onlyStep = stepIdx !== -1 ? argv[stepIdx + 1] : null;
    const composition = parseCliComposition(argv);
    const steps = onlyStep ? [onlyStep] : LIFECYCLE;
    if (onlyStep && !LIFECYCLE.includes(onlyStep)) {
      process.stderr.write(`unknown --step '${onlyStep}'. one of: ${LIFECYCLE.join(" | ")}\n`);
      return 2;
    }
    const out = [];
    for (const step of steps) {
      out.push(conductStep(step, composition, sprintId, { dispatch }));
    }
    if (json) {
      process.stdout.write(JSON.stringify({ sprint_id: sprintId, dispatch, steps: out }, null, 2) + "\n");
    } else {
      process.stdout.write(`ε conduct ${dispatch ? "(dispatch)" : "(plan-only)"} — sprint ${sprintId}\n`);
      for (const s of out) {
        process.stdout.write(
          `  ${s.step.padEnd(9)} consulted=[${s.consulted.join(", ")}]` +
            (dispatch ? ` dispatched=${s.dispatched.filter((d) => d.recorded).length}/${s.dispatched.length}` : "") +
            `\n`,
        );
      }
    }
    return 0;
  }

  if (cmd === "record-inprocess") {
    // ε-the-agent calls this AFTER dispatching an in-process role via the harness Agent tool,
    // passing the file it wrote the agent's returned envelope to. The record's ok is derived
    // from that file's byte count — record-inprocess CANNOT fabricate liveness.
    const get = (flag) => {
      const i = argv.indexOf(flag);
      return i !== -1 ? argv[i + 1] : null;
    };
    const role = get("--role");
    const step = get("--step");
    const evidenceFile = get("--evidence");
    const elapsedMs = parseInt(get("--elapsed-ms") || "0", 10) || 0;
    if (!role || !step || !evidenceFile) {
      process.stderr.write(
        "usage: epsilon-runtime.js record-inprocess --sprint <id> --role <role> --step <step> --evidence <file> [--elapsed-ms <n>]\n",
      );
      return 2;
    }
    const roles = hookPoints.loadRoles();
    const rr = resolveRoute(role, roles);
    const agentPlan = { role, step, route: rr.route, provider: rr.provider, model: rr.model };
    const out = recordInProcessCompletion(agentPlan, sprintId, { evidenceFile, elapsedMs });
    process.stdout.write(JSON.stringify({ command: "record-inprocess", sprint_id: sprintId, ...agentPlan, ...out }, null, json ? 2 : 0) + "\n");
    return out.recorded ? 0 : 1;
  }

  process.stderr.write(
    "usage: epsilon-runtime.js <plan | conduct | record-inprocess> --sprint <id> [--composition <json>] [--dispatch] [--step <step>] [--role <r> --evidence <file>] [--json]\n",
  );
  return 2;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  LIFECYCLE,
  BETA_BOUNDARIES,
  PARENT_GRACE_MS,
  ROUTE,
  resolveRoute,
  canDispatchBuilders,
  planStep,
  planLifecycle,
  betaBoundaryAfter,
  assertSoleBuilderDispatcher,
  assertConsultsCannotDispatch,
  compositionForSprint,
  recordAgentDispatch,
  recordInProcessCompletion,
  spawnAgent,
  interpretSpawn,
  writeStepPrompt,
  loadRequirementArtifacts,
  conductStep,
  assertNoFailOverride,
};
