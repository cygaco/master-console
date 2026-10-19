#!/usr/bin/env node

"use strict";
const mcEnv = require("./lib/mc-env");

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DETECT_GIT_COMMIT = /\bgit(\s+-[A-Za-z][^\s]*)*\s+commit\b/;

const FRAMEWORK_PREFIXES = [
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
  ".claude/framework-manifest.json",
  ".claude/paths.json",
  "scripts/",
  "schemas/",
  "framework/",
  "migrations/",
  "patterns/",
  "fixtures/",
  "install.ps1",
  "AGENTS.md",
  "CLAUDE.md",
  "PROJECT.md",
  "_requirements/",
  "_docs/",
];

const EXCLUDE_PREFIXES = [
  ".claude/runtime/",
  ".claude/project/events/",
  ".claude/project/memory/",
  ".claude/project/maps/",
  ".claude/project/builds/",
  ".claude/project/sprint/",
  ".claude/agents/.system/dispatch-backups/",
  ".claude/agents/president/_system/oneshot/retros/",
  ".claude/agents/president/_system/beta/events.jsonl",
  "framework/releases/",
];

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    run(JSON.parse(input || "{}"));
  } catch (e) {
    failClosed(
      resolveProject(),
      `could not parse the tool-call payload (${e && e.message ? e.message : "unknown error"})`,
    );
  }
});

function failClosed(project, reason) {
  let effectiveMode = "warn";
  try {
    effectiveMode = computeEffectiveMode(loadPolicy(project));
  } catch {
    effectiveMode = "warn";
  }
  process.stderr.write(
    `[version-bump-guard] WARNING: ${reason} — cannot verify whether a version bump is required; failing closed per policy (mode=${effectiveMode}).\n` +
      `  Bypass (logged): MC_VERSION_GUARD=off, or touch .mc/version-bump-guard-disable\n`,
  );
  if (effectiveMode === "block") return process.exit(2);
  return process.exit(0);
}

function run(event) {
  if (!event || event.tool_name !== "Bash") return process.exit(0);

  const command = (event.tool_input && event.tool_input.command) || "";
  if (!command) return process.exit(0);
  if (!DETECT_GIT_COMMIT.test(command)) return process.exit(0);

  if (mcEnv.readEnv("VERSION_GUARD") === "off") {
    process.stderr.write(
      "[version-bump-guard] bypass: MC_VERSION_GUARD=off (logged)\n",
    );
    return process.exit(0);
  }

  const project = resolveProject();
  if (!project) return process.exit(0);

  if (fs.existsSync(require("./lib/mc-dirs").resolveProjectPath(project, ".mc/version-bump-guard-disable"))) {
    process.stderr.write(
      "[version-bump-guard] bypass: sentinel .mc/version-bump-guard-disable present (logged)\n",
    );
    return process.exit(0);
  }

  let version;
  try {
    const vj = JSON.parse(
      fs.readFileSync(path.join(project, "version.json"), "utf8"),
    );
    version = vj.version;
  } catch (e) {
    return failClosed(
      project,
      `could not read/parse version.json (${e && e.message ? e.message : "unknown error"})`,
    );
  }
  if (!version || typeof version !== "string") return process.exit(0);

  const capsuleDir = path.join(project, "framework", "releases", version);
  let capsuleExists = false;
  try {
    capsuleExists = fs.statSync(capsuleDir).isDirectory();
  } catch {
    capsuleExists = false;
  }
  if (!capsuleExists) {
    return process.exit(0);
  }

  let stagedRaw;
  try {
    stagedRaw = execSync("git diff --cached --name-only", {
      cwd: project,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
  } catch (e) {
    return failClosed(
      project,
      `could not run "git diff --cached --name-only" (${e && e.message ? e.message : "unknown error"})`,
    );
  }
  const staged = stagedRaw.split(/\r?\n/).filter(Boolean);
  if (staged.length === 0) return process.exit(0);

  const framework = staged.filter(
    (p) => matchesPrefix(p, FRAMEWORK_PREFIXES) && !matchesPrefix(p, EXCLUDE_PREFIXES),
  );
  if (framework.length === 0) return process.exit(0);

  const policy = loadPolicy(project);
  const effectiveMode = computeEffectiveMode(policy);

  const sample = framework.slice(0, 5);
  const more = framework.length > sample.length ? ` (+${framework.length - sample.length} more)` : "";
  const msg =
    `[version-bump-guard] framework files staged against version ${version}, ` +
    `but framework/releases/${version}/ already exists (capsule already minted). ` +
    `Bump version.json before committing framework changes — otherwise downstream ` +
    `consumers running /mc:update --to ${version} will get a stale capsule.\n` +
    `  Staged framework files: ${sample.join(", ")}${more}\n` +
    `  Bypass (logged): MC_VERSION_GUARD=off, or touch .mc/version-bump-guard-disable\n` +
    `  Or run: /mc:release --version patch --apply (bumps + mints capsule).\n`;

  process.stderr.write(msg);

  if (effectiveMode === "block") {
    return process.exit(2);
  }
  return process.exit(0);
}

function matchesPrefix(p, prefixes) {
  const norm = p.replace(/\\/g, "/");
  return prefixes.some((pref) =>
    pref.endsWith("/") ? norm.startsWith(pref) : norm === pref,
  );
}

function resolveProject() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const paths = require("./lib/paths");
    return paths.PROJECT;
  } catch {
    return process.cwd();
  }
}

function policyDir(project) {
  try {
    const paths = require("./lib/paths");
    if (paths.PATHS && paths.PATHS.policy) return path.join(project, path.relative(paths.PROJECT, paths.PATHS.policy));
  } catch {
  }
  return path.join(project, ".claude", "agents", "president", "_system", "policy");
}

function loadPolicy(project) {
  const policyFile = path.join(policyDir(project), "version-bump-guard.json");
  if (!fs.existsSync(policyFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(policyFile, "utf8"));
  } catch {
    return null;
  }
}

function computeEffectiveMode(policy) {
  const declared = (policy && policy.enforcement && policy.enforcement.mode) || "warn";
  const softUntil = policy && policy.enforcement && policy.enforcement.soft_rollout_until;
  if (declared === "block" && softUntil) {
    const t = Date.parse(softUntil);
    if (!Number.isNaN(t) && Date.now() < t) return "warn";
  }
  return declared === "block" ? "block" : "warn";
}
