"use strict";
// FALSIFIER: AC-F2 self-asserted-success — record-trust gate, surface acceptance-record-at-integration.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..");
const MOD = path.join(ROOT, "scripts", "dispatch", "acceptance-record.js");

test("AC-F2 self-asserted success MUST-BLOCK integration (no trusted AcceptanceRecord)", (t) => {
  const { authorizesIntegration } = require(MOD);
  const envelope = { success: true, provider: "openai", role: "backend-builder" };
  const authorized = authorizesIntegration(envelope, "refs/heads/integration");
  assert.strictEqual(
    authorized,
    false,
    "MUST-BLOCK: a ResultEnvelope success with no trusted AcceptanceRecord must not authorize integration",
  );
});
