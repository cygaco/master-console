"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const MOD = require("./provider-invocation-parity");

function fenced(cmd) {
  return "prose before the fence\n```\n" + cmd + "\n```\nprose after";
}
function cellWithProse(cmd, prose) {
  return `| \`x\` | \`y\` | \`${cmd}\` (${prose}) | auth |`;
}
function codes(text) {
  return MOD.computeFindings({ docs: [{ name: "FIXTURE.md", text }] }).findings.map((f) => f.code);
}

test("real provider docs match buildProviderArgv (0-false-reject)", () => {
  const res = MOD.computeFindings();
  assert.strictEqual(res.ok, true, `real docs must be parity-clean; got: ${JSON.stringify(res.findings)}`);
  assert.ok(res.checkedCount >= 3, `must have checked the real invocation strings; checked ${res.checkedCount}`);
});

test("codeShape derives usesStdin + prompt-flag + tool-id from buildProviderArgv", () => {
  const codex = MOD.codeShape("openai", "gpt-5.5");
  assert.strictEqual(codex.toolId, "codex");
  assert.strictEqual(codex.usesStdin, true, "codex prompt is on stdin");
  assert.ok(codex.hasStdinDash, "codex argv carries the trailing '-'");
  assert.strictEqual(codex.promptFlag, null, "a stdin provider has no prompt-flag");
  assert.ok(codex.longFlags.has("--sandbox") && !codex.longFlags.has("--ask-for-approval"));
  const agy = MOD.codeShape("antigravity", "gemini-3.1-pro-high");
  assert.strictEqual(agy.toolId, "agy");
  assert.strictEqual(agy.usesStdin, false, "agy prompt is on the -p argv value");
  assert.strictEqual(agy.promptFlag, "-p", "the prompt-flag is DERIVED from the argv (token before the prompt), not hardcoded");
});

test("F1: agy drift `agy [--model <model>]` (prompt on stdin) → RED", () => {
  assert.deepStrictEqual(codes(cellWithProse("agy [--model <model>]", "prompt on stdin")), ["prompt_delivery_mismatch"]);
});
test("F1: agy with the stdin '-' + trailing parenthetical (prose after the code span) → RED", () => {
  assert.deepStrictEqual(codes(cellWithProse("agy --model <n> --print-timeout <d> -", "prompt on stdin")), ["prompt_delivery_mismatch"]);
});
test("F1: codex shown with -p (code is stdin) → RED", () => {
  assert.deepStrictEqual(codes(fenced("codex exec --sandbox workspace-write -m <model> -p '<prompt>'")), ["prompt_delivery_mismatch"]);
});
test("INCOMPLETE: an agy invocation missing -p, or a codex invocation missing the trailing '-', → RED", () => {
  assert.deepStrictEqual(codes(fenced("agy --model <name> --print-timeout 90s")), ["prompt_delivery_mismatch"]);
  assert.deepStrictEqual(codes(fenced("codex exec --sandbox workspace-write -m <model>")), ["prompt_delivery_mismatch"]);
});
test("CONTRADICTORY: an agy invocation showing BOTH -p and a bare stdin '-' → RED", () => {
  assert.deepStrictEqual(codes(fenced("agy --model <n> --print-timeout 90s -p prompt -")), ["prompt_delivery_mismatch"]);
});
test("CONTRADICTORY: a codex STDIN invocation ALSO showing an argv '-p' flag → RED (symmetric)", () => {
  assert.deepStrictEqual(codes(fenced("codex exec --sandbox workspace-write -m <model> -p '<prompt>' -")), ["prompt_delivery_mismatch"]);
});

test("correct shapes are GREEN: agy -p argv, codex trailing '-' stdin (fenced + table)", () => {
  assert.deepStrictEqual(codes(fenced("agy --model <name> --print-timeout 90s -p '<prompt>'")), []);
  assert.deepStrictEqual(codes(fenced("codex exec --sandbox workspace-write -m <model> -")), []);
  assert.deepStrictEqual(codes(cellWithProse("agy --model <name> --print-timeout <dur> -p '<prompt>'", "prompt on the -p argv value, NOT stdin")), []);
});

test("F2: codex invocation carrying --ask-for-approval (not in the real argv) → stale_flag", () => {
  assert.ok(codes(fenced("codex exec --sandbox workspace-write --ask-for-approval never -m <model> -")).includes("stale_flag"));
});
test("a bracketed-optional [-c …] flag is NOT asserted mandatory (no false stale_flag)", () => {
  assert.deepStrictEqual(codes(fenced("codex exec --sandbox workspace-write [-c model_reasoning_effort=high] -m <model> -")), []);
});

test("prose mentioning `agy --allowedTools` outside a fence/table is NOT flagged", () => {
  const prose = "agy has NO per-tool permission mechanism — no --allowedTools, no --dangerously-skip-permissions.";
  assert.deepStrictEqual(codes(prose), []);
});
test("a trailing parenthetical after a CORRECT code span does not cause a false RED", () => {
  assert.deepStrictEqual(codes(cellWithProse("agy --model <name> --print-timeout <dur> -p '<prompt>'", "prompt on the `-p` argv value, NOT stdin — agy has no stdin -")), []);
});

test("extractInvocations takes the backticked code span only (drops trailing prose)", () => {
  const invs = MOD.extractInvocations(cellWithProse("agy --model x -p y", "prompt on the -p value"), "agy");
  assert.strictEqual(invs.length, 1);
  assert.strictEqual(invs[0].cmd, "agy --model x -p y", "the extracted cmd must NOT include the trailing parenthetical prose");
});
test("hasBareStdinDash detects a whitespace-bounded '-' anywhere, not just at end", () => {
  assert.strictEqual(MOD.hasBareStdinDash("codex exec -m m -"), true);
  assert.strictEqual(MOD.hasBareStdinDash("agy --model x - (prompt on stdin)"), true, "mid-string bare '-' before prose");
  assert.strictEqual(MOD.hasBareStdinDash("agy --model x -p y"), false, "'-p' is not a bare '-'");
});
test("docMandatoryLongFlags excludes bracketed-optional segments", () => {
  const flags = MOD.docMandatoryLongFlags("codex exec --sandbox [-c x --extra] -m <m> -");
  assert.ok(flags.has("--sandbox"));
  assert.ok(!flags.has("--extra"), "flags inside [ … ] are optional, not asserted");
});
