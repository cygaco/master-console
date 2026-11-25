"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const MR = require("./model-resolve");
const catalog = require("./catalog");

const REPO = path.resolve(__dirname, "..", "..");
const REGISTRY = path.join(REPO, ".claude", "agents", "_org", "role-registry.json");
const PRESETS = path.join(REPO, ".claude", "agents", "_org", "presets");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

function shippedOpts(extra) {
  const dir = tmp("mr-ship-");
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, "{}\n");
  return { registryPath: REGISTRY, manifestPath, projectRoot: REPO, presetsDir: PRESETS, logPath: path.join(dir, "log.jsonl"), ...(extra || {}) };
}
const registryRoles = () => {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
  return Object.keys(reg.roles).filter((r) => !r.startsWith("_"));
};
const known = (claude, openai, antigravity, served) => ({
  state: "known",
  providers: {
    claude: { signedIn: claude },
    openai: { signedIn: openai },
    antigravity: served ? { signedIn: antigravity, served } : { signedIn: antigravity },
  },
});
const ALL = known(true, true, true);
const CLAUDE_ONLY = known(true, false, false);

test("every preset x every registry role x 4 sign-in combos x both channels resolves to a catalog model", () => {
  const roles = registryRoles();
  assert.equal(roles.length >= 35, true);
  let n = 0;
  for (const presetId of ["default", "spend-more-on-codex", "spend-more-on-claude"]) {
    const o = shippedOpts({ presetId });
    const view = MR.effectiveChains(o);
    for (const role of roles) {
      const ip = MR.resolveRole(role, { ...o, chainsView: view, channel: "in-process" });
      assert.equal(ip.provider, "claude", `${presetId}/${role} in-process provider`);
      assert.ok(/^claude-/.test(ip.model), `${presetId}/${role} in-process model ${ip.model}`);
      assert.equal(catalog.validateTuple(ip.provider, ip.model, ip.effort), null);
      n++;
      for (const c of MR.COMBOS) {
        const r = MR.resolveRole(role, { ...o, chainsView: view, channel: "cli", signin: MR.comboSignin(c), call: { promptChars: 100 } });
        assert.ok(r.model, `${presetId}/${role}/${c.name}: unresolved`);
        assert.equal(catalog.validateTuple(r.provider, r.model, r.effort), null, `${presetId}/${role}/${c.name}`);
        assert.ok(c[r.provider], `${presetId}/${role}/${c.name}: resolved to ${r.provider}, which is not signed in`);
        assert.notEqual(r.source, "chain-exhausted", `${presetId}/${role}/${c.name}`);
        n++;
      }
    }
  }
  assert.equal(n, 3 * roles.length * 5);
});

test("in-process never returns a non-Claude model, even for a role whose chain starts on another lab", () => {
  const o = shippedOpts();
  const r = MR.resolveRole("beta", { ...o, channel: "in-process" });
  assert.deepEqual([r.provider, r.model, r.effort, r.alias, r.index], ["claude", "claude-opus-5-5", "high", "opus", 2]);
  assert.deepEqual(r.skipped.map((s) => [s.index, s.provider, s.reason]), [[0, "openai", "not-claude"], [1, "antigravity", "not-claude"]]);
  assert.equal(r.signin_state, "not-used");
  const view = { activeId: "x", chains: { "odd-role": [{ provider: "openai", model: "gpt-6.1-sol", effort: "high" }] }, from: { "odd-role": "x" } };
  const odd = MR.resolveRole("odd-role", { ...o, chainsView: view, channel: "in-process" });
  assert.deepEqual([odd.provider, odd.model, odd.source], ["claude", "claude-opus-5-5", "fail-safe"]);
  const unknown = MR.resolveRole("no-such-role-xyz", { ...o, channel: "in-process" });
  assert.deepEqual([unknown.provider, unknown.model, unknown.source], ["claude", "claude-opus-5-5", "fail-safe"]);
});

test("cli: an unknown role is reported as unknown-role (the caller keeps its old path)", () => {
  const r = MR.resolveRole("no-such-role-xyz", { ...shippedOpts(), channel: "cli", signin: ALL });
  assert.deepEqual([r.provider, r.model, r.source], [null, null, "unknown-role"]);
});

test("agentAlias maps a catalog model to the Agent-tool alias whose target it is", () => {
  assert.equal(MR.agentAlias("claude-opus-5-5"), "opus");
  assert.equal(MR.agentAlias("claude-sonnet-5-5"), "sonnet");
  assert.equal(MR.agentAlias("claude-haiku-5-5"), "haiku");
  assert.equal(MR.agentAlias("claude-fable-5-1"), null);
  assert.equal(MR.agentAlias("gpt-6.1-sol"), null);
  for (const a of MR.AGENT_TOOL_ALIASES) {
    const m = catalog.PROVIDERS.claude.models.find((x) => (x.aliases || []).includes(a));
    if (m) assert.equal(MR.agentAlias(m.id), a, a);
  }
});

test("an overlay replaces the listed roles' WHOLE chain; unlisted roles keep the default chain", () => {
  const def = MR.effectiveChains(shippedOpts());
  const ov = MR.effectiveChains(shippedOpts({ presetId: "spend-more-on-codex" }));
  const raw = JSON.parse(fs.readFileSync(path.join(PRESETS, "spend-more-on-codex.json"), "utf8"));
  assert.equal(ov.activeId, "spend-more-on-codex");
  for (const role of Object.keys(raw.chains)) {
    assert.deepEqual(ov.chains[role], raw.chains[role], role);
    assert.equal(ov.from[role], "spend-more-on-codex");
  }
  assert.deepEqual(ov.chains["security-reviewer"], def.chains["security-reviewer"]);
  assert.equal(ov.from["security-reviewer"], "default");
  assert.equal(MR.effectiveChains(shippedOpts({ presetId: "standard" })).activeId, "default");
});

test("an overlay ending on a non-Claude entry, or on Fable, is refused before anything resolves", () => {
  for (const [tag, tail] of [["openai", { provider: "openai", model: "gpt-6.1-sol", effort: "high" }], ["fable", { provider: "claude", model: "claude-fable-5-2", effort: "high" }]]) {
    const dir = tmp("mr-bad-");
    for (const f of fs.readdirSync(PRESETS)) fs.copyFileSync(path.join(PRESETS, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ id: "bad", kind: "overlay", reason: "r", evidence: ["x"], coverage: { code: "same-family", security: "cross-family", visual: "exempt-capability" }, chains: { beta: [{ provider: "claude", model: "claude-opus-5-5", effort: "high" }, tail] } }));
    const o = shippedOpts({ presetsDir: dir, presetId: "bad" });
    assert.throws(() => MR.resolveRole("beta", { ...o, channel: "cli", signin: ALL }), tag === "fable" ? /chain-tail-fable/ : /chain-tail-not-claude/);
  }
});

test("cli walk: codex signed out routes a GPT-first role to agy, then to Claude; each skip names its reason", () => {
  const o = shippedOpts();
  const a = MR.resolveRole("beta", { ...o, channel: "cli", signin: known(true, false, true) });
  assert.deepEqual([a.provider, a.model, a.index, a.signin_state], ["antigravity", "gemini-4-argon-high", 1, "known"]);
  assert.deepEqual(a.skipped.map((s) => [s.index, s.provider, s.reason]), [[0, "openai", "not-signed-in"]]);
  const b = MR.resolveRole("beta", { ...o, channel: "cli", signin: CLAUDE_ONLY });
  assert.deepEqual([b.provider, b.model, b.effort, b.index], ["claude", "claude-opus-5-5", "high", 2]);
  assert.equal(b.skipped.length, 2);
});

test("cli walk: agy is skipped for a prompt over 32,000 characters and for a call that needs workspace tools", () => {
  const o = shippedOpts();
  const at = MR.resolveRole("research-lead", { ...o, channel: "cli", signin: ALL, call: { promptChars: 32000 } });
  assert.equal(at.provider, "antigravity", "32,000 characters is still within agy's limit");
  const long = MR.resolveRole("research-lead", { ...o, channel: "cli", signin: ALL, call: { promptChars: 32001 } });
  assert.deepEqual([long.provider, long.index], ["openai", 2], "both agy entries (Neon, then Argon) are skipped");
  assert.equal(long.skipped[0].reason, "prompt-too-long");
  assert.match(long.skipped[0].detail, /32001/);
  const ws = MR.resolveRole("research-lead", { ...o, channel: "cli", signin: ALL, call: { promptChars: 10, needsWorkspace: true } });
  assert.deepEqual([ws.provider, ws.skipped[0].reason], ["openai", "needs-workspace"]);
  const served = MR.resolveRole("research-lead", { ...o, channel: "cli", signin: known(true, true, true, ["gemini-3.8-flash"]) });
  assert.deepEqual([served.provider, served.skipped[0].reason], ["openai", "not-served"]);
});

test("cli walk: every entry skipped -> the chain's last (Claude) entry, marked chain-exhausted", () => {
  const r = MR.resolveRole("beta", { ...shippedOpts(), channel: "cli", signin: known(false, false, false) });
  assert.deepEqual([r.provider, r.model, r.source, r.skipped.length], ["claude", "claude-opus-5-5", "chain-exhausted", 3]);
});

test("diversity: the fail-closed security lane reports single-family on Claude and multi-family otherwise", () => {
  const o = shippedOpts();
  assert.equal(MR.resolveRole("security-reviewer", { ...o, channel: "cli", signin: CLAUDE_ONLY }).diversity, "single-family");
  assert.equal(MR.resolveRole("security-reviewer", { ...o, channel: "cli", signin: ALL }).diversity, "multi-family");
  assert.equal(MR.resolveRole("security-reviewer", { ...o, channel: "cli", signin: known(true, true, false) }).diversity, "multi-family");
  assert.equal(MR.resolveRole("beta", { ...o, channel: "cli", signin: CLAUDE_ONLY }).diversity, null);
});

const NOW = Date.parse("2026-11-17T20:00:00Z");
const goodRecord = (over) => ({
  schema: MR.SIGNIN_SCHEMA,
  writer: { tool: MR.SIGNIN_WRITER, version: 1 },
  ts: "2026-11-17T19:00:00Z",
  providers: {
    claude: { signedIn: true, method: "claude.ai", exit: 0 },
    openai: { signedIn: false, method: "codex login status", exit: 1 },
    antigravity: { signedIn: true, method: "agy models", exit: 0, served: ["gemini-4-argon-high", "gemini-3.8-flash"] },
  },
  ...(over || {}),
});
function cacheFile(content) {
  const f = path.join(tmp("mr-signin-"), "model-signin.json");
  if (content !== undefined) fs.writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content));
  return f;
}
const betaWith = (file, present) => MR.resolveRole("beta", { ...shippedOpts(), channel: "cli", toolPresent: present || (() => true), signin: MR.readSigninState({ signinPath: file, now: NOW }) });

test("sign-in unknown (missing/expired record) + a CLI that is not installed -> that entry is skipped locally, the next one taken", () => {
  const noCodex = (p) => p !== "openai";
  const r = betaWith(cacheFile(undefined), noCodex);
  assert.equal(r.signin_state, "unknown");
  assert.deepEqual([r.provider, r.index], ["antigravity", 1]);
  assert.deepEqual(r.skipped.map((s) => [s.provider, s.reason]), [["openai", "not-installed"]]);
  const none = betaWith(cacheFile(undefined), (p) => p === "claude");
  assert.deepEqual([none.provider, none.index], ["claude", 2], "a Claude-only machine reaches Claude even with no sign-in record");
  const all = betaWith(cacheFile(undefined), () => true);
  assert.deepEqual([all.provider, all.index, all.skipped.length], ["openai", 0, 0], "installed + unknown keeps the pin");
});

test("only 'not found on PATH' reads as not installed; a binary safe-spawn REFUSES stays present (refused loudly at dispatch)", () => {
  const notFound = () => ({ ok: false, reason: "tool 'codex' not found on PATH" });
  const refused = () => ({ ok: false, reason: "resolved 'codex' (C:/x/codex) cannot be native-realpath'd — refusing (fail closed)" });
  const ok = () => ({ ok: true, path: "/bin/codex" });
  assert.equal(MR._toolPresent("openai", notFound), false);
  assert.equal(MR._toolPresent("openai", refused), true);
  assert.equal(MR._toolPresent("openai", ok), true);
  assert.equal(MR._toolPresent("claude", notFound), true, "Claude is always present (this runs in Claude Code)");
});

test("an UNKNOWN agy answer (signedIn null, served []) never skips an agy entry; a signed-in served list still does", () => {
  const rec = goodRecord();
  rec.providers.antigravity = { signedIn: null, method: "agy models", exit: null, served: [] };
  const r = MR.resolveRole("research-lead", { ...shippedOpts(), channel: "cli", toolPresent: () => true, signin: MR.readSigninState({ signinPath: cacheFile(rec), now: NOW }) });
  assert.deepEqual([r.provider, r.index, r.skipped.length], ["antigravity", 0, 0]);
  const rec2 = goodRecord();
  rec2.providers.antigravity = { signedIn: true, method: "agy models", exit: 0, served: ["gemini-3.8-flash"] };
  const r2 = MR.resolveRole("research-lead", { ...shippedOpts(), channel: "cli", toolPresent: () => true, signin: MR.readSigninState({ signinPath: cacheFile(rec2), now: NOW }) });
  assert.deepEqual(r2.skipped.map((s) => [s.provider, s.reason]), [["antigravity", "not-served"], ["antigravity", "not-served"], ["openai", "not-signed-in"]]);
});

test("sign-in GREEN control: a valid stamped record with codex signed out routes beta onward and names the skip", () => {
  const st = MR.readSigninState({ signinPath: cacheFile(goodRecord()), now: NOW });
  assert.equal(st.state, "known");
  assert.deepEqual(Object.keys(st.providers.openai), ["signedIn"], "only the boolean is kept");
  const r = betaWith(cacheFile(goodRecord()));
  assert.deepEqual([r.provider, r.index, r.signin_state], ["antigravity", 1, "known"]);
  assert.deepEqual(r.skipped.map((s) => [s.provider, s.reason]), [["openai", "not-signed-in"]]);
});

test("sign-in UNKNOWN per tool (signedIn null: slow, refused or unreadable check) keeps the pin; only a definite false skips", () => {
  const rec = goodRecord();
  rec.providers.openai = { signedIn: null, method: "codex login status", exit: null };
  const st = MR.readSigninState({ signinPath: cacheFile(rec), now: NOW });
  assert.equal(st.state, "known");
  assert.equal(st.providers.openai.signedIn, null);
  const r = betaWith(cacheFile(rec));
  assert.deepEqual([r.provider, r.model, r.index, r.skipped.length], ["openai", "gpt-6.2-sol", 0, 0], "an unknown answer never moves beta off its pin");
});

test("sign-in falsifiers: missing, truncated, forged (no writer stamp), foreign writer, bad schema, stale, future, non-boolean -> pin kept", () => {
  const cases = {
    missing: cacheFile(undefined),
    truncated: cacheFile(JSON.stringify(goodRecord()).slice(0, 60)),
    "forged-no-writer": cacheFile(goodRecord({ writer: undefined })),
    "foreign-writer": cacheFile(goodRecord({ writer: { tool: "scripts/other.js", version: 1 } })),
    "bad-schema": cacheFile(goodRecord({ schema: "mc/model-signin/v0" })),
    stale: cacheFile(goodRecord({ ts: "2026-11-09T19:00:00Z" })),
    future: cacheFile(goodRecord({ ts: "2026-11-18T20:00:00Z" })),
    "non-boolean": cacheFile(goodRecord({ providers: { claude: { signedIn: true }, openai: { signedIn: "no" }, antigravity: { signedIn: true } } })),
    "served-not-list": cacheFile(goodRecord({ providers: { claude: { signedIn: true }, openai: { signedIn: false }, antigravity: { signedIn: true, served: "all" } } })),
  };
  for (const [name, file] of Object.entries(cases)) {
    const st = MR.readSigninState({ signinPath: file, now: NOW });
    assert.equal(st.state, "unknown", name);
    assert.ok(st.reason, name);
    const r = betaWith(file);
    assert.deepEqual([r.provider, r.model, r.index, r.signin_state, r.skipped.length], ["openai", "gpt-6.2-sol", 0, "unknown", 0], name);
  }
});

test("the sign-in record path comes from the paths registry key when present, else the runtime fallback file", () => {
  const p = MR.signinCachePath({});
  const { PATHS } = require("../hooks/lib/paths");
  if (PATHS.modelSigninCache) assert.equal(p, PATHS.modelSigninCache);
  else assert.equal(path.basename(p), MR.SIGNIN_FALLBACK_FILE);
});

function project(opts) {
  const dir = tmp("mr-proj-");
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const roles = {
    "zz-doer": { tier: "worker", provider: "claude", model: "claude-sonnet-5-5", effort: "high", spec: ".claude/agents/zz-doer.md" },
    "zz-rev": { tier: "lead", provider: "openai", model: "gpt-6.1-sol", effort: "high", spec: ".claude/agents/zz-rev.md" },
    "zz-gem": { tier: "lead", provider: "antigravity", model: "gemini-4-argon-high", effort: null, spec: ".claude/agents/zz-gem.md" },
  };
  w(".claude/agents/_org/role-registry.json", JSON.stringify({ roles }));
  w(".claude/agents/zz-doer.md", "---\nname: zz-doer\nmodel: claude-sonnet-5-5\neffort: high\n---\nbody\n");
  w(".claude/agents/zz-rev.md", "---\nname: zz-rev\nmodel: inherit\nprovider: openai\nprovider_model: gpt-6.1-sol\nprovider_reasoning_effort: high\n---\nbody\n");
  w(".claude/agents/zz-gem.md", "---\nname: zz-gem\nprovider: antigravity\nprovider_model: gemini-4-argon-high\nmodel: claude-opus-4-8\n---\nbody\n");
  const E = (provider, model, effort) => ({ provider, model, effort });
  w(".claude/agents/_org/presets/default.json", JSON.stringify({
    id: "default", kind: "full", reason: "Fixture.", evidence: ["fixture"],
    coverage: { code: "same-family", security: "cross-family", visual: "exempt-capability" },
    chains: {
      "zz-doer": [E("claude", "claude-sonnet-5-5", "high"), E("claude", "claude-opus-5-5", "high")],
      "zz-rev": [E("openai", "gpt-6.1-sol", "high"), E("antigravity", "gemini-4-argon-high", null), E("claude", "claude-opus-5-5", "xhigh")],
      "zz-gem": [E("antigravity", "gemini-4-argon-high", null), E("openai", "gpt-6.1-sol", "high"), E("claude", "claude-opus-5-5", "high")],
    },
  }));
  w(".claude/manifest.json", JSON.stringify({ agentProviders: (opts && opts.agentProviders) || {} }, null, 2) + "\n");
  return {
    dir,
    w,
    opts: {
      projectRoot: dir,
      registryPath: path.join(dir, ".claude/agents/_org/role-registry.json"),
      manifestPath: path.join(dir, ".claude/manifest.json"),
      presetsDir: path.join(dir, ".claude/agents/_org/presets"),
      logPath: path.join(dir, ".claude/project/log.jsonl"),
    },
  };
}

test("a user pin that differs from chain[0] is put first; later copies are dropped but the Claude floor stays", () => {
  const p = project({ agentProviders: { "zz-rev": "antigravity", "zz-doer": "claude" } });
  p.w(".claude/agents/zz-rev.md", "---\nname: zz-rev\nprovider: antigravity\nprovider_model: gemini-4-argon-high\nmodel: claude-opus-5-5\neffort: xhigh\n---\nbody\n");
  const chain = MR.chainFor("zz-rev", p.opts);
  assert.deepEqual(chain.map((e) => `${e.provider}:${e.model}:${e.effort}`), ["antigravity:gemini-4-argon-high:null", "openai:gpt-6.1-sol:high", "claude:claude-opus-5-5:xhigh"]);
  const r = MR.resolveRole("zz-rev", { ...p.opts, channel: "cli", signin: ALL });
  assert.deepEqual([r.provider, r.source], ["antigravity", "user-pin"]);
  assert.equal(chain[0].effort, null);
  p.w(".claude/agents/zz-doer.md", "---\nname: zz-doer\nmodel: claude-opus-5-5\neffort: high\n---\nbody\n");
  const d = MR.chainFor("zz-doer", p.opts);
  assert.deepEqual(d.map((e) => e.model), ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.equal(MR.resolveRole("zz-doer", { ...p.opts, channel: "in-process" }).source, "user-pin");
});

test("a user pin equal to chain[0] changes nothing; an uncatalogued user pin is ignored with a note", () => {
  const p = project({ agentProviders: { "zz-doer": "claude" } });
  assert.deepEqual(MR.chainFor("zz-doer", p.opts).map((e) => e.model), ["claude-sonnet-5-5", "claude-opus-5-5"]);
  p.w(".claude/agents/zz-doer.md", "---\nname: zz-doer\nmodel: claude-opus-9-9\neffort: high\n---\nbody\n");
  const info = MR.chainInfo("zz-doer", p.opts);
  assert.equal(info.userPin, null);
  assert.match(info.userPinIgnored, /claude-opus-9-9/);
  assert.equal(MR.resolveRole("zz-doer", { ...p.opts, channel: "in-process" }).model, "claude-sonnet-5-5");
});

test("spec sync writes model/effort = the in-process answer, keeps provider lines, --check goes RED on drift", () => {
  const p = project({ agentProviders: { "zz-rev": "openai" } });
  const before = MR.syncSpecs({ ...p.opts, check: true });
  assert.equal(before.ok, false);
  assert.deepEqual(before.drift.map((d) => d.role).sort(), ["zz-gem", "zz-rev"]);
  const wrote = MR.syncSpecs(p.opts);
  assert.deepEqual(wrote.written.sort(), [".claude/agents/zz-gem.md", ".claude/agents/zz-rev.md"]);
  const rev = fs.readFileSync(path.join(p.dir, ".claude/agents/zz-rev.md"), "utf8");
  assert.match(rev, /^model: claude-opus-5-5$/m);
  assert.match(rev, /^effort: xhigh$/m);
  assert.match(rev, /^provider_model: gpt-6.1-sol$/m);
  assert.match(rev, /^provider_reasoning_effort: high$/m);
  const gem = fs.readFileSync(path.join(p.dir, ".claude/agents/zz-gem.md"), "utf8");
  assert.match(gem, /^model: claude-opus-5-5$/m);
  assert.match(gem, /^effort: high$/m);
  assert.equal(MR.syncSpecs({ ...p.opts, check: true }).ok, true, "in sync after the write");
  const pin = require("./effective-pin").effectivePin("zz-rev", p.opts);
  assert.deepEqual([pin.provider, pin.model, pin.effort], ["openai", "gpt-6.1-sol", "high"]);
  p.w(".claude/agents/zz-doer.md", "---\nname: zz-doer\nmodel: claude-haiku-5-5\neffort: high\n---\nbody\n");
  const drift = MR.syncSpecs({ ...p.opts, check: true });
  assert.deepEqual([drift.ok, drift.drift.map((d) => d.role)], [false, ["zz-doer"]]);
});

test("spec sync CLI: --check exits 1 and lists the drifted spec; the shipped tree is in sync", () => {
  const run = (args, dir) => spawnSync(process.execPath, [path.join(__dirname, "model-resolve.js"), ...args], {
    cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8",
  });
  const shipped = run(["--sync-specs", "--check"], REPO);
  assert.equal(shipped.status, 0, shipped.stdout + shipped.stderr);
  const p = project();
  fs.mkdirSync(path.join(p.dir, ".claude"), { recursive: true });
  fs.copyFileSync(path.join(REPO, ".claude", "paths.json"), path.join(p.dir, ".claude", "paths.json"));
  const r = run(["--sync-specs", "--check"], p.dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /DRIFT \.claude\/agents\/zz-gem\.md: model should be claude-opus-5-5/);
});

test("the shipped tree: effective-pin still reports beta as openai/gpt-6.2-sol after the sync", () => {
  const pin = require("./effective-pin").effectivePin("beta");
  assert.deepEqual([pin.provider, pin.model, pin.effort], ["openai", "gpt-6.2-sol", "high"]);
});

test("save.js: a non-Claude save writes the in-process answer into model/effort (never 'inherit')", () => {
  const p = project();
  fs.copyFileSync(path.join(REPO, ".claude", "paths.json"), path.join(p.dir, ".claude", "paths.json"));
  const script = path.join(tmp("mr-child-"), "preview.js");
  fs.writeFileSync(script, `const r=require(${JSON.stringify(path.join(__dirname, "save.js"))}).previewSave({role:"zz-rev",provider:"openai",model:"gpt-6.1-sol",effort:"high",fallback:"claude"});const w=(r.writes||[]).find(x=>/zz-rev\\.md$/.test(x.path));console.log(JSON.stringify({ok:r.ok,error:r.error,after:w&&w.after}));`);
  const out = spawnSync(process.execPath, [script], { cwd: p.dir, env: { ...process.env, CLAUDE_PROJECT_DIR: p.dir }, encoding: "utf8" });
  const res = JSON.parse(out.stdout);
  assert.equal(res.ok, true, res.error || out.stderr);
  assert.match(res.after, /^model: claude-opus-5-5$/m);
  assert.match(res.after, /^effort: xhigh$/m);
  assert.doesNotMatch(res.after, /inherit/);
  assert.match(res.after, /^provider_model: gpt-6.1-sol$/m);
});

test("ONE ROLE LIST: catalog.ROLES holds every registry role (plus the legacy names); the route writer previews every registry role", () => {
  const roles = registryRoles();
  for (const r of roles) assert.ok(catalog.ROLES.includes(r), r);
  for (const legacy of catalog.LEGACY_ROLE_NAMES) assert.ok(catalog.ROLES.includes(legacy), legacy);
  const script = path.join(tmp("mr-child-"), "preview-all.js");
  fs.writeFileSync(script, `
const s=require(${JSON.stringify(path.join(__dirname, "save.js"))});
const mr=require(${JSON.stringify(path.join(__dirname, "model-resolve.js"))});
const view=mr.effectiveChains({});
const bad=[];
for (const role of ${JSON.stringify(roles)}) {
  const e=view.chains[role][0];
  const r=s.previewSave({role,provider:e.provider,model:e.model,effort:e.effort||null,fallback:e.provider==="claude"?null:"claude"});
  if(!r.ok) bad.push(role+": "+r.error);
}
console.log(JSON.stringify({n:${roles.length},bad}));`);
  const out = spawnSync(process.execPath, [script], { cwd: REPO, env: { ...process.env, CLAUDE_PROJECT_DIR: REPO }, encoding: "utf8" });
  const res = JSON.parse(out.stdout);
  assert.deepEqual(res.bad, [], out.stderr);
  assert.equal(res.n, roles.length);
});

test("presets.js use <id>: sets manifest.modelPreset with one backup and re-syncs the specs", () => {
  const p = project();
  const P = require("./presets");
  fs.writeFileSync(path.join(p.opts.presetsDir, "more-claude.json"), JSON.stringify({
    id: "more-claude", kind: "overlay", reason: "Fixture.", evidence: ["fixture"],
    coverage: { code: "same-family", security: "cross-family", visual: "exempt-capability" },
    chains: { "zz-rev": [{ provider: "claude", model: "claude-sonnet-5-5", effort: "medium" }, { provider: "claude", model: "claude-opus-5-5", effort: "high" }] },
  }));
  const backups = [];
  const r = P.usePreset("more-claude", { ...p.opts, createBackup: (files, meta) => { backups.push({ files, meta }); return { id: "b1" }; } });
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(p.opts.manifestPath, "utf8")).modelPreset, "more-claude");
  assert.equal(backups.length, 1);
  assert.ok(backups[0].files.includes(p.opts.manifestPath));
  const specText = fs.readFileSync(path.join(p.dir, ".claude/agents/zz-rev.md"), "utf8");
  assert.doesNotMatch(specText, /^model: claude-sonnet-5-5$/m, "the spec is not rewritten to the overlay");
  assert.equal(MR.resolveRole("zz-rev", { ...p.opts, channel: "cli", signin: ALL }).model, "claude-sonnet-5-5");
  const ip = MR.resolveRole("zz-rev", { ...p.opts, channel: "in-process" });
  assert.deepEqual([ip.model, ip.spawn.pinned, ip.spawn.model, ip.spawn.effort], ["claude-sonnet-5-5", true, "sonnet", "medium"]);
  assert.ok(Array.isArray(r.kept_by_your_pin), "use reports the roles a project pin keeps on its own model");
  assert.deepEqual(r.kept_by_your_pin.map((k) => k.role), [], "no project pin in this fixture");
  fs.writeFileSync(path.join(p.opts.presetsDir, "bad.json"), JSON.stringify({ id: "bad", kind: "overlay", reason: "r", evidence: ["x"], chains: { "zz-rev": [{ provider: "openai", model: "gpt-6.1-sol", effort: "high" }] } }));
  const m0 = fs.readFileSync(p.opts.manifestPath, "utf8");
  assert.throws(() => P.usePreset("bad", { ...p.opts, createBackup: () => ({ id: "x" }) }), /chain-tail-not-claude/);
  assert.equal(fs.readFileSync(p.opts.manifestPath, "utf8"), m0);
});

const pinOpts = (agentProviders, raw) => {
  const dir = tmp("mr-pin-");
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, raw !== undefined ? raw : JSON.stringify({ agentProviders }) + "\n");
  return { registryPath: REGISTRY, manifestPath, projectRoot: REPO, presetsDir: PRESETS, logPath: path.join(dir, "log.jsonl") };
};

test("PIN: the spec always carries the product default; an unpinned role spawns with no parameter", () => {
  const r = MR.resolveRole("director-of-engineering", { ...pinOpts({}), channel: "in-process" });
  assert.deepEqual(r.spec_default, { model: "claude-opus-5-5", effort: "high" });
  assert.deepEqual(r.spawn, { pinned: false, model: null, effort: null });
});

test("PIN: an in-process pin (manifest object form) becomes the spawn-time alias + effort; the spec is not involved", () => {
  const r = MR.resolveRole("director-of-engineering", { ...pinOpts({ "director-of-engineering": { provider: "claude", model: "claude-fable-5-2", effort: "high" } }), channel: "in-process" });
  assert.equal(r.model, "claude-fable-5-2");
  assert.deepEqual([r.spawn.pinned, r.spawn.model, r.spawn.effort], [true, "fable", "high"]);
  assert.deepEqual(r.spec_default, { model: "claude-opus-5-5", effort: "high" }, "the spec default is unchanged");
});

test("PIN: a pin to a CLI provider leaves the in-process spawn on the spec default (no parameter)", () => {
  const r = MR.resolveRole("director-of-engineering", { ...pinOpts({ "director-of-engineering": "openai" }), channel: "in-process" });
  assert.equal(r.spawn.pinned, false);
  assert.equal(r.model, "claude-opus-5-5");
});

test("PIN: a pin no alias reaches is unservable — not substituted — and names the remove-pin fix", () => {
  const r = MR.resolveRole("director-of-engineering", { ...pinOpts({ "director-of-engineering": { provider: "claude", model: "claude-opus-4-8", effort: "high" } }), channel: "in-process" });
  assert.equal(r.spawn.unservable, true);
  assert.equal(r.spawn.model, null, "no substitute model");
  assert.match(r.spawn.reason, /node scripts\/dispatch\.js set director-of-engineering --default/);
});

test("PIN: an unreadable project layer runs the product default with a recorded warning", () => {
  for (const raw of ["{not json", JSON.stringify({ agentProviders: { "director-of-engineering": 42 } })]) {
    const r = MR.resolveRole("director-of-engineering", { ...pinOpts(null, raw), channel: "in-process" });
    assert.deepEqual([r.model, r.spawn.pinned], ["claude-opus-5-5", false]);
    assert.match(r.warning, /could not be read/);
  }
});

test("a REAL fresh install's manifest (scaffold-core) carries no pins, so every role follows its chain", () => {
  const target = tmp("mr-fresh-install-");
  fs.mkdirSync(path.join(target, ".claude"), { recursive: true });
  require("../mc/scaffold-core").writeProductManifest({ target, interview: {}, stack: "node", framework: "none", log: () => {} });
  const manifestPath = path.join(target, ".claude", "manifest.json");
  const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.deepEqual(m.agentProviders, {}, "the installer writes an empty project layer");
  const o = { registryPath: REGISTRY, manifestPath, projectRoot: REPO, presetsDir: PRESETS, logPath: path.join(target, "log.jsonl") };
  const beta = (signin) => MR.resolveRole("beta", { ...o, channel: "cli", signin, toolPresent: () => true });
  assert.deepEqual([beta(ALL).provider, beta(ALL).index], ["openai", 0], "all signed in: beta runs its GPT pin, not Claude");
  assert.deepEqual([beta(known(true, false, true)).provider], ["antigravity"]);
  assert.deepEqual([beta(CLAUDE_ONLY).provider], ["claude"]);
  for (const role of registryRoles()) assert.equal(MR.resolveRole(role, { ...o, channel: "in-process" }).spawn.pinned, false, `${role} is not pinned on a fresh install`);
});
