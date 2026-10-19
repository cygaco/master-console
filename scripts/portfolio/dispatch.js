"use strict";

const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");

const { findBySlug } = require("./registry");

const SKILL_RE = /^\/[a-z][a-z0-9_-]*(:[a-z][a-z0-9_-]*)?$/;
const SAFE_ARG_RE = /^[A-Za-z0-9_\-./:=@,+]+$/;

function parseArgs(argv) {
  const out = { slug: null, skill: null, skillArgs: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!out.slug) out.slug = a;
    else if (!out.skill) out.skill = a;
    else out.skillArgs.push(a);
  }
  return out;
}

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
        msg: `skill arg '${arg}' contains characters outside [A-Za-z0-9_\\-./:=@,+]. Refusing.`,
      };
    }
  }
  return { ok: true };
}

function argsHash(args) {
  return crypto.createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 12);
}

function emitTrace(payload) {
  try {
    const loggerPath = path.resolve(__dirname, "..", "hooks", "lib", "logger.js");
    const { log } = require(loggerPath);
    log("portfolio", payload);
  } catch {
  }
}

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
      stderr.write(
        `No product registered as '${opts.slug}'. Run /portfolio:list to see registered products, or /portfolio:register ${opts.slug} <path> to add one.\n`,
      );
      return resolve({ exitCode: 1, status: "unknown_slug", terminal: null });
    }
    if (!entry.repo_path) {
      stderr.write(`repo_not_found_on_disk: <missing>\n`);
      return resolve({ exitCode: 1, status: "repo_path_missing", terminal: null });
    }

    const parentCpd = process.env.CLAUDE_PROJECT_DIR;

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
      const parentPostDryRun = process.env.CLAUDE_PROJECT_DIR;
      if (parentPostDryRun !== parentCpd) {
        stderr.write("INTERNAL: parent CLAUDE_PROJECT_DIR mutated during dispatch — refusing\n");
        return resolve({ exitCode: 2, status: "env_mutation_detected", terminal: null });
      }
      return resolve({ exitCode: 0, status: "dry_run", terminal: "claude" });
    }

    const childEnv = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: entry.repo_path });
    const argv = ["-p", "--agent", "general-purpose", `${opts.skill} ${opts.skillArgs.join(" ")}`.trim()];

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
      const parentPost = process.env.CLAUDE_PROJECT_DIR;
      const envMutated = parentPost !== parentCpd;
      if (envMutated) {
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
