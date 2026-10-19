#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");
const { compareRouting } = require("./dispatch-routing-parity");

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

test("coherent: registry==consumers, doc covers non-claude → 0 findings", () => {
  const reg = { alpha: "claude", rev: "openai", sec: "gemini" };
  const r = compareRouting({
    registryMap: reg,
    providersMap: { ...reg },
    catalogMap: { ...reg },
    docTable: { rev: "openai", sec: "gemini" },
  });
  assert.deepStrictEqual(r.disagreements, [], `unexpected disagreements: ${JSON.stringify(r.disagreements)}`);
  assert.deepStrictEqual(r.undocumented, [], `unexpected undocumented: ${JSON.stringify(r.undocumented)}`);
});

test("providers.js disagrees with registry → disagreement flagged", () => {
  const r = compareRouting({
    registryMap: { rev: "openai" },
    providersMap: { rev: "gemini" },
    catalogMap: { rev: "openai" },
    docTable: { rev: "openai" },
  });
  const d = r.disagreements.find((x) => x.role === "rev");
  assert.ok(d, `expected 'rev' disagreement, got: ${JSON.stringify(r.disagreements)}`);
  assert.strictEqual(d.providers.registry, "openai");
  assert.strictEqual(d.providers.providersJs, "gemini");
});

test("catalog.js disagrees with registry → disagreement flagged", () => {
  const r = compareRouting({
    registryMap: { rev: "openai" },
    providersMap: { rev: "openai" },
    catalogMap: { rev: "claude" },
    docTable: { rev: "openai" },
  });
  assert.ok(r.disagreements.some((d) => d.role === "rev"), `expected 'rev' disagreement, got: ${JSON.stringify(r.disagreements)}`);
});

test("doc disagrees with registry → disagreement flagged", () => {
  const r = compareRouting({
    registryMap: { rev: "openai" },
    providersMap: { rev: "openai" },
    catalogMap: { rev: "openai" },
    docTable: { rev: "gemini" },
  });
  assert.ok(r.disagreements.some((d) => d.role === "rev"), `expected doc-drift disagreement, got: ${JSON.stringify(r.disagreements)}`);
});

test("registry-only claude default (manager) → not flagged", () => {
  const r = compareRouting({
    registryMap: { "director-of-product": "claude", rev: "openai" },
    providersMap: { rev: "openai" },
    catalogMap: { rev: "openai" },
    docTable: { rev: "openai" },
  });
  assert.ok(!r.disagreements.some((d) => d.role === "director-of-product"), "registry-only claude default must not be a disagreement");
  assert.ok(!r.undocumented.some((u) => u.role === "director-of-product"), "claude default must not be undocumented");
});

test("consumer-only scrapped alias (not in registry) → not flagged", () => {
  const r = compareRouting({
    registryMap: { rev: "openai" },
    providersMap: { reviewer: "openai", rev: "openai" },
    catalogMap: { reviewer: "openai", rev: "openai" },
    docTable: { rev: "openai", reviewer: "openai" },
  });
  assert.ok(!r.disagreements.some((d) => d.role === "reviewer"), "scrapped alias agreed across consumers must not be a disagreement");
});

test("non-claude registry role missing from doc → undocumented", () => {
  const r = compareRouting({
    registryMap: { rev: "openai" },
    providersMap: { rev: "openai" },
    catalogMap: { rev: "openai" },
    docTable: {},
  });
  assert.ok(r.undocumented.some((u) => u.role === "rev" && u.codeProvider === "openai"), `expected 'rev' undocumented, got: ${JSON.stringify(r.undocumented)}`);
});

test("claude-by-definition role absent from doc → not undocumented", () => {
  const r = compareRouting({
    registryMap: { alpha: "claude" },
    providersMap: { alpha: "claude" },
    catalogMap: { alpha: "claude" },
    docTable: {},
  });
  assert.deepStrictEqual(r.undocumented, [], `claude role must never be undocumented, got: ${JSON.stringify(r.undocumented)}`);
});

test("real repo: dispatch-routing-parity exits 0", () => {
  const script = path.join(__dirname, "dispatch-routing-parity.js");
  const repoRoot = path.join(__dirname, "..", "..");
  execFileSync(process.execPath, [script], { stdio: "pipe", cwd: repoRoot });
});

if (failures.length) {
  process.stderr.write(`dispatch-routing-parity bite-test: ${passed} passed, ${failures.length} FAILED\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(`dispatch-routing-parity bite-test: ${passed}/${passed} passed (positive + 4 bite + 3 no-false-positive + integration)\n`);
process.exit(0);
