"use strict";
const assert = require("assert");
const { claudeServeOk, codexServeOk, isSafeModelId } = require("./delta-canonical-dispatch-smoke");

let passed = 0;
function check(name, got, wantOk) {
  assert.strictEqual(got.ok, wantOk, `${name}: expected ok=${wantOk}, got ${JSON.stringify(got)}`);
  passed++;
}

const M = "claude-opus-5";
const success = (reply, model = M) =>
  JSON.stringify({
    is_error: false,
    subtype: "success",
    type: "result",
    result: reply,
    modelUsage: { [model]: { canonicalModel: model } },
  });

check("success OK", claudeServeOk(0, success("OK"), M, "OK"), true);
check("success OK.", claudeServeOk(0, success("OK."), M, "OK"), true);
check("success lowercase ok", claudeServeOk(0, success("ok"), M, "OK"), true);

const refusalReply =
  "I'm not going to run that. That prompt looks like a shell command substitution, which isn't ok to execute blindly.";
assert.ok(/OK/i.test(refusalReply), "fixture sanity: the old loose /OK/ WOULD have false-greened this refusal");
check("planted refusal -> RED (old false-green now caught)", claudeServeOk(0, success(refusalReply), M, "OK"), false);
passed++;

check("is_error true -> RED", claudeServeOk(0, JSON.stringify({ is_error: true, subtype: "success", result: "OK", modelUsage: { [M]: { canonicalModel: M } } }), M, "OK"), false);
check("subtype error -> RED", claudeServeOk(0, JSON.stringify({ is_error: false, subtype: "error_max_turns", result: "OK", modelUsage: { [M]: { canonicalModel: M } } }), M, "OK"), false);
check("silent fallback to opus-4-8 -> RED", claudeServeOk(0, success("OK", "claude-opus-4-8"), M, "OK"), false);
check("non-json envelope -> RED", claudeServeOk(0, "I'm not going to run that.", M, "OK"), false);
check("non-zero exit -> RED", claudeServeOk(1, success("OK"), M, "OK"), false);
check("empty reply -> RED", claudeServeOk(0, success(""), M, "OK"), false);
check("missing modelUsage -> RED", claudeServeOk(0, JSON.stringify({ is_error: false, subtype: "success", result: "OK" }), M, "OK"), false);

check("opus-4-8 asked + served -> GREEN", claudeServeOk(0, success("OK", "claude-opus-4-8"), "claude-opus-4-8", "OK"), true);

for (const bad of ["gpt-6.1-sol; rm -rf /", "x && calc", "`id`", "$(id)", "a b", "-m", "", "gpt\n5", "a|b"]) {
  assert.strictEqual(isSafeModelId(bad), false, `isSafeModelId must refuse ${JSON.stringify(bad)}`);
  passed++;
}
for (const good of ["gpt-5.6-sol", "gpt-6.1-sol", "gpt-6-luna"]) {
  assert.strictEqual(isSafeModelId(good), true);
  passed++;
}
const HDR = (m) => `OpenAI Codex v0.160.0\n--------\nworkdir: C:\\x\nmodel: ${m}\nprovider: openai\napproval: never\n`;
check("codex CLI model == requested -> GREEN", codexServeOk(0, "OK gpt-6.1-sol", "gpt-6.1-sol", HDR("gpt-6.1-sol")), true);
check("self-report shape: CLI model == requested, self-report 'gpt-5' -> GREEN (self-report is information only)", codexServeOk(0, "OK gpt-5", "gpt-5.6-sol", HDR("gpt-5.6-sol")), true);
check("codex CLI model != requested (silent alias/upgrade) -> RED", codexServeOk(0, "OK gpt-5.6-sol", "gpt-5.6-sol", HDR("gpt-6.1-sol")), false);
check("codex printed no model line -> RED", codexServeOk(0, "OK gpt-5.6-sol", "gpt-5.6-sol", ""), false);
check("codex non-zero exit -> RED", codexServeOk(1, "OK gpt-5.6-sol", "gpt-5.6-sol", HDR("gpt-5.6-sol")), false);
check("codex refusal prose (contains 'ok' but does not start with it) -> RED", codexServeOk(0, "I can't say, that is not ok to share", "gpt-5.6-sol", HDR("gpt-5.6-sol")), false);

console.log(`OK   [delta-canonical-dispatch-smoke.test] ${passed} passed`);
