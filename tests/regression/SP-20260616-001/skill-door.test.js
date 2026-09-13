#!/usr/bin/env node
"use strict";

/**
 * skill-door.test.js — E-DISPATCH-SHAPE-001 W2-core (SP-20260616-001), AC-3.1/3.2/4.2.
 *
 * dispatch-skill is PINNED report-only (reportOnlyPin:true): the resolver routes {kind:skill} to
 * `inline` (skills are not earned-subprocess, §13.6/§13.7), so an enforce gate would false-refuse
 * EVERY skill dispatch (DoE-C1). The pin BEHAVIOR is proven in shape-door.test.js
 * (report-only-pin-never-refuses); here the wrapper WIRING + the ED-057 debt entry + the contract
 * docs are asserted.
 *
 *   node tests/regression/SP-20260616-001/skill-door.test.js
 */

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; fails.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// AC-3.1: dispatch-skill consults the door for the skill unit with reportOnlyPin:true.
// ED-057: the door call now passes its OWN shape "subprocess-skill" (added to the resolver
// SHAPES + resolveSkill returns it for an earned skill), not the build-chain "subprocess-claude".
const skillSrc = read("scripts/dispatch-skill.js");
ok("skill-report-only-pinned-under-enforce: dispatch-skill consults the door for {kind:skill}",
  /shapeDoor\(\s*"subprocess-skill",\s*\{\s*kind:\s*"skill",\s*id:\s*skill\s*\}/.test(skillSrc));
ok("skill-report-only-pinned-under-enforce: it passes reportOnlyPin:true (so enforce can never refuse a skill)",
  /reportOnlyPin:\s*true/.test(skillSrc));
// The dispatch-skill shape block never refuses (no process.exit in the door region).
const sIdx = skillSrc.indexOf("Shape-resolver self-detection");
const sSeg = skillSrc.slice(sIdx, sIdx + 900);
ok("dispatch-skill shape block never refuses (no process.exit near the door)", sIdx >= 0 && !/process\.exit/.test(sSeg));

// AC-3.2: the limitation is documented in COMMITTED sources (the enforcement-debt store is a
// gitignored local memory file, so the portable assertions are on the code comment + the guide).
ok("skill-enforce-limitation-documented: dispatch-skill.js references the ED-057 debt", /ED-057/.test(skillSrc));
ok("skill-enforce-limitation-documented: the dispatch guide names the subprocess-skill resolver gap",
  /subprocess-skill/.test(read(".claude/agents/_system/guides/agent-dispatch-guide.md")));

// AC-4.2: the contract docs are present (dispatch guide + epsilon.md).
const guide = read(".claude/agents/_system/guides/agent-dispatch-guide.md");
ok("contract-docs-present: dispatch guide documents MC_SHAPE_DOOR", /MC_SHAPE_DOOR/.test(guide));
ok("contract-docs-present: dispatch guide documents the MC_DISABLE_SHAPE_DOOR kill-switch", /MC_DISABLE_SHAPE_DOOR/.test(guide));
ok("contract-docs-present: dispatch guide documents the report-only-pinned skill limitation + ED-057", /report-only/.test(guide) && /ED-057/.test(guide));
const eps = read(".claude/agents/president/epsilon.md");
ok("contract-docs-present: epsilon.md documents the shape door", /MC_SHAPE_DOOR/.test(eps) && /shapeDoor/.test(eps));

console.log(`\n${failed === 0 ? "PASS" : "FAIL"} — skill-door: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
