#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { buildProviderArgv, getProviderConfig, suggestFallbackProvider, PROVIDER_FAMILY, runProvider } = require("./providers");
const { assertArgs } = require("../../dispatch/safe-spawn");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test("getProviderConfig(antigravity) → cli agy, gemini-3.1-pro-high, cross-family openai fallback", () => {
  const cfg = getProviderConfig("antigravity");
  assert.ok(cfg, "antigravity config missing");
  assert.equal(cfg.cli, "agy");
  assert.equal(cfg.default_model, "gemini-3.1-pro-high");
  assert.equal(cfg.fallback, "openai");
  assert.ok(/agy/.test(cfg.syntax) && /-p/.test(cfg.syntax), "syntax must name agy + -p");
});

test("antigravity is google-family + fallback is cross-family openai", () => {
  assert.equal(PROVIDER_FAMILY.antigravity, "google");
  assert.equal(suggestFallbackProvider("antigravity", getProviderConfig("antigravity")), "openai");
});

test("buildProviderArgv(antigravity) → agy --model translates slug→display, -p prompt-in-argv, usesStdin false", () => {
  const built = buildProviderArgv("antigravity", "gemini-3.1-pro-high", [], { prompt: "review this diff\nfor OWASP issues" });
  assert.ok(!built.fail, "antigravity branch must exist (not fail-closed)");
  assert.equal(built.toolId, "agy");
  assert.equal(built.usesStdin, false);
  const mIdx = built.argv.indexOf("--model");
  assert.ok(mIdx >= 0, "--model flag present");
  assert.equal(built.argv[mIdx + 1], "Gemini 3.1 Pro (High)", "agy --model must carry the DISPLAY name, not the slug");
  assert.ok(!built.argv.includes("gemini-3.1-pro-high"), "the raw slug must NEVER reach agy --model");
  const pIdx = built.argv.indexOf("-p");
  assert.ok(pIdx >= 0 && built.argv[pIdx + 1].includes("OWASP"), "prompt must be the -p argv value");
  const check = assertArgs("agy", built.argv);
  assert.ok(check.ok, `agy argv rejected by safe-spawn policy: ${(check.violations || []).join("; ")}`);
});

test("catalog.agyModelName: slug→display for antigravity, UNCHANGED otherwise", () => {
  const catalog = require("../../dispatch/catalog");
  const m = catalog.getModel("antigravity", "gemini-3.1-pro-high");
  assert.ok(m, "antigravity model entry present");
  assert.equal(m.agyModelName, "Gemini 3.1 Pro (High)", "agyModelName field present + exact display name");
  assert.equal(catalog.agyModelName("gemini-3.1-pro-high"), "Gemini 3.1 Pro (High)");
  assert.equal(catalog.agyModelName("gpt-5.6-sol"), "gpt-5.6-sol", "non-antigravity id unchanged (zero blast radius)");
  assert.equal(catalog.agyModelName("some-unmapped-id"), "some-unmapped-id", "unmapped id unchanged");
});

test("buildProviderArgv(openai) unchanged — codex stdin", () => {
  const b = buildProviderArgv("openai", "gpt-5.6-sol", ["-c", "model_reasoning_effort=high"]);
  assert.equal(b.toolId, "codex");
  assert.equal(b.usesStdin, true);
  assert.ok(b.argv.includes("exec") && b.argv.includes("-m") && b.argv.includes("gpt-5.6-sol") && b.argv.includes("-"));
});
test("buildProviderArgv(gemini) → FAIL-CLOSED (the individual gemini CLI is retired, ADR-0031)", () => {
  const b = buildProviderArgv("gemini", "gemini-3.1-pro-preview");
  assert.equal(b.fail, true);
  assert.match(b.error, /gemini|ARG_POLICY|safety kernel/i);
});
test("buildProviderArgv(unknown) → fail-closed (no unvetted spawn)", () => {
  const b = buildProviderArgv("mystery-provider", "x");
  assert.ok(b.fail === true && /not covered/.test(b.error));
});

test("runProvider(provider:antigravity) with agy absent → fail-closed fallback (branch wired)", () => {
  const r = runProvider("security-reviewer", "probe", { provider: "antigravity", strict: false, timeoutMs: 5000, cliAvailable: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.fallback, true, "an absent agy must fall back (BLOCKED-ON-OPERATOR), not hard-fail");
  assert.ok(!/custom cfg\.syntax not covered/.test(r.error || ""), "antigravity must NOT hit the unknown-provider branch — its branch is wired");
  assert.ok(/not found/.test(r.error || ""), "the forced-unavailable seam drives the CLI-absent fail-closed reason (seam is load-bearing)");
});

if (failures.length) {
  process.stderr.write(`FAIL [providers-antigravity.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [providers-antigravity.test] ${passed} passed (agy seam; liveness operator-owned)\n`);
