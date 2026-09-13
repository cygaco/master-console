#!/usr/bin/env node
/**
 * scripts/mc/test-release-build-beta-honesty-gate.js
 *
 * SP-20260528-001 / #438. Verifies release-build.js#betaHonestyGate — the gate
 * that wires /scan:sprint-beta-honesty into release builds so the 0.11.0 Beta
 * cadence is continuously enforced at release time (mechanism → audit → gate),
 * not spot-checked.
 *
 * The runner is dependency-injected so we test the verdict→block mapping
 * without standing up a capsule fixture or the real subprocess.
 *
 * Tests:
 *   A. clean audit (exit 0)                 → not blocked
 *   B. findings (exit 1, JSON)              → blocked, message lists findings
 *   C. runner error (exit 2)                → blocked (fail closed)
 *   D. crash (status null)                  → blocked (fail closed)
 *   E. non-JSON stdout on non-zero          → blocked, raw detail surfaced
 *   F. --skip-beta-honesty-check            → not blocked (explicit bypass)
 *   G. live runner (no injection)           → returns {blocked:bool} no throw
 *   H. buildCapsule wires the gate (source) → calls betaHonestyGate + exits
 */

"use strict";

const fs = require("fs");
const path = require("path");

const rb = require("./release-build");

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    process.stdout.write(`  ok  ${name}\n`);
    pass++;
  } else {
    process.stderr.write(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}\n`);
    fail++;
  }
}

// A. clean → not blocked
{
  const g = rb.betaHonestyGate({}, () => ({ status: 0, stdout: '{"ok":true,"applicable":0}', stderr: "" }));
  ok("A: clean audit (exit 0) → not blocked", g.blocked === false, JSON.stringify(g));
}

// B. findings (exit 1, JSON) → blocked, message lists the finding
{
  const findingsJson = JSON.stringify({
    ok: false,
    checked: 2,
    cutoff: "2026-05-25",
    totalFindings: 1,
    findings: [
      { sprint_id: "SP-20260525-018", finding_type: "placeholder_verdict", phase: "design", evidence: "empty beta_message" },
    ],
  });
  const g = rb.betaHonestyGate({}, () => ({ status: 1, stdout: findingsJson, stderr: "" }));
  ok("B: findings (exit 1) → blocked", g.blocked === true, JSON.stringify(g));
  ok("B: message names the offending sprint", g.message.includes("SP-20260525-018"), g.message);
  ok("B: message names the finding type", g.message.includes("placeholder_verdict"), g.message);
  ok("B: message includes remediation", g.message.includes("Remediation"), g.message);
}

// C. runner error (exit 2) → blocked (fail closed)
{
  const g = rb.betaHonestyGate({}, () => ({ status: 2, stdout: "", stderr: "invalid --since" }));
  ok("C: runner error (exit 2) → blocked (fail closed)", g.blocked === true, JSON.stringify(g));
  ok("C: raw stderr surfaced", g.message.includes("invalid --since"), g.message);
}

// D. crash (status null) → blocked (fail closed)
{
  const g = rb.betaHonestyGate({}, () => ({ status: null, stdout: "", stderr: "" }));
  ok("D: crash (status null) → blocked (fail closed)", g.blocked === true, JSON.stringify(g));
}

// E. non-JSON stdout on non-zero → blocked, raw detail surfaced
{
  const g = rb.betaHonestyGate({}, () => ({ status: 1, stdout: "boom not json", stderr: "" }));
  ok("E: non-JSON non-zero → blocked", g.blocked === true, JSON.stringify(g));
  ok("E: raw stdout surfaced as detail", g.message.includes("boom not json"), g.message);
}

// F. explicit bypass → not blocked, runner never invoked
{
  let called = false;
  const g = rb.betaHonestyGate({ skipBetaHonestyCheck: true }, () => {
    called = true;
    return { status: 1, stdout: "{}", stderr: "" };
  });
  ok("F: --skip-beta-honesty-check → not blocked", g.blocked === false, JSON.stringify(g));
  ok("F: bypass short-circuits the runner (not invoked)", called === false);
}

// G. live runner (no injection) — exercises the real subprocess wiring.
//    In a clean canonical checkout this returns blocked:false; if real findings
//    exist it returns blocked:true. Either is valid — assert boolean + no throw.
{
  let threw = false;
  let g;
  try {
    g = rb.betaHonestyGate({});
  } catch (e) {
    threw = true;
  }
  ok("G: live runner does not throw", !threw);
  ok("G: live runner returns a boolean blocked", g && typeof g.blocked === "boolean", JSON.stringify(g));
}

// H. buildCapsule actually wires the gate (source check — a full build needs a
//    capsule fixture; the wiring is what we assert here).
{
  const src = fs.readFileSync(path.join(__dirname, "release-build.js"), "utf8");
  ok("H: buildCapsule calls betaHonestyGate(opts)", /betaHonestyGate\(opts\)/.test(src));
  ok("H: blocked path exits non-zero", /honesty\.blocked[\s\S]{0,80}process\.exit\(2\)/.test(src));
  ok("H: --skip-beta-honesty-check flag is parsed", src.includes('"--skip-beta-honesty-check"'));
}

// I. Continuous-enforcement baseline — the default runner passes --since so the
//    gate does NOT block forever on un-fixable pre-gate historical findings
//    (acknowledged debt), only on sprints on/after the baseline date.
{
  const src = fs.readFileSync(path.join(__dirname, "release-build.js"), "utf8");
  ok(
    "I: a BETA_HONESTY_GATE_BASELINE constant exists",
    /BETA_HONESTY_GATE_BASELINE\s*=\s*"\d{4}-\d{2}-\d{2}"/.test(src),
    "(baseline constant not found)",
  );
  ok(
    "I: default runner passes --since with the baseline",
    /"--since",\s*\n?\s*BETA_HONESTY_GATE_BASELINE/.test(src),
    "(--since baseline wiring not found)",
  );
}

process.stdout.write(`\n${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
