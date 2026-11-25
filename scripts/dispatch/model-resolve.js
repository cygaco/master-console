#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const SIGNIN_SCHEMA = "mc/model-signin/v1";
const SIGNIN_WRITER = "scripts/dispatch/signin.js";
const SIGNIN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SIGNIN_FUTURE_SKEW_MS = 5 * 60 * 1000;
const SIGNIN_FALLBACK_FILE = "model-signin.json";
const SIGNIN_PROVIDERS = ["claude", "openai", "antigravity"];
const AGY_MAX_PROMPT_CHARS = 32000;
const FAIL_SAFE = Object.freeze({ provider: "claude", model: "claude-opus-5-5", effort: "high" });
const AGENT_TOOL_ALIASES = Object.freeze(["opus", "sonnet", "haiku", "fable"]);
const PROVIDER_LABEL = { claude: "Claude", openai: "Codex (OpenAI)", antigravity: "Gemini (agy)" };

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const BAD_ROLES = new Set(["__proto__", "constructor", "prototype"]);
const NO_PROJECT_LAYER = Object.freeze({ file: null, data: null, error: null });

function rootOpts(opts) {
  const o = { ...(opts || {}) };
  const { PROJECT, PATHS } = require("../hooks/lib/paths");
  const root = o.projectRoot || PROJECT;
  const at = (abs, fallback) =>
    typeof abs === "string" ? path.join(root, path.relative(PROJECT, abs)) : path.join(root, fallback);
  if (o.projectRoot === undefined) o.projectRoot = root;
  if (o.registryPath === undefined) o.registryPath = at(PATHS.orgRoleRegistry, ".claude/agents/_org/role-registry.json");
  if (o.manifestPath === undefined) o.manifestPath = at(PATHS.manifest, ".claude/manifest.json");
  if (o.presetsDir === undefined) o.presetsDir = path.join(at(PATHS.agents, ".claude/agents"), "_org", "presets");
  if (o.logPath === undefined) o.logPath = at(PATHS.modelPresetLog, ".claude/project/model-presets.log.jsonl");
  return o;
}

function readRegistry(o) {
  let text;
  try {
    text = fs.readFileSync(o.registryPath, "utf8");
  } catch (e) {
    throw new Error(`model-resolve: cannot read the role registry ${o.registryPath}: ${e.code || e.message}`);
  }
  let reg;
  try {
    reg = JSON.parse(text.replace(/^﻿/, ""));
  } catch (_) {
    throw new Error(`model-resolve: malformed JSON in the role registry ${o.registryPath}`);
  }
  if (!reg || !isPlainObject(reg.roles)) throw new Error(`model-resolve: role registry ${o.registryPath} has no roles object`);
  return reg;
}

function registryRoleIds(reg) {
  return Object.keys(reg.roles).filter((r) => !r.startsWith("_") && !BAD_ROLES.has(r) && isPlainObject(reg.roles[r]));
}

function normalizeRole(role) {
  try {
    return require("../hooks/lib/role-aliases").normalizeRole(role) || role;
  } catch (_) {
    return role;
  }
}

const normEntry = (e) => ({ provider: e.provider, model: e.model, effort: e.effort === undefined ? null : e.effort });
const sameModel = (a, b) => !!a && !!b && a.provider === b.provider && a.model === b.model;

function effectiveChains(opts) {
  const o = rootOpts(opts);
  const P = require("./presets");
  let requested = o.presetId;
  let viewWarning = null;
  if (!requested) {
    try {
      requested = P.activePresetId(o);
    } catch (e) {
      requested = P.DEFAULT_PRESET_ID;
      viewWarning = `the project's model preset choice could not be read (${(e && e.message) || "error"}); the default preset runs`;
    }
  }
  const manifestUnreadable = (e) => /manifest/i.test(String((e && e.message) || ""));
  const load = (id) => {
    try {
      return P.loadPreset(id, o);
    } catch (e) {
      if (!manifestUnreadable(e)) throw e;
      viewWarning = viewWarning || `the project layer (.claude/manifest.json) could not be read (${(e && e.message) || "error"}); the product default runs`;
      return P.loadPreset(id, { ...o, manifestPath: path.join(o.projectRoot || ".", ".claude", "__no-project-layer__.json"), manifestSnapshot: NO_PROJECT_LAYER });
    }
  };
  const def = load(P.DEFAULT_PRESET_ID);
  if (def.kind !== "full") throw new Error(`model-resolve: the default preset must be kind "full" (it is ${JSON.stringify(def.kind)})`);
  const chains = {};
  const from = {};
  for (const r of Object.keys(def.chains)) {
    chains[r] = def.chains[r].map(normEntry);
    from[r] = def.id;
  }
  let activeId = def.id;
  const resolvedId = P.resolvePresetId(requested, o);
  if (resolvedId !== def.id) {
    const act = load(resolvedId);
    activeId = act.id || resolvedId;
    if (act.kind === "full") {
      for (const r of Object.keys(chains)) delete chains[r];
    }
    for (const r of Object.keys(act.chains)) {
      chains[r] = act.chains[r].map(normEntry);
      from[r] = activeId;
    }
  }
  return { activeId, defaultId: def.id, chains, from, pending: isPlainObject(def.pending) ? def.pending : {}, warning: viewWarning };
}

function chainInfo(role, opts) {
  const o = rootOpts(opts);
  if (typeof role !== "string" || BAD_ROLES.has(role)) return null;
  const view = o.chainsView || effectiveChains(o);
  if (!hasOwn(view.chains, role)) return null;
  let entries = view.chains[role].map(normEntry);
  let userPin = null;
  let userPinIgnored = null;
  let projectPin = null;
  let pin = null;
  let projectLayerWarning = null;
  try {
    pin = require("./effective-pin").effectivePin(role, o);
  } catch (e) {
    projectLayerWarning = `the project layer (.claude/manifest.json agentProviders) could not be read (${(e && e.message) || "error"}); the product default runs`;
    pin = null;
  }
  if (pin && pin.source === "project") {
    const { validateTuple } = require("./catalog");
    const err = pin.model ? validateTuple(pin.provider, pin.model, pin.effort || null) : "it has no model";
    if (!err && pin.named) projectPin = normEntry(pin);
    if (err) {
      userPinIgnored = `the project pin ${pin.provider}/${pin.model || "?"} is not used: ${err}`;
    } else if (!sameModel(pin, entries[0])) {
      userPin = normEntry(pin);
      const last = entries.length - 1;
      entries = [userPin, ...entries.filter((e, i) => i === last || !sameModel(e, userPin))];
    } else if ((pin.effort || null) !== (entries[0].effort || null)) {
      userPin = normEntry(pin);
      entries = [userPin, ...entries.slice(1)];
    }
  }
  return { role, entries, preset: view.from[role], activeId: view.activeId, userPin, userPinIgnored, projectPin, projectLayerWarning: projectLayerWarning || view.warning || null, view };
}

function chainFor(role, opts) {
  const c = chainInfo(role, opts);
  return c ? c.entries : null;
}

function agentAlias(modelId) {
  if (typeof modelId !== "string") return null;
  const { PROVIDERS } = require("./catalog");
  const m = PROVIDERS.claude.models.find((x) => x.id === modelId);
  if (!m) return null;
  return (m.aliases || []).find((a) => AGENT_TOOL_ALIASES.includes(a)) || null;
}

function signinCachePath(opts) {
  if (opts && typeof opts.signinPath === "string") return opts.signinPath;
  const { PROJECT, PATHS } = require("../hooks/lib/paths");
  if (typeof PATHS.modelSigninCache === "string" && PATHS.modelSigninCache) return PATHS.modelSigninCache;
  return path.join(PATHS.runtime || path.join(PROJECT, ".claude", "runtime"), SIGNIN_FALLBACK_FILE);
}

function signinRecordProblem(obj, now) {
  if (!isPlainObject(obj)) return "the record is not a JSON object";
  if (obj.schema !== SIGNIN_SCHEMA) return `the record's schema is not ${SIGNIN_SCHEMA}`;
  if (!isPlainObject(obj.writer) || obj.writer.tool !== SIGNIN_WRITER) return `the record carries no writer stamp from ${SIGNIN_WRITER}`;
  const t = typeof obj.ts === "string" ? Date.parse(obj.ts) : NaN;
  if (!Number.isFinite(t)) return "the record has no readable time stamp";
  if (t > now + SIGNIN_FUTURE_SKEW_MS) return "the record's time stamp is in the future";
  if (now - t > SIGNIN_MAX_AGE_MS) return "the record is older than 7 days (refresh: node scripts/dispatch/signin.js --refresh)";
  if (!isPlainObject(obj.providers)) return "the record has no providers object";
  for (const p of SIGNIN_PROVIDERS) {
    const v = isPlainObject(obj.providers[p]) ? obj.providers[p].signedIn : undefined;
    if (v !== true && v !== false && v !== null) {
      return `providers.${p}.signedIn is not true, false or null`;
    }
  }
  const served = obj.providers.antigravity.served;
  if (served !== undefined && !(Array.isArray(served) && served.every((s) => typeof s === "string"))) {
    return "providers.antigravity.served is not a list of model ids";
  }
  return null;
}

const unknownState = (reason, file) => ({ state: "unknown", reason, path: file });

function readSigninState(opts) {
  const o = opts || {};
  const file = signinCachePath(o);
  const now = typeof o.now === "number" ? o.now : Date.now();
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return unknownState(e && e.code === "ENOENT" ? "no sign-in record yet" : `the sign-in record is unreadable (${(e && e.code) || "error"})`, file);
  }
  let obj;
  try {
    obj = JSON.parse(text.replace(/^﻿/, ""));
  } catch (_) {
    return unknownState("the sign-in record is not valid JSON (truncated or damaged)", file);
  }
  const problem = signinRecordProblem(obj, now);
  if (problem) return unknownState(problem, file);
  let writerValidate = null;
  const writerModule = path.join(__dirname, "signin.js");
  if (fs.existsSync(writerModule)) {
    try {
      writerValidate = require(writerModule).validateCacheRecord;
    } catch (e) {
      return unknownState(`the sign-in writer's validator could not load (${(e && e.message) || "error"})`, file);
    }
  }
  if (typeof writerValidate === "function") {
    let v;
    try {
      v = writerValidate(obj, { now, maxAgeDays: 7 });
    } catch (e) {
      v = { ok: false, reason: (e && e.message) || "validator error" };
    }
    if (!v || v.ok !== true) return unknownState(`the sign-in writer's validator refused the record: ${(v && v.reason) || "no reason"}`, file);
  }
  const providers = {};
  for (const p of SIGNIN_PROVIDERS) providers[p] = { signedIn: obj.providers[p].signedIn };
  if (Array.isArray(obj.providers.antigravity.served)) providers.antigravity.served = obj.providers.antigravity.served.slice();
  return { state: "known", ts: obj.ts, providers, path: file };
}

function registryEntry(role, o) {
  try {
    const reg = readRegistry(o);
    return hasOwn(reg.roles, role) && isPlainObject(reg.roles[role]) ? reg.roles[role] : null;
  } catch (_) {
    return null;
  }
}

function diversityOf(regEntry, provider) {
  if (!regEntry || regEntry.fails_closed_on_diversity_loss !== true) return null;
  return provider === "claude" ? "single-family" : "multi-family";
}

const PROVIDER_TOOL = Object.freeze({ claude: "claude", openai: "codex", antigravity: "agy" });
const presenceCache = new Map();
function toolPresent(provider, resolveToolFn) {
  if (provider === "claude") return true;
  if (!resolveToolFn && presenceCache.has(provider)) return presenceCache.get(provider);
  let present = true;
  try {
    const rt = resolveToolFn || require("./safe-spawn").resolveTool;
    const r = rt(PROVIDER_TOOL[provider] || provider);
    present = !(r && r.ok === false && /not found on PATH/.test(String(r.reason || "")));
  } catch (_) {
    present = true;
  }
  if (!resolveToolFn) presenceCache.set(provider, present);
  return present;
}

function skipReasonCli(e, signin, call, present) {
  const p = signin.providers || {};
  const s = p[e.provider];
  if (s && s.signedIn === false) {
    return { reason: "not-signed-in", detail: `not signed in to ${PROVIDER_LABEL[e.provider] || e.provider}` };
  }
  if ((!s || s.signedIn !== true) && typeof present === "function" && !present(e.provider)) {
    return { reason: "not-installed", detail: `${PROVIDER_LABEL[e.provider] || e.provider} is not installed on this computer` };
  }
  if (e.provider === "antigravity") {
    if (call.needsWorkspace) return { reason: "needs-workspace", detail: "the call needs workspace tools; the Gemini tool takes the prompt inline only" };
    if (call.promptChars > AGY_MAX_PROMPT_CHARS) {
      return { reason: "prompt-too-long", detail: `the prompt is ${call.promptChars} characters; the Gemini tool takes at most ${AGY_MAX_PROMPT_CHARS}` };
    }
    const ag = p.antigravity;
    if (ag && ag.signedIn === true && Array.isArray(ag.served) && ag.served.length > 0 && !ag.served.includes(e.model)) {
      return { reason: "not-served", detail: `the Gemini tool does not list ${e.model} among the models it serves` };
    }
  }
  return null;
}

function resolveRole(role, opts) {
  const o = rootOpts(opts);
  if (o.manifestSnapshot === undefined) o.manifestSnapshot = require("./effective-pin").readManifestSnapshot(o);
  const channel = o.channel;
  if (channel !== "in-process" && channel !== "cli") {
    throw new Error(`model-resolve: channel must be "in-process" or "cli" (got ${JSON.stringify(channel)})`);
  }
  const canonical = normalizeRole(role);
  const info = chainInfo(canonical, o);
  const reg = registryEntry(canonical, o);
  const pack = (entry, index, chain, skipped, signinState, source, extra) => ({
    role: canonical,
    channel,
    provider: entry ? entry.provider : null,
    model: entry ? entry.model : null,
    effort: entry ? entry.effort : null,
    alias: entry && entry.provider === "claude" ? agentAlias(entry.model) : null,
    index,
    chain,
    skipped,
    signin_state: signinState,
    diversity: entry ? diversityOf(reg, entry.provider) : null,
    source,
    preset: info ? info.activeId : null,
    ...(extra || {}),
  });

  if (channel === "in-process") {
    if (!info) {
      return pack(FAIL_SAFE, -1, [], [], "not-used", "fail-safe", { note: `unknown role '${canonical}': the in-process channel runs Claude only` });
    }
    const chain = info.entries;
    const idx = chain.findIndex((e) => e.provider === "claude");
    const skipped = chain
      .slice(0, idx < 0 ? chain.length : idx)
      .map((e, i) => ({ index: i, provider: e.provider, model: e.model, reason: "not-claude", detail: "the in-process channel runs Claude models only" }));
    if (idx < 0) return pack(FAIL_SAFE, -1, chain, skipped, "not-used", "fail-safe");
    const pp = info.projectPin;
    const pinnedHere = idx === 0 && !!pp && pp.provider === "claude";
    const src = (info.userPin && idx === 0) || pinnedHere ? "user-pin" : `preset:${info.preset}`;
    const def = specDefault(canonical, o);
    const answer = chain[idx];
    const differs = !def || def.model !== answer.model || (def.effort || null) !== (answer.effort || null);
    const alias = agentAlias(answer.model);
    const spawn = !differs && !pinnedHere
      ? { pinned: false, model: null, effort: null }
      : alias
        ? { pinned: true, model: alias, effort: answer.effort || null }
        : {
            pinned: true,
            model: null,
            effort: answer.effort || null,
            unservable: true,
            reason: `${canonical} is set to ${answer.model}, which no Agent-tool model alias (opus / sonnet / haiku / fable) reaches; an in-process pin chooses a tier, so it cannot be honoured and is not replaced. Fix: node scripts/dispatch.js set ${canonical} --default (or pin a tier)`,
          };
    const extra = { spec_default: def, spawn };
    if (info.userPinIgnored) extra.note = info.userPinIgnored;
    if (info.projectLayerWarning) extra.warning = info.projectLayerWarning;
    return pack(answer, idx, chain, skipped, "not-used", src, extra);
  }

  const signin = o.signin && typeof o.signin === "object" ? o.signin : readSigninState(o);
  const state = signin && signin.state === "known" ? "known" : "unknown";
  if (!info) return pack(null, -1, [], [], state, "unknown-role");
  const chain = info.entries;
  const headSource = info.userPin ? "user-pin" : `preset:${info.preset}`;
  const effective = state === "known" ? signin : comboSignin({ claude: null, openai: null, antigravity: null });
  const note = state === "known" ? null : `sign-in unknown (${(signin && signin.reason) || "no record"}): every installed tool is treated as signed in`;
  const present = typeof o.toolPresent === "function" ? o.toolPresent : toolPresent;
  const call = {
    promptChars: Number((o.call && o.call.promptChars) || 0) || 0,
    needsWorkspace: !!(o.call && o.call.needsWorkspace),
  };
  const skipped = [];
  for (let i = 0; i < chain.length; i++) {
    const why = skipReasonCli(chain[i], effective, call, present);
    if (!why) {
      const src = i === 0 ? headSource : `preset:${info.preset}`;
      return pack(chain[i], i, chain, skipped, state, src, note ? { note } : null);
    }
    skipped.push({ index: i, provider: chain[i].provider, model: chain[i].model, reason: why.reason, detail: why.detail });
  }
  const last = chain.length - 1;
  return pack(chain[last], last, chain, skipped, state, "chain-exhausted", {
    note: "no entry could take this call; the last entry (Claude) is used",
  });
}

function specDefault(role, opts) {
  try {
    const P = require("./presets");
    const view = effectiveChains({ ...rootOpts(opts), presetId: P.DEFAULT_PRESET_ID });
    const chain = hasOwn(view.chains, role) ? view.chains[role] : null;
    const e = chain && chain.find((x) => x.provider === "claude");
    return e ? { model: e.model, effort: e.effort === undefined ? null : e.effort } : null;
  } catch (_) {
    return null;
  }
}

function inProcessFromPreset(role, opts) {
  try {
    const view = effectiveChains(opts);
    const chain = hasOwn(view.chains, role) ? view.chains[role] : null;
    const e = chain && chain.find((x) => x.provider === "claude");
    if (e) return { model: e.model, effort: e.effort === undefined ? null : e.effort, source: `preset:${view.from[role]}` };
  } catch (_) {
  }
  return { model: FAIL_SAFE.model, effort: FAIL_SAFE.effort, source: "fail-safe" };
}

function planSpecSync(opts) {
  const o = rootOpts(opts);
  const view = effectiveChains(o);
  const reg = readRegistry(o);
  const fm = require("./frontmatter");
  const root = path.resolve(o.projectRoot);
  const out = [];
  for (const role of registryRoleIds(reg)) {
    const entry = reg.roles[role];
    if (typeof entry.spec !== "string" || !entry.spec) {
      out.push({ role, error: "the registry names no spec file" });
      continue;
    }
    const file = path.resolve(root, entry.spec);
    if (!file.startsWith(root + path.sep)) {
      out.push({ role, error: `the spec path ${entry.spec} leaves the project root` });
      continue;
    }
    let before;
    try {
      before = fs.readFileSync(file, "utf8");
    } catch (e) {
      out.push({ role, error: `cannot read ${entry.spec}: ${e.code || e.message}` });
      continue;
    }
    const parsed = fm.parse(before);
    if (parsed.fmLines.length === 0) {
      out.push({ role, error: `${entry.spec} has no frontmatter` });
      continue;
    }
    const r = specDefault(role, o) || { model: FAIL_SAFE.model, effort: FAIL_SAFE.effort };
    let next = fm.setValue(parsed, "model", r.model);
    next = r.effort ? fm.setValue(next, "effort", r.effort) : fm.removeKey(next, "effort");
    out.push({ role, path: file, rel: entry.spec, before, after: fm.serialize(next), model: r.model, effort: r.effort });
  }
  return out;
}

function syncSpecs(opts) {
  const o = rootOpts(opts);
  const plan = planSpecSync(o);
  const errors = plan.filter((w) => w.error);
  const drift = plan.filter((w) => !w.error && w.before !== w.after);
  if (!o.check) for (const w of drift) fs.writeFileSync(w.path, w.after, "utf8");
  return {
    ok: errors.length === 0 && (o.check ? drift.length === 0 : true),
    checked: plan.length,
    drift: drift.map((w) => ({ role: w.role, spec: w.rel, model: w.model, effort: w.effort })),
    errors: errors.map((w) => ({ role: w.role, error: w.error })),
    written: o.check ? [] : drift.map((w) => w.rel),
  };
}

const COMBOS = Object.freeze([
  { name: "all three", claude: true, openai: true, antigravity: true },
  { name: "claude+codex", claude: true, openai: true, antigravity: false },
  { name: "claude+agy", claude: true, openai: false, antigravity: true },
  { name: "claude only", claude: true, openai: false, antigravity: false },
]);

function comboSignin(c) {
  return {
    state: "known",
    providers: {
      claude: { signedIn: c.claude },
      openai: { signedIn: c.openai },
      antigravity: { signedIn: c.antigravity },
    },
  };
}

function table(opts) {
  const o = rootOpts(opts);
  const view = effectiveChains(o);
  const reg = readRegistry(o);
  const rows = [];
  for (const role of registryRoleIds(reg)) {
    const base = { ...o, chainsView: view };
    const ip = resolveRole(role, { ...base, channel: "in-process" });
    const byCombo = {};
    for (const c of COMBOS) {
      byCombo[c.name] = resolveRole(role, { ...base, channel: "cli", signin: comboSignin(c), call: { promptChars: 0, needsWorkspace: false } });
    }
    rows.push({ role, chain: ip.chain, inProcess: ip, cli: byCombo });
  }
  return { preset: view.activeId, rows };
}

const fmt = (r) => (r && r.model ? `${r.provider}:${r.model}${r.effort ? "@" + r.effort : ""}` : "(none)");

function main(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = has("--json");
  if (has("--sync-specs")) {
    const r = syncSpecs({ check: has("--check") });
    if (json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    else {
      for (const e of r.errors) process.stderr.write(`ERROR ${e.role}: ${e.error}\n`);
      if (has("--check")) {
        for (const d of r.drift) process.stdout.write(`DRIFT ${d.spec}: model should be ${d.model}${d.effort ? `, effort ${d.effort}` : ", no effort line"}\n`);
        process.stdout.write(`${r.checked} role specs checked, ${r.drift.length} drifted\n`);
      } else {
        for (const w of r.written) process.stdout.write(`wrote ${w}\n`);
        process.stdout.write(`${r.checked} role specs checked, ${r.written.length} written\n`);
      }
    }
    return r.ok ? 0 : 1;
  }
  if (has("--table")) {
    const t = table({});
    if (json) {
      process.stdout.write(JSON.stringify(t, null, 2) + "\n");
      return 0;
    }
    const w = 24;
    const cw = 32;
    process.stdout.write(`preset in use: ${t.preset}\n`);
    process.stdout.write(`${"ROLE".padEnd(w)}CHAIN (in order)\n`);
    for (const r of t.rows) process.stdout.write(`${r.role.padEnd(w)}${r.chain.map(fmt).join("  >  ")}\n`);
    process.stdout.write(`\n${"ROLE".padEnd(w)}${COMBOS.map((c) => c.name.padEnd(cw)).join("")}IN-PROCESS SPAWN [alias]\n`);
    for (const r of t.rows) {
      const cells = COMBOS.map((c) => fmt(r.cli[c.name]).padEnd(cw)).join("");
      process.stdout.write(`${r.role.padEnd(w)}${cells}${fmt(r.inProcess)} [${r.inProcess.alias || "no alias: frontmatter"}]\n`);
    }
    return 0;
  }
  const role = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--channel");
  if (!role) {
    process.stderr.write("usage: model-resolve.js <role> [--channel in-process|cli] [--json] | --table [--json] | --sync-specs [--check]\n");
    return 2;
  }
  const channel = val("--channel") || "in-process";
  const r = resolveRole(role, { channel });
  if (json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else {
    process.stdout.write(`${r.role} (${r.channel}) -> ${fmt(r)}${r.alias ? ` [alias ${r.alias}]` : ""}  entry ${r.index} of ${r.chain.length}, ${r.source}, sign-in ${r.signin_state}${r.diversity ? `, ${r.diversity}` : ""}\n`);
    for (const s of r.skipped) process.stdout.write(`  skipped ${s.index} ${s.provider}:${s.model} — ${s.reason}: ${s.detail}\n`);
    if (r.note) process.stdout.write(`  note: ${r.note}\n`);
  }
  return r.model ? 0 : 1;
}

module.exports = {
  _toolPresent: toolPresent,
  resolveRole,
  chainFor,
  chainInfo,
  effectiveChains,
  agentAlias,
  readSigninState,
  signinRecordProblem,
  signinCachePath,
  inProcessFromPreset,
  specDefault,
  planSpecSync,
  syncSpecs,
  table,
  rootOpts,
  COMBOS,
  comboSignin,
  AGY_MAX_PROMPT_CHARS,
  AGENT_TOOL_ALIASES,
  FAIL_SAFE,
  SIGNIN_SCHEMA,
  SIGNIN_WRITER,
  SIGNIN_FALLBACK_FILE,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
