#!/usr/bin/env node
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  evaluate,
  evaluateCoverage,
  flipGate,
  loadFixtures,
  loadSupportMatrix,
  loadRoleBinding,
  validateRoleBinding,
  run,
  GATE_EVALUATORS,
} = require("./conformance-matrix");

const ROOT = path.resolve(__dirname, "..", "..");
const KERNEL_DIR = path.join(ROOT, ".claude", "kernel");

let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

test("run(): the real fixture corpus has zero mismatches against support-matrix.json", () => {
  const res = run();
  assert.strictEqual(res.mismatches.length, 0, JSON.stringify(res.mismatches));
  assert.ok(res.fixtureCount > 0, "expected a nonzero fixture count");
});

test("run(): the required agy-antigravity lane (not-verified) is surfaced in requiredDownLanes — never a silent pass", () => {
  const res = run();
  assert.ok(
    res.requiredDownLanes.some((d) => d.helm === "agy-antigravity" && d.status === "not-verified"),
    JSON.stringify(res.requiredDownLanes),
  );
  const agyFixture = res.results && res.results.find ? res.results.find((r) => r.id && r.id.includes("agy")) : null;
  void agyFixture;
});

test("run(): manifestCount matches the manifest.json 'count' field and the loaded fixture count", () => {
  const res = run();
  assert.strictEqual(res.manifestCount, res.fixtureCount, JSON.stringify(res));
});

test("run(): --coverage-equivalent (evaluateCoverage over the real corpus) reports zero gaps", () => {
  const supportMatrix = loadSupportMatrix(path.join(KERNEL_DIR, "support-matrix.json"));
  const fixturesDir = path.join(KERNEL_DIR, "fixtures");
  const fixtures = loadFixtures(fixturesDir);
  const cov = evaluateCoverage({ fixtures, supportMatrix });
  assert.ok(cov.ok, JSON.stringify(cov.gaps));
  for (const id of ["CORE-1", "CORE-2", "CORE-3", "CORE-4"]) {
    assert.ok(cov.coreCoverage[id] >= 1, `expected >=1 fixture bound to ${id}`);
  }
});

test("run(): the contract-lint + conformance-matrix-selftest corpora are EXCLUDED from the kernel-conformance walk", () => {
  const res = run();
  assert.strictEqual(res.fixtureCount, 13, `expected exactly 13 kernel-conformance fixtures, got ${res.fixtureCount}`);
});

test("role-binding evaluator: unbound dispatched worker -> BLOCK (CORE-1)", () => {
  const rb = { worker_default_when_unbound: "FAIL_CLOSED" };
  const out = GATE_EVALUATORS["role-binding"]({ actor_kind: "dispatched_worker" }, { roleBinding: rb });
  assert.strictEqual(out.outcome, "BLOCK");
});

test("role-binding evaluator: dispatched worker bound via validated_workorder_or_cli -> PASS", () => {
  const rb = {
    worker_default_when_unbound: "FAIL_CLOSED",
    sources: {
      explicit_user: { can_bind: true, applies_to_actor: ["top_level_session"] },
      validated_workorder_or_cli: { can_bind: true, applies_to_actor: ["dispatched_worker", "top_level_session"] },
      explicit_top_level_helm: { can_bind: true, applies_to_actor: ["top_level_session"] },
    },
  };
  const out = GATE_EVALUATORS["role-binding"](
    { actor_kind: "dispatched_worker", validated_workorder_or_cli_binding: "wo-123" },
    { roleBinding: rb },
  );
  assert.strictEqual(out.outcome, "PASS");
});

test("role-binding evaluator — dispatched worker presenting explicit_top_level_helm_binding -> BLOCK (category error, CORE-1)", () => {
  const rb = {
    worker_default_when_unbound: "FAIL_CLOSED",
    sources: {
      explicit_user: { can_bind: true, applies_to_actor: ["top_level_session"] },
      validated_workorder_or_cli: { can_bind: true, applies_to_actor: ["dispatched_worker", "top_level_session"] },
      explicit_top_level_helm: { can_bind: true, applies_to_actor: ["top_level_session"] },
    },
  };
  const out = GATE_EVALUATORS["role-binding"](
    { actor_kind: "dispatched_worker", explicit_top_level_helm_binding: true },
    { roleBinding: rb },
  );
  assert.strictEqual(out.outcome, "BLOCK", JSON.stringify(out));
});

test("role-binding evaluator — dispatched worker presenting explicit_user_instruction -> BLOCK (category error, CORE-1)", () => {
  const rb = {
    worker_default_when_unbound: "FAIL_CLOSED",
    sources: {
      explicit_user: { can_bind: true, applies_to_actor: ["top_level_session"] },
      validated_workorder_or_cli: { can_bind: true, applies_to_actor: ["dispatched_worker", "top_level_session"] },
      explicit_top_level_helm: { can_bind: true, applies_to_actor: ["top_level_session"] },
    },
  };
  const out = GATE_EVALUATORS["role-binding"](
    { actor_kind: "dispatched_worker", explicit_user_instruction: "build X" },
    { roleBinding: rb },
  );
  assert.strictEqual(out.outcome, "BLOCK", JSON.stringify(out));
});

test("role-binding evaluator — the SAME explicit_top_level_helm source PASSES for a top_level_session actor (only the actor-scope differs)", () => {
  const rb = {
    sources: {
      explicit_top_level_helm: { can_bind: true, applies_to_actor: ["top_level_session"] },
    },
  };
  const out = GATE_EVALUATORS["role-binding"](
    { attempted_binding_source: "explicit_top_level_helm" },
    { roleBinding: rb },
  );
  assert.strictEqual(out.outcome, "PASS", JSON.stringify(out));
});

test("run() — the real worker-helm-binding-category-error.json fixture executes clean (no mismatch)", () => {
  const res = run();
  const mismatch = res.mismatches.find((m) => m.id === "role-binding-worker-helm-binding-category-error");
  assert.strictEqual(mismatch, undefined, JSON.stringify(res.mismatches));
});

test("role-binding evaluator: agents_md cannot bind (CORE-3) -> BLOCK", () => {
  const rb = { sources: { agents_md: { can_bind: false }, helm: { can_bind: true } } };
  const out = GATE_EVALUATORS["role-binding"](
    { attempted_binding_source: "agents_md", claimed_role: "alex-alpha" },
    { roleBinding: rb },
  );
  assert.strictEqual(out.outcome, "BLOCK");
});

test("role-binding evaluator: helm CAN bind -> PASS", () => {
  const rb = { sources: { agents_md: { can_bind: false }, helm: { can_bind: true } } };
  const out = GATE_EVALUATORS["role-binding"]({ attempted_binding_source: "helm" }, { roleBinding: rb });
  assert.strictEqual(out.outcome, "PASS");
});

test("support-matrix evaluator: a required+down helm -> BLOCK", () => {
  const sm = { rows: { agy: { status: "down", required: true, proven: false, evidence_ref: "ED-999060" } } };
  const out = GATE_EVALUATORS["support-matrix"]({ helm: "agy" }, { supportMatrix: sm });
  assert.strictEqual(out.outcome, "BLOCK");
});

test("support-matrix evaluator: a supported+proven helm -> PASS", () => {
  const sm = { rows: { claude: { status: "supported", required: true, proven: true } } };
  const out = GATE_EVALUATORS["support-matrix"]({ helm: "claude" }, { supportMatrix: sm });
  assert.strictEqual(out.outcome, "PASS");
});

test("retention evaluator: archive disposition -> PASS; delete disposition -> BLOCK (CORE-4)", () => {
  assert.strictEqual(GATE_EVALUATORS.retention({ attempted_disposition: "archive" }).outcome, "PASS");
  assert.strictEqual(GATE_EVALUATORS.retention({ attempted_disposition: "delete" }).outcome, "BLOCK");
});

test("dispatch-honesty evaluator: passed status with zero evidence -> BLOCK (false-green)", () => {
  const out = GATE_EVALUATORS["dispatch-honesty"]({
    result_envelope: { status: "passed", files_changed: [], commits: [], tests_run: [], evidence_paths: [] },
  });
  assert.strictEqual(out.outcome, "BLOCK");
});

test("dispatch-honesty evaluator: passed status WITH evidence -> PASS", () => {
  const out = GATE_EVALUATORS["dispatch-honesty"]({
    result_envelope: { status: "passed", files_changed: ["a.js"], commits: ["abc"], tests_run: [{ cmd: "x" }], evidence_paths: ["p"] },
  });
  assert.strictEqual(out.outcome, "PASS");
});

test("dispatch-review evaluator: same-provider builder+reviewer -> BLOCK", () => {
  const out = GATE_EVALUATORS["dispatch-review"]({ builder_provider: "openai", reviewer_provider: "openai" });
  assert.strictEqual(out.outcome, "BLOCK");
});

test("dispatch-review evaluator: different-provider builder+reviewer -> PASS", () => {
  const out = GATE_EVALUATORS["dispatch-review"]({ builder_provider: "openai", reviewer_provider: "claude" });
  assert.strictEqual(out.outcome, "PASS");
});

test("evaluate(): a fixture whose expect disagrees with the evaluator's computed outcome is a mismatch", () => {
  const fixtures = [
    { id: "synthetic-1", gate: "retention", input: { attempted_disposition: "delete" }, expect: { outcome: "PASS" } },
  ];
  const res = evaluate({ fixtures, supportMatrix: { rows: {} }, roleBinding: {} });
  assert.strictEqual(res.mismatches.length, 1);
  assert.strictEqual(res.mismatches[0].computed, "BLOCK");
  assert.strictEqual(res.mismatches[0].expected, "PASS");
});

test("evaluate() throws (fail-closed) on an unrecognized gate name, never a reportable mismatch", () => {
  const fixtures = [{ id: "synthetic-2", gate: "no-such-gate", input: {}, expect: { outcome: "PASS" } }];
  assert.throws(
    () => evaluate({ fixtures, supportMatrix: { rows: {} }, roleBinding: {} }),
    /unknown gate/,
  );
});

test("evaluateCoverage(): a CORE invariant with zero bound fixtures is a gap", () => {
  const fixtures = [{ gate: "role-binding", bound_core: "CORE-1" }];
  const cov = evaluateCoverage({ fixtures, supportMatrix: { rows: {} } });
  assert.ok(!cov.ok);
  assert.ok(cov.gaps.some((g) => g.kind === "core" && g.id === "CORE-2"));
});

function writeTmpFixture(gateName, fileName, content) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-"));
  const gateDir = path.join(tmpDir, gateName);
  fs.mkdirSync(gateDir, { recursive: true });
  fs.writeFileSync(path.join(gateDir, fileName), content);
  return tmpDir;
}

test("loadFixtures() throws (fail-closed) on a fixture naming an unknown gate", () => {
  const tmpDir = writeTmpFixture(
    "no-such-gate",
    "case.json",
    JSON.stringify({ id: "x", gate: "no-such-gate", input: {}, expect: { outcome: "PASS" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /unknown gate/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a fixture missing required fields", () => {
  const tmpDir = writeTmpFixture("retention", "case.json", JSON.stringify({ gate: "retention" }));
  try {
    assert.throws(() => loadFixtures(tmpDir), /missing required field/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on unparseable fixture JSON", () => {
  const tmpDir = writeTmpFixture("retention", "case.json", "{ not valid json");
  try {
    assert.throws(() => loadFixtures(tmpDir), /malformed fixture/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a non-canonical expect.outcome", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({
      id: "x",
      gate: "retention",
      input: { attempted_disposition: "archive" },
      expect: { outcome: "MAYBE" },
    }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /expect\.outcome/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a fixture with a MISSING 'input'", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({ id: "x", gate: "retention", expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /input/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a fixture whose 'input' is a STRING, not an object", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({ id: "x", gate: "retention", input: "not-an-object", expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /input/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a fixture whose 'input' is an ARRAY, not an object", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({ id: "x", gate: "retention", input: ["not", "an", "object"], expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /input/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a fixture whose 'input' is NULL", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({ id: "x", gate: "retention", input: null, expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /input/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("the real conformance-matrix-selftest/retention/bad-input-shape.json fixture is shape-malformed -> loadFixtures throws", () => {
  const dir = path.join(KERNEL_DIR, "fixtures", "conformance-matrix-selftest");
  assert.throws(() => loadFixtures(dir), /input/);
});

test("the real kernel-conformance walk EXCLUDES conformance-matrix-selftest — run() never trips on it", () => {
  const res = run();
  assert.strictEqual(res.mismatches.length, 0, JSON.stringify(res.mismatches));
  assert.ok(res.fixtureCount > 0);
});

test("loadFixtures() throws (fail-closed) on a role-binding fixture with input:{} (missing actor_kind)", () => {
  const tmpDir = writeTmpFixture(
    "role-binding",
    "case.json",
    JSON.stringify({ id: "x", gate: "role-binding", input: {}, expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /actor_kind/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a retention fixture missing attempted_disposition", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({ id: "x", gate: "retention", input: { unrelated: true }, expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /attempted_disposition/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a support-matrix fixture missing helm", () => {
  const tmpDir = writeTmpFixture(
    "support-matrix",
    "case.json",
    JSON.stringify({ id: "x", gate: "support-matrix", input: {}, expect: { outcome: "BLOCK" } }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /helm/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() throws (fail-closed) on a trust-boundary fixture with a wrong-typed required field", () => {
  const tmpDir = writeTmpFixture(
    "trust-boundary",
    "case.json",
    JSON.stringify({
      id: "x",
      gate: "trust-boundary",
      input: { attempted_action: "integrate_to_main", actor_is_trusted_layer: "false" },
      expect: { outcome: "BLOCK" },
    }),
  );
  try {
    assert.throws(() => loadFixtures(tmpDir), /actor_is_trusted_layer/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadFixtures() still accepts a gate-shape-valid fixture (positive control)", () => {
  const tmpDir = writeTmpFixture(
    "retention",
    "case.json",
    JSON.stringify({
      id: "x",
      gate: "retention",
      input: { attempted_disposition: "archive" },
      expect: { outcome: "PASS" },
    }),
  );
  try {
    const fixtures = loadFixtures(tmpDir);
    assert.strictEqual(fixtures.length, 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("the real conformance-matrix-selftest/role-binding/missing-required-field.json fixture is gate-shape-malformed -> loadFixtures throws on actor_kind", () => {
  const realFixturePath = path.join(
    KERNEL_DIR,
    "fixtures",
    "conformance-matrix-selftest",
    "role-binding",
    "missing-required-field.json",
  );
  const content = fs.readFileSync(realFixturePath, "utf8");
  const tmpDir = writeTmpFixture("role-binding", "case.json", content);
  try {
    assert.throws(() => loadFixtures(tmpDir), /actor_kind/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("run() propagates a malformed fixture as a thrown error — the CLI maps this to exit 2, never a clean 0/1", () => {
  const tmpDir = writeTmpFixture(
    "no-such-gate",
    "case.json",
    JSON.stringify({ id: "x", gate: "no-such-gate", input: {}, expect: { outcome: "PASS" } }),
  );
  try {
    assert.throws(
      () =>
        run({
          kernelDir: KERNEL_DIR,
          supportMatrixPath: path.join(KERNEL_DIR, "support-matrix.json"),
          fixturesDir: tmpDir,
        }),
      /unknown gate/,
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeTmpSupportMatrix(obj) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-"));
  const p = path.join(tmpDir, "support-matrix.json");
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return { tmpDir, p };
}

test("loadSupportMatrix() throws (fail-closed) when 'rows' is missing", () => {
  const { tmpDir, p } = writeTmpSupportMatrix({ schema: "x" });
  try {
    assert.throws(() => loadSupportMatrix(p), /rows/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadSupportMatrix() throws (fail-closed) when 'rows' is not an object", () => {
  const { tmpDir, p } = writeTmpSupportMatrix({ rows: "not-an-object" });
  try {
    assert.throws(() => loadSupportMatrix(p), /rows/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadSupportMatrix() throws (fail-closed) when a row is missing a required field", () => {
  const { tmpDir, p } = writeTmpSupportMatrix({ rows: { claude: { status: "supported", required: true } } });
  try {
    assert.throws(() => loadSupportMatrix(p), /proven|evidence_ref/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadSupportMatrix() throws (fail-closed) when a row's field has the wrong type", () => {
  const { tmpDir, p } = writeTmpSupportMatrix({
    rows: { claude: { status: "supported", required: "yes", proven: true, evidence_ref: "x" } },
  });
  try {
    assert.throws(() => loadSupportMatrix(p), /required/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadSupportMatrix() throws (fail-closed) on unparseable JSON", () => {
  const { tmpDir, p } = writeTmpSupportMatrix("{ not valid json");
  try {
    assert.throws(() => loadSupportMatrix(p), /not valid JSON/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadSupportMatrix() still accepts the REAL support-matrix.json (positive control)", () => {
  const matrix = loadSupportMatrix(path.join(KERNEL_DIR, "support-matrix.json"));
  assert.ok(matrix && typeof matrix === "object");
  assert.ok(matrix.rows && matrix.rows.claude && matrix.rows.claude.status === "supported");
});

const unavailableRow = (status) => ({ status, required: true, proven: false, evidence_ref: "lane-ref" });

test("support-matrix evaluator: a required+not-verified helm -> BLOCK on the required-lane branch (same as down)", () => {
  for (const status of ["down", "not-verified"]) {
    const sm = { rows: { agy: unavailableRow(status) } };
    const out = GATE_EVALUATORS["support-matrix"]({ helm: "agy" }, { supportMatrix: sm });
    assert.strictEqual(out.outcome, "BLOCK", status);
    assert.ok(out.reason.includes(`resolves ${status}`), `${status}: ${out.reason}`);
  }
});

test("evaluate(): a required not-verified row is surfaced in requiredDownLanes exactly like a down row", () => {
  for (const status of ["down", "not-verified"]) {
    const res = evaluate({ fixtures: [], supportMatrix: { rows: { agy: unavailableRow(status) } }, roleBinding: {} });
    assert.deepStrictEqual(res.requiredDownLanes, [{ helm: "agy", status, evidence_ref: "lane-ref" }], status);
  }
});

test("flipGate(): a required not-verified lane REFUSES the flip exactly like a down lane", () => {
  for (const status of ["down", "not-verified"]) {
    const res = evaluate({ fixtures: [], supportMatrix: { rows: { agy: unavailableRow(status) } }, roleBinding: {} });
    const gate = flipGate({ ...res, fixtureCount: 13 });
    assert.strictEqual(gate.authorized, false, status);
    assert.ok(gate.blockers.some((b) => b.includes(`required lane agy resolves ${status}`)), JSON.stringify(gate.blockers));
  }
});

test("loadSupportMatrix() accepts status 'not-verified' and refuses an unknown status (fail-closed)", () => {
  const ok = writeTmpSupportMatrix({ rows: { agy: unavailableRow("not-verified") } });
  const bad = writeTmpSupportMatrix({ rows: { agy: unavailableRow("not_verified") } });
  try {
    assert.strictEqual(loadSupportMatrix(ok.p).rows.agy.status, "not-verified");
    assert.throws(() => loadSupportMatrix(bad.p), /status/);
  } finally {
    fs.rmSync(ok.tmpDir, { recursive: true, force: true });
    fs.rmSync(bad.tmpDir, { recursive: true, force: true });
  }
});

test("the REAL support-matrix.json ships the agy lane as required + not-verified + unproven", () => {
  const row = loadSupportMatrix(path.join(KERNEL_DIR, "support-matrix.json")).rows["agy-antigravity"];
  assert.strictEqual(row.status, "not-verified");
  assert.strictEqual(row.required, true);
  assert.strictEqual(row.proven, false);
});

function writeTmpRoleBinding(obj) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-"));
  const p = path.join(tmpDir, "role-binding.json");
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return { tmpDir, p };
}

test("loadRoleBinding() throws (fail-closed) when role-binding.json is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cfm-missing-"));
  try {
    assert.throws(() => loadRoleBinding(tmpDir), /unreadable/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadRoleBinding() throws (fail-closed) on unparseable JSON", () => {
  const { tmpDir } = writeTmpRoleBinding("{ not valid json");
  try {
    assert.throws(() => loadRoleBinding(tmpDir), /not valid JSON/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadRoleBinding() throws (fail-closed) when 'order' is missing", () => {
  const { tmpDir } = writeTmpRoleBinding({ sources: {}, worker_default_when_unbound: "FAIL_CLOSED" });
  try {
    assert.throws(() => loadRoleBinding(tmpDir), /order/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadRoleBinding() throws (fail-closed) when 'sources' is missing", () => {
  const { tmpDir } = writeTmpRoleBinding({ order: ["UNBOUND"], worker_default_when_unbound: "FAIL_CLOSED" });
  try {
    assert.throws(() => loadRoleBinding(tmpDir), /sources/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadRoleBinding() throws (fail-closed) when 'worker_default_when_unbound' is missing", () => {
  const { tmpDir } = writeTmpRoleBinding({ order: ["UNBOUND"], sources: {} });
  try {
    assert.throws(() => loadRoleBinding(tmpDir), /worker_default_when_unbound/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadRoleBinding() still accepts the REAL role-binding.json (positive control)", () => {
  const rb = loadRoleBinding(KERNEL_DIR);
  assert.ok(rb && typeof rb === "object");
  assert.strictEqual(rb.worker_default_when_unbound, "FAIL_CLOSED");
  assert.ok(Array.isArray(rb.order) && rb.order.length > 0);
});

test("end-to-end: a malformed role-binding.json makes run() throw (fail-closed) -- CLI maps this to exit 2, never a coincidental green", () => {
  const { tmpDir: kernelTmpDir } = writeTmpRoleBinding({ order: ["UNBOUND"] });
  try {
    assert.throws(
      () =>
        run({
          kernelDir: kernelTmpDir,
          supportMatrixPath: path.join(KERNEL_DIR, "support-matrix.json"),
          fixturesDir: path.join(KERNEL_DIR, "fixtures"),
        }),
      /role binding/,
    );
  } finally {
    fs.rmSync(kernelTmpDir, { recursive: true, force: true });
  }
});

test("pure-core: validateRoleBinding() rejects a non-object payload", () => {
  assert.throws(() => validateRoleBinding(null, "x"), /not a JSON object/);
  assert.throws(() => validateRoleBinding(["array"], "x"), /not a JSON object/);
});

test("pure-core: validateRoleBinding() accepts a minimal well-formed graph", () => {
  const rb = validateRoleBinding(
    { order: ["UNBOUND"], sources: {}, worker_default_when_unbound: "FAIL_CLOSED" },
    "x",
  );
  assert.strictEqual(rb.worker_default_when_unbound, "FAIL_CLOSED");
});

test("flipGate(): a clean suite (0 mismatches, 0 required-down, nonzero fixtures) AUTHORIZES the flip", () => {
  const gate = flipGate({ mismatches: [], requiredDownLanes: [], fixtureCount: 13 });
  assert.strictEqual(gate.authorized, true, JSON.stringify(gate.blockers));
  assert.strictEqual(gate.blockers.length, 0);
});

test("flipGate(): a fixture mismatch REFUSES the flip (never flip a default red)", () => {
  const gate = flipGate({
    mismatches: [{ id: "x", gate: "retention", expected: "PASS", computed: "BLOCK" }],
    requiredDownLanes: [],
    fixtureCount: 13,
  });
  assert.strictEqual(gate.authorized, false);
  assert.ok(gate.blockers.some((b) => /fixture mismatch x/.test(b)));
});

test("flipGate(): a required down lane REFUSES the flip (agy-antigravity row)", () => {
  const gate = flipGate({
    mismatches: [],
    requiredDownLanes: [{ helm: "agy-antigravity", evidence_ref: "ED-999060" }],
    fixtureCount: 13,
  });
  assert.strictEqual(gate.authorized, false);
  assert.ok(gate.blockers.some((b) => /required lane agy-antigravity resolves down/.test(b)));
});

test("flipGate(): an empty suite REFUSES the flip (fail-closed — cannot certify on zero fixtures)", () => {
  const gate = flipGate({ mismatches: [], requiredDownLanes: [], fixtureCount: 0 });
  assert.strictEqual(gate.authorized, false);
  assert.ok(gate.blockers.some((b) => /zero conformance fixtures/.test(b)));
});

test("flipGate(): over the REAL corpus, the flip is REFUSED by the required agy-antigravity lane (not-verified)", () => {
  const gate = flipGate(run());
  assert.strictEqual(gate.authorized, false, "expected the flip to be blocked while the required agy lane is not verified");
  assert.ok(gate.blockers.some((b) => /agy-antigravity/.test(b)), JSON.stringify(gate.blockers));
});

if (failures.length) {
  process.stderr.write(
    `FAIL [conformance-matrix.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(`OK   [conformance-matrix.test] ${passed} passed\n`);
