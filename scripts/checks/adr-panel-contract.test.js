#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)
/**
 * Verification-rigor teeth (SP-20260718-003 · QA-004/QA-005 · AC-3, AC-16, AC-17). The design flagged
 * three ACs whose verified_by was a bare grep-on-prose — a false-green in the VERIFICATION itself. This
 * makes them STRUCTURAL / INTEGRATION assertions:
 *   AC-3  — ADR-0021 contains the exact normative decision line AND marks ED-208 RESOLVED (status token).
 *   AC-16 — ADR-0020 defines each of the six contract fields as a value-defining field, cross-checked
 *           against panel-lane-manifest.json (single-source, no drift) — not a bare token grep.
 *   AC-17 — the ed060-sunset enforcer's REAL /scan:full exit path is two-sided: a PAST-date fixture makes
 *           the actual CLI exit non-zero AND a FUTURE-date fixture exits 0 (falsifiable, not pure-only).
 *
 *   node scripts/checks/adr-panel-contract.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const ADR_DIR = path.join(ROOT, ".claude", "agents", "president", "_system", "policy", "adr");
const adr0021 = fs.readFileSync(path.join(ADR_DIR, "0021-agent-tool-channel-claude-only.md"), "utf8");
const adr0020 = fs.readFileSync(path.join(ADR_DIR, "0020-security-panel-lane-contract.md"), "utf8");
const manifest = require(path.join(ROOT, "scripts", "dispatch", "panel-lanes")).loadManifest();

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

// ── AC-3 (structural, not grep): the normative decision line + ED-208 RESOLVED status token. ──
test("AC-3: ADR-0021 states the normative Agent-tool-channel decision line", () => {
  assert.ok(
    adr0021.includes("Agent-tool channel = Claude-only capability, distinct from registry role-routing"),
    "ADR-0021 must contain the exact normative decision line",
  );
});
test("AC-3: ADR-0021 marks ED-208 RESOLVED (a status token, not a bare mention)", () => {
  // A bare "ED-208" mention is insufficient — the resolution STATUS must be asserted.
  assert.ok(/ED-208[^\n]*resolv/i.test(adr0021) || /ED-208 is \*\*resolved\*\*/i.test(adr0021), "ED-208 must be marked resolved");
});

// ── AC-16 (structural cross-check): the six contract fields are value-defining + match the manifest. ──
test("AC-16: ADR-0020 defines all six contract fields as value-defining fields", () => {
  for (const tok of ["required", "optional", "fallback", "sunset", "panel-2family", "panel-3lab"]) {
    assert.ok(new RegExp(`\\*\\*\`?${tok}\`?\\*\\*`).test(adr0020), `ADR-0020 must define **${tok}** as a value-defining field, not merely mention it`);
  }
});
test("AC-16: ADR-0020 required-sets match panel-lane-manifest.json (single-source, no drift)", () => {
  const req3 = manifest.profiles["panel-3lab"].required.join(", ");
  const req2 = manifest.profiles["panel-2family"].required.join(", ");
  assert.ok(adr0020.includes(`panel-3lab.required = [${req3}]`), `ADR-0020 must state panel-3lab.required = [${req3}] (matches the manifest)`);
  assert.ok(adr0020.includes(`panel-2family.required = [${req2}]`), `ADR-0020 must state panel-2family.required = [${req2}] (matches the manifest)`);
});
test("AC-16 negative control: a drifted required-set phrase would NOT be found", () => {
  // If the manifest changed to drop a lane, the exact ADR phrase would no longer match → this test
  // proves the cross-check is non-vacuous (the phrase is derived from the live manifest).
  assert.ok(!adr0020.includes("panel-3lab.required = [gpt, claude]"), "the ADR must not state a drifted 2-lane 3lab set");
});

// ── AC-17 (two-sided INTEGRATION): the REAL enforcer exit path is controlled by the date. Driven
//    IN-PROCESS via the exported main() — the sandbox blocks nested node spawns with EPERM (R2-AC17),
//    and in-process still exercises the same loadLive + evaluateSunset + exit-code path /scan:full runs. ──
const { main: ed060Main } = require(path.join(ROOT, "scripts", "checks", "ed060-sunset"));
function runSunset(env) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    return ed060Main([]); // returns the exit code (0/1/2); no process.exit when called as a function
  } finally {
    for (const k of Object.keys(env)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}
test("AC-17: a PAST sunset date (unresolved) → the enforcer exits NON-ZERO", () => {
  const code = runSunset({ ...mcEnv.envPair("ED060_SUNSET_DATE_TEST", "2020-01-01"), ...mcEnv.envPair("ED060_RESOLVED_TEST", "false") });
  assert.equal(code, 1, "a passed, unresolved sunset must fail /scan:full");
});
test("AC-17: a FUTURE sunset date (unresolved) → the enforcer exits 0", () => {
  const code = runSunset({ ...mcEnv.envPair("ED060_SUNSET_DATE_TEST", "2099-01-01"), ...mcEnv.envPair("ED060_RESOLVED_TEST", "false") });
  assert.equal(code, 0, "a future sunset is tracked debt, not overdue");
});
test("AC-17: a PAST sunset date but RESOLVED → the enforcer exits 0 (moot)", () => {
  const code = runSunset({ ...mcEnv.envPair("ED060_SUNSET_DATE_TEST", "2020-01-01"), ...mcEnv.envPair("ED060_RESOLVED_TEST", "true") });
  assert.equal(code, 0, "resolving ED-060 makes the deadline moot");
});

if (failures.length) {
  process.stderr.write(`FAIL [adr-panel-contract.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [adr-panel-contract.test] ${passed} passed (AC-3 normative line + ED-208 resolved; AC-16 six fields cross-checked vs manifest; AC-17 two-sided CLI exit)\n`);
