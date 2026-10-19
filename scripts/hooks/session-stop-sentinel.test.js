#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const HOOK = path.join(__dirname, "session-stop.js");

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

function mkTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-test-"));
  execSync("git init -q", { cwd: dir });
  execSync("git config user.email t@example.com", { cwd: dir });
  execSync("git config user.name t", { cwd: dir });
  fs.mkdirSync(path.join(dir, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  execSync("git add seed.txt", { cwd: dir });
  execSync("git commit -q -m seed", { cwd: dir });
  fs.writeFileSync(
    path.join(dir, ".claude", ".session-start-commit"),
    execSync("git rev-parse HEAD", { cwd: dir }).toString().trim(),
  );
  return dir;
}
function handoffPath(repo) {
  return path.join(repo, ".claude", "runtime", "handoff.md");
}
function runHook(repo, event) {
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: "utf8",
    timeout: 30000,
  });
  return { status: r.status, stderr: r.stderr || "" };
}

ok("Stop → rich handoff NOT written (Layer-1 covers it)", () => {
  const repo = mkTempRepo();
  const { status } = runHook(repo, { hook_event_name: "Stop", session_id: "s1" });
  assert.strictEqual(status, 0, "exits 0");
  assert.ok(!fs.existsSync(handoffPath(repo)), "no rich handoff.md on a plain Stop");
});

ok("StopFailure → rich handoff NOT written", () => {
  const repo = mkTempRepo();
  runHook(repo, { hook_event_name: "StopFailure", session_id: "s1" });
  assert.ok(!fs.existsSync(handoffPath(repo)), "no rich handoff.md on StopFailure");
});

ok("SessionEnd → rich handoff WRITTEN", () => {
  const repo = mkTempRepo();
  const { status } = runHook(repo, { hook_event_name: "SessionEnd", session_id: "s1" });
  assert.strictEqual(status, 0, "exits 0");
  assert.ok(fs.existsSync(handoffPath(repo)), "handoff.md written at SessionEnd");
  assert.ok(/# Handoff/.test(fs.readFileSync(handoffPath(repo), "utf8")), "looks like a handoff");
});

ok("SessionEnd(source:clear) → rich handoff WRITTEN (the /clear bridge, not blocked)", () => {
  const repo = mkTempRepo();
  runHook(repo, { hook_event_name: "SessionEnd", source: "clear", session_id: "s1" });
  assert.ok(fs.existsSync(handoffPath(repo)), "the /clear SessionEnd must write");
});

ok("manual invocation (no hook_event_name) → rich handoff WRITTEN", () => {
  const repo = mkTempRepo();
  runHook(repo, { session_id: "s1" });
  assert.ok(fs.existsSync(handoffPath(repo)), "a manual /session:handoff-style run writes");
});

ok("NO-FREEZE: Stop×3 then SessionEnd → handoff.md appears ONLY after SessionEnd", () => {
  const repo = mkTempRepo();
  for (let i = 0; i < 3; i++) {
    runHook(repo, { hook_event_name: "Stop", session_id: "s1" });
    assert.ok(!fs.existsSync(handoffPath(repo)), `no handoff.md after Stop #${i + 1} (no freeze, no first-write)`);
  }
  runHook(repo, { hook_event_name: "SessionEnd", session_id: "s1" });
  assert.ok(fs.existsSync(handoffPath(repo)), "SessionEnd captures FINAL state");
});

ok("preserve-marked handoff.md is NOT overwritten on SessionEnd", () => {
  const repo = mkTempRepo();
  const marked = "<!-- preserve: crafted -->\n# My crafted handoff\nkeep me\n";
  fs.writeFileSync(handoffPath(repo), marked);
  runHook(repo, { hook_event_name: "SessionEnd", session_id: "s1" });
  assert.strictEqual(fs.readFileSync(handoffPath(repo), "utf8"), marked, "preserve marker keeps the crafted handoff intact");
});

console.log(`\nsession-stop-sentinel: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
