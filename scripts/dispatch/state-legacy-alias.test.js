"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { resolveModel } = require("./state");
const providers = require("../hooks/lib/providers");
const { PROVIDERS } = require("./catalog");

const saved = { flagship: process.env.OPENAI_FLAGSHIP_MODEL, mini: process.env.OPENAI_MINI_MODEL };
test.before(() => {
  delete process.env.OPENAI_FLAGSHIP_MODEL;
  delete process.env.OPENAI_MINI_MODEL;
});
test.after(() => {
  if (saved.flagship !== undefined) process.env.OPENAI_FLAGSHIP_MODEL = saved.flagship;
  if (saved.mini !== undefined) process.env.OPENAI_MINI_MODEL = saved.mini;
});

for (const role of ["reviewer", "compliance", "qa"]) {
  test(`legacy alias '${role}' resolves to its held model, not the openai default`, () => {
    const r = resolveModel(role, "openai", {});
    assert.strictEqual(r.model, providers.legacyAliasPin(role, "openai"));
    assert.strictEqual(r.modelSource, "legacy-alias-pin");
  });
}

test("a non-alias openai role without a frontmatter pin still falls to the provider default", () => {
  const r = resolveModel("some-new-role", "openai", {});
  assert.strictEqual(r.model, PROVIDERS.openai.defaultModel);
  assert.strictEqual(r.modelSource, "default");
});
