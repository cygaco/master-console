"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const catalog = require("./catalog");

let n = 0;
function t(name, fn) {
  fn();
  n++;
  console.log("ok - " + name);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "catmodels-"));
function writeRows(rows) {
  const f = path.join(tmp, "rows-" + n + "-" + Math.random().toString(36).slice(2) + ".json");
  fs.writeFileSync(f, JSON.stringify({ schema: "mc/catalog-models/v1", models: rows }));
  return f;
}
function fakeProviders() {
  return {
    antigravity: {
      id: "antigravity",
      cli: "agy",
      models: [{ id: "gemini-4-argon-high", label: "hand", agyModelName: "Gemini 4 Argon (High)", effortLevels: [] }],
    },
    claude: { id: "claude", cli: "claude", models: [] },
  };
}

t("shipped rows are merged and valid", () => {
  const ids = catalog.PROVIDERS.antigravity.models.map((m) => m.id);
  for (const id of ["gemini-4-neon-high", "gemini-4-carbon-low", "gemini-4-hydrogen-xhigh", "gemini-4-argon-medium"]) {
    assert.ok(ids.includes(id), id);
  }
  assert.strictEqual(new Set(ids).size, ids.length, "no duplicate ids");
  assert.strictEqual(catalog.PROVIDERS.antigravity.defaultModel, "gemini-4-argon-high");
});

t("shipped openai rows merge and validate", () => {
  for (const id of ["gpt-6.2-sol", "gpt-6.2-astra"]) {
    const m = catalog.PROVIDERS.openai.models.find((x) => x.id === id);
    assert.ok(m && m.fromDataFile, id);
    assert.strictEqual(m.displayName, id);
    assert.strictEqual(catalog.validateTuple("openai", id), null);
  }
  assert.strictEqual(catalog.PROVIDERS.openai.defaultModel, "gpt-6.1-sol");
});

t("validateTuple accepts a data row", () => {
  assert.strictEqual(catalog.validateTuple("antigravity", "gemini-4-carbon-high"), null);
});

t("agyModelName returns the display name for a data row", () => {
  assert.strictEqual(catalog.agyModelName("gemini-4-neon-high"), "Gemini 4 Neon (High)");
});

t("hand-written entry wins on collision", () => {
  const p = fakeProviders();
  const f = writeRows([{ provider: "antigravity", id: "gemini-4-argon-high", displayName: "Other Name (High)" }]);
  assert.strictEqual(catalog.mergeDataRows(p, f), 0);
  assert.strictEqual(p.antigravity.models.length, 1);
  assert.strictEqual(p.antigravity.models[0].label, "hand");
});

t("default label, effortLevels and agyModelName", () => {
  const p = fakeProviders();
  const f = writeRows([{ provider: "antigravity", id: "x-1", displayName: "X One (High)" }]);
  assert.strictEqual(catalog.mergeDataRows(p, f), 1);
  const m = p.antigravity.models[1];
  assert.strictEqual(m.label, "X One (High) \u2014 via agy");
  assert.deepStrictEqual(m.effortLevels, []);
  assert.strictEqual(m.agyModelName, "X One (High)");
  assert.strictEqual(m.apiId, undefined);
});

t("malformed rows are skipped, good rows kept", () => {
  const p = fakeProviders();
  const f = writeRows([
    { provider: "antigravity", id: "Bad Slug", displayName: "Fine (High)" },
    { provider: "antigravity", id: "q-1", displayName: 'Has "quote"' },
    { provider: "antigravity", id: "q-2", displayName: "semi;colon" },
    { provider: "nope", id: "q-3", displayName: "Ok (High)" },
    { provider: "antigravity", id: "good-1", displayName: "Good (High)" },
  ]);
  const realWrite = process.stderr.write;
  let warned = 0;
  process.stderr.write = () => { warned++; return true; };
  let added;
  try { added = catalog.mergeDataRows(p, f); } finally { process.stderr.write = realWrite; }
  assert.strictEqual(added, 1);
  assert.strictEqual(warned, 4);
  assert.deepStrictEqual(p.antigravity.models.map((m) => m.id), ["gemini-4-argon-high", "good-1"]);
});

t("absent or unreadable file is harmless", () => {
  const p = fakeProviders();
  assert.strictEqual(catalog.mergeDataRows(p, path.join(tmp, "missing.json")), 0);
  const bad = path.join(tmp, "bad.json");
  fs.writeFileSync(bad, "{not json");
  assert.strictEqual(catalog.mergeDataRows(p, bad), 0);
  assert.strictEqual(p.antigravity.models.length, 1);
});

function quiet(fn) {
  const realWrite = process.stderr.write;
  const lines = [];
  process.stderr.write = (c) => { lines.push(String(c)); return true; };
  try { return { value: fn(), lines }; } finally { process.stderr.write = realWrite; }
}

t("inherited provider names are skipped with a warning, never a throw", () => {
  const p = fakeProviders();
  const f = writeRows(["constructor", "toString", "__proto__", "hasOwnProperty", "ghost"].map((name, i) => ({
    provider: name, id: "inh-" + i, displayName: "Inh (High)",
  })));
  const r = quiet(() => catalog.mergeDataRows(p, f));
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.lines.length, 5);
  assert.strictEqual(p.antigravity.models.length, 1);
});

t("a provider without a models array is skipped", () => {
  const p = fakeProviders();
  p.broken = { id: "broken", cli: "x", models: "nope" };
  const f = writeRows([{ provider: "broken", id: "b-1", displayName: "B (High)" }]);
  assert.strictEqual(quiet(() => catalog.mergeDataRows(p, f)).value, 0);
});

t("effort levels outside the safe-spawn vocabulary are dropped with a warning", () => {
  const p = fakeProviders();
  const f = writeRows([{ provider: "antigravity", id: "e-1", displayName: "E (High)", effortLevels: ["high", "--evil", "max", 5] }]);
  const r = quiet(() => catalog.mergeDataRows(p, f));
  assert.deepStrictEqual(p.antigravity.models[1].effortLevels, ["high", "max"]);
  assert.strictEqual(r.lines.length, 1);
});

t("a row's own label is ignored", () => {
  const p = fakeProviders();
  const f = writeRows([{ provider: "antigravity", id: "l-1", displayName: "L (High)", label: "Injected label" }]);
  catalog.mergeDataRows(p, f);
  assert.strictEqual(p.antigravity.models[1].label, "L (High) — via agy");
});

t("numeric fields are kept only when finite and non-negative", () => {
  const p = fakeProviders();
  const f = writeRows([
    { provider: "antigravity", id: "n-1", displayName: "N (High)", contextTokens: 1000, maxOutputTokens: -5,
      pricing: { inPerMTok: 2, outPerMTok: "x" } },
    { provider: "antigravity", id: "n-2", displayName: "N2 (High)", contextTokens: "big", pricing: "free" },
  ]);
  quiet(() => catalog.mergeDataRows(p, f));
  const [, a, b] = p.antigravity.models;
  assert.strictEqual(a.contextTokens, 1000);
  assert.strictEqual(a.maxOutputTokens, undefined);
  assert.deepStrictEqual(a.pricing, { inPerMTok: 2 });
  assert.strictEqual(b.contextTokens, undefined);
  assert.strictEqual(b.pricing, undefined);
});

t("duplicate ids inside the data file keep the first and warn once", () => {
  const p = fakeProviders();
  const f = writeRows([
    { provider: "antigravity", id: "d-1", displayName: "First (High)" },
    { provider: "antigravity", id: "d-1", displayName: "Second (High)" },
  ]);
  const r = quiet(() => catalog.mergeDataRows(p, f));
  assert.strictEqual(r.value, 1);
  assert.strictEqual(r.lines.length, 1);
  assert.strictEqual(p.antigravity.models[1].displayName, "First (High)");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${n} passed`);
