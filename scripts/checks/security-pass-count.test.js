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

test("runtime: a Claude-only review is labelled in the warning and never counted as multi-lab", () => {
  const recs = [
    { role: "security-reviewer", ok: false, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelC" },
    { role: "security-reviewer", ok: false, provider: "openai", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelC" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:02:00Z", prompt_digest: "panelC", diversity: "claude-only" },
  ];
  const warns = evaluateRuntime(recs, 3);
  assert.ok(has(warns, "1/3 distinct providers"), warns.join(" | "));
  assert.ok(has(warns, "Claude only — no second lab"), warns.join(" | "));
  assert.ok(!has(warns, "claim refused"), "an honest claude-only label is not a forged claim: " + warns.join(" | "));
});
test("runtime FALSIFIER: a record claiming multi-lab over Claude-only stamps is refused", () => {
  const recs = [
    { role: "security-reviewer", ok: false, provider: "openai", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelD" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelD", diversity: "multi-lab" },
  ];
  const warns = evaluateRuntime(recs, 3);
  assert.ok(has(warns, 'claims diversity "multi-lab" but its provider stamps show "claude-only"'), warns.join(" | "));
});
test("runtime FALSIFIER: a made-up diversity value is refused", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelE", diversity: "banana" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "claim refused"));
});
test("runtime FALSIFIER: an older three-provider panel on the same prompt cannot hide a newer Claude-only panel", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "same", panel_run_id: "panel-old" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "same", panel_run_id: "panel-old" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:02:00Z", prompt_digest: "same", panel_run_id: "panel-old" },
    { role: "security-reviewer", ok: false, provider: "antigravity", completed_at: "2026-07-17T00:00:00Z", prompt_digest: "same", panel_run_id: "panel-new" },
    { role: "security-reviewer", ok: false, provider: "openai", completed_at: "2026-07-17T00:01:00Z", prompt_digest: "same", panel_run_id: "panel-new" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-17T00:02:00Z", prompt_digest: "same", panel_run_id: "panel-new" },
  ];
  const warns = evaluateRuntime(recs, 3);
  assert.ok(has(warns, 'security review "panel panel-new" completed 1/3'), warns.join(" | "));
  assert.ok(!has(warns, "panel-old"), "the older complete panel is fine: " + warns.join(" | "));
});
test("runtime REGRESSION: a --review-fallback Claude record plus one surviving CLI lab is NOT 2/2 — it hides a failed CLI pass", () => {
  const FIRED = ["antigravity", "openai"];
  const recs = [
    { role: "security-reviewer", ok: false, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", panel_run_id: "p-fb" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", panel_run_id: "p-fb" },
    { role: "security-reviewer", ok: true, fallback: true, provider: "claude", quota_fallback_from: "antigravity", completed_at: "2026-07-16T00:02:00Z", panel_run_id: "p-fb" },
  ];
  const warns = evaluateRuntime(recs, 2, null, FIRED);
  assert.ok(has(warns, "1/2 distinct providers"), warns.join(" | "));
});
test("runtime: with the fired providers named, only non-fallback records from them count (positive, and a claude record outside them does not)", () => {
  const FIRED = ["antigravity", "openai"];
  const good = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", panel_run_id: "p-ok" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", panel_run_id: "p-ok" },
  ];
  assert.equal(evaluateRuntime(good, 2, null, FIRED).length, 0);
  const claudeInstead = [good[0], { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", panel_run_id: "p-ok" }];
  assert.ok(has(evaluateRuntime(claudeInstead, 2, null, FIRED), "1/2 distinct providers"));
  const fbOpenai = [good[0], { ...good[1], fallback: true }];
  assert.ok(has(evaluateRuntime(fbOpenai, 2, null, FIRED), "1/2 distinct providers"));
  assert.equal(evaluateRuntime(claudeInstead, 2).length, 0);
});
test("runnerFiredCount: the in-process Claude hunter is not expected from the runner; a CLI lab with a route label still is", () => {
  const { runnerFiredCount } = require("./security-pass-count");
  assert.equal(runnerFiredCount([{ provider: "antigravity" }, { provider: "openai" }, { provider: "claude", route: "in-process" }]), 2);
  assert.equal(runnerFiredCount([{ provider: "antigravity" }, { provider: "openai", route: "in-process" }, { provider: "claude" }]), 3);
  assert.equal(runnerFiredCount(undefined), 0);
});
test("runtime: a full runner review (two CLI labs ok, hunter recorded under its own role) is not an under-fire at the runner's count", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:00:00Z", panel_run_id: "p-full" },
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", panel_run_id: "p-full" },
    { role: "security_claude_hunter", ok: true, provider: "claude", completed_at: "2026-07-16T00:02:00Z", panel_run_id: "p-full" },
  ];
  assert.equal(evaluateRuntime(recs, 2).length, 0);
  assert.ok(has(evaluateRuntime(recs.slice(0, 1).concat([{ ...recs[1], ok: false }]), 2), "1/2 distinct providers"), "a dead lab is still an under-fire");
});
test("runtime FALSIFIER: unsigned legacy keys cannot collide with a signed panel key (prompt_digest \"panel new\" vs panel_run_id \"new\")", () => {
  const legacy = ["antigravity", "openai", "claude"].map((p, i) => ({
    role: "security-reviewer", ok: true, provider: p, completed_at: `2026-07-16T00:0${i}:00Z`, prompt_digest: "panel new",
  }));
  const newer = [
    { role: "security-reviewer", ok: false, provider: "antigravity", completed_at: "2026-07-17T00:00:00Z", panel_run_id: "new" },
    { role: "security-reviewer", ok: false, provider: "openai", completed_at: "2026-07-17T00:01:00Z", panel_run_id: "new" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-17T00:02:00Z", panel_run_id: "new" },
  ];
  const warns = evaluateRuntime([...legacy, ...newer], 3);
  assert.ok(has(warns, 'security review "panel new" completed 1/3'), "the newer Claude-only panel must be judged alone: " + warns.join(" | "));
  assert.equal(warns.length, 1, warns.join(" | "));
});
test("runtime FALSIFIER: a multi-lab claim on a newer Claude-only panel is not backed by an older panel's labs", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "same", panel_run_id: "panel-old" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-17T00:02:00Z", prompt_digest: "same", panel_run_id: "panel-new", diversity: "multi-lab" },
  ];
  assert.ok(has(evaluateRuntime(recs, 3), "claim refused"), evaluateRuntime(recs, 3).join(" | "));
});
test("runtime: a true multi-lab claim over real multi-lab stamps is accepted", () => {
  const recs = [
    { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelF", diversity: "multi-lab" },
    { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelF", diversity: "multi-lab" },
    { role: "security-reviewer", ok: true, provider: "antigravity", completed_at: "2026-07-16T00:02:00Z", prompt_digest: "panelF" },
  ];
  assert.equal(evaluateRuntime(recs, 3).length, 0);
});
test("runtime: a claim backed only by an UNSIGNED/forged ok record is refused (the stamp must be verified)", () => {
  mcEnv.setEnv("LIVENESS_REQUIRE_SIG", "1");
  try {
    const recs = [
      { role: "security-reviewer", ok: true, provider: "openai", completed_at: "2026-07-16T00:00:00Z", prompt_digest: "panelG", diversity: "multi-lab" },
      { role: "security-reviewer", ok: true, provider: "claude", completed_at: "2026-07-16T00:01:00Z", prompt_digest: "panelG" },
    ];
    assert.ok(has(evaluateRuntime(recs, 3), "claim refused"), evaluateRuntime(recs, 3).join(" | "));
  } finally {
    mcEnv.setEnv("LIVENESS_REQUIRE_SIG", "0");
  }
});

if (failures.length) {
  process.stderr.write(`FAIL [security-pass-count.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [security-pass-count.test] ${passed} passed\n`);
