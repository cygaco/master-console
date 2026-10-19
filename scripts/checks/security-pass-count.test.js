#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");
mcEnv.setEnv("LIVENESS_REQUIRE_SIG", "0");
const assert = require("assert");
const { evaluateConfig, evaluateRuntime } = require("./security-pass-count");
const { signRecord } = require("../dispatch/attest-signing");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}
const has = (arr, sub) => arr.some((e) => e.includes(sub));

const GOOD = [
  { provider: "gemini", key: "primary" },
  { provider: "openai", key: "second_pass" },
  { provider: "claude", key: "third_pass" },
];

test("config: correct 3 distinct-provider claude-last chain → no hard findings", () => {
  const { hard } = evaluateConfig(GOOD);
  assert.equal(hard.length, 0, hard.join(" | "));
});
test("config: <2 passes → HARD (cross-provider review needs ≥2)", () => {
  const { hard } = evaluateConfig([{ provider: "gemini", key: "primary" }]);
  assert.ok(has(hard, "declares 1 pass"), hard.join(" | "));
});
test("config: non-distinct providers → HARD", () => {
  const { hard } = evaluateConfig([
    { provider: "gemini", key: "primary" },
    { provider: "gemini", key: "second_pass" },
  ]);
  assert.ok(has(hard, "not distinct"), hard.join(" | "));
});
test("config: claude NOT last in a 3-pass chain → HARD", () => {
  const { hard } = evaluateConfig([
    { provider: "claude", key: "primary" },
    { provider: "gemini", key: "second_pass" },
    { provider: "openai", key: "third_pass" },
  ]);
  assert.ok(has(hard, "must be LAST"), hard.join(" | "));
});

test("runtime: a review with 2/3 distinct providers → WARN (under-fire)", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", run_id: "run-A" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:01:00Z", run_id: "run-A" },
  ];
  const warns = evaluateRuntime(recs, 3);
  assert.ok(has(warns, "2/3 distinct providers"), warns.join(" | "));
});
test("runtime: a full 3/3-provider review → no WARN", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", run_id: "run-B" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:01:00Z", run_id: "run-B" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-06-18T00:02:00Z", run_id: "run-B" },
  ];
  assert.equal(evaluateRuntime(recs, 3).length, 0);
});
const FIXTURE_EXEMPT_BEFORE = "2026-06-10";
test("runtime: pre-cutoff (legacy single-pass) records are exempt", () => {
  const recs = [{ role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-01T00:00:00Z", run_id: "old" }];
  assert.equal(evaluateRuntime(recs, 3, FIXTURE_EXEMPT_BEFORE).length, 0);
});
test("runtime: with the default (no cutoff) an older partial review IS audited; the fixture cutoff exempts it", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-01T00:00:00Z", run_id: "old2" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-01T00:01:00Z", run_id: "old2" },
  ];
  assert.equal(require("./security-pass-count").LEGACY_EXEMPT_BEFORE, null);
  assert.ok(has(evaluateRuntime(recs, 3), "2/3 distinct providers"), "a 2/3 review must warn when nothing is exempt");
  assert.equal(evaluateRuntime(recs, 3, FIXTURE_EXEMPT_BEFORE).length, 0);
});
test("runtime: a reaped (ok:false) pass does not count toward distinct providers", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", run_id: "run-C" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:01:00Z", run_id: "run-C" },
    { role: "security-reviewer", ok: false, provider: "claude", completed_at: "2026-06-18T00:02:00Z", run_id: "run-C" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "2/3 distinct providers"), "a dead claude lane must not count");
});

test("runtime: a lone single-provider dispatch (standalone, not a 3-pass review) → no WARN", () => {
  const recs = [{ role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-06-18T00:00:00Z", prompt_digest: "abc" }];
  assert.equal(evaluateRuntime(recs, 3).length, 0);
});
test("runtime: adhoc review with no run_id groups by shared prompt_digest (2/3 → WARN)", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", prompt_digest: "shared" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:01:00Z", prompt_digest: "shared" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "2/3 distinct providers"), evaluateRuntime(recs, 3).join(" | "));
});

test("config: a 2-provider chain (no third_pass) → HARD (full 3-provider chain required)", () => {
  const { hard } = evaluateConfig([
    { provider: "gemini", key: "primary" },
    { provider: "openai", key: "second_pass" },
  ]);
  assert.ok(has(hard, "FULL 3-provider chain") || has(hard, "declares 2 pass"), hard.join(" | "));
});
test("runtime: a 1/3 review (1 ok + 2 dead lanes, total 3) → WARN", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", prompt_digest: "rev1" },
    { role: "security-reviewer", ok: false, provider: "openai", completed_at: "2026-06-18T00:01:00Z", prompt_digest: "rev1" },
    { role: "security-reviewer", ok: false, provider: "claude", completed_at: "2026-06-18T00:02:00Z", prompt_digest: "rev1" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "1/3 distinct providers"), evaluateRuntime(recs, 3).join(" | "));
});
test("runtime: two reviews sharing run_id but distinct prompt_digests are NOT collapsed/masked", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", run_id: "R", prompt_digest: "A" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:01:00Z", run_id: "R", prompt_digest: "A" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-06-18T00:02:00Z", run_id: "R", prompt_digest: "B" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:03:00Z", run_id: "R", prompt_digest: "B" },
  ];
  assert.equal(evaluateRuntime(recs, 3).length, 2, evaluateRuntime(recs, 3).join(" | "));
});

test("Claude-lane-ABSENT 3-lab panel → flagged (and BLOCKS the gauntlet under --strict)", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelA" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelA" },
  ];
  const warns = evaluateRuntime(recs, 3);
  assert.ok(has(warns, "2/3 distinct providers"), "a Claude-absent panel MUST be flagged (not silent 2-lab green): " + warns.join(" | "));
  assert.ok(warns.length > 0, "under --strict a Claude-absent panel BLOCKS the gauntlet");
});
test("a GPT-hunter fallback-to-claude collapse → flagged (distinct providers < 3)", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelB" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelB" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:02:00Z", prompt_digest: "panelB" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "2/3 distinct providers"), "a fallback-to-claude diversity collapse must be flagged: " + evaluateRuntime(recs, 3).join(" | "));
});

if (failures.length) {
  process.stderr.write(`FAIL [security-pass-count.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [security-pass-count.test] ${passed} passed\n`);
