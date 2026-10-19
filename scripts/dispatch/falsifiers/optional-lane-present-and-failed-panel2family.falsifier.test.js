"use strict";
// FALSIFIER: optional-lane-present-and-failed-panel2family — record-trust gate
const test = require("node:test");
const assert = require("node:assert");

test("optional-lane-present-and-failed-panel2family — an OPTIONAL agy lane on panel-2family that RAN and FAILED binds a non-PASS result (never silently dropped)", () => {
  const hr = require("../helm-runner");

  let integrateCalls = 0;
  const integrateFn = () => {
    integrateCalls++;
    return { ok: true, decision: "INTEGRATED", receipt: { committed_head: "r" } };
  };

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
    { laneId: "agy", provider: "antigravity", runResult: { hasEvidence: true, alive: true, verdict: "fail", observedProvider: "antigravity", fallback: false } },
  ];
  const res = hr.runHelms({ profile: "panel-2family", lanes, integrate: { base_commit: "b", result_commit: "r", target_ref: "refs/heads/x" } }, { integrateFn });

  assert.notStrictEqual(res.status, "PASS", "MUST-BLOCK: a PRESENT-and-FAILED optional lane must bind, never silently pass");
  assert.strictEqual(res.status, "FAIL");
  assert.strictEqual(res.panel.laneStatus.agy, "fail");
  assert.strictEqual(integrateCalls, 0, "no integration may be driven when an optional lane's real failure binds the panel");
  assert.strictEqual(res.integration, undefined);
});

test("optional-lane-present-and-failed-panel2family — a COERCED optional agy lane (fallback:true) is BLOCKED (present-is-not-proof), NOT 'ran and failed' — the two reasons stay distinct", () => {
  const hr = require("../helm-runner");

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
    { laneId: "agy", provider: "antigravity", runResult: { hasEvidence: true, alive: true, verdict: "fail", observedProvider: "openai", fallback: true } },
  ];
  const res = hr.runHelms({ profile: "panel-2family", lanes }, {});

  assert.notStrictEqual(res.status, "PASS", "MUST-BLOCK: a PRESENT-but-coerced optional lane is unprovable — present is not proof, and it must never be silently dropped into a PASS");
  assert.strictEqual(res.status, "BLOCKED-INCONCLUSIVE");
  assert.strictEqual(res.panel.laneStatus.agy, "coerced", "the lane's own status must record COERCION, not a proven failure");
  assert.ok(
    !/ran and failed/i.test(res.panel.reason),
    `the coerced reason must NOT be the 'ran and failed' path (coercion is non-proof, not a proven failure); got: ${res.panel.reason}`,
  );
  assert.ok(/coerced/i.test(res.panel.reason), `the reason must name the coercion; got: ${res.panel.reason}`);
});

test("optional-lane-present-and-failed-panel2family — a DEAD and a MALFORMED-verdict optional lane are EACH BLOCKED (non-PASS), never 'ran and failed', never dropped", () => {
  const hr = require("../helm-runner");

  const floor = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];

  for (const [label, runResult, expectedLaneStatus] of [
    ["DEAD (a record exists but the dispatch was reaped)", { hasEvidence: true, alive: false, verdict: "pass", observedProvider: "antigravity", fallback: false }, "dead"],
    ["MALFORMED verdict ('banana')", { hasEvidence: true, alive: true, verdict: "banana", observedProvider: "antigravity", fallback: false }, "refused-or-malformed"],
    ["ERROR/refused verdict ('error')", { hasEvidence: true, alive: true, verdict: "error", observedProvider: "antigravity", fallback: false }, "refused-or-malformed"],
    ["EMPTY verdict ('')", { hasEvidence: true, alive: true, verdict: "", observedProvider: "antigravity", fallback: false }, "refused-or-malformed"],
  ]) {
    let integrateCalls = 0;
    const integrateFn = () => {
      integrateCalls++;
      return { ok: true, decision: "INTEGRATED", receipt: { committed_head: "r" } };
    };
    const res = hr.runHelms(
      {
        profile: "panel-2family",
        lanes: [...floor, { laneId: "agy", provider: "antigravity", runResult }],
        integrate: { base_commit: "b", result_commit: "r", target_ref: "refs/heads/x" },
      },
      { integrateFn },
    );
    assert.notStrictEqual(res.status, "PASS", `MUST-BLOCK: a PRESENT optional lane that is ${label} must never be silently dropped into a PASS`);
    assert.strictEqual(res.status, "BLOCKED-INCONCLUSIVE", `${label} -> BLOCKED (unprovable), not FAIL`);
    assert.strictEqual(res.panel.laneStatus.agy, expectedLaneStatus, `${label} -> laneStatus.agy`);
    assert.ok(!/ran and failed/i.test(res.panel.reason), `${label}: the reason must NOT be the 'ran and failed' path; got: ${res.panel.reason}`);
    assert.strictEqual(integrateCalls, 0, `${label}: no integration may be driven from a non-PASS panel`);
  }
});

test("optional-lane-present-and-failed-panel2family — panel-lanes.js#panelStatus is the SINGLE reduction authority: helm-runner holds NO bolt-on optional reducer of its own", () => {
  const pl = require("../panel-lanes");
  const hr = require("../helm-runner");

  const profile = pl.getProfile(pl.loadManifest(), "panel-2family");
  const lanes = [
    { laneId: "gpt", contractedProvider: "openai", observedProvider: "openai", fallback: false, alive: true, verdict: "pass", hasEvidence: true },
    { laneId: "claude", contractedProvider: "claude", observedProvider: "claude", fallback: false, alive: true, verdict: "pass", hasEvidence: true },
    { laneId: "agy", contractedProvider: "antigravity", observedProvider: "antigravity", fallback: false, alive: true, verdict: "fail", hasEvidence: true },
  ];
  const direct = pl.panelStatus(profile, lanes, { agyOperatorOwned: true });
  assert.strictEqual(direct.status, "FAIL", "panelStatus ALONE must already bind the present-and-failed optional lane");
  assert.strictEqual(direct.laneStatus.agy, "fail");

  const viaRunner = hr.runHelms({
    profile: "panel-2family",
    lanes: lanes.map((l) => ({ laneId: l.laneId, provider: l.contractedProvider, runResult: { hasEvidence: l.hasEvidence, alive: l.alive, verdict: l.verdict, observedProvider: l.observedProvider, fallback: l.fallback } })),
  }, {});
  assert.strictEqual(viaRunner.status, direct.status, "the runner must consume panelStatus's verdict verbatim");
  assert.strictEqual(viaRunner.panel.reason, direct.reason, "the runner must not author a reason of its own");
});

test("optional-lane-present-and-failed-panel2family — CONTROL: an ABSENT agy lane on panel-2family still PASSES (only ABSENCE is tolerated, distinguishing this from the present-and-failed case above)", () => {
  const hr = require("../helm-runner");

  const lanes = [
    { laneId: "gpt", provider: "openai", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "openai", fallback: false } },
    { laneId: "claude", provider: "claude", runResult: { hasEvidence: true, alive: true, verdict: "pass", observedProvider: "claude", fallback: false } },
  ];
  const res = hr.runHelms({ profile: "panel-2family", lanes }, {});
  assert.strictEqual(res.status, "PASS");
});
