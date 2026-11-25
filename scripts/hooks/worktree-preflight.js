#!/usr/bin/env node
// PreToolUse hook (Agent matcher): advisory infrastructure notes before a builder spawn.
//
// A spawn is a builder spawn when its subagent_type is a build-chain role
// (role-registry build_chain:true, plus the legacy builder/fixer ids). For those:
//
// 1. Lists (one line) orphan agent/* branches and unlisted folders under the
//    sibling .worktrees folder. It never removes anything: other lanes and a
//    cleanup agent may be using them; cleanup is a deliberate, separate step.
// 2. Warns if no worktree smoke marker exists this session (never blocks).
// 3. Warns if run_in_background is not set.
//
// Exit code: always 0 (advisory only; fail-open on any error).

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

const MARKER_DIR = path.resolve(__dirname, "..", "..", ".claude", "runtime");
const SMOKE_MARKER = path.join(MARKER_DIR, ".worktree-smoke-passed");

const BUILD_CHAIN_LITERAL = [
  "builder",
  "backend-builder",
  "frontend-builder",
  "security-builder",
  "skeleton-builder",
  "stub-scaffold",
  "fixer",
  "frontend-fixer",
  "backend-fixer",
  "security-fixer",
];

function buildChainRoles() {
  try {
    const rr = require("../dispatch/registry-roles");
    return new Set(
      rr.deriveOrFallback(
        () => [...rr.buildChainRoles(), "builder", "fixer"],
        BUILD_CHAIN_LITERAL,
        "worktree-preflight.buildChainRoles",
      ),
    );
  } catch {
    return new Set(BUILD_CHAIN_LITERAL);
  }
}

function normalize(role) {
  try {
    return require("./lib/role-aliases").normalizeRole(role);
  } catch {
    return role;
  }
}

function isBuilderDispatch(toolInput) {
  const sub = String((toolInput || {}).subagent_type || "").trim().toLowerCase();
  if (!sub) return false;
  const roles = buildChainRoles();
  return roles.has(sub) || roles.has(normalize(sub));
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

// Read-only: what an orphan cleanup would touch. Nothing is pruned or removed here.
function listOrphans(repoRoot) {
  const worktreeList = git(["worktree", "list", "--porcelain"], repoRoot);
  const activeBranches = new Set();
  const activePaths = new Set();
  for (const line of worktreeList.split("\n")) {
    const b = line.match(/^branch refs\/heads\/(agent\/.+)/);
    if (b) activeBranches.add(b[1].trim());
    const w = line.match(/^worktree (.+)/);
    if (w) activePaths.add(path.resolve(w[1].trim()).toLowerCase());
  }
  const branches = git(["branch", "--list", "agent/*", "--format=%(refname:short)"], repoRoot)
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b && !activeBranches.has(b));
  const folders = [];
  const worktreeParent = path.join(path.dirname(repoRoot), ".worktrees");
  if (fs.existsSync(worktreeParent)) {
    for (const dir of fs.readdirSync(worktreeParent)) {
      if (!activePaths.has(path.resolve(worktreeParent, dir).toLowerCase())) folders.push(dir);
    }
  }
  return { branches, folders };
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (!isBuilderDispatch(event.tool_input)) process.exit(0);

    const repoRoot = path.resolve(__dirname, "..", "..");

    const { branches, folders } = listOrphans(repoRoot);
    if (branches.length || folders.length) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] Orphans (not removed): ${branches.length} agent branch(es) without a worktree, ${folders.length} unlisted .worktrees folder(s)${RESET}\n`,
      );
    }

    if (!fs.existsSync(SMOKE_MARKER)) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] WARNING: no worktree smoke marker this session. If this builder fails on worktree setup, check the infra before dispatching more.${RESET}\n`,
      );
    }

    if (!(event.tool_input || {}).run_in_background) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] WARNING: Builder dispatched without run_in_background: true. ` +
          `This blocks the orchestrator until the builder finishes.${RESET}\n`,
      );
    }

    process.stderr.write(`${GREEN}[worktree-preflight] OK: advisory checks done for builder dispatch.${RESET}\n`);
    process.exit(0);
  } catch (e) {
    // Advisory hook: an error here never blocks a spawn.
    process.stderr.write(
      `${YELLOW}[worktree-preflight] could not complete the advisory checks (${e && e.message ? e.message : "unknown error"}).${RESET}\n`,
    );
    process.exit(0);
  }
});

module.exports = { isBuilderDispatch, listOrphans };
