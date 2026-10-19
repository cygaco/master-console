#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluateGreekOfficeParity, hasGreek, isOffice } = require("./greek-office-parity");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
const has = (errs, sub) => errs.some((e) => e.includes(sub));

test("clean bijection → 0 findings", () => {
  const reg = { roles: {
    alpha: { home: "president", call_sign: "α" },
    cabinet: { home: "president", call_sign: "ζ" },
    "product-lead": { home: "product" },
    "backend-builder": { home: "engineering" },
  } };
  assert.deepStrictEqual(evaluateGreekOfficeParity(reg), [], "clean must be empty");
});

test("non-office role with a Greek call_sign → NAMING violation", () => {
  const reg = { roles: { "director-of-product": { home: "product", call_sign: "ζ" } } };
  const errs = evaluateGreekOfficeParity(reg);
  assert.ok(has(errs, "director-of-product") && has(errs, "President's office ONLY"), errs.join(" | "));
});

test("president-office role missing a Greek call_sign → NAMING violation", () => {
  const reg = { roles: { "ops-analyst": { home: "president" } } };
  const errs = evaluateGreekOfficeParity(reg);
  assert.ok(has(errs, "ops-analyst") && has(errs, "NO Greek call_sign"), errs.join(" | "));
});

test("hasGreek / isOffice", () => {
  assert.equal(hasGreek({ call_sign: "ε" }), true);
  assert.equal(hasGreek({ call_sign: "Q" }), false);
  assert.equal(hasGreek({}), false);
  assert.equal(isOffice({ home: "president" }), true);
  assert.equal(isOffice({ home: "growth" }), false);
});

test("live registry: clean — Greek ⟺ President's office bijection holds", () => {
  let out = "", code = 0;
  try {
    out = execFileSync("node", [path.join(__dirname, "greek-office-parity.js")], { encoding: "utf8" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
    code = e.status || 1;
  }
  assert.ok(code === 0, `expected the live check to be clean; got code=${code}: ${out}`);
});

if (failures.length) {
  process.stderr.write(`FAIL [greek-office-parity.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [greek-office-parity.test] ${passed} passed\n`);
