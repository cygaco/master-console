"use strict";

/**
 * scripts/portfolio/dispatch.js — /portfolio:run (engine; skill renamed) (T-20260521-174).
 *
 * Cross-repo skill dispatch. Resolves <slug> from registry, spawns a fresh
 * `claude -p` subprocess with CLAUDE_PROJECT_DIR set to the target's
 * repo_path, invokes the requested skill, surfaces stdout/stderr back to
 * the MC terminal.
 *
 * Sources of truth:
 *   - Granular story:        requirements/SP-20260521-001/granular-stories.md S-7
 *   - Acceptance criteria:   requirements/SP-20260521-001/acceptance-criteria.md AC-7.1, 7.2
 *   - Copy:                  requirements/SP-20260521-001/copy.md C-12
 *   - Telemetry:             requirements/SP-20260521-001/trace.md TR-10
 *   - Inputs:                requirements/SP-20260521-001/inputs.md IN-3, IN-6
 *
 * HARD NON-GOAL (ticket description + AC-7.2): never retarget the current
 * Claude session. Always a fresh subprocess. The parent MC session's
 * CLAUDE_PROJECT_DIR is never mutated.
 *
 * Beta design-review addendum (IN-7-style metacharacter guard):
 *   Skill name must match ^/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$. Any
 *   character outside [a-z0-9:/_-] in skill or args fails the input gate
 *   with a clear error — no chance to reach a shell-interpreted spawn.
 *   Args are passed via argv array (shell: false). Redteam SCENARIO-6 closed.
 */

const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");

const { findBySlug } = require("./registry");

const SKILL_RE = /^\/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$/;
const SAFE_ARG_RE = /^[A-Za-z0-9_\-./:=@,+]+$/;

// ── arg parsing ────────────────────────────────────────────
function parseArgs(argv) {
  const out = { slug: null, skill: null, skillArgs: [] };
  // dispatch.js <slug> <skill> [args...]
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!out.slug) out.slug = a;
    else if (!out.skill) out.skill = a;
    else out.skillArgs.push(a);
  }
  return out;
}

// ── input gate (metacharacter guard — Beta IN-7-style directive) ─
function validateInputs(opts) {
  if (!opts.slug) return { ok: false, msg: "Usage: dispatch.js <slug> /<namespace>:<skill> [args...]" };
  if (!opts.skill) return { ok: false, msg: "missing skill — usage: dispatch.js <slug> /<namespace>:<skill> [args...]" };
  if (!SKILL_RE.test(opts.skill)) {
    return {
      ok: false,
      msg: `invalid skill name '${opts.skill}'. Must match ^/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$ (e.g. /portfolio:list or /scan:requirements).`,
    };
  }
  for (const arg of opts.skillArgs) {
    if (!SAFE_ARG_RE.test(arg)) {
      return {
        ok: false,
        msg: `skill arg '${arg}' contains characters outside [A-Za-z0-9_\\-./:=@,+]. Refusing — see redteam SCENARIO-6.`,
      };
    }
  }
  return { ok: true };
}

// ── telemetry (TR-10) ──────────────────────────────────────
function argsHash(args) {
  return crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 12);
}

function emitTrace(payload) {
  try {
    const loggerPath = path.resolve(__dirname, "..", "hooks", "lib", "logger.js");
    const { log } = require(loggerPath);
    log("portfolio", payload);
  } catch {
    // fail-open — telemetry never blocks dispatch
  }
}

/**
 * dispatchToSlug — programmatic entry point.
 * @param {object} opts
 * @param {string} opts.slug
 * @param {string} opts.skill
 * @param {string[]} opts.skillArgs
 * @param {boolean} [opts.dryRun]   — probe + decide, never spawn
 * @param {Writable} [opts.stdout]
 * @param {Writable} [opts.stderr]
 * @returns {Promise<{exitCode:number, status:string, terminal:string|null}>}
 */
function dispatchToSlug(opts) {
  return new Promise((resolve) => {
    const stdout = opts.stdout || process.stdout;
    const stderr = opts.stderr || process.stderr;

    const v = validateInputs(opts);
    if (!v.ok) {
      stderr.write(v.msg + "\n");
      return resolve({ exitCode: 2, status: "input_invalid", terminal: null });
    }

    const entry = findBySlug(opts.slug);
    if (!entry) {
      // C-16
      stderr.write(
        `No product registered as '${opts.slug}'. Run /portfolio:list to see registered products, or /portfolio:register ${opts.slug} <path> to add one.\n`,
      );
      return resolve({ exitCode: 1, status: "unknown_slug", terminal: null });
    }
    if (!entry.repo_path) {
      stderr.write(`repo_not_found_on_disk: <missing>\n`);
      return resolve({ exitCode: 1, status: "repo_path_missing", terminal: null });
    }

    // Capture the parent CLAUDE_PROJECT_DIR so we can assert it survives the
    // subprocess return (AC-7.2). This is observational only — we never
    // mutate process.env here.
    const parentCpd = process.env.CLAUDE_PROJECT_DIR;

    // C-12 banner.
    stdout.write(`dispatching ${opts.skill} against ${opts.slug} (${entry.repo_path})...\n`);

    if (opts.dryRun) {
      emitTrace({
        type: "portfolio_dispatch",
        slug: opts.slug,
        skill: opts.skill,
        args_hash: argsHash(opts.skillArgs),
        target_claude_project_dir: entry.repo_path,
        exit_code: 0,
        duration_ms: 0,
        dry_run: true,
      });
      // Sanity: parent env unchanged.
      const parentPostDryRun = process.env.CLAUDE_PROJECT_DIR;
      if (parentPostDryRun !== parentCpd) {
        stderr.write("INTERNAL: parent CLAUDE_PROJECT_DIR mutated during dispatch — refusing\n");
        return resolve({ exitCode: 2, status: "env_mutation_detected", terminal: null });
      }
      return resolve({ exitCode: 0, status: "dry_run", terminal: "claude" });
    }

    // Spawn a fresh claude subprocess with CLAUDE_PROJECT_DIR overridden via
    // env (NOT process.env mutation — env passed only to the child).
    const childEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: entry.repo_path });
    const argv = ["-p", "--agent", "general-purpose", `${opts.skill} ${opts.skillArgs.join(" ")}`.trim()];
    // NOTE: claude -p --agent is the documented allowed dispatch path
    // (paths.agentDispatchGuide). The general-purpose agent reads its prompt
    // and invokes the named skill. Argv-array form keeps redteam SCENARIO-6
    // closed even though skill+args have already been input-gated above.

    const start = Date.now();
    let child;
    try {
      child = spawn("claude", argv, {
        cwd: entry.repo_path,
        env: childEnv,
        stdio: ["ignore", "inherit", "inherit"],
        shell: false,
      });
    } catch (err) {
      stderr.write(`spawn claude failed: ${err.message}\n`);
      emitTrace({
        type: "portfolio_dispatch",
        slug: opts.slug,
        skill: opts.skill,
        args_hash: argsHash(opts.skillArgs),
        target_claude_project_dir: entry.repo_path,
        exit_code: -1,
        duration_ms: Date.now() - start,
        spawn_error: err.code || err.message,
      });
      return resolve({ exitCode: 1, status: "spawn_failed", terminal: "claude" });
    }

    child.on("error", (err) => {
      stderr.write(`spawn claude errored: ${err.message}\n`);
      emitTrace({
        type: "portfolio_dispatch",
        slug: opts.slug,
        skill: opts.skill,
        args_hash: argsHash(opts.skillArgs),
        target_claude_project_dir: entry.repo_path,
        exit_code: -1,
        duration_ms: Date.now() - start,
        spawn_error: err.code || err.message,
      });
      resolve({ exitCode: 1, status: "spawn_errored", terminal: "claude" });
    });

    child.on("close", (code) => {
      const elapsed = Date.now() - start;
      // AC-7.2: assert parent env untouched.
      const parentPost = process.env.CLAUDE_PROJECT_DIR;
      const envMutated = parentPost !== parentCpd;
      if (envMutated) {
        // Mutating process.env from the subprocess is impossible; this is a
        // defensive assertion against any future code path that might leak.
        stderr.write("INTERNAL: parent CLAUDE_PROJECT_DIR mutated during dispatch\n");
      }
      emitTrace({
        type: "portfolio_dispatch",
        slug: opts.slug,
        skill: opts.skill,
        args_hash: argsHash(opts.skillArgs),
        target_claude_project_dir: entry.repo_path,
        exit_code: code,
        duration_ms: elapsed,
        parent_cpd_preserved: !envMutated,
      });
      resolve({
        exitCode: code === null ? 1 : code,
        status: "ok",
        terminal: "claude",
        durationMs: elapsed,
      });
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  const r = await dispatchToSlug(opts);
  process.exit(r.exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write("portfolio:run crashed: " + (err.message || err) + "\n");
    process.exit(2);
  });
}

module.exports = {
  dispatchToSlug,
  parseArgs,
  validateInputs,
  SKILL_RE,
  SAFE_ARG_RE,
};
