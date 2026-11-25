"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
process.env.CLAUDE_PROJECT_DIR = ROOT;
const GUARD = path.join(__dirname, "dispatch-route-guard.js");
const { findForbidden } = require(GUARD);
test.after(() => process.stdin.destroy());
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), "drg-scope-"));
const RAW = 'claude -p --agent builder "$(cat p.txt)"';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "drg-home-"));
fs.mkdirSync(path.join(HOME, ".claude"), { recursive: true });
fs.mkdirSync(path.join(HOME, "scripts"), { recursive: true });
fs.copyFileSync(path.join(ROOT, ".claude", "paths.json"), path.join(HOME, ".claude", "paths.json"));

function hook(command, cwd) {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: HOME,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: HOME },
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  return { status: r.status, blocked: /"decision"\s*:\s*"block"/.test(r.stdout || ""), out: r.stdout };
}

test("a raw build-role dispatch inside the repo is still refused", () => {
  const r = hook(RAW, HOME);
  assert.strictEqual(r.status, 0);
  assert.ok(r.blocked, r.out);
  assert.ok(hook("claude -p 'one-shot prompt'", path.join(HOME, "scripts")).blocked);
  assert.ok(findForbidden(RAW, ROOT));
});

test("the same command run in a temp dir outside the repo is allowed", () => {
  const r = hook(RAW, OUTSIDE);
  assert.strictEqual(r.status, 0);
  assert.ok(!r.blocked, r.out);
  assert.ok(!hook("claude -p 'one-shot prompt'", OUTSIDE).blocked);
});

test("a cd to a dir outside the repo scopes the command out", () => {
  assert.ok(!hook(`cd "${OUTSIDE}" && ${RAW}`, HOME).blocked);
  assert.strictEqual(findForbidden(`cd '${OUTSIDE}'; claude -p x`, ROOT), null);
});

test("a cd back into the repo, or to an unknowable target, is judged", () => {
  assert.ok(findForbidden(`cd "${ROOT}" && ${RAW}`, OUTSIDE));
  assert.ok(findForbidden(`cd "$TARGET" && ${RAW}`, OUTSIDE));
  assert.ok(findForbidden(`cd scripts && ${RAW}`, ROOT));
});

test("a subshell cd does not move the outer directory", () => {
  assert.ok(findForbidden(`( cd "${OUTSIDE}" && true ); ${RAW}`, ROOT));
  assert.ok(findForbidden(`(cd "${OUTSIDE}"); ${RAW}`, ROOT));
  assert.strictEqual(findForbidden(`(cd "${OUTSIDE}" && ${RAW})`, ROOT), null);
  assert.strictEqual(findForbidden(`( cd "${ROOT}" && true ); ${RAW}`, OUTSIDE), null);
});

test("directory changes the guard cannot follow are judged as if in home", () => {
  for (const form of [
    `pushd "${OUTSIDE}"; popd; ${RAW}`,
    `cd "${OUTSIDE}"; popd; ${RAW}`,
    `cd "${OUTSIDE}" && cd - && ${RAW}`,
    `cd "${OUTSIDE}" && cd && ${RAW}`,
    `cd "${OUTSIDE}" && cd -- "${OUTSIDE}" && ${RAW}`,
    `cd "${OUTSIDE}" && builtin cd "${OUTSIDE}" && ${RAW}`,
    `cd "${OUTSIDE}" && cd "${OUTSIDE}" > /dev/null && ${RAW}`,
  ]) {
    assert.ok(findForbidden(form, OUTSIDE), `judged: ${form}`);
  }
  assert.strictEqual(findForbidden(`pushd "${OUTSIDE}" && ${RAW}`, ROOT), null);
});

test("a tool flag that sets the working dir to home is judged", () => {
  for (const form of [
    `codex exec -C "${ROOT}" "do it"`,
    `codex exec --cd "${ROOT}" "do it"`,
    `codex exec --cd="${ROOT}" "do it"`,
    `env -C "${ROOT}" codex exec "do it"`,
    `env --chdir="${ROOT}" codex exec "do it"`,
    `${RAW} --add-dir "${ROOT}"`,
  ]) {
    assert.ok(findForbidden(form, OUTSIDE), `judged: ${form}`);
  }
  assert.strictEqual(findForbidden(`env -C "${OUTSIDE}" codex exec "do it"`, OUTSIDE), null);
  assert.strictEqual(findForbidden(`${RAW} --add-dir "${OUTSIDE}"`, OUTSIDE), null);
  assert.ok(!hook(`codex exec -C "${OUTSIDE}" "do it"`, OUTSIDE).blocked);
  assert.ok(hook(`codex exec -C "${HOME}" "do it"`, OUTSIDE).blocked);
});

test("a worktree of the home repo outside its folder is still judged", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "drg-repo-"));
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "drg-wt-")), "wt");
  const git = (...a) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: home, encoding: "utf8" });
  git("init", "-q");
  fs.writeFileSync(path.join(home, "a.txt"), "a\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "init");
  assert.strictEqual(git("worktree", "add", "-q", wt).status, 0);
  const prev = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = home;
  try {
    assert.ok(findForbidden(RAW, wt), "out-of-folder worktree judged");
    assert.strictEqual(findForbidden(RAW, OUTSIDE), null);
  } finally {
    process.env.CLAUDE_PROJECT_DIR = prev;
  }
});

test("without a cwd the matcher judges every command (its original contract)", () => {
  assert.ok(findForbidden(RAW));
  assert.ok(findForbidden(`cd "${OUTSIDE}" && ${RAW}`));
});
