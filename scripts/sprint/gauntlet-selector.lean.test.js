"use strict";

const test = require("node:test");
const assert = require("node:assert");

const gd = require("./gauntlet-decision");
const hookPoints = require("./hook-points");

const COMP_BE = { unit_types: ["backend"], max_risk: "low", domains: [] };
const COMP_FE = { unit_types: ["frontend"], max_risk: "low", domains: [] };

function fullRosterFor(composition) {
  return hookPoints.agentsForStep("gauntlet", {
    ...composition,
    change: "release",
    blast: "major",
    surfaces: [...new Set([...(composition.surfaces || []), "security"])],
  });
}

function mkInput(over = {}) {
  const composition = over.composition || COMP_BE;
  return {
    trailer: { change: "bugfix", blast: "minor", risks: ["none"], source: "ticket" },
    composition,
    focused: { files: ["scripts/app/add.js"], tests: ["scripts/app/add.test.js"] },
    touchpoint: { files: [], tests: [], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [] },
    security: { hit: false, by: [] },
    goldenTouched: { touched: false, features: [] },
    goldenSmokeFloor: [],
    sprintOrdinal: 5,
    sprint: "SP-FIXTURE-LEAN",
    run_id: "run-fixture-lean",
    base: "aaaaaaa",
    head: "bbbbbbb",
    fullRoster: fullRosterFor(composition),
    ...over,
  };
}

const CASES = {
  "minor-bugfix": () => mkInput(),
  "release-major": () => mkInput({ trailer: { change: "release", blast: "major", risks: ["release-pipeline"], source: "ticket" } }),
  "security-hit": () => mkInput({ security: { hit: true, by: ["path:scripts/dispatch/sign.js"] } }),
  "unmapped-file": () =>
    mkInput({ touchpoint: { files: [], tests: [], depth: 1, unmapped: true, unmapped_files: ["scripts/x/new.js"], unresolved_hits: [] } }),
  "fourth-sprint": () => mkInput({ sprintOrdinal: 8 }),
};

const LEAN = { leanAuto: true };
const roles = (d) => d.stages.find((s) => s.stage === 4).roster.map((r) => r.role);
const stage = (d, n) => d.stages.find((s) => s.stage === n);

function ok(res) {
  assert.strictEqual(res.halt_reason, null, JSON.stringify(res));
  assert.ok(res.decision, "decision present");
  return res.decision;
}

test("leanAuto:true + eligible minor bugfix -> combined-focused, 2 dispatches (unit reviewer + qa, still narrower than full)", () => {
  const d = ok(gd.decideFromInput(CASES["minor-bugfix"](), LEAN));
  const full = ok(gd.decideFromInput(CASES["minor-bugfix"](), { leanAuto: false }));
  assert.strictEqual(d.package, "combined-focused");
  assert.strictEqual(d.budget.dispatches, 2, "unit reviewer + qa-reviewer (gap b)");
  assert.ok(d.budget.dispatches < full.budget.dispatches);
  assert.ok(d.budget.wall_ms < full.budget.wall_ms);
});

test("declared == executed per package (one-source invariant)", () => {
  for (const name of ["minor-bugfix", "security-hit"]) {
    const d = ok(gd.decideFromInput(CASES[name](), LEAN));
    if (d.package === "full") continue;
    const s1 = stage(d, 1);
    assert.ok(Array.isArray(s1.files), `${name}: a narrowed package's stage-1 files is a list`);
    assert.strictEqual(d.declared_tests.count, s1.files.length, `${name}: declared_tests.count must equal the executed stage-1 file count`);
    assert.strictEqual(d.declared_tests.scope, "focused+touchpoint", `${name}: declared_tests scope`);
  }
});

test("combined-focused non-test decision fields byte-unchanged by graph-reach (reviewers stay focused)", () => {
  const d = ok(gd.decideFromInput(CASES["minor-bugfix"](), LEAN));
  assert.strictEqual(d.package, "combined-focused");
  assert.strictEqual(d.cross_provider, false);
  assert.strictEqual(d.budget.dispatches, 2);
  const s4 = stage(d, 4);
  assert.strictEqual(s4.roster.length, 2, "two reviewers: unit + qa");
  for (const r of s4.roster) {
    assert.strictEqual(r.scope, "focused", `combined-focused reviewer ${r.role} must stay focused scope (the widening touched only the stage-1 TEST set)`);
    assert.deepStrictEqual(r.passes, ["primary"], `${r.role} single primary pass`);
  }
  assert.ok(s4.roster.some((r) => r.role === "qa-reviewer"), "qa-reviewer present (gap b)");
  const full = ok(gd.decideFromInput(CASES["minor-bugfix"](), { leanAuto: false }));
  assert.ok(d.budget.dispatches < full.budget.dispatches, "combined-focused stays cheaper than full");
});

test("leanAuto:true + release/major -> full", () => {
  assert.strictEqual(ok(gd.decideFromInput(CASES["release-major"](), LEAN)).package, "full");
});

test("leanAuto:true + security-surface hit -> stage 5 present, three passes", () => {
  const d = ok(gd.decideFromInput(CASES["security-hit"](), LEAN));
  assert.notStrictEqual(d.package, "full", "still a lean package");
  const s5 = stage(d, 5);
  assert.ok(s5 && s5.present === true, "stage 5 present");
  assert.deepStrictEqual(s5.roster[0].passes, ["primary", "second_pass", "third_pass"]);
  const sec = d.stages.find((s) => s.stage === 4).roster.find((r) => r.role === "security-reviewer");
  assert.deepStrictEqual(sec.passes, ["primary", "second_pass", "third_pass"]);
});

test("leanAuto:true + unmapped file -> full", () => {
  assert.strictEqual(ok(gd.decideFromInput(CASES["unmapped-file"](), LEAN)).package, "full");
});

test("leanAuto:true + fourth sprint -> full", () => {
  assert.strictEqual(ok(gd.decideFromInput(CASES["fourth-sprint"](), LEAN)).package, "full");
});

test("downgrade-blocked trailer -> halt (resolveGauntletDecision, lean on), never a decision", () => {
  const head = "fix: x\n\nChange: bugfix\nBlast: minor\nRisks: none\n";
  const git = (args) => {
    if (args[0] === "log") return head;
    throw new Error("unexpected git call after downgrade: " + args.join(" "));
  };
  const res = gd.resolveGauntletDecision(
    "SP-FIXTURE-LEAN",
    { ...COMP_BE, change: "update", blast: "major", risks: ["none"] },
    { root: process.cwd(), git, leanAuto: true },
  );
  assert.strictEqual(res.decision, null);
  assert.strictEqual(res.halt_reason, "change_trailer_downgraded");
  assert.ok(gd.HALT_REASONS.includes(res.halt_reason));
});

for (const [name, mk] of Object.entries(CASES)) {
  test(`leanAuto:false -> full for case "${name}"`, () => {
    assert.strictEqual(ok(gd.decideFromInput(mk(), { leanAuto: false })).package, "full");
  });
}

const FULL_ROLES_BE = ["backend-reviewer", "qa-reviewer", "security-reviewer"];
const FULL_ROLES_FE = ["frontend-reviewer", "qa-reviewer", "security-reviewer", "visual-review", "design-quality"];
const fullRows = (d) => d.stages.find((s) => s.stage === 4).roster;

test('packageMode:"full" -> full, roster roles == literal maximal set (even with leanAuto:true)', () => {
  for (const [name, mk] of Object.entries(CASES)) {
    const d = ok(gd.decideFromInput(mk(), { leanAuto: true, packageMode: "full" }));
    assert.strictEqual(d.package, "full", name);
    assert.deepStrictEqual(roles(d), FULL_ROLES_BE, name);
    for (const r of fullRows(d)) assert.ok(["value", "always"].includes(r.matched_via), `${name}/${r.role}: matched_via=${r.matched_via}`);
  }
  const fe = ok(gd.decideFromInput(mkInput({ composition: COMP_FE }), { leanAuto: true, packageMode: "full" }));
  assert.deepStrictEqual(roles(fe), FULL_ROLES_FE);
  for (const r of fullRows(fe)) assert.ok(["value", "always"].includes(r.matched_via), `fe/${r.role}: matched_via=${r.matched_via}`);
});

test("no-option call follows DEFAULTS.leanAuto (expectation computed from the constant)", () => {
  const d = ok(gd.decideFromInput(CASES["minor-bugfix"]()));
  assert.strictEqual(d.package, gd.DEFAULTS.leanAuto ? "combined-focused" : "full");
  const explicit = ok(gd.decideFromInput(CASES["minor-bugfix"](), { leanAuto: gd.DEFAULTS.leanAuto }));
  assert.strictEqual(d.package, explicit.package);
});

const CONSUMER_TEST = "scripts/app/report.test.js";
const withConsumer = (over) =>
  mkInput({
    focused: { files: ["scripts/lib/qz-normalize.js"], tests: [] },
    touchpoint: { files: ["scripts/app/report.js"], tests: [CONSUMER_TEST], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [] },
    ...over,
  });
const stageTests = (d) => d.stages.filter((s) => s.kind === "tests" && Array.isArray(s.files)).flatMap((s) => s.files);

test("gap (a): BOTH combined-focused and the touchpoint package execute the consumer's test (R-5 touchpoint-consumer fix)", () => {
  const cf = ok(gd.decideFromInput(withConsumer(), LEAN));
  assert.strictEqual(cf.package, "combined-focused");
  assert.ok(stageTests(cf).includes(CONSUMER_TEST), "combined-focused now executes the consumer's test");
  assert.deepStrictEqual(stage(cf, 1).files, [CONSUMER_TEST], "combined-focused stage-1 runs exactly focused UNION tp tests");
  const tp = ok(gd.decideFromInput(withConsumer({ trailer: { change: "update", blast: "minor", risks: ["none"], source: "ticket" } }), LEAN));
  assert.strictEqual(tp.package, "touchpoint");
  assert.strictEqual(tp.touchpoint.tests, 1, "the consumer test is known to the decision");
  assert.ok(stageTests(tp).includes(CONSUMER_TEST));
  assert.deepStrictEqual(stage(tp, 1).files, [CONSUMER_TEST]);
});

test("gap (b): a functional defect in a backend unit reaches qa-reviewer on combined-focused", () => {
  const d = ok(gd.decideFromInput(CASES["minor-bugfix"](), LEAN));
  assert.strictEqual(d.package, "combined-focused");
  assert.deepStrictEqual(roles(d), ["backend-reviewer", "qa-reviewer"]);
  assert.strictEqual(d.budget.dispatches, 2, "budget covers both reviewers");
});

const LEAN_TRAILERS = [
  ["combined-focused", { change: "bugfix", blast: "minor" }],
  ["touchpoint", { change: "update", blast: "minor" }],
  ["touchpoint", { change: "update", blast: "major" }],
];
const feInput = (t) => mkInput({ composition: COMP_FE, trailer: { ...t, risks: ["none"], source: "ticket" } });

test("gap (c): a frontend/ui unit's lean package schedules visual-review (every lean row)", () => {
  for (const [pkg, t] of LEAN_TRAILERS) {
    const d = ok(gd.decideFromInput(feInput(t), LEAN));
    assert.strictEqual(d.package, pkg);
    assert.ok(roles(d).includes("visual-review"), `${pkg}/${t.change}-${t.blast}`);
  }
  const be = ok(gd.decideFromInput(mkInput({ trailer: { change: "update", blast: "minor", risks: ["none"], source: "ticket" } }), LEAN));
  assert.ok(!roles(be).includes("visual-review"));
});

test("map_stale alone (unmapped false) -> full", () => {
  const d = ok(
    gd.decideFromInput(
      mkInput({ touchpoint: { files: [], tests: [], depth: 1, unmapped: false, unmapped_files: [], unresolved_hits: [], map_stale: true } }),
      LEAN,
    ),
  );
  assert.strictEqual(d.package, "full");
  assert.ok(d.reasons.includes("map_stale_fallback"), "audit reason kept");
});
