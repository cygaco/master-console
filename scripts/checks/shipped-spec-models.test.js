"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { check, runLive } = require("./shipped-spec-models");

const registry = {
  roles: {
    "director-of-engineering": { provider: "claude", model: "claude-fable-5-1", effort: "high", spec: "doe.md" },
    beta: { provider: "openai", model: "gpt-6.1-sol", effort: "high", spec: "beta.md" },
    "skeleton-builder": { provider: "claude", model: "claude-sonnet-5-5", effort: null, spec: "skel.md" },
  },
};
const defaultPreset = {
  chains: {
    "director-of-engineering": [{ provider: "claude", model: "claude-fable-5-1", effort: "high" }, { provider: "claude", model: "claude-opus-5-5", effort: "high" }],
    beta: [{ provider: "openai", model: "gpt-6.1-sol", effort: "high" }, { provider: "antigravity", model: "gemini-4-argon-high", effort: null }, { provider: "claude", model: "claude-opus-5-5", effort: "high" }],
    "skeleton-builder": [{ provider: "claude", model: "claude-sonnet-5-5", effort: null }, { provider: "claude", model: "claude-opus-5-5", effort: null }],
  },
};
const spec = (model, effort) => `---\nname: x\nmodel: ${model}\n${effort ? `effort: ${effort}\n` : ""}---\nbody\n`;
const files = (over) => ({
  "doe.md": spec("claude-fable-5-1", "high"),
  "beta.md": "---\nname: beta\nmodel: claude-opus-5-5\neffort: high\nprovider: openai\nprovider_model: gpt-6.1-sol\nprovider_reasoning_effort: high\n---\nbody\n",
  "skel.md": spec("claude-sonnet-5-5", null),
  ...(over || {}),
});
const run = (over) => check({ registry, defaultPreset, readSpec: (rel) => { const f = files(over); if (!(rel in f)) { const e = new Error("x"); e.code = "ENOENT"; throw e; } return f[rel]; } });

test("GREEN: specs equal the default preset's in-process answer", () => {
  const r = run();
  assert.deepStrictEqual(r.findings, []);
  assert.strictEqual(r.checked, 3);
});

test("RED: a planted instance pin (Fable 5.2 on director-of-engineering) would be published", () => {
  const r = run({ "doe.md": spec("claude-fable-5-2", "high") });
  assert.ok(r.findings.some((f) => f.role === "director-of-engineering" && /claude-fable-5-2.*instance pin/.test(f.detail)), JSON.stringify(r.findings));
});

test("RED: an effort that differs from the default, and an unreadable spec", () => {
  const r = run({ "beta.md": spec("claude-opus-5-5", "xhigh") });
  assert.ok(r.findings.some((f) => f.role === "beta" && /effort/.test(f.detail)));
  const r2 = check({ registry, defaultPreset, readSpec: () => { const e = new Error("gone"); e.code = "ENOENT"; throw e; } });
  assert.strictEqual(r2.findings.length, 3);
});

test("RED: the CLI half of an instance pin (provider / provider_model) would be published", () => {
  const cliSpec = (prov, model, eff) => `---\nname: x\nmodel: claude-opus-5-5\neffort: high\nprovider: ${prov}\nprovider_model: ${model}\n${eff ? `provider_reasoning_effort: ${eff}\n` : ""}---\n`;
  assert.deepStrictEqual(run({ "beta.md": cliSpec("openai", "gpt-6.1-sol", "high") }).findings, []);
  const m = run({ "beta.md": cliSpec("openai", "gpt-6-astra", "high") });
  assert.ok(m.findings.some((f) => f.role === "beta" && /provider_model "gpt-6-astra"/.test(f.detail)), JSON.stringify(m.findings));
  const p = run({ "beta.md": cliSpec("antigravity", "gemini-4-argon-high", null) });
  assert.ok(p.findings.some((f) => f.role === "beta" && /provider "antigravity"/.test(f.detail)), JSON.stringify(p.findings));
  const e = run({ "beta.md": cliSpec("openai", "gpt-6.1-sol", "xhigh") });
  assert.ok(e.findings.some((f) => f.role === "beta" && /provider_reasoning_effort "xhigh"/.test(f.detail)), JSON.stringify(e.findings));
  const c = run({ "doe.md": `---\nname: x\nmodel: claude-fable-5-1\neffort: high\nprovider: openai\nprovider_model: gpt-6.1-sol\n---\n` });
  assert.ok(c.findings.some((f) => f.role === "director-of-engineering" && /provider "openai"/.test(f.detail)), JSON.stringify(c.findings));
});

test("live tree: the shipped specs carry the product default", () => {
  const r = runLive();
  assert.deepStrictEqual(r.findings, [], JSON.stringify(r.findings));
  assert.strictEqual(r.checked, 35);
});

test("RED: a planted agentProviders pin in the shipped manifest would be published", () => {
  const { checkManifest } = require("./shipped-spec-models");
  assert.deepStrictEqual(checkManifest({ agentProviders: {} }), [], "the empty template is clean");
  assert.deepStrictEqual(checkManifest({}), [], "no agentProviders key is clean");
  const f = checkManifest({ agentProviders: { "director-of-engineering": { provider: "claude", model: "claude-fable-5-2", effort: "high" } } });
  assert.strictEqual(f.length, 1);
  assert.match(f[0].detail, /pins director-of-engineering .* would be published/);
  assert.strictEqual(checkManifest({ agentProviders: { beta: "openai" } }).length, 1, "a legacy string pin is a pin too");
});

test("RED: a feature file or a shipped preset missing from the public allowlist is a finding", () => {
  const { checkShipCoverage, FEATURE_SHIP_SET } = require("./shipped-spec-models");
  const full = new Set([...FEATURE_SHIP_SET, ".claude/agents/_org/presets/default.json"]);
  assert.deepStrictEqual(checkShipCoverage(full, [".claude/agents/_org/presets/default.json"]), []);
  const missing = new Set(full);
  missing.delete("scripts/dispatch/signin.js");
  const f = checkShipCoverage(missing, [".claude/agents/_org/presets/default.json", ".claude/agents/_org/presets/new-overlay.json"]);
  assert.deepStrictEqual(f.map((x) => x.detail.split(" ")[0]).sort(), [".claude/agents/_org/presets/new-overlay.json", "scripts/dispatch/signin.js"]);
});
