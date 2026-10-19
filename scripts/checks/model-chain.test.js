#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluateModelChain, collectModelRefs } = require("./model-chain");

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
const has = (errs, sub) => errs.some((e) => e.includes(sub));

function cleanReg() {
  return {
    model_policy: {
      _doc: "fable-5-1 top brain; sonnet-5-5 doers; gpt-6.1-sol Product/Growth.",
      doers: { provider: "claude", model: "claude-sonnet-5-5", effort: "high" },
      review_flagship: { provider: "openai", model: "gpt-5.6-sol", effort: "high" },
    },
    roles: {
      alpha: { provider: "claude", model: "claude-fable-5-1", effort: "high" },
      beta: { provider: "openai", model: "gpt-6.1-sol", effort: "high" },
      "director-of-product": { provider: "openai", model: "gpt-6.1-sol", effort: "high" },
      "backend-builder": { provider: "claude", model: "claude-sonnet-5-5", effort: "high" },
      "qa-reviewer": { provider: "openai", model: "gpt-5.6-terra", effort: "xhigh" },
      "security-reviewer": {
        provider: "antigravity",
        model: "gemini-3.1-pro-high",
        effort: null,
        second_pass: { provider: "openai", model: "gpt-5.6-sol", effort: "xhigh" },
        third_pass: { provider: "claude", model: "claude-opus-4-8", effort: "max" },
      },
      "skeleton-builder": { provider: "claude", model: "claude-sonnet-5-5", effort: null },
      "test-runner": { provider: "claude", model: "claude-sonnet-5-5", effort: "medium" },
    },
  };
}
function cleanConsumers(reg) {
  return {
    catalogProvider: { alpha: "claude", "qa-reviewer": "openai", "director-of-product": "openai" },
    catalogEffort: { alpha: "high", "qa-reviewer": "xhigh", "director-of-product": "high" },
    providerAgent: { "qa-reviewer": "openai" },
    providerEffortFn: (role) => (reg.roles[role] ? reg.roles[role].effort : undefined),
  };
}
const clone = (r) => JSON.parse(JSON.stringify(r));

function fableReg() {
  return {
    model_policy: {
      _doc: "fable-5-1 top brain; sonnet-5-5 doers; gpt-6.1-sol Product/Growth.",
      doers: { provider: "claude", model: "claude-sonnet-5-5", effort: "high" },
      review_flagship: { provider: "openai", model: "gpt-5.6-sol", effort: "high" },
    },
    roles: {
      alpha: { provider: "claude", model: "claude-fable-5-1", effort: "high" },
      beta: { provider: "openai", model: "gpt-6.1-sol", effort: "high" },
      "director-of-engineering": { provider: "claude", model: "claude-fable-5-1", effort: "high" },
      "backend-builder": { provider: "claude", model: "claude-sonnet-5-5", effort: "high" },
      "qa-reviewer": { provider: "openai", model: "gpt-5.6-terra", effort: "xhigh" },
      cabinet: { provider: "openai", model: "gpt-6.1-sol", effort: "xhigh" },
      "security-reviewer": {
        provider: "antigravity",
        model: "gemini-3.1-pro-preview",
        effort: null,
        second_pass: { provider: "openai", model: "gpt-5.6-sol", effort: "xhigh" },
        third_pass: { provider: "claude", model: "claude-opus-4-8", effort: "max" },
      },
      "skeleton-builder": { provider: "claude", model: "claude-sonnet-5-5", effort: null },
    },
  };
}

test("clean registry → 0 findings", () => {
  const reg = cleanReg();
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.deepStrictEqual(errs, [], `expected clean, got: ${errs.join(" | ")}`);
});

test("opus roster (alpha opus@max, doers opus) → REJECTED", () => {
  const reg = cleanReg();
  reg.roles.alpha.model = "claude-opus-4-8";
  reg.roles.alpha.effort = "max";
  reg.model_policy.doers.model = "claude-opus-4-8";
  const errs = evaluateModelChain({ reg });
  assert.ok(has(errs, "alpha.model") && has(errs, "sanctioned top tuples"), "old alpha must be rejected: " + errs.join(" | "));
  assert.ok(has(errs, "model_policy.doers.model") && has(errs, "sanctioned doer"), "old doer must be rejected: " + errs.join(" | "));
  assert.ok(has(errs, 'role "alpha" effort=max'), "alpha@max must be rejected: " + errs.join(" | "));
});

test("fable in a role model → NO fable-rejection", () => {
  const reg = cleanReg();
  reg.roles["director-of-product"].model = "claude-fable-5";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(!has(errs, "fable"), `fable must be allowed; got: ${errs.join(" | ")}`);
});
test("collectModelRefs still ignores prose (_note/_doc) fields", () => {
  const reg = cleanReg();
  reg.roles.alpha._note = "fable notes here";
  assert.ok(!collectModelRefs(reg).some((r) => /note/i.test(r.where)), "collectModelRefs must not scan _note");
});

test("fable-top roster (fable alpha, sonnet-5 doers, opus@max hunter) → 0 findings", () => {
  const errs = evaluateModelChain({ reg: fableReg() });
  assert.deepStrictEqual(errs, [], `roster must pass; got: ${errs.join(" | ")}`);
});
test("doers.model = a non-sanctioned model → flagged", () => {
  const reg = cleanReg();
  reg.model_policy.doers.model = "claude-fable-5";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "model_policy.doers.model") && has(errs, "sanctioned doer"), errs.join(" | "));
});

test("alpha = gpt-5.5 (neither sanctioned top) → CRITICAL", () => {
  const reg = cleanReg();
  reg.roles.alpha.model = "gpt-5.5";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "alpha.model") && has(errs, "sanctioned top tuples"), errs.join(" | "));
});
test("alpha = opus@xhigh (wrong effort pairing) → CRITICAL", () => {
  const reg = cleanReg();
  reg.roles.alpha.effort = "xhigh";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "sanctioned top tuples"), errs.join(" | "));
});
test("alpha = fable@max (fable pairs with high, not max) → CRITICAL", () => {
  const reg = cleanReg();
  reg.roles.alpha.model = "claude-fable-5";
  reg.roles.alpha.effort = "max";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "sanctioned top tuples"), errs.join(" | "));
});

test("doers.model = legacy sonnet-4-6 (not a sanctioned doer) → flagged", () => {
  const reg = cleanReg();
  reg.model_policy.doers.model = "claude-sonnet-4-6";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "model_policy.doers.model") && has(errs, "sanctioned doer"), errs.join(" | "));
});
test("doers.model = sonnet-5-5 (sanctioned doer) → NOT flagged", () => {
  const reg = cleanReg();
  reg.model_policy.doers.model = "claude-sonnet-5-5";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(!has(errs, "sanctioned doer"), errs.join(" | "));
});

test("role missing model → flagged", () => {
  const reg = cleanReg();
  delete reg.roles["backend-builder"].model;
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "backend-builder") && has(errs, "no model"), errs.join(" | "));
});
test("role missing effort key → flagged", () => {
  const reg = cleanReg();
  delete reg.roles["backend-builder"].effort;
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "backend-builder") && has(errs, "no effort key"), errs.join(" | "));
});
test("invalid effort level (turbo) → flagged", () => {
  const reg = cleanReg();
  reg.roles["backend-builder"].effort = "turbo";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "backend-builder") && has(errs, "not a valid level"), errs.join(" | "));
});
test("ultra on a claude role → CEILING flagged", () => {
  const reg = cleanReg();
  reg.roles["backend-builder"].effort = "ultra";
  const errs = evaluateModelChain({ reg });
  assert.ok(has(errs, "backend-builder") && has(errs, "ultra is only valid on"), errs.join(" | "));
});
test("ultra on gpt-5.6-sol → allowed (no ceiling finding)", () => {
  const reg = cleanReg();
  reg.roles["qa-reviewer"].model = "gpt-5.6-sol";
  reg.roles["qa-reviewer"].effort = "ultra";
  const errs = evaluateModelChain({ reg });
  assert.ok(!has(errs, "ultra is only valid on"), errs.join(" | "));
});
test("claude role effort null (non-skeleton) → flagged", () => {
  const reg = cleanReg();
  reg.roles["backend-builder"].effort = null;
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "backend-builder") && has(errs, "null effort needs"), errs.join(" | "));
});
test("gemini role effort null → NOT flagged (always-on thinking)", () => {
  const reg = cleanReg();
  reg.roles["security-reviewer"].effort = null;
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(!has(errs, "security-reviewer"), `gemini null effort must be allowed; got: ${errs.join(" | ")}`);
});

test("max on a non-sanctioned role (director-of-product) → flagged", () => {
  const reg = cleanReg();
  reg.roles["director-of-product"].effort = "max";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(has(errs, "director-of-product") && has(errs, "reserved for"), errs.join(" | "));
});
test("max on security-reviewer (the opus@max hunter home) → allowed", () => {
  const reg = cleanReg();
  reg.roles["security-reviewer"].effort = "max";
  const errs = evaluateModelChain({ reg });
  assert.ok(!has(errs, "reserved for"), errs.join(" | "));
});

test("catalog provider drift → DRIFT", () => {
  const reg = cleanReg();
  const consumers = cleanConsumers(reg);
  consumers.catalogProvider["qa-reviewer"] = "claude";
  const errs = evaluateModelChain({ reg, consumers });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "DEFAULT_PROVIDER_PER_ROLE"), errs.join(" | "));
});
test("catalog effort drift → DRIFT", () => {
  const reg = cleanReg();
  const consumers = cleanConsumers(reg);
  consumers.catalogEffort["qa-reviewer"] = "high";
  const errs = evaluateModelChain({ reg, consumers });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "DEFAULT_EFFORT_PER_ROLE"), errs.join(" | "));
});
test("providers provider drift → DRIFT", () => {
  const reg = cleanReg();
  const consumers = cleanConsumers(reg);
  consumers.providerAgent["qa-reviewer"] = "gemini";
  const errs = evaluateModelChain({ reg, consumers });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "DEFAULT_AGENT_PROVIDERS"), errs.join(" | "));
});
test("providers reasoning-effort drift → DRIFT", () => {
  const reg = cleanReg();
  const consumers = cleanConsumers(reg);
  consumers.providerEffortFn = (role) => (role === "qa-reviewer" ? "medium" : reg.roles[role] && reg.roles[role].effort);
  const errs = evaluateModelChain({ reg, consumers });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "getReasoningEffort"), errs.join(" | "));
});

test("spec effort drift (spec max vs registry high) → DRIFT", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: true, hasEffortKey: true, effort: "max", path: "x/alpha.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "frontmatter effort"), errs.join(" | "));
});
test("spec effort matches registry → no spec-drift finding", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: true, hasEffortKey: true, effort: "high", path: "x/alpha.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(!has(errs, "frontmatter effort"), errs.join(" | "));
});
test("spec omits effort key → not flagged (omission ≠ drift, mirrors check G)", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: true, hasEffortKey: false, path: "x/alpha.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(!has(errs, "frontmatter effort"), errs.join(" | "));
});
test("spec missing on disk → not a spec-drift finding (role-parity's scope)", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: false, reason: "unreadable" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(!has(errs, "frontmatter effort"), errs.join(" | "));
});

test("H: provider_reasoning_effort drift (the cross-provider key) → DRIFT", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: true, hasProviderEffortKey: true, providerEffort: "max", path: "x/alpha.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "provider_reasoning_effort"), errs.join(" | "));
});
test("H: provider_reasoning_effort matching registry → no finding", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: true, hasProviderEffortKey: true, providerEffort: "high", path: "x/alpha.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(!has(errs, "frontmatter"), errs.join(" | "));
});
test("H: empty (YAML null) spec effort vs non-null registry → DRIFT", () => {
  const reg = cleanReg();
  const specs = { alpha: { exists: true, hasEffortKey: true, effort: null, path: "x/alpha.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "frontmatter effort"), errs.join(" | "));
});

test("H2: cross-provider spec provider_model drift (stale gpt-5.5) → DRIFT", () => {
  const reg = cleanReg();
  const specs = { "qa-reviewer": { exists: true, hasProviderModelKey: true, providerModel: "gpt-5.5", path: "x/qa.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "provider_model"), errs.join(" | "));
});
test("H2: cross-provider spec MISSING provider_model → DRIFT (cosmetic-flip)", () => {
  const reg = cleanReg();
  const specs = { "qa-reviewer": { exists: true, hasProviderModelKey: false, path: "x/qa.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(has(errs, "[DRIFT]") && has(errs, "NO provider_model"), errs.join(" | "));
});
test("H2: cross-provider spec provider_model matching registry → no finding", () => {
  const reg = cleanReg();
  const specs = { "qa-reviewer": { exists: true, hasProviderModelKey: true, providerModel: "gpt-5.6-terra", path: "x/qa.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(!has(errs, "provider_model"), errs.join(" | "));
});
test("H2: a claude role with no provider_model → NOT flagged (claude carries none)", () => {
  const reg = cleanReg();
  const specs = { "backend-builder": { exists: true, hasProviderModelKey: false, path: "x/bb.md" } };
  const errs = evaluateModelChain({ reg, specs });
  assert.ok(!has(errs, "provider_model"), errs.join(" | "));
});

test("scrapped name as a REAL registry role → SCRAPPED", () => {
  const reg = cleanReg();
  reg.roles.reviewer = { provider: "openai", model: "gpt-5.5", effort: "xhigh" };
  const errs = evaluateModelChain({ reg });
  assert.ok(has(errs, "[SCRAPPED]") && has(errs, "reviewer"), errs.join(" | "));
});
test("scrapped names in consumer maps (the SCRAPPED_*_ALIASES shim) → NOT flagged", () => {
  const reg = cleanReg();
  const consumers = cleanConsumers(reg);
  consumers.catalogProvider.reviewer = "openai";
  consumers.catalogProvider.qa = "openai";
  const errs = evaluateModelChain({ reg, consumers });
  assert.ok(!has(errs, "[SCRAPPED]"), "shim aliases in consumer maps must not be flagged: " + errs.join(" | "));
});

test("clean roster (thinking always-on/absent) → NO thinking-400 finding", () => {
  const errs = evaluateModelChain({ reg: cleanReg(), consumers: cleanConsumers(cleanReg()) });
  assert.ok(!has(errs, "[THINKING-400]"), `live-shape roster must be clean; got: ${errs.join(" | ")}`);
});
test("claude role: thinking DISABLED + effort max → THINKING-400", () => {
  const reg = cleanReg();
  reg.roles["backend-builder"].effort = "max";
  reg.roles["backend-builder"].thinking = "disabled";
  const errs = evaluateModelChain({ reg });
  assert.ok(has(errs, "[THINKING-400]") && has(errs, "backend-builder"), errs.join(" | "));
});
test("claude role: thinking {type:'disabled'} + effort xhigh → THINKING-400", () => {
  const reg = cleanReg();
  reg.roles["qa-reviewer"] = { provider: "claude", model: "claude-opus-4-8", effort: "xhigh", thinking: { type: "disabled" } };
  const errs = evaluateModelChain({ reg });
  assert.ok(has(errs, "[THINKING-400]") && has(errs, "qa-reviewer"), errs.join(" | "));
});
test("claude third_pass: thinking 'off' + max → THINKING-400 (passes are scanned too)", () => {
  const reg = cleanReg();
  reg.roles["security-reviewer"].third_pass = { provider: "claude", model: "claude-opus-4-8", effort: "max", thinking: "off" };
  const errs = evaluateModelChain({ reg });
  assert.ok(has(errs, "[THINKING-400]") && has(errs, "third_pass"), errs.join(" | "));
});
test("claude role: thinking DISABLED + effort HIGH → NOT flagged (disabled allowed at high or below)", () => {
  const reg = cleanReg();
  reg.roles["backend-builder"].thinking = "disabled";
  const errs = evaluateModelChain({ reg, consumers: cleanConsumers(reg) });
  assert.ok(!has(errs, "[THINKING-400]"), errs.join(" | "));
});
test("claude role: thinking always-on + max (the live hunter shape) → NOT flagged", () => {
  const reg = cleanReg();
  reg.roles["security-reviewer"].third_pass = { provider: "claude", model: "claude-opus-4-8", effort: "max", thinking: "always-on" };
  const errs = evaluateModelChain({ reg });
  assert.ok(!has(errs, "[THINKING-400]"), errs.join(" | "));
});
test("NON-claude role: thinking disabled + max → NOT a THINKING-400 (invariant is Claude-only)", () => {
  const reg = cleanReg();
  reg.roles["qa-reviewer"] = { provider: "openai", model: "gpt-5.6-sol", effort: "max", thinking: "disabled" };
  const errs = evaluateModelChain({ reg });
  assert.ok(!has(errs, "[THINKING-400]"), errs.join(" | "));
});

test("parseFrontmatterEffort: both keys + null/empty/comment/quotes", () => {
  const P = require("./model-chain").parseFrontmatterEffort;
  assert.equal(P("---\nname: x\neffort: xhigh\n---\nbody").effort, "xhigh");
  assert.equal(P('---\neffort: "high"\n---').effort, "high");
  assert.equal(P("---\neffort: null\n---").effort, null);
  assert.equal(P("---\neffort: ~\n---").effort, null);
  const empty = P("---\nname: x\neffort:\n---");
  assert.equal(empty.hasEffortKey, true);
  assert.equal(empty.effort, null);
  assert.equal(P("---\neffort: high # intentional\n---").effort, "high");
  const pre = P("---\nprovider: gemini\nprovider_reasoning_effort: high\n---");
  assert.equal(pre.hasProviderEffortKey, true);
  assert.equal(pre.providerEffort, "high");
  assert.equal(pre.hasEffortKey, false);
  assert.equal(P("---\nname: x\n---").hasEffortKey, false);
  assert.equal(P("no frontmatter here").hasFrontmatter, false);
});

test("live registry → real enforcer exits 0 + OK", () => {
  const out = execFileSync("node", [path.join(__dirname, "model-chain.js")], { encoding: "utf8" });
  assert.ok(/OK\s+\[model-chain\]/.test(out), `expected OK on live registry, got: ${out}`);
});

if (failures.length) {
  process.stderr.write(`FAIL [model-chain.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [model-chain.test] ${passed} passed\n`);
