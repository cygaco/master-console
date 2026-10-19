#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { harness } = require("../checks/lib/fixture-harness");
const { providerToolId, observedCompletionFields } = require("../dispatch-agent");

const h = harness("provider-tool-id");

h.test("providerToolId maps every known provider-id to its tool-id (incl. antigravity→agy)", () => {
  assert.strictEqual(providerToolId("openai"), "codex");
  assert.strictEqual(providerToolId("gemini"), "gemini");
  assert.strictEqual(providerToolId("antigravity"), "agy", "antigravity→agy");
});

h.test("providerToolId passes through an unknown provider-id (never throws / never null)", () => {
  assert.strictEqual(providerToolId("claude"), "claude");
  assert.strictEqual(providerToolId("some-future-provider"), "some-future-provider");
});

h.violation("negative control: a map missing antigravity→agy fails the reconcile assertion", () => {
  const brokenMap = { openai: "codex", gemini: "gemini" };
  const broken = (p) => brokenMap[p] ?? p;
  const wrong = broken("antigravity") !== "agy" ? ["antigravity→agy missing"] : [];
  return { violations: wrong };
});

h.test("observedCompletionFields: a normal run stamps the observed provider (codex/false)", () => {
  const f = observedCompletionFields("openai", { provider: "openai", fallback: false });
  assert.strictEqual(f.provider, "openai");
  assert.strictEqual(f.tool_id, "codex");
  assert.strictEqual(f.fallback, false);
});
h.test("observedCompletionFields: agy quota-fallback → openai stamps codex/fallback:true, NOT agy/false", () => {
  const f = observedCompletionFields("antigravity", {
    provider: "openai",
    fallback: false,
    quotaFallbackFrom: { provider: "antigravity", kind: "rate_limit" },
  });
  assert.strictEqual(f.provider, "openai", "must record the OBSERVED lab, not the requested agy");
  assert.strictEqual(f.tool_id, "codex", "tool_id must derive from the observed provider, not requested agy");
  assert.strictEqual(f.fallback, true, "a quota-fallback is a fallback for attestation (contracted lab didn't run)");
});
h.test("observedCompletionFields: an explicit runProvider fallback is marked fallback:true", () => {
  assert.strictEqual(observedCompletionFields("openai", { provider: "openai", fallback: true }).fallback, true);
});
h.test("observedCompletionFields: MISSING result.provider → unattestable (fallback:true), no false-agy", () => {
  const f = observedCompletionFields("antigravity", { ok: true, fallback: false });
  assert.strictEqual(f.fallback, true, "an identity-less dispatch must be unattestable (fallback:true)");
  const empty = observedCompletionFields("antigravity", { provider: "", ok: true, fallback: false });
  assert.strictEqual(empty.fallback, true, "an empty-string provider is also unattestable");
});

h.test("observedCompletionFields: agy AUTH-fallback tell forces fallback:true + stamps the explicit field", () => {
  const f = observedCompletionFields("antigravity", { provider: "antigravity", ok: true, fallback: false, auth_fallback: true });
  assert.strictEqual(f.fallback, true, "an unauthenticated agy serve (terminal tell) must be unattestable (fallback:true) — the false-green this closes");
  assert.strictEqual(f.auth_fallback, true, "the explicit auth_fallback field distinguishes an AUTH fallback from a provider/quota fallback (ADR-0025/0037)");
});
h.test("observedCompletionFields: agy indeterminate (unverifiable log) fails closed to fallback:true", () => {
  const f = observedCompletionFields("antigravity", { provider: "antigravity", ok: true, fallback: false, auth_fallback: "indeterminate" });
  assert.strictEqual(f.fallback, true, "an unverifiable agy serve fails closed");
  assert.strictEqual(f.auth_fallback, "indeterminate");
});
h.test("observedCompletionFields: a CLEAN agy serve is NOT demoted (no false-RED)", () => {
  const f = observedCompletionFields("antigravity", { provider: "antigravity", ok: true, fallback: false, auth_fallback: false });
  assert.strictEqual(f.fallback, false, "a clean agy serve must not be false-RED'd by the auth detector");
  assert.strictEqual(f.auth_fallback, false);
});
h.test("observedCompletionFields: a non-agy serve carries NO auth_fallback field", () => {
  const f = observedCompletionFields("openai", { provider: "openai", ok: true, fallback: false });
  assert.strictEqual("auth_fallback" in f, false, "auth_fallback is agy-only; non-agy records must not carry it");
});

h.violation("negative control: recording the REQUESTED provider on quota-fallback would false-attest agy", () => {
  const oldRecord = { provider: "antigravity", tool_id: "agy", fallback: false };
  const wouldFalseAttest = oldRecord.provider === "antigravity" && oldRecord.tool_id === "agy" && oldRecord.fallback === false;
  return { violations: wouldFalseAttest ? ["old shape false-attests agy on quota-fallback"] : [] };
});

h.done();
