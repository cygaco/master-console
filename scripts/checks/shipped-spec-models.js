#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

function defaultInProcess(chain) {
  const e = Array.isArray(chain) ? chain.find((x) => x && x.provider === "claude") : null;
  return e ? { model: e.model, effort: e.effort === undefined ? null : e.effort } : null;
}

function fmValue(text, key) {
  const fm = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const m = fm[1].match(new RegExp(`^${key}:\\s*["']?([^"'\\s#]+)`, "m"));
  return m ? m[1] : null;
}

function check({ registry, defaultPreset, readSpec }) {
  const findings = [];
  let checked = 0;
  const roles = (registry && registry.roles) || {};
  for (const [role, r] of Object.entries(roles)) {
    if (!r || typeof r !== "object" || !r.spec) continue;
    checked++;
    const want = defaultInProcess(defaultPreset && defaultPreset.chains && defaultPreset.chains[role]);
    if (!want) {
      findings.push({ role, spec: r.spec, detail: "the default preset has no Claude entry for this role" });
      continue;
    }
    let text;
    try {
      text = readSpec(r.spec);
    } catch (e) {
      findings.push({ role, spec: r.spec, detail: `the spec cannot be read (${(e && e.code) || "error"})` });
      continue;
    }
    const model = fmValue(text, "model");
    const effort = fmValue(text, "effort");
    if (model !== want.model) {
      findings.push({ role, spec: r.spec, detail: `ships model "${model}", the product default is "${want.model}" — an instance pin would be published` });
    }
    if ((effort || null) !== (want.effort || null)) {
      findings.push({ role, spec: r.spec, detail: `ships effort "${effort}", the product default is "${want.effort}"` });
    }
    const head = defaultPreset.chains[role][0] || {};
    const cli = {
      provider: fmValue(text, "provider"),
      provider_model: fmValue(text, "provider_model"),
      provider_reasoning_effort: fmValue(text, "provider_reasoning_effort"),
      provider_fallback: fmValue(text, "provider_fallback"),
    };
    const headEffort = head.effort === undefined ? null : head.effort;
    const pinLeak = (k, got, want) =>
      findings.push({ role, spec: r.spec, detail: `ships ${k} "${got}", the product default is "${want}" — an instance pin would be published` });
    if (head.provider && head.provider !== "claude") {
      if (cli.provider !== head.provider) pinLeak("provider", cli.provider, head.provider);
      if (cli.provider_model !== head.model) pinLeak("provider_model", cli.provider_model, head.model);
      if (cli.provider_reasoning_effort && cli.provider_reasoning_effort !== headEffort) pinLeak("provider_reasoning_effort", cli.provider_reasoning_effort, headEffort);
      if (cli.provider_fallback && cli.provider_fallback !== (r.fallback || "claude")) pinLeak("provider_fallback", cli.provider_fallback, r.fallback || "claude");
    } else {
      if (cli.provider && cli.provider !== "claude") pinLeak("provider", cli.provider, "claude");
      if (cli.provider_model) pinLeak("provider_model", cli.provider_model, "(none)");
      if (cli.provider_reasoning_effort && cli.provider_reasoning_effort !== headEffort) pinLeak("provider_reasoning_effort", cli.provider_reasoning_effort, headEffort);
    }
  }
  return { ok: findings.length === 0, findings, checked };
}

function checkManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return [];
  const ap = manifest.agentProviders;
  if (ap === undefined) return [];
  if (!ap || typeof ap !== "object" || Array.isArray(ap)) {
    return [{ role: "(manifest)", spec: ".claude/manifest.json", detail: "agentProviders is not an object" }];
  }
  return Object.keys(ap).map((role) => ({
    role,
    spec: ".claude/manifest.json",
    detail: `the shipped manifest pins ${role} (${JSON.stringify(ap[role])}); a project pin would be published — remove it (node scripts/dispatch.js set ${role} --default)`,
  }));
}

const FEATURE_SHIP_SET = Object.freeze([
  "scripts/dispatch/model-resolve.js",
  "scripts/dispatch/signin.js",
  "scripts/dispatch/presets.js",
  "scripts/dispatch/effective-pin.js",
  "scripts/dispatch/harness-spawn-model.js",
  "scripts/dispatch/catalog.js",
  "scripts/dispatch/save.js",
  "scripts/dispatch-agent.js",
  "scripts/hooks/agent-spawn-model-guard.js",
  "scripts/checks/model-resolution.js",
  "scripts/checks/model-resolution-readers.js",
  "scripts/checks/model-resolution.readers.json",
  "scripts/checks/shipped-spec-models.js",
  ".claude/commands/scan/model-resolution.md",
]);

function checkShipCoverage(allow, presetFiles) {
  const want = [...FEATURE_SHIP_SET, ...(presetFiles || [])];
  return want
    .filter((rel) => !allow.has(rel))
    .map((rel) => ({ role: "(public allowlist)", spec: "scripts/public-repo/allowlist.txt", detail: `${rel} is needed by the model presets but is not on the public allowlist, so the public product would ship without it` }));
}

function runLive(root) {
  const base = root || ROOT;
  const registry = JSON.parse(fs.readFileSync(path.join(base, ".claude/agents/_org/role-registry.json"), "utf8").replace(/^﻿/, ""));
  const presets = require(path.join(base, "scripts/dispatch/presets.js"));
  const defaultPreset = presets.loadPreset(presets.DEFAULT_PRESET_ID, { projectRoot: base });
  const res = check({ registry, defaultPreset, readSpec: (rel) => fs.readFileSync(path.join(base, rel), "utf8") });
  let manifest = null;
  const mf = path.join(base, ".claude", "manifest.json");
  if (fs.existsSync(mf)) {
    try {
      manifest = JSON.parse(fs.readFileSync(mf, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      res.findings.push({ role: "(manifest)", spec: ".claude/manifest.json", detail: `the shipped manifest is not valid JSON (${e.message})` });
    }
  }
  res.findings.push(...checkManifest(manifest));
  const allowFile = path.join(base, "scripts", "public-repo", "allowlist.txt");
  if (fs.existsSync(allowFile)) {
    const allow = new Set(fs.readFileSync(allowFile, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
    const presetDir = path.join(base, ".claude", "agents", "_org", "presets");
    const presetFiles = fs.existsSync(presetDir)
      ? fs.readdirSync(presetDir).filter((f) => f.endsWith(".json")).map((f) => `.claude/agents/_org/presets/${f}`)
      : [];
    res.findings.push(...checkShipCoverage(allow, presetFiles));
  }
  res.ok = res.findings.length === 0;
  return res;
}

function main(argv) {
  let res;
  try {
    res = runLive();
  } catch (e) {
    process.stderr.write(`shipped-spec-models: could not run (${e && e.message})\n`);
    return 2;
  }
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
    return res.ok ? 0 : 1;
  }
  for (const f of res.findings) process.stderr.write(`FAIL ${f.role} (${f.spec}): ${f.detail}\n`);
  process.stdout.write(`${res.ok ? "OK  " : "FAIL"} [shipped-spec-models] ${res.checked} role specs checked against the default preset; ${res.findings.length} finding(s)\n`);
  return res.ok ? 0 : 1;
}

module.exports = { check, checkManifest, checkShipCoverage, FEATURE_SHIP_SET, runLive, defaultInProcess };

if (require.main === module) process.exit(main(process.argv.slice(2)));
