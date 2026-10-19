"use strict";
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");

const { deriveBinding, loadRoleBinding, defaultKernelDir } = require("./role-resolver");
const { issueWorkOrder } = require("./workorder-validator");

const RB = loadRoleBinding(defaultKernelDir());
const KNOWN = ["backend-builder", "frontend-builder", "security-builder"];
const SECRET = crypto.randomBytes(32);

function baseWorkOrder(overrides = {}) {
  return {
    schema_version: "1",
    correlation_id: "corr-active-001",
    role: "backend-builder",
    provider: "claude",
    model: "opus-4.8",
    base_commit: "base-sha-1",
    result_tree_hash: "tree-sha-1",
    allowed_capabilities: ["read", "write"],
    allowed_paths: ["scripts/dispatch/"],
    retry_lineage: [],
    evidence_refs: [],
    terminal_state: "success",
    ...overrides,
  };
}

test("un-conflate: no `workorder` presented → binding_source is 'cli-channel', NEVER masquerading as validator-passed", () => {
  const b = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(b.ok, true);
  assert.strictEqual(b.boundRole, "backend-builder");
  assert.strictEqual(b.binding_source, "cli-channel", "a channel default must never claim workorder-validated");
  assert.match(b.reason, /channel-derived argv role/);
});

test("un-conflate teeth: a validated WorkOrder yields binding_source 'workorder-validated' — machine-distinct from the cli-channel default", () => {
  const wo = issueWorkOrder(baseWorkOrder(), { secret: SECRET });
  const validated = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: wo },
    { rb: RB, knownRoles: KNOWN, workorderOpts: { secret: SECRET } },
  );
  assert.strictEqual(validated.binding_source, "workorder-validated");
  const channelDefault = deriveBinding({ channel: "dispatch-claude", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN });
  assert.notStrictEqual(validated.binding_source, channelDefault.binding_source, "the two provenances must be distinguishable");
});

test("derive-not-settable falsifier: an unknown/absent channel CANNOT yield a cli-channel binding — it fail-closes with NO binding_source (the value is derived from the trusted channel, never caller-supplied)", () => {
  const fake = deriveBinding({ channel: "not-a-real-channel", role: "backend-builder" }, { rb: RB, knownRoles: KNOWN });
  assert.strictEqual(fake.ok, false);
  assert.strictEqual(fake.failClosed, true);
  assert.strictEqual(fake.binding_source, undefined, "no binding_source is emitted on a fail-closed path — a caller cannot manufacture 'cli-channel'");
});

test("ACTIVE: a schema-valid + validly-signed WorkOrder → BOUND", () => {
  const wo = issueWorkOrder(baseWorkOrder(), { secret: SECRET });
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: wo },
    { rb: RB, knownRoles: KNOWN, workorderOpts: { secret: SECRET } },
  );
  assert.strictEqual(b.ok, true, b.reason);
  assert.strictEqual(b.boundRole, "backend-builder");
  assert.match(b.reason, /workorder-validated/);
});

test("ACTIVE: a self-asserted/UNSIGNED WorkOrder → BLOCK (fail-closed), never bound", () => {
  const wo = baseWorkOrder();
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: wo },
    { rb: RB, knownRoles: KNOWN, workorderOpts: { secret: SECRET } },
  );
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.boundRole, null);
  assert.strictEqual(b.failClosed, true);
  assert.match(b.reason, /WorkOrder validation failed/);
});

test("ACTIVE: a schema-invalid WorkOrder → BLOCK, distinct reason", () => {
  const wo = issueWorkOrder(baseWorkOrder({ model: undefined }), { secret: SECRET });
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: wo },
    { rb: RB, knownRoles: KNOWN, workorderOpts: { secret: SECRET } },
  );
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.failClosed, true);
  assert.match(b.reason, /WorkOrder validation failed/);
});

test("ACTIVE: a WorkOrder forged under a DIFFERENT session secret → BLOCK", () => {
  const otherSecret = crypto.randomBytes(32);
  const wo = issueWorkOrder(baseWorkOrder(), { secret: otherSecret });
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: wo },
    { rb: RB, knownRoles: KNOWN, workorderOpts: { secret: SECRET } },
  );
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.failClosed, true);
});

test("ACTIVE: role='President' with a validly-signed WorkOrder is STILL refused (authority != identity escalation)", () => {
  const wo = issueWorkOrder(baseWorkOrder({ role: "President" }), { secret: SECRET });
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "President", workorder: wo },
    { rb: RB, knownRoles: KNOWN, workorderOpts: { secret: SECRET } },
  );
  assert.strictEqual(b.ok, false);
  assert.strictEqual(b.boundRole, null);
  assert.match(b.reason, /category error|President-leak/i);
});

test("opts.workorderValidate injection seam: an injected validator is consulted instead of the default module", () => {
  let called = false;
  const stubValidate = (wo, opts) => {
    called = true;
    return { ok: true, reason: "stub-pass" };
  };
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: { anything: true } },
    { rb: RB, knownRoles: KNOWN, workorderValidate: stubValidate },
  );
  assert.strictEqual(called, true);
  assert.strictEqual(b.ok, true);
});

test("opts.workorderValidate injection seam: an injected validator that FAILS blocks the bind", () => {
  const stubValidate = () => ({ ok: false, reason: "stub-reject" });
  const b = deriveBinding(
    { channel: "dispatch-claude", role: "backend-builder", workorder: { anything: true } },
    { rb: RB, knownRoles: KNOWN, workorderValidate: stubValidate },
  );
  assert.strictEqual(b.ok, false);
  assert.match(b.reason, /stub-reject/);
});

test("a validator that THROWS is caught and treated as fail-closed, never crashes deriveBinding", () => {
  const throwingValidate = () => {
    throw new Error("boom");
  };
  assert.doesNotThrow(() => {
    const b = deriveBinding(
      { channel: "dispatch-claude", role: "backend-builder", workorder: { anything: true } },
      { rb: RB, knownRoles: KNOWN, workorderValidate: throwingValidate },
    );
    assert.strictEqual(b.ok, false);
    assert.strictEqual(b.failClosed, true);
    assert.match(b.reason, /workorder-validator unavailable/);
  });
});
