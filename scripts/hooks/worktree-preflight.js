#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const MARKER_DIR = path.resolve(__dirname, "..", "..", ".claude", "runtime");
const SMOKE_MARKER = path.join(MARKER_DIR, ".worktree-smoke-passed");

function git(args, cwd) {
  try {
    return execSync("git " + args, { cwd, stdio: ["pipe", "pipe", "pipe"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function isBuilderDispatch(prompt) {
  if (!/^feature:\s*\S+/m.test(prompt)) return false;
  if (
    /evaluator|security|compliance|fix agent|lead/i.test(
      prompt.substring(0, 500),
    )
  )
    return false;
  return true;
}

function cleanOrphanWorktrees(repoRoot) {
  const cleaned = [];

  git("worktree prune", repoRoot);

  const worktreeList = git("worktree list --porcelain", repoRoot);
  const activeBranches = new Set();
  for (const line of worktreeList.split("\n")) {
    const m = line.match(/^branch refs\/heads\/(agent\/.+)/);
    if (m) activeBranches.add(m[1]);
  }

  const allBranches = git("branch -l", repoRoot)
    .split("\n")
    .map((b) => b.replace(/^\*?\s+/, "").trim())
    .filter((b) => b.startsWith("agent/"));

  for (const branch of allBranches) {
    if (!activeBranches.has(branch)) {
      git(`branch -D "${branch}"`, repoRoot);
      cleaned.push(branch);
    }
  }

  const worktreeParent = path.join(path.dirname(repoRoot), ".worktrees");
  if (fs.existsSync(worktreeParent)) {
    const dirs = fs.readdirSync(worktreeParent);
    for (const dir of dirs) {
      const wtPath = path.join(worktreeParent, dir);
      if (!worktreeList.includes(wtPath.replace(/\\/g, "/"))) {
        try {
          git(`worktree remove "${wtPath}" --force`, repoRoot);
        } catch {
          try {
            fs.rmSync(wtPath, { recursive: true, force: true });
          } catch {
          }
        }
        cleaned.push(dir);
      }
    }
  }

  return cleaned;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const prompt = event.tool_input?.prompt || "";

    if (!isBuilderDispatch(prompt)) process.exit(0);

    const repoRoot = path.resolve(__dirname, "..", "..");

    const cleaned = cleanOrphanWorktrees(repoRoot);
    if (cleaned.length > 0) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] Cleaned ${cleaned.length} orphan(s): ${cleaned.join(", ")}${RESET}\n`,
      );
    }

    try {
      const remainingBranches = git("branch --list agent/*", repoRoot);
      if (remainingBranches) {
        const stale = remainingBranches
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean);
        if (stale.length > 0) {
          process.stderr.write(
            `${YELLOW}[worktree-preflight] WARNING: ${stale.length} stale agent branch(es) remain after cleanup: ${stale.join(", ")}${RESET}\n`,
          );
        }
      }
    } catch {
    }

    if (!fs.existsSync(SMOKE_MARKER)) {
      process.stderr.write(
        `${RED}[worktree-preflight] BLOCKED: No worktree smoke test this session.${RESET}\n` +
          `${YELLOW}Dispatch a no-op agent with isolation: "worktree" first to verify the system works.${RESET}\n` +
          `${YELLOW}After the test passes, create the marker: touch .claude/runtime/.worktree-smoke-passed${RESET}\n`,
      );
      process.exit(2);
    }

    const runInBg = event.tool_input?.run_in_background;
    if (!runInBg) {
      process.stderr.write(
        `${YELLOW}[worktree-preflight] WARNING: Builder dispatched without run_in_background: true. ` +
          `This blocks the Boss until the builder finishes.${RESET}\n`,
      );
    }

    process.stderr.write(
      `${GREEN}[worktree-preflight] OK: infra checks passed for builder dispatch.${RESET}\n`,
    );
    process.exit(0);
  } catch (e) {
    process.stderr.write(
      `${RED}[worktree-preflight] BLOCKED: could not complete the infra preflight (${e && e.message ? e.message : "unknown error"}) — failing closed.${RESET}\n`,
    );
    process.exit(2);
  }
});
