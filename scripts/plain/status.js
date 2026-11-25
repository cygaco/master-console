#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const PLAIN_LIB = path.join(__dirname, '..', 'hooks', 'lib', 'plain');
const where = require(path.join(PLAIN_LIB, 'where.js'));
const safefs = require(path.join(PLAIN_LIB, 'safefs.js'));
const core = require(path.join(PLAIN_LIB, 'core.js'));
const guard = require(path.join(PLAIN_LIB, 'guard.js'));
const risk = require(path.join(PLAIN_LIB, 'risk.js'));
const misslog = require(path.join(PLAIN_LIB, 'misslog.js'));
const { readCatalog } = require(path.join(PLAIN_LIB, 'catalog.js'));

const SWITCH_KEY = 'mc.plain.enabled';
const MANIFEST_MAX_BYTES = 1 << 20;
const SETTINGS_MAX_BYTES = 4 << 20;
const HEAD_BYTES = 16384;
const FULL_BYTES = 262144;

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const n = (x) => Number(x).toLocaleString('en-US');

function usage(msg) {
  process.stderr.write(`${msg}\nusage: node scripts/plain/status.js [status|on|off] [--json] [--root <dir>]\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const out = { action: 'status', json: false, root: null };
  let named = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--root') { out.root = argv[++i]; if (!out.root) usage('--root needs a folder'); }
    else if (/^(status|on|off)$/i.test(a)) {
      if (named) usage(`one action only (got "${a}" after "${out.action}")`);
      out.action = a.toLowerCase();
      named = true;
    } else usage(`unknown argument "${a}"`);
  }
  return out;
}

function projectRoot(given) {
  if (given) return path.resolve(given);
  if (process.env.CLAUDE_PROJECT_DIR) return path.resolve(process.env.CLAUDE_PROJECT_DIR);
  return path.resolve(__dirname, '..', '..');
}

function setSwitch(root, want) {
  const rel = where.relFor(root, 'manifest');
  if (!rel) return { ok: false, why: 'the paths registry names no project manifest (paths.manifest)', rel: null };
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    if (want === 'on') return { ok: true, changed: false, rel };
    return { ok: false, why: `there is no project manifest at ${rel} to hold the switch (MC_PLAIN_OFF=1 in the environment also turns routing off)`, rel };
  }
  const raw = safefs.readCapped(file, MANIFEST_MAX_BYTES);
  if (raw == null) return { ok: false, why: `${rel} is too large, a link, or not a regular file`, rel };
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  let j;
  try { j = JSON.parse(body); } catch { return { ok: false, why: `${rel} is not valid JSON`, rel }; }
  if (!isObj(j)) return { ok: false, why: `${rel} is not a JSON object`, rel };
  if (j.mc !== undefined && j.mc !== null && !isObj(j.mc)) return { ok: false, why: `"mc" in ${rel} is not an object`, rel };
  const mc = isObj(j.mc) ? j.mc : null;
  if (mc && mc.plain !== undefined && mc.plain !== null && !isObj(mc.plain)) return { ok: false, why: `"mc.plain" in ${rel} is not an object`, rel };
  const plain = mc && isObj(mc.plain) ? mc.plain : null;

  if (want === 'off') {
    if (plain && plain.enabled === false) return { ok: true, changed: false, rel };
    if (!mc) j.mc = {};
    if (!plain) j.mc.plain = {};
    j.mc.plain.enabled = false;
  } else {
    if (!plain || plain.enabled !== false) return { ok: true, changed: false, rel };
    delete plain.enabled;
    if (!Object.keys(plain).length) delete j.mc.plain;
    if (!Object.keys(j.mc).length) delete j.mc;
  }
  const ind = body.match(/^\{\r?\n([ \t]+)\S/);
  const indent = ind ? ind[1] : 2;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  let text = `${JSON.stringify(j, null, indent)}\n`;
  if (eol !== '\n') text = text.replace(/\n/g, eol);
  safefs.writeAtomic(root, rel, (bom ? '﻿' : '') + text);
  return { ok: true, changed: true, rel };
}

function routingState(root) {
  const rel = where.relFor(root, 'manifest') || 'the project manifest';
  let cfg = {};
  let unreadable = null;
  try { cfg = where.readConfigStrict(root); } catch (e) { unreadable = e && e.message ? e.message : 'unreadable'; cfg = {}; }
  const envOff = where.envOff();
  const value = cfg.enabled === undefined ? null : cfg.enabled;
  let on;
  let reason;
  if (envOff) { on = false; reason = 'MC_PLAIN_OFF is set in the environment'; }
  else if (unreadable) { on = true; reason = `the default: ${rel} could not be read, so the hooks use their defaults`; }
  else if (value === false) { on = false; reason = `${SWITCH_KEY} is false in ${rel}`; }
  else if (value === null) { on = true; reason = 'the default: no switch is set'; }
  else { on = true; reason = `${SWITCH_KEY} is ${JSON.stringify(value)} in ${rel}`; }
  return { on, reason, envOff, switchValue: value, manifest: rel, manifestUnreadable: unreadable, cfg };
}

function currentIndex(root, cfg) {
  const catalog = readCatalog(root);
  const stored = core.load(root);
  let logTime = 0;
  try { logTime = fs.statSync(misslog.logFile(root)).mtimeMs; } catch { }
  const fresh = Boolean(stored) && stored.fingerprint === catalog.fingerprint && stored.configHash === core.configHash(cfg) && !(logTime && logTime > Date.parse(stored.builtAt));
  return { index: fresh ? stored : core.build(root, { catalog, cfg, write: false }), catalog, source: fresh ? 'stored index' : 'built in memory' };
}

function isDenyClass(skill, extra) {
  if (risk.denyWordsIn(skill.slug).length) return true;
  if (extra.has(skill.slug.toLowerCase())) return true;
  let head = guard.readHead(skill.file, HEAD_BYTES);
  if (!head.ok) return true;
  let parsed = guard.parseStrict(head.text);
  if (!parsed.ok && head.truncated) {
    head = guard.readHead(skill.file, FULL_BYTES);
    if (!head.ok) return true;
    parsed = guard.parseStrict(head.text);
  }
  if (!parsed.ok) return true;
  const names = [skill.slug, parsed.fm.name].filter(Boolean);
  if (parsed.fm.name && extra.has(String(parsed.fm.name).toLowerCase())) return true;
  return guard.classify({ names, fm: parsed.fm, body: parsed.body, flagged: parsed.flagged || [] }).deny;
}

function lineStats(root, index, cfg) {
  const rows = misslog.readLog(root).filter((r) => r && (r.layer === 'name' || r.layer === 'hint') && Array.isArray(r.suggested) && r.suggested.length);
  const tokens = [];
  for (const r of rows) {
    const got = core.route(index, String(r.excerpt || ''), cfg);
    if (got.text && got.layer === r.layer) tokens.push(got.tokens);
  }
  const mean = tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : null;
  return { logged: rows.length, measured: tokens.length, mean, max: tokens.length ? Math.max(...tokens) : null, ceiling: core.MAX_TOKENS };
}

function guardRegistration(root) {
  const rel = where.relFor(root, 'settings') || '.claude/settings.json';
  const out = { settings: rel, registered: false, onFailure: null, timeout: null };
  let s;
  try {
    const raw = safefs.readCapped(path.join(root, rel), SETTINGS_MAX_BYTES);
    if (raw == null) return out;
    s = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch { return out; }
  const groups = s && isObj(s.hooks) && Array.isArray(s.hooks.PreToolUse) ? s.hooks.PreToolUse : [];
  for (const g of groups) {
    const m = g && typeof g.matcher === 'string' ? g.matcher : '';
    const coversSkill = m === '' || m === '*' || m.split('|').map((x) => x.trim()).includes('Skill');
    if (!coversSkill || !Array.isArray(g.hooks)) continue;
    for (const h of g.hooks) {
      if (h && typeof h.command === 'string' && /scripts[\\/]hooks[\\/]plain-guard\.js/.test(h.command)) {
        out.registered = true;
        out.onFailure = h.onFailure || null;
        out.timeout = h.timeout || null;
        return out;
      }
    }
  }
  return out;
}

function status(root) {
  const r = routingState(root);
  const { index, catalog, source } = currentIndex(root, r.cfg);
  const exclude = new Set(Array.isArray(r.cfg.exclude) ? r.cfg.exclude : []);
  const extra = new Set((Array.isArray(r.cfg.confirmFirst) ? r.cfg.confirmFirst : []).filter((x) => typeof x === 'string').map((x) => x.trim().replace(/^\//, '').toLowerCase()));
  const mapped = catalog.skills.filter((s) => !exclude.has(s.slug));
  const denyClass = mapped.filter((s) => isDenyClass(s, extra)).length;
  const heldBack = index.skills.filter((s) => core.denyClassNow(s, r.cfg)).length;
  const own = path.resolve(__dirname, '..', '..');
  const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return {
    project: { root, own: same(path.resolve(root), own) },
    routing: { on: r.on, reason: r.reason, envOff: r.envOff },
    switch: { key: SWITCH_KEY, file: r.manifest, value: r.switchValue, unreadable: r.manifestUnreadable },
    map: {
      enabled: r.cfg.map !== false,
      added: r.on && r.cfg.map !== false && index.map.tokens <= core.MAP_MAX_TOKENS && index.skills.length > 0,
      tokens: index.map.tokens,
      ceiling: core.MAP_MAX_TOKENS,
      shown: index.map.shown,
      total: index.map.total,
      source,
    },
    line: lineStats(root, index, r.cfg),
    skills: { mapped: mapped.length, heldBack, denyClass },
    guard: { alwaysOn: true, ...guardRegistration(root) },
  };
}

function render(st, note) {
  const L = [];
  if (note) L.push(note);
  L.push(st.project.own ? 'Plain language' : `Plain language (project: ${st.project.root}, not the copy this script is in)`);
  L.push(`  Routing: ${st.routing.on ? 'ON' : 'OFF'} (${st.routing.reason})`);
  const g = st.guard;
  if (!g.registered) L.push(`  Guard: NOT REGISTERED in ${g.settings}, so nothing stops the model starting a deny-class skill.`);
  else {
    const fails = g.onFailure === 'block' ? '' : ' Its onFailure "block" is not set, so a guard that cannot run lets the call through.';
    L.push(`  Guard: ON, always. It refuses the ${n(st.skills.denyClass)} deny-class skills when the model starts one, and stays on when routing is off.${fails}`);
  }
  const m = st.map;
  const lists = m.shown < m.total ? `; lists ${n(m.shown)} of ${n(m.total)} skills` : '';
  if (!m.enabled) L.push(`  Skill map: off (mc.plain.map is false); the index still refreshes at session start`);
  else if (!st.routing.on) L.push(`  Skill map: not added while routing is off (it would be ${n(m.tokens)} tokens)`);
  else L.push(`  Skill map: ${n(m.tokens)} tokens, added once per session (ceiling ${n(m.ceiling)})${lists}`);
  const l = st.line;
  if (!st.routing.on) L.push('  Per-message line: none while routing is off');
  else if (!l.logged) L.push(`  Per-message line: nothing logged yet (each line is at most ${l.ceiling} tokens)`);
  else if (!l.measured) L.push(`  Per-message line: ${n(l.logged)} logged, none re-measurable against the current skills (ceiling ${l.ceiling})`);
  else L.push(`  Per-message line: mean ${l.mean}, max ${l.max} tokens over ${n(l.measured)} logged lines (ceiling ${l.ceiling})${l.measured < l.logged ? `; ${n(l.logged - l.measured)} no longer re-measurable` : ''}`);
  L.push(`  Skills mapped: ${n(st.skills.mapped)}; the user types ${n(st.skills.heldBack)} themselves, ${n(st.skills.denyClass)} are deny-class`);
  L.push(`  Switch: ${st.switch.key} in ${st.switch.file}. /plain off stops routing; /plain on brings it back. Neither touches the guard.`);
  return `${L.join('\n')}\n`;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = projectRoot(a.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) usage(`not a folder: ${root}`);
  let note = '';
  let code = 0;
  let change = null;
  if (a.action === 'on' || a.action === 'off') {
    try { change = setSwitch(root, a.action); } catch (e) { change = { ok: false, why: e && e.message ? e.message : 'the write failed' }; }
    if (!change.ok) { note = `Routing was not switched ${a.action}: ${change.why}. Nothing changed.`; code = 1; }
    else if (!change.changed) note = `Routing switch already ${a.action === 'off' ? 'off' : 'on (no switch set)'}; nothing changed.`;
    else note = a.action === 'off' ? `Routing switched off (${SWITCH_KEY} = false in ${change.rel}).` : `Routing switched on (the switch was removed from ${change.rel}).`;
    if (change.ok && a.action === 'on' && where.envOff()) note += ' Routing stays off while MC_PLAIN_OFF is set in the environment.';
  }
  const st = status(root);
  if (a.json) process.stdout.write(`${JSON.stringify({ action: a.action, change, ...st }, null, 2)}\n`);
  else process.stdout.write(render(st, note));
  process.exit(code);
}

if (require.main === module) main();

module.exports = { setSwitch, status, render, routingState, isDenyClass, lineStats, guardRegistration, parseArgs, SWITCH_KEY };
