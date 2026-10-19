"use strict";
// FALSIFIER: AC-F1 forged/unsigned WorkOrder — record-trust gate, surface workorder-at-dispatch.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "workorder-validator.js");

test("AC-F1 forged/unsigned WorkOrder MUST-BLOCK role resolution", (t) => {
  const { validate } = require(MOD);
  const forged = {
    schema_version: "1",
    correlation_id: "corr-forged",
    role: "backend-builder",
    provider: "claude",
    base_commit: "base-1",
    result_tree_hash: "tree-1",
    allowed_capabilities: ["read"],
    allowed_paths: ["scripts/"],
    terminal_state: "success",
  };
  const res = validate(forged);
  assert.strictEqual(res && res.ok, false, "MUST-BLOCK: forged/unsigned WorkOrder must return a structured rejection {ok:false}, not a pass/crash");
  assert.ok(res.reason && String(res.reason).length > 0, "MUST-BLOCK: the rejection must carry a reason (schema/authority failure)");
});
