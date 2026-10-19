#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function toWinPath(p) {
  if (/^\/[a-zA-Z]\//.test(p)) {
    return p[1].toUpperCase() + ":" + p.substring(2);
  }
  return p;
}

function git(args, cwd) {
  const cmd =
    "git " + args.map((a) => (/[\s"]/.test(a) ? '"' + a + '"' : a)).join(" ");
  return execSync(cmd, { cwd, stdio: ["pipe", "pipe", "pipe"] })
    .toString()
    .trim();
}

function gitSafe(args, cwd) {
  try {
    return git(args, cwd);
  } catch (_) {
    return null;
  }
}

function findRepoRoot(cwd) {
  try {
    const gitCommonDir = git(["rev-parse", "--git-common-dir"], cwd);
    const resolved = path.resolve(cwd, gitCommonDir);
    if (path.basename(resolved) === ".git") {
      return path.dirname(resolved);
    }
    return path.dirname(resolved);
  } catch (_) {
    if (process.env.CLAUDE_PROJECT_DIR) {
      return toWinPath(process.env.CLAUDE_PROJECT_DIR);
    }
    return cwd;
  }
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const rawCwd = toWinPath(event.cwd || "");
    const sessionId = event.session_id || crypto.randomBytes(4).toString("hex");

    if (!rawCwd) {
      process.stderr.write("[worktree-hook] ERROR: missing cwd in event\n");
      process.exit(1);
    }

    const repoRoot = findRepoRoot(rawCwd);

    const suffix =
      sessionId.substring(0, 6) + "-" + Date.now().toString(36).slice(-4);

    const worktreeDir = path.join(
      path.dirname(repoRoot),
      ".worktrees",
      "wt-" + suffix,
    );
    const branchName = "agent/wt-" + suffix;

    process.stderr.write(
      "[worktree-hook] repoRoot=" +
        repoRoot +
        ", worktreeDir=" +
        worktreeDir +
        "\n",
    );

    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

    if (fs.existsSync(worktreeDir)) {
      gitSafe(["worktree", "remove", worktreeDir, "--force"], repoRoot);
      gitSafe(["worktree", "prune"], repoRoot);
      if (fs.existsSync(worktreeDir)) {
        fs.rmSync(worktreeDir, { recursive: true, force: true });
      }
    }

    gitSafe(["branch", "-D", branchName], repoRoot);

    git(["worktree", "add", worktreeDir, "-b", branchName, "HEAD"], repoRoot);

    const srcNodeModules = path.join(repoRoot, "node_modules");
    const dstNodeModules = path.join(worktreeDir, "node_modules");
    if (fs.existsSync(srcNodeModules) && !fs.existsSync(dstNodeModules)) {
      try {
        fs.symlinkSync(srcNodeModules, dstNodeModules, "dir");
        process.stderr.write(
          "[worktree-hook] Symlinked node_modules into worktree\n",
        );
      } catch (linkErr) {
        process.stderr.write(
          "[worktree-hook] WARN: could not symlink node_modules: " +
            linkErr.message +
            "\n",
        );
      }
    }

    process.stderr.write(
      "[worktree-hook] Created worktree at " +
        worktreeDir +
        " from HEAD on branch " +
        branchName +
        "\n",
    );

    process.stdout.write(worktreeDir);
  } catch (err) {
    process.stderr.write("[worktree-hook] ERROR: " + err.message + "\n");
    process.exit(1);
  }
});
