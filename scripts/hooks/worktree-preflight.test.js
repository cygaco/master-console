"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "worktree-preflight.js");
const { isBuilderDispatch } = require(HOOK);
test.after(() => process.stdin.destroy());

function run(hookPath, toolInput) {
  return spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ tool_name: "Agent", tool_input: toolInput }),
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
}

test("a builder spawn is decided by subagent_type, not the prompt text", () => {
  assert.strictEqual(isBuilderDispatch({ subagent_type: "backend-builder", prompt: "security lead review" }), true);
  assert.strictEqual(isBuilderDispatch({ subagent_type: "builder" }), true);
  assert.strictEqual(isBuilderDispatch({ subagent_type: "stub-scaffold" }), true);
  assert.strictEqual(isBuilderDispatch({ subagent_type: "general-purpose", prompt: "feature: x\nbuild it" }), false);
  assert.strictEqual(isBuilderDispatch({ subagent_type: "qa", prompt: "feature: x" }), false);
  assert.strictEqual(isBuilderDispatch({ prompt: "feature: x" }), false);
});

test("a builder spawn is never blocked (missing smoke marker only warns)", () => {
  const r = run(HOOK, { subagent_type: "backend-builder", prompt: "feature: x" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/BLOCKED/.test(r.stderr), r.stderr);
});

test("malformed input fails open", () => {
  const r = spawnSync(process.execPath, [HOOK], { input: "{not json", encoding: "utf8", windowsHide: true, timeout: 30000 });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("orphan agent branches and stray .worktrees folders are listed, never removed", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "wtp-"));
  const repo = path.join(base, "repo");
  fs.mkdirSync(path.join(repo, "scripts", "hooks"), { recursive: true });
  fs.copyFileSync(HOOK, path.join(repo, "scripts", "hooks", "worktree-preflight.js"));
  const git = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("branch", "agent/orphan-one");
  const stray = path.join(base, ".worktrees", "stray-folder");
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(path.join(stray, "keep.txt"), "x\n");

  const r = run(path.join(repo, "scripts", "hooks", "worktree-preflight.js"), { subagent_type: "builder", run_in_background: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/1 agent branch\(es\)/.test(r.stderr) && /1 unlisted \.worktrees folder/.test(r.stderr), r.stderr);
  assert.ok(/not removed/.test(r.stderr), r.stderr);
  assert.ok(git("branch", "--list", "agent/orphan-one").stdout.includes("agent/orphan-one"), "branch kept");
  assert.ok(fs.existsSync(path.join(stray, "keep.txt")), "folder kept");
});
