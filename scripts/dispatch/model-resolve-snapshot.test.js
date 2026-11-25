"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MR = require("./model-resolve");
const EP = require("./effective-pin");

const REPO = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(REPO, ".claude", "agents", "_org", "role-registry.json");
const PRESETS = path.join(REPO, ".claude", "agents", "_org", "presets");
const ROLE = "director-of-engineering";
const ALL = { state: "known", providers: { claude: { signedIn: true }, openai: { signedIn: true }, antigravity: { signedIn: true } } };

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function project(manifestText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mr-snap-"));
  made.push(dir);
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, manifestText);
  return { registryPath: REGISTRY, manifestPath, projectRoot: REPO, presetsDir: PRESETS, logPath: path.join(dir, "log.jsonl") };
}

const NAMED = JSON.stringify({ agentProviders: { [ROLE]: { provider: "claude", model: "claude-opus-5-5", effort: "high" } } });
const PROVIDER_ONLY = JSON.stringify({ agentProviders: { [ROLE]: "claude" } });
const OVERLAY = JSON.stringify({ modelPreset: "spend-more-on-claude", agentProviders: {} });
const DEFAULT_PLUS_PIN = JSON.stringify({ agentProviders: { [ROLE]: { provider: "claude", model: "claude-fable-5-2", effort: "high" } } });

function withReads(file, serve, fn) {
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (p, ...rest) {
    if (path.resolve(String(p)) === path.resolve(file)) {
      reads++;
      const text = serve ? serve(reads) : null;
      if (text !== null && text !== undefined) {
        const enc = typeof rest[0] === "string" ? rest[0] : rest[0] && rest[0].encoding;
        return enc ? text : Buffer.from(text);
      }
    }
    return real.call(fs, p, ...rest);
  };
  try {
    return { result: fn(), reads };
  } finally {
    fs.readFileSync = real;
  }
}

const shape = (r) => ({ provider: r.provider, model: r.model, effort: r.effort, source: r.source, index: r.index, spawn: r.spawn || null });

test("ONE READ: one in-process resolveRole call reads the manifest exactly once", () => {
  for (const text of [NAMED, PROVIDER_ONLY, OVERLAY, "{not json"]) {
    const o = project(text);
    const { reads } = withReads(o.manifestPath, null, () => MR.resolveRole(ROLE, { ...o, channel: "in-process" }));
    assert.strictEqual(reads, 1, `${text.slice(0, 40)}: expected 1 manifest read, got ${reads}`);
  }
});

test("ONE READ: one cli resolveRole call reads the manifest exactly once", () => {
  const o = project(NAMED);
  const { reads } = withReads(o.manifestPath, null, () => MR.resolveRole("beta", { ...o, channel: "cli", signin: ALL, toolPresent: () => true }));
  assert.strictEqual(reads, 1);
});

test("ONE SNAPSHOT: a write landing after the first read never mixes versions — the answer is version A's", () => {
  const pairs = [
    [NAMED, PROVIDER_ONLY],
    [PROVIDER_ONLY, NAMED],
    [DEFAULT_PLUS_PIN, OVERLAY],
    [NAMED, "{not json"],
  ];
  for (const [a, b] of pairs) {
    const oa = project(a);
    const alone = shape(MR.resolveRole(ROLE, { ...oa, channel: "in-process" }));
    const o = project(a);
    const { result } = withReads(o.manifestPath, (n) => (n === 1 ? a : b), () => MR.resolveRole(ROLE, { ...o, channel: "in-process" }));
    assert.deepStrictEqual(shape(result), alone, `A=${a.slice(0, 50)} B=${b.slice(0, 50)}`);
  }
});

test("NAMED: an entry is named only when the project layer names its model", () => {
  const cases = [
    [{ provider: "claude", model: "claude-opus-5-5", effort: "high" }, true],
    [{ provider: "claude", model: "claude-fable-5-2" }, true],
    ["claude", false],
    [{ provider: "claude" }, false],
    [{ provider: "claude", effort: "high" }, false],
    [{ provider: "openai", model: "gpt-6.1-sol", effort: "high" }, true],
  ];
  for (const [entry, named] of cases) {
    const o = project(JSON.stringify({ agentProviders: { [ROLE]: entry } }));
    const pin = EP.effectivePin(ROLE, o);
    assert.strictEqual(pin.source, "project");
    assert.strictEqual(pin.named, named, JSON.stringify(entry));
  }
});

test("NAMED drives the spawn pin: a named pin equal to the default pins; a provider-only entry does not", () => {
  const named = MR.resolveRole(ROLE, { ...project(NAMED), channel: "in-process" });
  assert.deepStrictEqual([named.spawn.pinned, named.spawn.model, named.spawn.effort], [true, "opus", "high"]);
  const bare = MR.resolveRole(ROLE, { ...project(PROVIDER_ONLY), channel: "in-process" });
  assert.deepStrictEqual(bare.spawn, { pinned: false, model: null, effort: null });
});

test("SNAPSHOT is frozen and an unreadable manifest is carried as an error, not a throw", () => {
  const ok = EP.readManifestSnapshot(project(NAMED));
  assert.ok(Object.isFrozen(ok) && Object.isFrozen(ok.data) && Object.isFrozen(ok.data.agentProviders));
  const bad = EP.readManifestSnapshot(project("{not json"));
  assert.strictEqual(bad.data, null);
  assert.match(bad.error, /manifest/);
  const r = MR.resolveRole(ROLE, { ...project("{not json"), channel: "in-process" });
  assert.deepStrictEqual([r.model, r.spawn.pinned], ["claude-opus-5-5", false]);
  assert.match(r.warning || "", /could not be read/);
});
