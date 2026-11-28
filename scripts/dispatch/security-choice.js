#!/usr/bin/env node
"use strict";

const path = require("path");

const KNOWN_PROVIDERS = Object.freeze(["claude", "openai", "antigravity"]);
const PASS_KEYS = Object.freeze(["second_pass", "third_pass"]);
const OPT_IN_KEY = "securityClaudeOnlyFallback";
const CLAUDE_ONLY = "claude-only";
const MULTI_LAB = "multi-lab";
const SINGLE_LAB = "single-lab";
const CLAUDE_ONLY_LINE = "reviewed by Claude only — no second lab";

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function projectRoot(opts) {
  return path.resolve((opts && opts.projectRoot) || process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", ".."));
}

function manifestPathOf(opts) {
  return (opts && opts.manifestPath) || path.join(projectRoot(opts), ".claude", "manifest.json");
}

function loadProjectLayer(opts) {
  const o = opts || {};
  if (o.manifestSnapshot) {
    const s = o.manifestSnapshot;
    return { data: s.data || null, error: s.error || null };
  }
  const ep = require("./effective-pin");
  const snap = ep.readManifestSnapshot({ manifestPath: manifestPathOf(o) });
  if (snap.error) return { data: null, error: snap.error };
  if (snap.data !== null && !isPlainObject(snap.data)) return { data: null, error: "the project manifest is not a JSON object" };
  return { data: snap.data, error: null };
}

function tupleProblem(t) {
  if (!isPlainObject(t)) return "it is not an object with a provider and a model";
  if (typeof t.provider !== "string" || !KNOWN_PROVIDERS.includes(t.provider)) {
    return `provider "${typeof t.provider === "string" ? t.provider : "?"}" is not one of ${KNOWN_PROVIDERS.join(", ")}`;
  }
  if (typeof t.model !== "string" || !t.model.trim()) return "it names no model";
  if (t.effort !== undefined && t.effort !== null && typeof t.effort !== "string") return "the effort is not text";
  let err;
  try {
    err = require("./catalog").validateTuple(t.provider, t.model, t.effort || undefined);
  } catch (e) {
    return `the model list could not be read (${(e && e.message) || "error"})`;
  }
  return err || null;
}

function blockAll(passes, reason) {
  for (const p of passes) {
    p.blocked = reason;
    p.warning = `${p.key} for the review is blocked — ${reason}`;
  }
}

function applyProjectChoices(role, base, opts) {
  const o = opts || {};
  const out = base.map((p) => ({ ...p }));
  if (!out.length || typeof role !== "string" || BAD_KEYS.has(role)) return out;
  const warn = (pass, text) => {
    pass.warning = `${pass.key} choice for ${role} ignored — ${text}; using the product default`;
  };

  const layer = loadProjectLayer(o);
  if (layer.error) {
    blockAll(out, `the project settings could not be read (${layer.error})`);
    return out;
  }
  const manifest = layer.data;
  if (!manifest) return out;

  let pin = null;
  try {
    const ep = require("./effective-pin");
    const p = ep.effectivePin(role, {
      manifestSnapshot: Object.freeze({ file: manifestPathOf(o), data: manifest, error: null }),
      manifestPath: manifestPathOf(o),
      registryPath: o.registryPath,
      projectRoot: projectRoot(o),
    });
    if (p && p.source === "project") pin = p;
  } catch (e) {
    warn(out[0], `the saved pin could not be read (${(e && e.message) || "error"})`);
  }
  if (pin) {
    const tuple = { provider: pin.provider, model: pin.model, effort: pin.effort };
    const why = tupleProblem(tuple);
    if (why) warn(out[0], why);
    else {
      out[0].provider = tuple.provider;
      out[0].model = tuple.model;
      out[0].effort = tuple.effort || null;
      out[0].source = "project";
    }
  }

  const rp = has(manifest, "reviewPasses") ? manifest.reviewPasses : undefined;
  if (rp !== undefined) {
    if (!isPlainObject(rp)) {
      for (const p of out.slice(1)) warn(p, "reviewPasses in the project settings is not an object");
    } else if (has(rp, role)) {
      const entry = rp[role];
      for (const pass of out.slice(1)) {
        if (!PASS_KEYS.includes(pass.key)) continue;
        if (!isPlainObject(entry)) {
          warn(pass, `reviewPasses.${role} is not an object`);
          continue;
        }
        if (!has(entry, pass.key)) continue;
        const choice = entry[pass.key];
        const why = tupleProblem(choice);
        if (why) {
          warn(pass, why);
          continue;
        }
        pass.provider = choice.provider;
        pass.model = choice.model;
        pass.effort = choice.effort || null;
        pass.source = "project";
        if (pass.route && choice.provider !== "claude") delete pass.route;
      }
    }
  }
  return out;
}

function deriveDiversity(stamps) {
  const fams = new Set((Array.isArray(stamps) ? stamps : []).filter((s) => typeof s === "string" && s.trim()));
  if (fams.size >= 2) return MULTI_LAB;
  if (fams.size === 1) return fams.has("claude") ? CLAUDE_ONLY : SINGLE_LAB;
  return "none";
}

function checkDiversityClaim(claim, stamps) {
  const derived = deriveDiversity(stamps);
  if (claim === undefined) return { ok: true, derived, claim: null, reason: null };
  if (claim === derived) return { ok: true, derived, claim, reason: null };
  return {
    ok: false,
    derived,
    claim,
    reason: `claims diversity ${JSON.stringify(claim)} but its provider stamps show "${derived}" — claim refused`,
  };
}

function claudeOnlyOptIn(opts) {
  try {
    const layer = loadProjectLayer(opts);
    const m = layer.data;
    if (!m || !isPlainObject(m.mc)) return false;
    return has(m.mc, OPT_IN_KEY) && m.mc[OPT_IN_KEY] === true;
  } catch (_) {
    return false;
  }
}

function nonClaudeProviders() {
  let ids = null;
  try {
    ids = require("./catalog").PROVIDER_LIST.map((p) => (p && p.id) || p).filter((s) => typeof s === "string");
  } catch (_) {
    ids = null;
  }
  const all = ids && ids.length ? [...new Set([...ids, ...KNOWN_PROVIDERS])] : KNOWN_PROVIDERS;
  return all.filter((p) => p !== "claude");
}

function evaluateClaudeOnly(lanes, ctx) {
  const no = (reason) => ({ accept: false, reason, verdict: null });
  if (!ctx || ctx.optIn !== true) return no("the Claude-only fallback is not switched on for this project");
  const fired = Array.isArray(lanes) ? lanes : [];
  if (!fired.some((l) => l && typeof l.provider === "string" && l.provider !== "claude")) {
    return no("no other lab's review was started, so there is no other lab to be missing");
  }
  for (const l of fired) {
    if (!l || typeof l.provider !== "string") return no("a lane names no provider — the review holds");
    if (l.ok === true) return no(`the ${l.provider} lane finished, so this is not a Claude-only review`);
    if (String(l.verdict || "").toLowerCase() === "fail") return no(`the ${l.provider} lane reported fail — the review holds`);
  }
  const signedIn = isPlainObject(ctx.signedIn) ? ctx.signedIn : {};
  for (const p of nonClaudeProviders()) {
    if (!has(signedIn, p) || signedIn[p] !== false) {
      return no(`${p} is not known to be signed out — the review holds`);
    }
  }
  const hunter = isPlainObject(ctx.hunter) ? ctx.hunter : {};
  if (hunter.otherLabReview) return no("another lab reviewed this run; a Claude-only result cannot replace it");
  if (hunter.verdict === "fail") return no("the Claude review failed");
  if ((hunter.verdict !== "pass" && hunter.verdict !== "warn") || !isPlainObject(hunter.record)) {
    return no("no verified Claude review of this packet exists");
  }
  return { accept: true, reason: null, verdict: hunter.verdict };
}

async function checkSignedIn(opts) {
  const unknown = { claude: null, openai: null, antigravity: null };
  try {
    const detect = opts && typeof opts.detect === "function" ? opts.detect : require("./signin").detect;
    const base = opts && opts.detectOpts ? opts.detectOpts : {};
    const resolve = typeof base.resolveTool === "function" ? base.resolveTool : (id) => require("./safe-spawn").resolveTool(id);
    const doubtful = new Set();
    const resolveTool = (id) => {
      let t;
      try {
        t = resolve(id);
      } catch (e) {
        doubtful.add(id);
        throw e;
      }
      if (!t || (t.ok !== true && !/^tool '[^']+' not found on PATH$/.test(String(t && t.reason)))) doubtful.add(id);
      return t;
    };
    const rec = await detect({ ...base, resolveTool });
    const p = rec && rec.providers;
    if (!isPlainObject(p)) return unknown;
    const out = {};
    for (const k of KNOWN_PROVIDERS) out[k] = isPlainObject(p[k]) && typeof p[k].signedIn === "boolean" ? p[k].signedIn : null;
    const TOOL_PROVIDER = { claude: "claude", codex: "openai", agy: "antigravity" };
    for (const id of doubtful) if (TOOL_PROVIDER[id]) out[TOOL_PROVIDER[id]] = null;
    return out;
  } catch (_) {
    return unknown;
  }
}

module.exports = {
  KNOWN_PROVIDERS,
  PASS_KEYS,
  OPT_IN_KEY,
  CLAUDE_ONLY,
  MULTI_LAB,
  SINGLE_LAB,
  CLAUDE_ONLY_LINE,
  loadProjectLayer,
  tupleProblem,
  applyProjectChoices,
  deriveDiversity,
  checkDiversityClaim,
  claudeOnlyOptIn,
  evaluateClaudeOnly,
  checkSignedIn,
};
