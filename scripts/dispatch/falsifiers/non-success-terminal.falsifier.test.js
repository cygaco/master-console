"use strict";
// FALSIFIER: AC-F6 non-success-terminal-as-success — record-trust gate, surface acceptance-record-at-integration.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");

for (const nonSuccess of ["partial", "blocked", "failed", "cancelled"]) {
  test(`AC-F6 non-success terminal (${nonSuccess}) claiming success MUST-BLOCK integration`, (t) => {
    const { authorizesIntegration } = require(MOD);
    const record = {
      workorder_digest: "wo-X",
      base_commit: "base-X",
      result_tree_hash: "tree-X",
      target_ref: "refs/heads/integration",
      terminal_state: nonSuccess,
      envelope_claims_success: true,
    };
    const authorized = authorizesIntegration(record, "refs/heads/integration");
    assert.strictEqual(
      authorized,
      false,
      `MUST-BLOCK: a ${nonSuccess} WorkOrder must not authorize integration even when its envelope claims success`,
    );
  });
}
