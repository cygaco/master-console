#!/usr/bin/env node
"use strict";

/**
 * Self-test for the artifact-contract validator (S0.2). Proves the validator
 * PASSES the valid fixtures and REJECTS each invalid one. The test names match
 * the `verified_by:` lines in the sprint's acceptance-criteria.md, and this
 * corpus doubles as S0.1's test corpus
 * (β EVT-sp20260530-001-before-plan-beta-001).
 *
 * Exit 0 iff every test passes; non-zero otherwise (fail-closed).
 *   node scripts/contracts/test-validate-artifact.js
 */

const fs = require("fs");
const path = require("path");
const V = require("./validate-artifact");

const FIX = path.join(__dirname, "fixtures");
const reg = V.loadSchemas(V.DEFAULT_SCHEMAS_DIR);

const load = (rel) => JSON.parse(fs.readFileSync(path.join(FIX, rel), "utf8"));
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const DOWNSTREAM = [
  "offer_brief",
  "conversion_brief",
  "design_brief",
  "build_spec",
  "converting_artifact",
];

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// AC-1.1
test("schemas-valid-and-declare-contract-meta", () => {
  const want = [
    "audience_dossier",
    "message_brief",
    "offer_brief",
    "conversion_brief",
    "design_brief",
    "build_spec",
    "converting_artifact",
    "decision_record",
  ];
  for (const t of want) assert(reg[t], `missing schema for ${t}`);
  for (const [t, s] of Object.entries(reg)) {
    assert(s.$id === `mc/contracts/${t}/v0.1`, `${t} bad $id: ${s.$id}`);
    assert(
      s.contract && typeof s.contract.owner_domain === "string",
      `${t} missing contract.owner_domain`,
    );
    assert(Array.isArray(s.contract.consumers), `${t} missing contract.consumers[]`);
    assert("precedence" in s.contract, `${t} missing contract.precedence`);
  }
});

// AC-1.2
test("downstream-requires-message_brief-ref", () => {
  for (const t of DOWNSTREAM) {
    assert(
      (reg[t].required || []).includes("derived_from_message_brief"),
      `${t} must require derived_from_message_brief`,
    );
  }
  assert(
    !(reg.message_brief.required || []).includes("derived_from_message_brief"),
    "message_brief must NOT require derived_from_message_brief (it IS the spine)",
  );
  assert(
    !(reg.audience_dossier.required || []).includes("derived_from_message_brief"),
    "audience_dossier must NOT require derived_from_message_brief (it is upstream)",
  );
});

// AC-2.1
test("decision-record-valid-and-rejects-missing", () => {
  const okv = V.validateInput(load("valid/decision-record.json"), reg);
  assert(okv.ok, `valid decision_record rejected: ${okv.errors}`);
  const bad = V.validateInput(
    load("invalid/missing-required-decision-record.json"),
    reg,
  );
  assert(!bad.ok, "missing-field decision_record should be rejected");
  assert(
    bad.errors.some((e) => e.includes("missing required field: rationale")),
    `expected missing rationale, got: ${bad.errors}`,
  );
});

// AC-3.1
test("unknown-type-rejected", () => {
  const r = V.validateInput(load("invalid/unknown-type.json"), reg);
  assert(!r.ok, "unknown type should be rejected (fail-closed)");
  assert(
    r.errors.some((e) => e.includes("unknown artifact type: frobnicate")),
    `expected unknown-type, got: ${r.errors}`,
  );
});

// AC-3.2
test("precedence-conflict-rejected", () => {
  const r = V.validateInput(load("invalid/precedence-conflict.json"), reg);
  assert(!r.ok, "precedence conflict should be rejected");
  assert(
    r.errors.some((e) => e.includes("precedence conflict")),
    `expected precedence-conflict, got: ${r.errors}`,
  );
});

// AC-3.3
test("dangling-message_brief-ref-rejected", () => {
  const r = V.validateInput(load("invalid/dangling-ref.json"), reg);
  assert(!r.ok, "dangling ref should be rejected");
  assert(
    r.errors.some((e) => e.includes("dangling message_brief reference")),
    `expected dangling-ref, got: ${r.errors}`,
  );
});

// AC-3.4
test("clean-chain-passes", () => {
  const r = V.validateInput(load("valid/clean-chain.json"), reg);
  assert(r.ok, `clean chain should pass, got: ${r.errors}`);
});

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log(`  PASS ${t.name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${t.name} — ${e.message}`);
    fail++;
  }
}
console.log(`\ncontract validator self-test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
