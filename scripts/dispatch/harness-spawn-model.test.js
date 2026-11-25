#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
const { harnessSpawnModel, isClaudeModel, HARNESS_FACE_MODEL, HARNESS_WORKER_MODEL } = require("./harness-spawn-model");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

const STUB = {
  "some-face": { provider: "openai", model: "gpt-x", tier: "face" },
  "some-tool": { provider: "gemini", model: "gemini-x", tier: "tool" },
};

test("antigravity-pinned security-reviewer → its chain's Claude entry (opus-5-5@high, alias opus)", () => {
  const out = harnessSpawnModel("security-reviewer");
  assert.ok(isClaudeModel(out.model), `expected a claude- model, got ${out.model}`);
  assert.deepStrictEqual([out.model, out.effort, out.alias], ["claude-opus-5-5", "high", "opus"]);
  assert.equal(out.source, "resolver-coerced");
  assert.equal(out.coerced_from, "antigravity");
  assert.equal(out.spawn_model_param, null, "a role with a spec passes no model param (frontmatter decides)");
});
test("openai-pinned product-lead → opus-5-5 at the chain's effort (xhigh)", () => {
  const out = harnessSpawnModel("product-lead");
  assert.deepStrictEqual([out.model, out.effort, out.alias, out.coerced_from], ["claude-opus-5-5", "xhigh", "opus", "openai"]);
});

test("harnessSpawnModel does NOT touch getProviderForRole — CLI path still routes to the native provider", () => {
  const { getProviderForRole } = require("../hooks/lib/providers");
  assert.equal(getProviderForRole("security-reviewer"), "antigravity");
  assert.equal(getProviderForRole("product-lead"), "openai");
});

test("native-Claude roles: test-runner → sonnet-5-5@medium [sonnet]; director-of-engineering → opus-5-5@high [opus] (the shipped default)", () => {
  const tr = harnessSpawnModel("test-runner");
  assert.deepStrictEqual([tr.model, tr.effort, tr.alias, tr.source], ["claude-sonnet-5-5", "medium", "sonnet", "resolver"]);
  const doe = harnessSpawnModel("director-of-engineering");
  assert.deepStrictEqual([doe.model, doe.effort, doe.alias], ["claude-opus-5-5", "high", "opus"]);
  assert.equal(doe.coerced_from, null);
});
test("claude_pinned visual judge is labelled claude-pinned", () => {
  const out = harnessSpawnModel("design-quality");
  assert.equal(out.source, "claude-pinned");
  assert.ok(isClaudeModel(out.model));
});

test("a role the resolver does not know → the tier map; non-Claude face → face model, tool → worker model", () => {
  const f = harnessSpawnModel("some-face", STUB);
  assert.deepStrictEqual([f.model, f.source, f.coerced_from], [HARNESS_FACE_MODEL, "tier-coerced", "openai"]);
  assert.equal(f.spawn_model_param, "opus", "a spec-less spawn passes the alias");
  const t = harnessSpawnModel("some-tool", STUB);
  assert.equal(t.model, HARNESS_WORKER_MODEL);
});
test("the worker-tier fallback is claude-sonnet-5-5 (not the stale claude-sonnet-5)", () => {
  assert.equal(HARNESS_WORKER_MODEL, process.env.MC_HARNESS_WORKER_MODEL || process.env.HARNESS_WORKER_MODEL || "claude-sonnet-5-5");
});
test("unknown role → face-tier Claude model (fail-safe, invariant holds)", () => {
  const out = harnessSpawnModel("no-such-role-xyz", STUB);
  assert.ok(isClaudeModel(out.model));
  assert.equal(out.model, HARNESS_FACE_MODEL);
  assert.equal(out.source, "default-unknown-role");
});
test("the resolver failing (unreadable registry) → the tier map, still a Claude model", () => {
  const out = harnessSpawnModel("some-tool", STUB, { registryPath: path.join(__dirname, "no-such-registry.json") });
  assert.equal(out.source, "tier-fail-safe");
  assert.ok(isClaudeModel(out.model));
});

test("live registry — EVERY role's harness model is a Claude model and equals the resolver's in-process answer", () => {
  const { loadRoles } = require("./registry-roles");
  const mr = require("./model-resolve");
  const roles = loadRoles();
  const ids = Object.keys(roles).filter((k) => !k.startsWith("_"));
  assert.ok(ids.length > 5, "expected a populated live registry");
  const offenders = [];
  for (const id of ids) {
    const out = harnessSpawnModel(id);
    const ip = mr.resolveRole(id, { channel: "in-process" });
    if (!isClaudeModel(out.model) || out.model !== ip.model || out.alias !== ip.alias) offenders.push(`${id}→${out.model}/${out.alias} vs ${ip.model}/${ip.alias}`);
  }
  assert.equal(offenders.length, 0, `mismatches: ${offenders.join(", ")}`);
});

if (failures.length) {
  process.stderr.write(`FAIL [harness-spawn-model.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [harness-spawn-model.test] ${passed} passed\n`);
