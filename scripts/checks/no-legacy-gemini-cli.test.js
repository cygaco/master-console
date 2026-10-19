"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { scanText, scanTree, FORBIDDEN } = require("./no-legacy-gemini-cli.js");

const neg = [
  '  gemini: { cli: "gemini", default_model: "x", syntax: "gemini {r} -m {model} -p" },',
  '  redteam: "gemini",',
  '  if (provider === "gemini") { doThing(); }',
  '  const TOOL_IDS = new Set(["claude", "codex", "gemini", "agy"]);',
  '  childEnv.GEMINI_API_KEY = loadKey();',
  '  if (process.env.GOOGLE_API_KEY) { useKey(); }',
  '  childEnv.GEMINI_CLI_TRUST_WORKSPACE = "true";',
  '  const trustArgs = ["--skip-trust"];',
  '  if (hasValidGeminiOAuth()) return;',
  '  const k = loadGeminiApiKey();',
  '  const geminiTrustBypass = env.MC_GEMINI_TRUST_BYPASS === "1";',
  '  execSync("gemini models list");',
  '  const r = runShell(`gemini -m ${model} --prompt ""`);',
  '  const version = execSync("gemini --version");',
].join("\n");
const pos = [
  "const ANTIGRAVITY = {",
  '  id: "antigravity",',
  '  cli: "agy",',
  '  default_model: process.env.ANTIGRAVITY_MODEL || "gemini-3.1-pro-high",',
  '  agyModelName: "Gemini 3.1 Pro (High)",',
  '  fallback: "openai",',
  '  syntax: "agy --model {model} --print-timeout 90s -p",',
  "};",
  'const roles = { "security-reviewer": { provider: "antigravity", model: "gemini-3.1-pro-high", effort: null } };',
  'const passes = [{ provider: "antigravity", model: "gemini-3.1-pro-high", key: "primary" }, { provider: "openai", model: "gpt-5.6-sol", key: "second_pass" }];',
  'const models = ["gemini-3.1-pro-high", "gemini-3.5-flash", "gemini-2.5-flash"];',
].join("\n");

test("negative fixtures: EVERY forbidden form is caught (no-narrow)", () => {
  const vios = scanText(neg);
  assert.ok(vios.length > 0, "negative fixtures produced no violations at all");
  const caught = new Set(vios.map((v) => v.form));
  for (const f of FORBIDDEN) {
    assert.ok(
      caught.has(f.form),
      `form '${f.form}' (${f.desc}) was NOT caught — the enforcer NARROWED. Caught: ${[...caught].join(", ")}`,
    );
  }
});

test("positive fixture: gemini-model-via-agy config is NOT flagged (no-widen)", () => {
  const vios = scanText(pos);
  assert.equal(
    vios.length,
    0,
    `the KEPT gemini-model-via-agy fixture was wrongly flagged (enforcer WIDENED): ${JSON.stringify(vios, null, 2)}`,
  );
});

test("live canonical tree is clean — the gate passes", () => {
  const vios = scanTree();
  assert.equal(
    vios.length,
    0,
    `live tree carries legacy-gemini-CLI wiring:\n${vios.map((v) => `  ${v.file}:${v.line} [${v.form}] ${v.snippet}`).join("\n")}`,
  );
});
