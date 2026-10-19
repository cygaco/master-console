#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { resolveModelRunOpts } = require("./dispatch-agent");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test("no override → native provider_model (roleModel) applies", () => {
  const o = resolveModelRunOpts({ providerOverride: null, modelOverride: null, roleModel: "gpt-5.6-terra" });
  assert.deepEqual(o, { model: "gpt-5.6-terra" });
  assert.equal(o.provider, undefined);
});

test("--provider X --model Y → both forced (override wins over roleModel)", () => {
  const o = resolveModelRunOpts({ providerOverride: "openai", modelOverride: "gpt-5.6-sol", roleModel: "gemini-3.1-pro-high" });
  assert.deepEqual(o, { provider: "openai", model: "gpt-5.6-sol" });
});

test("--provider X (no --model) → spec model DROPPED (belongs to wrong provider)", () => {
  const o = resolveModelRunOpts({ providerOverride: "openai", modelOverride: null, roleModel: "gemini-3.1-pro-high" });
  assert.equal(o.provider, "openai");
  assert.equal(o.model, undefined, "the native-provider spec model must NOT ride an explicit provider override");
});

test("--model Y only → force model, native provider", () => {
  const o = resolveModelRunOpts({ providerOverride: null, modelOverride: "gpt-5.6-sol", roleModel: "gpt-5.6-terra" });
  assert.deepEqual(o, { model: "gpt-5.6-sol" });
});

if (failures.length) {
  process.stderr.write(`FAIL [dispatch-agent-model-semantics.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [dispatch-agent-model-semantics.test] ${passed} passed (semantics locked)\n`);
