#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const ID_RE = /^[a-z0-9-]+$/;
const KINDS = ["full", "overlay"];
const DEFAULT_PRESET_ID = "default";
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function derivePins(chains) {
  const pins = {};
  if (!isPlainObject(chains)) return pins;
  for (const role of Object.keys(chains)) {
    const c = chains[role];
    if (Array.isArray(c) && c.length && isPlainObject(c[0])) {
      pins[role] = { provider: c[0].provider, model: c[0].model, effort: c[0].effort === undefined ? null : c[0].effort };
    }
  }
  return pins;
}

const isFableModel = (model) => typeof model === "string" && model.startsWith("claude-fable-");

function validateChains(preset, registryRoles) {
  const findings = [];
  const add = (code, role, msg) => findings.push({ code, unitClass: "chains", role, msg });
  const p = preset || {};
  if (!KINDS.includes(p.kind)) add("kind-invalid", "-", `kind is ${JSON.stringify(p.kind)}; allowed: ${KINDS.join(", ")}`);
  if (!isPlainObject(p.chains)) {
    add("chains-missing", "-", "the preset has no chains object");
    return findings;
  }
  const { validateTuple } = require("./catalog");
  for (const role of Object.keys(p.chains)) {
    const c = p.chains[role];
    if (!Array.isArray(c) || c.length === 0) {
      add("chain-empty", role, `${role}: the chain must be a non-empty list`);
      continue;
    }
    c.forEach((e, i) => {
      if (!isPlainObject(e) || typeof e.provider !== "string" || typeof e.model !== "string") {
        add("entry-invalid", role, `${role}[${i}]: each entry needs a provider and a model`);
        return;
      }
      const err = validateTuple(e.provider, e.model, e.effort || null);
      if (err) add("entry-invalid", role, `${role}[${i}]: ${err}`);
    });
    const last = c[c.length - 1];
    if (isPlainObject(last) && last.provider !== "claude") {
      add("chain-tail-not-claude", role, `${role}: the last entry must be a Claude model (it is ${last.provider}/${last.model})`);
    } else if (isPlainObject(last) && isFableModel(last.model)) {
      add("chain-tail-fable", role, `${role}: the last entry must not be a Fable model (${last.model}); end on Opus or a lower Claude tier`);
    }
  }
  if (Array.isArray(registryRoles)) {
    const known = new Set(registryRoles);
    for (const role of Object.keys(p.chains)) {
      if (!known.has(role)) add("role-unknown", role, `${role}: not a role in the role registry`);
    }
    if (p.kind === "full") {
      const missing = registryRoles.filter((r) => !hasOwn(p.chains, r));
      if (missing.length) add("roles-missing", "-", `a full preset must list every registry role; missing: ${missing.join(", ")}`);
    }
  }
  return findings;
}

function registryRoleIds(o) {
  const reg = readRegistry(o);
  const roles = isPlainObject(reg.roles) ? reg.roles : {};
  return Object.keys(roles).filter((r) => !r.startsWith("_") && isPlainObject(roles[r]));
}

function withRoot(opts) {
  const o = { ...(opts || {}) };
  const need = ["registryPath", "manifestPath", "projectRoot", "logPath", "presetsDir"].filter(
    (k) => o[k] === undefined,
  );
  if (need.length) {
    const ro = require("./save").rootOpts();
    for (const k of need) o[k] = ro[k];
  }
  return o;
}

function effective() {
  return require("./effective-pin");
}

function presetsDir(opts) {
  return withRoot(opts).presetsDir;
}

function logPathOf(opts) {
  const p = withRoot(opts).logPath;
  if (!p) {
    throw new Error("presets: no log path — pass opts.logPath or set the modelPresetLog path key");
  }
  return p;
}

function availableIds(opts) {
  const dir = presetsDir(opts);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((id) => ID_RE.test(id))
    .sort();
}

const idList = (opts) => {
  const ids = availableIds(opts);
  return ids.length ? ids.join(", ") : "(none)";
};

function listPresets(opts) {
  return availableIds(opts).map((id) => {
    try {
      const p = loadPreset(id, opts);
      return { id, kind: p.kind, aliases: p.aliases || [], title: p.title, dated: p.dated, reason: p.reason, roles: Object.keys(p.chains || {}).length };
    } catch (e) {
      return { id, error: e.message };
    }
  });
}

function resolvePresetId(id, opts) {
  const dir = presetsDir(opts);
  if (fs.existsSync(path.join(dir, `${id}.json`))) return id;
  for (const other of availableIds(opts)) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, `${other}.json`), "utf8").replace(/^﻿/, ""));
      if (p && Array.isArray(p.aliases) && p.aliases.includes(id)) return other;
    } catch (_) {
    }
  }
  return id;
}

function activePresetId(opts) {
  const o = withRoot(opts);
  let m = null;
  const snap = o.manifestSnapshot;
  if (snap) {
    if (snap.error) throw new Error(`presets: cannot read the project manifest for modelPreset (${o.manifestPath}): ${snap.error}`);
    m = snap.data;
  } else {
    try {
      if (fs.existsSync(o.manifestPath)) m = JSON.parse(fs.readFileSync(o.manifestPath, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      throw new Error(`presets: cannot read the project manifest for modelPreset (${o.manifestPath}): ${e.message}`);
    }
  }
  if (!m || !hasOwn(m, "modelPreset") || m.modelPreset === null || m.modelPreset === "") return DEFAULT_PRESET_ID;
  if (typeof m.modelPreset !== "string" || !ID_RE.test(m.modelPreset)) {
    throw new Error(`presets: manifest modelPreset ${JSON.stringify(m.modelPreset)} is not a preset id`);
  }
  return m.modelPreset;
}

const CODE_REVIEWERS = ["backend-reviewer", "frontend-reviewer", "qa-reviewer"];
const COVERAGE_ENUM = {
  code: ["same-family", "cross-family"],
  security: ["cross-family"],
  visual: ["exempt-capability"],
};

const familyOf = (provider) => require("./coverage-gate").familyOf(provider);

function readRegistry(o) {
  return JSON.parse(fs.readFileSync(o.registryPath, "utf8").replace(/^﻿/, ""));
}

function buildRoles(reg) {
  return Object.keys(reg.roles || {}).filter((r) => reg.roles[r] && reg.roles[r].build_chain === true);
}

function validatePresetCoverage(preset, opts) {
  const o = withRoot(opts);
  const findings = [];
  const cov = preset && preset.coverage;
  const covObj = cov && typeof cov === "object" && !Array.isArray(cov) ? cov : {};
  const declared = {};
  for (const unitClass of Object.keys(COVERAGE_ENUM)) {
    if (!Object.prototype.hasOwnProperty.call(covObj, unitClass)) {
      findings.push({ code: "coverage-missing", unitClass, msg: `preset declares no coverage for ${unitClass} units` });
    } else if (!COVERAGE_ENUM[unitClass].includes(covObj[unitClass])) {
      findings.push({
        code: "coverage-invalid",
        unitClass,
        msg: `coverage.${unitClass} is "${covObj[unitClass]}"; allowed: ${COVERAGE_ENUM[unitClass].join(", ")}`,
      });
    } else {
      declared[unitClass] = covObj[unitClass];
    }
  }
  if (declared.code !== "cross-family" && declared.security !== "cross-family") return findings;

  const reg = readRegistry(o);
  const pins = (preset && (preset.pins || derivePins(preset.chains))) || {};
  const map = effective().effectivePinMap({ ...o, overlay: pins });
  const builders = buildRoles(reg);
  const buildPinned = builders.filter((r) => map[r]);
  const unknownBuild = buildPinned.filter((r) => familyOf(map[r].provider) === null);
  const buildFamilies = new Set(buildPinned.map((r) => familyOf(map[r].provider)).filter((f) => f !== null));
  const list = (a) => [...a].sort().join(", ");
  const crosses = (provider) => {
    const f = familyOf(provider);
    return f !== null && unknownBuild.length === 0 && !buildFamilies.has(f);
  };

  if (declared.code === "cross-family") {
    const clash = CODE_REVIEWERS.filter((r) => map[r] && !crosses(map[r].provider));
    if (clash.length) {
      findings.push({
        code: "coverage-unmet",
        unitClass: "code",
        msg: `code is declared cross-family but ${list(clash)} do not demonstrably cross the build roles' model family (${list(buildFamilies) || "none"}${unknownBuild.length ? `; unknown-family build roles: ${list(unknownBuild)}` : ""})`,
      });
    }
  }
  if (declared.security === "cross-family") {
    const sec = reg.roles["security-reviewer"] || {};
    const primary = map["security-reviewer"];
    const bad = [];
    if (!primary) bad.push("security-reviewer has no pin");
    else if (!crosses(primary.provider)) bad.push(`primary reviewer family ${familyOf(primary.provider) || "unknown"}`);
    if (!sec.second_pass || !sec.second_pass.provider) bad.push("no second pass in the registry");
    else if (!crosses(sec.second_pass.provider)) bad.push(`second pass family ${familyOf(sec.second_pass.provider) || "unknown"}`);
    if (bad.length) {
      findings.push({
        code: "coverage-unmet",
        unitClass: "security",
        msg: `security is declared cross-family but ${bad.join("; ")} does not cross the build roles (${list(buildFamilies) || "none"}${unknownBuild.length ? `; unknown-family build roles: ${list(unknownBuild)}` : ""})`,
      });
    }
  }
  return findings;
}

const fmtFindings = (list) => list.map((f) => `${f.code} [${f.unitClass}]: ${f.msg}`).join("; ");

function registryHasBuildChain(o) {
  let reg;
  try {
    reg = readRegistry(o);
  } catch (e) {
    throw new Error(`presets: cannot read the registry to check review coverage (${o.registryPath}): ${e.code || e.message}`);
  }
  return buildRoles(reg).length > 0;
}

const nonEmptyStr = (s) => typeof s === "string" && s.trim() !== "";

function loadPreset(requestedId, opts) {
  if (typeof requestedId !== "string" || !ID_RE.test(requestedId)) {
    throw new Error(
      `presets: invalid preset id "${requestedId}" (lowercase letters, digits, dashes only). Available: ${idList(opts)}`,
    );
  }
  const id = resolvePresetId(requestedId, opts);
  const file = path.join(presetsDir(opts), `${id}.json`);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(
      `presets: cannot read preset "${id}" at ${file}: ${e.code || e.message}. Available: ${idList(opts)}`,
    );
  }
  let p;
  try {
    p = JSON.parse(text.replace(/^﻿/, ""));
  } catch (_) {
    throw new Error(`presets: preset "${id}" is not valid JSON (${file})`);
  }
  if (!isPlainObject(p) || !isPlainObject(p.chains)) {
    const old = isPlainObject(p) && isPlainObject(p.pins);
    throw new Error(
      `presets: preset "${id}" has no chains object (${file})` +
        (old ? " — it uses the old pins-only format; list each role's models as an ordered chain instead" : ""),
    );
  }
  if (!nonEmptyStr(p.reason)) {
    throw new Error(`presets: preset "${id}" has an empty reason (${file})`);
  }
  if (!Array.isArray(p.evidence) || p.evidence.length === 0 || !p.evidence.every(nonEmptyStr)) {
    throw new Error(`presets: preset "${id}" needs a non-empty evidence list of non-empty strings (${file})`);
  }
  if (p.kind === undefined) p.kind = "overlay";
  p.pins = derivePins(p.chains);
  const o = withRoot(opts);
  if (!(opts && opts.allowInvalid)) {
    let roles = null;
    try {
      roles = registryRoleIds(o);
    } catch (e) {
      throw new Error(`presets: cannot read the registry to check preset "${id}" (${o.registryPath}): ${e.code || e.message}`);
    }
    const found = validateChains(p, roles);
    if (registryHasBuildChain(o)) found.push(...validatePresetCoverage(p, o));
    if (found.length) {
      throw new Error(`presets: preset "${id}" is refused — ${fmtFindings(found)}`);
    }
  }
  return p;
}

function readLogDetailed(opts) {
  const file = logPathOf(opts);
  if (!fs.existsSync(file)) return { rows: [], skipped: 0 };
  const rows = [];
  let skipped = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === "object" && typeof r.type === "string") rows.push(r);
      else skipped++;
    } catch (_) {
      skipped++;
    }
  }
  return { rows, skipped };
}

function readLog(opts) {
  return readLogDetailed(opts).rows;
}

function appendRow(row, opts) {
  const file = logPathOf(opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
}

function appliedPresets(opts) {
  const last = new Map();
  readLog(opts).forEach((r, i) => {
    if ((r.type === "apply" || r.type === "unapply" || r.type === "undo") && typeof r.preset === "string") {
      last.set(r.preset, { row: r, index: i });
    }
  });
  const out = [];
  for (const [id, v] of last) {
    if (v.row.type === "apply") out.push({ id, ts: v.row.ts, reason: v.row.reason, index: v.index });
  }
  return out;
}

const samePin = (a, b) =>
  !!a && !!b && (a.provider || null) === (b.provider || null) &&
  (a.model || null) === (b.model || null) && (a.effort || null) === (b.effort || null);

function overridesSince(id, rows, applyIndex) {
  return rows.filter((r, i) => i > applyIndex && r.type === "override" && r.preset === id);
}

function lastPresetWriteIndex(role, rows) {
  let at = -1;
  rows.forEach((r, i) => {
    if (r.type === "apply" && Array.isArray(r.roles_changed) && r.roles_changed.includes(role)) at = i;
    if (r.type === "partial" && Array.isArray(r.roles_written) && r.roles_written.includes(role)) at = i;
  });
  return at;
}

function manualPinnedRoles(roles, rows) {
  const out = [];
  for (const role of roles) {
    const since = lastPresetWriteIndex(role, rows);
    if (rows.some((r, i) => i > since && r.type === "manual-pin" && r.role === role)) out.push(role);
  }
  return out;
}

function currentPin(role, o) {
  try {
    return effective().effectivePin(role, o);
  } catch (_) {
    return null;
  }
}

function status(opts) {
  const o = withRoot(opts);
  const rows = readLog(o);
  return appliedPresets(o).map((a) => {
    const preset = loadPreset(a.id, o);
    const matching = [];
    const differing = [];
    for (const [role, want] of Object.entries(preset.pins)) {
      (samePin(currentPin(role, o), want) ? matching : differing).push(role);
    }
    const latest = new Map();
    for (const r of overridesSince(a.id, rows, a.index)) latest.set(r.role, r);
    const overrides = [...latest.values()].filter((r) => differing.includes(r.role));
    return {
      id: a.id,
      dated: preset.dated,
      reason: preset.reason,
      apply_reason: a.reason || preset.reason,
      applied_at: a.ts,
      matching,
      differing,
      overrides,
    };
  });
}

function markerPath(o) {
  return logPathOf(o) + ".provenance-incomplete";
}
function readProvenanceMarker(opts) {
  try {
    return JSON.parse(fs.readFileSync(markerPath(opts), "utf8"));
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    return { unreadable: true, error: e.message };
  }
}
function markProvenanceIncomplete({ role, error }, opts) {
  const f = markerPath(opts);
  const prior = readProvenanceMarker(opts);
  const roles = [...new Set([...(prior && Array.isArray(prior.roles) ? prior.roles : []), role].filter(Boolean))];
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ roles, error: error || null, ts: new Date().toISOString() }) + "\n", "utf8");
  return { marker: f, roles };
}
function clearProvenanceIncomplete(opts) {
  try {
    fs.unlinkSync(markerPath(opts));
  } catch (_) {}
}
function loggedPinFor(role, rows, o, cache) {
  let last = { none: true };
  const priorAtApply = new Map();
  for (const r of rows) {
    if (r.type === "manual-pin" && r.role === role) last = { pin: r.to };
    else if (
      (r.type === "apply" && Array.isArray(r.roles_changed) && r.roles_changed.includes(role)) ||
      (r.type === "partial" && Array.isArray(r.roles_written) && r.roles_written.includes(role))
    ) {
      if (r.type === "apply" && r.backup) priorAtApply.set(r.backup, last);
      let want = null;
      try {
        if (!cache.has(r.preset)) cache.set(r.preset, loadPreset(r.preset, { ...o, allowInvalid: true }));
        want = cache.get(r.preset).pins[role] || null;
      } catch (_) {
        want = null;
      }
      last = want ? { pin: want } : { unknown: true };
    } else if (r.type === "undo" && r.backup && priorAtApply.has(r.backup)) {
      last = priorAtApply.get(r.backup);
    }
  }
  return last;
}

function unexplainedRoles(roles, rows, o) {
  const cache = new Map();
  const bad = [];
  for (const role of roles) {
    const cur = currentPin(role, o);
    if (!cur) continue;
    const st = loggedPinFor(role, rows, o, cache);
    let expected = null;
    if (st.pin) expected = st.pin;
    else if (st.none) {
      try {
        expected = effective().registryLayer(role, o);
      } catch (_) {
        expected = null;
      }
    }
    if (!samePin(cur, expected)) bad.push(role);
  }
  return bad;
}

function provenanceGate(o, what, rolesFn) {
  const ack = !!(o.confirmProvenance || o.confirmOverrides);
  const marker = readProvenanceMarker(o);
  let rows = null;
  let uncertain = null;
  try {
    const d = readLogDetailed(o);
    rows = d.rows;
    if (d.skipped > 0) uncertain = `${d.skipped} malformed provenance log line(s)`;
  } catch (e) {
    uncertain = `the provenance log is unreadable (${e.code || e.message})`;
  }
  if (marker) uncertain = uncertain || "a manual pin was saved but its provenance was not logged";
  let unexplained = [];
  if (!uncertain) {
    try {
      unexplained = unexplainedRoles(rolesFn(rows), rows, o);
    } catch (e) {
      uncertain = `provenance could not be checked (${e.code || e.message})`;
    }
  }
  if (!uncertain && !unexplained.length) return null;
  if (ack) {
    if (marker && !o.dryRun) clearProvenanceIncomplete(o);
    return null;
  }
  if (uncertain) {
    return {
      ok: false,
      code: "provenance-incomplete",
      roles: marker && marker.roles ? marker.roles : [],
      error: `${what} refused: ${uncertain}, so the override log cannot protect manual pins. Re-run with --confirm to acknowledge.`,
    };
  }
  return {
    ok: false,
    code: "overrides-uncertain",
    roles: unexplained,
    error: `${what} refused: the current pin of ${unexplained.join(", ")} is not explained by the provenance log (a hand change whose provenance was not recorded?). Nothing was written. Re-run with --confirm-overrides to proceed anyway.`,
  };
}

function applyPreset(id, opts) {
  const o = withRoot(opts);
  const preset = loadPreset(id, o);
  const gate = provenanceGate(o, "apply", () => []);
  if (gate) return gate;
  const rows = readLog(o);
  const lastApply = appliedPresets(o).find((a) => a.id === id);
  const lastApplyIndex = lastApply ? lastApply.index : -1;

  const todo = [];
  for (const [role, want] of Object.entries(preset.pins)) {
    if (!samePin(currentPin(role, o), want)) todo.push(role);
  }
  const overridden = new Set(overridesSince(id, rows, lastApplyIndex).map((r) => r.role));
  const manual = new Set(manualPinnedRoles(todo, rows));
  const clash = todo.filter((r) => overridden.has(r) || manual.has(r));
  if (clash.length && !o.confirmOverrides) {
    return { ok: false, code: "overrides-present", roles: clash };
  }
  const gate2 = provenanceGate(o, "apply", () => todo.filter((r) => !clash.includes(r)));
  if (gate2) return gate2;

  const save = o.applySave || require("./save").applySave;
  const preview = o.previewSave || (o.applySave ? null : require("./save").previewSave);
  const inputOf = (role) => {
    const want = preset.pins[role];
    return {
      role,
      provider: want.provider,
      model: want.model,
      effort: want.effort || null,
      fallback: want.fallback || (want.provider === "claude" ? null : "claude"),
    };
  };

  const previews = [];
  if (preview) {
    for (const role of todo) {
      const r = preview(inputOf(role));
      if (!r.ok) return { ok: false, code: "save-failed", role, error: r.error, roles_changed: [] };
      previews.push(r);
    }
  }
  if (o.dryRun) return { ok: true, dryRun: true, roles_changed: todo };

  let backupEntry = null;
  const files = [];
  for (const r of previews) {
    for (const w of r.writes || []) {
      if (w.before !== w.after && !files.includes(w.path)) files.push(w.path);
    }
  }
  if (files.length) {
    const make = o.createBackup || require("./backup").createBackup;
    backupEntry = make(files, { summary: `preset ${id} → ${todo.length} role${todo.length === 1 ? "" : "s"}` });
  }

  const changed = [];
  for (const role of todo) {
    let r;
    try {
      r = save(inputOf(role), { source: "preset", skipBackup: !!backupEntry });
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    if (!r.ok) {
      if (changed.length) {
        appendRow(
          {
            type: "partial",
            preset: id,
            roles_written: changed.slice(),
            failed_role: role,
            error: r.error || null,
            backup: backupEntry ? backupEntry.id : null,
            ts: new Date().toISOString(),
          },
          o,
        );
      }
      return {
        ok: false,
        code: "save-failed",
        role,
        error: r.error,
        roles_changed: changed,
        backup: backupEntry ? backupEntry.id : null,
      };
    }
    changed.push(role);
  }

  if (changed.length || !lastApply) {
    appendRow(
      {
        type: "apply",
        preset: id,
        roles_changed: changed,
        by: "operator",
        reason: o.reason || preset.reason,
        backup: backupEntry ? backupEntry.id : null,
        ts: new Date().toISOString(),
      },
      o,
    );
  }
  return { ok: true, roles_changed: changed, backup: backupEntry ? backupEntry.id : null };
}

function unapplyPreset(id, opts) {
  const o = withRoot(opts);
  if (!appliedPresets(o).some((a) => a.id === id)) {
    const now = appliedPresets(o).map((a) => a.id);
    return { ok: false, code: "not-applied", error: `preset "${id}" is not applied. Applied: ${now.length ? now.join(", ") : "(none)"}` };
  }
  appendRow({ type: "unapply", preset: id, by: "operator", ts: new Date().toISOString() }, o);
  return { ok: true, note: "log row only; pins are unchanged" };
}

function undoPreset(opts) {
  const o = withRoot(opts);
  const gate = provenanceGate(o, "undo", () => []);
  if (gate) return gate;
  const rows = readLog(o);
  let target = null;
  rows.forEach((r, i) => {
    if (r.type === "apply" && r.backup) target = { row: r, index: i };
  });
  if (!target) return { ok: false, code: "nothing-to-undo", error: "no applied preset with a backup in the log" };
  if (rows.some((r, i) => i > target.index && r.type === "undo" && r.backup === target.row.backup)) {
    return { ok: false, code: "nothing-to-undo", error: `backup ${target.row.backup} was already restored` };
  }
  const clobbered = [...new Set(rows.filter((r, i) => i > target.index && (r.type === "manual-pin" || r.type === "override") && typeof r.role === "string").map((r) => r.role))];
  if (clobbered.length && !o.confirmOverrides) {
    return { ok: false, code: "overrides-present", clobbered_overrides: clobbered, roles: clobbered };
  }
  const gate2 = provenanceGate(o, "undo", () => {
    const reg = readRegistry(o);
    return Object.keys(reg.roles || {}).filter((r) => !r.startsWith("_") && !clobbered.includes(r));
  });
  if (gate2) return gate2;
  const backup = require("./backup");
  const list = o.listBackups || backup.listBackups;
  const entry = list().find((b) => b.id === target.row.backup);
  if (!entry) {
    return { ok: false, code: "backup-missing", error: `backup ${target.row.backup} is no longer in the backup ring` };
  }
  const root = (o.projectRoot) || process.cwd();
  const make = o.createBackup || backup.createBackup;
  const snap = make(entry.changedFiles.map((rel) => path.join(root, rel)), {
    summary: `pre-revert snapshot before restoring ${entry.id}`,
  });
  const restored = (o.restoreBackup || backup.restoreBackup)(entry.id).restored;
  appendRow({ type: "undo", preset: target.row.preset, backup: entry.id, by: "operator", ts: new Date().toISOString() }, o);
  return { ok: true, restored, snapshot: snap && snap.id, preset: target.row.preset, clobbered_overrides: clobbered };
}

function recordOverride({ role, from, to, reason }, opts) {
  const o = withRoot(opts);
  const written = [];
  for (const a of appliedPresets(o)) {
    const preset = loadPreset(a.id, o);
    const want = preset.pins[role];
    if (!want || samePin(want, to)) continue;
    const row = {
      type: "override",
      preset: a.id,
      role,
      from: from || null,
      to: to || null,
      by: "operator",
      reason: reason || null,
      ts: new Date().toISOString(),
    };
    appendRow(row, o);
    written.push(row);
  }
  return written;
}

function recordManualPin({ role, from, to, reason }, opts) {
  const row = {
    type: "manual-pin",
    role,
    from: from || null,
    to: to || null,
    by: "operator",
    reason: reason || null,
    ts: new Date().toISOString(),
  };
  appendRow(row, withRoot(opts));
  return row;
}

const SNAPSHOT_CLAUDE_TAIL = "claude-opus-5-5";
function snapshot(id, dated, opts) {
  if (!ID_RE.test(id || "")) throw new Error(`presets: invalid preset id "${id}"`);
  const chains = {};
  const map = effective().effectivePinMap(withRoot(opts));
  for (const role of Object.keys(map).sort()) {
    const p = map[role];
    const head = { provider: p.provider, model: p.model, effort: p.effort };
    chains[role] = p.provider === "claude" && !isFableModel(p.model)
      ? [head]
      : [head, { provider: "claude", model: SNAPSHOT_CLAUDE_TAIL, effort: p.effort || "high" }];
  }
  return {
    id,
    kind: "full",
    title: id,
    dated,
    reason: "",
    evidence: [],
    coverage: { code: "same-family", security: "cross-family", visual: "exempt-capability" },
    chains,
  };
}

function usePreset(requestedId, opts) {
  const o = withRoot(opts);
  const p = loadPreset(requestedId, o);
  const id = p.id && ID_RE.test(p.id) ? p.id : resolvePresetId(requestedId, o);
  const mr = require("./model-resolve");
  const ro = { ...o, presetId: id };
  mr.effectiveChains(ro);
  const plan = mr.planSpecSync(ro);
  const keptByPin = [];
  for (const role of registryRoleIds(o)) {
    try {
      const c = mr.chainInfo(role, ro);
      if (c && c.userPin) keptByPin.push({ role, pin: pinText(c.userPin), preset_first: pinText(c.view.chains[role] && c.view.chains[role][0]) });
    } catch (_) {
    }
  }
  const before = fs.readFileSync(o.manifestPath, "utf8");
  const data = JSON.parse(before.replace(/^﻿/, ""));
  const indent = (before.match(/^(\s+)"/m) || [null, "  "])[1];
  const eol = before.includes("\r\n") ? "\r\n" : "\n";
  data.modelPreset = id;
  let after = JSON.stringify(data, null, indent);
  if (eol === "\r\n") after = after.replace(/\n/g, "\r\n");
  if (!after.endsWith(eol)) after += eol;
  const writes = [{ path: o.manifestPath, before, after }, ...plan.filter((w) => w.before !== w.after)];
  const changed = writes.filter((w) => w.before !== w.after);
  if (o.dryRun) return { ok: true, dryRun: true, preset: id, files: changed.map((w) => w.path), kept_by_your_pin: keptByPin };
  let backupEntry = null;
  if (changed.length) {
    const make = o.createBackup || require("./backup").createBackup;
    backupEntry = make(changed.map((w) => w.path), { summary: `preset ${id} in use` });
  }
  for (const w of changed) fs.writeFileSync(w.path, w.after, "utf8");
  return {
    ok: true,
    preset: id,
    manifest_changed: before !== after,
    specs_changed: changed.filter((w) => w.path !== o.manifestPath).map((w) => w.role || w.path),
    backup: backupEntry ? backupEntry.id : null,
    kept_by_your_pin: keptByPin,
  };
}

function firstSentence(s) {
  const m = /^.*?[.!?](\s|$)/.exec(String(s || ""));
  return (m ? m[0] : String(s || "")).trim();
}

const pinText = (p) => (p ? `${p.provider}/${p.model}${p.effort ? "/" + p.effort : ""}` : "?");

function footerLines(opts) {
  const o = withRoot(opts);
  const st = status(o);
  const lines = [];
  if (!st.length) {
    const std = (() => {
      try {
        return loadPreset("standard", o);
      } catch (_) {
        return null;
      }
    })();
    if (!std) return ["no preset applied"];
    const roles = Object.keys(std.pins);
    const same = roles.filter((r) => samePin(currentPin(r, o), std.pins[r])).length;
    return [`no preset applied — pins match standard for ${same} of ${roles.length} roles`];
  }
  for (const s of st) {
    const total = s.matching.length + s.differing.length;
    lines.push(
      `preset ${s.id} (${s.dated}): ${firstSentence(s.apply_reason)} — ${s.matching.length} of ${total} roles match now`,
    );
    for (const r of s.overrides) {
      lines.push(`  override ${r.role}: ${pinText(r.from)} → ${pinText(r.to)} (${r.ts})`);
    }
  }
  return lines;
}

const USAGE =
  "usage: presets.js <list|show <id>|active|use <id> [--dry-run]|status|snapshot <id> --dated <d> [--write]|apply <id> [--reason <t>] [--confirm-overrides] [--dry-run]|validate [<id>]|unapply <id>|undo [--confirm-overrides]>";

const HELD_CMDS = new Set(["apply", "undo", "unapply"]);
const HELD_MSG =
  "presets: held this release — preset apply/undo ship in a later release, with the immutable-log provenance fix.";

function main(argv) {
  const [cmd, ...rest] = argv;
  if (HELD_CMDS.has(cmd)) {
    console.error(HELD_MSG);
    process.exitCode = 1;
    return;
  }
  const flag = (n) => {
    const i = rest.indexOf(n);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const has = (n) => rest.includes(n);
  const out = (x) => console.log(typeof x === "string" ? x : JSON.stringify(x, null, 2));
  const idArg = () => {
    const v = rest[0];
    if (!v || v.startsWith("-")) {
      throw new Error(`presets: ${cmd} needs a preset id first. ${USAGE}\navailable presets: ${idList()}`);
    }
    return v;
  };
  switch (cmd) {
    case "list":
      return out(listPresets());
    case "show":
    {
      const preset = loadPreset(idArg(), { allowInvalid: true });
      const findings = validatePresetCoverage(preset);
      return out(findings.length ? { ...preset, coverage_findings: findings } : preset);
    }
    case "active":
      return out(activePresetId());
    case "use": {
      const r = usePreset(idArg(), { dryRun: has("--dry-run") });
      return out(r);
    }
    case "validate": {
      const ids = rest[0] && !rest[0].startsWith("-") ? [rest[0]] : availableIds();
      let bad = 0;
      for (const id of ids) {
        let found;
        try {
          const p = loadPreset(id, { allowInvalid: true });
          found = [...validateChains(p, registryRoleIds(withRoot())), ...validatePresetCoverage(p)];
        } catch (e) {
          found = [{ code: "load-failed", unitClass: "-", msg: e.message }];
        }
        if (found.length) {
          bad++;
          console.error(`${id}: RED — ${fmtFindings(found)}`);
        } else {
          console.log(`${id}: GREEN`);
        }
      }
      if (bad || !ids.length) process.exitCode = 1;
      return;
    }
    case "status":
      return out(status());
    case "snapshot": {
      const dated = flag("--dated");
      if (!dated) throw new Error("presets: snapshot needs --dated <date>");
      const snap = snapshot(idArg(), dated);
      if (has("--write")) {
        const file = path.join(presetsDir(), `${snap.id}.json`);
        let prior = {};
        try {
          prior = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (_) {}
        const merged = { ...snap, ...prior, dated, pins: snap.pins };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(merged, null, 2) + "\n", "utf8");
        return out(`wrote ${file}`);
      }
      return out(snap);
    }
    case "apply": {
      const r = applyPreset(idArg(), {
        reason: flag("--reason"),
        confirmOverrides: has("--confirm-overrides"),
        confirmProvenance: has("--confirm"),
        dryRun: has("--dry-run"),
      });
      if (r.ok) return out(r);
      process.exitCode = 1;
      if (r.code === "provenance-incomplete" || r.code === "overrides-uncertain") {
        console.error(`presets: ${r.error}`);
      } else if (r.code === "overrides-present") {
        console.error(
          `presets: apply refused — these roles were changed by hand since the preset last wrote them: ${r.roles.join(", ")}.\n` +
            "Nothing was written. Re-run with --confirm-overrides to overwrite them.",
        );
      } else {
        console.error(
          `presets: apply failed at role ${r.role}: ${r.error}\n` +
            `roles written before the failure: ${(r.roles_changed || []).join(", ") || "(none)"}` +
            (r.backup ? `\nrestore with: node scripts/dispatch.js revert ${r.backup}` : ""),
        );
      }
      return;
    }
    case "unapply": {
      const r = unapplyPreset(idArg());
      if (!r.ok) {
        console.error(`presets: ${r.error}`);
        process.exitCode = 1;
        return;
      }
      return out(`unapplied ${rest[0]}: ${r.note}`);
    }
    case "undo": {
      const r = undoPreset({ confirmOverrides: has("--confirm-overrides"), confirmProvenance: has("--confirm") });
      if (!r.ok) {
        process.exitCode = 1;
        if (r.code === "overrides-present") {
          console.error(
            `presets: undo refused — restoring would discard manual pins made after the apply: ${r.clobbered_overrides.join(", ")}.
` +
              "Nothing was restored. Re-run with --confirm-overrides to restore anyway.",
          );
          return;
        }
        console.error(`presets: ${r.error}`);
        return;
      }
      return out(`restored ${r.restored.length} file(s) from the backup of preset ${r.preset}`);
    }
    default:
      console.error(USAGE);
      process.exitCode = 2;
  }
}

module.exports = {
  listPresets,
  loadPreset,
  resolvePresetId,
  activePresetId,
  usePreset,
  validateChains,
  registryRoleIds,
  DEFAULT_PRESET_ID,
  validatePresetCoverage,
  readLog,
  readLogDetailed,
  appliedPresets,
  status,
  applyPreset,
  unapplyPreset,
  undoPreset,
  recordOverride,
  recordManualPin,
  markProvenanceIncomplete,
  readProvenanceMarker,
  clearProvenanceIncomplete,
  snapshot,
  footerLines,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
