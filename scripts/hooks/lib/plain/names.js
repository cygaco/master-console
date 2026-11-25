'use strict';
const { SPOKEN, editDistance } = require('./text');

const LEAD = new Set(['um', 'uh', 'ok', 'okay', 'so', 'hey', 'please', 'now', 'lets', 'go', 'and', 'then', 'run', 'do', 'use', 'start', 'invoke', 'the', 'a', 'can', 'you', 'could', 'would', 'skill', 'command']);
const MAX_LEAD = 3;

function nameWords(slug) {
  return String(slug).toLowerCase().split(/[:\-_/.]+/).filter(Boolean);
}

function sameWord(said, want) {
  if (said === want) return true;
  if (said === `${want}s` || `${said}s` === want) return true;
  if (want.length >= 5 && said.length >= 4 && editDistance(said, want, 1) <= 1) return true;
  return false;
}

function buildNames(slugs) {
  const vocab = new Set();
  const entries = slugs.map((slug) => {
    const w = nameWords(slug);
    w.forEach((x) => vocab.add(x));
    return { slug, w };
  });
  entries.sort((a, b) => b.w.length - a.w.length);
  return { entries, vocab: [...vocab] };
}

function tokens(raw) {
  const out = [];
  const re = /[A-Za-z0-9\u00c0-\u024f'\u2019]+/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const w = m[0].normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['\u2019]/g, '');
    if (!w) continue;
    out.push({ w, end: m.index + m[0].length, spoken: SPOKEN.has(w) });
  }
  return out;
}

function heal(ts, vocab) {
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    if (i + 1 < ts.length && vocab.has(ts[i].w + ts[i + 1].w) && !vocab.has(ts[i].w)) {
      out.push({ w: ts[i].w + ts[i + 1].w, end: ts[i + 1].end });
      i++;
    } else out.push(ts[i]);
  }
  return out;
}

function matchName(names, text) {
  const raw = String(text || '');
  if (/^\s*\//.test(raw)) return null;
  const vocab = new Set(names.vocab);
  const all = tokens(raw);
  let i = 0;
  let spokenSlash = false;
  let lead = 0;
  while (i < all.length && (all[i].spoken || (lead < MAX_LEAD && LEAD.has(all[i].w) && !vocab.has(all[i].w)))) {
    if (all[i].w === 'slash') spokenSlash = true;
    if (!all[i].spoken) lead++;
    i++;
  }
  const ws = heal(all.slice(i).filter((t) => !t.spoken), vocab);
  for (const e of names.entries) {
    const n = e.w.length;
    if (ws.length < n) continue;
    if (!e.w.every((w, k) => sameWord(ws[k].w, w))) continue;
    if (n === 1 && !(spokenSlash || ws.length === 1)) continue;
    return { slug: e.slug, end: ws[n - 1].end };
  }
  return null;
}

function remainder(text, end) {
  return String(text || '').slice(end).replace(/^[\s:,.;\-]+/, '').trim();
}

const REPORT = new Set('is was are were be been failed fails failing broke broken breaks keeps kept stuck hangs hung crashed crashes errored error errors issue issues problem problems why what how when where who not doesnt didnt isnt wasnt wont cant cannot never'.split(' '));

function isRequest(text, end) {
  if (/\?/.test(String(text || ''))) return false;
  const after = remainder(text, end).toLowerCase().replace(/['\u2019]/g, '').split(/[^a-z0-9]+/).filter(Boolean).slice(0, 3);
  return !after.some((w) => REPORT.has(w));
}

module.exports = { buildNames, matchName, remainder, nameWords, isRequest };
