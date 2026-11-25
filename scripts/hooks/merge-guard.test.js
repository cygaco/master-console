"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const GUARD = path.join(__dirname, "merge-guard.js");

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "merge-guard-test-"));
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, ".claude", "paths.json"), path.join(dir, ".claude", "paths.json"));
  return dir;
}

function run(command) {
  const dir = project();
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  const out = r.stdout || "";
  return { status: r.status, stdout: out, stderr: r.stderr || "", blocked: /"decision"\s*:\s*"block"/.test(out) };
}

test("node -e with an fs write is not blocked and prints the warning", () => {
  for (const cmd of [
    `node -e "const fs=require('fs'); fs.writeFileSync('out.txt','x')"`,
    `node -e "const fs=require('fs'); fs.appendFileSync('log.jsonl','{}\\n')"`,
    `node -e "fs.mkdirSync('d')"`,
  ]) {
    const r = run(cmd);
    assert.strictEqual(r.status, 0, cmd);
    assert.ok(!r.blocked, `not blocked: ${cmd} -> ${r.stdout}`);
    assert.ok(/WARNING: node -e with fs write/.test(r.stderr), `warning printed: ${cmd} -> ${r.stderr}`);
  }
});

test("read-only node -e gets no warning", () => {
  const r = run(`node -e "console.log(require('fs').readFileSync('a.txt','utf8'))"`);
  assert.ok(!r.blocked);
  assert.ok(!/node -e with fs write/.test(r.stderr), r.stderr);
});

test("a node -e write chained with a blocked command is still blocked by that command's rule", () => {
  const r = run(`node -e "require('fs').writeFileSync('x','y')" && git push -f origin main`);
  assert.ok(r.blocked, r.stdout);
  assert.ok(/force-push/.test(r.stdout), r.stdout);
});

test("the other rules still block", () => {
  for (const [cmd, re] of [
    ["git reset --hard HEAD~1", /git reset --hard blocked/],
    ["git push --force origin main", /force-push blocked/],
    ["git push origin +main", /force-push blocked/],
    ["rm -rf src/app", /rm on src\/ or _docs\/ blocked/],
    ["git branch -D backup-2026", /backup branches are protected/],
  ]) {
    const r = run(cmd);
    assert.ok(r.blocked, `blocked: ${cmd} -> ${r.stdout}`);
    assert.ok(re.test(r.stdout), `${cmd} -> ${r.stdout}`);
  }
});
