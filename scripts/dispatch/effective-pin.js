"use strict";
const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("../hooks/lib/paths");

const KNOWN_PROVIDERS = ["claude", "openai", "antigravity"];
const DEFAULT_PROVIDER = "claude";
const BAD_ROLES = new Set(["__proto__", "constructor", "prototype"]);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`effective-pin: cannot read ${label} ${file}: ${e.code || e.message}`);
  }
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`effective-pin: malformed JSON in ${label} ${file}`);
  }
}

function loadRegistry(opts) {
  const file = (opts && opts.registryPath) || PATHS.orgRoleRegistry;
  const reg = readJson(file, "role registry");
  if (!reg || typeof reg.roles !== "object" || reg.roles === null) {
    throw new Error(`effective-pin: role registry ${file} has no roles object`);
  }
  return reg;
}

const deepFreeze = (v) => {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};

function readManifestSnapshot(opts) {
  const file = (opts && opts.manifestPath) || PATHS.manifest;
  if (!fs.existsSync(file)) return Object.freeze({ file, data: null, error: null });
  try {
    return Object.freeze({ file, data: deepFreeze(readJson(file, "manifest")), error: null });
  } catch (e) {
    return Object.freeze({ file, data: null, error: (e && e.message) || "manifest unreadable" });
  }
}

function loadManifest(opts) {
  const file = (opts && opts.manifestPath) || PATHS.manifest;
  const snap = opts && opts.manifestSnapshot;
  let m;
  if (snap) {
    if (snap.error) throw new Error(snap.error);
    if (snap.data === null) return null;
    m = snap.data;
  } else {
    if (!fs.existsSync(file)) return null;
    m = readJson(file, "manifest");
  }
  if (!isPlainObject(m)) {
    throw new Error(`effective-pin: manifest ${file} must be a JSON object`);
  }
  return m;
}

function roleEntry(reg, role) {
  if (typeof role !== "string" || BAD_ROLES.has(role)) return null;
  if (!has(reg.roles, role)) return null;
  const e = reg.roles[role];
  return e && typeof e === "object" ? e : null;
}

const orNull = (v) => (v === undefined || v === null || v === "" ? null : v);

function registryLayer(role, opts) {
  const e = roleEntry(loadRegistry(opts), role);
  if (!e) return null;
  return { provider: orNull(e.provider), model: orNull(e.model), effort: orNull(e.effort) };
}

function parseFrontmatter(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const out = Object.create(null);
  if (lines[0] === undefined || lines[0].trim() !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m || BAD_ROLES.has(m[1])) continue;
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

function readSpecFrontmatter(entry, opts) {
  if (!entry || typeof entry.spec !== "string") return {};
  const root = path.resolve((opts && opts.projectRoot) || PROJECT);
  const file = path.resolve(root, entry.spec);
  if (!file.startsWith(root + path.sep)) return {};
  try {
    const realRoot = fs.realpathSync(root);
    if (!fs.realpathSync(file).startsWith(realRoot + path.sep)) return {};
    return parseFrontmatter(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return {};
  }
}

function checkProvider(provider, where) {
  if (!KNOWN_PROVIDERS.includes(provider)) {
    throw new Error(`effective-pin: unknown provider "${provider}" in ${where}`);
  }
}

function projectFromLoaded(reg, manifest, role, opts) {
  if (!manifest) return null;
  if (!has(manifest, "agentProviders")) return null;
  const ap = manifest.agentProviders;
  if (!isPlainObject(ap)) {
    throw new Error("effective-pin: manifest agentProviders must be an object");
  }
  if (!has(ap, role)) return null;
  const entry = ap[role];
  if (isPlainObject(entry)) {
    if (typeof entry.provider !== "string" || !entry.provider) {
      throw new Error(`effective-pin: manifest agentProviders["${role}"].provider must be a non-empty string`);
    }
    checkProvider(entry.provider, "manifest agentProviders");
    for (const k of ["model", "effort"]) {
      if (entry[k] !== undefined && entry[k] !== null && typeof entry[k] !== "string") {
        throw new Error(`effective-pin: manifest agentProviders["${role}"].${k} must be a string`);
      }
    }
    return { provider: entry.provider, model: orNull(entry.model), effort: orNull(entry.effort), form: "object" };
  }
  const provider = entry;
  if (typeof provider !== "string" || !provider) {
    throw new Error(`effective-pin: manifest agentProviders["${role}"] must be a non-empty string or an object with a provider`);
  }
  checkProvider(provider, "manifest agentProviders");
  const fm = readSpecFrontmatter(roleEntry(reg, role), opts);
  const model = provider === "claude" ? fm.model : fm.provider_model;
  const effort = provider === "claude" ? fm.effort : fm.provider_reasoning_effort;
  return { provider, model: orNull(model), effort: orNull(effort) };
}

function projectLayer(role, opts) {
  if (typeof role !== "string" || BAD_ROLES.has(role)) return null;
  const reg = loadRegistry(opts);
  return projectFromLoaded(reg, loadManifest(opts), role, opts);
}

function manifestDefaultModel(manifest, provider) {
  const p = manifest && isPlainObject(manifest.providers) && has(manifest.providers, provider)
    ? manifest.providers[provider] : null;
  return p && typeof p === "object" ? orNull(p.default_model) : null;
}

function validateOverlay(ov, role) {
  if (!isPlainObject(ov) || typeof ov.provider !== "string") {
    throw new Error(`effective-pin: overlay for "${role}" must be an object with a string provider`);
  }
  checkProvider(ov.provider, "overlay");
}

function resolve(role, reg, manifest, opts) {
  const e = roleEntry(reg, role);
  if (!e) return null;
  const regL = { provider: orNull(e.provider), model: orNull(e.model), effort: orNull(e.effort) };
  const hasOv = !!(opts && isPlainObject(opts.overlay) && has(opts.overlay, role));
  const ov = hasOv ? opts.overlay[role] : null;
  if (hasOv) validateOverlay(ov, role);
  const proj = projectFromLoaded(reg, manifest, role, opts);

  if (hasOv) {
    let model = orNull(ov.model);
    let effort = orNull(ov.effort);
    if (model === null && proj && proj.provider === ov.provider) model = proj.model;
    if (model === null && regL.provider === ov.provider) model = regL.model;
    if (model === null) model = manifestDefaultModel(manifest, ov.provider);
    if (effort === null && proj && proj.provider === ov.provider) effort = proj.effort;
    if (effort === null && regL.provider === ov.provider) effort = regL.effort;
    return { role, provider: ov.provider, model, effort, source: "overlay" };
  }
  if (proj) {
    let model = proj.model;
    let effort = proj.effort;
    if (proj.provider === regL.provider) {
      if (model === null) model = regL.model;
      if (effort === null) effort = regL.effort;
    } else if (model === null) {
      model = manifestDefaultModel(manifest, proj.provider);
    }
    return { role, provider: proj.provider, model, effort, source: "project", named: proj.form === "object" && proj.model !== null };
  }
  return { role, provider: regL.provider, model: regL.model, effort: regL.effort, source: "registry" };
}

function effectivePin(role, opts) {
  if (typeof role !== "string" || BAD_ROLES.has(role)) return null;
  return resolve(role, loadRegistry(opts), loadManifest(opts), opts);
}

function effectivePinMap(opts) {
  const reg = loadRegistry(opts);
  const manifest = loadManifest(opts);
  const out = {};
  for (const role of Object.keys(reg.roles)) {
    if (role.startsWith("_") || BAD_ROLES.has(role)) continue;
    const pin = resolve(role, reg, manifest, opts);
    if (pin) out[role] = pin;
  }
  return out;
}

const NON_REGISTRY_DEFAULT_PROVIDERS = Object.freeze({
  builder: "claude",
  fixer: "claude",
  reviewer: "openai",
  compliance: "openai",
  qa: "openai",
  redteam: "openai",
});

function effectiveProviderForRole(role, opts) {
  if (typeof role !== "string" || BAD_ROLES.has(role)) return DEFAULT_PROVIDER;
  const pin = effectivePin(role, opts);
  if (pin && pin.provider) return pin.provider;
  const manifest = loadManifest(opts);
  if (manifest && has(manifest, "agentProviders") && isPlainObject(manifest.agentProviders)
      && has(manifest.agentProviders, role)) {
    const p = manifest.agentProviders[role];
    if (typeof p === "string" && p) { checkProvider(p, "manifest agentProviders"); return p; }
  }
  return has(NON_REGISTRY_DEFAULT_PROVIDERS, role) ? NON_REGISTRY_DEFAULT_PROVIDERS[role] : DEFAULT_PROVIDER;
}

module.exports = {
  effectivePin, effectivePinMap, effectiveProviderForRole, registryLayer, projectLayer, readManifestSnapshot,
  KNOWN_PROVIDERS, NON_REGISTRY_DEFAULT_PROVIDERS, DEFAULT_PROVIDER,
};
