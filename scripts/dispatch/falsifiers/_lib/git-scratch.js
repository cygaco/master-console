"use strict";
const mcEnv = require("../../../hooks/lib/mc-env");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const HOOK_SRC = path.join(PROJECT_ROOT, "scripts", "hooks", "protected-ref-transaction.js");

function git(cwd, args, opts = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, ...opts });
}

function makeScratchRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mc-reftxn-${tag}-`));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "scratch@example.com"]);
  git(dir, ["config", "user.name", "Scratch"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}

function makeBareRemote(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mc-reftxn-bare-${tag}-`));
  git(dir, ["init", "-q", "--bare", "-b", "main"]);
  return dir;
}

function hooksDirOf(dir) {
  return fs.existsSync(path.join(dir, ".git")) ? path.join(dir, ".git", "hooks") : path.join(dir, "hooks");
}

function installHook(dir) {
  // eslint-disable-next-line global-require
  const reftxn = require(HOOK_SRC);
  return reftxn.installReferenceTransactionHook(hooksDirOf(dir), HOOK_SRC);
}

function installNoopHook(dir, body) {
  const hooksTarget = hooksDirOf(dir);
  fs.mkdirSync(hooksTarget, { recursive: true });
  const target = path.join(hooksTarget, "reference-transaction");
  fs.writeFileSync(target, body || "#!/usr/bin/env bash\n# protected-ref-transaction.js\nexit 0\n");
  try {
    fs.chmodSync(target, 0o755);
  } catch {
  }
  return target;
}

function headSha(dir, ref) {
  const r = git(dir, ["rev-parse", "--verify", ref || "HEAD"]);
  return r.status === 0 ? r.stdout.trim() : null;
}

function fenceEnv(spId, token, leaseRoot, base = process.env) {
  return {
    ...base,
    ...mcEnv.envPair("CONTROLLER_FENCE_TOKEN", String(token)),
    ...mcEnv.envPair("CONTROLLER_FENCE_SPID", spId),
    ...mcEnv.envPair("CONTROLLER_FENCE_LEASE_ROOT", leaseRoot),
  };
}

function noFenceEnv(base = process.env) {
  const env = { ...base };
  for (const s of ["CONTROLLER_FENCE_TOKEN", "CONTROLLER_FENCE_SPID", "CONTROLLER_FENCE_LEASE_ROOT"]) mcEnv.unsetEnv(s, env);
  return env;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}

module.exports = {
  PROJECT_ROOT,
  HOOK_SRC,
  git,
  makeScratchRepo,
  makeBareRemote,
  installHook,
  installNoopHook,
  hooksDirOf,
  headSha,
  fenceEnv,
  noFenceEnv,
  rmrf,
};
