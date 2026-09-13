#!/usr/bin/env node
"use strict";

/**
 * Isolated P5 test for coverage-gate.js (N-1, the "sprint theater" killer).
 * Proves a backed ok:true record is the precondition for "covered", and every
 * theater pattern is caught: unbacked claim, ok:false, a Claude clone satisfying a
 * cross-provider obligation, a hand-authored phantom row, and a wrong-run record.
 *
 *   node scripts/dispatch/coverage-gate.test.js
 */

const { harness } = require("../checks/lib/fixture-harness");
const { evaluate: _evaluateRaw, parseExpect } = require("./coverage-gate");
const { ARGV_SCHEMA_VERSION } = require("./dispatch-contract");
const { signRecord } = require("./attest-signing");
// These fixture cases test the COVERAGE/backing logic on unsigned synthetic records, so they opt out of the
// SP-20260718-004 signature requirement (default requireSignature:false); the signature gate itself is
// exercised by the dedicated "R4 signed-gate" case below (and the gauntlet-verify-signing suite).
const evaluate = (o) => _evaluateRaw({ requireSignature: false, ...o });

const h = harness("coverage-gate");

const RUN = "run-abc";
// A realistic post-§17.4 record: backed + at the current schema + carrying
// output_digest (proof-of-artifact). Override per case.
function rec(over) {
  return {
    dispatch_id: "d-1",
    cmdline_checksum: "sha256:deadbeef",
    run_id: RUN,
    role: "x",
    provider: "openai",
    ok: true,
    argv_schema_version: ARGV_SCHEMA_VERSION,
    output_digest: "sha256:feedface00000000000000000000",
    ...over,
  };
}

// ── known-answer: complete, backed coverage passes ──────────
h.pass("all expected roles have ok:true backed records => covered", () =>
  evaluate({
    runId: RUN,
    records: [
      rec({ role: "frontend-builder", provider: "claude", dispatch_id: "d-b" }),
      rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-r" }),
    ],
    expected: [{ role: "frontend-builder" }, { role: "security-reviewer" }],
  }));

// ── PLANTED: unbacked coverage claim (no record) ────────────
h.violation("expected role with NO record is flagged (sprint theater)", () =>
  evaluate({ runId: RUN, records: [], expected: [{ role: "security-reviewer" }] }));

// ── PLANTED: a record exists but ok:false ───────────────────
h.violation("expected role whose only record is ok:false is NOT covered", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", ok: false })],
    expected: [{ role: "security-reviewer" }],
  }));

// ── PLANTED: a Claude clone satisfies a cross-provider role ──
h.violation("cross-provider reviewer satisfied by provider=claude is flagged (diversity)", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "claude", dispatch_id: "d-c" })],
    expected: [{ role: "security-reviewer" }],
  }));

// ── PLANTED: hand-authored phantom row (ok:true, no dispatch_id) ──
h.violation("a phantom ok:true row with no dispatch_id/cmdline_checksum is rejected", () =>
  evaluate({
    runId: RUN,
    records: [{ run_id: RUN, role: "security-reviewer", provider: "gemini", ok: true }],
    expected: [{ role: "security-reviewer" }],
  }));

// ── PLANTED: a record from a DIFFERENT run cannot satisfy ───
h.violation("a record from another run_id does NOT satisfy this run's coverage", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", run_id: "OTHER-RUN", dispatch_id: "d-o" })],
    expected: [{ role: "security-reviewer" }],
  }));

// ── PLANTED (§17.4): a current-schema backed ok:true record with NO artifact proof ──
h.violation("a record with no output_digest/artifact is blind coverage (rejected)", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-np", output_digest: null })],
    expected: [{ role: "security-reviewer" }],
  }));

// ── PLANTED (§17.4): a record stamped at a STALE/older schema version ──
h.violation("a record at a stale argv_schema_version does not satisfy coverage", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-sv", argv_schema_version: "0" })],
    expected: [{ role: "security-reviewer" }],
  }));

// ── PLANTED (§17.4): a record with NO argv_schema_version (pre-schema / backfill) ──
h.violation("a record with no argv_schema_version is stale/backfilled (rejected)", () => {
  const r = rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-ns" });
  delete r.argv_schema_version;
  return evaluate({ runId: RUN, records: [r], expected: [{ role: "security-reviewer" }] });
});

// ── PLANTED (§17.4): an unauditable waiver (no reason) ──
h.violation("a waiver with no reason is rejected (unauditable)", () =>
  evaluate({ runId: RUN, records: [], expected: [{ role: "security-reviewer", waiver: {} }] }));

// ── PLANTED (R-5 AC-5.1): a free-text reason WITHOUT provenance is rejected ──
// (provenance — operator/source + ts + auditable trail — is now REQUIRED; a
// reason-only waiver is the loophole this sprint closes.)
h.violation("a reason-only waiver (no operator/ts/trail) is rejected (provenance required)", () =>
  evaluate({ runId: RUN, records: [], expected: [{ role: "security-reviewer", waiver: { reason: "skip it" } }] }));

// ── PLANTED (§17.4): a named artifact the record does not carry ──
h.violation("a named artifact with no matching record digest is flagged", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "frontend-builder", provider: "claude", dispatch_id: "d-art" })],
    expected: [{ role: "frontend-builder", artifact: "runtime/x/out.md" }],
  }));

// ── known-answer (§17.4 + R-5 AC-5.1): a PROVENANCED waiver → waived, not missing ──
// (operator/source + ts + auditable trail required; reason alone no longer suffices.)
h.pass("a waiver WITH full provenance covers the role as waived", () =>
  evaluate({
    runId: RUN,
    records: [],
    expected: [
      {
        role: "security-reviewer",
        waiver: {
          reason: "no UI this sprint; design-quality N/A",
          operator: "alex",
          ts: "2026-06-11T12:00:00Z",
          ticket: "T-20260611-318",
        },
      },
    ],
  }));

// ── known-answer (§17.4): a named artifact whose digest is in the record → covered ──
h.pass("a named artifact whose digest is in the record => covered", () =>
  evaluate({
    runId: RUN,
    records: [
      rec({ role: "frontend-builder", provider: "claude", dispatch_id: "d-ok", artifacts: [{ path: "runtime/x/out.md", sha256: "sha256:abc" }] }),
    ],
    expected: [{ role: "frontend-builder", artifact: "runtime/x/out.md" }],
  }));

// ── parseExpect helper ──────────────────────────────────────
h.test("parseExpect parses role:shape pairs", () => {
  const e = parseExpect("frontend-builder:subprocess-claude,security-reviewer");
  if (e.length !== 2 || e[0].role !== "frontend-builder" || e[0].shape !== "subprocess-claude" || e[1].role !== "security-reviewer") {
    throw new Error(JSON.stringify(e));
  }
});

// ── T-303 (N8): run_id + sprint_id on records ───────────────
// A record stamped with run_id + sprint_id (via extended runContext()) passes
// when the coverage gate's runId scopes to that run_id.
h.pass("T-303 N8: record with run_id + sprint_id satisfies runId-scoped coverage", () =>
  evaluate({
    runId: RUN,
    records: [
      rec({
        role: "security-reviewer",
        provider: "gemini",
        dispatch_id: "d-n8",
        sprint_id: "SP-20260610-006",
        phase_id: "gauntlet",
      }),
    ],
    expected: [{ role: "security-reviewer" }],
  })
);

// PLANTED (N8): a record with run_id=null cannot satisfy a run-scoped check.
// This is the §17.4 fail-closed: null run_id means the dispatcher never exported
// MC_RUN_ID — the coverage gate must REJECT it under a live runId-scoped eval.
h.violation(
  "PLANTED T-303 N8: run_id=null under runId-scoped evaluate is filtered out (UNBACKED)",
  () =>
    evaluate({
      runId: RUN,
      records: [
        rec({
          role: "security-reviewer",
          provider: "gemini",
          dispatch_id: "d-nullrun",
          run_id: null,
        }),
      ],
      expected: [{ role: "security-reviewer" }],
    })
);

// ── SP-20260718-004 gauntlet R4: coverage-gate is a same-session choke-point reader — on the live path
//    (requireSignature default true) it REQUIRES a valid origin-proof signature, so a forged/unsigned
//    ok:true record cannot prove a role ran. ──
h.pass("R4 signed-gate: a validly SIGNED backed ok:true record satisfies coverage under requireSignature", () => {
  const r = rec({ role: "security-reviewer" });
  r.attest_sig = signRecord(r);
  return _evaluateRaw({ runId: RUN, records: [r], expected: [{ role: "security-reviewer" }], requireSignature: true });
});
h.violation(
  "R4 signed-gate: an UNSIGNED field-only ok:true record is REJECTED under requireSignature (forged liveness)",
  () =>
    _evaluateRaw({
      runId: RUN,
      records: [rec({ role: "security-reviewer" })],
      expected: [{ role: "security-reviewer" }],
      requireSignature: true,
    })
);

h.done();
