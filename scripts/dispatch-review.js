#!/usr/bin/env node
"use strict";
const mcEnv = require("./hooks/lib/mc-env");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const registryRoles = require("./dispatch/registry-roles");

const AGENT = path.join(__dirname, "dispatch-agent.js");
const CLAUDE = path.join(__dirname, "dispatch-claude.js");
const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..");

const LANE_ID = { claude: "claude", antigravity: "agy", openai: "gpt" };
const securityChoice = require("./dispatch/security-choice");
const CLAUDE_ONLY_LINE = securityChoice.CLAUDE_ONLY_LINE;

function parseFlag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

function laneFileName(passKey) {
  return String(passKey || "pass").replace(/[^A-Za-z0-9._-]/g, "_") + ".txt";
}

function persistLane(laneOutDir, passKey, out, err) {
  if (!laneOutDir) return null;
  try {
    fs.mkdirSync(laneOutDir, { recursive: true });
    const laneOut = path.join(laneOutDir, laneFileName(passKey));
    fs.writeFileSync(laneOut, out == null ? "" : String(out));
    if (err) fs.writeFileSync(laneOut.replace(/\.txt$/, ".stderr.txt"), String(err));
    return laneOut;
  } catch {
    return null;
  }
}

function spawnPass(role, promptFile, pass, domain, laneOutDir) {
  return new Promise((resolve) => {
    let args;
    if (pass.provider === "claude") {
      args = [CLAUDE, role, promptFile];
      if (pass.model) args.push("--model", pass.model);
    } else {
      args = [AGENT, role, promptFile, "--provider", pass.provider];
      if (pass.model) args.push("--model", pass.model);
      if (domain) args.push("--domain", domain);
    }
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => resolve({ pass, result: null, spawnError: e.message }));
    child.on("close", () => {
      const laneOut = persistLane(laneOutDir, pass.key, out, err);
      let result = null;
      const last = out.trim().split("\n").filter(Boolean).pop();
      try {
        result = last ? JSON.parse(last) : null;
      } catch {
      }
      resolve({ pass, result, stderrBytes: Buffer.byteLength(err, "utf8"), laneOut });
    });
  });
}

const VALID_REVIEW_VERDICTS = new Set(["pass", "warn", "fail"]);
function normalizeVerdict(v) {
  const s = String(v || "").toLowerCase();
  return VALID_REVIEW_VERDICTS.has(s) ? s : "error";
}
function verdictOf(result) {
  if (!result) return "error";
  if (result.parsed && typeof result.parsed.verdict === "string") return normalizeVerdict(result.parsed.verdict);
  const text = typeof result.output === "string" ? result.output : "";
  const m = /"verdict"\s*:\s*"(pass|warn|fail)"/i.exec(text);
  if (m) return m[1].toLowerCase();
  return "error";
}

function resolvePassesForDispatch(passes, mode) {
  if (String(mode || "").toLowerCase() !== "primary") return passes;
  const restricted = passes.filter((p) => p.key === "primary");
  return restricted.length ? restricted : passes;
}

const HUNTER_LINE = "Claude hunter lane: not run by this script — the conductor summons it in-process";

function splitInProcess(passes) {
  const notRun = passes.filter((p) => p && p.route === "in-process" && p.provider === "claude");
  return { fire: passes.filter((p) => !notRun.includes(p)), notRun };
}

function notRunGateLane(p) {
  return {
    pass: p.key, provider: p.provider, model: p.model, ok: false, verdict: "error",
    laneId: LANE_ID[p.provider] || p.provider, observedProvider: p.provider, fallback: false, hasEvidence: false, lane_out: null,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const role = argv[0];
  const promptFile = argv[1];
  const domain = parseFlag(argv, "--domain");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const laneOutDir = parseFlag(argv, "--lane-out") || path.join(ROOT, "runtime", "reviews", `${role}-${ts}`);
  if (!role || !promptFile) {
    console.error(
      JSON.stringify({ ok: false, error: "Usage: node scripts/dispatch-review.js <role> <prompt-file> [--domain <d>]" }),
    );
    process.exit(2);
  }
  let passes;
  try {
    passes = registryRoles.passesOf(role);
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: `cannot resolve passes for ${role}: ${e.message}` }));
    process.exit(2);
  }
  if (!passes.length) {
    console.error(JSON.stringify({ ok: false, role, error: `unknown role (no passes in registry)` }));
    process.exit(2);
  }
  const blocked = passes.find((p) => p.blocked);
  if (blocked) {
    console.error(JSON.stringify({ ok: false, role, error: "project_settings_unreadable", detail: blocked.blocked }));
    process.exit(1);
  }
  passes = resolvePassesForDispatch(passes, mcEnv.readEnv("REVIEW_PASSES"));
  const choiceWarnings = passes.filter((p) => p.warning).map((p) => p.warning);
  for (const w of choiceWarnings) console.error(`warning: ${w}`);

  const panelRunId = mcEnv.readEnv("PANEL_RUN_ID") || `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  mcEnv.setEnv("PANEL_RUN_ID", panelRunId);
  const runnerStartMs = Date.now();
  const { fire, notRun } = splitInProcess(passes);
  if (!fire.length) {
    console.error(JSON.stringify({ ok: false, role, error: "no_runnable_pass", detail: "every declared pass is summoned in-process by the conductor; this script has nothing to fire" }));
    process.exit(2);
  }
  for (const p of notRun) console.error(HUNTER_LINE);
  const settled = await Promise.all(fire.map((p) => spawnPass(role, promptFile, p, domain, laneOutDir)));
  const lanes = settled.map((s) => {
    const r = s.result || {};
    const isClaude = s.pass.provider === "claude";
    return {
      pass: s.pass.key,
      provider: s.pass.provider,
      model: s.pass.model,
      ok: !s.spawnError && !!r.ok,
      verdict: verdictOf(s.result),
      laneId: LANE_ID[s.pass.provider] || s.pass.provider,
      observedProvider: isClaude ? "claude" : r.provider || null,
      fallback: isClaude ? false : !!(r.fallback || r.quotaFallbackFrom),
      hasEvidence: !s.spawnError && !!s.result,
      lane_out: s.laneOut ? path.relative(ROOT, s.laneOut) : null,
    };
  });
  let panelLanes = null;
  try {
    panelLanes = require("./dispatch/panel-lanes");
  } catch (e) {
    if (panelLoaderFailClosed(role, e)) {
      console.error(JSON.stringify({ ok: false, role, error: "panel_loader_error", detail: e.message || String(e) }));
      process.exit(1);
    }
    panelLanes = null;
  }
  if (panelLanes) {
    try {
      const observed = lanes.map((l) => ({
        laneId: l.laneId,
        provider: l.provider,
        shape: l.provider === "claude" ? "subprocess-claude" : "subprocess-cross-provider",
      }));
      const tooth = panelLanes.assertCliOnlyPanel(observed);
      if (!tooth.ok) {
        console.error(JSON.stringify({ ok: false, role, error: "panel_cli_only_violation", violations: tooth.violations }));
        process.exit(1);
      }
    } catch (e) {
      console.error(JSON.stringify({ ok: false, role, error: "panel_tooth_error", detail: e.message }));
      process.exit(1);
    }
  }

  const declaredPasses = passes.length;
  let merged = mergeLanes(role, lanes, { declaredPasses });
  merged = await applyClaudeOnlyFallback(role, lanes, merged, {
    sprintId: mcEnv.readEnv("SPRINT_ID") || null,
    sinceMs: runnerStartMs,
    panelRunId,
    declaredPasses,
  });
  if (notRun.length) {
    merged.not_run_lanes = notRun.map((p) => ({ pass: p.key, provider: p.provider, model: p.model, route: p.route, run_by_this_script: false, note: HUNTER_LINE }));
    merged.hunter_note = HUNTER_LINE;
  }
  if (choiceWarnings.length) merged.choice_warnings = choiceWarnings;
  merged.lane_out_dir = path.relative(ROOT, laneOutDir);
  merged.panel_run_id = panelRunId;

  if (panelLanes && isSecurityPanelRole(role) && merged.diversity === securityChoice.CLAUDE_ONLY) {
    let valid = null;
    try {
      valid = panelLanes.validatePanelManifest();
    } catch {
      valid = null;
    }
    if (!valid || !valid.ok) {
      downgradeClaudeOnly(merged, "the panel manifest did not validate");
    } else {
      merged.panel = {
        floor_pass: false,
        manifest_valid: true,
        contract_evaluated: "claude-only-fallback",
        floor: { contract: "claude-only-fallback", status: "CLAUDE-ONLY", reason: CLAUDE_ONLY_LINE },
        binding: { contract: "panel-3lab-binding", status: "NOT-CLAIMED", reason: "a Claude-only review is not a multi-lab sign-off" },
      };
      console.error(CLAUDE_ONLY_LINE);
    }
  } else if (panelLanes && isSecurityPanelRole(role)) {
    const panelGate = applyPanelGate(panelLanes, [...lanes, ...notRun.map(notRunGateLane)], {
      sprintId: mcEnv.readEnv("SPRINT_ID") || null,
      sinceMs: runnerStartMs,
      panelRunId,
      requireSignature: true,
    });
    applyGateOutcome(merged, panelGate);
  }

  console.log(JSON.stringify(merged));
  process.exit(merged.ok ? 0 : 1);
}

function isSecurityPanelRole(role) {
  return role === "security-reviewer";
}

function panelLoaderFailClosed(role, err) {
  const moduleAbsent = err && err.code === "MODULE_NOT_FOUND" && /panel-lanes/.test(String((err && err.message) || ""));
  if (moduleAbsent && !isSecurityPanelRole(role)) return false;
  return true;
}

function defaultReadLedger(sprintId) {
  try {
    return require("./checks/cert-attest").readLedgerRecords(sprintId, null) || [];
  } catch {
    return [];
  }
}

function requireToolIdOf() {
  try {
    return require("./dispatch-agent").providerToolId;
  } catch {
    return (p) => ({ openai: "codex", antigravity: "agy" }[p] ?? p);
  }
}

function panelBlocked(reason) {
  const r = { status: "BLOCKED-INCONCLUSIVE", reason: `panel gate fail-closed: ${reason}` };
  return { floor_pass: false, manifest_valid: false, floor: r, binding: r };
}

function applyPanelGate(panelLanes, lanes, ctx = {}) {
  const { panelStatus, STATUS, loadManifest, validatePanelManifest } = panelLanes;
  let validation;
  try {
    validation = validatePanelManifest();
  } catch (e) {
    return panelBlocked(`manifest validation threw: ${e.message}`);
  }
  if (!validation || !validation.ok) {
    return panelBlocked(`manifest INVALID: ${((validation && validation.errors) || []).join("; ")}`);
  }
  const manifest = loadManifest();

  const sprintId = ctx.sprintId || mcEnv.readEnv("SPRINT_ID") || null;
  const sinceMs = ctx.sinceMs || 0;
  const panelRunId = ctx.panelRunId || mcEnv.readEnv("PANEL_RUN_ID") || null;
  const readLedger = ctx.readLedger || defaultReadLedger;
  const requireSignature = ctx.requireSignature === true;
  const { verifyRecord } = require("./dispatch/attest-signing");
  const records = (readLedger(sprintId) || []).filter((r) => {
    if (panelRunId && r.panel_run_id !== panelRunId) return false;
    if (!sinceMs) return true;
    const t = Date.parse(r.completed_at || "");
    return Number.isFinite(t) && t >= sinceMs;
  });
  const toolIdOf = requireToolIdOf();
  const pv = require("./dispatch/provenance-verifier");
  const buildObserved = (profileName) =>
    lanes.map((l) => {
      if (pv.servedModelUnverifiableFromRecord(l.provider)) {
        return {
          laneId: l.laneId,
          contractedProvider: l.provider,
          observedProvider: l.observedProvider,
          fallback: true,
          alive: false,
          verdict: "error",
          hasEvidence: false,
        };
      }
      const contract = pv.laneContract(profileName, l.observedProvider);
      const rec = records.find((r) => {
        if (!pv.recordMatchesLane(r, contract, l.observedProvider)) return false;
        if (!(r.ok === true && r.fallback === false)) return false;
        if (requireSignature && !verifyRecord(r)) return false;
        if (contract.isHunter) return !!r.output_digest || !!r.evidence_sha;
        return !!r.output_digest && !!r.cmdline_checksum && r.tool_id === toolIdOf(l.observedProvider);
      });
      let verdict = l.verdict;
      if (contract.isHunter) {
        const hv = rec && typeof rec.verdict === "string" ? rec.verdict.toLowerCase() : null;
        verdict = hv === "pass" || hv === "fail" || hv === "warn" ? hv : "error";
      }
      return {
        laneId: l.laneId,
        contractedProvider: l.provider,
        observedProvider: rec ? rec.provider : l.observedProvider,
        fallback: rec ? false : true,
        alive: !!rec,
        verdict,
        hasEvidence: !!rec,
      };
    });
  const floorProfile = { name: "panel-2family", ...manifest.profiles["panel-2family"] };
  const bindingProfile = { name: "panel-3lab", ...manifest.profiles["panel-3lab"] };
  const floor = panelStatus(floorProfile, buildObserved("panel-2family"), { agyOperatorOwned: true });
  const binding = panelStatus(bindingProfile, buildObserved("panel-3lab"), { agyOperatorOwned: true });
  return {
    floor_pass: floor.status === STATUS.PASS,
    manifest_valid: true,
    contract_evaluated: "panel-2family-floor",
    floor: { contract: "panel-2family-floor", claude_channel: "subprocess", status: floor.status, reason: floor.reason, families: floor.families, laneStatus: floor.laneStatus },
    binding: { contract: "panel-3lab-binding", claude_channel: "in-process-hunter", status: binding.status, reason: binding.reason, operator_blocked: binding.operator_blocked || null },
  };
}

function mergeLanes(role, lanes, opts) {
  const anyFail = lanes.some((l) => l.verdict === "fail");
  const anyError = lanes.some((l) => !l.ok || !VALID_REVIEW_VERDICTS.has(String(l.verdict || "").toLowerCase()));
  const multipass = lanes.length > 1 || !!(opts && Number.isInteger(opts.declaredPasses) && opts.declaredPasses > 1);
  const live = lanes.filter((l) => l.ok);
  const liveFamilies = [...new Set(live.map((l) => l.provider))];
  const belowBar = multipass && liveFamilies.length < 2;
  const mergedVerdict = anyFail ? "fail" : anyError || belowBar ? "error" : lanes.some((l) => l.verdict === "warn") ? "warn" : "pass";
  const clean = !anyFail && !anyError && !belowBar;

  const survivingLanes = live.map((l) => ({ pass: l.pass, provider: l.provider, verdict: l.verdict, lane_out: l.lane_out || null }));
  const survivingVerdict = liveFamilies.length === 1 && live.length >= 1 ? live[0].verdict : null;

  const result = {
    ok: clean,
    role,
    multipass,
    passes_run: lanes.length,
    lanes,
    allLanesOk: lanes.every((l) => l.ok),
    mergedVerdict,
    verdict: mergedVerdict,
    live_lanes: live.length,
    live_families: liveFamilies.length,
    below_bar: belowBar,
    surviving_lanes: survivingLanes,
    surviving_verdict: survivingVerdict,
    parsed: { agent: role, verdict: mergedVerdict, lanes },
  };

  if (belowBar && opts && opts.claudeOnly) {
    const ev = securityChoice.evaluateClaudeOnly(lanes, opts.claudeOnly);
    if (ev.accept) {
      result.ok = true;
      result.mergedVerdict = ev.verdict;
      result.verdict = ev.verdict;
      result.diversity = securityChoice.CLAUDE_ONLY;
      result.verdict_text = `${ev.verdict} — ${CLAUDE_ONLY_LINE}`;
      result.parsed = { agent: role, verdict: ev.verdict, diversity: securityChoice.CLAUDE_ONLY, lanes };
    } else {
      result.claude_only_declined = ev.reason;
    }
  }
  return result;
}

async function applyClaudeOnlyFallback(role, lanes, merged, ctx, deps = {}) {
  if (!merged.below_bar || !isSecurityPanelRole(role)) return merged;
  const optIn = deps.optIn || (() => securityChoice.claudeOnlyOptIn());
  if (optIn() !== true) return merged;
  const signedIn = await (deps.checkSignedIn || (() => securityChoice.checkSignedIn()))();
  const verified = (deps.claudeLaneRecordsVerified || claudeLaneRecordsVerified)(lanes, ctx);
  const declared = ctx && Number.isInteger(ctx.declaredPasses) ? ctx.declaredPasses : merged.multipass ? Math.max(lanes.length, 2) : undefined;
  return mergeLanes(role, lanes, { declaredPasses: declared, claudeOnly: { optIn: true, signedIn, claudeLaneVerified: verified === true } });
}

function applyGateOutcome(merged, panelGate) {
  merged.panel = panelGate;
  if (!panelGate.floor_pass) {
    merged.ok = false;
    for (const holder of [merged, merged.parsed]) {
      if (!holder) continue;
      for (const k of holder === merged ? ["verdict", "mergedVerdict"] : ["verdict"]) {
        if (holder[k] === "pass" || holder[k] === "warn") holder[k] = "error";
      }
    }
  }
  return merged;
}

function downgradeClaudeOnly(merged, reason) {
  merged.ok = false;
  merged.verdict = "error";
  merged.mergedVerdict = "error";
  if (merged.parsed) {
    merged.parsed.verdict = "error";
    delete merged.parsed.diversity;
  }
  delete merged.diversity;
  delete merged.verdict_text;
  merged.claude_only_declined = reason;
}

function claudeLaneRecordsVerified(lanes, ctx = {}) {
  try {
    const claudeLanes = lanes.filter((l) => l.provider === "claude");
    if (!claudeLanes.length || !ctx.panelRunId) return false;
    const pv = require("./dispatch/provenance-verifier");
    const { verifyRecord } = require("./dispatch/attest-signing");
    const readLedger = ctx.readLedger || defaultReadLedger;
    const toolIdOf = requireToolIdOf();
    const contract = pv.laneContract("panel-2family", "claude");
    const matching = (readLedger(ctx.sprintId || null) || []).filter((r) => {
      if (!r || r.panel_run_id !== ctx.panelRunId) return false;
      const t = Date.parse(r.completed_at || "");
      if (!Number.isFinite(t) || t < (ctx.sinceMs || 0)) return false;
      if (!pv.recordMatchesLane(r, contract, "claude")) return false;
      if (!(r.ok === true && r.fallback === false)) return false;
      if (!verifyRecord(r)) return false;
      return !!r.output_digest && !!r.cmdline_checksum && r.tool_id === toolIdOf("claude");
    });
    return matching.length >= claudeLanes.length;
  } catch {
    return false;
  }
}

if (require.main === module) main();
module.exports = { verdictOf, mergeLanes, persistLane, laneFileName, isSecurityPanelRole, applyPanelGate, panelLoaderFailClosed, resolvePassesForDispatch, splitInProcess, notRunGateLane, HUNTER_LINE, claudeLaneRecordsVerified, downgradeClaudeOnly, applyGateOutcome, applyClaudeOnlyFallback };
