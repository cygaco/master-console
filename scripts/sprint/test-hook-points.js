#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  STEPS,
  load,
  loadRoleIds,
  residencyOf,
  normalizeComposition,
  matchCondition,
  matchConditionReason,
  agentsForStep,
  compositionFromTickets,
  validate,
} = require("./hook-points");

const REGISTRY_PATH = path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "sprint-hook-points.json");
const ROLE_REGISTRY_PATH = path.resolve(__dirname, "..", "..", ".claude", "agents", "_org", "role-registry.json");

let passes = 0;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("Integration (shipped registry ↔ real role-registry):");
let REG;
{
  let roleIds;
  try {
    REG = load(REGISTRY_PATH);
    roleIds = loadRoleIds(ROLE_REGISTRY_PATH);
  } catch (e) {
    ok("load() + loadRoleIds() read the real files", false, e.message);
    console.log(`\nResults: ${passes} passed, ${failures} failed.`);
    process.exit(1);
  }
  ok("loadRoleIds() returns a non-trivial roster", Array.isArray(roleIds) && roleIds.length >= 15, `got ${roleIds && roleIds.length}`);
  const res = validate(REG, roleIds);
  ok("shipped sprint-hook-points.json VALIDATES against role-registry", res.ok, (res.errors || []).join(" | "));
  ok("every shipped row's role is a real role id", res.ok || !res.errors.some((e) => /not in role-registry/.test(e)), (res.errors || []).join(" | "));
}

console.log("\nmatchCondition:");
const fe = normalizeComposition({ unit_types: ["frontend"], max_risk: "high", domains: [] });
const be = normalizeComposition({ unit_types: ["backend"], max_risk: "low", domains: [] });
const mk = normalizeComposition({ unit_types: ["backend"], max_risk: "low", domains: ["marketing"] });
ok("'always' → true", matchCondition("always", fe) === true);
ok("unit_type match → true", matchCondition({ unit_type: ["frontend", "ui"] }, fe) === true);
ok("unit_type miss → false", matchCondition({ unit_type: ["backend"] }, fe) === false);
ok("risk_min met (high ≥ medium) → true", matchCondition({ risk_min: "medium" }, fe) === true);
ok("risk_min unmet (low < medium) → false", matchCondition({ risk_min: "medium" }, be) === false);
ok("risk_min with unknown composition risk → false (must declare)", matchCondition({ risk_min: "medium" }, normalizeComposition({})) === false);
ok("domain match → true", matchCondition({ domain: ["marketing", "copy"] }, mk) === true);
ok("domain miss → false", matchCondition({ domain: ["marketing"] }, be) === false);

console.log("\nagentsForStep (router, real registry):");
{
  const plan = agentsForStep("plan", {}, REG).map((r) => r.role);
  ok("plan (any comp) → director-of-product + product-lead", plan.includes("director-of-product") && plan.includes("product-lead"), plan.join(","));
  ok("plan rows are order-sorted", plan[0] === "director-of-product", plan.join(","));

  const designFE = agentsForStep("design", { unit_types: ["frontend"], max_risk: "high" }, REG).map((r) => r.role);
  ok("design(FE,high) includes product-lead (always)", designFE.includes("product-lead"), designFE.join(","));
  ok("design(FE,high) includes director-of-engineering (code)", designFE.includes("director-of-engineering"), designFE.join(","));
  ok("design(FE,high) includes design-lead (UI)", designFE.includes("design-lead"), designFE.join(","));
  ok("design(FE,high) includes quality-lead (risk≥med)", designFE.includes("quality-lead"), designFE.join(","));
  ok("design(FE,high) EXCLUDES copy-lead (no marketing domain)", !designFE.includes("copy-lead"), designFE.join(","));

  const designLowNoUI = agentsForStep("design", { unit_types: ["backend"], max_risk: "low" }, REG).map((r) => r.role);
  ok("design(BE,low) EXCLUDES design-lead + quality-lead", !designLowNoUI.includes("design-lead") && !designLowNoUI.includes("quality-lead"), designLowNoUI.join(","));

  const buildBE = agentsForStep("build", { unit_types: ["backend"] }, REG).map((r) => r.role);
  ok("build(BE) → backend-builder only", buildBE.length === 1 && buildBE[0] === "backend-builder", buildBE.join(","));

  const gauntletRelease = agentsForStep("gauntlet", { unit_types: ["frontend"], change: "release", blast: "major" }, REG).map((r) => r.role);
  ok("gauntlet(FE, release/major — the full-roster lock) includes qa-reviewer + security-reviewer", gauntletRelease.includes("qa-reviewer") && gauntletRelease.includes("security-reviewer"), gauntletRelease.join(","));
  ok("gauntlet(FE, release/major) includes frontend-reviewer + visual-review + design-quality (UI)", ["frontend-reviewer", "visual-review", "design-quality"].every((x) => gauntletRelease.includes(x)), gauntletRelease.join(","));
  ok("gauntlet(FE, release/major) EXCLUDES backend-reviewer", !gauntletRelease.includes("backend-reviewer"), gauntletRelease.join(","));

  const gauntletFE = agentsForStep("gauntlet", { unit_types: ["frontend"] }, REG).map((r) => r.role);
  ok("gauntlet(FE, no trailer) INCLUDES qa-reviewer + security-reviewer (un-enriched fails OPEN, never an empty gauntlet)", gauntletFE.includes("qa-reviewer") && gauntletFE.includes("security-reviewer"), gauntletFE.join(","));
  ok("gauntlet(FE, no trailer) still includes frontend-reviewer + visual-review + design-quality (UI, unaffected)", ["frontend-reviewer", "visual-review", "design-quality"].every((x) => gauntletFE.includes(x)), gauntletFE.join(","));
  ok("gauntlet(FE) EXCLUDES backend-reviewer", !gauntletFE.includes("backend-reviewer"), gauntletFE.join(","));

  const minorBugfixBE = agentsForStep("gauntlet", { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor" }, REG).map((r) => r.role);
  ok("gauntlet(backend, bugfix/minor) is EXACTLY [backend-reviewer]", minorBugfixBE.length === 1 && minorBugfixBE[0] === "backend-reviewer", minorBugfixBE.join(","));

  const minorBugfixNoUnit = agentsForStep("gauntlet", { unit_types: [], max_risk: "low", domains: [], change: "bugfix", blast: "minor" }, REG).map((r) => r.role);
  ok("fallback: gauntlet(no unit_type, bugfix/minor) is EXACTLY [qa-reviewer]", minorBugfixNoUnit.length === 1 && minorBugfixNoUnit[0] === "qa-reviewer", minorBugfixNoUnit.join(","));

  const securityTouch = agentsForStep("gauntlet", { unit_types: ["backend"], max_risk: "low", domains: [], change: "bugfix", blast: "minor", surfaces: ["security"] }, REG).map((r) => r.role);
  ok("security-reviewer fires on a security-surface hit regardless of blast/change", securityTouch.includes("security-reviewer"), securityTouch.join(","));
}

console.log("\nmatchCondition — new forms:");
{
  const bugfixMinor = normalizeComposition({ unit_types: ["backend"], change: "bugfix", blast: "minor" });
  const updateMajor = normalizeComposition({ unit_types: [], change: "update", blast: "major" });
  const secHit = normalizeComposition({ unit_types: ["backend"], change: "bugfix", blast: "minor", surfaces: ["security"] });
  const noUnit = normalizeComposition({ unit_types: [], change: "bugfix", blast: "minor" });

  ok("change match → true", matchCondition({ change: ["bugfix", "update"] }, bugfixMinor) === true);
  ok("change miss → false", matchCondition({ change: ["release"] }, bugfixMinor) === false);
  ok("blast match → true", matchCondition({ blast: ["minor"] }, bugfixMinor) === true);
  ok("blast miss → false", matchCondition({ blast: ["major"] }, bugfixMinor) === false);
  ok("risk_surface match → true", matchCondition({ risk_surface: ["security"] }, secHit) === true);
  ok("risk_surface miss (no surface declared) → false", matchCondition({ risk_surface: ["security"] }, bugfixMinor) === false);
  ok("unit_type_absent true when no unit_type → true", matchCondition({ unit_type_absent: true }, noUnit) === true);
  ok("unit_type_absent false when a unit_type is present → false", matchCondition({ unit_type_absent: true }, bugfixMinor) === false);
  ok("any: OR semantics (one sub matches) → true", matchCondition({ any: [{ change: ["release"] }, { blast: ["minor"] }] }, bugfixMinor) === true);
  ok("any: OR semantics (none match) → false", matchCondition({ any: [{ change: ["release"] }, { blast: ["major"] }] }, bugfixMinor) === false);
  ok("all: AND semantics (every sub matches) → true", matchCondition({ all: [{ change: ["update"] }, { blast: ["major"] }] }, updateMajor) === true);
  ok("all: AND semantics (one sub fails) → false", matchCondition({ all: [{ change: ["update"] }, { blast: ["minor"] }] }, updateMajor) === false);
  ok("nested any/all composes", matchCondition({ all: [{ change: ["bugfix"] }, { any: [{ blast: ["minor"] }, { blast: ["major"] }] }] }, bugfixMinor) === true);
  ok("un-enriched composition (no change/blast): change/blast fail OPEN, risk_surface stays closed", matchCondition({ change: ["bugfix"] }, normalizeComposition({})) && matchCondition({ blast: ["minor"] }, normalizeComposition({})) && !matchCondition({ risk_surface: ["security"] }, normalizeComposition({})));

  ok("unknown condition key → NEVER fires (fail-closed)", matchCondition({ some_typo: ["x"] }, bugfixMinor) === false);
  ok("unknown key inside 'any' never contributes a match", matchCondition({ any: [{ some_typo: ["x"] }] }, bugfixMinor) === false);
}

console.log("\nmatchConditionReason:");
{
  const enriched = normalizeComposition({ unit_types: ["backend"], change: "bugfix", blast: "minor" });
  const unenriched = normalizeComposition({ unit_types: ["backend"] });

  ok("'always' → 'always'", matchConditionReason("always", enriched) === "always");
  ok("a genuinely declared change value → 'value'", matchConditionReason({ change: ["bugfix"] }, enriched) === "value");
  ok("a genuine non-match → 'closed'", matchConditionReason({ change: ["release"] }, enriched) === "closed");
  ok(
    "un-enriched composition still FIRES (matchCondition unchanged, preserved) but is now attributed 'unknown-open', never 'value'",
    matchCondition({ change: ["release"] }, unenriched) === true && matchConditionReason({ change: ["release"] }, unenriched) === "unknown-open",
  );
  ok(
    "the same attribution holds for blast",
    matchCondition({ blast: ["major"] }, unenriched) === true && matchConditionReason({ blast: ["major"] }, unenriched) === "unknown-open",
  );
  ok(
    "an 'all' composite where one leaf only matched via unknown-open is itself attributed unknown-open",
    matchConditionReason({ all: [{ unit_type: ["backend"] }, { change: ["release"] }] }, unenriched) === "unknown-open",
  );
  ok(
    "an 'all' composite where every leaf matched on real values is attributed 'value'",
    matchConditionReason({ all: [{ unit_type: ["backend"] }, { change: ["bugfix"] }] }, enriched) === "value",
  );
  ok("'closed' stays 'closed' (no false attribution on a real non-match)", matchConditionReason({ risk_surface: ["security"] }, enriched) === "closed");

  const synthetic = { rows: [{ role: "qa-reviewer", step: "gauntlet", condition: { change: ["release"] }, mode: "block", order: 1 }] };
  const rowsUnenriched = agentsForStep("gauntlet", { unit_types: ["frontend"] }, synthetic);
  const qaRow = rowsUnenriched.find((r) => r.role === "qa-reviewer");
  ok("agentsForStep tags the un-enriched change-conditioned row matched_via:'unknown-open'", qaRow && qaRow.matched_via === "unknown-open", JSON.stringify(qaRow));

  const rowsEnriched = agentsForStep("gauntlet", { unit_types: ["frontend"], change: "release", blast: "major" }, synthetic);
  const qaRowEnriched = rowsEnriched.find((r) => r.role === "qa-reviewer");
  ok("agentsForStep tags a genuinely-enriched matching row matched_via:'value'", qaRowEnriched && qaRowEnriched.matched_via === "value", JSON.stringify(qaRowEnriched));
}

console.log("\nvalidate negative cases:");
const REAL_IDS = ["product-lead", "qa-reviewer", "frontend-builder", "director-of-product", "director-of-engineering", "design-lead", "quality-lead", "copy-lead", "backend-builder", "security-builder", "frontend-reviewer", "backend-reviewer", "security-reviewer", "visual-review", "design-quality", "ops-analyst"];
function baselineRows() {
  return [
    { role: "product-lead", step: "plan", condition: "always", mode: "advisory", order: 10 },
    { role: "product-lead", step: "design", condition: "always", mode: "block", order: 10 },
    { role: "frontend-builder", step: "build", condition: { unit_type: ["frontend"] }, mode: "block", order: 10 },
    { role: "qa-reviewer", step: "gauntlet", condition: "always", mode: "block", order: 10 },
    { role: "qa-reviewer", step: "release", condition: "always", mode: "block", order: 10 },
    { role: "ops-analyst", step: "retro", condition: "always", mode: "advisory", order: 10 },
  ];
}
{
  ok("baseline (all 6 steps) is valid", validate({ rows: baselineRows() }, REAL_IDS).ok);

  const unknownRole = baselineRows();
  unknownRole.push({ role: "ghost-agent", step: "plan", condition: "always", mode: "advisory", order: 99 });
  const r1 = validate({ rows: unknownRole }, REAL_IDS);
  ok("unknown role → FAIL", !r1.ok && r1.errors.some((e) => /not in role-registry/.test(e)));

  const badStep = baselineRows();
  badStep[0] = { ...badStep[0], step: "deploy" };
  ok("non-canonical step → FAIL", !validate({ rows: badStep }, REAL_IDS).ok);

  const badMode = baselineRows();
  badMode[0] = { ...badMode[0], mode: "maybe" };
  ok("bad mode → FAIL", validate({ rows: badMode }, REAL_IDS).errors.some((e) => /mode/.test(e)));

  const badCond = baselineRows();
  badCond[0] = { ...badCond[0], condition: { nonsense: true } };
  ok("malformed condition → FAIL", validate({ rows: badCond }, REAL_IDS).errors.some((e) => /malformed condition/.test(e)));

  const badRisk = baselineRows();
  badRisk[0] = { ...badRisk[0], condition: { risk_min: "extreme" } };
  ok("unknown risk_min → FAIL", validate({ rows: badRisk }, REAL_IDS).errors.some((e) => /unknown risk_min/.test(e)));

  const orphan = baselineRows().filter((r) => r.step !== "retro");
  ok("orphan step (retro missing) → FAIL", validate({ rows: orphan }, REAL_IDS).errors.some((e) => /orphan step/.test(e)));

  ok("rows not an array → FAIL", !validate({ rows: "nope" }, REAL_IDS).ok);

  const goodChange = baselineRows();
  goodChange[0] = { ...goodChange[0], condition: { any: [{ blast: ["major"] }, { change: ["update", "release"] }] } };
  ok("validate() accepts a well-formed any/change/blast composite", validate({ rows: goodChange }, REAL_IDS).ok, JSON.stringify(validate({ rows: goodChange }, REAL_IDS).errors));

  const goodAll = baselineRows();
  goodAll[0] = { ...goodAll[0], condition: { all: [{ change: ["bugfix"] }, { blast: ["minor"] }, { unit_type_absent: true }] } };
  ok("validate() accepts a well-formed all/unit_type_absent composite", validate({ rows: goodAll }, REAL_IDS).ok, JSON.stringify(validate({ rows: goodAll }, REAL_IDS).errors));

  const emptyAny = baselineRows();
  emptyAny[0] = { ...emptyAny[0], condition: { any: [] } };
  ok("empty 'any' → FAIL", validate({ rows: emptyAny }, REAL_IDS).errors.some((e) => /'any' must be a non-empty array/.test(e)));

  const badNestedChange = baselineRows();
  badNestedChange[0] = { ...badNestedChange[0], condition: { any: [{ change: ["not-a-real-value"] }] } };
  ok("unknown change value, even nested inside 'any' → FAIL", validate({ rows: badNestedChange }, REAL_IDS).errors.some((e) => /unknown change value/.test(e)));

  const badNestedBlast = baselineRows();
  badNestedBlast[0] = { ...badNestedBlast[0], condition: { all: [{ blast: ["catastrophic"] }] } };
  ok("unknown blast value, even nested inside 'all' → FAIL", validate({ rows: badNestedBlast }, REAL_IDS).errors.some((e) => /unknown blast value/.test(e)));
}

console.log("\nresidencyOf (real registry):");
{
  ok("alpha → persistent", residencyOf("alpha") === "persistent");
  ok("beta → persistent", residencyOf("beta") === "persistent");
  ok("epsilon → persistent", residencyOf("epsilon") === "persistent");
  ok("quality-lead → ephemeral (default — manager)", residencyOf("quality-lead") === "ephemeral");
  ok("director-of-engineering → ephemeral", residencyOf("director-of-engineering") === "ephemeral");
  ok("frontend-builder → ephemeral", residencyOf("frontend-builder") === "ephemeral");
  ok("unknown role → ephemeral (safe default)", residencyOf("ghost-role") === "ephemeral");
}

console.log("\ncompositionFromTickets:");
{
  const comp = compositionFromTickets([
    { type: "feature", unit_type: "frontend", risk_level: "medium" },
    { type: "feature", unit_type: "backend", risk_level: "high" },
    { type: "copy", risk_level: "low" },
  ]);
  ok("aggregates unit_types (frontend+backend)", comp.unit_types.includes("frontend") && comp.unit_types.includes("backend"), JSON.stringify(comp));
  ok("max_risk = highest across tickets (high)", comp.max_risk === "high", comp.max_risk);
  ok("type:'copy' implies the copy domain", comp.domains.includes("copy"), JSON.stringify(comp.domains));
  ok("empty tickets → empty composition", JSON.stringify(compositionFromTickets([])) === JSON.stringify({ unit_types: [], max_risk: "", domains: [] }));
  const gauntlet = agentsForStep("gauntlet", comp, REG).map((r) => r.role);
  ok("derived comp drives the router (FE+BE → both pod reviewers)", gauntlet.includes("frontend-reviewer") && gauntlet.includes("backend-reviewer"), gauntlet.join(","));
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
