#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { evaluateAttestation, providerForModel, probeShape, norm } = require("./cert-attest");

let passed = 0;
const failures = [];
const skipped = [];
class SkipTest extends Error {}
function test(name, fn) {
  try { fn(); passed++; } catch (e) {
    if (e instanceof SkipTest) skipped.push(`${name}: ${e.message}`);
    else failures.push(`${name}: ${e.message}`);
  }
}

const catalog = {
  getProvider: (id) => (id === "openai" ? { models: [{ id: "gpt-5.6-sol" }, { id: "gpt-5.5" }] } : null),
  PROVIDER_LIST: [{ id: "openai", models: [{ id: "gpt-5.6-sol" }, { id: "gpt-5.5" }] }],
  normalizeProviderId: (x) => x,
};

test("requested model in output + exit ok → ATTESTED", () => {
  const v = evaluateAttestation({
    requestedModel: "gpt-5.6-sol",
    providerId: "openai",
    output: "model: gpt-5.6-sol\nreasoning effort: low\nPROBE OK",
    exitOk: true,
    catalog,
  });
  assert.ok(v.attested === true, v.reason);
});

test("output names the DEFAULT model, not the requested → FAIL (trap caught)", () => {
  const v = evaluateAttestation({
    requestedModel: "gpt-5.6-sol",
    providerId: "openai",
    output: "model: gpt-5.5\nreasoning effort: low\nPROBE OK",
    exitOk: true,
    catalog,
  });
  assert.ok(v.attested === false && /different model/i.test(v.reason) && v.effective === "gpt-5.5", v.reason);
});

test("non-zero exit → FAIL", () => {
  const v = evaluateAttestation({ requestedModel: "gpt-5.6-sol", providerId: "openai", output: "boom", exitOk: false, catalog });
  assert.ok(v.attested === false && /exit/i.test(v.reason), v.reason);
});

test("empty output → FAIL", () => {
  const v = evaluateAttestation({ requestedModel: "gpt-5.6-sol", providerId: "openai", output: "", exitOk: true, catalog });
  assert.ok(v.attested === false && /empty/i.test(v.reason), v.reason);
});

test("no model id in output → inconclusive FAIL-CLOSED", () => {
  const v = evaluateAttestation({ requestedModel: "gpt-5.6-sol", providerId: "openai", output: "PROBE OK", exitOk: true, catalog });
  assert.ok(v.attested === false && /inconclusive/i.test(v.reason), v.reason);
});

test("case/format-insensitive model match → ATTESTED", () => {
  const v = evaluateAttestation({ requestedModel: "gpt-5.6-sol", providerId: "openai", output: "Model: GPT-5.6-SOL", exitOk: true, catalog });
  assert.ok(v.attested === true, v.reason);
});

test("providerForModel resolves from the real catalog", () => {
  const real = require("../dispatch/catalog.js");
  assert.equal(providerForModel(real, "gpt-5.6-sol"), "openai");
  assert.equal(providerForModel(real, "gemini-3.1-pro-high"), "antigravity");
  assert.equal(providerForModel(real, "claude-fable-5"), "claude");
  assert.equal(providerForModel(real, "no-such-model-xyz"), null);
});
test("probeShape: openai=codex stdin, antigravity=agy prompt-arg + slug→display", () => {
  const o = probeShape("openai", "gpt-5.6-sol", "low");
  assert.ok(o.toolId === "codex" && o.argv.includes("-m") && o.argv.includes("gpt-5.6-sol") && o.stdin === true);
  const a = probeShape("antigravity", "gemini-3.1-pro-high", null);
  assert.ok(a.toolId === "agy" && a.stdin === false);
  const mIdx = a.argv.indexOf("--model");
  assert.ok(mIdx >= 0, "--model present");
  assert.equal(a.argv[mIdx + 1], "Gemini 3.1 Pro (High)", "cert-attest probe must send agy the DISPLAY name");
  assert.ok(!a.argv.includes("gemini-3.1-pro-high"), "the raw slug must NEVER reach agy --model");
});

test("requested id present BUT log shows default/unauth → FAIL (served-model unverifiable)", () => {
  const agyLog = [
    "Model ID gemini-3.1-pro-high not in local config, defaulting to CCPA",
    "Model resolved via default",
    "error getting token source: You are not logged into Antigravity.",
    "Entering local chrome mode! This is WRONG unless you are running tests or in eval mode",
  ].join("\n");
  const v = evaluateAttestation({ requestedModel: "gemini-3.1-pro-high", providerId: "antigravity", output: "PROBE OK\n" + agyLog, exitOk: true, catalog });
  assert.equal(v.attested, false, "a defaulted/unauthenticated serve must NOT attest even though the requested id is echoed");
  assert.ok(v.defaultSignal === true, "the default/unauth signal must be the fail-closed reason");
});
test("negative control: requested echo + a resolved-via-default signal → FAIL", () => {
  const v = evaluateAttestation({ requestedModel: "gemini-3.1-pro-high", providerId: "antigravity", output: "requested gemini-3.1-pro-high; resolved via default; served a fallback model", exitOk: true, catalog });
  assert.equal(v.attested, false, "requested-echo + a default/fallback signal must fail-closed (no false-green on a conflicting serve)");
});
test("no over-block: a CLEAN authenticated serve (served self-id header) still ATTESTS", () => {
  const v = evaluateAttestation({ requestedModel: "gpt-5.6-sol", providerId: "openai", output: "model: gpt-5.6-sol\nserved ok\nPROBE OK", exitOk: true, catalog });
  assert.equal(v.attested, true, "a clean served self-id must still attest (fail-closed must not over-block)");
});
test("a novel unauth variant (echo only, no known bad string) FAILS on positive-proof", () => {
  const v = evaluateAttestation({ requestedModel: "gemini-3.1-pro-high", providerId: "antigravity", output: "Requested model gemini-3.1-pro-high. Backend engaged: house-model-x. PROBE OK", exitOk: true, catalog });
  assert.equal(v.attested, false, "a bare request echo with no served self-id must fail-closed (positive-proof, not blocklist)");
  assert.equal(v.servedSelfId, false, "GATE 2 must record the absence of a served self-id");
});
test("a request ECHO ('Model ID <id> queued') is distinguished from a SERVE and FAILS", () => {
  const v = evaluateAttestation({ requestedModel: "gemini-3.1-pro-high", providerId: "antigravity", output: "Model ID gemini-3.1-pro-high queued. PROBE OK", exitOk: true, catalog });
  assert.equal(v.attested, false, "'Model ID <id>' (echo) is not a served self-id — the bare word 'model' must not attest");
});
test("agy HONEST-CEILING: even a clean-looking agy log ('Model resolved: <id>') does NOT attest (client-echo, never trusted)", () => {
  const v = evaluateAttestation({ requestedModel: "gemini-3.1-pro-high", providerId: "antigravity", output: "Model resolved: gemini-3.1-pro-high\nauthenticated\nPROBE OK", exitOk: true, catalog });
  assert.equal(v.attested, false, "cert-attest refuses to attest agy from its log — no client line is trusted (honest-ceiling)");
  assert.equal(v.honestCeiling, true, "the reason is the honest-ceiling");
});

const AGY_UNAUTH_WITH_FAKE_AUTH = 'error getting token source: You are not logged into Antigravity.\nModel ID Gemini 3.1 Pro (High) not in local config, defaulting to CCPA\nModel resolved via default';
test("agy unauth signals + a DECEPTIVE auth line + backend-label echo → FAIL non-sliceable (the false-green class)", () => {
  const v = evaluateAttestation({
    requestedModel: "Gemini 3.1 Pro (High)", providerId: "antigravity",
    output: AGY_UNAUTH_WITH_FAKE_AUTH + '\nChainedAuth: authenticated via keyring\nOAuth: authenticated successfully as user@x\nPropagating selected model override to backend: label="Gemini 3.1 Pro (High)"\nSERVING-CHECK-OK',
    exitOk: true, catalog,
  });
  assert.equal(v.attested, false, "unauth signals present → fail-closed even with a later auth line + backend-label (agy emits BOTH while unauthenticated): " + v.reason);
  assert.equal(v.defaultSignal, true, "GATE 1 must fire NON-sliceable on the terminal unauth signal");
});
test("agy HONEST-CEILING: even a CLEAN log with a backend-label serve does NOT attest (the label is a client echo)", () => {
  const v = evaluateAttestation({
    requestedModel: "Gemini 3.1 Pro (High)", providerId: "antigravity",
    output: 'ChainedAuth: authenticated via keyring\nOAuth: authenticated successfully as user@x\nPropagating selected model override to backend: label="Gemini 3.1 Pro (High)"\nSERVING-CHECK-OK',
    exitOk: true, catalog,
  });
  assert.equal(v.attested, false, "agy's backend-label is a client-side echo (emitted even unauthenticated) → never trusted; fail-closed by construction");
  assert.equal(v.honestCeiling, true, "the honest-ceiling is the reason (no client line is served-model proof)");
});
test("unauth signal AFTER the last auth line → still FAILS (order-awareness cuts one way only)", () => {
  const v = evaluateAttestation({
    requestedModel: "Gemini 3.1 Pro (High)", providerId: "antigravity",
    output: 'ChainedAuth: authenticated via keyring\nsession expired\nerror getting token source: You are not logged into Antigravity.\nModel resolved via default\nPROBE OK',
    exitOk: true, catalog,
  });
  assert.equal(v.attested, false, "a post-auth unauth/default signal is REAL and must fail closed");
});
test("authenticated but a DIFFERENT display-name label served → FAILS (GATE 2 positive-proof backstop)", () => {
  const v = evaluateAttestation({
    requestedModel: "Gemini 3.1 Pro (High)", providerId: "antigravity",
    output: 'ChainedAuth: authenticated via keyring\nPropagating selected model override to backend: label="Gemini 3.5 Flash (Medium)"\nPROBE OK',
    exitOk: true, catalog,
  });
  assert.equal(v.attested, false, "a different served label must never attest the requested model");
});

test("mapping stays (slug→display) but agy honest-ceiling means neither slug nor display attests via the log", () => {
  const serve = 'ChainedAuth: authenticated via keyring\nOAuth: authenticated successfully\nPropagating selected model override to backend: label="Gemini 3.1 Pro (High)"\nPROBE OK';
  const real = require("../dispatch/catalog.js");
  assert.equal(real.agyModelName("gemini-3.1-pro-high"), "Gemini 3.1 Pro (High)", "resolver still maps slug→display for the dispatch --model boundary");
  const bySlug = evaluateAttestation({ requestedModel: "gemini-3.1-pro-high", providerId: "antigravity", output: serve, exitOk: true, catalog });
  const byDisplay = evaluateAttestation({ requestedModel: "Gemini 3.1 Pro (High)", providerId: "antigravity", output: serve, exitOk: true, catalog });
  assert.equal(bySlug.attested, false, "agy never attests from its log (honest-ceiling)");
  assert.equal(byDisplay.attested, false, "agy never attests even with the display name — the backend-label is a client echo, not trusted");
  assert.equal(byDisplay.honestCeiling, true, "the honest-ceiling is the reason");
});

test("filterAgyLogToRunWindow: drops cross-run stale + untimestamped lines, keeps in-window", () => {
  const { filterAgyLogToRunWindow } = require("./cert-attest");
  const now = new Date();
  const fmt = (d) => `I${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.100000 38760 x.go:1]`;
  const started = now.getTime();
  const inWindow = `${fmt(now)} in-window serve line`;
  const stale = `${fmt(new Date(started - 3600000))} STALE cross-run serve line`;
  const kept = filterAgyLogToRunWindow(`${stale}\n${inWindow}\nuntimestamped continuation`, started);
  assert.ok(kept.includes("in-window serve line"), "in-window line kept");
  assert.ok(!kept.includes("STALE"), "1h-stale cross-run line DROPPED (no serve-marker bleed)");
  assert.ok(!kept.includes("continuation"), "untimestamped continuation DROPPED");
});

if (failures.length) {
  process.stderr.write(`FAIL [cert-attest.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
if (skipped.length) process.stdout.write(`SKIP [cert-attest.test] ${skipped.length} skipped:\n${skipped.map((f) => `  - ${f}`).join("\n")}\n`);
process.stdout.write(`OK   [cert-attest.test] ${passed} passed, ${skipped.length} skipped (incl. run-window attribution)\n`);
