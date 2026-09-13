#!/usr/bin/env node
"use strict";

/**
 * dispatch-skill.js — "Alpha as god-dispatcher" core (PLAN §13).
 *
 * Runs a HEAVY skill (e.g. /scan:full, /research:deep, /qa:audit) as a bounded
 * subprocess and returns a LEAN ENVELOPE (≤8 lines: verdict + counts + the
 * artifact file path) on stdout — so the orchestrator delegates the skill instead
 * of running it inline and bloating its own context with tens of thousands of
 * tokens of aggregate output (ED-021 / agent-dispatch-guide §9 + §13: the
 * orchestrator holds envelopes, not content).
 *
 * It is the SKILL analog of dispatch-claude.js (which dispatches a build ROLE).
 * Same reap-safety, same canonical telemetry ledger, same N-1 run_id machinery —
 * a phantom "the skill ran" is impossible.
 *
 * What it does:
 *   1. Input-gates the skill name + args (refuses shell metachars) exactly like
 *      scripts/portfolio/dispatch.js (SKILL_RE / SAFE_ARG_RE, argv array, shell:false).
 *   2. Consults dispatch-contract.js#skillExecution — the FAIL-CLOSED reader. An
 *      `inline-required` skill (needs the live conversation) is REFUSED for
 *      subprocess dispatch; an UNVERIFIED `subprocess` candidate is reported (the
 *      reader downgrades it to `inline`, but we still let the operator force it with
 *      --force-subprocess for the §13.6 smoke run that EARNS verification).
 *   3. Spawns `claude -p "/skill args"` (via --agent general-purpose, the documented
 *      dispatch path) BOUNDED by a timeout shorter than the harness auto-background
 *      reap threshold — like dispatch-claude.js — so a long skill returns control in
 *      time to write a durable record instead of being silently reaped (RI-004).
 *   4. Captures the FULL skill output to runtime/skill-runs/<skill>-<id>.md.
 *   5. On ANY reap signal (timeout / spawn-fail / 0-byte / non-zero) → writes a
 *      DEATH record + an ok:false completion record to the canonical ledger and
 *      exits NON-ZERO (the caller's liveness check fires).
 *   6. On success → writes an ok:true BACKED completion record (reusing the N-1
 *      run_id machinery via runContext()) so the coverage gate can prove the skill
 *      actually ran for this run — no sprint theater.
 *   7. Emits a ≤8-line envelope on stdout (verdict, counts, the artifact path).
 *
 * dryRun / --probe: resolve + decide (input-gate, contract-consult, plan the spawn)
 * and return WITHOUT spawning — the §14 dry-run seam.
 *
 * --resolve / --no-ping (the agents:test --no-ping analog, §13.6): given a skill
 * name, LOCATE its .md under .claude/commands/, read its `execution:` class, and
 * return a lean JSON envelope { skill, found, path, execution, subprocess_eligible,
 * run_id } WITHOUT spawning/running the skill. TOKEN-FREE, P5-isolated, zero side
 * effects (no spawn, no ledger record, no artifact). It verifies ROUTABILITY only —
 * not that the skill runs headless — so it is the cheap pre-flight that the
 * skills-test harness uses in `--mode resolve`. It NEVER stamps subprocess_verified.
 *
 * Usage:
 *   node scripts/dispatch-skill.js /<ns>:<skill> [args...]
 *   node scripts/dispatch-skill.js /scan:full --probe
 *   node scripts/dispatch-skill.js --resolve --skill scan:full
 *   node scripts/dispatch-skill.js /research:deep "topic" --force-subprocess
 *
 * Output on stdout: the lean envelope (≤8 lines).
 * Exit codes:
 *   0 — skill ran and produced non-trivial output (envelope on stdout).
 *   1 — REAP (timeout / spawn-fail / 0-byte / non-zero) OR contract refusal.
 *   2 — usage / input-gate failure.
 *
 * Test seam (no real `claude` CLI required, no spend):
 *   DISPATCH_SKILL_BIN        — executable to spawn (default "claude")
 *   DISPATCH_SKILL_BIN_ARGS   — JSON array prepended before the args (e.g. a fake)
 *   DISPATCH_SKILL_TIMEOUT_MS — bound override (default 15 min)
 *   DISPATCH_LEDGER_DIR       — isolate the completion/death ledger (reused from
 *                               dispatch-agent.js — same opt-in test seam)
 *   DISPATCH_SKILL_RUNS_DIR   — override the artifact dir (default runtime/skill-runs)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Reuse the canonical telemetry helpers — the SAME ledger the coverage gate +
// gauntlet-verify read. Single source of the record/path logic (no fork).
const {
  recordCompletion,
  recordDeath,
  makeDispatchId,
  cmdlineChecksum,
  AGENT_ROOT,
  runContext, // N-1 (§17.4) run_id / phase_id / plan_item_id stampers
  promptDigest,
  // §17.4 schema strengthening — the coverage gate now REQUIRES these on a record
  // for it to count (anti-stale/backfill + proof-of-artifact). Same stampers as the
  // other two wrappers so a skill record is uniformly coverage-gradeable.
  outputDigest,
  argvSchemaVersion,
} = require("./dispatch-agent");

// The fail-closed skill-execution reader (PLAN §13). An unverified `subprocess`
// candidate resolves to `inline`; `inline-required` is context-bound.
const { skillExecution } = require("./dispatch/dispatch-contract");

// PLAN §17.2 wire-through: the LAST raw skill spawn routes through the shared
// dispatch SAFETY KERNEL (scripts/dispatch/safe-spawn.js) — `claude` resolved to an
// absolute path so the model never chooses the exe (repo/temp PATH-hijack refused),
// every flag/value allowlisted, stdin UTF-8/BOM/CRLF-normalized, whole-tree kill on
// timeout, and cmd.exe/c for the .cmd shim. Loaded best-effort; the PRODUCTION path
// fails CLOSED if it's missing (refuses the legacy shell spawn rather than
// re-opening the injection surface) — mirrors dispatch-claude.js + providers.js.
let safeSpawn = null;
try {
  safeSpawn = require("./dispatch/safe-spawn");
} catch {
  safeSpawn = null;
}

// T-20260610-304 (G8/N1): foreground-aware timeout clamp. The raw default is 15m but
// the harness FOREGROUND Bash ceiling is 600s — a foreground wrapper is killed by the
// harness BEFORE its own bound fires, so it never writes its death record. The shared
// policy helper clamps to 540s (FOREGROUND_CEILING_MS) unless an explicit background
// signal (MC_DISPATCH_BACKGROUND=1 / opts.background) is present. FAIL-CLOSED:
// absence of the signal ⇒ clamp, never the longer default.
const { foregroundAwareTimeout, WRAPPER_DEFAULTS } = require("./dispatch/timeout-policy");

// ── Input gate (mirrors scripts/portfolio/dispatch.js) ──────
const SKILL_RE = /^\/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$/;
const SAFE_ARG_RE = /^[A-Za-z0-9_\-./:=@,+]+$/;

const PROVIDER = "claude";
const DEFAULT_TIMEOUT_MS = WRAPPER_DEFAULTS["dispatch-skill"]; // 15 min — sourced from canonical policy
const MAX_BUFFER = 64 * 1024 * 1024; // 64 MB — heavy skills emit big aggregates
// RI-004 reap mitigation (ticket T-20260608-269): the production spawn writes the
// child's stdout to a DURABLE FILE (safeSpawnFile) so an outer-harness reap of the
// dispatcher cannot lose a result `claude` already produced, AND retries a reaped
// attempt up to MAX_REAP_RETRIES times — each retry first RECOVERS the prior
// attempt's savepoint (no re-spend) before re-spawning. Override via env.
const _maxRetriesRaw = parseInt(process.env.DISPATCH_SKILL_MAX_RETRIES || "2", 10);
const MAX_REAP_RETRIES = Number.isFinite(_maxRetriesRaw) && _maxRetriesRaw >= 0 ? _maxRetriesRaw : 2;

/** Slug form of a skill name: "/scan:full" -> "scan-full" (filesystem-safe). */
function skillSlug(skill) {
  return skill.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

/**
 * validateInputs({ skill, skillArgs }) -> { ok, msg? }
 * Pure — the planted-metachar test calls this directly.
 */
function validateInputs(opts) {
  if (!opts || !opts.skill) {
    return { ok: false, msg: "Usage: dispatch-skill.js /<namespace>:<skill> [args...]" };
  }
  if (!SKILL_RE.test(opts.skill)) {
    return {
      ok: false,
      msg: `invalid skill name '${opts.skill}'. Must match ${SKILL_RE} (e.g. /scan:full or /research:deep). Refusing — shell-metachar guard.`,
    };
  }
  for (const arg of opts.skillArgs || []) {
    if (!SAFE_ARG_RE.test(arg)) {
      return {
        ok: false,
        msg: `skill arg '${arg}' contains characters outside [A-Za-z0-9_\\-./:=@,+]. Refusing — shell-metachar guard.`,
      };
    }
  }
  return { ok: true };
}

/**
 * resolveExecution(skill, { forceSubprocess }) -> { ok, execution, verified, reason?, note? }
 * Consults the fail-closed contract reader. An `inline-required` skill is REFUSED
 * for subprocess dispatch (it needs the live conversation). An unverified
 * `subprocess` candidate is allowed to proceed ONLY under --force-subprocess (the
 * §13.6 smoke run that earns verification) — otherwise it's reported as not-yet-trusted.
 */
function resolveExecution(skill, opts) {
  // The contract keys skills WITHOUT the leading slash (e.g. "session:handoff").
  // Normalize so the inline-required / verified lookups actually match — a missed
  // key would silently fall through to "inline" and (with --force) let a
  // context-bound skill be subprocessed, defeating the whole fail-closed point.
  const contractKey = String(skill).replace(/^\//, "");
  let resolved;
  try {
    resolved = skillExecution(contractKey); // { skill, execution, verified, source }
  } catch {
    // Contract unreadable → fail-closed: only an explicit --force-subprocess proceeds.
    resolved = { skill, execution: "inline", verified: false, source: "contract-unreadable" };
  }
  if (resolved.execution === "inline-required") {
    return {
      ok: false,
      execution: resolved.execution,
      verified: resolved.verified,
      reason: `skill '${skill}' is inline-required (needs the LIVE conversation) — it CANNOT be dispatched as a subprocess (§13.5). Run it inline.`,
    };
  }
  // `subprocess` (verified) → proceed. Unverified subprocess / inline → only with --force.
  if (resolved.verified && resolved.execution === "subprocess") {
    return { ok: true, execution: "subprocess", verified: true };
  }
  if (opts && opts.forceSubprocess) {
    return {
      ok: true,
      execution: "subprocess",
      verified: false,
      note: `skill '${skill}' is not yet subprocess-verified (source=${resolved.source}) — proceeding under --force-subprocess (this is a §13.6 smoke run that EARNS verification; do not trust the result until stamped).`,
    };
  }
  return {
    ok: false,
    execution: resolved.execution,
    verified: false,
    reason: `skill '${skill}' is not a verified subprocess candidate (execution=${resolved.execution}, verified=false). Run inline, or pass --force-subprocess to do the §13.6 smoke run that earns verification.`,
  };
}

// ── Resolve mode (--resolve / --no-ping; the agents:test --no-ping analog) ──
// Token-free routability pre-flight: locate the skill's .md, read its execution
// class, report subprocess eligibility — WITHOUT spawning. Zero side effects.
const COMMANDS_DIR = path.join(AGENT_ROOT, ".claude", "commands");

/**
 * Read the `execution:` field from a skill .md frontmatter, if declared. Returns
 * the declared string or null. Mirrors skill-weight.js's frontmatter parse.
 */
function readDeclaredExecution(mdPath) {
  let text;
  try {
    text = fs.readFileSync(mdPath, "utf8");
  } catch {
    return null;
  }
  if (!text.startsWith("---")) return null;
  const close = text.indexOf("\n---", 3);
  if (close === -1) return null;
  const block = text.slice(3, close);
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^execution\s*:\s*(.*)$/);
    if (m) {
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v || null;
    }
  }
  return null;
}

/**
 * resolveSkill({ skill }) -> { skill, found, path, execution, subprocess_eligible,
 *   verified_level, run_id }
 *
 * Token-free RESOLVE: locate `<ns>/<name>.md` under .claude/commands/, read its
 * execution class (frontmatter `execution:` if declared, else the fail-closed
 * contract reader's classification), and report whether it is routable as a
 * subprocess. Does NOT spawn, does NOT touch the ledger, does NOT stamp
 * subprocess_verified. `verified_level: "resolve"` is explicit — this proves
 * routability only, NEVER full §13.6 verification.
 *
 * `skill` may be supplied with or without the leading slash.
 */
function resolveSkill(opts) {
  const raw = String((opts && opts.skill) || "").trim();
  const contractKey = raw.replace(/^\//, "");
  const runId = makeDispatchId();
  if (!contractKey || !SKILL_RE.test("/" + contractKey)) {
    return {
      skill: raw,
      found: false,
      path: null,
      execution: null,
      subprocess_eligible: false,
      verified_level: "resolve",
      run_id: runId,
      reason: `invalid skill name '${raw}'`,
    };
  }
  // <ns>:<name> -> .claude/commands/<ns>/<name>.md ; bare <name> -> <name>.md
  const relMd = contractKey.split(":").join(path.sep) + ".md";
  const mdPath = path.join(COMMANDS_DIR, relMd);
  const found = fs.existsSync(mdPath);

  // Execution class: prefer the author's frontmatter `execution:`; else consult the
  // fail-closed contract reader (an unverified subprocess candidate reads as inline).
  let execution = null;
  if (found) execution = readDeclaredExecution(mdPath);
  if (!execution) {
    try {
      const r = skillExecution(contractKey);
      execution = r && r.execution ? r.execution : null;
    } catch {
      execution = null;
    }
  }
  // Eligible = the skill exists AND its class is a subprocess candidate (declared
  // subprocess, OR an inline-classified-but-declared candidate). `inline-required`
  // is NEVER subprocess-eligible (needs the live conversation). A missing skill is
  // never eligible. NOTE: eligibility ≠ verified — that is the harness's ping job.
  const subprocess_eligible = found && execution === "subprocess";
  const result = {
    skill: contractKey,
    found,
    path: found ? path.relative(AGENT_ROOT, mdPath).replace(/\\/g, "/") : null,
    execution,
    subprocess_eligible,
    verified_level: "resolve",
    run_id: runId,
  };
  if (!found) result.reason = `no skill .md at ${relMd} under .claude/commands/`;
  else if (execution === "inline-required") result.reason = "inline-required — needs the live conversation, never subprocess-eligible";
  return result;
}

// ── Envelope (≤8 lines) ─────────────────────────────────────
/**
 * Build a lean envelope from the captured skill output. We do NOT parse the skill's
 * semantics (each skill is different) — we extract a coarse verdict + a couple of
 * counts heuristically and ALWAYS include the artifact path so the orchestrator can
 * open the full output only if it needs to. ≤8 lines, hard-capped.
 */
function buildEnvelope({ skill, ok, reaped, reason, artifactPath, output, elapsedMs }) {
  const lines = [];
  if (!ok) {
    lines.push(`SKILL ${skill}: FAILED (${reason || (reaped ? "reap" : "error")})`);
    if (artifactPath) lines.push(`artifact: ${artifactPath}`);
    return lines.slice(0, 8).join("\n");
  }
  const text = String(output || "");
  // Coarse verdict sniff — PASS/FAIL/REJECT tokens if the skill emitted one.
  const verdictMatch = text.match(/\b(PASS|FAIL|REJECT|GREEN|RED|YELLOW|OK)\b/);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : "DONE";
  // Coarse counts — common aggregate signals. Best-effort, never load-bearing.
  const findings = (text.match(/\bfindings?\b/gi) || []).length;
  const errs = (text.match(/\berrors?\b/gi) || []).length;
  lines.push(`SKILL ${skill}: ${verdict} (${(elapsedMs / 1000).toFixed(1)}s, ${Buffer.byteLength(text, "utf8")} bytes)`);
  lines.push(`signals: ~${findings} finding-mentions, ~${errs} error-mentions`);
  lines.push(`artifact: ${artifactPath}`);
  lines.push(`(full output in the artifact — open it only if the envelope is insufficient)`);
  return lines.slice(0, 8).join("\n");
}

/**
 * dispatchSkill(opts) -> { exitCode, status, envelope, artifactPath?, reaped?, reason? }
 * Programmatic entry point. opts: { skill, skillArgs, dryRun, forceSubprocess,
 *   stdout?, stderr? }. Always resolves (never throws) — failures map to an exitCode.
 */
function dispatchSkill(opts) {
  const stderr = (opts && opts.stderr) || process.stderr;

  // 1. Input gate.
  const v = validateInputs(opts);
  if (!v.ok) {
    stderr.write(v.msg + "\n");
    return { exitCode: 2, status: "input_invalid", envelope: v.msg };
  }
  const skill = opts.skill;
  const skillArgs = opts.skillArgs || [];

  // 2. Contract consult (fail-closed).
  const exec = resolveExecution(skill, opts);
  if (!exec.ok) {
    stderr.write(exec.reason + "\n");
    return {
      exitCode: 1,
      status: "contract_refused",
      reason: exec.reason,
      envelope: `SKILL ${skill}: REFUSED (${exec.reason})`,
    };
  }
  if (exec.note) stderr.write("[dispatch-skill] " + exec.note + "\n");

  // Artifact path — runtime/skill-runs/<skill>-<id>.md (walk-skipped runtime/, NOT
  // .claude/runtime — per the per-run-artifacts discipline).
  const dispatchId = makeDispatchId();
  const runsDir =
    process.env.DISPATCH_SKILL_RUNS_DIR ||
    path.join(AGENT_ROOT, "runtime", "skill-runs");
  const artifactPath = path.join(runsDir, `${skillSlug(skill)}-${dispatchId}.md`);

  // The prompt is the slash-command invocation. argv-array form keeps the shell out
  // of it even though skill+args were already input-gated above.
  const promptStr = `${skill} ${skillArgs.join(" ")}`.trim();
  const promptBuf = Buffer.from(promptStr, "utf8");
  const promptBytes = promptBuf.length;

  // 3/dryRun. The §14 dry-run seam: resolve + decide, never spawn.
  if (opts.dryRun) {
    const envelope = [
      `DRY-RUN ${skill}: would dispatch as subprocess (verified=${exec.verified})`,
      `prompt: ${promptStr.slice(0, 120)}`,
      `artifact (planned): ${artifactPath}`,
    ].join("\n");
    return { exitCode: 0, status: "dry_run", envelope, artifactPath, verified: exec.verified };
  }

  // 4. Bound + spawn.
  const BIN = process.env.DISPATCH_SKILL_BIN || "claude";
  let prefixArgs = [];
  try {
    prefixArgs = JSON.parse(process.env.DISPATCH_SKILL_BIN_ARGS || "[]");
    if (!Array.isArray(prefixArgs)) prefixArgs = [];
  } catch {
    prefixArgs = [];
  }
  // `claude -p --agent general-purpose` — the documented dispatch path (a fresh
  // agent reads its prompt from STDIN and invokes the named skill). The prompt is
  // delivered via stdin (promptBuf), NOT as a positional arg: the safety kernel's
  // `claude` arg-policy refuses positionals (the model must never inject a free arg),
  // mirroring dispatch-claude.js which also passes its prompt only on stdin.
  const claudeArgs = [...prefixArgs, "-p", "--agent", "general-purpose"];

  // ── Shape-resolver self-detection (W2-core; subprocess-skill shape = ED-057) ──
  // dispatch-skill spawns `claude -p --agent general-purpose` (real transport) to run a
  // skill — its OWN shape is `subprocess-skill` (ED-057 added this to the resolver SHAPES
  // set + resolveSkill now returns it for an EARNED subprocess skill, distinct from a
  // build-chain `subprocess-claude`). So a VERIFIED skill run here MATCHES the resolver
  // (clean); an UNEARNED skill resolves to `inline` (proven:false) → a high-severity
  // advisory here. The wrapper stays report-only-PINNED: lifting the pin (so an enforce
  // gate REFUSES an unearned skill-subprocess) is gated on the §13.6/§13.7 earn-it loop
  // stamping the heavy-by-design skills (scan:full/research:deep/…) — until they're
  // stamped, an enforce gate would false-refuse them. Pin beats MC_SHAPE_DOOR; the
  // advisory always surfaces. The record (below) already stamps shape:"subprocess-skill".
  //
  // D10 (SP-20260718-003) — BURN-IN GATE, verified 2026-07-18: the heavy skills are STILL
  // unstamped (scan:full / research:deep / qa:audit resolve inline/proven:false), so the flip
  // reportOnlyPin→enforceDefault stays DEFERRED — flipping now would false-refuse them (proven by
  // dispatch-skill-shape-flip.test.js: scan:full → REFUSE under enforce). The enforce machinery +
  // no-widen + FIX-A3 are already correct (same test, 10/10); the ONLY remaining precondition is the
  // stamping burn-in (real §13.6 smoke run + §13.7 pay/good measurement per heavy skill), which is
  // out of a routing/security sprint's scope (research:deep stamping crosses the >$5 API-approval
  // line). Flip ONE line below (reportOnlyPin:true → enforceDefault:true) once the heavy skills are
  // stamped subprocess_verified. Tracked residual: ED-057 earn-it tail / ED-224 (D10 flip-gate).
  try {
    const { shapeDoor } = require("./dispatch/dispatch-shape");
    const door = shapeDoor("subprocess-skill", { kind: "skill", id: skill }, process.env, { reportOnlyPin: true });
    if (door.mismatch && door.mismatch.mismatch && !door.suppressed) {
      process.stderr.write(
        `[dispatch-skill] shape-resolver advisory (report-only-pinned): skill '${skill}' run as subprocess-skill but the resolver picks '${door.mismatch.expected}' (${door.mismatch.expectedReason || door.mismatch.reason}). Pin lifts once the §13.6/§13.7 earn-it loop stamps the heavy-by-design skills — see ED-057 (shape) + Wave-D earn-it.\n`,
      );
    }
  } catch {
    /* fail-open — the resolver consult never crashes a working dispatch */
  }

  // T-20260610-304: clamp requested bound to foreground ceiling (540s). An env override
  // sets the *requested* bound but the foreground ceiling is the hard cap. Background
  // signal (MC_DISPATCH_BACKGROUND=1) passes through the full requested bound.
  const TIMEOUT_MS = foregroundAwareTimeout(
    parseInt(process.env.DISPATCH_SKILL_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10),
    {}, // opts — MC_DISPATCH_BACKGROUND env var is checked inside the helper
  );
  // Pass canonical CLAUDE_PROJECT_DIR so any nested telemetry resolves to canonical
  // (ED-016 class), not a cwd-bent path.
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: AGENT_ROOT };

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const cmdChecksum = cmdlineChecksum(skill, PROVIDER, promptBytes);

  // ── Spawn: production → the safety kernel; test-seam → direct ─
  // PRODUCTION (no DISPATCH_SKILL_BIN): route through safeSpawnSync — claude resolved
  // to an abs path (repo/temp PATH-hijack refused), every flag/value allowlisted,
  // stdin UTF-8/BOM/CRLF-normalized, whole process tree killed on timeout, cmd.exe/c
  // for the .cmd shim. Fail CLOSED if the kernel is missing. (PLAN §17.2 / §16.3.)
  // TEST SEAM (DISPATCH_SKILL_BIN set): a direct spawn of the injected fake node bin,
  // so dispatch-skill.test.js reproduces the reap fixtures deterministically without
  // the real CLI. Mirrors the providers.js / dispatch-claude.js seam exactly — the
  // kernel's own spawn/resolve/arg behavior is covered by safe-spawn.test.js.
  const usingSeam = !!process.env.DISPATCH_SKILL_BIN;

  let stdoutBuf = Buffer.alloc(0);
  let stderrBuf = Buffer.alloc(0);
  let status = null; // exit code; null when killed by signal / refused pre-spawn
  let signal = null;
  let spawnFailDetail = null; // arg-policy / resolution refusal detail for the death hint
  let reaped = false;
  let reason = null;

  if (usingSeam) {
    // The test seam sets DISPATCH_SKILL_BIN to a real node executable → spawn it
    // directly, shell:false (no .cmd shim to invoke; mirrors dispatch-claude.js's seam).
    const spawned = spawnSync(BIN, claudeArgs, {
      input: promptBuf,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      cwd: AGENT_ROOT,
      env: childEnv,
      encoding: "buffer",
      shell: false,
      windowsHide: true,
    });
    stdoutBuf = spawned.stdout || Buffer.alloc(0);
    stderrBuf = spawned.stderr || Buffer.alloc(0);
    status = spawned.status;
    signal = spawned.signal;
    const errCode = spawned.error && spawned.error.code ? spawned.error.code : null;
    const timedOut = errCode === "ETIMEDOUT" || signal === "SIGTERM" || signal === "SIGKILL";
    const spawnFailed = errCode === "ENOENT" || errCode === "EACCES" || errCode === "EPERM";
    // Best-effort tree-kill on the seam (the production path's kernel does this for real).
    if (timedOut && process.platform === "win32" && spawned.pid) {
      try {
        spawnSync("taskkill", ["/T", "/F", "/PID", String(spawned.pid)], { timeout: 5000 });
      } catch {
        /* best effort */
      }
    }
    // Classification order (same as dispatch-claude.js): timeout → spawn-fail →
    // non-zero → empty/whitespace stdout (the ED-018 silent-reap signature).
    const trimmedLen = stdoutBuf.toString("utf8").trim().length;
    if (timedOut) {
      reaped = true;
      reason = "skill_timeout_reap";
    } else if (spawnFailed) {
      reaped = true;
      reason = "skill_spawn_failed";
      spawnFailDetail = errCode;
    } else if (typeof status === "number" && status !== 0) {
      reaped = true;
      reason = "skill_nonzero_exit";
    } else if (trimmedLen === 0) {
      reaped = true;
      reason = "skill_zero_byte_reap"; // exit 0 but no real output → silent reap
    }
  } else {
    // Production — fail CLOSED if the kernel can't be loaded (refuse the legacy spawn).
    if (!safeSpawn) {
      const msg =
        "dispatch safety kernel (scripts/dispatch/safe-spawn.js) unavailable — refusing the " +
        "legacy shell spawn rather than re-opening the injection surface. Restore the module.";
      stderr.write(msg + "\n");
      return { exitCode: 2, status: "kernel_missing", envelope: `SKILL ${skill}: REFUSED (${msg})` };
    }
    // RI-004 reap fix: write the child's stdout to a DURABLE FILE (the .out
    // savepoint) so an outer-harness reap of THIS dispatcher cannot lose a result
    // `claude` already produced, and RETRY a reaped attempt — each retry first
    // RECOVERS the prior attempt's savepoint before re-spending. The savepoint path
    // is STABLE across this call's retries (keyed off dispatchId) so recovery works.
    const outFile = artifactPath + ".out";
    let r = null;
    let attempts = 0;
    for (let attempt = 0; attempt <= MAX_REAP_RETRIES; attempt++) {
      attempts = attempt + 1;
      r = safeSpawn.safeSpawnFile("claude", claudeArgs, {
        input: promptBuf,
        timeoutMs: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        cwd: AGENT_ROOT,
        env: childEnv,
        outFile,
        recover: true, // a prior attempt that finished cleanly is recovered, not re-run
      });
      // A pre-spawn refusal (arg-policy / resolution) is fatal — NEVER retry it.
      if (
        r.reason === "arg_policy_violation" ||
        r.reason === "tool_resolution_refused" ||
        r.reason === "cmd_exe_unresolved" ||
        r.reason === "missing_out_file"
      ) {
        break;
      }
      if (!r.reaped) break; // success (fresh or recovered) — stop retrying
      // reaped → loop and retry (the savepoint recovery on the next pass returns the
      // real bytes if the reaped attempt had actually finished writing the file).
    }
    if (attempts > 1) {
      stderr.write(
        `[dispatch-skill] ${skill}: ${attempts} attempt(s) — ${r.recovered ? "RECOVERED from savepoint" : r.reaped ? "still reaped after retries" : "succeeded on re-spawn after a reap"} (RI-004 mitigation).\n`,
      );
    }
    // Clean up the savepoint sidecars on a definitive outcome (the .md artifact below
    // is the durable record). Best-effort.
    if (!r.reaped) {
      try {
        fs.rmSync(outFile, { force: true });
        fs.rmSync(outFile + ".done", { force: true });
      } catch { /* best effort */ }
    }
    // The kernel already resolved + arg-checked + spawned + tree-killed + classified.
    // It suppresses stdout to "" on a reap, so a reaped run records 0 stdout bytes.
    stdoutBuf = Buffer.from(r.stdout || "", "utf8");
    stderrBuf = Buffer.from(r.stderr || "", "utf8");
    status = typeof r.exitCode === "number" ? r.exitCode : null;
    // Translate the kernel's classification → the skill_* reason vocabulary the death
    // record + envelope expect. A PRE-spawn refusal (disallowed arg / hijacked exe /
    // unresolved cmd.exe) is a LOUD spawn failure, never a silent pass — fail-closed,
    // with the kernel's detail carried into the hint.
    if (
      r.reason === "arg_policy_violation" ||
      r.reason === "tool_resolution_refused" ||
      r.reason === "cmd_exe_unresolved" ||
      r.reason === "missing_out_file"
    ) {
      reaped = true;
      reason = "skill_spawn_failed";
      spawnFailDetail = r.violations ? `arg-policy: ${r.violations.join("; ")}` : r.detail || r.reason;
    } else if (r.reaped) {
      reaped = true;
      reason =
        r.reason === "timeout_reap"
          ? "skill_timeout_reap"
          : r.reason === "spawn_failed"
            ? "skill_spawn_failed"
            : r.reason === "zero_byte_reap"
              ? "skill_zero_byte_reap"
              : "skill_nonzero_exit";
      if (reason === "skill_spawn_failed") spawnFailDetail = r.detail || r.reason;
    }
  }

  const stdoutBytes = stdoutBuf.length;
  const stderrBytes = stderrBuf.length;
  const outputStr = stdoutBuf.toString("utf8");
  const ok = !reaped;

  // 4 (cont). Capture the FULL output to the artifact — ALWAYS (even on reap, so a
  // post-mortem has whatever bytes did come back). Best-effort; never blocks.
  try {
    fs.mkdirSync(runsDir, { recursive: true });
    const header =
      `<!-- dispatch-skill ${skill} | id=${dispatchId} | ${startedAt} | ok=${ok}` +
      (reason ? ` | reason=${reason}` : "") +
      ` -->\n\n`;
    fs.writeFileSync(artifactPath, header + outputStr, "utf8");
  } catch {
    /* artifact write is best-effort — the ledger record is the durable proof */
  }

  const completedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startedMs;

  // 6. ALWAYS write a completion record — a real run is greenable (ok:true, BACKED
  // via dispatch_id + cmdline_checksum, the coverage-gate#isBackedRecord shape); a
  // reap is ok:false. N-1 run-context (...runContext()) lets the coverage gate prove
  // this skill ran for THIS run (no sprint theater).
  recordCompletion({
    dispatch_id: dispatchId,
    pid: process.pid,
    role: `skill:${skillSlug(skill)}`,
    provider: PROVIDER,
    model: null,
    started_at: startedAt,
    completed_at: completedAt,
    elapsed_ms: elapsedMs,
    prompt_bytes: promptBytes,
    cmdline_checksum: cmdChecksum,
    exit_code: typeof status === "number" ? status : null,
    stdout_bytes: stdoutBytes,
    stderr_bytes: stderrBytes,
    fallback: false,
    ok,
    ...runContext(),
    prompt_digest: promptDigest(promptBuf),
    shape: "subprocess-skill",
    tool_id: "claude",
    // §17.4 strengthening: schema version + cwd + output_digest (proof the skill
    // produced output) so this record SATISFIES the strengthened coverage gate.
    // output_digest alone is the proof-of-artifact; a named-artifact on-disk check
    // (the file carries a header, so its digest ≠ output_digest) is left to a future
    // step that hashes the written file, not faked here.
    argv_schema_version: argvSchemaVersion(),
    cwd: AGENT_ROOT,
    output_digest: outputDigest(stdoutBuf),
    skill,
    subprocess_verified: !!exec.verified,
    artifact: artifactPath,
  });

  // On a reap, write the durable DEATH record (mirrors dispatch-claude.js).
  if (reaped) {
    recordDeath({
      dispatch_id: dispatchId,
      timestamp: completedAt,
      pid: process.pid,
      role: `skill:${skillSlug(skill)}`,
      provider: PROVIDER,
      model: null,
      prompt_bytes: promptBytes,
      cmdline_checksum: cmdChecksum,
      exit_code: typeof status === "number" ? status : null,
      signal: signal || null,
      stdout_bytes: stdoutBytes,
      stderr_bytes: stderrBytes,
      timeout_ms: TIMEOUT_MS,
      reason,
      skill,
      hint:
        reason === "skill_timeout_reap"
          ? `${skill} exceeded ${TIMEOUT_MS}ms bound and was killed (likely harness reap / hang).`
          : reason === "skill_zero_byte_reap"
            ? `${skill} produced 0 bytes of stdout (silent reap — the ED-018 signature).`
            : reason === "skill_spawn_failed"
              ? `could not spawn '${BIN}' via the dispatch safety kernel (${spawnFailDetail || "spawn refused"}).`
              : `${skill} exited ${status}.`,
    });
  }

  // 7. The lean envelope.
  const envelope = buildEnvelope({
    skill,
    ok,
    reaped,
    reason,
    artifactPath,
    output: outputStr,
    elapsedMs,
  });

  return {
    exitCode: ok ? 0 : 1,
    status: ok ? "ok" : "reaped",
    reaped,
    reason: reason || undefined,
    envelope,
    artifactPath,
    elapsedMs,
  };
}

// ── arg parsing ─────────────────────────────────────────────
function parseArgs(argv) {
  const out = { skill: null, skillArgs: [], dryRun: false, forceSubprocess: false, resolve: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--probe" || a === "--dry-run") out.dryRun = true;
    else if (a === "--force-subprocess") out.forceSubprocess = true;
    else if (a === "--resolve" || a === "--no-ping") out.resolve = true;
    else if (a === "--skill") out.skill = argv[++i] || null; // explicit --skill <name>
    else if (!out.skill) out.skill = a;
    else out.skillArgs.push(a);
  }
  return out;
}

module.exports = {
  dispatchSkill,
  resolveSkill,
  readDeclaredExecution,
  parseArgs,
  validateInputs,
  resolveExecution,
  buildEnvelope,
  skillSlug,
  SKILL_RE,
  SAFE_ARG_RE,
};

// ── CLI ─────────────────────────────────────────────────────
if (require.main === module) {
  const opts = parseArgs(process.argv);
  // --resolve / --no-ping: token-free routability pre-flight, lean JSON, NO spawn.
  if (opts.resolve) {
    const r = resolveSkill(opts);
    process.stdout.write(JSON.stringify(r) + "\n");
    // exit 0 if the skill resolved to a routable .md; 1 if not found (fail-closed).
    process.exit(r.found ? 0 : 1);
  }
  const r = dispatchSkill(opts);
  // The envelope is the product — lean stdout the orchestrator holds.
  process.stdout.write((r.envelope || "") + "\n");
  process.exit(r.exitCode);
}
