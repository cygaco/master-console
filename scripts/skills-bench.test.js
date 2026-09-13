#!/usr/bin/env node
"use strict";

/**
 * skills-bench.test.js — P5 fixture A/B for the §13.7 skills-bench HARNESS.
 *
 * Built on scripts/checks/lib/fixture-harness.js so it ships the four P5 guarantees
 * (sealed fixture, known-answer, planted-violation, fail-closed) and the harness
 * meta-enforces that at least one planted-violation assertion runs.
 *
 * Everything runs against a SEALED FIXTURE registry + synthetic benchsets in a temp
 * dir — NEVER the live .claude/runtime/skill-weight.json. The cross-provider judge is
 * STUBBED deterministically via SKILLS_BENCH_JUDGE_OVERRIDE (no real dispatch, no
 * spend, no self-grading). The token counts are SYNTHETIC (no real skill replay).
 *
 * The three mandated fixture A/B cases:
 *   (1) BOTH-PASS    — Axis 1 (big savings) + Axis 2 (judge: subprocess>=inline) →
 *                      EARNED → subprocess_verified:true STAMPED in the fixture registry.
 *   (2) AXIS-1-FAIL  — envelope ≈ inline (a light skill; net savings below threshold) →
 *                      Axis 1 fails → NOT finalized (planted violation).
 *   (3) AXIS-2-FAIL  — big savings BUT judge rules subprocess<inline → Axis 2 fails →
 *                      NOT finalized (planted violation).
 *
 * Plus: an UNGRADED skill (no judge wired, no override) fails closed; the live
 * registry is NOT mutated; 0 real skills are stamped subprocess_verified:true.
 *
 * Run: node scripts/skills-bench.test.js   (exit 0 = pass)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { harness } = require("./checks/lib/fixture-harness");
const bench = require("./skills-bench");

const h = harness("skills-bench");

// ── Sealed scratch ──────────────────────────────────────────
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-bench-"));
process.on("exit", () => {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// A SEALED fixture registry (NEVER the live one). All three fixture skills start
// UN-finalized (subprocess_verified:false) — exactly the state a real candidate is in
// before §13.7. (A §13.6 OBJECT stamp would also be non-`true`; false is the simplest.)
function writeFixtureRegistry() {
  const regPath = path.join(scratch, `skill-weight-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const reg = {
    schema: "mc/skill-weight/v1",
    classification: "fixture",
    candidates: {
      "fixture:both-pass": { weight: "heavy", execution: "subprocess", source: "fixture", subprocess_verified: false },
      "fixture:axis1-fail": { weight: "heavy", execution: "subprocess", source: "fixture", subprocess_verified: false },
      "fixture:axis2-fail": { weight: "heavy", execution: "subprocess", source: "fixture", subprocess_verified: false },
      "fixture:ungraded": { weight: "heavy", execution: "subprocess", source: "fixture", subprocess_verified: false },
    },
  };
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n", "utf8");
  return regPath;
}

// Synthetic benchsets. A heavy skill: inline output is large (40K orchestrator tokens),
// the envelope is tiny (~1.2K) → huge net savings. A light skill: inline output is
// already small (1.5K), envelope ~1.2K → net ≈ 0 after overhead → Axis 1 fails.
const THRESHOLDS = { min_tokens_saved: 4000, min_pct_saved: 0.6, quality_tolerance: 0.05 };

function heavyBenchset(skill) {
  return {
    schema: "mc/skill-dispatch/bench-result/v1",
    skill,
    thresholds: THRESHOLDS,
    measurements: [
      { task_id: "t1", inline_orchestrator_tokens: 40000, envelope_tokens: 1200 },
      { task_id: "t2", inline_orchestrator_tokens: 38000, envelope_tokens: 1100 },
      { task_id: "t3", inline_orchestrator_tokens: 42000, envelope_tokens: 1300 },
    ],
  };
}

function lightBenchset(skill) {
  return {
    schema: "mc/skill-dispatch/bench-result/v1",
    skill,
    thresholds: THRESHOLDS,
    // envelope ≈ inline → net per task ≈ inline − (envelope + ~1000 overhead) ≈ negative.
    measurements: [
      { task_id: "t1", inline_orchestrator_tokens: 1500, envelope_tokens: 1200 },
      { task_id: "t2", inline_orchestrator_tokens: 1400, envelope_tokens: 1150 },
    ],
  };
}

// Deterministic judge stub (cross-provider, anonymized — but FAKE; no real dispatch).
function judgeOverride(map) {
  return JSON.stringify(map);
}

function readCand(regPath, skill) {
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  return reg.candidates[skill];
}

function clearJudge() {
  delete process.env.SKILLS_BENCH_JUDGE_OVERRIDE;
}

// ── (1) BOTH-PASS → EARNED + STAMPED ────────────────────────
h.pass("both axes pass → EARNED → subprocess_verified:true STAMPED in fixture registry", () => {
  process.env.SKILLS_BENCH_JUDGE_OVERRIDE = judgeOverride({
    "fixture:both-pass": { verdict: "subprocess>=inline", score: 0.0, reason: "equivalent findings", provider: "gpt(stub)" },
  });
  const regPath = writeFixtureRegistry();
  try {
    const r = bench.runBench({
      registryPath: regPath,
      benchset: heavyBenchset("fixture:both-pass"),
      finalize: true,
    });
    const cand = readCand(regPath, "fixture:both-pass");
    const ok =
      r.decision.earned === true &&
      r.axis1.pass === true &&
      r.axis2.pass === true &&
      r.finalized === true &&
      cand.subprocess_verified === true && // STRICT boolean — the contract finalize gate
      cand.earn_it && typeof cand.earn_it.tokens_saved === "number" &&
      cand.earn_it.quality_verdict === "subprocess>=inline" &&
      !!cand.earn_it.measured_at && !!cand.earn_it.run_id;
    return { ok };
  } finally {
    clearJudge();
  }
});

// ── (2) AXIS-1-FAIL → NOT finalized (planted violation) ─────
h.violation("Axis 1 fails (envelope ≈ inline, light skill) → NOT earned, NOT finalized", () => {
  // Judge WOULD pass quality — but Axis 1 must veto fail-closed (BOTH required).
  process.env.SKILLS_BENCH_JUDGE_OVERRIDE = judgeOverride({
    "fixture:axis1-fail": { verdict: "subprocess>=inline", score: 0.0, provider: "gpt(stub)" },
  });
  const regPath = writeFixtureRegistry();
  try {
    const r = bench.runBench({
      registryPath: regPath,
      benchset: lightBenchset("fixture:axis1-fail"),
      finalize: true,
    });
    const cand = readCand(regPath, "fixture:axis1-fail");
    const notFinalized = cand.subprocess_verified === false && !cand.earn_it && r.finalized === false;
    // h.violation: return ok:true ONLY on a false-green (it earned/finalized despite
    // Axis 1 failing). A correct NOT-earned returns ok:false → counts as the expected fail.
    if (!notFinalized) return { ok: true };
    return { ok: r.decision.earned === true || r.axis1.pass === true };
  } finally {
    clearJudge();
  }
});

// ── (3) AXIS-2-FAIL → NOT finalized (planted violation) ─────
h.violation("Axis 2 fails (judge: subprocess<inline) → NOT earned, NOT finalized despite big savings", () => {
  process.env.SKILLS_BENCH_JUDGE_OVERRIDE = judgeOverride({
    "fixture:axis2-fail": { verdict: "subprocess<inline", score: -0.4, reason: "subprocess lost findings the inline arm caught", provider: "gpt(stub)" },
  });
  const regPath = writeFixtureRegistry();
  try {
    const r = bench.runBench({
      registryPath: regPath,
      benchset: heavyBenchset("fixture:axis2-fail"), // savings are HUGE — only quality vetoes
      finalize: true,
    });
    const cand = readCand(regPath, "fixture:axis2-fail");
    const notFinalized = cand.subprocess_verified === false && !cand.earn_it && r.finalized === false;
    // Sanity: Axis 1 DID pass here (proving it's quality, not savings, that vetoed).
    if (!notFinalized) return { ok: true }; // false-green: it finalized despite Axis 2 failing
    return { ok: r.decision.earned === true || r.axis2.pass === true };
  } finally {
    clearJudge();
  }
});

// ── UNGRADED → fail-closed (no self-grading) ────────────────
h.failClosed("no judge override + no real judge wired → Axis 2 UNGRADED → fail-closed (not earned)", () => {
  clearJudge(); // explicitly no override
  const regPath = writeFixtureRegistry();
  const r = bench.runBench({
    registryPath: regPath,
    benchset: heavyBenchset("fixture:ungraded"),
    finalize: true,
  });
  const cand = readCand(regPath, "fixture:ungraded");
  // fail-closed: ungraded must NOT earn/finalize. Return a NOT-pass so failClosed is satisfied.
  return { ok: r.decision.earned || cand.subprocess_verified === true };
});

// ── FAIL-CLOSED: non-existent registry throws (never the live one) ──
h.failClosed("a non-existent --registry path throws (never falls through to live)", () => {
  const bogus = path.join(scratch, "does-not-exist.json");
  bench.loadRegistry(bogus); // expected to throw → fail-closed
  return { ok: true }; // if it did NOT throw, that's a false-green
});

// ── FAIL-CLOSED: a non-subprocess candidate cannot be finalized ──
h.violation("a registry-inline skill cannot be finalized subprocess (fail-closed pre-gate)", () => {
  const regPath = path.join(scratch, `inline-reg-${Date.now()}.json`);
  fs.writeFileSync(
    regPath,
    JSON.stringify({
      schema: "mc/skill-weight/v1",
      candidates: { "fixture:is-inline": { weight: "light", execution: "inline", subprocess_verified: false } },
    }) + "\n",
    "utf8",
  );
  process.env.SKILLS_BENCH_JUDGE_OVERRIDE = judgeOverride({
    "fixture:is-inline": { verdict: "subprocess>=inline", score: 0.0 },
  });
  try {
    const r = bench.runBench({ registryPath: regPath, benchset: heavyBenchset("fixture:is-inline"), finalize: true });
    const cand = readCand(regPath, "fixture:is-inline");
    // Must NOT earn (registry says inline) AND must NOT mutate to true.
    if (cand.subprocess_verified === true) return { ok: true }; // false-green
    return { ok: r.decision.earned === true };
  } finally {
    clearJudge();
  }
});

// ── Pure-function known-answer checks (measureAxis1 / decideBoth) ──
h.pass("measureAxis1: heavy A/B clears both thresholds (mean net + pct)", () => {
  const a = bench.measureAxis1(heavyBenchset("x").measurements, THRESHOLDS);
  return { ok: a.pass === true && a.tokens_saved >= THRESHOLDS.min_tokens_saved && a.pct_saved >= THRESHOLDS.min_pct_saved };
});

h.violation("measureAxis1: zero measurements fails closed (cannot earn on no data)", () => {
  const a = bench.measureAxis1([], THRESHOLDS);
  return { ok: a.pass }; // must be false
});

h.violation("measureAxis1: a non-finite token count fails closed", () => {
  const a = bench.measureAxis1([{ task_id: "bad", inline_orchestrator_tokens: "lots", envelope_tokens: 100 }], THRESHOLDS);
  return { ok: a.pass }; // must be false
});

h.violation("decideBoth: Axis 1 pass + Axis 2 fail → NOT earned", () => {
  const d = bench.decideBoth({ pass: true }, { pass: false, reason: "quality" });
  return { ok: d.earned }; // must be false
});

// ── LIVE REGISTRY UNTOUCHED ─────────────────────────────────
const LIVE = bench.DEFAULT_REGISTRY;
const liveBefore = fs.existsSync(LIVE) ? fs.readFileSync(LIVE, "utf8") : null;

h.pass("live skill-weight.json is NOT mutated by the fixture bench (byte-identical)", () => {
  const liveAfter = fs.existsSync(LIVE) ? fs.readFileSync(LIVE, "utf8") : null;
  return { ok: liveBefore === liveAfter };
});

h.pass("no REAL skill is finalized subprocess_verified:true in the live registry", () => {
  if (!liveBefore) return { ok: true };
  let reg;
  try {
    reg = JSON.parse(liveBefore);
  } catch {
    return { ok: false };
  }
  const finalized = Object.entries(reg.candidates || {}).filter(([, c]) => c && c.subprocess_verified === true);
  return { ok: finalized.length === 0 };
});

h.done();
