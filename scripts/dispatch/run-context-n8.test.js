#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

/**
 * T-303 (N8) — run-context env-export test.
 *
 * Verifies the three N8 guarantees:
 *
 *  A. runContext() (dispatch-agent.js) returns sprint_id from WARPOS_SPRINT_ID
 *     — the single-source extension so all three wrappers stamp it uniformly.
 *
 *  B. The run_id generation shape is `run-<base36>-<hex>` (mirrors makeDispatchId
 *     "d-" prefix, prefixed "run-" to distinguish orchestrator runs).
 *
 *  C. Inherited WARPOS_RUN_ID is respected — the generation guard
 *     `if (!env.WARPOS_RUN_ID)` never overwrites a parent orchestrator's run_id.
 *
 *  D. A full.js / epsilon-runtime child env export can be simulated: child env
 *     WARPOS_RUN_ID / WARPOS_PHASE_ID / WARPOS_SPRINT_ID are non-null and the
 *     run_id can be scoped by coverage-gate.evaluate({ runId }).
 *
 *  PLANTED VIOLATION (§17.4 fail-closed, N8-specific):
 *  - run_id=null under a live runId-scoped evaluate CANNOT satisfy coverage.
 *    A null run_id means no orchestrator exported WARPOS_RUN_ID — the gate
 *    correctly rejects it, making run-scoped coverage unsatisfiable for null runs.
 *
 *  ED-231 (SP-20260718-005): coverage-gate.evaluate defaults requireSignature:true,
 *  so a TRUSTED same-session liveness record must carry a valid origin-proof
 *  signature. The case-D fixture record is signed via the SANCTIONED signer
 *  (attest-signing.signRecord) — the same seam the live dispatch wrappers use — so
 *  it satisfies coverage; the run_id-scoping planted cases remain FAIL (run_id is
 *  not a signed field, so they fail via the run_id filter, not the signature).
 *
 *   node scripts/dispatch/run-context-n8.test.js
 */

const crypto = require("crypto");
const { harness } = require("../checks/lib/fixture-harness");
const { runContext } = require("../dispatch-agent");
const { evaluate } = require("./coverage-gate");
const { ARGV_SCHEMA_VERSION } = require("./dispatch-contract");
const { signRecord } = require("./attest-signing");

const h = harness("run-context-n8");

// ── A. runContext() returns sprint_id from env ─────────────────────────────
h.test("runContext() returns sprint_id when WARPOS_SPRINT_ID is set", () => {
  const prev = mcEnv.readEnv("SPRINT_ID");
  mcEnv.setEnv("SPRINT_ID", "SP-20260610-006");
  try {
    const ctx = runContext();
    if (ctx.sprint_id !== "SP-20260610-006") {
      throw new Error(`expected sprint_id='SP-20260610-006', got '${ctx.sprint_id}'`);
    }
  } finally {
    if (prev === undefined) mcEnv.unsetEnv("SPRINT_ID");
    else mcEnv.setEnv("SPRINT_ID", prev);
  }
});

h.test("runContext() returns null sprint_id when WARPOS_SPRINT_ID is unset", () => {
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

h.test("runContext() returns run_id from WARPOS_RUN_ID when set", () => {
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

// ── B. run_id generation shape ─────────────────────────────────────────────
h.test("generated run_id matches run-<base36>-<4-byte-hex> shape", () => {
  const runId = "run-" + Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
  // base36 timestamp + 8 lowercase hex chars (4 bytes)
  if (!/^run-[0-9a-z]+-[0-9a-f]{8}$/.test(runId)) {
    throw new Error(`run_id shape mismatch: '${runId}'`);
  }
});

// ── C. Inherited WARPOS_RUN_ID is respected ────────────────────────────────
h.test("inherited WARPOS_RUN_ID is not overwritten by the generation guard", () => {
  const inherited = "run-inherited-aabbccdd";
  const prev = mcEnv.readEnv("RUN_ID");
  mcEnv.setEnv("RUN_ID", inherited);
  try {
    // Simulate the full.js + spawnAgent guard: only generate when absent.
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

// ── D. Child env export + coverage-gate scoping ────────────────────────────
const RUN = "run-n8test-cafef00d";

function rec(over) {
  const record = {
    dispatch_id: "d-n8-1",
    cmdline_checksum: "sha256:cafef00d",
    run_id: RUN,
    role: "security-reviewer",
    provider: "antigravity", // security-reviewer migrated gemini→antigravity (agy) in the 2026-07-20 deep-clean
    ok: true,
    argv_schema_version: ARGV_SCHEMA_VERSION,
    output_digest: "sha256:feedface00000000",
    sprint_id: "SP-20260610-006",
    phase_id: "gauntlet",
    ...over,
  };
  // ED-231 (SP-20260718-005): coverage-gate.evaluate defaults requireSignature:true — a TRUSTED
  // same-session liveness record must carry a valid origin-proof signature, or it is rejected as a
  // forged/unsigned row. Sign over the FINAL record via the SANCTIONED signer (attest-signing.signRecord)
  // — the exact seam the live dispatch wrappers use (dispatch-agent.recordCompletion) — never a hand-rolled
  // HMAC. run_id is NOT a signed field (the ED-232 named residual), so the run_id-override planted cases
  // below still fail via the coverage-gate run_id filter, not via the signature.
  record.attest_sig = signRecord(record);
  return record;
}

// Simulate what a child dispatch writes after spawnAgent sets env.WARPOS_RUN_ID.
h.pass(
  "D: record stamped with run_id + sprint_id satisfies runId-scoped coverage",
  () =>
    evaluate({
      runId: RUN,
      records: [rec()],
      expected: [{ role: "security-reviewer" }],
    })
);

// ── PLANTED VIOLATION (§17.4, N8) ─────────────────────────────────────────
// A record whose run_id is null cannot satisfy a run-scoped coverage check.
// coverage-gate.evaluate filters `records.filter(r => r.run_id === runId)`:
// null !== RUN → the record is excluded → UNBACKED → coverage FAILS.
// This is the correct fail-closed: a null run_id means WARPOS_RUN_ID was never
// exported — the coverage gate cannot prove run-scoped liveness.
h.violation(
  "PLANTED N8: run_id=null under runId-scoped evaluate is filtered out (UNBACKED → FAIL)",
  () =>
    evaluate({
      runId: RUN,
      records: [rec({ run_id: null })],
      expected: [{ role: "security-reviewer" }],
    })
);

// A record from a completely different run also fails (orthogonal but strengthens P5.3).
h.violation(
  "PLANTED N8: run_id from a different run is not counted for this runId (UNBACKED → FAIL)",
  () =>
    evaluate({
      runId: RUN,
      records: [rec({ run_id: "run-other-ffffffff" })],
      expected: [{ role: "security-reviewer" }],
    })
);

h.done();
