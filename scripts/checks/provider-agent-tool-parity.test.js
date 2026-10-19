#!/usr/bin/env node
"use strict";
const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");
const { evaluateProviderAgentToolParity } = require("./provider-agent-tool-parity");

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
const noSpec = () => ({ has: false });

test("claude role with tools:[Agent] (quality-lead) → NOT flagged", () => {
  const reg = { roles: { "quality-lead": { provider: "claude", tools: ["Agent"] } } };
  const errs = evaluateProviderAgentToolParity({ reg, specToolsFn: noSpec });
  assert.deepStrictEqual(errs, [], errs.join(" | "));
});
test("claude_pinned visual judge (design-quality) → NOT flagged", () => {
  const reg = { roles: { "design-quality": { provider: "claude", claude_pinned: true, tools: ["Agent"] } } };
  const errs = evaluateProviderAgentToolParity({ reg, specToolsFn: noSpec });
  assert.deepStrictEqual(errs, [], errs.join(" | "));
});
test("gpt role WITHOUT Agent (CLI reviewer) → NOT flagged", () => {
  const reg = { roles: { "frontend-reviewer": { provider: "openai", tools: ["Read", "Grep"] } } };
  const errs = evaluateProviderAgentToolParity({ reg, specToolsFn: noSpec });
  assert.deepStrictEqual(errs, [], errs.join(" | "));
});

test("openai role with tools:[Agent] (registry) → CRITICAL", () => {
  const reg = { roles: { "qa-reviewer": { provider: "openai", tools: ["Agent"] } } };
  const errs = evaluateProviderAgentToolParity({ reg, specToolsFn: noSpec });
  assert.ok(has(errs, "qa-reviewer") && has(errs, "Agent-tool reachability") && has(errs, "registry tools"), errs.join(" | "));
});
test("antigravity role with tools:[Agent] → CRITICAL", () => {
  const reg = { roles: { "some-agy-role": { provider: "antigravity", tools: ["Agent"] } } };
  const errs = evaluateProviderAgentToolParity({ reg, specToolsFn: noSpec });
  assert.ok(has(errs, "some-agy-role") && has(errs, 'provider="antigravity"'), errs.join(" | "));
});
test("gpt role with Agent in SPEC frontmatter only → CRITICAL (spec source)", () => {
  const reg = { roles: { "design-lead": { provider: "openai", spec: "x/design-lead.md" } } };
  const errs = evaluateProviderAgentToolParity({ reg, specToolsFn: () => ({ has: true }) });
  assert.ok(has(errs, "design-lead") && has(errs, "spec frontmatter tools"), errs.join(" | "));
});

test("live registry: clean — no provider!=claude role carries Agent-tool", () => {
  let out = "";
  let code = 0;
  try {
    out = execFileSync("node", [path.join(__dirname, "provider-agent-tool-parity.js")], { encoding: "utf8" });
  } catch (e) {
    out = (e.stdout || "") + (e.stderr || "");
    code = e.status || 1;
  }
  assert.ok(code === 0, `expected the live check to be clean; got code=${code}: ${out}`);
});

if (failures.length) {
  process.stderr.write(`FAIL [provider-agent-tool-parity.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [provider-agent-tool-parity.test] ${passed} passed\n`);
