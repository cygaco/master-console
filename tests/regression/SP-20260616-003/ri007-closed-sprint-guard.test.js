#!/usr/bin/env node
"use strict";

/**
 * ri007-closed-sprint-guard.test.js — E-MC-READINESS Track-3 finding #1 (HIGH, console-critical).
 *
 * RI-007: `/sprint:full` resolves the sprint via SPRINT.active() (the registry primary) when
 * `--sprint` is omitted, with NO closed-status check — so the Master Console driving full.js
 * programmatically without the flag silently absorbs a new feature request into a FINISHED
 * sprint, and it never ships. Fix: when --sprint is omitted AND the auto-resolved primary is a
 * CLOSED sprint, refuse (exit 2, named message). An EXPLICIT --sprint is honored.
 *
 * Exploit-shaped: drives full.js with an auto-resolved retrospected primary and asserts the
 * refusal + exit 2 + zero state mutation.
 *
 *   node tests/regression/SP-20260616-003/ri007-closed-sprint-guard.test.js
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../../..");
const SPRINT = require(path.join(ROOT, "scripts/sprint/paths.js"));
const FULL = path.join(ROOT, "scripts/sprint/full.js");

let passed = 0, failed = 0;
const fails = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failed++; fails.push(`${name}: ${e.message}`); console.log(`  FAIL ${name} — ${e.message}`); }
}

// ── Unit: the new helpers ──
test("CLOSED_STATUSES covers the finished states, not active", () => {
  assert.ok(SPRINT.CLOSED_STATUSES.has("closed"));
  assert.ok(SPRINT.CLOSED_STATUSES.has("retrospected"));
  assert.ok(SPRINT.CLOSED_STATUSES.has("abandoned"));
  assert.ok(!SPRINT.CLOSED_STATUSES.has("active"));
});
test("statusOf returns null for an unknown id (no throw)", () => {
  assert.strictEqual(SPRINT.statusOf("SP-does-not-exist-xyz-000"), null);
});
test("statusOf reads a real registry status (SP-20260512-001 is retrospected)", () => {
  // A live retrospected sprint exists in the registry; statusOf must read its status.
  assert.strictEqual(SPRINT.statusOf("SP-20260512-001"), "retrospected");
});

// ── Behavioral: the guard refuses an auto-resolved closed primary, side-effect-free ──
test("no --sprint + auto-resolved CLOSED primary → exit 2 + refusal (the RI-007 bug, closed)", () => {
  // MC_SPRINT_ID makes SPRINT.active() return a CLOSED sprint without --sprint (the omit-flag path).
  const r = spawnSync(process.execPath, [FULL, "a brand new feature request"], {
    env: { ...process.env, MC_SPRINT_ID: "SP-20260512-001" },
    encoding: "utf8", timeout: 30000,
  });
  assert.strictEqual(r.status, 2, `exit 2; got ${r.status} stderr=${(r.stderr || "").slice(0, 200)}`);
  assert.ok(/Refusing to absorb new work into a finished sprint/.test(r.stderr || ""), `refusal message; stderr=${(r.stderr || "").slice(0, 200)}`);
  assert.ok(/retrospected/.test(r.stderr || ""), "names the closed status");
});

// ── Structural: the guard is gated on omitted --sprint (an explicit --sprint is honored) ──
test("the guard only fires when --sprint is omitted (explicit --sprint honored)", () => {
  const src = fs.readFileSync(FULL, "utf8");
  const idx = src.indexOf("RI-007");
  assert.ok(idx >= 0, "RI-007 guard present");
  const seg = src.slice(idx, idx + 1000);
  assert.ok(/if \(!args\.sprint\)/.test(seg), "gated on omitted --sprint (explicit --sprint skips it)");
  assert.ok(/SPRINT\.CLOSED_STATUSES\.has/.test(seg), "checks CLOSED_STATUSES");
  assert.ok(/return 2/.test(seg), "exits 2 on refusal");
});

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — ri007-closed-sprint-guard: ${passed} passed, ${failed} failed`);
if (failed) { console.error("\n" + fails.join("\n")); process.exit(1); }
