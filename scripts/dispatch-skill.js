#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  recordCompletion,
  recordDeath,
  makeDispatchId,
  cmdlineChecksum,
  AGENT_ROOT,
  runContext,
  promptDigest,
  outputDigest,
  argvSchemaVersion,
} = require("./dispatch-agent");

const { skillExecution } = require("./dispatch/dispatch-contract");

let safeSpawn = null;
try {
  safeSpawn = require("./dispatch/safe-spawn");
} catch {
  safeSpawn = null;
}

const { foregroundAwareTimeout, WRAPPER_DEFAULTS } = require("./dispatch/timeout-policy");

const SKILL_RE = /^\/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$/;
const SAFE_ARG_RE = /^[A-Za-z0-9_\-./:=@,+]+$/;

const PROVIDER = "claude";
const DEFAULT_TIMEOUT_MS = WRAPPER_DEFAULTS["dispatch-skill"];
const MAX_BUFFER = 64 * 1024 * 1024;
const _maxRetriesRaw = parseInt(process.env.DISPATCH_SKILL_MAX_RETRIES || "2", 10);
const MAX_REAP_RETRIES = Number.isFinite(_maxRetriesRaw) && _maxRetriesRaw >= 0 ? _maxRetriesRaw : 2;

function skillSlug(skill) {
  return skill.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

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

function resolveExecution(skill, opts) {
  const contractKey = String(skill).replace(/^\//, "");
  let resolved;
  try {
    resolved = skillExecution(contractKey);
  } catch {
    resolved = { skill, execution: "inline", verified: false, source: "contract-unreadable" };
  }
  if (resolved.execution === "inline-required") {
    return {
      ok: false,
      execution: resolved.execution,
      verified: resolved.verified,
      reason: `skill '${skill}' is inline-required (needs the LIVE conversation) — it CANNOT be dispatched as a subprocess. Run it inline.`,
    };
  }
  if (resolved.verified && resolved.execution === "subprocess") {
    return { ok: true, execution: "subprocess", verified: true };
  }
  if (opts && opts.forceSubprocess) {
    return {
      ok: true,
      execution: "subprocess",
      verified: false,
      note: `skill '${skill}' is not yet subprocess-verified (source=${resolved.source}) — proceeding under --force-subprocess (this is a smoke run that EARNS verification; do not trust the result until stamped).`,
    };
  }
  return {
    ok: false,
    execution: resolved.execution,
    verified: false,
    reason: `skill '${skill}' is not a verified subprocess candidate (execution=${resolved.execution}, verified=false). Run inline, or pass --force-subprocess to do the smoke run that earns verification.`,
  };
}

const COMMANDS_DIR = path.join(AGENT_ROOT, ".claude", "commands");

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
  const relMd = contractKey.split(":").join(path.sep) + ".md";
  const mdPath = path.join(COMMANDS_DIR, relMd);
  const found = fs.existsSync(mdPath);

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

function buildEnvelope({ skill, ok, reaped, reason, artifactPath, output, elapsedMs }) {
  const lines = [];
  if (!ok) {
    lines.push(`SKILL ${skill}: FAILED (${reason || (reaped ? "reap" : "error")})`);
    if (artifactPath) lines.push(`artifact: ${artifactPath}`);
    return lines.slice(0, 8).join("\n");
  }
  const text = String(output || "");
  const verdictMatch = text.match(/\b(PASS|FAIL|REJECT|GREEN|RED|YELLOW|OK)\b/);
  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : "DONE";
  const findings = (text.match(/\bfindings?\b/gi) || []).length;
  const errs = (text.match(/\berrors?\b/gi) || []).length;
  lines.push(`SKILL ${skill}: ${verdict} (${(elapsedMs / 1000).toFixed(1)}s, ${Buffer.byteLength(text, "utf8")} bytes)`);
  lines.push(`signals: ~${findings} finding-mentions, ~${errs} error-mentions`);
  lines.push(`artifact: ${artifactPath}`);
  lines.push(`(full output in the artifact — open it only if the envelope is insufficient)`);
  return lines.slice(0, 8).join("\n");
}

function dispatchSkill(opts) {
  const stderr = (opts && opts.stderr) || process.stderr;

  const v = validateInputs(opts);
  if (!v.ok) {
    stderr.write(v.msg + "\n");
    return { exitCode: 2, status: "input_invalid", envelope: v.msg };
  }
  const skill = opts.skill;
  const skillArgs = opts.skillArgs || [];

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

  const dispatchId = makeDispatchId();
  const runsDir =
    process.env.DISPATCH_SKILL_RUNS_DIR ||
    path.join(AGENT_ROOT, "runtime", "skill-runs");
  const artifactPath = path.join(runsDir, `${skillSlug(skill)}-${dispatchId}.md`);

  const promptStr = `${skill} ${skillArgs.join(" ")}`.trim();
  const promptBuf = Buffer.from(promptStr, "utf8");
  const promptBytes = promptBuf.length;

  if (opts.dryRun) {
    const envelope = [
      `DRY-RUN ${skill}: would dispatch as subprocess (verified=${exec.verified})`,
      `prompt: ${promptStr.slice(0, 120)}`,
      `artifact (planned): ${artifactPath}`,
    ].join("\n");
    return { exitCode: 0, status: "dry_run", envelope, artifactPath, verified: exec.verified };
  }

  const BIN = process.env.DISPATCH_SKILL_BIN || "claude";
  let prefixArgs = [];
  try {
    prefixArgs = JSON.parse(process.env.DISPATCH_SKILL_BIN_ARGS || "[]");
    if (!Array.isArray(prefixArgs)) prefixArgs = [];
  } catch {
    prefixArgs = [];
  }
  const claudeArgs = [...prefixArgs, "-p", "--agent", "general-purpose"];

  try {
    const { shapeDoor } = require("./dispatch/dispatch-shape");
    const door = shapeDoor("subprocess-skill", { kind: "skill", id: skill }, process.env, { reportOnlyPin: true });
    if (door.mismatch && door.mismatch.mismatch && !door.suppressed) {
      process.stderr.write(
        `[dispatch-skill] shape-resolver advisory (report-only-pinned): skill '${skill}' run as subprocess-skill but the resolver picks '${door.mismatch.expected}' (${door.mismatch.expectedReason || door.mismatch.reason}). Pin lifts once the earn-it loop stamps the heavy-by-design skills.\n`,
      );
    }
  } catch {
  }

  const TIMEOUT_MS = foregroundAwareTimeout(
    parseInt(process.env.DISPATCH_SKILL_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10),
    {},
  );
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: AGENT_ROOT };

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const cmdChecksum = cmdlineChecksum(skill, PROVIDER, promptBytes);

  const usingSeam = !!process.env.DISPATCH_SKILL_BIN;

  let stdoutBuf = Buffer.alloc(0);
  let stderrBuf = Buffer.alloc(0);
  let status = null;
  let signal = null;
  let spawnFailDetail = null;
  let reaped = false;
  let reason = null;

  if (usingSeam) {
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
    if (timedOut && process.platform === "win32" && spawned.pid) {
      try {
        spawnSync("taskkill", ["/T", "/F", "/PID", String(spawned.pid)], { timeout: 5000 });
      } catch {
      }
    }
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
      reason = "skill_zero_byte_reap";
    }
  } else {
    if (!safeSpawn) {
      const msg =
        "dispatch safety kernel (scripts/dispatch/safe-spawn.js) unavailable — refusing the " +
        "legacy shell spawn rather than re-opening the injection surface. Restore the module.";
      stderr.write(msg + "\n");
      return { exitCode: 2, status: "kernel_missing", envelope: `SKILL ${skill}: REFUSED (${msg})` };
    }
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
        recover: true,
      });
      if (
        r.reason === "arg_policy_violation" ||
        r.reason === "tool_resolution_refused" ||
        r.reason === "cmd_exe_unresolved" ||
        r.reason === "missing_out_file"
      ) {
        break;
      }
      if (!r.reaped) break;
    }
    if (attempts > 1) {
      stderr.write(
        `[dispatch-skill] ${skill}: ${attempts} attempt(s) — ${r.recovered ? "RECOVERED from savepoint" : r.reaped ? "still reaped after retries" : "succeeded on re-spawn after a reap"} (reap mitigation).\n`,
      );
    }
    if (!r.reaped) {
      try {
        fs.rmSync(outFile, { force: true });
        fs.rmSync(outFile + ".done", { force: true });
      } catch { }
    }
    stdoutBuf = Buffer.from(r.stdout || "", "utf8");
    stderrBuf = Buffer.from(r.stderr || "", "utf8");
    status = typeof r.exitCode === "number" ? r.exitCode : null;
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

  try {
    fs.mkdirSync(runsDir, { recursive: true });
    const header =
      `<!-- dispatch-skill ${skill} | id=${dispatchId} | ${startedAt} | ok=${ok}` +
      (reason ? ` | reason=${reason}` : "") +
      ` -->\n\n`;
    fs.writeFileSync(artifactPath, header + outputStr, "utf8");
  } catch {
  }

  const completedAt = new Date().toISOString();
  const elapsedMs = Date.now() - startedMs;

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
    argv_schema_version: argvSchemaVersion(),
    cwd: AGENT_ROOT,
    output_digest: outputDigest(stdoutBuf),
    skill,
    subprocess_verified: !!exec.verified,
    artifact: artifactPath,
  });

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
            ? `${skill} produced 0 bytes of stdout (silent reap — the silent-reap signature).`
            : reason === "skill_spawn_failed"
              ? `could not spawn '${BIN}' via the dispatch safety kernel (${spawnFailDetail || "spawn refused"}).`
              : `${skill} exited ${status}.`,
    });
  }

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

function parseArgs(argv) {
  const out = { skill: null, skillArgs: [], dryRun: false, forceSubprocess: false, resolve: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--probe" || a === "--dry-run") out.dryRun = true;
    else if (a === "--force-subprocess") out.forceSubprocess = true;
    else if (a === "--resolve" || a === "--no-ping") out.resolve = true;
    else if (a === "--skill") out.skill = argv[++i] || null;
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

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (opts.resolve) {
    const r = resolveSkill(opts);
    process.stdout.write(JSON.stringify(r) + "\n");
    process.exit(r.found ? 0 : 1);
  }
  const r = dispatchSkill(opts);
  process.stdout.write((r.envelope || "") + "\n");
  process.exit(r.exitCode);
}
