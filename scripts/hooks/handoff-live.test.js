#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const mod = require("./handoff-live.js");

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hl-test-"));
  execSync("git init -q", { cwd: dir });
  execSync('git config user.email t@example.com', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  fs.mkdirSync(path.join(dir, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(dir, "seed.txt"), "seed\n");
  execSync("git add seed.txt", { cwd: dir });
  execSync('git commit -q -m seed', { cwd: dir });
  return dir;
}
function runHook(repo, event) {
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = repo;
  try {
    mod._run(JSON.stringify(event));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prev;
  }
}
function liveFile(repo, sid) {
  return path.join(repo, ".claude", "runtime", `handoff-live-${sid}.md`);
}

ok("resolveSid prefers payload session_id", () => {
  assert.strictEqual(mod.resolveSid({ session_id: "abc123" }, os.tmpdir()), "abc123");
});
ok("resolveSid sanitizes unsafe filename chars", () => {
  assert.strictEqual(mod.resolveSid({ session_id: "a/b:c d*e" }, os.tmpdir()), "abcde");
});
ok("resolveSid falls back to env then 'unknown'", () => {
  const prev = process.env.CLAUDE_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "hl-sid-"));
  try {
    assert.strictEqual(mod.resolveSid({}, empty), "unknown");
    process.env.CLAUDE_SESSION_ID = "env-sid";
    assert.strictEqual(mod.resolveSid({}, empty), "env-sid");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_SESSION_ID;
    else process.env.CLAUDE_SESSION_ID = prev;
  }
});

ok("parsePorcelain classifies staged / unstaged / untracked", () => {
  const r = mod.parsePorcelain(["M  staged.js", " M unstaged.js", "MM both.js", "?? new.js"].join("\n"));
  assert.deepStrictEqual(r.staged.sort(), ["both.js", "staged.js"]);
  assert.deepStrictEqual(r.unstaged.sort(), ["both.js", "unstaged.js"]);
  assert.deepStrictEqual(r.untracked, ["new.js"]);
});
ok("parsePorcelain preserves leading dot on the 2-char-prefix variant + leading-dot paths", () => {
  const r = mod.parsePorcelain(["M .claude/staged.md", " M .claude/unstaged.md"].join("\n"));
  assert.deepStrictEqual(r.staged, [".claude/staged.md"]);
  assert.deepStrictEqual(r.unstaged, [".claude/unstaged.md"]);
});
ok("parsePorcelain unwraps rename arrows + quoted paths", () => {
  const r = mod.parsePorcelain(['R  old/a.js -> new/b.js', '?? "with space.md"'].join("\n"));
  assert.deepStrictEqual(r.staged, ["new/b.js"]);
  assert.deepStrictEqual(r.untracked, ["with space.md"]);
});

ok("atomicWrite replaces atomically + leaves no .tmp", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hl-aw-"));
  const f = path.join(d, "out.md");
  mod.atomicWrite(f, "first");
  assert.strictEqual(fs.readFileSync(f, "utf8"), "first");
  mod.atomicWrite(f, "second");
  assert.strictEqual(fs.readFileSync(f, "utf8"), "second");
  const leftovers = fs.readdirSync(d).filter((n) => n.includes(".tmp-"));
  assert.strictEqual(leftovers.length, 0, "no leftover temp files");
});

ok("Stop writes a per-sid live file with git ground truth", () => {
  const repo = mkTempRepo();
  runHook(repo, { session_id: "sidA", hook_event_name: "Stop" });
  const f = liveFile(repo, "sidA");
  assert.ok(fs.existsSync(f), "handoff-live-sidA.md exists");
  const body = fs.readFileSync(f, "utf8");
  assert.ok(/Handoff \(LIVE\) — session `sidA`/.test(body), "header names the sid");
  assert.ok(/## Git ground truth/.test(body), "has git ground truth section");
  assert.ok(/Branch:/.test(body), "captured branch");
});

ok("Stop×N rewrites the same file — latest snapshot wins", () => {
  const repo = mkTempRepo();
  runHook(repo, { session_id: "sidA", hook_event_name: "Stop" });
  const t1 = fs.readFileSync(liveFile(repo, "sidA"), "utf8");
  assert.ok(!/work\.txt/.test(t1), "turn-1 snapshot has no work.txt yet");
  fs.writeFileSync(path.join(repo, "work.txt"), "wip\n");
  runHook(repo, { session_id: "sidA", hook_event_name: "Stop" });
  const t2 = fs.readFileSync(liveFile(repo, "sidA"), "utf8");
  assert.ok(/work\.txt/.test(t2), "turn-2 snapshot includes the new untracked file (latest wins)");
});

ok("two concurrent sids → two files, NO clobber", () => {
  const repo = mkTempRepo();
  runHook(repo, { session_id: "sidA", hook_event_name: "Stop" });
  const aBefore = fs.readFileSync(liveFile(repo, "sidA"), "utf8");
  runHook(repo, { session_id: "sidB", hook_event_name: "Stop" });
  assert.ok(fs.existsSync(liveFile(repo, "sidA")), "sidA file survives");
  assert.ok(fs.existsSync(liveFile(repo, "sidB")), "sidB file created");
  const aAfter = fs.readFileSync(liveFile(repo, "sidA"), "utf8");
  assert.strictEqual(aAfter, aBefore, "sidA not clobbered by sidB write");
  assert.ok(/session `sidB`/.test(fs.readFileSync(liveFile(repo, "sidB"), "utf8")));
});

ok("SessionEnd(clear) writes the bridge file (no sentinel blocks it)", () => {
  const repo = mkTempRepo();
  runHook(repo, { session_id: "sidC", hook_event_name: "SessionEnd", source: "clear" });
  const body = fs.readFileSync(liveFile(repo, "sidC"), "utf8");
  assert.ok(/SessionEnd/.test(body) && /source: clear/.test(body), "records the clear-source write");
});

ok("crash-after-turn: last completed snapshot persists + parseable", () => {
  const repo = mkTempRepo();
  runHook(repo, { session_id: "sidD", hook_event_name: "Stop" });
  const f = liveFile(repo, "sidD");
  assert.ok(fs.existsSync(f), "snapshot from the last completed turn survives a mid-next-turn crash");
  assert.ok(fs.readFileSync(f, "utf8").length > 0, "non-empty");
});

ok("garbled/empty stdin is tolerated (fail-open, never throws)", () => {
  const repo = mkTempRepo();
  runHook(repo, "");
  const written = fs
    .readdirSync(path.join(repo, ".claude", "runtime"))
    .filter((n) => /^handoff-live-.+\.md$/.test(n));
  assert.ok(written.length >= 1, "still writes a fail-open snapshot");
});

console.log(`\nhandoff-live: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
