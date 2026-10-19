"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeScratchRepo, rmrf } = require("./_lib/git-scratch");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");
const INSTALLER = path.join(PROJECT_ROOT, "scripts", "install-git-hooks.sh");

const OLD_SHIM = [
  "#!/usr/bin/env bash",
  "set -e",
  "REPO_ROOT=$(git rev-parse --show-toplevel)",
  'SCRIPT="$REPO_ROOT/scripts/hooks/protected-ref-transaction.js"',
  'if [ ! -f "$SCRIPT" ]; then',
  '  echo "reference-transaction: missing -- skipping" >&2',
  "  exit 0",
  "fi",
  'exec node "$SCRIPT" "$@"',
  "",
].join("\n");

function extractCurrentShim() {
  const src = fs.readFileSync(INSTALLER, "utf8");
  const blocks = [...src.matchAll(/<<'HOOK'\n([\s\S]*?)\nHOOK/g)].map((m) => m[1]);
  const shim = blocks.find(
    (b) => b.includes("protected-ref-transaction.js") && b.includes("touches_protected"),
  );
  assert.ok(shim, "could not extract the reference-transaction shim from install-git-hooks.sh");
  return shim;
}

function runShim(shimBody, cwd, refName) {
  const shimFile = path.join(cwd, ".shim-under-test.sh");
  fs.writeFileSync(shimFile, shimBody);
  const zero = "0000000000000000000000000000000000000000";
  const one = "1111111111111111111111111111111111111111";
  const r = spawnSync("bash", [shimFile, "prepared"], {
    cwd,
    input: `${zero} ${one} ${refName}\n`,
    encoding: "utf8",
    windowsHide: true,
  });
  fs.rmSync(shimFile, { force: true });
  return r.status;
}

test("the extracted shim is valid bash", () => {
  const shim = extractCurrentShim();
  const tmp = path.join(os.tmpdir(), `fence-shim-${Date.now()}.sh`);
  fs.writeFileSync(tmp, shim);
  const r = spawnSync("bash", ["-n", tmp], { encoding: "utf8", windowsHide: true });
  fs.rmSync(tmp, { force: true });
  assert.strictEqual(r.status, 0, `shim has a bash syntax error: ${r.stderr}`);
});

test("NEW shim FAILS CLOSED for refs/heads/main when the verifier is missing (script-less worktree)", () => {
  const dir = makeScratchRepo("fence-new-main");
  try {
    const code = runShim(extractCurrentShim(), dir, "refs/heads/main");
    assert.notStrictEqual(code, 0, "a protected-ref write with a missing verifier MUST be refused (non-zero)");
  } finally {
    rmrf(dir);
  }
});

test("NEW shim graceful-skips a NON-protected ref when the verifier is missing (no over-refusal)", () => {
  const dir = makeScratchRepo("fence-new-feat");
  try {
    const code = runShim(extractCurrentShim(), dir, "refs/heads/feature");
    assert.strictEqual(code, 0, "a non-protected write with a missing verifier must be skipped (exit 0)");
  } finally {
    rmrf(dir);
  }
});

test("REGRESSION PROOF — the OLD shim FAILED OPEN for refs/heads/main (the bug this gate guards)", () => {
  const dir = makeScratchRepo("fence-old-main");
  try {
    const code = runShim(OLD_SHIM, dir, "refs/heads/main");
    assert.strictEqual(code, 0, "the OLD shim fails open (exit 0) for a protected ref with a missing verifier — the defect");
  } finally {
    rmrf(dir);
  }
});
