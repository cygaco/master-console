"use strict";
const test = require("node:test");
const assert = require("node:assert");
const {
  TERMINAL_STATES,
  FAILURE_REASON_CLASSES,
  DIGEST_FIELDS,
  validate,
  workOrderDigest,
} = require("./workorder-schema");

function baseWorkOrder(overrides = {}) {
  return {
    schema_version: "1",
    correlation_id: "corr-abc-123",
    role: "backend-builder",
    provider: "claude",
    model: "opus-4.8",
    base_commit: "a1b2c3d4",
    result_tree_hash: "tree-e5f6",
    allowed_capabilities: ["read", "write"],
    allowed_paths: ["scripts/dispatch/"],
    retry_lineage: [],
    evidence_refs: [],
    terminal_state: "success",
    ...overrides,
  };
}

test("TERMINAL_STATES is EXACTLY the 5 named states", () => {
  assert.deepStrictEqual(
    [...TERMINAL_STATES].sort(),
    ["blocked", "cancelled", "failed", "partial", "success"].sort(),
  );
});
test("FAILURE_REASON_CLASSES includes model_unavailable (the requested model is not available)", () => {
  assert.ok(FAILURE_REASON_CLASSES.includes("model_unavailable"));
});
test("FAILURE_REASON_CLASSES is EXACTLY the 6 named classes", () => {
  assert.deepStrictEqual(
    [...FAILURE_REASON_CLASSES].sort(),
    [
      "auth_missing",
      "model_unavailable",
      "provider_unavailable",
      "quota_exhausted",
      "timeout",
      "worktree_base_stale",
    ].sort(),
  );
});

test("terminal_state 'success' with NO failure_reason validates ok", () => {
  const res = validate(baseWorkOrder({ terminal_state: "success" }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
  assert.deepStrictEqual(res.errors, []);
});

for (const state of ["partial", "blocked", "failed", "cancelled"]) {
  for (const reason of FAILURE_REASON_CLASSES) {
    test(`terminal_state '${state}' + failure_reason '${reason}' round-trips valid`, () => {
      const res = validate(baseWorkOrder({ terminal_state: state, failure_reason: reason }));
      assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
    });
  }
}

test("terminal_state 'success' WITH a failure_reason present fails closed (contradiction)", () => {
  const res = validate(baseWorkOrder({ terminal_state: "success", failure_reason: "timeout" }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /failure_reason/i.test(e) && /success/i.test(e)));
});
test("a non-success terminal_state with NO failure_reason fails closed", () => {
  const res = validate(baseWorkOrder({ terminal_state: "failed" }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /failure_reason/i.test(e) && /required/i.test(e)));
});
test("failure_reason outside the CLASS taxonomy fails closed", () => {
  const res = validate(baseWorkOrder({ terminal_state: "failed", failure_reason: "not_a_real_class" }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /failure_reason/i.test(e) && /CLASS taxonomy/i.test(e)));
});

test("terminal_state outside the 5 fails closed", () => {
  const res = validate(baseWorkOrder({ terminal_state: "done" }));
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /terminal_state/i.test(e)));
});
test("terminal_state missing entirely fails closed", () => {
  const wo = baseWorkOrder();
  delete wo.terminal_state;
  const res = validate(wo);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => /terminal_state/i.test(e)));
});

for (const field of [
  "schema_version",
  "correlation_id",
  "role",
  "provider",
  "model",
  "base_commit",
  "result_tree_hash",
  "allowed_capabilities",
  "allowed_paths",
  "retry_lineage",
  "evidence_refs",
]) {
  test(`missing required field '${field}' fails closed`, () => {
    const wo = baseWorkOrder();
    delete wo[field];
    const res = validate(wo);
    assert.strictEqual(res.ok, false, `expected validate() to fail with '${field}' missing`);
    assert.ok(res.errors.some((e) => e.includes(`'${field}'`)), JSON.stringify(res.errors));
  });
}
test("a required string field present but empty/whitespace fails closed", () => {
  const res = validate(baseWorkOrder({ correlation_id: "   " }));
  assert.strictEqual(res.ok, false);
});
test("allowed_capabilities as a non-string-array (wrong element type) fails closed", () => {
  const res = validate(baseWorkOrder({ allowed_capabilities: [1, 2, 3] }));
  assert.strictEqual(res.ok, false);
});
test("retry_lineage/evidence_refs as non-arrays fail closed", () => {
  const res1 = validate(baseWorkOrder({ retry_lineage: "not-an-array" }));
  assert.strictEqual(res1.ok, false);
  const res2 = validate(baseWorkOrder({ evidence_refs: "not-an-array" }));
  assert.strictEqual(res2.ok, false);
});
test("empty retry_lineage/evidence_refs arrays are VALID (a first attempt has no lineage/evidence yet)", () => {
  const res = validate(baseWorkOrder({ retry_lineage: [], evidence_refs: [] }));
  assert.strictEqual(res.ok, true, JSON.stringify(res.errors));
});

test("a hollow/empty workorder ({}) fails closed with a full error list", () => {
  const res = validate({});
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.length >= 10, `expected many errors for a hollow workorder, got ${res.errors.length}`);
});
test("null/array/non-object inputs fail closed without throwing", () => {
  assert.strictEqual(validate(null).ok, false);
  assert.strictEqual(validate(undefined).ok, false);
  assert.strictEqual(validate([]).ok, false);
  assert.strictEqual(validate("workorder").ok, false);
  assert.strictEqual(validate(42).ok, false);
});

test("workOrderDigest is deterministic (same input -> same digest)", () => {
  const wo = baseWorkOrder();
  const d1 = workOrderDigest(wo);
  const d2 = workOrderDigest(JSON.parse(JSON.stringify(wo)));
  assert.strictEqual(d1, d2);
  assert.match(d1, /^[0-9a-f]{64}$/);
});
test("workOrderDigest is independent of the input object's key insertion order", () => {
  const a = baseWorkOrder();
  const reordered = {};
  for (const k of Object.keys(a).reverse()) reordered[k] = a[k];
  assert.strictEqual(workOrderDigest(a), workOrderDigest(reordered));
});

for (const field of DIGEST_FIELDS) {
  test(`workOrderDigest CHANGES when immutable field '${field}' changes`, () => {
    const wo = baseWorkOrder();
    const d1 = workOrderDigest(wo);
    if (Array.isArray(wo[field])) {
      wo[field] = [...wo[field], "mutated-extra-entry"];
    } else {
      wo[field] = `${wo[field]}-mutated`;
    }
    const d2 = workOrderDigest(wo);
    assert.notStrictEqual(d1, d2, `digest must change when '${field}' changes`);
  });
}

test("workOrderDigest does NOT change when a MUTABLE (non-identity) field changes", () => {
  const wo = baseWorkOrder({ terminal_state: "success" });
  const d1 = workOrderDigest(wo);
  const wo2 = { ...wo, terminal_state: "failed", failure_reason: "timeout", retry_lineage: [{ attempt: 1 }], evidence_refs: ["ev-1"] };
  const d2 = workOrderDigest(wo2);
  assert.strictEqual(d1, d2, "terminal_state/failure_reason/retry_lineage/evidence_refs must not affect the digest");
});
test("workOrderDigest is stable over a hollow input (never throws) and still differs from a real one", () => {
  const dHollow = workOrderDigest({});
  assert.match(dHollow, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(dHollow, workOrderDigest(baseWorkOrder()));
});
