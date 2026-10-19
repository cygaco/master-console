"use strict";
// FALSIFIER: AC-F4 target-mismatch / re-correlation — record-trust gate, surface acceptance-record-at-integration.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");

test("AC-F4 target-mismatch MUST-BLOCK integration (valid record for target A presented for target B)", (t) => {
  const { authorizesIntegration } = require(MOD);
  const recordForA = {
    workorder_digest: "wo-A",
    base_commit: "base-A",
    result_tree_hash: "tree-A",
    target_ref: "refs/heads/feature-A",
    terminal_state: "success",
  };
  const authorized = authorizesIntegration(recordForA, "refs/heads/feature-B");
  assert.strictEqual(
    authorized,
    false,
    "MUST-BLOCK: a valid AcceptanceRecord bound to target A must not authorize integration of target B (re-correlation)",
  );
});
