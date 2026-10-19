#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SPRINT = require("./paths");
const hookPoints = require("./hook-points");
const hookConsult = require("./hook-consult");
const registryRoles = require("../dispatch/registry-roles");

const { foregroundAwareTimeout, WRAPPER_DEFAULTS } = require("../dispatch/timeout-policy");

const PARENT_GRACE_MS = 45000;

const LIFECYCLE = Object.freeze(["plan", "design", "build", "gauntlet", "release", "retro"]);

const BETA_BOUNDARIES = Object.freeze([
  "plan->design",
  "design->build",
  "gauntlet->release",
  "release->retro",
]);

const ROUTE = Object.freeze({
  DISPATCH_CLAUDE: "dispatch-claude",
  CLAUDE_AGENT: "claude-agent",
  CLAUDE_RAW: "claude-raw",
  AGENT_TOOL: "agent-tool",
  DISPATCH_AGENT: "dispatch-agent",
  UNRESOLVED: "unresolved",
});

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
    route = ROUTE.DISPATCH_CLAUDE;
  } else if (provider === "claude" && claude_pinned) {
    route = ROUTE.AGENT_TOOL;
  } else if (provider === "claude" && kind === "tool") {
    route = ROUTE.CLAUDE_RAW;
  } else if (provider === "claude") {
    route = ROUTE.CLAUDE_AGENT;
  } else {
    route = ROUTE.DISPATCH_AGENT;
  }

  return { role, route, provider, model: r.model || null, residency, build_chain, claude_pinned, kind, resolved: true };
}

function canDispatchBuilders(step, routeInfo) {
  return step === "build" && routeInfo.build_chain === true;
}

function enrichCompositionForGauntlet(composition, decision) {
  if (!decision || !decision.trailer) return composition;
  const surfaces = decision.security && decision.security.hit ? ["security"] : [];
  return {
    ...composition,
    change: decision.trailer.change,
    blast: decision.trailer.blast,
    surfaces: [...new Set([...(composition.surfaces || []), ...surfaces])],
  };
}

function resolveReviewPasses(row, nc) {
  const pw = row && row.passes_when;
  if (!pw || typeof pw !== "object") return null;
  if (!nc.change && !nc.blast) return null;
  const matchesKey = (key) => {
    if (key === "default") return false;
    const i = key.indexOf(":");
    if (i === -1) return false;
    const field = key.slice(0, i);
    const value = key.slice(i + 1).toLowerCase();
    if (field === "change") return nc.change === value;
    if (field === "blast") return nc.blast === value;
    if (field === "risk_surface") return nc.surfaces && nc.surfaces.has(value);
    return false;
  };
  const matchedKeys = Object.keys(pw).filter(matchesKey);
  const list = matchedKeys.length
    ? [...new Set(matchedKeys.flatMap((k) => pw[k]))]
    : pw.default || ["primary"];
  return list.length > 1 ? "all" : "primary";
}

function planStep(step, composition, opts = {}) {
  const registry = opts.registry || hookPoints.load();
  const roles = opts.roles || hookPoints.loadRoles();
  const rows = hookPoints.agentsForStep(step, composition, registry);
  const nc = hookPoints.normalizeComposition(composition);

  const agents = rows.map((row) => {
    const routeInfo = resolveRoute(row.role, roles);
    return {
      role: row.role,
      step,
      mode: row.mode,
      matched_via: row.matched_via || null,
      report_only: row.report_only === true,
      order: row.order,
      route: routeInfo.route,
      provider: routeInfo.provider,
      model: routeInfo.model,
      residency: routeInfo.residency,
      resolved: routeInfo.resolved,
      can_dispatch_builders: canDispatchBuilders(step, routeInfo),
      is_author_consult: step === "design",
      is_builder: routeInfo.build_chain === true,
      is_reviewer: routeInfo.kind === "reviewer",
      package_scope: row.package_scope || null,
      review_passes: resolveReviewPasses(row, nc),
    };
  });

  return {
    step,
    agents,
    block_roles: agents.filter((a) => a.mode === "block" && !a.report_only).map((a) => a.role),
    advisory_roles: agents.filter((a) => a.mode === "advisory").map((a) => a.role),
    report_only_roles: agents.filter((a) => a.report_only).map((a) => a.role),
    builder_roles: agents.filter((a) => a.is_builder).map((a) => a.role),
    reviewer_roles: agents.filter((a) => a.is_reviewer).map((a) => a.role),
    gauntlet_fixed: step === "gauntlet",
    beta_boundary: betaBoundaryAfter(step),
  };
}

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
      return null;
  }
}

function planLifecycle(composition, opts = {}) {
  const registry = opts.registry || hookPoints.load();
  const roles = opts.roles || hookPoints.loadRoles();
  const steps = LIFECYCLE.map((step) => planStep(step, composition, { registry, roles }));
  const nc = hookPoints.normalizeComposition(composition);
  return {
    composition: { unit_types: [...nc.unit_types], max_risk: nc.max_risk, domains: [...nc.domains] },
    steps,
    beta_boundaries: BETA_BOUNDARIES.slice(),
    sole_builder_dispatcher: assertSoleBuilderDispatcher(steps),
    consults_cannot_dispatch: assertConsultsCannotDispatch(steps),
  };
}

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
  }
  return hookPoints.compositionFromTickets(tickets);
}

let _telemetry = null;
function telemetry() {
  if (_telemetry) return _telemetry;
  try {
    const da = require("../dispatch-agent");
    _telemetry = {
      recordCompletion: da.recordCompletion,
      makeDispatchId: da.makeDispatchId,
      cmdlineChecksum: da.cmdlineChecksum,
      AGENT_ROOT: da.AGENT_ROOT,
      runContext: da.runContext,
      ok: true,
    };
  } catch (e) {
    _telemetry = { ok: false, error: e.message };
  }
  return _telemetry;
}

function recordAgentDispatch(
  agentPlan,
  sprintId,
  { ok, promptBytes = 0, evidenceBytes, evidenceSha, elapsedMs = 0, via = "epsilon-runtime", verdict, shape = "in-process-agent" } = {},
) {
  if (typeof ok !== "boolean") {
    return { recorded: false, reason: "refusing to record without a real spawn outcome (ok must be a boolean returned by spawnAgent / derived from real evidence bytes)" };
  }
  const t = telemetry();
  if (!t.ok) return { recorded: false, reason: `telemetry unavailable: ${t.error}` };
  const now = new Date().toISOString();
  const startedAt = elapsedMs > 0 ? new Date(Date.parse(now) - elapsedMs).toISOString() : now;
  const dispatchId = t.makeDispatchId();
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
    shape,
    run_id: mcEnv.readEnv("RUN_ID") || null,
    panel_run_id: mcEnv.readEnv("PANEL_RUN_ID") || null,
    code_sha: (() => { try { return require("../dispatch/git-head").readGitHead(agentRoot()) || null; } catch { return null; } })(),
    phase_id: agentPlan.step,
    sprint_id: sprintId,
    via,
    step: agentPlan.step,
    route: agentPlan.route,
    ...(evidenceSha ? { evidence_sha: evidenceSha } : {}),
    ...(verdict ? { verdict } : {}),
  });
  return { recorded: true, dispatch_id: dispatchId };
}

const { spawnSync: _spawnSync } = require("child_process");

function agentRoot() {
  const t = telemetry();
  return (t.ok && t.AGENT_ROOT) || path.resolve(__dirname, "..", "..");
}

function passesForRole(role) {
  try {
    return require(path.join(agentRoot(), "scripts", "dispatch", "registry-roles")).passesOf(role);
  } catch {
    return [];
  }
}

const REQ_FILES_BY_STEP = Object.freeze({
  design: ["prd.md", "high-level-stories.md", "inputs.md"],
  build: ["prd.md", "granular-stories.md", "acceptance-criteria.md", "inputs.md", "copy.md"],
  gauntlet: ["acceptance-criteria.md", "granular-stories.md", "qa-plan.md", "redteam-plan.md"],
  release: ["acceptance-criteria.md"],
});

function loadRequirementArtifacts(sprintId, step) {
  const reqDir = path.join(agentRoot(), ".claude", "project", "sprint", "requirements", sprintId);
  const wanted = REQ_FILES_BY_STEP[step] || ["prd.md", "acceptance-criteria.md"];
  const chunks = [];
  for (const f of wanted) {
    try {
      const txt = fs.readFileSync(path.join(reqDir, f), "utf8").trim();
      if (txt) chunks.push(`===== ${f} =====\n${txt}`);
    } catch {
    }
  }
  return { reqDir, chunks };
}

function sanitizePromptValue(v) {
  const s = String(v === undefined || v === null ? "" : v);
  const stripped = s.replace(/[\x00-\x1f\x7f`"]/g, "").slice(0, 400);
  return stripped || "<empty>";
}

function reviewScopeBlock(scope) {
  const files = Array.isArray(scope && scope.files) ? scope.files : [];
  return (
    `\n\n--- REVIEW SCOPE (package: ${sanitizePromptValue(scope && scope.package)}) ---\n` +
    (files.length
      ? `Focused + Touchpoint files for this review (one JSON-encoded path per line):\n\`\`\`\n${files.map((f) => JSON.stringify(sanitizePromptValue(f))).join("\n")}\n\`\`\`\n`
      : "No Focused/Touchpoint files were resolved for this review.\n") +
    "Files outside this list are OUT OF SCOPE for this review; if you notice a concern in an " +
    "out-of-scope file, report it as `scope_escape` with the path — do not review it.\n"
  );
}

function writeStepPrompt(agentPlan, sprintId, opts = {}) {
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
    :
      `\n\n[no requirement artifacts at ${path.relative(agentRoot(), reqDir)}/ — dispatching with the step directive ONLY. A real build needs prd.md / granular-stories.md / acceptance-criteria.md authored by the design phase first.]\n`;
  const scope = opts.reviewScope ? reviewScopeBlock(opts.reviewScope) : "";
  fs.writeFileSync(file, header + body + scope);
  return file;
}

function capturedOutputTail(r, max = 4000) {
  const text = `${(r && r.stdout) || ""}${(r && r.stderr) || ""}`;
  return text.length > max ? text.slice(text.length - max) : text;
}

function surfaceStageFailure(stage, f) {
  process.stderr.write(`[epsilon-runtime] gauntlet stage ${stage.stage} (${stage.name}) FAILED${f.failed_cmd ? ` (${f.failed_cmd})` : ""} exit ${f.exit_code}:
${f.output || "(no captured output)"}
`);
}

function interpretSpawn(r, agentPlan, recordedByCli) {
  if (!r || r.error) {
    return { spawned: false, ok: false, recorded: false, route: agentPlan.route, reason: `spawn failed: ${(r && r.error && r.error.message) || "no result"}` };
  }
  const exit = typeof r.status === "number" ? r.status : 1;
  const outBytes = Buffer.byteLength(r.stdout || "");
  const ok = exit === 0 && outBytes > 0;
  return { spawned: true, ok, recorded: recordedByCli, route: agentPlan.route, exit_code: exit, output_bytes: outBytes, reaped: !ok };
}

function spawnAgent(agentPlan, sprintId, opts = {}) {
  const run = opts.run || _spawnSync;
  const root = agentRoot();
  const env = { ...process.env, ...(opts.env || {}) };
  if (!mcEnv.readEnv("RUN_ID", env)) {
    mcEnv.setEnv("RUN_ID", "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex"), env);
  }
  mcEnv.setEnv("PHASE_ID", agentPlan.step, env);
  mcEnv.setEnv("SPRINT_ID", sprintId, env);
  if (agentPlan.review_passes) mcEnv.setEnv("REVIEW_PASSES", agentPlan.review_passes, env);
  if (opts.background === true) mcEnv.setEnv("DISPATCH_BACKGROUND", "1", env);
  const common = {
    encoding: "utf8",
    env,
    maxBuffer: 32 * 1024 * 1024,
  };

  if (agentPlan.route === ROUTE.CLAUDE_AGENT || agentPlan.route === ROUTE.AGENT_TOOL) {
    return { spawned: false, ok: false, recorded: false, route: agentPlan.route, reason: "requires-orchestrator: in-process Claude teammate — dispatched by ε-the-agent / α via the harness Agent tool, not from a node script" };
  }
  if (agentPlan.route === ROUTE.UNRESOLVED) {
    return { spawned: false, ok: false, recorded: false, route: agentPlan.route, reason: "unresolved route (no role-registry row)" };
  }

  const promptFile = opts.promptFile || writeStepPrompt(agentPlan, sprintId);

  if (agentPlan.route === ROUTE.DISPATCH_AGENT) {
    const childBaseMs = foregroundAwareTimeout(opts.timeoutMs || WRAPPER_DEFAULTS["epsilon-agent"], opts);
    env.DISPATCH_BUILDER_TIMEOUT_MS = String(childBaseMs);
    const reviewScript =
      passesForRole(agentPlan.role).length > 1 ? "scripts/dispatch-review.js" : "scripts/dispatch-agent.js";
    const r = run(process.execPath, [path.join(root, reviewScript), agentPlan.role, promptFile], {
      ...common,
      timeout: childBaseMs + PARENT_GRACE_MS,
    });
    return interpretSpawn(r, agentPlan, true);
  }
  if (agentPlan.route === ROUTE.DISPATCH_CLAUDE) {
    const args = [path.join(root, "scripts/dispatch-claude.js"), agentPlan.role, promptFile];
    if (opts.worktree) args.push("--worktree", opts.worktree);
    const childBaseMs = foregroundAwareTimeout(opts.timeoutMs || WRAPPER_DEFAULTS["epsilon-claude"], opts);
    env.DISPATCH_BUILDER_TIMEOUT_MS = String(childBaseMs);
    const r = run(process.execPath, args, {
      ...common,
      timeout: childBaseMs + PARENT_GRACE_MS,
    });
    return interpretSpawn(r, agentPlan, true);
  }
  try {
    const { shapeDoor } = require(path.join(root, "scripts/dispatch/dispatch-shape.js"));
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
  }
  const bin = env.DISPATCH_CLAUDE_BIN || "claude";
  const binArgs = env.DISPATCH_CLAUDE_BIN_ARGS ? JSON.parse(env.DISPATCH_CLAUDE_BIN_ARGS) : [];
  const prompt = fs.readFileSync(promptFile, "utf8");
  const rawBaseMs = foregroundAwareTimeout(opts.timeoutMs || WRAPPER_DEFAULTS["epsilon-claude"], opts);
  const r = run(bin, [...binArgs, "-p", "--agent", agentPlan.role], { ...common, input: prompt, timeout: rawBaseMs + PARENT_GRACE_MS });
  const out = interpretSpawn(r, agentPlan, false);
  if (out.spawned) {
    recordAgentDispatch(agentPlan, sprintId, { ok: out.ok, promptBytes: Buffer.byteLength(prompt), shape: "subprocess-claude" });
    out.recorded = true;
  }
  return out;
}

function recordInProcessCompletion(agentPlan, sprintId, { evidenceFile, elapsedMs = 0 } = {}) {
  if (agentPlan.route !== ROUTE.CLAUDE_AGENT && agentPlan.route !== ROUTE.AGENT_TOOL) {
    return {
      recorded: false,
      reason: `record-inprocess is for in-process routes only (CLAUDE_AGENT / AGENT_TOOL); role '${agentPlan.role}' resolves to route '${agentPlan.route}', a CLI/subprocess role — dispatch it via 'node scripts/dispatch-agent.js ${agentPlan.role} <prompt-file>' (or spawnAgent), which capture real subprocess output. NB: design-lead is the common case here — it is a deliberate cross-provider consult lead, not an in-process teammate, so this refusal is correct.`,
    };
  }
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
  const ok = evidenceBytes > 0;
  let verdict;
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    const v = parsed && typeof parsed.verdict === "string" ? parsed.verdict.toLowerCase() : null;
    if (v === "pass" || v === "fail" || v === "warn") verdict = v;
  } catch {
  }
  const result = recordAgentDispatch(agentPlan, sprintId, {
    ok,
    evidenceBytes,
    evidenceSha,
    elapsedMs,
    via: "epsilon-agent",
    verdict,
  });
  return { ...result, ok, evidence_bytes: evidenceBytes, evidence_sha: evidenceSha };
}

function defaultVerifyGauntlet(args) {
  try {
    const { verifyGauntlet } = require("../dispatch/gauntlet-verify");
    return verifyGauntlet(args);
  } catch (e) {
    return { ok: false, error: `gauntlet-verify unavailable: ${e.message}` };
  }
}

function defaultBaseGateCheck(cmd, base, root) {
  const fs2 = require("fs");
  const os = require("os");
  let tmp = null;
  try {
    tmp = fs2.mkdtempSync(path.join(os.tmpdir(), "mc-base-gate-"));
  } catch {
    return false;
  }
  try {
    const add = _spawnSync("git", ["-C", root, "worktree", "add", "--detach", "-q", tmp, base], { encoding: "utf8" });
    if (!add || typeof add.status !== "number" || add.status !== 0) return false;
    if (!fs2.existsSync(path.join(tmp, cmd))) return false;
    const r = _spawnSync(process.execPath, [path.join(tmp, cmd)], { encoding: "utf8", cwd: tmp });
    const exit = r && typeof r.status === "number" ? r.status : 1;
    return exit !== 0;
  } catch {
    return false;
  } finally {
    try { _spawnSync("git", ["-C", root, "worktree", "remove", "--force", tmp], { encoding: "utf8" }); } catch { }
    try { fs2.rmSync(tmp, { recursive: true, force: true }); } catch { }
  }
}

function conductGauntletStep(composition, sprintId, decision, opts = {}) {
  const enriched = enrichCompositionForGauntlet(composition, decision);
  const plan = planStep("gauntlet", enriched, opts);

  const consulted = hookConsult.emitStepConsults("gauntlet", enriched, sprintId, opts.logFn);
  hookConsult.emitDesignTouch(enriched, sprintId, opts.logFn);

  const stages = (decision.stages || []).slice().sort((a, b) => a.stage - b.stage);
  const agentStages = stages.filter((s) => s.kind === "agents");
  function stageForRole(role) {
    for (const s of agentStages) {
      if ((s.roster || []).some((r) => r.role === role)) return s.stage;
    }
    if (agentStages.length) {
      process.stderr.write(
        `[epsilon-runtime] gauntlet_package_registry_mismatch: registry matched '${role}' but no package stage names it — dispatching at the last agent stage anyway (registry is authoritative); reconcile the matrix / rows.\n`,
      );
      return agentStages[agentStages.length - 1].stage;
    }
    return null;
  }

  const run = opts.run || _spawnSync;
  const root = agentRoot();
  const stageResults = [];
  const dispatched = [];
  let haltedAtStage = null;
  let verifyWindowStart = null;

  for (const stage of stages) {
    if (haltedAtStage !== null) break;

    if (stage.kind === "mechanical") {
      const cmds = Array.isArray(stage.cmds) ? stage.cmds : [];
      let stageOk = true;
      const preExisting = [];
      let failure = null;
      for (const cmd of cmds) {
        const r = run(process.execPath, [path.join(root, cmd)], { encoding: "utf8" });
        const exit = r && typeof r.status === "number" ? r.status : 1;
        if (exit === 0) continue;
        if (stage.stage === 3 && decision && decision.base && decision.head) {
          const baseGateCheck = opts.baseGateCheck || defaultBaseGateCheck;
          if (baseGateCheck(cmd, decision.base, root)) {
            preExisting.push(cmd);
            continue;
          }
        }
        stageOk = false;
        failure = { failed_cmd: cmd, exit_code: exit, output: capturedOutputTail(r) };
        break;
      }
      if (preExisting.length) {
        process.stderr.write(`[epsilon-runtime] gauntlet stage 3: pre-existing red at base ${decision && decision.base} (not gating): ${preExisting.join(", ")}\n`);
      }
      if (failure) surfaceStageFailure(stage, failure);
      stageResults.push({ stage: stage.stage, name: stage.name, ok: stageOk, ...(failure || {}), ...(preExisting.length ? { pre_existing_red: preExisting } : {}) });
      if (!stageOk && stage.stop_on_fail) haltedAtStage = stage.stage;
      continue;
    }

    if (stage.kind === "tests") {
      const isFullSuite = stage.files === "FULL_SUITE";
      const files = isFullSuite ? [] : Array.isArray(stage.files) ? stage.files : [];
      if (!isFullSuite && !files.length) {
        const isSanity = stage.stage === 1;
        stageResults.push({
          stage: stage.stage,
          name: stage.name,
          ok: true,
          skipped: "no files",
          ...(isSanity ? { finding: "focused_tests:0" } : {}),
        });
        continue;
      }
      const args = [path.join(root, "scripts", "checks", "run-tests.js")];
      if (!isFullSuite) args.push("--files", files.join(","));
      const r = run(process.execPath, args, { encoding: "utf8" });
      const exit = r && typeof r.status === "number" ? r.status : 1;
      const stageOk = exit === 0;
      const failure = stageOk ? null : { output: capturedOutputTail(r) };
      if (failure) surfaceStageFailure(stage, { exit_code: exit, ...failure });
      stageResults.push({ stage: stage.stage, name: stage.name, ok: stageOk, exit_code: exit, ...(failure || {}) });
      if (!stageOk && stage.stop_on_fail) haltedAtStage = stage.stage;
      continue;
    }

    if (stage.kind === "agents") {
      if (verifyWindowStart === null) verifyWindowStart = new Date().toISOString();
      const roster = (stage.roster || []).reduce((m, r) => { m[r.role] = r; return m; }, {});
      const toDispatch = plan.agents.filter((a) => stageForRole(a.role) === stage.stage);
      if (opts.dispatch) {
        const spawn = opts.spawn || spawnAgent;
        for (const a of toDispatch) {
          const rosterEntry = roster[a.role];
          if (rosterEntry && Array.isArray(rosterEntry.files) && rosterEntry.files.length === 0) {
            dispatched.push({ role: a.role, route: a.route, spawned: false, ok: false, recorded: false, reason: "empty_review_scope_refused" });
            continue;
          }
          const promptFile = writeStepPrompt(a, sprintId, {
            reviewScope: { package: decision.package, files: rosterEntry ? rosterEntry.files : [] },
          });
          const out = spawn(a, sprintId, { ...opts, promptFile });
          dispatched.push({ role: a.role, route: a.route, spawned: out.spawned, ok: out.ok, recorded: out.recorded, reason: out.reason });
        }
      }
      stageResults.push({ stage: stage.stage, name: stage.name, ok: true, dispatched: toDispatch.length });
      continue;
    }

    stageResults.push({ stage: stage.stage, name: stage.name, ok: false, error: `unknown stage kind '${stage.kind}'` });
    if (stage.stop_on_fail) haltedAtStage = stage.stage;
  }

  let verify = null;
  let haltReason = null;
  if (haltedAtStage === null && verifyWindowStart !== null) {
    if (opts.dispatch && agentStages.length > 0 && dispatched.length === 0) {
      haltReason = "empty_gauntlet";
      verify = { ok: false, halt_reason: haltReason, roles: [], runId: sprintId };
    } else {
      const scheduledRoles = opts.dispatch ? agentStages.flatMap((s) => (s.roster || []).map((r) => r && r.role).filter(Boolean)) : [];
      const verifyRoles = [...new Set([...dispatched.map((d) => d.role), ...scheduledRoles])];
      if (verifyRoles.length) {
        const verifyFn = opts.verifyGauntlet || defaultVerifyGauntlet;
        verify = verifyFn({ runId: sprintId, roles: verifyRoles, since: verifyWindowStart });
      }
    }
  }

  if (opts.dispatch && haltedAtStage === null && haltReason === null) {
    const roleStatus = {};
    for (const r of verify && Array.isArray(verify.roles) ? verify.roles : []) if (r && r.role) roleStatus[r.role] = { satisfied: r.satisfied === true, status: r.status };
    const stageRecs = {};
    for (const sr of stageResults) stageRecs[String(sr.stage)] = sr;
    const inProcess = (s, rec) => (rec && rec.ok === true ? { ok: true, by: "ran in this step (ok)" } : { ok: false, why: rec ? "the stage did not pass in this step" : "the stage did not run in this step" });
    const { gaps } = require("./gauntlet-package").stageRecordGaps(decision, { stages: stageRecs, roles: roleStatus }, { evidence: inProcess });
    if (gaps.length) {
      haltReason = "stage_without_record";
      verify = { ...(verify || { roles: [], runId: sprintId }), ok: false, halt_reason: haltReason, stage_gaps: gaps };
    }
  }

  return {
    step: "gauntlet",
    plan,
    consulted,
    dispatched,
    beta_boundary: plan.beta_boundary,
    package: decision.package,
    stage_results: stageResults,
    halted_at_stage: haltedAtStage,
    halt_reason: haltReason,
    verify,
  };
}

function conductStep(step, composition, sprintId, opts = {}) {
  if (step === "gauntlet" && opts.gauntletDecision) {
    return conductGauntletStep(composition, sprintId, opts.gauntletDecision, opts);
  }

  const plan = planStep(step, composition, opts);

  const consulted = hookConsult.emitStepConsults(step, composition, sprintId, opts.logFn);
  if (step === "build" || step === "gauntlet") {
    hookConsult.emitDesignTouch(composition, sprintId, opts.logFn);
  }

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

function assertNoFailOverride(epsilonResult, reviewerVerdicts = []) {
  let evaluate;
  try {
    ({ evaluate } = require("../checks/adhoc-fail-override"));
  } catch (e) {
    return { ok: false, errors: [`override gate unavailable (fail-closed): ${e.message}`] };
  }
  const out = evaluate({ result: epsilonResult, reviewerVerdicts });
  return { ok: out.result === "PASS", errors: out.errors };
}

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
  enrichCompositionForGauntlet,
  resolveReviewPasses,
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
  reviewScopeBlock,
  sanitizePromptValue,
  writeStepPrompt,
  loadRequirementArtifacts,
  conductStep,
  conductGauntletStep,
  defaultVerifyGauntlet,
  defaultBaseGateCheck,
  assertNoFailOverride,
};
