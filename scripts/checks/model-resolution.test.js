"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { runChecks, COMBOS, FLOOR_MODEL } = require("./model-resolution");

const ROOT = path.resolve(__dirname, "..", "..");
const req = (rel) => require(path.join(ROOT, rel));
const realMods = () => ({
  MR: req("scripts/dispatch/model-resolve.js"),
  presets: req("scripts/dispatch/presets.js"),
  catalog: req("scripts/dispatch/catalog.js"),
  readers: req("scripts/checks/model-resolution-readers.js"),
  registry: JSON.parse(JSON.stringify(req(".claude/agents/_org/role-registry.json"))),
});
const checksOf = (res) => [...new Set(res.findings.map((f) => f.check))].sort();

test("live tree: every check holds; every role x preset x sign-in combination x channel resolves", () => {
  const res = runChecks();
  assert.deepStrictEqual(res.findings, [], res.findings.map((f) => `${f.check} ${f.role || ""} ${f.detail}`).join("\n"));
  assert.strictEqual(res.counts.roles, 35);
  assert.ok(res.counts.presets >= 3, "default + the two overlays");
  assert.strictEqual(res.counts.resolutions, res.counts.roles * res.counts.presets * COMBOS.length * 2);
  assert.deepStrictEqual(res.diversity_lost_for_claude_only, ["security-reviewer"], "reported, not a finding");
});

test("RED parity: a registry pin that differs from the default preset's first entry", () => {
  const m = realMods();
  m.registry.roles.beta.model = "gpt-6-astra";
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "parity" && f.role === "beta"), checksOf(res).join(","));
});

test("RED floor: a chain that does not end on the Claude floor model", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = {
    ...real,
    effectiveChains: (o) => {
      const v = real.effectiveChains(o);
      v.chains.cabinet = v.chains.cabinet.slice(0, -1);
      return v;
    },
  };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "floor" && f.role === "cabinet" && !f.detail.includes(`claude/${FLOOR_MODEL} `) ), checksOf(res).join(","));
});

test("RED matrix: an in-process answer that is not Claude", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = {
    ...real,
    resolveRole: (role, o) => {
      const r = real.resolveRole(role, o);
      return role === "beta" && o.channel === "in-process" ? { ...r, provider: "openai", model: "gpt-6.1-sol", alias: null } : r;
    },
  };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "matrix" && f.role === "beta" && /non-Claude/.test(f.detail)), checksOf(res).join(","));
});

test("RED matrix: a resolved model the catalog does not offer", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = { ...real, resolveRole: (role, o) => (role === "cabinet" && o.channel === "cli" ? { ...real.resolveRole(role, o), model: "gpt-0-dead" } : real.resolveRole(role, o)) };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "matrix" && f.role === "cabinet" && /not a catalog model/.test(f.detail)), checksOf(res).join(","));
});

test("RED matrix: a CLI answer on a tool the sign-in combination is not signed in to", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = { ...real, resolveRole: (role, o) => (o.channel === "cli" ? real.resolveRole(role, { ...o, signin: { state: "unknown" }, toolPresent: () => true }) : real.resolveRole(role, o)) };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "matrix" && f.role === "beta" && f.combo === "claude only" && /not signed in to/.test(f.detail)), checksOf(res).join(","));
});

test("RED matrix: a CLI answer that skips an earlier signed-in entry", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = { ...real, resolveRole: (role, o) => {
    const r = real.resolveRole(role, o);
    if (o.channel !== "cli" || !Array.isArray(r.chain) || r.chain.length < 2) return r;
    const last = r.chain.length - 1;
    return { ...r, index: last, provider: r.chain[last].provider, model: r.chain[last].model, source: "chain-exhausted" };
  } };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "matrix" && f.role === "beta" && f.combo === "all three" && /is signed in and earlier/.test(f.detail)), checksOf(res).join(","));
});

test("RED alias: an Agent-tool alias that is not the catalog's alias for the model", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = { ...real, resolveRole: (role, o) => (role === "quality-lead" && o.channel === "in-process" ? { ...real.resolveRole(role, o), alias: "sonnet" } : real.resolveRole(role, o)) };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "alias" && f.role === "quality-lead"), checksOf(res).join(","));
});

test("RED specs: a spec whose frontmatter is not the resolver's in-process answer", () => {
  const m = realMods();
  m.MR = { ...m.MR, syncSpecs: () => ({ ok: false, checked: 35, drift: [{ role: "beta", spec: ".claude/agents/president/beta.md", model: "claude-opus-5-5", effort: "high" }], errors: [] }) };
  const res = runChecks({ mods: m });
  assert.ok(res.findings.some((f) => f.check === "specs" && f.role === "beta"), checksOf(res).join(","));
});

test("RED readers: a second reader of the sign-in record, and an unlisted provider/model reader", () => {
  const m = realMods();
  m.readers = {
    findUnlistedReaders: () => ({ ok: false, unlisted: ["scripts/planted-reader.js"], stale: [], bad: [] }),
    findSigninCacheReaders: () => ({ ok: false, offenders: ["scripts/planted-second-reader.js"] }),
  };
  const res = runChecks({ mods: m });
  const r = res.findings.filter((f) => f.check === "readers").map((f) => f.detail);
  assert.ok(r.some((d) => /unlisted.*planted-reader/.test(d)) && r.some((d) => /second reader.*planted-second-reader/.test(d)), r.join("\n"));
});

test("RED pins: an in-process pin no alias reaches (unservable), and a spawn alias that does not match the pinned model", () => {
  const m = realMods();
  const real = m.MR;
  m.MR = { ...real, resolveRole: (role, o) => {
    const r = real.resolveRole(role, o);
    if (o.channel !== "in-process") return r;
    if (role === "director-of-engineering") return { ...r, model: "claude-opus-4-8", alias: null, spawn: { pinned: true, unservable: true, model: null, reason: "set to claude-opus-4-8; node scripts/dispatch.js set director-of-engineering --default" } };
    if (role === "quality-lead") return { ...r, spawn: { pinned: true, model: "sonnet", effort: "high" } };
    return r;
  } };
  const res = runChecks({ mods: m });
  const pins = res.findings.filter((f) => f.check === "pins");
  assert.ok(pins.some((f) => f.role === "director-of-engineering" && /--default/.test(f.detail)), JSON.stringify(pins.slice(0, 2)));
  assert.ok(pins.some((f) => f.role === "quality-lead" && /not the catalog's alias/.test(f.detail)));
});
