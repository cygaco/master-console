#!/usr/bin/env node
"use strict";
const assert = require("assert");
const pv = require("./provenance-verifier");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test("RECOGNIZED_PROFILES is exactly [panel-3lab, panel-2family] and frozen", () => {
  assert.deepEqual([...pv.RECOGNIZED_PROFILES].sort(), ["panel-2family", "panel-3lab"]);
  assert.ok(Object.isFrozen(pv.RECOGNIZED_PROFILES), "the whitelist must be immutable");
});

test("panel-3lab + claude → in-process hunter contract (BINDING)", () => {
  const c = pv.laneContract("panel-3lab", "claude");
  assert.deepEqual(c, { shape: pv.IN_PROCESS_SHAPE, role: pv.HUNTER_ROLE, isHunter: true });
});

test("panel-2family + claude → subprocess-claude floor contract (FLOOR, still GREEN)", () => {
  const c = pv.laneContract("panel-2family", "claude");
  assert.deepEqual(c, { shape: pv.SUBPROCESS_CLAUDE_SHAPE, role: pv.PANEL_ROLE, isHunter: false });
});

test("recognized profiles + a cross-provider lane → cross-provider contract", () => {
  for (const profile of ["panel-3lab", "panel-2family"]) {
    for (const provider of ["openai", "antigravity"]) {
      const c = pv.laneContract(profile, provider);
      assert.deepEqual(c, { shape: pv.CROSS_PROVIDER_SHAPE, role: pv.PANEL_ROLE, isHunter: false }, `${profile}/${provider}`);
    }
  }
});

test("claudeLaneContract resolves both recognized profiles directly", () => {
  assert.equal(pv.claudeLaneContract("panel-3lab").isHunter, true);
  assert.equal(pv.claudeLaneContract("panel-2family").isHunter, false);
});

test("a typo'd profile + claude THROWS (does NOT resolve to the floor)", () => {
  assert.throws(() => pv.laneContract("panel-2famly", "claude"), /unrecognized panel profile|fail closed/i);
  let resolved = null;
  try { resolved = pv.laneContract("panel-2famly", "claude"); } catch { }
  assert.equal(resolved, null, "a typo'd profile must never resolve to a contract");
});

test("a typo'd profile + a cross-provider lane ALSO throws (no partial false-green)", () => {
  assert.throws(() => pv.laneContract("panel-2famly", "openai"), /unrecognized panel profile/i);
  assert.throws(() => pv.laneContract("panel-3lab-typo", "antigravity"), /unrecognized panel profile/i);
});

test("an unknown profile throws", () => {
  assert.throws(() => pv.laneContract("floor", "claude"), /unrecognized panel profile/i);
  assert.throws(() => pv.laneContract("panel-4lab", "claude"), /unrecognized panel profile/i);
});

test("an absent profile (undefined/null/empty) throws", () => {
  for (const bad of [undefined, null, ""]) {
    assert.throws(() => pv.laneContract(bad, "claude"), /unrecognized panel profile/i, `laneContract(${JSON.stringify(bad)})`);
    assert.throws(() => pv.claudeLaneContract(bad), /unrecognized panel profile/i, `claudeLaneContract(${JSON.stringify(bad)})`);
  }
});

test("claudeLaneContract fails closed on a typo (exported entry is guarded too)", () => {
  assert.throws(() => pv.claudeLaneContract("panel-2famly"), /unrecognized panel profile/i);
});

test("the fail-closed error names the offending profile and the recognized set", () => {
  try {
    pv.laneContract("bogus-profile", "claude");
    assert.fail("should have thrown");
  } catch (e) {
    assert.ok(/bogus-profile/.test(e.message), "error names the offending profile");
    assert.ok(/panel-3lab/.test(e.message) && /panel-2family/.test(e.message), "error lists the recognized profiles");
  }
});

if (failures.length) {
  process.stderr.write(`FAIL [provenance-verifier.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [provenance-verifier.test] ${passed} passed (unrecognized/absent profile fails closed; recognized floor+binding still resolve)\n`);
