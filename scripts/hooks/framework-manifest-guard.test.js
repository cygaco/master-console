"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execSync } = require("child_process");

const HOOK = path.join(__dirname, "framework-manifest-guard.js");

function repo({ gateExit } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fmg-"));
  execSync("git init -q", { cwd: dir });
  fs.mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".claude", "framework-manifest.json"), "{}");
  fs.writeFileSync(path.join(dir, "version.json"), '{"version":"0.0.0"}');
  fs.writeFileSync(path.join(dir, "install.ps1"), "# stub");
  if (gateExit !== undefined) {
    fs.mkdirSync(path.join(dir, "scripts", "paths"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "scripts", "paths", "gate.js"),
      `console.log("gate says ${gateExit === 0 ? "green" : "red"}"); process.exit(${gateExit});\n`,
    );
  }
  return dir;
}

function stage(dir, rel, body = "x\n") {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), body);
  execSync(`git add -- "${rel}"`, { cwd: dir });
}

function runHook(dir, command = 'git commit -m "stub"') {
  const r = spawnSync(process.execPath, [HOOK], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, MC_MANIFEST_GUARD: "" },
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
  });
  let decision = null;
  try {
    decision = JSON.parse((r.stdout || "").trim()).decision;
  } catch {
  }
  return { status: r.status, decision, stdout: r.stdout, stderr: r.stderr };
}

test("a commit of manifest-tracked files without the manifest staged is allowed", () => {
  const dir = repo();
  stage(dir, ".claude/agents/new-agent.md");
  stage(dir, "scripts/hooks/new-hook.js");
  const r = runHook(dir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.decision, null, r.stdout);
  assert.doesNotMatch(r.stderr, /regenerate/i);
});

test("staged paths-related files with a red path gate are refused", () => {
  const dir = repo({ gateExit: 1 });
  stage(dir, ".claude/paths.json", "{}\n");
  const r = runHook(dir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.decision, "block");
  assert.match(r.stdout, /path coherence gate failed/);
});

test("staged paths-related files with a green path gate are allowed", () => {
  const dir = repo({ gateExit: 0 });
  stage(dir, ".claude/paths.json", "{}\n");
  const r = runHook(dir);
  assert.strictEqual(r.decision, null, r.stdout);
});

test("a command that is not a commit is ignored", () => {
  const dir = repo({ gateExit: 1 });
  stage(dir, ".claude/paths.json", "{}\n");
  assert.strictEqual(runHook(dir, "git status").decision, null);
});
