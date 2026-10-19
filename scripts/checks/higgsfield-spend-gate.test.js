#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { evaluate, CEILING_USD } = require("./higgsfield-spend-gate");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

const STUB_USD = { img2: 2, img1: 1, vid5: 5, vid8: 8 };
function stubCost(op) {
  if (!(op.jst in STUB_USD)) {
    throw new Error(`unknown job_set_type "${op.jst}"`);
  }
  const units = (op.input && op.input.batch_size) || 1;
  const usd = STUB_USD[op.jst] * units;
  return { jst: op.jst, usd, credits: usd * 16, kind: "image", units };
}

function makeEmitSpy() {
  const calls = [];
  const emit = (rec) => {
    calls.push(rec);
    return { ...rec, id: `dr-stub-${calls.length}`, type: "decision_record" };
  };
  return { emit, calls };
}

const deps = (over) => ({ cost: stubCost, mode: () => "solo", ...over });

test("single op < $5 → allow (exit 0)", () => {
  const r = evaluate({ ops: [{ jst: "img2" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.decision, "allow");
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.allowed.length, 1);
  assert.strictEqual(r.deferred.length, 0);
});

test("single op = $5 (at ceiling) → block (exit 1), op in blocked[]", () => {
  const r = evaluate({ ops: [{ jst: "vid5" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.decision, "block", `expected block, got ${r.decision} (${r.reason})`);
  assert.strictEqual(r.exitCode, 1);
  assert.strictEqual(r.allowed.length, 0, "ceiling op must NOT be allowed");
  assert.ok(
    r.blocked.some((p) => p.jst === "vid5"),
    "the ≥-ceiling op must appear in blocked[]",
  );
});

test("single op = $8 (over ceiling) → block (exit 1)", () => {
  const r = evaluate({ ops: [{ jst: "vid8" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.decision, "block");
  assert.strictEqual(r.exitCode, 1);
  assert.strictEqual(r.allowed.length, 0);
});

test("adhoc: 3× $2 ops → cap admits 2 ($4), defers 1 (exit 0)", () => {
  const r = evaluate({ ops: [{ jst: "img2" }, { jst: "img2" }, { jst: "img2" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.decision, "allow");
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.allowed.length, 2, `expected 2 admitted (cumulative $4 < $5), got ${r.allowed.length}`);
  assert.strictEqual(r.deferred.length, 1, "the 3rd op ($6 cumulative) must defer");
  assert.strictEqual(r.allowedUsd, 4);
  assert.deepStrictEqual(r.allowed.map((p) => p.idx), [0, 1]);
  assert.deepStrictEqual(r.deferred.map((p) => p.idx), [2]);
});

test("adhoc: cumulative cap is strict (< $5, not ≤) — $2+$2+$1 admits all 3 at $5? no: $4 then $1 → $5 defers", () => {
  const r = evaluate({ ops: [{ jst: "img2" }, { jst: "img2" }, { jst: "img1" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.allowed.length, 2, "cumulative $5 is not < $5, so the 3rd defers");
  assert.strictEqual(r.allowedUsd, 4);
  assert.strictEqual(r.deferred.length, 1);
});

test("adhoc: mixed — a ≥$5 op is blocked while sub-cap ops still admit", () => {
  const r = evaluate({ ops: [{ jst: "img2" }, { jst: "vid8" }, { jst: "img1" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.decision, "allow", "the cheap ops still clear");
  assert.strictEqual(r.allowed.length, 2);
  assert.strictEqual(r.allowedUsd, 3);
  assert.ok(r.blocked.some((p) => p.jst === "vid8"), "vid8 in blocked[]");
});

test("oneshot: full fan-out ≥ $5, no token → block (exit 1) + arbitration emitted, NO partial set", () => {
  const spy = makeEmitSpy();
  const r = evaluate(
    { ops: [{ jst: "img2" }, { jst: "img2" }, { jst: "img2" }], mode: "oneshot", unit: "u-ad-images" },
    deps({ emit: spy.emit, approvalPresent: () => false }),
  );
  assert.strictEqual(r.decision, "block", `expected block, got ${r.decision} (${r.reason})`);
  assert.strictEqual(r.exitCode, 1);
  assert.strictEqual(r.allowed.length, 0, "oneshot must NOT run a partial set");
  assert.strictEqual(r.deferred.length, 3, "the WHOLE set is parked");
  assert.strictEqual(spy.calls.length, 1, "exactly one arbitration emit");
  const rec = spy.calls[0];
  assert.strictEqual(rec.owner, "growth_spend_gate");
  assert.strictEqual(rec.arbitrationNeeded, true, "no token ⇒ fail-closed park (arbitrationNeeded:true)");
  assert.strictEqual(rec.unit, "u-ad-images");
  assert.ok(r.arbitration && r.arbitration.id, "decision carries the arbitration record id");
});

test("oneshot: full fan-out ≥ $5 WITH approval token → allow full set (exit 0), arbitration resolved", () => {
  const spy = makeEmitSpy();
  const r = evaluate(
    { ops: [{ jst: "img2" }, { jst: "img2" }, { jst: "img2" }], mode: "oneshot" },
    deps({ emit: spy.emit, approvalPresent: () => true }),
  );
  assert.strictEqual(r.decision, "allow", `expected allow with token, got ${r.decision} (${r.reason})`);
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.allowed.length, 3, "the FULL set is authorized (not a partial)");
  assert.strictEqual(r.allowedUsd, 6);
  assert.strictEqual(spy.calls.length, 1);
  assert.strictEqual(spy.calls[0].arbitrationNeeded, false, "token present ⇒ resolved, not parked");
});

test("oneshot: full fan-out < $5 → allow (exit 0), NO arbitration", () => {
  const spy = makeEmitSpy();
  const r = evaluate({ ops: [{ jst: "img2" }, { jst: "img1" }], mode: "oneshot" }, deps({ emit: spy.emit, approvalPresent: () => false }));
  assert.strictEqual(r.decision, "allow");
  assert.strictEqual(r.exitCode, 0);
  assert.strictEqual(r.allowed.length, 2);
  assert.strictEqual(spy.calls.length, 0, "under-ceiling oneshot needs no escalation");
});

test("oneshot: a single ≥$5 op forces escalation even within a small set", () => {
  const spy = makeEmitSpy();
  const r = evaluate({ ops: [{ jst: "vid5" }], mode: "oneshot" }, deps({ emit: spy.emit, approvalPresent: () => false }));
  assert.strictEqual(r.decision, "block");
  assert.strictEqual(r.exitCode, 1);
  assert.strictEqual(spy.calls.length, 1, "single ≥-ceiling op in oneshot still escalates");
});

test("unknown jst → internal-error (exit 2), decision=block, nothing allowed", () => {
  const r = evaluate({ ops: [{ jst: "ghost_model" }], mode: "adhoc" }, deps());
  assert.strictEqual(r.exitCode, 2, `expected exit 2 internal-error, got ${r.exitCode}`);
  assert.strictEqual(r.decision, "block", "unpriceable op must never be allowed");
  assert.strictEqual(r.allowed.length, 0);
  assert.ok(/cannot price/i.test(r.reason), `expected a price-failure reason, got: ${r.reason}`);
});

test("empty ops[] → internal-error (exit 2)", () => {
  const r = evaluate({ ops: [] }, deps());
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(r.decision, "block");
});

test("op missing jst → internal-error (exit 2)", () => {
  const r = evaluate({ ops: [{ input: {} }], mode: "adhoc" }, deps());
  assert.strictEqual(r.exitCode, 2);
  assert.strictEqual(r.decision, "block");
});

test("mode-aware: same ≥$5 fan-out → adhoc caps-then-defers, oneshot escalates", () => {
  const ops = [{ jst: "img2" }, { jst: "img2" }, { jst: "img2" }];
  const adhoc = evaluate({ ops, mode: "adhoc" }, deps());
  const spy = makeEmitSpy();
  const oneshot = evaluate({ ops, mode: "oneshot" }, deps({ emit: spy.emit, approvalPresent: () => false }));
  assert.strictEqual(adhoc.decision, "allow", "adhoc runs a safe partial");
  assert.strictEqual(adhoc.allowed.length, 2);
  assert.strictEqual(oneshot.decision, "block", "oneshot refuses the partial");
  assert.strictEqual(spy.calls.length, 1, "oneshot escalates; adhoc does not");
});

test("ceiling is $5 (CLAUDE.md ## Autonomy)", () => {
  assert.strictEqual(CEILING_USD, 5);
});

if (failures.length) {
  process.stderr.write(`higgsfield-spend-gate bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(
  `higgsfield-spend-gate bite-test: ${passed}/${passed} passed (positive + per-op ceiling block + adhoc cap-then-defer + oneshot emit+refuse + oneshot+token allow + fail-closed unknown-jst + mode-awareness)\n`,
);
process.exit(0);
