#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// auth-floor-rm-with-write.test.js — SP-20260611-002 FIX1-G2, gauntlet finding 3.
//
//   AC-4.1 ALL-OR-NOTHING: a node -e command that mixes a write call WITH ANY
//   rmSync/unlinkSync/rmdirSync is NOT approvable — the delete POISONS the
//   entire command, regardless of co-present write/append/mkdir calls.
//
//   Exploit (exact attack from gauntlet finding 3):
//     node -e "fs.writeFileSync('output.js','x'); fs.rmSync(targetVar)"
//   - matchNodeEFs MUST return null (not approvable) — the write regex fires
//     first under the unfixed code and returns the node-e-fs scope, bypassing
//     AC-4.1.
//   - The variable form fs.rmSync(targetVar) means extractDeleteTargets extracts
//     NO literal path → the tracked-delete floor (AC-4.2) also misses it.
//   - Combined: the attack gets approved end-to-end with the unfixed gate.
//
//   Mutation-verify contract (binding per fix brief):
//     Revert the "delete poisons" guard in matchNodeEFs → this test REDs.
//     Restore the fix → this test GREENs.
//
//   No-over-block guarantee: a write/append/mkdir-only node -e (no delete) is
//   still matched by matchNodeEFs and approved through the gate.
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

// ── Exact exploit: writeFileSync co-present with rmSync(variable) ─────────────
// Variable form is critical: extractDeleteTargets extracts no literal path from
// fs.rmSync(targetVar), so the tracked-delete floor (AC-4.2) does NOT intercept
// it. The PRIMARY fix must live in matchNodeEFs.
const EXPLOIT_CMD = `node -e "fs.writeFileSync('output.js','x'); fs.rmSync(targetVar)"`;

ok("Finding 3 (primary): matchNodeEFs returns null for write+rmSync(variable) — all-or-nothing", () => {
  const m = gate.matchNodeEFs("Bash", bash(EXPLOIT_CMD));
  assert.strictEqual(
    m,
    null,
    "a mixed write+delete command must NOT be approved; matchNodeEFs must return null",
  );
});

ok("Finding 3 (floor-gap confirm): extractDeleteTargets extracts nothing from rmSync(variable)", () => {
  // Confirms WHY the floor cannot be the primary remedy: the variable path
  // is not a string literal, so no target is extracted.
  const targets = gate.extractDeleteTargets(EXPLOIT_CMD);
  assert.strictEqual(
    targets.length,
    0,
    "variable-form rmSync yields no extractable literal path — floor bypass confirmed",
  );
});

ok("Finding 3 (floor-gap confirm): isInSafetyFloor does NOT block write+rmSync(variable)", () => {
  // The floor misses it because extractDeleteTargets returns [] for the variable form.
  // This documents that the fix MUST be in matchNodeEFs, not only in the floor.
  const inFloor = gate.isInSafetyFloor("Bash", bash(EXPLOIT_CMD));
  assert.strictEqual(
    inFloor,
    false,
    "floor cannot catch the variable-form delete — PRIMARY fix must be matchNodeEFs",
  );
});

ok("Finding 3 (E2E): with node-e-fs granted, write+rmSync(variable) yields NO approve from hook subprocess", () => {
  // Plant a live-shaped auth fixture granting node-e-fs in a throwaway project.
  // NEVER touches the live auth.json — same discipline as auth-floor-tracked-delete.
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "sp002-exploit-g3-"));
  fs.mkdirSync(path.join(proj, ".claude", "runtime"), { recursive: true });
  fs.writeFileSync(
    path.join(proj, ".claude", "runtime", "authorization.json"),
    JSON.stringify({
      schema: "mc/auth/v1",
      scopes: ["node-e-fs"],
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      granted_at: new Date().toISOString(),
      session_started_at: new Date().toISOString(),
    }),
  );
  const HOOK = path.join(ROOT, "scripts", "hooks", "authorization-gate.js");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: proj };

  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command: EXPLOIT_CMD },
    }),
    env,
    encoding: "utf8",
  });
  assert.ok(
    !/"decision"\s*:\s*"approve"/.test(result.stdout || ""),
    `write+rmSync(variable) must NOT be approved end-to-end; got stdout: ${result.stdout}`,
  );
});

// ── Poison extends to unlinkSync and rmdirSync variants ───────────────────────
ok("Poison variant: write+unlinkSync(variable) is also NOT approvable", () => {
  const cmd = `node -e "fs.writeFileSync('a.js','b'); fs.unlinkSync(pathVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "unlinkSync co-present with write also poisons the command",
  );
});

ok("Poison variant: write+rmdirSync(variable) is also NOT approvable", () => {
  const cmd = `node -e "fs.writeFileSync('a.js','b'); fs.rmdirSync(dirVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "rmdirSync co-present with write also poisons the command",
  );
});

ok("Poison variant: append+rmSync(variable) is also NOT approvable", () => {
  const cmd = `node -e "fs.appendFileSync('log.txt','line'); fs.rmSync(v)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "rmSync with appendFileSync is also poisoned",
  );
});

ok("FIX2 same-class: destructured rmSync(variable) with a write is also NOT approvable", () => {
  const cmd = `node -e "const fs=require('fs'); const { rmSync } = require('fs'); fs.writeFileSync('out.js','x'); rmSync(targetVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "destructured rmSync with a co-present write must poison node-e-fs",
  );
});

ok("FIX2 same-class: renamed destructured rmSync alias with a write is also NOT approvable", () => {
  const cmd = `node -e "const fs=require('fs'); const { rmSync: remove } = require('fs'); fs.writeFileSync('out.js','x'); remove(targetVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "a renamed destructive fs import must poison node-e-fs even when the call uses the alias",
  );
});

ok("FIX2 same-class: bracket fs['unlinkSync'] with a write is also NOT approvable", () => {
  const cmd = `node -e "fs.writeFileSync('a.js','b'); fs['unlinkSync'](pathVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "bracket access to destructive fs methods must poison node-e-fs",
  );
});

ok("FIX2 same-class: require('fs').rmSync assigned to an alias with a write is also NOT approvable", () => {
  const cmd = `node -e "const fs=require('fs'); const remove=require('fs').rmSync; fs.writeFileSync('out.js','x'); remove(targetVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "require-bound destructive fs aliases must poison node-e-fs",
  );
});

ok("FIX2 same-class: require('fs')['unlinkSync'] assigned to an alias with a write is also NOT approvable", () => {
  const cmd = `node -e "const fs=require('fs'); const unlink=require('fs')['unlinkSync']; fs.writeFileSync('out.js','x'); unlink(pathVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "bracket require-bound destructive fs aliases must poison node-e-fs",
  );
});

ok("FIX2 same-class: destructured node:fs rmSync alias with a write is also NOT approvable", () => {
  const cmd = `node -e "const fs=require('fs'); const { rmSync: remove } = require('node:fs'); fs.writeFileSync('out.js','x'); remove(targetVar)"`;
  assert.strictEqual(
    gate.matchNodeEFs("Bash", bash(cmd)),
    null,
    "node:fs destructive aliases must poison node-e-fs",
  );
});

// ── No-over-block: pure write/append/mkdir are still approved ─────────────────
ok("No-over-block: writeFileSync-only node -e is still approvable", () => {
  const m = gate.matchNodeEFs("Bash", bash(`node -e "fs.writeFileSync('out.js','x')"`));
  assert.ok(m && m.scope === "node-e-fs", "pure write must still be approved");
});

ok("No-over-block: appendFileSync-only node -e is still approvable", () => {
  const m = gate.matchNodeEFs("Bash", bash(`node -e "fs.appendFileSync('log.txt','\\n')"`));
  assert.ok(m && m.scope === "node-e-fs", "pure append must still be approved");
});

ok("No-over-block: mkdirSync-only node -e is still approvable", () => {
  const m = gate.matchNodeEFs("Bash", bash(`node -e "fs.mkdirSync('build/',{recursive:true})"`));
  assert.ok(m && m.scope === "node-e-fs", "pure mkdir must still be approved");
});

ok("No-over-block: write+append+mkdir (no delete) node -e is still approvable", () => {
  const cmd = `node -e "fs.mkdirSync('out/'); fs.writeFileSync('out/a.js','x'); fs.appendFileSync('log','done')"`;
  const m = gate.matchNodeEFs("Bash", bash(cmd));
  assert.ok(m && m.scope === "node-e-fs", "write+append+mkdir with NO delete must still be approved");
});

console.log(`\nSP-20260611-002 auth-floor-rm-with-write: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
