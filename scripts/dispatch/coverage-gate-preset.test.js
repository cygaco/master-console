#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { harness } = require("../checks/lib/fixture-harness");
const { evaluate: _evaluate, presetCoverage } = require("./coverage-gate");
const { ARGV_SCHEMA_VERSION } = require("./dispatch-contract");

const h = harness("coverage-gate-preset");
const FIX = path.join(__dirname, "fixtures", "coverage");
const load = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n + ".json"), "utf8"));

function opts(presetFile) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-preset-"));
  const presetsDir = path.join(dir, "presets");
  fs.mkdirSync(presetsDir);
  if (presetFile) {
    const p = load(presetFile);
    fs.writeFileSync(path.join(presetsDir, "chosen.json"), JSON.stringify(p));
  }
  fs.writeFileSync(path.join(presetsDir, "default.json"), JSON.stringify(load("preset-standard-like")));
  const logPath = path.join(dir, "log.jsonl");
  if (presetFile) fs.writeFileSync(logPath, JSON.stringify({ type: "apply", preset: "chosen", ts: "t" }) + "\n");
  return { presetsDir, logPath, registryPath: path.join(dir, "none.json"), manifestPath: path.join(dir, "none-m.json"), projectRoot: dir };
}
const run = (fixture, o) => presetCoverage({ ...load(fixture), opts: o });

h.violation("(a) cross-family code, Codex builder + Codex reviewer -> coverage-family-unmet", () => {
  const r = run("a-codex-reviews-codex", opts("preset-cross-code"));
  return { ok: r.ok && r.code !== "coverage-family-unmet" };
});
h.pass("(a2) the failure carries the family code", () => run("a-codex-reviews-codex", opts("preset-cross-code")).code === "coverage-family-unmet");
h.pass("(b) cross-family code, Claude builder + openai reviewer -> pass", () =>
  run("b-claude-builder-openai-reviewer", opts("preset-cross-code")));
h.violation("(c) standard, security, no security reviewer record -> fail", () => run("c-security-no-reviewer", opts()));
h.pass("(d) standard, security, antigravity reviewer -> pass", () => run("d-security-antigravity", opts()));
h.pass("(e) standard, code, Claude reviewer (same-family declared) -> pass", () => run("e-claude-both-same-family", opts()));
h.pass("(f) visual -> exempt pass", () => run("f-visual-exempt", opts()));
h.violation("unknown unit class fails closed", () => presetCoverage({ unitClass: "other", builderRole: "x", records: [], opts: opts() }));

const rec = (over) => ({
  dispatch_id: "d", cmdline_checksum: "sha256:dead", run_id: "r", role: "security-reviewer", provider: "claude",
  ok: true, argv_schema_version: ARGV_SCHEMA_VERSION, output_digest: "sha256:aa", ...over,
});
const evaluate = (o) => _evaluate({ requireSignature: false, runId: "r", expected: [{ role: "security-reviewer" }], ...o });

h.violation("a claude record for a reviewer pinned to another provider is still rejected", () =>
  evaluate({ records: [rec({ provider: "claude" })] }));
h.pass("a record from the pinned provider is accepted", () => evaluate({ records: [rec({ provider: "antigravity" })] }));
h.pass("a reviewer overlay-pinned to claude is not rejected for being claude", () =>
  evaluate({
    records: [rec({ provider: "claude" })],
    pinOpts: { overlay: { "security-reviewer": { provider: "claude", model: "claude-opus-5" } } },
  }));

const { familyOf } = require("./coverage-gate");
h.pass("familyOf: known providers map; the retired Gemini CLI id is an unknown family (fail-closed)", () =>
  familyOf("claude") === "anthropic" && familyOf("openai") === "openai" && familyOf("antigravity") === "google" && familyOf("gemini") === null);
h.pass("familyOf: unknown + proto keys -> null", () =>
  ["toString", "constructor", "__proto__", "hasOwnProperty", "bogus", null, undefined].every((p) => familyOf(p) === null));
const crossOpts = () => opts("preset-cross-code");
const xrec = (role, provider) => ({ dispatch_id: "d", cmdline_checksum: "sha256:dead", ok: true, role, provider });
h.violation("proto-key reviewer provider 'toString' does not satisfy cross-family", () =>
  presetCoverage({ unitClass: "code", builderRole: "backend-builder",
    records: [xrec("backend-builder", "claude"), xrec("backend-reviewer", "toString")], opts: crossOpts() }));
h.violation("unknown reviewer provider does not satisfy cross-family", () =>
  presetCoverage({ unitClass: "code", builderRole: "backend-builder",
    records: [xrec("backend-builder", "claude"), xrec("backend-reviewer", "mystery")], opts: crossOpts() }));
h.violation("two different unknown providers (builder+reviewer) do not read as cross-family", () =>
  presetCoverage({ unitClass: "code", builderRole: "backend-builder",
    records: [xrec("backend-builder", "foo"), xrec("backend-reviewer", "bar")], opts: crossOpts() }));
h.violation("builder with no record and no readable pin -> coverage-unmet (named)", () =>
  presetCoverage({ unitClass: "code", builderRole: "no-such-role-xyz",
    records: [xrec("backend-reviewer", "openai")], opts: crossOpts() }));
h.pass("legit claude builder + openai reviewer still satisfied", () =>
  presetCoverage({ unitClass: "code", builderRole: "backend-builder",
    records: [xrec("backend-builder", "claude"), xrec("backend-reviewer", "openai")], opts: crossOpts() }).ok);
h.violation("evaluate: cross-provider role with unreadable pin + non-claude record -> coverage-unmet", () =>
  evaluate({ records: [rec({ provider: "toString" })], pinOpts: { registryPath: "/nonexistent/none.json", manifestPath: "/nonexistent/m.json" } }));

h.pass("U9 no applies: appliedPresets(opts) === [] (missing log)", () => {
  const o = opts();
  return !fs.existsSync(o.logPath) && JSON.stringify(require("./presets").appliedPresets(o)) === "[]";
});
h.pass("U9 no applies: appliedPresets(opts) === [] (empty log)", () => {
  const o = opts();
  fs.writeFileSync(o.logPath, "");
  return JSON.stringify(require("./presets").appliedPresets(o)) === "[]";
});
h.pass("U9 no applies: coverage evaluates against the default preset", () => {
  const r = presetCoverage({ unitClass: "visual", builderRole: "x", records: [], opts: opts() });
  return r.ok === true && /preset 'default'/.test(r.reason);
});
h.pass("manifest modelPreset selects the preset whose coverage is read", () => {
  const o = opts();
  fs.writeFileSync(path.join(o.presetsDir, "chosen.json"), JSON.stringify(load("preset-cross-code")));
  fs.writeFileSync(o.manifestPath, JSON.stringify({ modelPreset: "chosen" }));
  const r = presetCoverage({ unitClass: "code", builderRole: "backend-builder", records: [], opts: o });
  return r.declared === "cross-family" && /preset 'chosen'/.test(r.reason);
});

h.done();
