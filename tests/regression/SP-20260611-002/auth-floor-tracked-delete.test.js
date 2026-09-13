#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// auth-floor-tracked-delete.test.js — SP-20260611-002 WS-G2, R-4 / AC-4.1..4.3.
//
//   AC-4.1 (PRIMARY): the node-e-fs scope is NARROWED to write/append/mkdir only.
//                     rmSync/unlinkSync are NOT approvable — the gate emits no
//                     `decision:"approve"` for them.
//   AC-4.2 (BACKSTOP): an EXECUTABLE git-aware tracked-work-delete floor forces
//                      pass-through (no approve) for a delete of TRACKED work via
//                      ANY scope (node-e-fs rm, shell rm, git rm) — the SAFETY_FLOOR
//                      prose is now code.
//   AC-4.3: a legitimate write/append/mkdir under node-e-fs is still approved AND
//           an UNtracked/ignored temp delete is NOT floor-blocked (git-aware, no
//           over-block).
//
// The git-aware cases run against a THROWAWAY git repo built in a temp dir — never
// the live repo, never live auth.json.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const gate = require(path.join(ROOT, "scripts", "hooks", "authorization-gate.js"));

let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e.stack || e.message}`);
  }
}

const bash = (command) => ({ command });

// Build a throwaway git repo with a TRACKED file and an UNtracked temp file.
function throwawayRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp002-floor-repo-"));
  const run = (args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  run(["init", "-q"]);
  run(["config", "user.email", "t@t.t"]);
  run(["config", "user.name", "t"]);
  fs.writeFileSync(path.join(dir, "tracked-work.js"), "// real tracked work\n");
  fs.writeFileSync(path.join(dir, ".gitignore"), "ignored-tmp/\n*.tmp\n");
  run(["add", "tracked-work.js", ".gitignore"]);
  run(["commit", "-q", "-m", "seed"]);
  // Make tracked-work.js have an uncommitted edit (so deleting it loses work).
  fs.writeFileSync(path.join(dir, "tracked-work.js"), "// real tracked work\n// UNCOMMITTED edit\n");
  // An untracked / ignored temp file.
  fs.writeFileSync(path.join(dir, "scratch.tmp"), "throwaway\n");
  fs.mkdirSync(path.join(dir, "ignored-tmp"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ignored-tmp", "x.txt"), "ignored\n");
  return dir;
}

// ── AC-4.1: node-e-fs no longer matches rm/unlink ────────────────────────────
ok("AC-4.1: matchNodeEFs APPROVES write/append/mkdir", () => {
  for (const fn of ["writeFileSync", "appendFileSync", "mkdirSync"]) {
    const m = gate.matchNodeEFs("Bash", bash(`node -e "fs.${fn}('a','b')"`));
    assert.ok(m && m.scope === "node-e-fs", `${fn} must still be approvable`);
  }
});

ok("AC-4.1: matchNodeEFs does NOT match rmSync / unlinkSync (no approve for a delete)", () => {
  for (const fn of ["rmSync", "unlinkSync", "rmdirSync"]) {
    const m = gate.matchNodeEFs("Bash", bash(`node -e "fs.${fn}('victim.js')"`));
    assert.strictEqual(m, null, `${fn} must NOT resolve to an approvable node-e-fs match`);
  }
});

// ── AC-4.2: extractDeleteTargets pulls the path across shapes ─────────────────
ok("AC-4.2: extractDeleteTargets pulls targets from node-e fs.rmSync / git rm / shell rm", () => {
  assert.ok(gate.extractDeleteTargets(`node -e "fs.rmSync('src/keep.js')"`).includes("src/keep.js"));
  assert.ok(gate.extractDeleteTargets(`node -e "fs.unlinkSync(\\"a/b.txt\\")"`).includes("a/b.txt"));
  assert.ok(gate.extractDeleteTargets("git rm --cached lib/mod.js").includes("lib/mod.js"));
  assert.ok(gate.extractDeleteTargets("rm -rf build/out.js").includes("build/out.js"));
});

// ── AC-4.2: a delete of TRACKED work hits the executable floor (any scope) ────
ok("AC-4.2: deleting a TRACKED file via node-e fs.rmSync is in the safety floor (any scope)", () => {
  const repo = throwawayRepo();
  const inFloor = gate.isInSafetyFloor("Bash", bash(`node -e "fs.rmSync('tracked-work.js')"`), repo);
  assert.strictEqual(inFloor, true, "a tracked-work delete forces pass-through (no approve)");
});

ok("AC-4.2: deleting a TRACKED file via shell rm is in the safety floor", () => {
  const repo = throwawayRepo();
  assert.strictEqual(gate.isInSafetyFloor("Bash", bash("rm -f tracked-work.js"), repo), true);
});

ok("AC-4.2: deleting a TRACKED file via git rm is in the safety floor", () => {
  const repo = throwawayRepo();
  assert.strictEqual(gate.isInSafetyFloor("Bash", bash("git rm tracked-work.js"), repo), true);
});

// ── AC-4.3: legitimate write approved + untracked/ignored delete NOT blocked ──
ok("AC-4.3: a legitimate node-e-fs WRITE is still approvable and NOT floor-blocked", () => {
  const repo = throwawayRepo();
  const cmd = bash(`node -e "fs.writeFileSync('new-output.js','content')"`);
  assert.ok(gate.matchNodeEFs("Bash", cmd), "the write is scope-matched");
  assert.strictEqual(gate.isInSafetyFloor("Bash", cmd, repo), false, "a write is not a delete — not floor-blocked");
});

ok("AC-4.3: deleting an UNtracked temp file is NOT floor-blocked (git-aware, no over-block)", () => {
  const repo = throwawayRepo();
  assert.strictEqual(gate.isInSafetyFloor("Bash", bash(`node -e "fs.rmSync('scratch.tmp')"`), repo), false, "untracked temp delete is allowed through (not tracked work)");
  assert.strictEqual(gate.isInSafetyFloor("Bash", bash("rm scratch.tmp"), repo), false);
});

ok("AC-4.3: deleting an IGNORED file is NOT floor-blocked", () => {
  const repo = throwawayRepo();
  assert.strictEqual(gate.isInSafetyFloor("Bash", bash("rm -rf ignored-tmp/x.txt"), repo), false, "a .gitignore'd path is not tracked work");
});

// ── End-to-end via the hook subprocess: rm of a tracked file gets NO approve ──
ok("E2E: with node-e-fs granted, an rmSync of a TRACKED file yields NO approve from the hook", () => {
  const repo = throwawayRepo();
  // Plant a live-shaped auth granting node-e-fs in the throwaway repo's runtime.
  fs.mkdirSync(path.join(repo, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".claude", "runtime", "authorization.json"),
    JSON.stringify({
      schema: "mc/auth/v1",
      scopes: ["node-e-fs", "manifest-edit"],
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      granted_at: new Date().toISOString(),
      session_started_at: new Date().toISOString(),
    }),
  );
  const HOOK = path.join(ROOT, "scripts", "hooks", "authorization-gate.js");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: repo };

  // A tracked-file delete → no approve (floor pass-through).
  const del = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "node -e \"fs.rmSync('tracked-work.js')\"" } }),
    env, encoding: "utf8",
  });
  assert.ok(!/"decision"\s*:\s*"approve"/.test(del.stdout || ""), `a tracked-work delete must NOT be approved; got stdout: ${del.stdout}`);

  // A legitimate write under the same grant → approve.
  const write = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "node -e \"fs.writeFileSync('out.js','x')\"" } }),
    env, encoding: "utf8",
  });
  assert.ok(/"decision"\s*:\s*"approve"/.test(write.stdout || ""), `a legitimate write under node-e-fs must be approved; got stdout: ${write.stdout}`);
});

console.log(`\nSP-20260611-002 auth-floor-tracked-delete: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
