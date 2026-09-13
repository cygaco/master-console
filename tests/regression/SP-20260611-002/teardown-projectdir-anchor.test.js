#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// teardown-projectdir-anchor.test.js — SP-20260611-002 W1-fold (T-20260611-324,
// BLOCKER). Exploit-shaped regression for the session-end-team-teardown.js
// require-redirection hardening.
//
// THE OLD ATTACK (must now FAIL CLOSED): the hook used
//   projectDir = process.env.CLAUDE_PROJECT_DIR || event.cwd || process.cwd()
// then `require(<projectDir>/scripts/teams/lifecycle.js)` + called teardown. With
// CLAUDE_PROJECT_DIR ABSENT, an attacker-supplied `event.cwd` could redirect
// MODULE LOADING (and the teardown request) to a FOREIGN project the attacker
// planted — arbitrary-code-load via hook input (require-redirection).
//
// THE FIX (AC-324.1): projectDir is ANCHORED to the hook file's OWN location
// (__dirname → repo root, realpath-canonicalized). event.cwd / the env var are
// CORROBORATING context only — never the require() base.
//
// FIXTURE NAMESPACING (Hard AC #9 / P-059): the foreign attacker project + its
// malicious lifecycle.js live in a SEALED per-test OS-tmpdir — never a live
// runtime path. The malicious module, IF loaded, drops a sentinel file; the test
// asserts the sentinel is NEVER written (the foreign module never executes) and
// the hook still exits 0 (fail-open / happy-path preserved). Per-surface
// isolation (Hard AC #4): this file covers ONLY session-end-team-teardown.js.
// ─────────────────────────────────────────────────────────────────────────────
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOK = path.join(ROOT, "scripts", "hooks", "session-end-team-teardown.js");

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

// Build a sealed FOREIGN attacker project carrying a MALICIOUS lifecycle.js that,
// if ever require()d, drops a sentinel file (proof of require-redirection). It
// also exports a teardown() so a vulnerable hook would call INTO the attacker's
// code. Returns { foreignDir, sentinel }.
function plantForeignProject() {
  const foreignDir = fs.mkdtempSync(path.join(os.tmpdir(), "tpa-foreign-"));
  const sentinel = path.join(foreignDir, "PWNED.sentinel");
  fs.mkdirSync(path.join(foreignDir, "scripts", "teams"), { recursive: true });
  const malicious =
    'fs.writeFileSync(' + JSON.stringify(sentinel) + ', "require-redirection executed");';
  fs.writeFileSync(
    path.join(foreignDir, "scripts", "teams", "lifecycle.js"),
    '"use strict";\nconst fs = require("fs");\n' +
      malicious +
      '\nmodule.exports = { teardown() { ' +
      'fs.writeFileSync(' + JSON.stringify(sentinel + ".teardown") + ', "x");' +
      ' return { slug: "pwned", requested: [], foreignProtected: [], residual: "pwned" }; } };\n',
  );
  return { foreignDir, sentinel };
}

// Spawn the REAL hook subprocess exactly as the harness runs it. opts:
//   eventCwd  — the attacker-controlled `event.cwd` on the hook-input JSON
//   withEnv   — when true, set CLAUDE_PROJECT_DIR to eventCwd too (the env arm
//               of the same trust bug); when false (default) the env var is
//               DELETED so event.cwd is the only attacker lever.
function runHook(opts = {}) {
  const event = {};
  if (opts.eventCwd) event.cwd = opts.eventCwd;
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (opts.withEnv && opts.eventCwd) env.CLAUDE_PROJECT_DIR = opts.eventCwd;
  // Run from a neutral cwd (the OS tmpdir) so process.cwd() is ALSO not the repo
  // — the only thing that can point at the repo is the __dirname anchor.
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify(event),
    env,
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
  return { stdout: r.stdout || "", stderr: r.stderr || "", status: r.status };
}

// ── AC-324.2 — an attacker event.cwd does NOT redirect require()/teardown ─────
ok("attacker-event-cwd-does-not-redirect-require-to-foreign-project", () => {
  const { foreignDir, sentinel } = plantForeignProject();
  const r = runHook({ eventCwd: foreignDir }); // CLAUDE_PROJECT_DIR absent
  // The malicious foreign lifecycle.js must NEVER have been loaded or called.
  assert.ok(
    !fs.existsSync(sentinel),
    "the foreign lifecycle.js was require()d (require-redirection) — sentinel dropped",
  );
  assert.ok(
    !fs.existsSync(sentinel + ".teardown"),
    "the foreign teardown() was CALLED — the hook trusted event.cwd",
  );
  // Fail-open contract: the hook still exits 0 regardless.
  assert.strictEqual(r.status, 0, "the hook must exit 0 (fail-open backstop)");
});

ok("attacker-env-and-cwd-together-still-anchored", () => {
  // Belt-and-suspenders: even if the attacker controls BOTH event.cwd AND the
  // env var, the anchor wins — the require() base is the hook's own repo root.
  const { foreignDir, sentinel } = plantForeignProject();
  const r = runHook({ eventCwd: foreignDir, withEnv: true });
  assert.ok(!fs.existsSync(sentinel), "anchor must beat a poisoned CLAUDE_PROJECT_DIR too");
  assert.ok(!fs.existsSync(sentinel + ".teardown"), "no foreign teardown under env+cwd poison");
  assert.strictEqual(r.status, 0, "fail-open preserved");
});

// ── AC-324.1 — the require() base resolves to the hook's OWN repo root ────────
ok("require-base-is-the-hooks-own-canonical-repo-root", () => {
  // Load the hook's anchoring logic by reading the resolved repo root the SAME
  // way the hook computes it (realpath of __dirname/../..), and assert the REAL
  // manager exists there — i.e. the anchor points at a real, loadable lifecycle.js
  // in THIS repo, not at attacker input.
  const anchored = fs.realpathSync(path.resolve(ROOT)); // ROOT == hook ../..
  const mgr = path.join(anchored, "scripts", "teams", "lifecycle.js");
  assert.ok(fs.existsSync(mgr), "the anchored repo root carries the real lifecycle.js");
  // And the source derives projectDir from the __dirname anchor — not input.
  // (Strip line-comments first so the assertion checks CODE, not the explanatory
  // prose that legitimately quotes the old vulnerable chain.)
  const src = fs.readFileSync(HOOK, "utf8");
  const code = src.replace(/\/\/[^\n]*/g, "");
  assert.ok(
    /const\s+projectDir\s*=\s*anchoredProjectDir\(\)/.test(code),
    "projectDir is assigned from the __dirname-anchored helper",
  );
  assert.ok(
    /path\.resolve\(__dirname,\s*"\.\.",\s*"\.\."\)/.test(code),
    "the anchor is the hook's own repo root (__dirname/../..)",
  );
  // The require() base must be `projectDir` (the anchor), and projectDir must NOT
  // be assigned from event.cwd / the env var anywhere in executable code.
  assert.ok(
    !/const\s+projectDir\s*=\s*[^;]*event\.cwd/.test(code),
    "projectDir is never assigned from event.cwd in code",
  );
  assert.ok(
    !/const\s+projectDir\s*=\s*[^;]*CLAUDE_PROJECT_DIR/.test(code),
    "projectDir is never assigned from CLAUDE_PROJECT_DIR in code",
  );
});

// ── AC-324.3 — the legitimate same-project teardown still works (no regression
//               + fail-open: a teardown failure never throws/blocks) ───────────
ok("legitimate-same-project-teardown-still-works-and-fails-open", () => {
  // No attacker input at all — the normal SessionEnd backstop path. The hook
  // anchors to the real repo, require()s the REAL lifecycle.js, calls teardown
  // (request-only), and exits 0. We run with an EMPTY teams store override so the
  // real manager touches NO machine-global team (slug-scoped, request-only).
  const emptyTeams = fs.mkdtempSync(path.join(os.tmpdir(), "tpa-teams-"));
  const emptyState = fs.mkdtempSync(path.join(os.tmpdir(), "tpa-state-"));
  const env = {
    ...process.env,
    MC_TEAMS_DIR_OVERRIDE: emptyTeams,
    MC_TEAM_STATE_DIR_OVERRIDE: emptyState,
  };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("node", [HOOK], {
    input: JSON.stringify({ cwd: ROOT }), // a HONEST same-project cwd (corroborates)
    env,
    cwd: os.tmpdir(),
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, "the legitimate backstop path exits 0 (no regression)");
});

console.log(`\nteardown-projectdir-anchor: ${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
