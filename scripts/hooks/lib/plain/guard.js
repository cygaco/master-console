'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readFrontmatter, denyClassOf, namesOf, fromDirs, pluginBases } = require('./catalog');
const risk = require('./risk');
const where = require('./where');

const TOOLS = new Set(['Skill', 'SlashCommand']);
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,127}$/;
const HEAD_BYTES = 16384;
const FULL_BYTES = 262144;
const ARGS_SHOWN = 300;

const HOOK_ENTRY = Object.freeze({
  event: 'PreToolUse',
  matcher: 'Skill|SlashCommand',
  hooks: Object.freeze([Object.freeze({
    type: 'command',
    command: 'node "$CLAUDE_PROJECT_DIR/scripts/hooks/plain-guard.js"',
    timeout: 10,
    onFailure: 'block',
  })]),
});

function parseCall(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return { bad: 'the call is not a JSON object' };
  if (event.hook_event_name !== undefined && event.hook_event_name !== 'PreToolUse') return { skip: true };
  if (typeof event.tool_name === 'string' && !TOOLS.has(event.tool_name)) return { skip: true };
  if (!TOOLS.has(event.tool_name)) return { bad: 'the call names no tool' };
  const ti = event.tool_input;
  if (!ti || typeof ti !== 'object' || Array.isArray(ti)) return { bad: 'the call has no tool input' };
  let name;
  let args = '';
  if (event.tool_name === 'Skill') {
    if (typeof ti.skill !== 'string') return { bad: 'the call names no skill' };
    name = ti.skill.trim().replace(/^\//, '');
    if (typeof ti.args === 'string') args = ti.args;
  } else {
    if (typeof ti.command !== 'string') return { bad: 'the call names no command' };
    const m = ti.command.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) return { bad: 'the command does not start with a slash' };
    name = m[1];
    args = m[2] || '';
  }
  if (!name) return { bad: 'the call names no skill' };
  if (!NAME_OK.test(name)) return { bad: 'the skill name is not a plain skill name' };
  return { name, args };
}

const oneLine = (s, max) => {
  const t = String(s || '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
};

function reasonFor(call, because) {
  const named = call && call.name;
  const args = named ? oneLine(call.args, ARGS_SHOWN) : '';
  return [
    `Plain-language guard: blocked ${named ? `/${call.name}` : 'this skill call'}: ${because}.`,
    'The model may not start a skill that deletes, deploys or spends, or one the guard cannot read.',
    'Do not retry it, and do not call another such skill instead.',
    named
      ? `Tell the person to type this command themselves: /${call.name}${args ? ` ${args}` : ''}`
      : 'Tell the person to type the command for what they asked, themselves.',
  ].join(' ');
}

const refuse = (call, kind, because) => ({ deny: true, kind, reason: reasonFor(call, because) });

function readHead(file, max) {
  let fd = null;
  let buf;
  let n = 0;
  let size;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { ok: false, why: 'unreadable' };
    size = st.size;
    fd = fs.openSync(file, 'r');
    buf = Buffer.alloc(Math.min(max, size));
    while (n < buf.length) {
      const k = fs.readSync(fd, buf, n, buf.length - n, n);
      if (!k) break;
      n += k;
    }
  } catch {
    return { ok: false, why: 'unreadable' };
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { } }
  }
  const bytes = buf.subarray(0, n);
  if (bytes.includes(0)) return { ok: false, why: 'unparsable' };
  const truncated = n < size;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated });
    return { ok: true, text, truncated };
  } catch {
    return { ok: false, why: 'unparsable' };
  }
}

const FM_LINE_OK = (line) => !line.trim() || /^\s*#/.test(line) || /^[A-Za-z][\w-]*:/.test(line) || /^\s+\S/.test(line) || /^-(\s|$)/.test(line);

function parseStrict(text) {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!raw.startsWith('---')) return { ok: true, fm: {}, body: raw, flagged: [] };
  if (/^---\r?\n---(\r?\n|$)/.test(raw)) return { ok: true, fm: {}, body: raw.replace(/^---\r?\n---\r?\n?/, ''), flagged: [] };
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { ok: false };
  if (!m[1].split(/\r?\n/).every(FM_LINE_OK)) return { ok: false };
  const { fm, body, flagged, values } = readFrontmatter(raw);
  return { ok: true, fm, body, flagged, values };
}

const looseName = (text) => { const m = String(text).match(/^name:[ \t]*["']?([^"'\r\n#]+)/m); return m ? m[1].trim() : null; };

function candidates(root, want, home) {
  const found = [];
  fromDirs(path.join(root, '.claude'), '', 'project', found);
  fromDirs(path.join(home, '.claude'), '', 'user', found);
  for (const p of pluginBases(root, home)) fromDirs(p.base, p.prefix, 'plugin', found);
  const match = (n) => { const l = String(n || '').toLowerCase(); return Boolean(l) && (l === want || l.endsWith(`:${want}`)); };
  const out = [];
  for (const f of found) {
    const prefix = f.prefix ? `${f.prefix}:` : '';
    const pathName = f.slug || prefix + f.dirName;
    const byPath = match(pathName);
    const head = readHead(f.file, HEAD_BYTES);
    if (!head.ok) {
      if (byPath) out.push({ names: [pathName], file: f.file, origin: f.origin, bad: head.why });
      continue;
    }
    let parsed = parseStrict(head.text);
    const fmName = parsed.ok ? parsed.fm.name : looseName(head.text);
    const fullName = fmName ? prefix + fmName : null;
    if (!byPath && !match(fullName)) continue;
    const names = namesOf(f, fmName);
    if (!parsed.ok && head.truncated) {
      const full = readHead(f.file, FULL_BYTES);
      if (!full.ok) { out.push({ names, file: f.file, origin: f.origin, bad: full.why }); continue; }
      parsed = parseStrict(full.text);
    }
    if (!parsed.ok) { out.push({ names, file: f.file, origin: f.origin, bad: 'unparsable' }); continue; }
    out.push({ names, file: f.file, origin: f.origin, fm: parsed.fm, body: parsed.body, flagged: parsed.flagged || [], values: parsed.values });
  }
  return out;
}

const LINKED = Object.freeze({ kind: 'link', because: 'a skill folder or file on its path is a link, and the guard does not follow links' });
const UNLISTED = Object.freeze({ kind: 'unreadable', because: 'a skill folder on its path cannot be read' });
const ODD_FILE = Object.freeze({ kind: 'unreadable', because: 'its skill file is unreadable' });

function listNoFollow(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return e && e.code === 'ENOENT' ? [] : null; }
}

function hiddenCommand(dir, segs, i) {
  const ents = listNoFollow(dir);
  if (!ents) return UNLISTED;
  const last = i === segs.length - 1;
  const want = last ? `${segs[i]}.md` : segs[i];
  for (const e of ents) {
    if (e.name.toLowerCase() !== want) continue;
    if (e.isSymbolicLink()) return LINKED;
    if (last) {
      if (!e.isFile() && !e.isDirectory()) return ODD_FILE;
      continue;
    }
    if (e.isDirectory()) {
      const h = hiddenCommand(path.join(dir, e.name), segs, i + 1);
      if (h) return h;
    }
  }
  return null;
}

function hiddenSkill(dir, name) {
  const ents = listNoFollow(dir);
  if (!ents) return UNLISTED;
  for (const e of ents) {
    if (e.name.toLowerCase() !== name) continue;
    if (e.isSymbolicLink()) return LINKED;
    if (!e.isDirectory()) continue;
    const inner = listNoFollow(path.join(dir, e.name));
    if (!inner) return UNLISTED;
    for (const f of inner) {
      if (f.name.toLowerCase() !== 'skill.md') continue;
      if (f.isSymbolicLink()) return LINKED;
      if (!f.isFile()) return ODD_FILE;
    }
  }
  return null;
}

function hiddenOnPath(root, want, home) {
  const places = [{ base: path.join(root, '.claude'), names: [want] }, { base: path.join(home, '.claude'), names: [want] }];
  for (const p of pluginBases(root, home)) {
    const pre = `${String(p.prefix).toLowerCase()}:`;
    places.push({ base: p.base, names: want.startsWith(pre) ? [want, want.slice(pre.length)] : [want] });
  }
  for (const { base, names } of places) {
    for (const n of names) {
      if (!n) continue;
      const h = hiddenCommand(path.join(base, 'commands'), n.split(':'), 0) || hiddenSkill(path.join(base, 'skills'), n);
      if (h) return h;
    }
  }
  return null;
}

function classify(c) {
  if (c.bad) return { deny: true, kind: c.bad, because: `its skill file is ${c.bad}` };
  const d = denyClassOf(c.names, c.fm, c.body, c.flagged || [], c.values);
  if (!d) return { deny: false };
  if (d.kind === 'flag') return { deny: true, kind: 'flag', because: `its skill file carries ${d.flag}` };
  return { deny: true, kind: 'word', because: `its name or description says "${d.word}"` };
}

function confirmFirst(root) {
  let cfg = {};
  try { cfg = where.readConfig(root) || {}; } catch { cfg = {}; }
  const list = cfg && Array.isArray(cfg.confirmFirst) ? cfg.confirmFirst : [];
  return new Set(list.filter((x) => typeof x === 'string').map((x) => x.trim().replace(/^\//, '').toLowerCase()).filter(Boolean));
}

function judge(root, event, opts = {}) {
  const call = parseCall(event);
  if (call.skip) return { deny: false };
  if (call.bad) return refuse(null, 'call', call.bad);
  const want = call.name.toLowerCase();
  const nameWords = risk.denyWordsIn(call.name);
  if (nameWords.length) return refuse(call, 'word', `its name says "${nameWords[0]}"`);
  const home = opts.home || os.homedir();
  const cands = candidates(root, want, home);
  for (const c of cands) {
    const k = classify(c);
    if (k.deny) return refuse(call, k.kind, k.because);
  }
  const hidden = hiddenOnPath(root, want, home);
  if (hidden) return refuse(call, hidden.kind, hidden.because);
  if (!cands.length) {
    if (confirmFirst(root).has(want)) return refuse(call, 'setting', 'the project settings list it as confirm-first');
    return { deny: false };
  }
  const extra = confirmFirst(root);
  if (extra.has(want) || cands.some((c) => c.names.some((n) => extra.has(n.toLowerCase())))) {
    return refuse(call, 'setting', 'the project settings list it as confirm-first');
  }
  return { deny: false };
}

module.exports = { judge, parseCall, reasonFor, candidates, classify, parseStrict, readHead, hiddenOnPath, HOOK_ENTRY, NAME_OK };
