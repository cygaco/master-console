#!/usr/bin/env node
"use strict";

const FALSIFIER_ID = "INSTALL-GIT-HOOKS-COMMIT-MSG";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REAL_ROOT = path.resolve(__dirname, "..", "..");

function cleanEnv(extra) {
  const env = { ...process.env, ...(extra || {}) };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return env;
}

function installHooks(dir) {
  const r = spawnSync("bash", [path.join(REAL_ROOT, "scripts", "install-git-hooks.sh")], { cwd: dir, env: cleanEnv(), encoding: "utf8" });
  assert.strictEqual(r.status, 0, `install-git-hooks.sh failed: ${r.stdout}\n${r.stderr}`);
}

function fakeNodeDir(code) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakenode-"));
  const bin = path.join(dir, "node");
  fs.writeFileSync(bin, `#!/usr/bin/env bash\nexit ${code}\n`);
  fs.chmodSync(bin, 0o755);
  return dir;
}

function runHook(dir, fakeDir) {
  const msgFile = path.join(dir, "msg.txt");
  fs.writeFileSync(msgFile, "some commit message\n");
  fs.mkdirSync(path.join(dir, "scripts", "checks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "checks", "change-trailer.js"), "// placeholder\n");
  const hook = path.join(dir, ".git", "hooks", "commit-msg");
  return spawnSync("bash", [hook, msgFile], {
    cwd: dir,
    env: cleanEnv({ PATH: `${fakeDir}${path.delimiter}${process.env.PATH}` }),
    encoding: "utf8",
  });
}

test(`${FALSIFIER_ID}: a validator CRASH (exit 2, not the deliberate exit-3 block) now BLOCKS the commit — fail closed`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmhook-crash-"));
  const fake = fakeNodeDir(2);
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv() });
    installHooks(dir);
    const r = runHook(dir, fake);
    assert.notStrictEqual(r.status, 0, `expected the hook to fail CLOSED on a validator crash; got exit ${r.status}: ${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(fake, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} regression guard: a genuinely PASSING validator (exit 0) still allows the commit`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmhook-ok-"));
  const fake = fakeNodeDir(0);
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv() });
    installHooks(dir);
    const r = runHook(dir, fake);
    assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(fake, { recursive: true, force: true, maxRetries: 3 });
  }
});

test(`${FALSIFIER_ID} regression guard: the deliberate block (exit 3) still blocks the commit`, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmhook-block-"));
  const fake = fakeNodeDir(3);
  try {
    spawnSync("git", ["init", "-q"], { cwd: dir, env: cleanEnv() });
    installHooks(dir);
    const r = runHook(dir, fake);
    assert.notStrictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(fake, { recursive: true, force: true, maxRetries: 3 });
  }
});
