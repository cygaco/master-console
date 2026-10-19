#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const crypto = require("crypto");
const { harness } = require("../checks/lib/fixture-harness");
const { runContext } = require("../dispatch-agent");
const { evaluate } = require("./coverage-gate");
const { ARGV_SCHEMA_VERSION } = require("./dispatch-contract");
const { signRecord } = require("./attest-signing");

const h = harness("run-context");

h.test("runContext() returns sprint_id when MC_SPRINT_ID is set", () => {
  const prev = mcEnv.readEnv("SPRINT_ID");
  mcEnv.setEnv("SPRINT_ID", "SP-TEST-991");
  try {
    const ctx = runContext();
    if (ctx.sprint_id !== "SP-TEST-991") {
      throw new Error(`expected sprint_id='SP-TEST-991', got '${ctx.sprint_id}'`);
    }
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("SPRINT_ID");
    else mcEnv.setEnv("SPRINT_ID", prev);
  }
});

h.test("runContext() returns null sprint_id when MC_SPRINT_ID is unset", () => {
  const prev = mcEnv.readEnv("SPRINT_ID");
  mcEnv.unsetEnv("SPRINT_ID");
  try {
    const ctx = runContext();
    if (ctx.sprint_id !== null) {
      throw new Error(`expected sprint_id=null, got '${ctx.sprint_id}'`);
    }
  } finally {
    if (prev !== undefined) mcEnv.setEnv("SPRINT_ID", prev);
  }
});

h.test("runContext() returns run_id from MC_RUN_ID when set", () => {
  const prev = mcEnv.readEnv("RUN_ID");
  mcEnv.setEnv("RUN_ID", "run-test-00000001");
  try {
    const ctx = runContext();
    if (ctx.run_id !== "run-test-00000001") {
      throw new Error(`expected run_id='run-test-00000001', got '${ctx.run_id}'`);
    }
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("RUN_ID");
    else mcEnv.setEnv("RUN_ID", prev);
  }
});

h.test("generated run_id matches run-<base36>-<4-byte-hex> shape", () => {
  const runId = "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
  if (!/^run-[0-9a-z]+-[0-9a-f]{8}$/.test(runId)) {
    throw new Error(`run_id shape mismatch: '${runId}'`);
  }
});

h.test("inherited MC_RUN_ID is not overwritten by the generation guard", () => {
  const inherited = "run-inherited-aabbccdd";
  const prev = mcEnv.readEnv("RUN_ID");
  mcEnv.setEnv("RUN_ID", inherited);
  try {
    if (!mcEnv.readEnv("RUN_ID")) {
      mcEnv.setEnv("RUN_ID", "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex"));
    }
    const ctx = runContext();
    if (ctx.run_id !== inherited) {
      throw new Error(`inherited run_id overwritten: expected '${inherited}', got '${ctx.run_id}'`);
    }
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("RUN_ID");
    else mcEnv.setEnv("RUN_ID", prev);
  }
});

const RUN = "run-ctxtest-cafef00d";

function rec(over) {
  const record = {
    dispatch_id: "d-ctx-1",
    cmdline_checksum: "sha256:cafef00d",
    run_id: RUN,
    role: "security-reviewer",
    provider: "antigravity",
    ok: true,
    argv_schema_version: ARGV_SCHEMA_VERSION,
    output_digest: "sha256:feedface00000000",
    sprint_id: "SP-TEST-991",
    phase_id: "gauntlet",
    ...over,
  };
  record.attest_sig = signRecord(record);
  return record;
}

h.pass(
  "D: record stamped with run_id + sprint_id satisfies runId-scoped coverage",
  () =>
    evaluate({
      runId: RUN,
      records: [rec()],
      expected: [{ role: "security-reviewer" }],
    })
);

h.violation(
  "PLANTED: run_id=null under runId-scoped evaluate is filtered out (UNBACKED → FAIL)",
  () =>
    evaluate({
      runId: RUN,
      records: [rec({ run_id: null })],
      expected: [{ role: "security-reviewer" }],
    })
);

h.violation(
  "PLANTED: run_id from a different run is not counted for this runId (UNBACKED → FAIL)",
  () =>
    evaluate({
      runId: RUN,
      records: [rec({ run_id: "run-other-ffffffff" })],
      expected: [{ role: "security-reviewer" }],
    })
);

h.done();
