#!/usr/bin/env node
"use strict";

/**
 * skills-test.test.js — P5 planted-violation test for the §13.6 skills:test HARNESS.
 *
 * Built on scripts/checks/lib/fixture-harness.js so it ships the four P5 guarantees
 * (sealed fixture, known-answer, planted-violation, fail-closed) and the harness
 * meta-enforces that at least one planted-violation assertion runs.
 *
 * Everything runs against a SEALED FIXTURE registry in a temp dir — NEVER the live
 * .claude/runtime/skill-weight.json. Resolve outcomes are forced via
 * SKILLS_TEST_RESOLVE_OVERRIDE (no real .claude/commands/ tree needed); ping spawns
 * are forced through a FAKE node bin via DISPATCH_SKILL_BIN (no real `claude`, no
 * spend), with the dispatch ledger isolated via DISPATCH_LEDGER_DIR.
 *
 * The three mandated planted fixture cases:
 *   (1) fixture-subprocess-ok  — a subprocess skill that resolves + pings OK → STAMPED.
 *   (2) fixture-inline-required — an inline-required skill that correctly FAILS the
 *                                 subprocess smoke → NOT stamped (the failure is the
 *                                 signal).
 *   (3) fixture-missing         — a hallucinated/missing skill name → FAILS resolve.
 *
 * Plus: the live registry is NOT mutated, and removing the harness's fail-closed
 * logic would FAIL this test (the planted-violation assertions catch it).
 *
 * Run: node scripts/skills-test.test.js   (exit 0 = pass)
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const { harness } = require("./checks/lib/fixture-harness");
const skillsTest = require("./skills-test");

const h = harness("skills-test");

// ── Sealed scratch + fixtures ───────────────────────────────
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
process.on("exit", () => {
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// A SEALED fixture registry (NEVER the live one) with three fixture skills.
function writeFixtureRegistry() {
  const regPath = path.join(scratch, `skill-weight-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const reg = {
    schema: "mc/skill-weight/v1",
    classification: "fixture",
    candidates: {
      "fixture:subprocess-ok": { weight: "heavy", execution: "subprocess", source: "fixture", subprocess_verified: false },
      "fixture:inline-required": { weight: "mixed", execution: "inline-required", source: "fixture", subprocess_verified: false },
    },
  };
  fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n", "utf8");
  return regPath;
}

// A fake `claude` bin that resolves the requested skill: it echoes a lean envelope
// naming the slug + an artifact so dispatch-skill.js classifies it as a happy run.
const fakeHappy = path.join(scratch, "fake-happy.js");
fs.writeFileSync(
  fakeHappy,
  // dispatch-skill captures whatever the child prints; the SKILL line + bytes make it
  // a non-trivial happy run. dispatch-skill writes its OWN envelope, so the child just
  // needs to emit non-empty output.
  'process.stdout.write("fixture skill ran. PASS\\n1 finding.\\n");\n',
);

// A fixture override forcing resolve outcomes (no real .claude/commands/ tree).
const RESOLVE_OVERRIDE = JSON.stringify({
  "fixture:subprocess-ok": { found: true, execution: "subprocess", path: ".claude/commands/fixture/subprocess-ok.md" },
  "fixture:inline-required": { found: true, execution: "inline-required", path: ".claude/commands/fixture/inline-required.md", reason: "inline-required — never subprocess-eligible" },
  // fixture:missing intentionally absent → resolveOne returns found:false.
});

// Build a ping env: fake bin + isolated ledger + isolated artifact dir + short bound.
function pingEnv(label) {
  const ledger = path.join(scratch, `ledger-${label}`);
  const runs = path.join(scratch, `runs-${label}`);
  fs.mkdirSync(ledger, { recursive: true });
  return {
    ledger,
    runs,
    apply() {
      process.env.DISPATCH_SKILL_BIN = process.execPath;
      process.env.DISPATCH_SKILL_BIN_ARGS = JSON.stringify([fakeHappy]);
      process.env.DISPATCH_LEDGER_DIR = ledger;
      process.env.DISPATCH_SKILL_RUNS_DIR = runs;
      process.env.DISPATCH_SKILL_TIMEOUT_MS = "20000";
    },
  };
}

function clearPingEnv() {
  for (const k of [
    "DISPATCH_SKILL_BIN",
    "DISPATCH_SKILL_BIN_ARGS",
    "DISPATCH_LEDGER_DIR",
    "DISPATCH_SKILL_RUNS_DIR",
    "DISPATCH_SKILL_TIMEOUT_MS",
    "SKILLS_TEST_RESOLVE_OVERRIDE",
  ]) {
    delete process.env[k];
  }
}

function readStamp(regPath, slug) {
  const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
  const c = reg.candidates[slug];
  return c ? c.subprocess_verified : undefined;
}

// ── RESOLVE MODE ────────────────────────────────────────────

// (1)+(2) Resolve: subprocess-ok PASSES routability; missing FAILS (known-answer + planted).
h.pass("resolve: fixture:subprocess-ok resolves to the NAMED skill (routability, no stamp)", () => {
  process.env.SKILLS_TEST_RESOLVE_OVERRIDE = RESOLVE_OVERRIDE;
  const regPath = writeFixtureRegistry();
  try {
    const out = skillsTest.run({ registryPath: regPath, skill: "fixture:subprocess-ok", mode: "resolve" });
    const r = out.results[0];
    // PASS, AND resolve mode must NOT stamp subprocess_verified (verified_level resolve).
    const stamp = readStamp(regPath, "fixture:subprocess-ok");
    return { ok: r.pass && r.verified_level === "resolve" && (stamp === false || stamp === undefined) && out.stamped.length === 0 };
  } finally {
    clearPingEnv();
  }
});

// (3) Resolve: a missing/hallucinated skill name FAILS resolve (planted violation).
h.violation("resolve: fixture:missing (hallucinated) FAILS — not found", () => {
  process.env.SKILLS_TEST_RESOLVE_OVERRIDE = RESOLVE_OVERRIDE;
  const regPath = writeFixtureRegistry();
  try {
    const out = skillsTest.run({ registryPath: regPath, skill: "fixture:missing", mode: "resolve" });
    const r = out.results[0];
    // h.violation asserts NOT-pass: the result must be a FAIL.
    return { ok: r.pass };
  } finally {
    clearPingEnv();
  }
});

// ── PING MODE ───────────────────────────────────────────────

// (1) Ping: subprocess-ok resolves + pings OK → PASS and gets STAMPED in the FIXTURE registry.
h.pass("ping: fixture:subprocess-ok pings OK → PASS + subprocess_verified STAMPED (fixture registry)", () => {
  process.env.SKILLS_TEST_RESOLVE_OVERRIDE = RESOLVE_OVERRIDE;
  const env = pingEnv("ok");
  env.apply();
  const regPath = writeFixtureRegistry();
  try {
    const out = skillsTest.run({ registryPath: regPath, skill: "fixture:subprocess-ok", mode: "ping", stamp: true });
    const r = out.results[0];
    const stamp = readStamp(regPath, "fixture:subprocess-ok");
    const stampedOk =
      r.pass &&
      out.stamped.includes("fixture:subprocess-ok") &&
      stamp && typeof stamp === "object" && !!stamp.date && stamp.run_id;
    return { ok: !!stampedOk };
  } finally {
    clearPingEnv();
  }
});

// (2) Ping: inline-required correctly FAILS the subprocess smoke → NOT stamped (planted).
h.violation("ping: fixture:inline-required FAILS the subprocess smoke (the signal) → NOT stamped", () => {
  process.env.SKILLS_TEST_RESOLVE_OVERRIDE = RESOLVE_OVERRIDE;
  const env = pingEnv("inline");
  env.apply();
  const regPath = writeFixtureRegistry();
  try {
    // Force the ping path even though the registry says inline-required: dispatch-skill
    // refuses the subprocess for an inline-required skill (contract_refused, exit 1) →
    // testPing sees a non-zero exit → FAIL. That FAILURE is the correct signal.
    const out = skillsTest.run({ registryPath: regPath, skill: "fixture:inline-required", mode: "ping", stamp: true });
    const r = out.results[0];
    const stamp = readStamp(regPath, "fixture:inline-required");
    const notStamped = stamp === false || stamp === undefined;
    // h.violation: the result must NOT be a pass — AND the skill must NOT be stamped.
    // We return ok:true ONLY if it incorrectly passed/stamped (so the harness flags it).
    if (!notStamped) return { ok: true }; // it got stamped → false-green → must fail this assertion
    return { ok: r.pass };
  } finally {
    clearPingEnv();
  }
});

// (3) Ping: a missing/hallucinated skill FAILS the smoke fail-closed + NOTHING stamped (planted).
h.violation("ping: fixture:missing (hallucinated) FAILS fail-closed → nothing spawned, nothing stamped", () => {
  process.env.SKILLS_TEST_RESOLVE_OVERRIDE = RESOLVE_OVERRIDE;
  const env = pingEnv("missing");
  env.apply();
  const regPath = writeFixtureRegistry();
  try {
    const out = skillsTest.run({ registryPath: regPath, skill: "fixture:missing", mode: "ping", stamp: true });
    const r = out.results[0];
    // The result must be a FAIL (not a candidate in the registry under test) AND no
    // phantom candidate may appear AND nothing may have been stamped.
    const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));
    const phantom = !!reg.candidates["fixture:missing"];
    const cleanFail = r.pass === false && !phantom && out.stamped.length === 0;
    // h.violation asserts NOT-pass: return ok:true ONLY if the harness mis-handled it
    // (passed it, invented a candidate, or stamped something) → flagged as false-green.
    return { ok: !cleanFail };
  } finally {
    clearPingEnv();
  }
});

// ── FAIL-CLOSED ─────────────────────────────────────────────

// Removing the fail-closed logic would let inline-required stamp. Assert structurally:
// a non-existent --registry path is a hard error (no silent fall-through to live).
h.failClosed("fail-closed: a non-existent --registry path throws (never falls through to live)", () => {
  const bogus = path.join(scratch, "does-not-exist.json");
  // loadRegistry must THROW for an explicit, missing --registry (not regenerate it,
  // not silently use the live registry).
  skillsTest.loadRegistry(bogus); // expected to throw → fail-closed
  return { ok: true }; // if it did NOT throw, that's a false-green
});

// ── LIVE REGISTRY UNTOUCHED ─────────────────────────────────

// The live skill-weight.json must be byte-identical after the whole test run.
const LIVE = skillsTest.DEFAULT_REGISTRY;
const liveBefore = fs.existsSync(LIVE) ? fs.readFileSync(LIVE, "utf8") : null;

h.pass("live skill-weight.json is NOT mutated by the fixture test (byte-identical)", () => {
  const liveAfter = fs.existsSync(LIVE) ? fs.readFileSync(LIVE, "utf8") : null;
  return { ok: liveBefore === liveAfter };
});

// No real skill carries a subprocess_verified:true|{} stamp in the live registry.
h.pass("no REAL skill is stamped subprocess_verified in the live registry", () => {
  if (!liveBefore) return { ok: true }; // no live registry → trivially honest
  let reg;
  try {
    reg = JSON.parse(liveBefore);
  } catch {
    return { ok: false };
  }
  const stamped = Object.entries(reg.candidates || {}).filter(([, c]) => {
    const v = c && c.subprocess_verified;
    return v === true || (v && typeof v === "object");
  });
  return { ok: stamped.length === 0 };
});

h.done();
