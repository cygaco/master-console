#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { shapeDoor, shapeMismatch } = require("./dispatch-shape");
const { sanctionedLane } = require("./dispatch-contract");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const SKILL_UNIT = { kind: "skill", id: "scan:full" };
const SKILL_SHAPE = "subprocess-skill";

test("precondition: scan:full (unstamped) dispatched subprocess-skill is a HIGH-severity mismatch", () => {
  const mm = shapeMismatch(SKILL_SHAPE, SKILL_UNIT);
  assert.ok(mm && mm.mismatch === true && mm.severity === "high", JSON.stringify(mm));
});

test("report-only pin: skill violation → PROCEED (advisory, not blocked) — current live behavior", () => {
  const d = shapeDoor(SKILL_SHAPE, SKILL_UNIT, {}, { reportOnlyPin: true });
  assert.equal(d.action, "proceed");
  assert.equal(d.mode, "report");
});

test("enforce flip: the SAME skill violation → REFUSE (the flip blocks it)", () => {
  const d = shapeDoor(SKILL_SHAPE, SKILL_UNIT, {}, { enforceDefault: true });
  assert.equal(d.action, "refuse");
  assert.equal(d.severity, "high");
});

test("enforce + sanctioned → PROCEED + suppressed (sanctioned lane is not blocked)", () => {
  const d = shapeDoor(SKILL_SHAPE, SKILL_UNIT, {}, { enforceDefault: true, sanctioned: true });
  assert.equal(d.action, "proceed");
  assert.equal(d.suppressed, true);
});

test("enforce + sanctioned NOT set → REFUSE (non-sanctioned cannot ride suppression)", () => {
  const d = shapeDoor(SKILL_SHAPE, SKILL_UNIT, {}, { enforceDefault: true, sanctioned: false });
  assert.equal(d.action, "refuse", "a non-sanctioned lane must not be suppressed");
  assert.equal(d.suppressed, false);
});

test("enforce: a MATCHING shape proceeds (the flip refuses only mismatches, not correct shapes)", () => {
  const inlineSkill = { kind: "skill", id: "scan:references" };
  const d = shapeDoor("inline", inlineSkill, {}, { enforceDefault: true });
  assert.equal(d.action, "proceed");
});

test("no-widen: security_claude_hunter sanctions in-process-agent for a cross_provider_reviewer only", () => {
  const ok = sanctionedLane({ role: "security-reviewer", shape: "in-process-agent", lane: "security_claude_hunter" });
  assert.equal(ok.sanctioned, true, ok.reason);
});
test("no-widen: security_claude_hunter does NOT sanction a WRONG shape (subprocess-cross-provider)", () => {
  const bad = sanctionedLane({ role: "security-reviewer", shape: "subprocess-cross-provider", lane: "security_claude_hunter" });
  assert.equal(bad.sanctioned, false, "wrong shape must not be sanctioned");
});
test("no-widen: a non-cross_provider_reviewer role cannot claim security_claude_hunter", () => {
  const bad = sanctionedLane({ role: "frontend-builder", shape: "in-process-agent", lane: "security_claude_hunter" });
  assert.equal(bad.sanctioned, false, "a builder role must not ride the claude-hunter lane");
});
test("no-widen: an UNREGISTERED lane name → not sanctioned (fail-closed)", () => {
  const bad = sanctionedLane({ role: "security-reviewer", shape: "in-process-agent", lane: "totally-made-up-lane" });
  assert.equal(bad.sanctioned, false);
});

if (failures.length) {
  process.stderr.write(`FAIL [dispatch-skill-shape-flip.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [dispatch-skill-shape-flip.test] ${passed} passed (flip blocks a violation; sanctioned suppressed; no-widen hold)\n`);
