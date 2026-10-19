#!/usr/bin/env node
"use strict";

const { harness } = require("../checks/lib/fixture-harness");
const { evaluate: _evaluateRaw, parseExpect } = require("./coverage-gate");
const { ARGV_SCHEMA_VERSION } = require("./dispatch-contract");
const { signRecord } = require("./attest-signing");
const evaluate = (o) => _evaluateRaw({ requireSignature: false, ...o });

const h = harness("coverage-gate");

const RUN = "run-abc";
function rec(over) {
  return {
    dispatch_id: "d-1",
    cmdline_checksum: "sha256:deadbeef",
    run_id: RUN,
    role: "x",
    provider: "openai",
    ok: true,
    argv_schema_version: ARGV_SCHEMA_VERSION,
    output_digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ...over,
  };
}

h.pass("all expected roles have ok:true backed records => covered", () =>
  evaluate({
    runId: RUN,
    records: [
      rec({ role: "frontend-builder", provider: "claude", dispatch_id: "d-b" }),
      rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-r" }),
    ],
    expected: [{ role: "frontend-builder" }, { role: "security-reviewer" }],
  }));

h.violation("expected role with NO record is flagged (sprint theater)", () =>
  evaluate({ runId: RUN, records: [], expected: [{ role: "security-reviewer" }] }));

h.violation("expected role whose only record is ok:false is NOT covered", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", ok: false })],
    expected: [{ role: "security-reviewer" }],
  }));

h.violation("cross-provider reviewer satisfied by provider=claude is flagged (diversity)", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "claude", dispatch_id: "d-c" })],
    expected: [{ role: "security-reviewer" }],
  }));

h.violation("a phantom ok:true row with no dispatch_id/cmdline_checksum is rejected", () =>
  evaluate({
    runId: RUN,
    records: [{ run_id: RUN, role: "security-reviewer", provider: "gemini", ok: true }],
    expected: [{ role: "security-reviewer" }],
  }));

h.violation("a record from another run_id does NOT satisfy this run's coverage", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", run_id: "OTHER-RUN", dispatch_id: "d-o" })],
    expected: [{ role: "security-reviewer" }],
  }));

h.violation("a record with no output_digest/artifact is blind coverage (rejected)", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-np", output_digest: null })],
    expected: [{ role: "security-reviewer" }],
  }));

h.violation("a record at a stale argv_schema_version does not satisfy coverage", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-sv", argv_schema_version: "0" })],
    expected: [{ role: "security-reviewer" }],
  }));

h.violation("a record with no argv_schema_version is stale/backfilled (rejected)", () => {
  const r = rec({ role: "security-reviewer", provider: "gemini", dispatch_id: "d-ns" });
  delete r.argv_schema_version;
  return evaluate({ runId: RUN, records: [r], expected: [{ role: "security-reviewer" }] });
});

h.violation("a waiver with no reason is rejected (unauditable)", () =>
  evaluate({ runId: RUN, records: [], expected: [{ role: "security-reviewer", waiver: {} }] }));

h.violation("a reason-only waiver (no operator/ts/trail) is rejected (provenance required)", () =>
  evaluate({ runId: RUN, records: [], expected: [{ role: "security-reviewer", waiver: { reason: "skip it" } }] }));

h.violation("a named artifact with no matching record digest is flagged", () =>
  evaluate({
    runId: RUN,
    records: [rec({ role: "frontend-builder", provider: "claude", dispatch_id: "d-art" })],
    expected: [{ role: "frontend-builder", artifact: "runtime/x/out.md" }],
  }));

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
          ticket: "T-99999999-001",
        },
      },
    ],
  }));

h.pass("a named artifact whose digest is in the record => covered", () =>
  evaluate({
    runId: RUN,
    records: [
      rec({ role: "frontend-builder", provider: "claude", dispatch_id: "d-ok", artifacts: [{ path: "runtime/x/out.md", sha256: "sha256:abc" }] }),
    ],
    expected: [{ role: "frontend-builder", artifact: "runtime/x/out.md" }],
  }));

h.test("parseExpect parses role:shape pairs", () => {
  const e = parseExpect("frontend-builder:subprocess-claude,security-reviewer");
  if (e.length !== 2 || e[0].role !== "frontend-builder" || e[0].shape !== "subprocess-claude" || e[1].role !== "security-reviewer") {
    throw new Error(JSON.stringify(e));
  }
});

h.pass("record with run_id + sprint_id satisfies runId-scoped coverage", () =>
  evaluate({
    runId: RUN,
    records: [
      rec({
        role: "security-reviewer",
        provider: "gemini",
        dispatch_id: "d-runscoped",
        sprint_id: "SP-99999999-001",
        phase_id: "gauntlet",
      }),
    ],
    expected: [{ role: "security-reviewer" }],
  })
);

h.violation(
  "PLANTED: run_id=null under runId-scoped evaluate is filtered out (UNBACKED)",
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

h.pass("signed-gate: a validly SIGNED backed ok:true record satisfies coverage under requireSignature", () => {
  const r = rec({ role: "security-reviewer" });
  r.attest_sig = signRecord(r);
  return _evaluateRaw({ runId: RUN, records: [r], expected: [{ role: "security-reviewer" }], requireSignature: true });
});
h.violation(
  "signed-gate: an UNSIGNED field-only ok:true record is REJECTED under requireSignature (forged liveness)",
  () =>
    _evaluateRaw({
      runId: RUN,
      records: [rec({ role: "security-reviewer" })],
      expected: [{ role: "security-reviewer" }],
      requireSignature: true,
    })
);

h.done();
