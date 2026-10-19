#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { evaluate, parkIfOneshot, buildSpecPrecedence } = require("./integration-seam-gate");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

const coherent = {
  feature: "auth",
  mode: "adhoc",
  builders: ["frontend-builder", "backend-builder"],
  shared_files: [
    {
      path: "src/lib/types.ts",
      edited_by: ["frontend-builder", "backend-builder"],
      reconciled_by: "gamma_integration",
      reconciliation: "BE shape kept; FE import updated",
    },
  ],
  type_contracts: [
    {
      name: "Session",
      produced_by: "backend-builder",
      consumed_by: ["frontend-builder"],
      producer_path: "src/lib/types.ts",
      consumer_paths: ["src/components/AuthGate.tsx"],
      shape_match: true,
    },
  ],
  seam_contracts: [
    { name: "auth-env", kind: "env", required_fields: ["JWT_SECRET"], present_fields: ["JWT_SECRET"] },
  ],
  smoke_test: "_requirements/04-features/auth/tests/integration.spec.ts",
  merge: { order: ["backend-builder", "frontend-builder"], conflict_policy: "producer-wins" },
};

test("coherent multi-builder manifest → applicable, 0 errors", () => {
  const r = evaluate({ manifest: clone(coherent) });
  assert.strictEqual(r.applicable, true, "should be applicable (2 builders)");
  assert.deepStrictEqual(r.errors, [], `expected clean, got: ${r.errors.join("; ")}`);
});

test("single-builder feature → applicable:false, 0 errors (N/A)", () => {
  const m = clone(coherent);
  m.builders = ["frontend-builder"];
  const r = evaluate({ manifest: m });
  assert.strictEqual(r.applicable, false, "single builder ⇒ N/A");
  assert.deepStrictEqual(r.errors, []);
});

test("shared file edited by both with no reconciliation → rejected", () => {
  const m = clone(coherent);
  delete m.shared_files[0].reconciled_by;
  delete m.shared_files[0].reconciliation;
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /shared-file-unreconciled: "src\/lib\/types\.ts"/.test(e)),
    `expected unreconciled-shared-file error, got: ${r.errors.join("; ")}`,
  );
});

test("consumed type with no producer → rejected", () => {
  const m = clone(coherent);
  delete m.type_contracts[0].produced_by;
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /consumed-type-no-producer: type "Session"/.test(e)),
    `expected no-producer error, got: ${r.errors.join("; ")}`,
  );
});

test("type shape mismatch (shape_match:false) → rejected", () => {
  const m = clone(coherent);
  m.type_contracts[0].shape_match = false;
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /type-shape-mismatch: FE-consumed type "Session"/.test(e)),
    `expected shape-mismatch error, got: ${r.errors.join("; ")}`,
  );
});

test("injected typeShapeResolver reporting mismatch overrides shape_match:true → rejected", () => {
  const r = evaluate({
    manifest: clone(coherent),
    typeShapeResolver: () => false,
  });
  assert.ok(
    r.errors.some((e) => /type-shape-mismatch/.test(e)),
    `expected resolver-driven shape-mismatch, got: ${r.errors.join("; ")}`,
  );
});

test("seam contract missing required field → rejected", () => {
  const m = clone(coherent);
  m.seam_contracts[0].required_fields = ["JWT_SECRET", "SESSION_TTL"];
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /seam-contract-missing-field: seam contract "auth-env" .* missing required field "SESSION_TTL"/.test(e)),
    `expected missing-field error, got: ${r.errors.join("; ")}`,
  );
});

test("multi-builder feature with no smoke test → rejected", () => {
  const m = clone(coherent);
  delete m.smoke_test;
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /smoke-test-absent: multi-builder feature "auth"/.test(e)),
    `expected smoke-absent error, got: ${r.errors.join("; ")}`,
  );
});

test("declared smoke test that does not resolve → rejected", () => {
  const r = evaluate({ manifest: clone(coherent), smokeResolver: () => false });
  assert.ok(
    r.errors.some((e) => /smoke-test-absent: declared smoke test .* does not resolve/.test(e)),
    `expected unresolved-smoke error, got: ${r.errors.join("; ")}`,
  );
});

test("merge order omitting a shared-file editor → rejected", () => {
  const m = clone(coherent);
  m.merge.order = ["backend-builder"];
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /merge-order-incoherent: "frontend-builder" edited a shared file but is absent from merge\.order/.test(e)),
    `expected merge-order-omits-editor error, got: ${r.errors.join("; ")}`,
  );
});

test("merge order naming an unknown builder → rejected", () => {
  const m = clone(coherent);
  m.merge.order = ["backend-builder", "frontend-builder", "ghost-builder"];
  const r = evaluate({ manifest: m });
  assert.ok(
    r.errors.some((e) => /merge-order-incoherent: merge\.order names "ghost-builder"/.test(e)),
    `expected unknown-builder error, got: ${r.errors.join("; ")}`,
  );
});

test("malformed manifest (not an object) → throws (fail-closed)", () => {
  assert.throws(() => evaluate({ manifest: null }), /not an object/);
  assert.throws(() => evaluate({ manifest: { feature: "x" } }), /missing required/);
});

test("oneshot conflict → parkIfOneshot emits a decision_record (owner gamma_integration, @prec=build_spec)", () => {
  const m = clone(coherent);
  m.mode = "oneshot";
  delete m.smoke_test;
  const r = evaluate({ manifest: m });
  assert.ok(r.errors.length, "fixture should have rejects");

  const calls = [];
  const fakeEmit = (o) => {
    calls.push(o);
    return { id: "dr-test-001", artifact_precedence: o.artifactPrecedence, ...o };
  };
  const rec = parkIfOneshot({ manifest: m, errors: r.errors, emitFn: fakeEmit });
  assert.ok(rec && rec.id === "dr-test-001", "expected an emitted record");
  assert.strictEqual(calls.length, 1, "emit called exactly once");
  assert.strictEqual(calls[0].owner, "gamma_integration", "owner must be gamma_integration");
  assert.strictEqual(calls[0].unit, "auth", "unit must be the feature");
  assert.strictEqual(calls[0].artifactPrecedence, buildSpecPrecedence(), "artifactPrecedence = build_spec rank");
  assert.ok(/build_spec\.precedence/.test(calls[0].precedenceBasis), "precedenceBasis cites build_spec precedence");
  assert.notStrictEqual(calls[0].arbitrationNeeded, false, "must not assert resolved (fail-closed default)");
});

test("adhoc conflict → parkIfOneshot is a no-op (no emit; live alpha/beta)", () => {
  const m = clone(coherent);
  delete m.smoke_test;
  const r = evaluate({ manifest: m });
  let called = false;
  const rec = parkIfOneshot({ manifest: m, errors: r.errors, emitFn: () => { called = true; return {}; } });
  assert.strictEqual(rec, null, "adhoc should not park");
  assert.strictEqual(called, false, "adhoc must not call emit");
});

test("clean oneshot run → no emit", () => {
  const m = clone(coherent);
  m.mode = "oneshot";
  const r = evaluate({ manifest: m });
  assert.deepStrictEqual(r.errors, []);
  let called = false;
  const rec = parkIfOneshot({ manifest: m, errors: r.errors, emitFn: () => { called = true; return {}; } });
  assert.strictEqual(rec, null);
  assert.strictEqual(called, false);
});

test("oneshot conflict via real emit writes a record under CLAUDE_PROJECT_DIR/runtime/arbitration", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "seam-arb-"));
  const prev = process.env.CLAUDE_PROJECT_DIR;
  delete require.cache[require.resolve("../arbitration/emit.js")];
  process.env.CLAUDE_PROJECT_DIR = tmp;
  try {
    const { emit } = require("../arbitration/emit.js");
    const m = clone(coherent);
    m.mode = "oneshot";
    m.feature = "pilot-feature";
    delete m.smoke_test;
    const r = evaluate({ manifest: m });
    const rec = parkIfOneshot({ manifest: m, errors: r.errors, emitFn: emit });
    assert.ok(rec && rec.id, "real emit returned a record");
    const out = path.join(tmp, "runtime", "arbitration", "pilot-feature", rec.id + ".json");
    assert.ok(fs.existsSync(out), `expected record on disk at ${out}`);
    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.strictEqual(written.owner, "gamma_integration");
    assert.strictEqual(written.arbitration_needed, true, "fail-closed default park");
    assert.strictEqual(written.type, "decision_record");
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prev;
    delete require.cache[require.resolve("../arbitration/emit.js")];
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

if (failures.length) {
  process.stderr.write(`integration-seam bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(
  `integration-seam bite-test: ${passed}/${passed} passed (positive + N/A + 5 reject classes (incl. resolver/smoke/merge variants) + fail-closed + arbitration path incl. real-emit E2E)\n`,
);
process.exit(0);
