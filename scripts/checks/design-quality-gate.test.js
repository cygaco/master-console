#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { evaluate, runStaticLane } = require("./design-quality-gate");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const staticOK = { ran: true, exitCode: 0, ok: true, summary: "design-system: 0 finding(s)" };
const staticFail = { ran: true, exitCode: 2, ok: false, summary: "design-system: 3 finding(s) (strict)" };

function judgmentPass() {
  return {
    agent: "design-quality", verdict: "PASS", confidence: 0.9, unit: "u1",
    domain: "web-design", design_brief_ref: "db1",
    axes: {
      "design-tokens": { pass: true, findings: [] },
      "component-usage": { pass: true, findings: [] },
      "visual-hierarchy": { pass: true, findings: [] },
      "mobile-responsive": { pass: true, findings: [] },
      "accessibility": { pass: true, findings: [] },
      "design-handoff": { pass: true, findings: [] },
    },
    requiresHuman: false, recommendation: "PROCEED", rationale: "clean",
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const hasReason = (emits, r) => emits.some((e) => e.reason === r);

test("static OK + judgment PASS → PASS", () => {
  const out = evaluate({ staticLane: staticOK, judgment: judgmentPass(), designBrief: { id: "db1" } });
  assert.strictEqual(out.result, "PASS", `expected PASS, got ${out.result}: ${out.errors.join("; ")} / ${out.emits.map((e) => e.reason).join(",")}`);
});

test("static lane exit 2 → REJECT (static-fail)", () => {
  const out = evaluate({ staticLane: staticFail, judgment: judgmentPass(), designBrief: { id: "db1" } });
  assert.strictEqual(out.result, "REJECT", `expected REJECT, got ${out.result}`);
  assert.ok(out.errors.some((e) => /static-fail: lane 1 .* exited 2/.test(e)), out.errors.join("; "));
});

test("judgment verdict FAIL → REJECT (judgment-fail)", () => {
  const j = judgmentPass();
  j.verdict = "FAIL";
  j.axes["visual-hierarchy"] = { pass: false, findings: [{ axis: "visual-hierarchy", severity: "critical" }] };
  const out = evaluate({ staticLane: staticOK, judgment: j, designBrief: { id: "db1" } });
  assert.strictEqual(out.result, "REJECT", `expected REJECT, got ${out.result}`);
  assert.ok(out.errors.some((e) => /judgment-fail:.*verdict=FAIL.*visual-hierarchy/.test(e)), out.errors.join("; "));
});

test("judgment INVESTIGATE/requiresHuman → ARBITRATION (judgment-investigate)", () => {
  const j = judgmentPass();
  j.verdict = "FAIL";
  j.recommendation = "INVESTIGATE";
  j.requiresHuman = true;
  j.rationale = "design_brief missing; cannot judge hierarchy";
  const out = evaluate({ staticLane: staticOK, judgment: j, designBrief: null });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}`);
  assert.ok(hasReason(out.emits, "judgment-investigate"), out.emits.map((e) => e.reason).join(","));
});

test("no lane-2 judgment → ARBITRATION (missing-judgment, no regex-only pass)", () => {
  const out = evaluate({ staticLane: staticOK, judgment: null, designBrief: { id: "db1" } });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}`);
  assert.ok(hasReason(out.emits, "missing-judgment"), out.emits.map((e) => e.reason).join(","));
});

test("static lane unrunnable → ARBITRATION (static-lane-unrunnable)", () => {
  const out = evaluate({ staticLane: { ran: false, exitCode: null, ok: false }, judgment: judgmentPass(), designBrief: null });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}`);
  assert.ok(hasReason(out.emits, "static-lane-unrunnable"), out.emits.map((e) => e.reason).join(","));
});

test("judged design_brief != supplied → ARBITRATION (design-brief-contradiction)", () => {
  const j = judgmentPass();
  j.design_brief_ref = "db-OTHER";
  const out = evaluate({ staticLane: staticOK, judgment: j, designBrief: { id: "db1" } });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}`);
  assert.ok(hasReason(out.emits, "design-brief-contradiction"), out.emits.map((e) => e.reason).join(","));
});

test("unrecognized verdict → ARBITRATION (judgment-malformed)", () => {
  const j = judgmentPass(); j.verdict = "MAYBE";
  const out = evaluate({ staticLane: staticOK, judgment: j, designBrief: { id: "db1" } });
  assert.strictEqual(out.result, "ARBITRATION", `expected ARBITRATION, got ${out.result}`);
  assert.ok(hasReason(out.emits, "judgment-malformed"), out.emits.map((e) => e.reason).join(","));
});

test("static-fail + missing-judgment → REJECT wins (hard reject precedence)", () => {
  const out = evaluate({ staticLane: staticFail, judgment: null, designBrief: null });
  assert.strictEqual(out.result, "REJECT", `expected REJECT to win, got ${out.result}`);
});

test("runStaticLane returns a {ran,exitCode,ok} shape (no throw)", () => {
  const s = runStaticLane();
  assert.ok(typeof s === "object" && "ran" in s && "ok" in s, `unexpected shape: ${JSON.stringify(s)}`);
});

test("advisory: judgment FAIL → PASS (lane-2 downgraded to advisory)", () => {
  const j = judgmentPass(); j.verdict = "FAIL";
  j.axes["visual-hierarchy"] = { pass: false, findings: [{ axis: "visual-hierarchy", severity: "high" }] };
  const out = evaluate({ staticLane: staticOK, judgment: j, designBrief: { id: "db1" }, lane2Mode: "advisory" });
  assert.strictEqual(out.result, "PASS", `expected PASS (advisory), got ${out.result}`);
  assert.ok((out.advisories || []).some((a) => a.reason === "judgment-fail"), JSON.stringify(out.advisories));
});

test("advisory: static-fail still → REJECT (lane 1 always blocks)", () => {
  const out = evaluate({ staticLane: staticFail, judgment: judgmentPass(), designBrief: { id: "db1" }, lane2Mode: "advisory" });
  assert.strictEqual(out.result, "REJECT", `expected REJECT (lane 1 blocks even in advisory), got ${out.result}`);
});

test("advisory: missing judgment → PASS + advisory (no silent skip, no block)", () => {
  const out = evaluate({ staticLane: staticOK, judgment: null, designBrief: null, lane2Mode: "advisory" });
  assert.strictEqual(out.result, "PASS", `expected PASS (advisory), got ${out.result}`);
  assert.ok((out.advisories || []).some((a) => a.reason === "missing-judgment"), JSON.stringify(out.advisories));
});

if (failures.length) {
  process.stderr.write(`design-quality-gate bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`design-quality-gate bite-test: ${passed}/${passed} passed (positive + 2 reject classes + 5 arbitration emits + reject-precedence + sanity)\n`);
process.exit(0);
