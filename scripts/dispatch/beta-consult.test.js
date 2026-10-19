#!/usr/bin/env node
"use strict";
const assert = require("assert");
const { parseVerdict, buildContext, attestRanOnGpt } = require("./beta-consult");
const { suggestFallbackProvider, PROVIDER_FAMILY } = require("../hooks/lib/providers");

let passed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}

test("openai + {fallback:openai} → claude (never same-family)", () => {
  assert.equal(suggestFallbackProvider("openai", { fallback: "openai" }), "claude");
});
test("antigravity + {fallback:antigravity} → openai (never same google family)", () => {
  assert.equal(suggestFallbackProvider("antigravity", { fallback: "antigravity" }), "openai");
});
test("openai + {fallback:antigravity} → antigravity (a DIFFERENT-family configured fallback is honored)", () => {
  assert.equal(suggestFallbackProvider("openai", { fallback: "antigravity" }), "antigravity");
});
test("every provider's suggested fallback is a DIFFERENT known family (exhaustive)", () => {
  for (const failed of Object.keys(PROVIDER_FAMILY)) {
    for (const cfg of [null, { fallback: failed }, { fallback: "openai" }, { fallback: "claude" }, { fallback: "bogus" }]) {
      const t = suggestFallbackProvider(failed, cfg);
      assert.ok(PROVIDER_FAMILY[t], `${failed}/${JSON.stringify(cfg)} → ${t} is not a known provider`);
      assert.notEqual(PROVIDER_FAMILY[t], PROVIDER_FAMILY[failed], `${failed}/${JSON.stringify(cfg)} → ${t} is SAME family`);
    }
  }
});

test("a prose mention ('whether to DECIDE later') → null (no fail-open bare-token)", () => {
  assert.equal(parseVerdict("No required verdict line. I am discussing whether to DECIDE later."), null);
});
test("a real 'VERDICT: DECIDE' line → DECIDE", () => {
  assert.equal(parseVerdict("reasoning...\nVERDICT: DECIDE\ntrailing"), "DECIDE");
});
test("a quoted/markdown 'VERDICT: ESCALATE' (leading > * -) → ESCALATE", () => {
  assert.equal(parseVerdict("> VERDICT: ESCALATE"), "ESCALATE");
});
test("conflicting VERDICT lines → null (reject ambiguity)", () => {
  assert.equal(parseVerdict("VERDICT: DECIDE\n...\nVERDICT: ESCALATE"), null);
});
test("duplicate SAME verdict lines → the verdict (not a conflict)", () => {
  assert.equal(parseVerdict("VERDICT: DIRECTIVE\nVERDICT: DIRECTIVE"), "DIRECTIVE");
});
test("no verdict line at all → null", () => {
  assert.equal(parseVerdict("a long β analysis with no verdict token"), null);
});
test("'VERDICT: DECIDE or ESCALATE' → null (trailing text, not a dedicated verdict)", () => {
  assert.equal(parseVerdict("VERDICT: DECIDE or ESCALATE"), null);
});
test("two verdicts on one line 'VERDICT: DECIDE / VERDICT: ESCALATE' → null", () => {
  assert.equal(parseVerdict("VERDICT: DECIDE / VERDICT: ESCALATE"), null);
});
test("trailing whitespace after the token is still accepted", () => {
  assert.equal(parseVerdict("VERDICT: ESCALATE   "), "ESCALATE");
});

test("whitespace-only boundary → buildContext !ok", () => {
  assert.equal(buildContext({ boundary: "   ", claims: "real claim", precedentLines: 5 }).ok, false);
});
test("whitespace-only claims → buildContext !ok", () => {
  assert.equal(buildContext({ boundary: "B-1", claims: "\n\t ", precedentLines: 5 }).ok, false);
});
test("missing boundary → buildContext !ok", () => {
  assert.equal(buildContext({ boundary: null, claims: "c", precedentLines: 5 }).ok, false);
});

const CODEX_CMD = "codex exec --sandbox workspace-write -c model_reasoning_effort=high -m gpt-5.6-sol -";
test("real codex return (ok + openai + codex cmd + no fallback) → ran_on_gpt true", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: CODEX_CMD }).ranOnGpt, true);
});
test("provider openai but NO codex cmd (config-inferred) → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "" }).ranOnGpt, false);
});
test("result.ok false (a reap/stub, not a real return) → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: false, provider: "openai", cmd: CODEX_CMD }).ranOnGpt, false);
});
test("a claude fallback (fallback:true) → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: CODEX_CMD, fallback: true }).ranOnGpt, false);
});
test("a quotaFallbackFrom retry → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: CODEX_CMD, quotaFallbackFrom: { provider: "antigravity" } }).ranOnGpt, false);
});
test("provider claude → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "claude", cmd: "claude -p" }).ranOnGpt, false);
});

test("'codex login' (non-exec codex command) → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "codex login --with-api-key" }).ranOnGpt, false);
});
test("bare 'codex' → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "codex" }).ranOnGpt, false);
});
test("'codex-malicious exec' (prefix-spoof binary) → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "codex-malicious exec -m gpt-5.6-sol -" }).ranOnGpt, false);
});
test("'codex execute' (exec-prefix spoof subcommand) → ran_on_gpt false", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "codex execute -m gpt-5.6-sol -" }).ranOnGpt, false);
});
test("leading-whitespace 'codex exec …' still attests (shape preserved)", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "  codex exec -m gpt-5.6-sol -" }).ranOnGpt, true);
});
test("exact 'codex exec' with no trailing args still attests", () => {
  assert.equal(attestRanOnGpt({ ok: true, provider: "openai", cmd: "codex exec" }).ranOnGpt, true);
});

if (failures.length) {
  process.stderr.write(`FAIL [beta-consult.test] ${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`OK   [beta-consult.test] ${passed} passed\n`);
