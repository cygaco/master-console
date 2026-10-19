"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const CLAUDE = fs.readFileSync(path.join(__dirname, "..", "dispatch-claude.js"), "utf8");
const AGENTBR = fs.readFileSync(path.join(__dirname, "..", "dispatch-agent.js"), "utf8");

test("Invariant 1 (builder write-root isolation): dispatch-claude refuses a build-chain role without a worktree", () => {
  assert.match(
    CLAUDE,
    /isBuildChainRole\(role\)\s*&&\s*!passW\s*&&\s*!worktreeValid/,
    "the build-chain worktree-isolation gate must be present (a builder never edits canonical)",
  );
});

test("Invariant 2 (canonical telemetry env): the builder child env forces canonical CLAUDE_PROJECT_DIR", () => {
  assert.match(
    CLAUDE,
    /CLAUDE_PROJECT_DIR:\s*AGENT_ROOT/,
    "the child env must force CLAUDE_PROJECT_DIR = AGENT_ROOT (canonical) even in a worktree cwd",
  );
});

test("Invariant 3 (no global neutral-cwd override): the dispatch bridges do NOT process.chdir to a neutral dir", () => {
  assert.ok(!/process\.chdir\s*\(/.test(CLAUDE), "dispatch-claude must not process.chdir (no global cwd override)");
  assert.ok(!/process\.chdir\s*\(/.test(AGENTBR), "dispatch-agent must not process.chdir (codex sandbox-root safety)");
});

test("Invariant 4 (builder cwd = the validated worktree): dispatch-claude runs the builder in its worktree write-root", () => {
  assert.match(CLAUDE, /runCwd\s*=\s*worktreeValid\s*&&\s*worktreeReal\s*\?\s*worktreeReal/, "runCwd must be the validated worktree for a builder");
  assert.match(CLAUDE, /cwd:\s*runCwd/, "the builder spawn must use cwd: runCwd (its isolated worktree write-root)");
});
