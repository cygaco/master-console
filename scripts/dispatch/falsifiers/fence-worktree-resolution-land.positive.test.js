"use strict";
const mcEnv = require("../../hooks/lib/mc-env");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const INSTALLER = path.join(PROJECT_ROOT, "scripts", "install-git-hooks.sh");
const lease = require(path.join(PROJECT_ROOT, "scripts", "dispatch", "conductor-lease.js"));

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function resolveBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [];
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true }).trim();
    const root = path.resolve(execPath, "..", "..", "..");
    candidates.push(path.join(root, "bin", "bash.exe"), path.join(root, "usr", "bin", "bash.exe"));
  } catch { }
  candidates.push("C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe");
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return "bash";
}
const BASH = resolveBash();
function extractShim() {
  const src = fs.readFileSync(INSTALLER, "utf8");
  const blocks = [...src.matchAll(/<<'HOOK'\n([\s\S]*?)\nHOOK/g)].map((m) => m[1]);
  const shim = blocks.find((b) => b.includes("protected-ref-transaction.js") && b.includes("touches_protected"));
  assert.ok(shim, "could not extract the reference-transaction shim");
  return shim;
}

function setup(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fence-land-${tag}-`));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "s@example.com"]);
  git(dir, ["config", "user.name", "S"]);
  fs.mkdirSync(path.join(dir, "scripts", "hooks"), { recursive: true });
  fs.mkdirSync(path.join(dir, "scripts", "dispatch"), { recursive: true });
  fs.copyFileSync(
    path.join(PROJECT_ROOT, "scripts", "hooks", "protected-ref-transaction.js"),
    path.join(dir, "scripts", "hooks", "protected-ref-transaction.js"),
  );
  fs.copyFileSync(
    path.join(PROJECT_ROOT, "scripts", "dispatch", "conductor-lease.js"),
    path.join(dir, "scripts", "dispatch", "conductor-lease.js"),
  );
  fs.writeFileSync(path.join(dir, "README.md"), "seed\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  const hook = path.join(dir, ".git", "hooks", "reference-transaction");
  fs.writeFileSync(hook, extractShim());
  fs.chmodSync(hook, 0o755);
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `fence-land-wtbase-${tag}-`)), "wt");
  git(dir, ["worktree", "add", "-q", "-b", `wt-${tag}`, wt]);
  return { dir, wt };
}

function runHook(hookPath, cwd, refName, env) {
  const zero = "0000000000000000000000000000000000000000";
  const one = "1111111111111111111111111111111111111111";
  const r = spawnSync(BASH, [hookPath, "prepared"], {
    cwd,
    input: `${zero} ${one} ${refName}\n`,
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  if (r.error) throw new Error(`could not run the shim via ${BASH}: ${r.error.message}`);
  return r.status;
}

test("LAND — from a linked-worktree cwd, a VALID fenced refs/heads/main write LANDS (common-git-dir resolves to canonical; no over-refusal)", () => {
  const { dir, wt } = setup("land");
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fence-land-lease-"));
  try {
    const spId = "SP-WORKTREE-LAND";
    const acq = lease.acquire(spId, { root: leaseRoot, sessionId: "worktree-land" });
    assert.ok(acq && acq.ok && acq.token != null, `lease acquire must succeed: ${JSON.stringify(acq)}`);
    const env = {
      ...process.env,
      ...mcEnv.envPair("CONTROLLER_FENCE_TOKEN", String(acq.token)),
      ...mcEnv.envPair("CONTROLLER_FENCE_SPID", spId),
      ...mcEnv.envPair("CONTROLLER_FENCE_LEASE_ROOT", leaseRoot),
    };
    const hook = path.join(dir, ".git", "hooks", "reference-transaction");
    const code = runHook(hook, wt, "refs/heads/main", env);
    assert.strictEqual(code, 0, "a VALID fenced protected write from a worktree cwd MUST land (shim resolved canonical + delegated + verifier allowed)");
  } finally {
    git(dir, ["worktree", "remove", "--force", wt]).length;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(leaseRoot, { recursive: true, force: true });
  }
});

test("DISCRIMINATION — the SAME worktree refs/heads/main write with NO fence token is REFUSED (proves genuine delegation, not skip)", () => {
  const { dir, wt } = setup("disc");
  try {
    const env = { ...process.env };
    for (const s of ["CONTROLLER_FENCE_TOKEN", "CONTROLLER_FENCE_SPID", "CONTROLLER_FENCE_LEASE_ROOT"]) mcEnv.unsetEnv(s, env);
    const hook = path.join(dir, ".git", "hooks", "reference-transaction");
    const code = runHook(hook, wt, "refs/heads/main", env);
    assert.notStrictEqual(code, 0, "an UN-fenced protected write from a worktree cwd MUST be refused by the real verifier");
  } finally {
    git(dir, ["worktree", "remove", "--force", wt]).length;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
