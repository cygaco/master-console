#!/usr/bin/env node
"use strict";

const hookConsult = require("./hook-consult");
const epsilonRuntime = require("./epsilon-runtime");
const hookPoints = require("./hook-points");
const path = require("path");

const REAL_SEAMS = {
  registry: hookPoints.load(path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "sprint-hook-points.json")),
  roles: hookPoints.loadRoles(path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "role-registry.json")),
};

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const COMP = { unit_types: ["ui", "backend"], max_risk: "high", domains: [] };
const SPRINT_ID = "SP-FIXTURE-004";

function scriptPathEmissions() {
  const got = [];
  const logFn = (cat, data) => got.push({ cat, ...data });
  for (const step of ["build", "gauntlet"]) hookConsult.emitStepConsults(step, COMP, SPRINT_ID, logFn);
  hookConsult.emitDesignTouch(COMP, SPRINT_ID, logFn);
  return got;
}

function epsilonPathEmissions(dispatch) {
  const got = [];
  const logFn = (cat, data) => got.push({ cat, ...data });
  const dispatched = [];
  for (const step of ["build", "gauntlet"]) {
    const out = epsilonRuntime.conductStep(step, COMP, SPRINT_ID, { logFn, dispatch });
    dispatched.push(...out.dispatched);
  }
  return { got, dispatched };
}

const managers = (emissions) =>
  emissions.filter((e) => e.cat === "manager_consult").map((e) => e.manager).sort();
const hasDesignTouch = (emissions) =>
  emissions.some((e) => e.kind === "sprint_full_design_touch" && e.ui_touched === true);

console.log("(1) the ε path emits the SAME manager_consult coverage as the script path:");
{
  const script = scriptPathEmissions();
  const eps = epsilonPathEmissions(false).got;
  ok("manager sets are identical", JSON.stringify(managers(script)) === JSON.stringify(managers(eps)),
    `script=${managers(script).join(",")} | eps=${managers(eps).join(",")}`);
  ok("both emit the design-quality consult (design authority)", managers(eps).includes("design-quality"));
  ok("both emit the ui_touched design-touch (signal)", hasDesignTouch(script) && hasDesignTouch(eps));
}

console.log("\n(2) plan-only ε conduct adds NO dispatch records (coverage only):");
{
  const { dispatched } = epsilonPathEmissions(false);
  ok("no completion records written in plan-only mode", dispatched.length === 0);
}

console.log("\n(3) the design-touch loop is non-circular: a backend-only sprint emits none:");
{
  const got = [];
  const logFn = (cat, data) => got.push({ cat, ...data });
  const BE_RELEASE = { unit_types: ["backend"], max_risk: "low", domains: [], change: "release", blast: "major" };
  for (const step of ["build", "gauntlet"]) epsilonRuntime.conductStep(step, BE_RELEASE, SPRINT_ID, { logFn, dispatch: false });
  ok("backend-only ε conduct emits NO design-touch", !hasDesignTouch(got));
  ok("backend-only ε conduct (release/major — the full-roster lock) still emits the qa/security consults", managers(got).includes("qa-reviewer") && managers(got).includes("security-reviewer"));
}

console.log("\n(3b) an UN-ENRICHED backend-only sprint still pays qa+security (fail-open, never an empty gauntlet):");
{
  const plan = epsilonRuntime.planStep("gauntlet", { unit_types: ["backend"], max_risk: "low", domains: [] }, REAL_SEAMS);
  ok("un-enriched backend-only gauntlet INCLUDES qa-reviewer + security-reviewer (fail-open)", plan.block_roles.includes("qa-reviewer") && plan.block_roles.includes("security-reviewer"), plan.block_roles.join(","));
  ok("...and still includes backend-reviewer (unit_type-conditioned, unaffected)", plan.block_roles.includes("backend-reviewer"), plan.block_roles.join(","));
}

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
process.exit(failed === 0 ? 0 : 1);
