"use strict";

const test = require("node:test");
const assert = require("node:assert");

const mcEnv = require("./mc-env");

function freshGetOperatorContract() {
  delete require.cache[require.resolve("./project-config")];
  return require("./project-config").getOperatorContract;
}

test("canonical manifest block is honored when no env override is set", () => {
  const snap = mcEnv.snapshotEnv(["OPERATOR_CONTRACT", "OPERATOR_CONTRACT_ENABLED"]);
  try {
    mcEnv.unsetEnv("OPERATOR_CONTRACT");
    mcEnv.unsetEnv("OPERATOR_CONTRACT_ENABLED");
    const cfg = freshGetOperatorContract()();
    assert.strictEqual(cfg.enabled, true);
    assert.strictEqual(cfg.strictness, "strict");
    assert.strictEqual(cfg.maxLinesBeforeHeader, 5);
  } finally {
    mcEnv.restoreEnv(snap);
  }
});

test("env MC_OPERATOR_CONTRACT takes precedence over the manifest block", () => {
  const snap = mcEnv.snapshotEnv(["OPERATOR_CONTRACT", "OPERATOR_CONTRACT_ENABLED"]);
  try {
    mcEnv.setEnv("OPERATOR_CONTRACT", "advisory");
    const cfg = freshGetOperatorContract()();
    assert.strictEqual(cfg.strictness, "advisory");
  } finally {
    mcEnv.restoreEnv(snap);
  }
});

test("env MC_OPERATOR_CONTRACT=off also flips enabled to false", () => {
  const snap = mcEnv.snapshotEnv(["OPERATOR_CONTRACT", "OPERATOR_CONTRACT_ENABLED"]);
  try {
    mcEnv.setEnv("OPERATOR_CONTRACT", "off");
    const cfg = freshGetOperatorContract()();
    assert.strictEqual(cfg.strictness, "off");
    assert.strictEqual(cfg.enabled, false);
  } finally {
    mcEnv.restoreEnv(snap);
  }
});

test("a malformed env value is ignored (fail-open) — falls back to the manifest/default", () => {
  const snap = mcEnv.snapshotEnv(["OPERATOR_CONTRACT", "OPERATOR_CONTRACT_ENABLED"]);
  try {
    mcEnv.setEnv("OPERATOR_CONTRACT", "yolo-mode");
    const cfg = freshGetOperatorContract()();
    assert.strictEqual(cfg.strictness, "strict", "unrecognized env value must not override anything");
  } finally {
    mcEnv.restoreEnv(snap);
  }
});

test("MC_OPERATOR_CONTRACT_ENABLED=0 disables regardless of strictness", () => {
  const snap = mcEnv.snapshotEnv(["OPERATOR_CONTRACT", "OPERATOR_CONTRACT_ENABLED"]);
  try {
    mcEnv.setEnv("OPERATOR_CONTRACT_ENABLED", "0");
    const cfg = freshGetOperatorContract()();
    assert.strictEqual(cfg.enabled, false);
  } finally {
    mcEnv.restoreEnv(snap);
  }
});

