#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { evaluate, toItems } = require("./pl-build-spec-enforcer");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const reg = { build_spec: { contract: { precedence: 70 } } };

const cleanChain = () => ({ ok: true, errors: [] });
const dirtyChain = (errs) => () => ({ ok: false, errors: errs });

const mb = (id) => ({ type: "message_brief", id });
const db = (id, mbRef) => ({ type: "design_brief", id, derived_from_message_brief: mbRef });
const bs = (id, mbRef) => ({ type: "build_spec", id, derived_from_message_brief: mbRef });

test("coherent chain (build_spec + message_brief + design_brief, same spine) → 0 errors, 0 emits", () => {
  const items = [mb("m1"), db("d1", "m1"), bs("b1", "m1")];
  const { errors, emits } = evaluate({ items, validateChain: cleanChain, reg });
  assert.deepStrictEqual(errors, [], `expected no errors, got: ${errors.join("; ")}`);
  assert.strictEqual(emits.length, 0, `expected no emits, got: ${emits.map((e) => e.reason).join(",")}`);
});

test("contract violation (from validateChain) → rejected", () => {
  const items = [mb("m1"), bs("b1", "m1")];
  const { errors } = evaluate({
    items,
    validateChain: dirtyChain(["[1:build_spec] missing required field: acceptance_criteria"]),
    reg,
  });
  assert.ok(errors.some((e) => /contract:.*missing required field: acceptance_criteria/.test(e)),
    `expected delegated contract error, got: ${errors.join("; ")}`);
});

test("build_spec without its message_brief spine → rejected (missing-upstream)", () => {
  const items = [bs("b1", "m1")];
  const { errors } = evaluate({ items, validateChain: cleanChain, reg });
  assert.ok(errors.some((e) => /missing-upstream: build_spec#b1 has no message_brief/.test(e)),
    `expected missing-spine reject, got: ${errors.join("; ")}`);
});

test("build_spec deriving from an absent message_brief id → rejected (dangling spine)", () => {
  const items = [mb("m-OTHER"), bs("b1", "m1")];
  const { errors } = evaluate({ items, validateChain: cleanChain, reg });
  assert.ok(errors.some((e) => /derives from message_brief 'm1' which is absent/.test(e)),
    `expected dangling-spine reject, got: ${errors.join("; ")}`);
});

test("no build_spec in input → rejected (wrong-input, fail-closed)", () => {
  const items = [mb("m1"), db("d1", "m1")];
  const { errors } = evaluate({ items, validateChain: cleanChain, reg });
  assert.ok(errors.some((e) => /no build_spec present in the input/.test(e)),
    `expected wrong-input reject, got: ${errors.join("; ")}`);
});

test("build_spec & design_brief on DIFFERENT spines → emits arbitration (design-conflict)", () => {
  const items = [mb("m1"), mb("m2"), db("d1", "m2"), bs("b1", "m1")];
  const { errors, emits } = evaluate({ items, validateChain: cleanChain, reg });
  assert.deepStrictEqual(errors, [], `expected no hard reject, got: ${errors.join("; ")}`);
  const conflict = emits.find((e) => e.reason === "design-conflict");
  assert.ok(conflict, `expected a design-conflict emit, got: ${emits.map((e) => e.reason).join(",")}`);
  assert.ok(conflict.confidence < 0.5, "design-conflict is low-confidence (fail-closed park)");
  assert.strictEqual(conflict.artifactPrecedence, 70, "emit carries the build_spec precedence rank for bundle ordering");
});

test("build_spec + spine but no design_brief → emits arbitration (low-confidence, no guessed pass)", () => {
  const items = [mb("m1"), bs("b1", "m1")];
  const { errors, emits } = evaluate({ items, validateChain: cleanChain, reg });
  assert.deepStrictEqual(errors, [], `expected no hard reject, got: ${errors.join("; ")}`);
  const low = emits.find((e) => e.reason === "low-confidence-no-design-brief");
  assert.ok(low, `expected a low-confidence emit, got: ${emits.map((e) => e.reason).join(",")}`);
  assert.ok(low.confidence < 0.5, "low-confidence park is < 0.5 (never a guessed PASS)");
});

test("toItems normalizes single, array, and {chain}", () => {
  assert.strictEqual(toItems(bs("b1", "m1")).length, 1);
  assert.strictEqual(toItems([mb("m1"), bs("b1", "m1")]).length, 2);
  assert.strictEqual(toItems({ chain: [mb("m1"), bs("b1", "m1")] }).length, 2);
});

if (failures.length) {
  process.stderr.write(`pl-build-spec-enforcer bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`pl-build-spec-enforcer bite-test: ${passed}/${passed} passed (positive + contract + 2 missing-upstream + wrong-input rejects + 2 arbitration emits + sanity)\n`);
process.exit(0);
