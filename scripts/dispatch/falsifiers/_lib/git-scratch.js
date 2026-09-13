"use strict";
const mcEnv = require("../../../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * git-scratch.js — shared scratch-git-repo helper for Seam E (protected-ref-transaction) falsifiers
 * (SP-20260720-002 Phase 4). NOT a falsifier itself — a test utility. Lives under falsifiers/_lib/ so every
 * Seam E fixture can spin up an isolated, throwaway git repo with the REAL hook installed, without ever
 * touching this repository's own `.git/hooks` (mirrors the reftxn probe's scratchpad discipline —
 * runtime/sp002-phase4/reftxn-probe-evidence.md).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const HOOK_SRC = path.join(PROJECT_ROOT, "scripts", "hooks", "protected-ref-transaction.js");

function git(cwd, args, opts = {}) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, ...opts });
}

/** Create a fresh scratch repo (main branch, one seed commit). Returns the absolute dir path. */
function makeScratchRepo(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sp002-reftxn-${tag}-`));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "scratch@example.com"]);
  git(dir, ["config", "user.name", "Scratch"]);
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}

/** Create a bare scratch remote (no working tree) — used to exercise `git push` as a write surface. */
function makeBareRemote(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sp002-reftxn-bare-${tag}-`));
  git(dir, ["init", "-q", "--bare", "-b", "main"]);
  return dir;
}

/** Resolve `dir`'s hooks directory (`.git/hooks` for a normal repo, `hooks/` for a bare one). */
function hooksDirOf(dir) {
  return fs.existsSync(path.join(dir, ".git")) ? path.join(dir, ".git", "hooks") : path.join(dir, "hooks");
}

/**
 * Install the REAL protected-ref-transaction hook into `dir`'s hooks directory. S4 (R2): the wrapper text
 * comes from the ONE in-repo canonical source (`protected-ref-transaction.js#installReferenceTransactionHook`
 * -> `#renderReferenceTransactionHook`), the same definition `trusted-controller.js#verifyActiveHookInstalled`
 * verifies against — so "what the installer writes" and "what the verifier accepts" cannot drift.
 */
function installHook(dir) {
  // eslint-disable-next-line global-require
  const reftxn = require(HOOK_SRC);
  return reftxn.installReferenceTransactionHook(hooksDirOf(dir), HOOK_SRC);
}

/**
 * installNoopHook(dir) -> the hook path. S4 teeth: a name-BEARING NO-OP hook — the plausible MISTAKE case
 * (a mis-generated / truncated / corrupted installer output that keeps the module name as a COMMENT while
 * enforcing nothing). It must NOT satisfy the liveness precondition.
 */
function installNoopHook(dir, body) {
  const hooksTarget = hooksDirOf(dir);
  fs.mkdirSync(hooksTarget, { recursive: true });
  const target = path.join(hooksTarget, "reference-transaction");
  fs.writeFileSync(target, body || "#!/usr/bin/env bash\n# protected-ref-transaction.js\nexit 0\n");
  try {
    fs.chmodSync(target, 0o755);
  } catch {
    /* best-effort on platforms without a meaningful chmod */
  }
  return target;
}

function headSha(dir, ref) {
  const r = git(dir, ["rev-parse", "--verify", ref || "HEAD"]);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Build a fence env (spread over process.env) for a given lease acquisition. */
function fenceEnv(spId, token, leaseRoot, base = process.env) {
  return {
    ...base,
    ...mcEnv.envPair("CONTROLLER_FENCE_TOKEN", String(token)),
    ...mcEnv.envPair("CONTROLLER_FENCE_SPID", spId),
    ...mcEnv.envPair("CONTROLLER_FENCE_LEASE_ROOT", leaseRoot),
  };
}

/** An env guaranteed to carry NO fence vars (strip any that leaked from the parent process). */
function noFenceEnv(base = process.env) {
  const env = { ...base };
  for (const s of ["CONTROLLER_FENCE_TOKEN", "CONTROLLER_FENCE_SPID", "CONTROLLER_FENCE_LEASE_ROOT"]) mcEnv.unsetEnv(s, env);
  return env;
}

function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
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
