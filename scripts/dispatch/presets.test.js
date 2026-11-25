"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("./presets");
const { effectivePin, effectivePinMap } = require("./effective-pin");

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "presets-"));
  const registryPath = path.join(dir, "registry.json");
  const manifestPath = path.join(dir, "manifest.json");
  const presetsDir = path.join(dir, "presets");
  const logPath = path.join(dir, "log", "presets.jsonl");
  fs.mkdirSync(presetsDir);
  const roles = {};
  for (const r of ["alpha", "beta", "gamma"]) {
    fs.writeFileSync(path.join(dir, `${r}.md`), `---\nname: ${r}\nmodel: claude-opus-4-8\neffort: high\n---\nbody\n`);
    roles[r] = { provider: "claude", model: "claude-opus-4-8", effort: "high", spec: `${r}.md` };
  }
  fs.writeFileSync(registryPath, JSON.stringify({ roles }));
  fs.writeFileSync(manifestPath, JSON.stringify({ agentProviders: {} }));
  const opts = { registryPath, manifestPath, projectRoot: dir, presetsDir, logPath };
  const calls = [];
  opts.applySave = (input) => {
    calls.push(input);
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    m.agentProviders[input.role] = input.provider;
    fs.writeFileSync(manifestPath, JSON.stringify(m));
    const spec = path.join(dir, `${input.role}.md`);
    const lines = input.provider === "claude"
      ? [`model: ${input.model}`, `effort: ${input.effort}`]
      : ["model: inherit", `provider: ${input.provider}`, `provider_model: ${input.model}`, `provider_reasoning_effort: ${input.effort}`];
    fs.writeFileSync(spec, `---\nname: ${input.role}\n${lines.join("\n")}\n---\nbody\n`);
    return { ok: true };
  };
  const writePreset = (id, pins) => {
    const chains = {};
    for (const [role, pin] of Object.entries(pins)) {
      chains[role] = pin.provider === "claude" ? [pin] : [pin, { provider: "claude", model: "claude-opus-4-8", effort: "high" }];
    }
    fs.writeFileSync(path.join(presetsDir, `${id}.json`), JSON.stringify({ id, kind: "overlay", title: id, dated: "2026-10-31", reason: "Because. More.", evidence: ["test fixture"], chains }));
  };
  return { dir, opts, calls, writePreset, manifestPath };
}

const oa = (role) => ({ provider: "openai", model: "gpt-6.1-sol", effort: "high" });

test("apply writes only differing roles", () => {
  const e = env();
  e.writePreset("p", { alpha: { provider: "claude", model: "claude-opus-4-8", effort: "high" }, beta: oa() });
  const r = P.applyPreset("p", e.opts);
  assert.equal(r.ok, true);
  assert.deepEqual(r.roles_changed, ["beta"]);
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].fallback, "claude");
  assert.equal(effectivePin("beta", e.opts).provider, "openai");
  assert.equal(P.readLog(e.opts).length, 1);
});

test("apply twice is a no-op the second time", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.applyPreset("p", e.opts);
  const r = P.applyPreset("p", e.opts);
  assert.deepEqual(r.roles_changed, []);
  assert.equal(e.calls.length, 1);
  assert.equal(P.readLog(e.opts).length, 1);
});

test("override recorded only for covered roles", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.applyPreset("p", e.opts);
  const to = { provider: "claude", model: "claude-opus-4-8", effort: "high" };
  assert.equal(P.recordOverride({ role: "alpha", from: to, to }, e.opts).length, 0);
  const rows = P.recordOverride({ role: "beta", from: oa(), to }, e.opts);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].preset, "p");
  assert.equal(P.recordOverride({ role: "beta", from: to, to: oa() }, e.opts).length, 0);
  e.opts.applySave({ role: "beta", ...to });
  assert.equal(P.status(e.opts)[0].overrides.length, 1);
});

test("reapply after override refuses, writes nothing, then succeeds when confirmed", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.applyPreset("p", e.opts);
  const to = { provider: "claude", model: "claude-opus-4-8", effort: "high" };
  e.opts.applySave({ role: "beta", ...to });
  P.recordOverride({ role: "beta", from: oa(), to }, e.opts);
  const spec = path.join(e.dir, "beta.md");
  const before = [fs.readFileSync(e.manifestPath), fs.readFileSync(spec)];
  const n = e.calls.length;
  const logBefore = fs.readFileSync(e.opts.logPath);
  const r = P.applyPreset("p", e.opts);
  assert.deepEqual(r, { ok: false, code: "overrides-present", roles: ["beta"] });
  assert.equal(e.calls.length, n);
  assert.ok(before[0].equals(fs.readFileSync(e.manifestPath)));
  assert.ok(before[1].equals(fs.readFileSync(spec)));
  assert.ok(logBefore.equals(fs.readFileSync(e.opts.logPath)));
  const ok = P.applyPreset("p", { ...e.opts, confirmOverrides: true });
  assert.equal(ok.ok, true);
  assert.equal(effectivePin("beta", e.opts).provider, "openai");
  assert.equal(P.status(e.opts)[0].overrides.length, 0);
});

test("a forged override row does not change any effective pin", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  const before = JSON.stringify(effectivePinMap(e.opts));
  fs.mkdirSync(path.dirname(e.opts.logPath), { recursive: true });
  fs.writeFileSync(
    e.opts.logPath,
    JSON.stringify({ type: "apply", preset: "p", roles_changed: [], ts: "x" }) + "\n" +
      JSON.stringify({ type: "override", preset: "p", role: "alpha", from: oa(), to: oa(), ts: "x" }) + "\n",
  );
  assert.equal(JSON.stringify(effectivePinMap(e.opts)), before);
  assert.equal(effectivePin("alpha", e.opts).provider, "claude");
});

test("malformed log line is skipped and counted", () => {
  const e = env();
  fs.mkdirSync(path.dirname(e.opts.logPath), { recursive: true });
  fs.writeFileSync(e.opts.logPath, 'not json\n{"type":"apply","preset":"p","ts":"t"}\n[1]\n');
  const d = P.readLogDetailed(e.opts);
  assert.equal(d.rows.length, 1);
  assert.equal(d.skipped, 2);
  assert.deepEqual(P.readLog({ logPath: path.join(e.dir, "missing.jsonl") }), []);
});

test("bad preset id is rejected", () => {
  const e = env();
  for (const id of ["../x", "A", "a b", "", "a/b"]) {
    assert.throws(() => P.loadPreset(id, e.opts), /invalid preset id/);
  }
});

test("no log path is a clear error", () => {
  assert.throws(() => P.readLog({ logPath: "" }), /presets: no log path — pass opts\.logPath/);
});

test("snapshot equals effectivePinMap (first chain entry), kind full", () => {
  const e = env();
  const snap = P.snapshot("standard", "2026-10-31", e.opts);
  const map = effectivePinMap(e.opts);
  assert.equal(snap.kind, "full");
  assert.deepEqual(Object.keys(snap.chains), Object.keys(map).sort());
  for (const r of Object.keys(map)) {
    assert.deepEqual(snap.chains[r][0], { provider: map[r].provider, model: map[r].model, effort: map[r].effort });
  }
});

test("dry run changes nothing and logs nothing", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  e.opts.previewSave = () => ({ ok: true });
  const r = P.applyPreset("p", { ...e.opts, dryRun: true });
  assert.deepEqual(r.roles_changed, ["beta"]);
  assert.equal(e.calls.length, 0);
  assert.equal(fs.existsSync(e.opts.logPath), false);
});

const cl = { provider: "claude", model: "claude-opus-4-8", effort: "high" };

test("F3.3 apply previews every role first and writes nothing if one preview fails", () => {
  const e = env();
  e.writePreset("p", { alpha: oa(), beta: oa(), gamma: oa() });
  e.opts.previewSave = (input) => (input.role === "gamma" ? { ok: false, error: "bad gamma" } : { ok: true });
  const r = P.applyPreset("p", e.opts);
  assert.equal(r.ok, false);
  assert.equal(r.code, "save-failed");
  assert.equal(r.role, "gamma");
  assert.equal(e.calls.length, 0);
  assert.equal(fs.existsSync(e.opts.logPath), false);
});

test("F3.3 a write failure partway logs a partial row naming written roles and the failing role", () => {
  const e = env();
  e.writePreset("p", { alpha: oa(), beta: oa(), gamma: oa() });
  const real = e.opts.applySave;
  e.opts.applySave = (input, so) => (input.role === "gamma" ? { ok: false, error: "disk full" } : real(input, so));
  const r = P.applyPreset("p", e.opts);
  assert.equal(r.ok, false);
  assert.deepEqual(r.roles_changed, ["alpha", "beta"]);
  const rows = P.readLog(e.opts);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "partial");
  assert.deepEqual(rows[0].roles_written, ["alpha", "beta"]);
  assert.equal(rows[0].failed_role, "gamma");
});

test("F3.4 a manual pin on a role no preset covers blocks the FIRST apply until confirmed", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.recordManualPin({ role: "beta", from: cl, to: { provider: "claude", model: "claude-opus-4-8", effort: "low" } }, e.opts);
  const r = P.applyPreset("p", e.opts);
  assert.deepEqual(r, { ok: false, code: "overrides-present", roles: ["beta"] });
  assert.equal(e.calls.length, 0);
  assert.equal(P.applyPreset("p", { ...e.opts, confirmOverrides: true }).ok, true);
  assert.equal(P.applyPreset("p", e.opts).ok, true);
  e.opts.applySave({ role: "beta", ...cl });
  const r2 = P.applyPreset("p", e.opts);
  assert.equal(r2.code, "overrides-uncertain");
  assert.deepEqual(r2.roles, ["beta"]);
  assert.equal(P.applyPreset("p", { ...e.opts, confirmOverrides: true }).ok, true);
});

test("F3.4 a manual pin older than the last preset write does not block", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.recordManualPin({ role: "beta", from: cl, to: cl }, e.opts);
  assert.equal(P.applyPreset("p", { ...e.opts, confirmOverrides: true }).ok, true);
  assert.equal(P.applyPreset("p", e.opts).ok, true);
  e.opts.applySave({ role: "beta", ...cl });
  assert.equal(P.applyPreset("p", e.opts).code, "overrides-uncertain");
});

test("F3.7 status and footer count only roles whose pin equals the preset, and drop stale overrides", () => {
  const e = env();
  e.writePreset("p", { alpha: oa(), beta: oa() });
  P.applyPreset("p", e.opts);
  e.opts.applySave({ role: "beta", ...cl });
  P.recordOverride({ role: "beta", from: oa(), to: cl }, e.opts);
  let st = P.status(e.opts)[0];
  assert.deepEqual(st.matching, ["alpha"]);
  assert.deepEqual(st.differing, ["beta"]);
  assert.equal(st.overrides.length, 1);
  const lines = P.footerLines(e.opts);
  assert.match(lines[0], /1 of 2 roles match now/);
  assert.match(lines[1], /override beta: openai\/gpt-6.1-sol\/high → claude\/claude-opus-4-8\/high/);
  e.opts.applySave({ role: "beta", ...oa() });
  st = P.status(e.opts)[0];
  assert.equal(st.overrides.length, 0);
  assert.equal(P.footerLines(e.opts).length, 1);
});

test("F3.7 footer shows the apply reason, not the preset's", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.applyPreset("p", { ...e.opts, reason: "Cheaper this week." });
  assert.match(P.footerLines(e.opts)[0], /Cheaper this week\./);
});

test("F3.7 unapply is a log row only and leaves pins alone", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  P.applyPreset("p", e.opts);
  const r = P.unapplyPreset("p", e.opts);
  assert.equal(r.ok, true);
  assert.match(r.note, /pins are unchanged/);
  assert.equal(effectivePin("beta", e.opts).provider, "openai");
  assert.equal(P.status(e.opts).length, 0);
  assert.equal(P.unapplyPreset("p", e.opts).ok, false);
});

test("F3.8 missing or invalid ids list the available ids; missing file names its path", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  assert.throws(() => P.loadPreset("../x", e.opts), /Available: p/);
  assert.throws(() => P.loadPreset("nope", e.opts), (err) =>
    err.message.includes(path.join(e.opts.presetsDir, "nope.json")) && /Available: p/.test(err.message));
});

test("F3.8 CLI rejects a flag in the id position with usage (show; apply is HELD this release)", () => {
  const { spawnSync } = require("child_process");
  const held = spawnSync(process.execPath, [path.join(__dirname, "presets.js"), "apply", "--dry-run"], { encoding: "utf8" });
  assert.equal(held.status, 1);
  assert.match(held.stderr, /held this release/);
  const r = spawnSync(process.execPath, [path.join(__dirname, "presets.js"), "show", "--dry-run"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs a preset id first/);
  assert.match(r.stderr, /usage: presets\.js/);
});

test("F3.9 an apply takes ONE backup and the per-role writes skip theirs", () => {
  const e = env();
  e.writePreset("p", { alpha: oa(), beta: oa() });
  let backups = 0;
  const skips = [];
  e.opts.previewSave = () => ({ ok: true, writes: [{ path: path.join(e.dir, "x"), before: "a", after: "b" }] });
  e.opts.createBackup = () => ({ id: `b${++backups}`, changedFiles: [] });
  const real = e.opts.applySave;
  e.opts.applySave = (input, so) => { skips.push(so.skipBackup); return real(input, so); };
  const r = P.applyPreset("p", e.opts);
  assert.equal(backups, 1);
  assert.deepEqual(skips, [true, true]);
  assert.equal(r.backup, "b1");
  assert.equal(P.readLog(e.opts)[0].backup, "b1");
});

test("F3.9 undo restores that one backup through snapshot-then-restore and logs it", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  e.opts.previewSave = () => ({ ok: true, writes: [{ path: path.join(e.dir, "x"), before: "a", after: "b" }] });
  const made = [];
  e.opts.createBackup = (files, meta) => { made.push(meta.summary); return { id: `b${made.length}`, changedFiles: ["x"] }; };
  e.opts.listBackups = () => [{ id: "b1", changedFiles: ["x"] }];
  const restoredIds = [];
  e.opts.restoreBackup = (id) => { restoredIds.push(id); return { restored: ["x"] }; };
  P.applyPreset("p", e.opts);
  const r = P.undoPreset(e.opts);
  assert.equal(r.ok, true);
  assert.deepEqual(restoredIds, ["b1"]);
  assert.match(made[1], /pre-revert snapshot before restoring b1/);
  assert.equal(P.undoPreset(e.opts).ok, false);
  assert.equal(P.status(e.opts).length, 0);
});

test("undo refuses when a manual pin is newer than the apply, unless --confirm-overrides", () => {
  const e = env();
  e.writePreset("p", { beta: oa() });
  e.opts.previewSave = () => ({ ok: true, writes: [{ path: path.join(e.dir, "x"), before: "a", after: "b" }] });
  e.opts.createBackup = () => ({ id: "b1", changedFiles: ["x"] });
  e.opts.listBackups = () => [{ id: "b1", changedFiles: ["x"] }];
  let restores = 0;
  e.opts.restoreBackup = () => { restores++; return { restored: ["x"] }; };
  P.applyPreset("p", e.opts);
  const cl = { provider: "claude", model: "claude-opus-4-8", effort: "low" };
  P.recordManualPin({ role: "gamma", from: null, to: cl }, e.opts);
  const refused = P.undoPreset(e.opts);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "overrides-present");
  assert.deepEqual(refused.clobbered_overrides, ["gamma"]);
  assert.equal(restores, 0);
  const done = P.undoPreset({ ...e.opts, confirmOverrides: true });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.deepEqual(done.clobbered_overrides, ["gamma"]);
  assert.equal(restores, 1);
});

test("F3.10 a preset with an empty reason or empty evidence fails to load", () => {
  const e = env();
  const put = (id, extra) =>
    fs.writeFileSync(path.join(e.opts.presetsDir, `${id}.json`), JSON.stringify({ id, dated: "d", chains: {}, ...extra }));
  put("noreason", { reason: " ", evidence: ["x"] });
  put("noevidence", { reason: "r", evidence: [] });
  put("blankevidence", { reason: "r", evidence: [""] });
  assert.throws(() => P.loadPreset("noreason", e.opts), /empty reason/);
  assert.throws(() => P.loadPreset("noevidence", e.opts), /evidence/);
  assert.throws(() => P.loadPreset("blankevidence", e.opts), /evidence/);
  assert.ok(P.listPresets(e.opts).every((x) => x.error));
});

test("F3.10 the shipped presets all load", () => {
  const dir = path.join(__dirname, "..", "..", ".claude", "agents", "_org", "presets");
  for (const id of ["default", "standard", "spend-more-on-codex", "spend-more-on-claude"]) {
    assert.ok(P.loadPreset(id, { presetsDir: dir }).evidence.length > 0);
  }
});

const REPO = path.join(__dirname, "..", "..");
const SHIPPED = path.join(REPO, ".claude", "agents", "_org", "presets");
const shippedOpts = () => ({
  registryPath: path.join(REPO, ".claude", "agents", "_org", "role-registry.json"),
  manifestPath: path.join(REPO, ".claude", "manifest.json"),
  projectRoot: REPO,
  presetsDir: SHIPPED,
  logPath: path.join(os.tmpdir(), "unused-presets-log.jsonl"),
});

test("v2: 'standard' is an alias of default.json; pins are derived from chains[role][0]", () => {
  const p = P.loadPreset("standard", shippedOpts());
  assert.equal(p.id, "default");
  assert.equal(p.kind, "full");
  const raw = JSON.parse(fs.readFileSync(path.join(SHIPPED, "default.json"), "utf8"));
  assert.equal(raw.pins, undefined, "pins are not stored in the file");
  for (const [role, chain] of Object.entries(p.chains)) {
    assert.deepEqual(p.pins[role], { provider: chain[0].provider, model: chain[0].model, effort: chain[0].effort });
  }
});

test("v2: the shipped default lists every registry role and its pins equal the registry pins", () => {
  const o = shippedOpts();
  const p = P.loadPreset("default", o);
  const reg = JSON.parse(fs.readFileSync(o.registryPath, "utf8"));
  const roles = Object.keys(reg.roles).filter((r) => !r.startsWith("_"));
  assert.deepEqual(Object.keys(p.chains).sort(), roles.sort());
  for (const r of roles) {
    const e = reg.roles[r];
    assert.deepEqual(p.pins[r], { provider: e.provider, model: e.model, effort: e.effort === undefined ? null : e.effort }, r);
  }
});

test("v2: every shipped chain ends on claude-opus-5-5 (no chain ends on Sonnet, Fable or another lab)", () => {
  for (const id of ["default", "spend-more-on-codex", "spend-more-on-claude"]) {
    const p = P.loadPreset(id, shippedOpts());
    for (const [role, chain] of Object.entries(p.chains)) {
      const last = chain[chain.length - 1];
      assert.deepEqual([last.provider, last.model], ["claude", "claude-opus-5-5"], `${id}/${role}`);
    }
  }
});

test("v2: validateChains refuses a chain ending on a non-Claude entry, on Fable, an empty chain and a bad tuple", () => {
  const roles = ["r1", "r2", "r3", "r4"];
  const f = P.validateChains(
    {
      kind: "overlay",
      chains: {
        r1: [{ provider: "openai", model: "gpt-6.1-sol", effort: "high" }],
        r2: [{ provider: "claude", model: "claude-opus-5-5", effort: "high" }, { provider: "claude", model: "claude-fable-5-2", effort: "high" }],
        r3: [],
        r4: [{ provider: "claude", model: "claude-opus-5-5", effort: "ultra" }],
      },
    },
    roles,
  );
  const codes = f.map((x) => `${x.code}:${x.role}`).sort();
  assert.deepEqual(codes, ["chain-empty:r3", "chain-tail-fable:r2", "chain-tail-not-claude:r1", "entry-invalid:r4"]);
  assert.deepEqual(
    P.validateChains(
      {
        kind: "overlay",
        chains: {
          r1: [{ provider: "claude", model: "claude-fable-5-2", effort: "high" }, { provider: "claude", model: "claude-opus-5-5", effort: "high" }],
          r2: [{ provider: "antigravity", model: "gemini-4-argon-high", effort: null }, { provider: "claude", model: "claude-opus-5-5", effort: "high" }],
        },
      },
      roles,
    ),
    [],
  );
});

test("v2: a full preset must list every registry role; an overlay may name only registry roles", () => {
  const ok = [{ provider: "claude", model: "claude-opus-5-5", effort: "high" }];
  const full = P.validateChains({ kind: "full", chains: { a: ok } }, ["a", "b"]);
  assert.deepEqual(full.map((x) => x.code), ["roles-missing"]);
  const ov = P.validateChains({ kind: "overlay", chains: { a: ok, zz: ok } }, ["a", "b"]);
  assert.deepEqual(ov.map((x) => `${x.code}:${x.role}`), ["role-unknown:zz"]);
  assert.deepEqual(P.validateChains({ kind: "sideways", chains: { a: ok } }, ["a"]).map((x) => x.code), ["kind-invalid"]);
});

test("v2: loadPreset refuses an invalid chain unless allowInvalid; a pins-only (v1) file is named as the old format", () => {
  const e = env();
  fs.writeFileSync(path.join(e.opts.presetsDir, "bad.json"), JSON.stringify({ id: "bad", kind: "overlay", reason: "r", evidence: ["x"], chains: { beta: [{ provider: "openai", model: "gpt-6.1-sol", effort: "high" }] } }));
  assert.throws(() => P.loadPreset("bad", e.opts), /chain-tail-not-claude/);
  assert.ok(P.loadPreset("bad", { ...e.opts, allowInvalid: true }));
  fs.writeFileSync(path.join(e.opts.presetsDir, "old.json"), JSON.stringify({ id: "old", reason: "r", evidence: ["x"], pins: {} }));
  assert.throws(() => P.loadPreset("old", e.opts), /old pins-only format/);
});

test("v2: activePresetId reads manifest.modelPreset (absent = default) and refuses a non-id", () => {
  const e = env();
  assert.equal(P.activePresetId(e.opts), "default");
  fs.writeFileSync(e.manifestPath, JSON.stringify({ agentProviders: {}, modelPreset: "spend-more-on-codex" }));
  assert.equal(P.activePresetId(e.opts), "spend-more-on-codex");
  fs.writeFileSync(e.manifestPath, JSON.stringify({ agentProviders: {}, modelPreset: "../x" }));
  assert.throws(() => P.activePresetId(e.opts), /not a preset id/);
});

test("the preset validator shares coverage-gate's familyOf: unknown / proto providers never satisfy cross-family", () => {
  const cg = require("./coverage-gate");
  for (const bad of ["constructor", "toString", "__proto__", "hasOwnProperty", "nope", "", null, undefined]) {
    assert.equal(cg.familyOf(bad), null, `coverage-gate familyOf(${String(bad)})`);
  }
  const reg = {
    roles: {
      builder1: { provider: "claude", model: "m", effort: "high", build_chain: true },
      "backend-reviewer": { provider: "claude", model: "m", effort: "high" },
      "frontend-reviewer": { provider: "claude", model: "m", effort: "high" },
      "qa-reviewer": { provider: "claude", model: "m", effort: "high" },
      "security-reviewer": { provider: "claude", model: "m", effort: "high", second_pass: { provider: "openai" } },
    },
  };
  const cov = { code: "cross-family", security: "cross-family", visual: "exempt-capability" };
  for (const bad of ["constructor", "toString", "__proto__", "nope"]) {
    const e = env();
    const r2 = JSON.parse(JSON.stringify(reg));
    for (const r of Object.keys(r2.roles)) {
      fs.writeFileSync(path.join(e.dir, `${r}.md`), "---\nname: x\nmodel: m\neffort: high\n---\nb\n");
      r2.roles[r].spec = `${r}.md`;
    }
    r2.roles["security-reviewer"].second_pass = { provider: bad };
    for (const r of ["backend-reviewer", "frontend-reviewer", "qa-reviewer", "security-reviewer"]) r2.roles[r].provider = "openai";
    fs.writeFileSync(e.opts.registryPath, JSON.stringify(r2));
    const found = P.validatePresetCoverage({ pins: {}, coverage: cov }, e.opts);
    assert.ok(found.some((f) => f.code === "coverage-unmet" && f.unitClass === "security" && /unknown/.test(f.msg)), `${bad}: security unmet via second pass: ${JSON.stringify(found)}`);
    assert.throws(() => P.validatePresetCoverage({ pins: { "backend-reviewer": { provider: bad, model: "m", effort: "high" } }, coverage: cov }, e.opts), /unknown provider|invalid/i);
  }
});

test("provenance gate is log-derived: unlogged hand pin / unreadable log refuse apply AND undo; clean log proceeds", () => {
  let e = env();
  e.writePreset("p", { beta: oa() });
  assert.equal(P.applyPreset("p", e.opts).ok, true);
  assert.equal(P.undoPreset({ ...e.opts, listBackups: () => [], restoreBackup: () => ({ restored: [] }) }).code, "nothing-to-undo");
  e = env();
  e.writePreset("p", { beta: oa() });
  e.opts.applySave({ role: "beta", provider: "claude", model: "claude-opus-4-8", effort: "low" });
  const n = e.calls.length;
  const r = P.applyPreset("p", e.opts);
  assert.equal(r.code, "overrides-uncertain");
  assert.equal(e.calls.length, n, "no write");
  e = env();
  e.writePreset("p", { beta: oa() });
  e.opts.applySave({ role: "beta", ...oa() });
  fs.mkdirSync(path.dirname(e.opts.logPath), { recursive: true });
  fs.writeFileSync(e.opts.logPath, JSON.stringify({ type: "apply", preset: "p", roles_changed: ["beta"], backup: "b1", ts: "t" }) + "\n");
  const ub = { listBackups: () => [{ id: "b1", changedFiles: [] }], createBackup: () => ({ id: "snap" }), restoreBackup: () => ({ restored: [] }) };
  assert.equal(P.undoPreset({ ...e.opts, ...ub }).ok, true, "clean log: undo proceeds");
  fs.appendFileSync(e.opts.logPath, JSON.stringify({ type: "apply", preset: "p", roles_changed: ["beta"], backup: "b2", ts: "t" }) + "\n");
  e.opts.applySave({ role: "alpha", provider: "claude", model: "claude-opus-4-8", effort: "low" });
  const u = P.undoPreset({ ...e.opts, ...ub, listBackups: () => [{ id: "b2", changedFiles: [] }] });
  assert.equal(u.code, "overrides-uncertain");
  assert.deepEqual(u.roles, ["alpha"]);
  e = env();
  e.writePreset("p", { beta: oa() });
  fs.mkdirSync(e.opts.logPath, { recursive: true });
  assert.equal(P.applyPreset("p", e.opts).code, "provenance-incomplete");
  assert.equal(P.undoPreset(e.opts).code, "provenance-incomplete");
  e = env();
  e.writePreset("p", { beta: oa() });
  fs.mkdirSync(path.dirname(e.opts.logPath), { recursive: true });
  fs.writeFileSync(e.opts.logPath, "{truncated\n");
  assert.equal(P.applyPreset("p", e.opts).code, "provenance-incomplete");
  assert.equal(P.applyPreset("p", { ...e.opts, confirmOverrides: true }).ok, true);
});
