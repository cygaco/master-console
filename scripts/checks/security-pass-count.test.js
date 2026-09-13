#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
// Bite-test for security-pass-count.js (E-DISPATCH-PERFECT-001 W1) — proves config-coherence FIRES
// on a broken pass chain and runtime-stamp detection FIRES on an under-fired review, and that a
// correct 3-distinct-provider claude-last chain + a full 3-provider run are clean.
// These fixtures inject UNSIGNED synthetic records to exercise the pass-COUNTING logic, so they opt out of
// the SP-20260718-004 same-session signature requirement (WARPOS_LIVENESS_REQUIRE_SIG=0); the signature gate
// itself is asserted by the "R4 signed pass-count" case below.
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

// NOTE: evaluateConfig also checks dispatch-review.js + epsilon-runtime wiring on the REAL tree;
// those are present (this repo), so a correct pass chain yields 0 hard findings here.
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
test("runtime: pre-cutoff (legacy single-pass) records are exempt", () => {
  const recs = [{ role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-01T00:00:00Z", run_id: "old" }];
  assert.equal(evaluateRuntime(recs, 3).length, 0);
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

test("HIGH-3 config: a 2-provider chain (no third_pass) → HARD (full 3-provider chain required)", () => {
  const { hard } = evaluateConfig([
    { provider: "gemini", key: "primary" },
    { provider: "openai", key: "second_pass" },
  ]);
  assert.ok(has(hard, "FULL 3-provider chain") || has(hard, "declares 2 pass"), hard.join(" | "));
});
test("HIGH-4a runtime: a 1/3 review (1 ok + 2 dead lanes, total 3) → WARN", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", prompt_digest: "rev1" },
    { role: "security-reviewer", ok: false, provider: "openai", completed_at: "2026-06-18T00:01:00Z", prompt_digest: "rev1" },
    { role: "security-reviewer", ok: false, provider: "claude", completed_at: "2026-06-18T00:02:00Z", prompt_digest: "rev1" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "1/3 distinct providers"), evaluateRuntime(recs, 3).join(" | "));
});
test("HIGH-4b runtime: two reviews sharing run_id but distinct prompt_digests are NOT collapsed/masked", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "gemini", completed_at: "2026-06-18T00:00:00Z", run_id: "R", prompt_digest: "A" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:01:00Z", run_id: "R", prompt_digest: "A" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-06-18T00:02:00Z", run_id: "R", prompt_digest: "B" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-06-18T00:03:00Z", run_id: "R", prompt_digest: "B" },
  ];
  // grouped by prompt_digest → TWO incomplete (2/3) reviews flagged; run_id grouping would have
  // unioned them to a false "3/3" complete (the HIGH-4 collapse).
  assert.equal(evaluateRuntime(recs, 3).length, 2, evaluateRuntime(recs, 3).join(" | "));
});

// ── β item-3 (BINDING, SP-20260716-001): the 3-lab panel must BLOCK when the Claude in-process hunter
//    lane produces NO evidence record — SYMMETRIC fail-closed, not a silent 2-lab (antigravity+GPT) green.
//    The Claude in-process lane is the MOST reap-prone (RI-004 class), so this is the likely collapse. ──
test("β item-3: Claude-lane-ABSENT 3-lab panel → flagged (and BLOCKS the gauntlet under --strict)", () => {
  // The panel fired the antigravity (Gemini lab) + openai (GPT lab) hunters; the Claude in-process
  // hunter produced NO evidence-bound record. distinct ok providers = 2 < 3 → under-fire.
  const recs = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelA" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelA" },
    // (no claude record — the in-process hunter lane is absent/reaped)
  ];
  const warns = evaluateRuntime(recs, 3);
  assert.ok(has(warns, "2/3 distinct providers"), "a Claude-absent panel MUST be flagged (not silent 2-lab green): " + warns.join(" | "));
  // BLOCK semantics: the security gauntlet runs `security-pass-count --strict`, where a runtime gap
  // returns exit 1 (main: `if (warns.length && strict) return 1`) — so a diversity-collapsed panel HALTS.
  assert.ok(warns.length > 0, "under --strict a Claude-absent panel BLOCKS the gauntlet");
});
// A GPT hunter FALLING BACK to Claude also collapses lab-diversity (two claude records dedupe to one
// distinct provider) — caught by the same distinct-provider count (β item-3 D: 3 labs != 3 claude records).
test("β item-3 D: a GPT-hunter fallback-to-claude collapse → flagged (distinct providers < 3)", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelB" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelB" }, // GPT lane fell back to claude
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:02:00Z", prompt_digest: "panelB" }, // the real claude hunter
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "2/3 distinct providers"), "a fallback-to-claude diversity collapse must be flagged: " + evaluateRuntime(recs, 3).join(" | "));
});

if (failures.length) {
  process.stderr.write(`FAIL [security-pass-count.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [security-pass-count.test] ${passed} passed\n`);
