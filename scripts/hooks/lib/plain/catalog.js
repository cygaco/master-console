'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const risk = require('./risk');

const SELF = 'plain';
const SLUG_OK = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
const MAX_SKILLS = 2000;
const DENY_WORDS = risk.DENY_WORDS;

function cleanValue(v) {
  if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
  if (v === '>' || v === '|' || v === '>-' || v === '|-') v = '';
  return v.replace(/^[>|]-?\s+/, '');
}

function readFrontmatter(raw) {
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const values = Object.create(null);
  if (/^---\r?\n---(\r?\n|$)/.test(raw)) return { fm: {}, body: raw.replace(/^---\r?\n---\r?\n?/, ''), flagged: [], values };
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = {};
  if (!m) return { fm, body: raw, flagged: [], values };
  const lines = m[1].split(/\r?\n/);
  let key = null;
  for (const line of lines) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1].toLowerCase();
      (values[key] = values[key] || []).push(kv[2].trim());
    } else if (key && /^\s+\S/.test(line)) {
      const vs = values[key];
      vs[vs.length - 1] = `${vs[vs.length - 1]} ${line.trim()}`.trim();
    }
  }
  for (const k of Object.keys(values)) {
    values[k] = values[k].map(cleanValue);
    fm[k] = values[k][values[k].length - 1];
  }
  return { fm, body: raw.slice(m[0].length), flagged: risk.flagLinesIn(lines), values };
}

const truthy = (v) => /^(true|yes|1)$/i.test(String(v || '').trim());

function firstParagraph(body, max = 200) {
  const lines = String(body).split(/\r?\n/).map((l) => l.trim());
  const text = lines.filter((l) => l && !l.startsWith('#') && !l.startsWith('```')).slice(0, 3).join(' ');
  return text.slice(0, max);
}

function namesOf(f, fmName) {
  const prefix = f.prefix ? `${f.prefix}:` : '';
  return [...new Set([f.slug || prefix + f.dirName, fmName ? prefix + fmName : null, f.dirName].filter(Boolean))];
}

const valuesOf = (fm, values, key) => (values && Array.isArray(values[key]) ? values[key] : [fm && fm[key]]).filter((v) => typeof v === 'string' && v);

function denyClassOf(names, fm, body, flagged, values) {
  const description = [...valuesOf(fm, values, 'description'), fm && fm.description ? '' : String(body == null ? '' : body)];
  return risk.denyClass({
    names: [...names, ...valuesOf(fm, values, 'name')],
    description: description.join(' '),
    whenToUse: [...valuesOf(fm, values, 'when_to_use'), ...valuesOf(fm, values, 'when-to-use')].join(' '),
    fm,
    flagged,
  });
}

function toSkill(slug, f, raw) {
  const { fm, body, flagged, values } = readFrontmatter(raw);
  const description = (fm.description || firstParagraph(body) || '').slice(0, 400);
  const userOnly = truthy(fm['disable-model-invocation']);
  const deny = denyClassOf([slug, ...namesOf(f, fm.name)], fm, body, flagged, values);
  return {
    slug,
    description,
    whenToUse: (fm.when_to_use || fm['when-to-use'] || '').slice(0, 300),
    hint: (fm['argument-hint'] || '').slice(0, 40),
    userOnly,
    denyClass: userOnly || Boolean(deny),
    origin: f.origin,
    file: f.file,
  };
}

function walkMd(dir, rel, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, rel ? `${rel}/${e.name}` : e.name, out);
    else if ((e.isFile() || e.isSymbolicLink()) && e.name.toLowerCase().endsWith('.md')) out.push({ file: p, rel: rel ? `${rel}/${e.name.slice(0, -3)}` : e.name.slice(0, -3) });
  }
  return out;
}

function readSafe(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.slice(0, n).toString('utf8');
  } catch { return null; }
}

function fromDirs(base, prefix, origin, out) {
  for (const f of walkMd(path.join(base, 'commands'), '', [])) {
    const slug = (prefix ? `${prefix}:` : '') + f.rel.split('/').join(':');
    out.push({ slug, file: f.file, origin });
  }
  let ents = [];
  try { ents = fs.readdirSync(path.join(base, 'skills'), { withFileTypes: true }); } catch { }
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const file = path.join(base, 'skills', e.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    out.push({ slug: null, dirName: e.name, prefix, file, origin });
  }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function pluginBases(root, home) {
  const out = [];
  const installed = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!installed || typeof installed.plugins !== 'object') return out;
  const enabled = {};
  for (const s of [path.join(home, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json')]) {
    const j = readJson(s);
    if (j && j.enabledPlugins && typeof j.enabledPlugins === 'object') Object.assign(enabled, j.enabledPlugins);
  }
  const rootKey = path.resolve(root).toLowerCase();
  for (const [id, list] of Object.entries(installed.plugins)) {
    if (enabled[id] === false || (Object.keys(enabled).length && enabled[id] !== true)) continue;
    for (const inst of Array.isArray(list) ? list : []) {
      if (!inst || !inst.installPath) continue;
      if (inst.scope === 'project' || inst.scope === 'local') {
        if (!inst.projectPath || path.resolve(inst.projectPath).toLowerCase() !== rootKey) continue;
      }
      out.push({ base: inst.installPath, prefix: id.split('@')[0] });
      break;
    }
  }
  return out;
}

function homeOverride() {
  try {
    const v = require('../mc-env').readEnv('PLAIN_HOME');
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function readCatalog(root, opts = {}) {
  const home = opts.home || homeOverride() || os.homedir();
  const found = [];
  fromDirs(path.join(root, '.claude'), '', 'project', found);
  if (!opts.projectOnly) {
    fromDirs(path.join(home, '.claude'), '', 'user', found);
    for (const p of pluginBases(root, home)) fromDirs(p.base, p.prefix, 'plugin', found);
  }
  const seen = new Set();
  const skills = [];
  const unreadable = [];
  const fp = crypto.createHash('sha256');
  const matches = (s) => !opts.only || s.toLowerCase() === opts.only || s.toLowerCase().endsWith(`:${opts.only}`);
  for (const f of found) {
    if (f.slug && !matches(f.slug)) continue;
    let st;
    let raw = null;
    try { st = fs.statSync(f.file); raw = readSafe(f.file); } catch { raw = null; }
    if (raw == null) {
      if (opts.only && (f.slug ? matches(f.slug) : String(f.dirName || '').toLowerCase() === opts.only.split(':').pop())) unreadable.push(f.file);
      continue;
    }
    let slug = f.slug;
    if (!slug) {
      const { fm } = readFrontmatter(raw);
      slug = (f.prefix ? `${f.prefix}:` : '') + (fm.name || f.dirName);
    }
    if (slug === SELF || seen.has(slug.toLowerCase()) || !SLUG_OK.test(slug)) continue;
    if (!opts.noCap && skills.length >= MAX_SKILLS) break;
    if (!matches(slug)) continue;
    seen.add(slug.toLowerCase());
    fp.update(`${slug}\0${st.size}\0${Math.floor(st.mtimeMs)}\n`);
    skills.push(toSkill(slug, f, raw));
  }
  skills.sort((a, b) => a.slug.localeCompare(b.slug));
  return { skills, fingerprint: fp.digest('hex').slice(0, 16), unreadable };
}

const isDenyClass = (s) => Boolean(s && (s.denyClass || s.userOnly));

module.exports = { readCatalog, readFrontmatter, isDenyClass, denyClassOf, namesOf, firstParagraph, fromDirs, pluginBases, DENY_WORDS, SLUG_OK, SELF };
