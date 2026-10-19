"use strict";
// FALSIFIER: acceptance-record-signature-drift — record-trust gate: the acceptance-record signature contract
const test = require("node:test");
const assert = require("node:assert");

test("acceptance-record-signature-drift — the REAL controller module loads clean (the live contract passes today)", () => {
  const ctl = require("../trusted-controller");
  assert.strictEqual(typeof ctl.integrate, "function");
  assert.strictEqual(typeof ctl.assertAcceptanceRecordContract, "function");
});

test("acceptance-record-signature-drift — a MISSING required export THROWS at contract-assert time", () => {
  const ctl = require("../trusted-controller");
  const real = require("../acceptance-record");

  const drifted = { ...real };
  delete drifted.authorizesIntegration;

  assert.throws(() => ctl.assertAcceptanceRecordContract(drifted), /contract drift/, "MUST-BLOCK: a missing export must throw before any integration is attempted");
});

test("acceptance-record-signature-drift — a NON-FUNCTION export (renamed to a value) THROWS", () => {
  const ctl = require("../trusted-controller");
  const real = require("../acceptance-record");

  const drifted = { ...real, commitIntegration: "not-a-function-anymore" };
  assert.throws(() => ctl.assertAcceptanceRecordContract(drifted), /contract drift/);
});

test("acceptance-record-signature-drift — a BEHAVIORALLY-NEUTERED produce() (never throws on a non-SHA base) is caught by the smoke, NOT fn.length", () => {
  const ctl = require("../trusted-controller");
  const real = require("../acceptance-record");

  const neuteredProduce = (input = {}) => ({ ...input, schema_version: "acceptance-record/v1", record_digest: "fake" });
  assert.strictEqual(neuteredProduce.length, real.produce.length, "the drifted stub must share the SAME arity as the real produce() — proving fn.length cannot distinguish them");

  const drifted = { ...real, produce: neuteredProduce };
  assert.throws(
    () => ctl.assertAcceptanceRecordContract(drifted),
    /no longer throws on a non-SHA base_commit/,
    "MUST-BLOCK: a produce() that silently accepts a non-SHA base_commit must be caught by the BEHAVIORAL smoke",
  );
});

test("acceptance-record-signature-drift — a BEHAVIORALLY-NEUTERED authorizesIntegration() (returns true for a bare envelope) THROWS", () => {
  const ctl = require("../trusted-controller");
  const real = require("../acceptance-record");

  const neuteredAuthz = (record, targetRef, opts = {}) => {
    void record;
    void targetRef;
    void opts;
    return true;
  };
  assert.strictEqual(neuteredAuthz.length, real.authorizesIntegration.length, "the drifted stub must share the SAME (undercounted) arity as the real authorizesIntegration() — proving fn.length cannot distinguish them");

  const drifted = { ...real, authorizesIntegration: neuteredAuthz };
  assert.throws(
    () => ctl.assertAcceptanceRecordContract(drifted),
    /authorizesIntegration\(bareEnvelope, ref\) did not return false/,
    "MUST-BLOCK: an always-true authorizesIntegration() must be caught",
  );
});
