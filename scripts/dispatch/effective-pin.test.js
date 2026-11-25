"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ep = require("./effective-pin");

function setup({ manifest, spec, registry } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epin-"));
  const reg = registry !== undefined ? registry : JSON.stringify({
    _doc: "x",
    roles: {
      _doc: "skip me",
      builder: { provider: "claude", model: "claude-a", effort: "medium", spec: "specs/builder.md" },
      rev: { provider: "openai", model: "gpt-r", effort: "high", spec: "specs/rev.md" },
    },
  });
  const registryPath = path.join(dir, "reg.json");
  fs.writeFileSync(registryPath, reg);
  fs.mkdirSync(path.join(dir, "specs"));
  fs.writeFileSync(path.join(dir, "specs", "builder.md"), spec || "---\nmodel: claude-spec\neffort: low\n---\nbody\n");
  const manifestPath = path.join(dir, "manifest.json");
  if (manifest !== undefined) fs.writeFileSync(manifestPath, manifest);
  return { opts: { registryPath, manifestPath, projectRoot: dir }, manifestPath };
}
const man = (o) => JSON.stringify(o);

test("1 registry-only", () => {
  const { opts } = setup({ manifest: man({}) });
  assert.deepStrictEqual(ep.effectivePin("builder", opts),
    { role: "builder", provider: "claude", model: "claude-a", effort: "medium", source: "registry" });
});

test("2 project same provider -> frontmatter wins, registry fills gaps", () => {
  const { opts } = setup({ manifest: man({ agentProviders: { builder: "claude" } }) });
  const p = ep.effectivePin("builder", opts);
  assert.strictEqual(p.source, "project");
  assert.strictEqual(p.model, "claude-spec");
  assert.strictEqual(p.effort, "low");
  const g = setup({ manifest: man({ agentProviders: { builder: "claude" } }), spec: "---\nmodel: claude-only\n---\n" });
  const q = ep.effectivePin("builder", g.opts);
  assert.deepStrictEqual([q.model, q.effort], ["claude-only", "medium"]);
});

test("3 project openai from frontmatter", () => {
  const { opts } = setup({
    manifest: man({ agentProviders: { builder: "openai" } }),
    spec: "---\nmodel: claude-spec\nprovider_model: gpt-x\nprovider_reasoning_effort: high\n---\n",
  });
  const p = ep.effectivePin("builder", opts);
  assert.deepStrictEqual([p.provider, p.model, p.effort, p.source], ["openai", "gpt-x", "high", "project"]);
});

test("4 missing provider_model -> manifest default_model", () => {
  const { opts } = setup({
    manifest: man({ agentProviders: { builder: "openai" }, providers: { openai: { default_model: "gpt-def" } } }),
  });
  assert.strictEqual(ep.effectivePin("builder", opts).model, "gpt-def");
});

test("5 overlay wins and writes nothing", () => {
  const { opts, manifestPath } = setup({ manifest: man({ agentProviders: { builder: "openai" } }) });
  const before = fs.readFileSync(manifestPath);
  const p = ep.effectivePin("builder", { ...opts, overlay: { builder: { provider: "antigravity", model: "g-1", effort: "x" } } });
  assert.deepStrictEqual([p.provider, p.model, p.effort, p.source], ["antigravity", "g-1", "x", "overlay"]);
  assert.ok(before.equals(fs.readFileSync(manifestPath)));
});

test("6 missing manifest -> registry", () => {
  const { opts } = setup();
  assert.strictEqual(ep.effectivePin("builder", opts).source, "registry");
});

test("7 malformed manifest / registry throw", () => {
  const a = setup({ manifest: "{nope" });
  assert.throws(() => ep.effectivePin("builder", a.opts), /manifest/);
  const b = setup({ manifest: man({}), registry: "{bad" });
  assert.throws(() => ep.effectivePin("builder", b.opts), /reg\.json/);
});

test("8 unknown provider throws", () => {
  const { opts } = setup({ manifest: man({ agentProviders: { builder: "opeanai" } }) });
  assert.throws(() => ep.effectivePin("builder", opts), /opeanai/);
});

test("9 prototype role ids", () => {
  const { opts } = setup({ manifest: '{"agentProviders": {"__proto__": "openai"}}' });
  for (const r of ["__proto__", "constructor", "prototype"]) {
    assert.strictEqual(ep.effectivePin(r, opts), null);
    assert.strictEqual(ep.registryLayer(r, opts), null);
    assert.strictEqual(ep.projectLayer(r, opts), null);
  }
  assert.strictEqual(ep.effectivePin("builder", opts).source, "registry");
});

test("10 absent role null; map covers roles and skips _doc", () => {
  const { opts } = setup({ manifest: man({}) });
  assert.strictEqual(ep.effectivePin("nobody", opts), null);
  assert.deepStrictEqual(Object.keys(ep.effectivePinMap(opts)).sort(), ["builder", "rev"]);
});

test("11 raw layers", () => {
  const { opts } = setup({ manifest: man({ agentProviders: { builder: "claude" } }) });
  assert.deepStrictEqual(ep.registryLayer("builder", opts), { provider: "claude", model: "claude-a", effort: "medium" });
  assert.deepStrictEqual(ep.projectLayer("builder", opts), { provider: "claude", model: "claude-spec", effort: "low" });
  assert.strictEqual(ep.projectLayer("rev", opts), null);
  assert.strictEqual(ep.registryLayer("nobody", opts), null);
  assert.deepStrictEqual(ep.KNOWN_PROVIDERS, ["claude", "openai", "antigravity"]);
});

test("12 trust only built-in providers; bad overlay throws", () => {
  const a = setup({ manifest: man({ agentProviders: { builder: "evil" }, providers: { evil: {} } }) });
  assert.throws(() => ep.effectivePin("builder", a.opts), /evil/);
  const { opts } = setup({ manifest: man({}) });
  for (const ov of ["x", null, { provider: "evil" }, { provider: 5 }, {}, []]) {
    assert.throws(() => ep.effectivePin("builder", { ...opts, overlay: { builder: ov } }), /overlay/);
  }
});

test("13 malformed project layer throws", () => {
  for (const m of ["null", "[]", "5", '{"agentProviders":null}', '{"agentProviders":[]}', '{"agentProviders":"x"}',
    '{"agentProviders":{"builder":5}}', '{"agentProviders":{"builder":""}}']) {
    const { opts } = setup({ manifest: m });
    assert.throws(() => ep.effectivePin("builder", opts), /effective-pin/, m);
  }
});

test("14 spec path confined to project root; frontmatter proto keys skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epin-out-"));
  fs.writeFileSync(path.join(dir, "outside.md"), "---\nmodel: stolen\n---\n");
  const reg = JSON.stringify({ roles: { builder: { provider: "claude", model: "m", effort: "e", spec: "../" + path.basename(dir) + "/outside.md" } } });
  const { opts } = setup({ manifest: man({ agentProviders: { builder: "claude" } }), registry: reg });
  assert.strictEqual(ep.effectivePin("builder", opts).model, "m");
  const p = setup({ manifest: man({ agentProviders: { builder: "claude" } }), spec: "---\n__proto__: x\nconstructor: y\nmodel: ok\n---\n" });
  assert.strictEqual(ep.effectivePin("builder", p.opts).model, "ok");
});

test("15 overlay without model fills from project frontmatter", () => {
  const { opts } = setup({ manifest: man({ agentProviders: { builder: "claude" } }) });
  const p = ep.effectivePin("builder", { ...opts, overlay: { builder: { provider: "claude" } } });
  assert.deepStrictEqual([p.model, p.effort, p.source], ["claude-spec", "low", "overlay"]);
});

test("16 effectiveProviderForRole: registry role -> pinned provider", () => {
  const { opts } = setup({ manifest: man({}) });
  assert.strictEqual(ep.effectiveProviderForRole("rev", opts), "openai");
});

test("17 effectiveProviderForRole: unknown role -> claude", () => {
  const { opts } = setup({ manifest: man({}) });
  assert.strictEqual(ep.effectiveProviderForRole("no-such-role", opts), "claude");
  assert.strictEqual(ep.effectiveProviderForRole("__proto__", opts), "claude");
});

test("18 effectiveProviderForRole: manifest override wins; non-registry manifest pin honored; scrapped default", () => {
  const { opts } = setup({ manifest: man({ agentProviders: { rev: "claude", ghost: "openai" } }) });
  assert.strictEqual(ep.effectiveProviderForRole("rev", opts), "claude");
  assert.strictEqual(ep.effectiveProviderForRole("ghost", opts), "openai");
  assert.strictEqual(ep.effectiveProviderForRole("reviewer", opts), "openai");
  assert.strictEqual(ep.effectiveProviderForRole("builder-x", opts), "claude");
});
