"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const KIND = "models-swap";
const CATALOG_ROWS = "scripts/dispatch/catalog-models.json";
const CATALOG_SCHEMA = "mc/catalog-models/v1";
const REGISTRY = ".claude/agents/_org/role-registry.json";
const PANEL = ".claude/agents/_org/panel-lane-manifest.json";
const PRESETS_DIR = ".claude/agents/_org/presets";

const abs = (root, rel) => path.join(root, ...rel.split("/"));
const read = (p) => fs.readFileSync(p, "utf8");
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function modelFieldRe(id) {
  return new RegExp(`("model"\\s*:\\s*")${escRe(id)}(")`, "g");
}

const SPEC_KEY = "provider_model";
function providerModelRe(id) {
  return new RegExp(`^(${SPEC_KEY}:[ \\t]*["']?)${escRe(id)}(?=["']?[ \\t]*(?:#[^\\r\\n]*)?\\r?$)`, "m");
}
function replaceSpecModel(text, oldId, newId) {
  const m = text.match(/^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/);
  if (!m) return text;
  const re = providerModelRe(oldId);
  if (!re.test(m[2])) return text;
  return m[1] + m[2].replace(re, `$1${newId}`) + m[3] + text.slice(m[0].length);
}
function specFiles(root, oldId) {
  const out = [];
  const walk = (dir) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const text = read(p);
        if (replaceSpecModel(text, oldId, "x") !== text) out.push(p);
      }
    }
  };
  walk(abs(root, ".claude/agents"));
  return out.sort();
}

function presetFiles(root) {
  const dir = abs(root, PRESETS_DIR);
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch (_) {
  }
  return names.map((n) => `${PRESETS_DIR}/${n}`);
}

function swapTargets(root) {
  const t = presetFiles(root).map((rel) => ({ rel, kind: "presets" }));
  t.push({ rel: REGISTRY, kind: "registry" }, { rel: PANEL, kind: "panel" });
  return t.filter((x) => fs.existsSync(abs(root, x.rel)));
}

function usesIn(root, rel, id) {
  const out = [];
  let data;
  try {
    data = JSON.parse(read(abs(root, rel)).replace(/^﻿/, ""));
  } catch (_) {
    return out;
  }
  const walk = (v, role) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, role));
    if (!v || typeof v !== "object") return;
    if (v.model === id) out.push({ provider: v.provider || null, effort: v.effort === undefined ? null : v.effort, role });
    for (const k of Object.keys(v)) walk(v[k], role);
  };
  if (data && data.chains) {
    for (const r of Object.keys(data.chains)) walk(data.chains[r], r);
  } else if (data && data.roles) {
    for (const r of Object.keys(data.roles)) walk(data.roles[r], r);
  } else {
    walk(data, null);
  }
  return out;
}

function readRows(root) {
  try {
    const d = JSON.parse(read(abs(root, CATALOG_ROWS)).replace(/^﻿/, ""));
    return Array.isArray(d.models) ? d.models : [];
  } catch (_) {
    return [];
  }
}

function catalogProviders(root, id) {
  const found = new Set();
  try {
    const { PROVIDERS } = require("../dispatch/catalog");
    for (const [p, def] of Object.entries(PROVIDERS)) {
      if ((def.models || []).some((m) => m.id === id || (m.aliases || []).includes(id))) found.add(p);
    }
  } catch (_) {
  }
  for (const r of readRows(root)) if (r && r.id === id && r.provider) found.add(r.provider);
  return [...found];
}

function appendRow(root, row) {
  const file = abs(root, CATALOG_ROWS);
  let raw = null;
  try {
    raw = read(file);
  } catch (_) {
  }
  let data = { schema: CATALOG_SCHEMA, models: [] };
  let indent = "  ";
  let eol = "\n";
  if (raw !== null) {
    data = JSON.parse(raw.replace(/^﻿/, ""));
    const m = raw.match(/^(\s+)"/m);
    if (m) indent = m[1];
    if (raw.includes("\r\n")) eol = "\r\n";
  }
  data.models = Array.isArray(data.models) ? data.models : [];
  data.models.push(row);
  let text = JSON.stringify(data, null, indent);
  if (eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text + eol, "utf8");
}

function run(root, args, timeoutMs) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: timeoutMs || 80000, windowsHide: true });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}
const lastLine = (s) => String(s).trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "no output";

function defaultSync(root, check) {
  const r = run(root, ["scripts/dispatch/model-resolve.js", "--sync-specs", ...(check ? ["--check"] : [])]);
  return { ok: r.code === 0, detail: lastLine(r.out) };
}

function defaultChecks(root) {
  const list = [
    ["model-resolution", ["scripts/checks/model-resolution.js"]],
    ["model-chain", ["scripts/checks/model-chain.js"]],
  ];
  return list.map(([name, args]) => {
    const r = run(root, args);
    return { name, ok: r.code === 0, detail: lastLine(r.out) };
  });
}

function defaultRegen(root) {
  const steps = ["scripts/generate-framework-manifest.js", "scripts/mc/snapshot-installed.js", "scripts/mc/manifest/build.js"];
  let ran = 0;
  for (const s of steps) {
    if (!fs.existsSync(abs(root, s))) continue;
    const r = run(root, [s], 85000);
    if (r.code !== 0) return { ok: false, ran, detail: `${s}: ${lastLine(r.out)}` };
    ran++;
  }
  return { ok: true, ran, detail: ran ? `${ran} regenerated` : "no generators" };
}

function defaultPing(root, role, lab, newId) {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "mc-swap-ping-"));
  const pf = path.join(dir, "ping.txt");
  fs.writeFileSync(pf, "Reply with the single word PONG.\n", "utf8");
  const r = run(root, ["scripts/dispatch-agent.js", role, pf], 85000);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
  }
  if (r.code !== 0) return { ok: false, detail: lastLine(r.out) };
  let answered = null;
  for (const line of String(r.out).split(/\r?\n/).reverse()) {
    try {
      const j = JSON.parse(line.trim());
      if (j && typeof j === "object") {
        answered = j.model || null;
        break;
      }
    } catch (_) {
    }
  }
  if (answered === newId) return { ok: true, detail: "ok" };
  return { ok: false, detail: answered ? `answered by ${answered}, not ${newId}` : "no model reported" };
}

function defaultListServed(provider, opts) {
  let find;
  try {
    find = require("./find");
  } catch (_) {
    return { provider, source: "none", note: "find is not installed", models: [] };
  }
  return find.listServed(provider, opts);
}

function defaultRolePlan(input) {
  const save = require("../dispatch/save");
  const prev = save.previewSave(input);
  if (!prev.ok) return { ok: false, error: prev.error, files: [] };
  return { ok: true, files: prev.changedFiles };
}
function defaultRoleSave(input) {
  return require("../dispatch/save").applySave(input, { skipBackup: true });
}

function backupApi(o) {
  return o.backup || require("../dispatch/backup");
}

function takeBackup(root, api, files, meta) {
  const created = files.filter((f) => !fs.existsSync(f)).map((f) => path.relative(root, f).split(path.sep).join("/"));
  const existing = files.filter((f) => fs.existsSync(f));
  const entry = api.createBackup(files, { ...meta, diffSummary: JSON.stringify({ created }) });
  const dir = api.BACKUP_DIR;
  if (dir) {
    for (const f of existing) {
      const rel = path.relative(root, f).split(path.sep).join("/");
      if (!fs.existsSync(path.join(dir, entry.id, ...rel.split("/")))) {
        closeBackup(api, entry.id, "failed");
        return { entry, error: `could not back up ${rel}; nothing was changed` };
      }
    }
  }
  return { entry, error: null };
}

function createdIn(entry) {
  try {
    const d = JSON.parse(entry.diffSummary);
    return Array.isArray(d.created) ? d.created : [];
  } catch (_) {
    return [];
  }
}

function closeBackup(api, id, why) {
  try {
    api.createBackup([], { summary: `${KIND}-closed: ${id}`, diffSummary: why });
  } catch (_) {
  }
}

function closedIds(api) {
  const prefix = `${KIND}-closed: `;
  const m = new Map();
  for (const b of api.listBackups()) {
    if (String(b.summary || "").startsWith(prefix) && !m.has(b.summary.slice(prefix.length))) m.set(b.summary.slice(prefix.length), b.diffSummary);
  }
  return m;
}

function restoreFrom(root, api, id) {
  const entry = api.listBackups().find((b) => b.id === id);
  if (!entry) throw new Error(`no backup named ${id}`);
  const res = api.restoreBackup(id) || {};
  let deleted = 0;
  for (const rel of createdIn(entry)) {
    if (fs.existsSync(abs(root, rel))) {
      fs.rmSync(abs(root, rel), { force: true });
      deleted++;
    }
  }
  const restored = Array.isArray(res.restored) ? res.restored.length : 0;
  return Object.assign({}, entry, { restoredCount: restored + deleted });
}

function fail(reason) {
  return { ok: false, refused: true, changed: false, lines: [reason] };
}

function swap(o) {
  const root = o.root || process.cwd();
  const oldId = o.old;
  const newId = o.new;
  const role = o.role || null;
  if (!oldId || !newId || !MODEL_ID.test(oldId) || !MODEL_ID.test(newId)) return fail("usage: swap <old> <new> [--role <r>] [--dry-run]");
  if (oldId === newId) return fail("old and new are the same model");

  const targets = swapTargets(root);
  const uses = [];
  for (const t of targets) for (const u of usesIn(root, t.rel, oldId)) uses.push({ ...u, rel: t.rel });
  if (uses.length === 0) return fail(`nothing uses ${oldId}`);
  const labs = [...new Set(uses.map((u) => u.provider).filter(Boolean))];
  if (labs.length !== 1) return fail(`${oldId} is used under ${labs.length || "no"} labs; cannot tell which one to swap within`);
  const lab = labs[0];

  const known = catalogProviders(root, newId);
  let newRow = null;
  if (known.length && !known.includes(lab)) return fail(`${newId} belongs to ${known[0]}, not ${lab}; a swap stays within one lab`);
  if (!known.length) {
    const listServed = o.listServed || defaultListServed;
    let served;
    try {
      served = listServed(lab, { root });
    } catch (e) {
      served = null;
    }
    const hit = served && Array.isArray(served.models) ? served.models.find((m) => m.id === newId) : null;
    if (!hit) return fail(`${newId} is not in the catalog and ${lab} does not serve it`);
    newRow = { provider: lab, id: newId, displayName: hit.displayName || newId };
  }

  let roleInput = null;
  if (role) {
    const mine = uses.find((u) => u.role === role);
    if (!mine) return fail(`role ${role} does not use ${oldId}`);
    roleInput = { role, provider: lab, model: newId, effort: mine.effort || undefined };
  }

  const counts = { presets: 0, registry: 0, panel: 0, specs: 0 };
  let specs = [];
  const files = [];
  let rolePlan = null;
  if (roleInput) {
    rolePlan = (o.rolePlan || defaultRolePlan)(roleInput);
    if (!rolePlan.ok) return fail(rolePlan.error || "cannot pin that role");
    for (const f of rolePlan.files) files.push(abs(root, f));
  } else {
    for (const t of targets) {
      const n = (read(abs(root, t.rel)).match(modelFieldRe(oldId)) || []).length;
      if (n) {
        counts[t.kind] += n;
        files.push(abs(root, t.rel));
      }
    }
    specs = specFiles(root, oldId);
    counts.specs = specs.length;
    files.push(...specs);
  }
  if (newRow) files.push(abs(root, CATALOG_ROWS));
  const sum = roleInput
    ? `pin ${role} to ${newId} (project layer, ${files.length} file${files.length === 1 ? "" : "s"})`
    : `${oldId} -> ${newId}: ${counts.presets} in presets, ${counts.registry} in registry, ${counts.panel} in panel lanes, ${counts.specs} in role specs`;
  if (o.dryRun) {
    const lines = [`plan: ${sum}`];
    if (newRow) lines.push(`would add ${newId} to the catalog rows`);
    lines.push(`would touch ${files.length} file${files.length === 1 ? "" : "s"}; nothing written`);
    return { ok: true, dryRun: true, changed: false, lines };
  }

  const api = backupApi(o);
  const taken = takeBackup(root, api, files, { summary: `${KIND}: ${oldId} -> ${newId}${role ? ` (${role})` : ""}` });
  if (taken.error) return fail(taken.error);
  const entry = taken.entry;
  const undoCmd = `node scripts/models/models.js undo ${entry.id}`;
  const rollback = (why) => {
    restoreFrom(root, api, entry.id);
    closeBackup(api, entry.id, "rolled-back");
    (o.syncSpecs || defaultSync)(root, false);
    return { ok: false, changed: false, undone: true, backup: entry.id, lines: [`undone: ${why}`] };
  };
  try {
    if (newRow) appendRow(root, newRow);
    if (roleInput) {
      const r = (o.roleSave || defaultRoleSave)(roleInput);
      if (!r.ok) return rollback(r.error || "pin failed");
    } else {
      for (const t of targets) {
        const f = abs(root, t.rel);
        const text = read(f);
        const next = text.replace(modelFieldRe(oldId), `$1${newId}$2`);
        if (next !== text) fs.writeFileSync(f, next, "utf8");
      }
      for (const f of specs) {
        const text = read(f);
        const next = replaceSpecModel(text, oldId, newId);
        if (next !== text) fs.writeFileSync(f, next, "utf8");
      }
    }
  } catch (e) {
    return rollback(e.message);
  }

  const sync = (o.syncSpecs || defaultSync)(root, false);
  if (!sync.ok) return rollback(`spec sync failed: ${sync.detail}`);
  const checks = [...(o.runChecks || defaultChecks)(root)];
  const syncCheck = (o.syncSpecs || defaultSync)(root, true);
  checks.push({ name: "spec-sync", ok: syncCheck.ok, detail: syncCheck.detail });
  const red = checks.find((c) => !c.ok);
  if (red) return rollback(`check ${red.name} is red (${red.detail})`);

  let regenText = "regen skipped";
  if (!o.noRegen) {
    const g = (o.regen || defaultRegen)(root);
    regenText = g.ok ? `regen ${g.detail}` : `regen FAILED (${g.detail})`;
  }
  let pingText = "ping skipped";
  if (!o.noPing) {
    const pingRole = role || (uses.find((u) => u.role) || {}).role;
    if (!pingRole) {
      pingText = `ping skipped (no role uses ${newId})`;
    } else {
      try {
        const p = (o.ping || defaultPing)(root, pingRole, lab, newId);
        pingText = `ping ${lab} ${p.ok ? "ok" : `FAILED (${p.detail})`}`;
      } catch (e) {
        pingText = `ping ${lab} FAILED (${e.message})`;
      }
    }
  }
  const lines = [
    `swapped ${sum}${newRow ? "; added to catalog" : ""}`,
    `backup ${entry.id}`,
    `checks green (${checks.map((c) => c.name).join(", ")}); ${regenText}`,
    pingText,
    `undo: ${undoCmd}`,
  ];
  return { ok: true, changed: true, backup: entry.id, lines };
}

function undo(o) {
  const root = o.root || process.cwd();
  const api = backupApi(o);
  const closed = closedIds(api);
  const all = api.listBackups().filter((b) => String(b.summary || "").startsWith(`${KIND}:`));
  let entry;
  if (o.id) {
    entry = all.find((b) => b.id === o.id);
    if (!entry) return fail(`no swap backup named ${o.id}`);
    if (closed.has(entry.id) && closed.get(entry.id) !== "undone") return fail(`swap ${entry.id} never took effect; nothing to undo`);
  } else {
    entry = all.find((b) => !closed.has(b.id));
    if (!entry) return fail("no swap in effect to undo");
  }
  const snap = takeBackup(root, api, entry.changedFiles.map((rel) => abs(root, rel)), { summary: `pre-undo snapshot before restoring ${entry.id}` });
  if (snap.error) return fail(snap.error);
  const back = restoreFrom(root, api, entry.id);
  closeBackup(api, entry.id, "undone");
  const sync = (o.syncSpecs || defaultSync)(root, false);
  const regen = o.noRegen ? null : (o.regen || defaultRegen)(root);
  return {
    ok: sync.ok,
    changed: true,
    backup: entry.id,
    snapshot: snap.entry.id,
    lines: [
      `restored ${back.restoredCount} file${back.restoredCount === 1 ? "" : "s"} from ${entry.id} (${entry.summary})`,
      `what was there before is saved as ${snap.entry.id}`,
      `spec sync ${sync.ok ? "ok" : `FAILED (${sync.detail})`}${regen ? `; regen ${regen.ok ? "ok" : "FAILED"}` : ""}`,
    ],
  };
}

module.exports = { swap, undo, KIND, CATALOG_ROWS, usesIn, modelFieldRe };
