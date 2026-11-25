"use strict";

const test = require("node:test");
const assert = require("node:assert");

const full = require("./full");
const epsilonRuntime = require("./epsilon-runtime");
const gauntletDecision = require("./gauntlet-decision");

function patch(obj, key, fn) {
  const orig = obj[key];
  obj[key] = fn;
  return () => { obj[key] = orig; };
}

const FULL_DECISION = {
  schema: "x", sprint: "SP-FC", package: "full",
  stages: [{ stage: 4, name: "review", kind: "agents", roster: [{ role: "qa-reviewer", passes: ["primary"] }, { role: "backend-reviewer", passes: ["primary"] }] }],
  budget: { wall_ms: 1, dispatches: 2 }, reasons: ["x"],
};

test("row D: ε gauntlet step with no sprint id halts gauntlet_not_conducted:no_sprint_id", () => {
  const res = full.emitPhaseConsults(null, "execute", { epsilon: true });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.halt_reason, "gauntlet_not_conducted:no_sprint_id");
  assert.ok(Array.isArray(res.findings) && res.findings.length === 1);
  assert.deepStrictEqual(full.emitPhaseConsults(null, "plan", { epsilon: true }), { ok: true });
  assert.deepStrictEqual(full.emitPhaseConsults(null, "execute", {}), { ok: true });
});

test("row E: ε gauntlet step whose result is null halts gauntlet_not_conducted", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", () => ({ decision: FULL_DECISION, halt_reason: null, error: null }));
  const restoreConduct = patch(epsilonRuntime, "conductStep", () => null);
  try {
    const res = full.emitPhaseConsults("SP-FC-E", "execute", { epsilon: true });
    assert.strictEqual(res.ok, false, JSON.stringify(res));
    assert.strictEqual(res.halt_reason, "gauntlet_not_conducted");
  } finally { restoreConduct(); restoreResolve(); }
});

test("row A: explicit full override conducts WITH a full decision and emits the audit event", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", (sid, comp, o) => {
    assert.strictEqual(o.packageMode, "full");
    return { decision: FULL_DECISION, halt_reason: null, error: null };
  });
  const calls = [];
  const restoreConduct = patch(epsilonRuntime, "conductStep", (step, comp, sid, o) => {
    if (step === "gauntlet") calls.push(o);
    return { step, halt_reason: null, verify: { ok: true }, dispatched: [], stage_results: [] };
  });
  const events = [];
  try {
    const res = full.emitPhaseConsults("SP-FC-A", "execute", { epsilon: true, gauntletPackage: "full", emit: (k, d) => events.push([k, d]) });
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].gauntletDecision.package, "full");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0][0], "gauntlet-package-full-override");
    assert.deepStrictEqual(events[0][1].roles.sort(), ["backend-reviewer", "qa-reviewer"]);
    assert.strictEqual(events[0][1].package, "full");
  } finally { restoreConduct(); restoreResolve(); }
});

test("row A: full override + resolution failure halts gauntlet_resolution_refused:<reason>", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", () => ({ decision: null, halt_reason: "no_base", error: "no_base: x" }));
  let conducted = 0;
  const restoreConduct = patch(epsilonRuntime, "conductStep", (step) => { if (step === "gauntlet") conducted++; return { step, verify: { ok: true } }; });
  try {
    const res = full.emitPhaseConsults("SP-FC-A2", "execute", { epsilon: true, gauntletPackage: "full" });
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.halt_reason, "gauntlet_resolution_refused:no_base");
    assert.strictEqual(res.findings[0].override, "full");
    assert.strictEqual(conducted, 0);
  } finally { restoreConduct(); restoreResolve(); }
});

test("row B (U1b): resolution failure + forced-full resolve also fails halts gauntlet_resolution_refused, never conducts", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", () => ({ decision: null, halt_reason: "no_base", error: "no_base: x" }));
  let conducted = 0;
  const restoreConduct = patch(epsilonRuntime, "conductStep", (step) => { if (step === "gauntlet") conducted++; return { step, verify: { ok: true } }; });
  try {
    const res = full.emitPhaseConsults("SP-FC-B", "execute", { epsilon: true });
    assert.strictEqual(res.ok, false, JSON.stringify(res));
    assert.strictEqual(res.halt_reason, "gauntlet_resolution_refused:no_base");
    assert.strictEqual(conducted, 0);
  } finally { restoreConduct(); restoreResolve(); }
});

test("row B (U1b): resolution failure but forced-full resolves -> conducts WITH the full decision", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", (sid, comp, o) =>
    o && o.packageMode === "full" ? { decision: FULL_DECISION, halt_reason: null, error: null } : { decision: null, halt_reason: "no_base", error: "no_base: x" });
  const calls = [];
  const restoreConduct = patch(epsilonRuntime, "conductStep", (step, comp, sid, o) => { if (step === "gauntlet") calls.push(o); return { step, halt_reason: null, verify: { ok: true }, dispatched: [] }; });
  try {
    const res = full.emitPhaseConsults("SP-FC-B2", "execute", { epsilon: true, emit: () => {} });
    assert.strictEqual(res.ok, true, JSON.stringify(res));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].gauntletDecision.package, "full");
  } finally { restoreConduct(); restoreResolve(); }
});

test("row F: plan-only (verify:null, no epsilonDispatch) stays ok:true but self-identifies", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", () => ({ decision: FULL_DECISION, halt_reason: null, error: null }));
  const restoreConduct = patch(epsilonRuntime, "conductStep", (step) => ({ step, halt_reason: null, verify: null, dispatched: [], stage_results: [] }));
  try {
    const res = full.emitPhaseConsults("SP-FC-F", "execute", { epsilon: true });
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.findings, [{ kind: "conduct_mode:plan-only" }]);
  } finally { restoreConduct(); restoreResolve(); }
});

test("row G: dispatched gauntlet with verify null or absent halts gauntlet_not_verified", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", () => ({ decision: FULL_DECISION, halt_reason: null, error: null }));
  try {
    const bad = [null, {}, { ok: undefined }, { ok: false }, { ok: "true" }, { ok: 1 }];
    const mks = [(step) => ({ step, halt_reason: null, dispatched: [] }), ...bad.map((v) => (step) => ({ step, halt_reason: null, verify: v, dispatched: [] }))];
    for (const mk of mks) {
      const restoreConduct = patch(epsilonRuntime, "conductStep", mk);
      try {
        const res = full.emitPhaseConsults("SP-FC-G", "execute", { epsilon: true, epsilonDispatch: true });
        assert.strictEqual(res.ok, false, JSON.stringify(res));
        assert.strictEqual(res.halt_reason, "gauntlet_not_verified");
        assert.strictEqual(res.findings[0].kind, "gauntlet_not_verified");
      } finally { restoreConduct(); }
    }
    const restoreOk = patch(epsilonRuntime, "conductStep", (step) => ({ step, halt_reason: null, verify: { ok: true }, dispatched: [] }));
    try {
      assert.deepStrictEqual(full.emitPhaseConsults("SP-FC-G2", "execute", { epsilon: true, epsilonDispatch: true }), { ok: true });
    } finally { restoreOk(); }
  } finally { restoreResolve(); }
});

test("row C kept: a conduct throw returns exactly [findings, halt_reason, message, ok]", () => {
  const restoreResolve = patch(gauntletDecision, "resolveGauntletDecision", () => ({ decision: FULL_DECISION, halt_reason: null, error: null }));
  const restoreConduct = patch(epsilonRuntime, "conductStep", (step) => { if (step === "gauntlet") throw new Error("planted conduct throw"); return { step }; });
  try {
    const res = full.emitPhaseConsults("SP-FC-C", "execute", { epsilon: true });
    assert.strictEqual(res.ok, false);
    assert.deepStrictEqual(Object.keys(res).sort(), ["findings", "halt_reason", "message", "ok"]);
    assert.strictEqual(res.halt_reason, "conduct_threw:gauntlet");
  } finally { restoreConduct(); restoreResolve(); }
});

test("resolveGauntletDecision stays importable from full.js", () => {
  assert.strictEqual(typeof full.resolveGauntletDecision, "function");
});
