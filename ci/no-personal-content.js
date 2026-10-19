#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const CHECKS_BASE = ['allowlist', 'filetype', 'name', 'email', 'local-path', 'quote', 'attribution', 'seed'];

const CONTENT_CHECKS = ['name', 'email', 'local-path', 'quote', 'attribution'];

class CannotRun extends Error {}

const CONFUSABLES = {
  'а': 'a', 'с': 'c', 'е': 'e', 'і': 'i', 'ј': 'j', 'о': 'o',
  'р': 'p', 'ѕ': 's', 'х': 'x', 'у': 'y', 'һ': 'h', 'ԁ': 'd',
  'ԛ': 'q', 'ԝ': 'w', 'к': 'k', 'м': 'm', 'т': 't', 'ґ': 'r',
  'α': 'a', 'ε': 'e', 'ι': 'i', 'ο': 'o', 'ρ': 'p', 'ν': 'v',
  'υ': 'u', 'κ': 'k', 'χ': 'x', 'γ': 'y', 'τ': 't', 'ς': 's',
  'в': 'b', 'н': 'h', 'ѵ': 'v', 'ԍ': 'g', 'ӏ': 'l',
  'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'б': 'b', 'з': 'z',
  'β': 'b', 'ζ': 'z', 'μ': 'u', 'ω': 'w', 'ϲ': 'c',
  'ϳ': 'j', 'π': 'n',
  'ı': 'i', 'ɡ': 'g', 'ɑ': 'a', 'ɩ': 'i',
  'ø': 'o', 'ł': 'l', 'đ': 'd', 'ħ': 'h', 'ŧ': 't', 'ƒ': 'f', 'ɛ': 'e', 'ѡ': 'w',
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i',
  'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r',
  'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z',
};
const CONFUSABLE_RE = new RegExp('[' + Object.keys(CONFUSABLES).join('') + ']', 'g');
function canonText(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(CONFUSABLE_RE, (c) => CONFUSABLES[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function tokens(s) {
  return canonText(s).split(' ').filter(Boolean);
}

function readText(p, what) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_) {
    throw new CannotRun(what + ' unreadable');
  }
}

function isCanonToken(t) {
  return typeof t === 'string' && t.length > 0 && canonText(t) === t && !t.includes(' ');
}

function validateFingerprints(fp) {
  const bad = (m) => {
    throw new CannotRun('fingerprints invalid: ' + m);
  };
  if (!fp || typeof fp !== 'object' || Array.isArray(fp)) bad('not an object');
  if (fp.schema !== 'mc/npc-fingerprints/v1') bad('schema');
  if (fp.canon !== 'v1' && fp.canon !== 'v2') bad('canon');
  if (!Array.isArray(fp.names) || fp.names.length < 1) bad('names empty');
  if (!fp.names.every(isCanonToken)) bad('names must be canon single tokens');
  if (!Array.isArray(fp.emails) || fp.emails.length < 1) bad('emails empty');
  if (!fp.emails.every((e) => typeof e === 'string' && e.length > 0 && e === e.toLowerCase())) bad('emails');
  if (!Array.isArray(fp.quotes) || fp.quotes.length < 1) bad('quotes empty');
  for (const q of fp.quotes) {
    if (!Array.isArray(q) || q.length < 5 || !q.every(isCanonToken)) bad('quote shape (>=5 canon tokens)');
  }
  const c = fp.controls;
  if (!c || typeof c !== 'object') bad('controls missing');
  if (typeof c.name !== 'string' || !fp.names.includes(c.name)) bad('control name');
  if (!Number.isInteger(c.quote) || c.quote < 0 || c.quote >= fp.quotes.length) bad('control quote');
  return fp;
}

function loadFingerprints(opts, env) {
  opts = opts || {};
  env = env || process.env;
  let raw;
  if (opts.fingerprints) raw = readText(opts.fingerprints, 'fingerprints file');
  else if (env.MC_NPC_FINGERPRINTS_FILE) raw = readText(env.MC_NPC_FINGERPRINTS_FILE, 'fingerprints file');
  else if (env.MC_NPC_FINGERPRINTS) raw = env.MC_NPC_FINGERPRINTS;
  else throw new CannotRun('no fingerprints supplied (no skip mode exists)');
  let fp;
  try {
    fp = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (_) {
    throw new CannotRun('fingerprints are not valid JSON');
  }
  return validateFingerprints(fp);
}

const NEAR_W = 8;
function maskKey(w, p) {
  return p + '|' + w.slice(0, p).join(' ') + '|' + w.slice(p + 1).join(' ');
}
const compiled = new WeakMap();
function compile(fp) {
  let c = compiled.get(fp);
  if (c) return c;
  const names = new Set(fp.names);
  const windows = new Map([[5, new Set()], [6, new Set()]]);
  for (const q of fp.quotes) {
    if (q.length === 5) windows.get(5).add(q.join(' '));
    else for (let i = 0; i + 6 <= q.length; i++) windows.get(6).add(q.slice(i, i + 6).join(' '));
  }
  const masked = new Set();
  for (const q of fp.quotes) {
    for (let i = 0; i + NEAR_W <= q.length; i++) {
      const w = q.slice(i, i + NEAR_W);
      for (let p = 0; p < NEAR_W; p++) masked.add(maskKey(w, p));
    }
  }
  const emails = fp.emails.map((e) => e.toLowerCase());
  c = { names, windows, masked, emails };
  compiled.set(fp, c);
  return c;
}

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,24}(?![A-Za-z0-9\-])/g;
const EMAIL_DOMAIN_OK = new Set(['example.com', 'example.org', 'example.net']);
const EMAIL_SUFFIX_OK = ['.example', '.invalid', '.test', '.localhost'];
const EMAIL_LITERAL_OK = new Set(['git@github.com']);
const SEG = '([^\\\\/\\s"\'`<>|:*?]+)';
const DRIVE = '[A-Za-z]:[\\\\/]+' + 'Us' + 'ers' + '[\\\\/]+' + SEG;
const UNIXU = '/' + 'Us' + 'ers' + '/+' + SEG;
const UNIXH = '/' + 'ho' + 'me' + '/+' + SEG;
const URLENC = '%2[Ff]' + 'Us' + 'ers' + '%2[Ff]' + '([^%\\s"\'<>|]+)';
const SLUG = '(?:^|[^A-Za-z0-9])[A-Za-z]--' + 'Us' + 'ers' + '-' + '([^-\\s"\'<>|/\\\\]+)';
const PATH_RES = [
  new RegExp(DRIVE, 'gi'),
  new RegExp(UNIXU, 'gi'),
  new RegExp(UNIXH, 'gi'),
  new RegExp(URLENC, 'gi'),
  new RegExp(SLUG, 'gi'),
];
const PATH_OK = new Set(
  ['<user>', '<you>', '<username>', 'username', '%username%', '$user', '${user}', 'you', 'user', 'runner', 'example', 'name', '*']
);
const ATTR_RES = [
  new RegExp(
    '\\b(' + ['oper' + 'ator', 'foun' + 'der', 'c' + 'eo'].join('|') + ')\\b.{0,40}\\b(' +
      ['sa' + 'id', 'sa' + 'ys', 'wro' + 'te', 'as' + 'ked', 'rul' + 'ed', 'dicta' + 'ted', 'to' + 'ld', 'quo' + 'ted', 'verba' + 'tim'].join('|') + ')\\b',
    'i'
  ),
  new RegExp('\\(' + 'oper' + 'ator,\\s*\\d{4}-\\d{2}-\\d{2}\\)', 'i'),
];

function splitLines(text) {
  return text.split(/\r\n|\r|\n/);
}

function splitBoundaries(s) {
  return String(s)
    .replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .replace(/(\p{L})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{L})/gu, '$1 $2');
}

function lineHasName(ln, names, long) {
  const toks = tokens(ln).concat(tokens(splitBoundaries(ln)));
  for (const t of toks) {
    if (names.has(t)) return true;
    for (const n of long) if (t.includes(n)) return true;
  }
  return false;
}

function matchName(text, fp) {
  const { names } = compile(fp);
  const long = fp.names.filter((n) => n.length >= 5);
  const hits = [];
  splitLines(text).forEach((ln, i) => {
    if (lineHasName(ln, names, long)) hits.push({ check: 'name', line: i + 1 });
  });
  return hits;
}

function matchQuote(text, fp) {
  const { windows, masked } = compile(fp);
  const flat = [];
  splitLines(text).forEach((ln, i) => {
    for (const t of tokens(ln)) flat.push([t, i + 1]);
  });
  const hits = [];
  const seen = new Set();
  for (let i = 0; i < flat.length; i++) {
    for (let L = 5; L <= 6 && i + L <= flat.length; L++) {
      const key = flat.slice(i, i + L).map((x) => x[0]).join(' ');
      if (windows.get(L).has(key) && !seen.has(flat[i][1])) {
        seen.add(flat[i][1]);
        hits.push({ check: 'quote', line: flat[i][1] });
      }
    }
    if (i + NEAR_W <= flat.length && !seen.has(flat[i][1])) {
      const w = flat.slice(i, i + NEAR_W).map((x) => x[0]);
      for (let p = 0; p < NEAR_W; p++) {
        if (masked.has(maskKey(w, p))) {
          seen.add(flat[i][1]);
          hits.push({ check: 'quote', line: flat[i][1] });
          break;
        }
      }
    }
  }
  return hits;
}

function emailOk(addr) {
  const a = String(addr).toLowerCase();
  if (EMAIL_LITERAL_OK.has(a)) return true;
  const at = a.lastIndexOf('@');
  if (at < 1) return false;
  const d = a.slice(at + 1);
  return EMAIL_DOMAIN_OK.has(d) || EMAIL_SUFFIX_OK.some((x) => d.endsWith(x));
}

function emailView(ln) {
  return String(ln).normalize('NFKD').replace(/\p{Cf}/gu, '').replace(/\p{M}/gu, '')
    .replace(/[。｡․﹒]/g, '.').replace(/[﹫＠]/g, '@')
    .toLowerCase().replace(CONFUSABLE_RE, (c) => CONFUSABLES[c]);
}
function matchEmail(text, fp) {
  const { emails } = compile(fp);
  const hits = [];
  splitLines(text).forEach((ln, i) => {
    let hit = false;
    for (const view of [ln, emailView(ln)]) {
      const lower = view.toLowerCase();
      for (const e of emails) if (lower.includes(e)) hit = true;
      EMAIL_RE.lastIndex = 0;
      let m;
      while (!hit && (m = EMAIL_RE.exec(view))) if (!emailOk(m[0])) hit = true;
      if (hit) break;
    }
    if (hit) hits.push({ check: 'email', line: i + 1 });
  });
  return hits;
}

const PLACEHOLDER_SEG = /^(?:%[^%]+%|\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)$/;
const BOUNDARY_CH = /[\s"'`(\[=:,/\\?]/;
function atPathBoundary(ln, idx) {
  if (idx === 0) return true;
  if (BOUNDARY_CH.test(ln[idx - 1])) return true;
  return /(?:^|[\s"'`(\[=:,])(?:\/mnt)?\/[A-Za-z]$/.test(ln.slice(0, idx));
}
function matchLocalPath(text) {
  const hits = [];
  splitLines(text).forEach((ln, i) => {
    let hit = false;
    PATH_RES.forEach((re, ri) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(ln))) {
        if (PATH_OK.has(m[1].toLowerCase()) || PLACEHOLDER_SEG.test(m[1])) continue;
        if (ri <= 2 && !atPathBoundary(ln, m.index)) continue;
        hit = true;
      }
    });
    if (hit) hits.push({ check: 'local-path', line: i + 1 });
  });
  return hits;
}

function matchAttribution(text) {
  const hits = [];
  splitLines(text).forEach((ln, i) => {
    if (ATTR_RES.some((re) => re.test(ln))) hits.push({ check: 'attribution', line: i + 1 });
  });
  return hits;
}

const NAMED_ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', zwnj: '', zwj: '',
  lrm: '', rlm: '', hyphen: '-', ndash: '-', mdash: '-', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
  sol: '/', bsol: '\\', period: '.', comma: ',', commat: '@', colon: ':', lowbar: '_', num: '#',
};
function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,8}));?/g, (m, d, h, n) => {
    if (n !== undefined) {
      const k = n.toLowerCase();
      return Object.prototype.hasOwnProperty.call(NAMED_ENT, k) ? NAMED_ENT[k] : m;
    }
    const cp = d !== undefined ? parseInt(d, 10) : parseInt(h, 16);
    if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    if (cp === 10 || cp === 13) return ' ';
    return String.fromCodePoint(cp);
  });
}
const B64_RUN = /[A-Za-z0-9+/_-]{8,}={0,2}/g;
function stripMarkup(text) {
  const keepNl = (m) => m.replace(/[^\n]/g, '');
  return text
    .replace(/<!--[\s\S]*?-->/g, keepNl)
    .replace(/<\/?[A-Za-z!?][^>]*>/g, (m, off, whole) => {
      if (PATH_OK.has(m.toLowerCase())) return m;
      if (/^<[^<>/\\]+>$/.test(m) && /(?:users|home)[\\/]+$/i.test(whole.slice(0, off)) &&
          /^(?:[\\/]|\s|$)/.test(whole.slice(off + m.length))) return m;
      return keepNl(m);
    })
    .replace(/[*_`~]+/g, '');
}
function pctDecode(text) {
  return text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
    const buf = Buffer.from(run.replace(/%/g, ''), 'hex');
    let d;
    try { d = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { d = buf.toString('latin1'); }
    return d.replace(/[\r\n]/g, ' ');
  });
}
function b64Decoded(ln) {
  const out = [];
  B64_RUN.lastIndex = 0;
  let m;
  while ((m = B64_RUN.exec(ln))) {
    let t = m[0].replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    if (t.length % 4 === 1) t = t.slice(0, -1);
    const buf = Buffer.from(t, 'base64');
    if (buf.length < 4) continue;
    let dec;
    try { dec = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { continue; }
    const chars = Array.from(dec);
    let printable = 0;
    for (const ch of chars) if (/[\p{L}\p{N}\p{P}\p{S}\p{Zs}\t\r\n]/u.test(ch)) printable++;
    if (printable >= 0.9 * chars.length) out.push(dec);
  }
  return out;
}

function scanCore(text, fp) {
  return [
    ...matchName(text, fp),
    ...matchEmail(text, fp),
    ...matchLocalPath(text),
    ...matchQuote(text, fp),
    ...matchAttribution(text),
  ];
}

function scanText(text, fp, counts) {
  if (counts) for (const k of CONTENT_CHECKS) counts[k] = (counts[k] || 0) + 1;
  text = String(text);
  const all = scanCore(text, fp);
  const decoded = decodeEntities(text);
  const bases = [text];
  if (decoded !== text) { all.push(...scanCore(decoded, fp)); bases.push(decoded); }
  const views = [];
  for (const b of bases) {
    const stripped = stripMarkup(b);
    if (stripped !== b) views.push(stripped);
    const pct = pctDecode(b);
    if (pct !== b) views.push(pct);
    const both = pctDecode(stripped);
    if (both !== stripped && both !== pct) views.push(both);
  }
  for (const v of views) all.push(...scanCore(v, fp));
  for (const b of bases.concat(views)) {
    splitLines(b).forEach((ln, i) => {
      for (const dec of b64Decoded(ln)) {
        for (const h of scanCore(dec, fp)) all.push({ check: h.check, line: i + 1 });
      }
    });
  }
  const seen = new Set();
  return all.filter((h) => {
    const k = h.check + ':' + h.line;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function selfTest(fp) {
  const c = fp.controls;
  const nameOk = matchName('lorem ' + c.name + ' ipsum', fp).length > 0;
  const quoteOk = matchQuote('lorem ipsum ' + (fp.quotes[c.quote] || []).join(' ') + ' dolor sit', fp).length > 0;
  return nameOk && quoteOk;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_ALLOWED = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'bKGD']);
const BIN_EXT = new Set(['.png', '.ico', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.exe', '.dll']);

function pngProblems(buf) {
  const out = [];
  let off = 8;
  let sawEnd = false;
  while (off < buf.length) {
    if (sawEnd) { out.push('trailing bytes after IEND'); break; }
    if (off + 12 > buf.length) { out.push('truncated chunk'); break; }
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) { out.push('chunk overruns file'); break; }
    if (!PNG_ALLOWED.has(type)) out.push('non-allowlisted chunk');
    if (type === 'IEND') sawEnd = true;
    off += 12 + len;
  }
  if (!sawEnd && !out.includes('truncated chunk') && !out.includes('chunk overruns file')) out.push('no IEND');
  return out;
}

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) throw new CannotRun('git ' + args[0] + ' failed');
  return r.stdout;
}

function walk(root) {
  const out = [];
  (function rec(rel) {
    const dir = rel ? path.join(root, rel) : root;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' && e.isDirectory()) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) rec(r);
      else out.push(r);
    }
  })('');
  return out;
}

function fileSet(root) {
  if (fs.existsSync(path.join(root, '.git'))) {
    return git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean);
  }
  return walk(root);
}

function utf8OrLatin1(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { return Buffer.from(buf).toString('latin1'); }
}

function catBatch(root, ids) {
  const r = spawnSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: Buffer.from(ids.join('\n') + '\n'), maxBuffer: 1024 * 1024 * 1024, windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new CannotRun('git cat-file failed');
  const out = r.stdout;
  const res = [];
  let pos = 0;
  for (const want of ids) {
    const nl = out.indexOf(10, pos);
    if (nl < 0) throw new CannotRun('git cat-file output truncated');
    const m = /^([0-9a-f]{40,64}) (\w+) (\d+)$/.exec(out.toString('latin1', pos, nl));
    if (!m) throw new CannotRun('git cat-file: object missing');
    const size = parseInt(m[3], 10);
    if (nl + 1 + size > out.length) throw new CannotRun('git cat-file output truncated');
    res.push({ id: m[1], type: m[2], data: out.subarray(nl + 1, nl + 1 + size) });
    pos = nl + 1 + size + 1;
    void want;
  }
  return res;
}

function utf16Decode(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 4 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    sw.swap16();
    return new TextDecoder('utf-16le').decode(sw);
  }
  return null;
}
function analyzeBlob(buf, rels, fp) {
  const isPng = buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG);
  const binExt = rels.some((r) => BIN_EXT.has(path.extname(r).toLowerCase()));
  const binary = isPng || binExt || buf.includes(0);
  const texts = [];
  let filetype = false;
  let pngName = false;
  if (binary) {
    if (isPng) { if (pngProblems(buf).length) filetype = true; } else filetype = true;
    const text = buf.toString('latin1');
    texts.push(text);
    const u16 = utf16Decode(buf);
    if (u16 !== null) texts.push(u16);
    if (isPng) {
      texts.push(buf.toString('utf8'));
      const low = text.toLowerCase();
      for (const n of fp.names) if (n.length >= 5 && low.includes(n)) pngName = true;
    }
  } else {
    try { texts.push(new TextDecoder('utf-8', { fatal: true }).decode(buf)); } catch (_) {
      filetype = true;
      texts.push(buf.toString('latin1'));
    }
  }
  return { filetype, texts, pngName, binary };
}

function parseList(txt) {
  return txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const NARR_CHECKS = ['narrative-speech', 'narrative-clock', 'narrative-provenance', 'narrative-closure'];
const REPORT_ONLY = new Set(['narrative-closure']);
const NARR_SHORT = { speech: 'narrative-speech', clock: 'narrative-clock', provenance: 'narrative-provenance', closure: 'narrative-closure' };

const SLASH_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.css', '.go', '.java', '.c', '.h', '.cs', '.rs']);
const HASH_EXT = new Set(['.sh', '.py', '.ps1', '.psm1', '.yml', '.yaml', '.toml', '.rb', '.ini']);
const DATA_EXT = new Set(['.json', '.jsonl', '.csv', '.lock', '.svg', '.map']);

function proseRegions(rel, lines) {
  const ext = path.extname(rel).toLowerCase();
  const out = [];
  if (DATA_EXT.has(ext)) return out;
  if (SLASH_EXT.has(ext)) {
    let inBlock = false;
    lines.forEach((ln, i) => {
      if (inBlock) {
        const e = ln.indexOf('*/');
        out.push({ n: i + 1, text: e >= 0 ? ln.slice(0, e) : ln });
        if (e >= 0) inBlock = false;
        return;
      }
      const t = ln.trim();
      if (/^(\/\/|\/\*|\*)/.test(t)) {
        out.push({ n: i + 1, text: ln });
        if (t.startsWith('/*') && t.indexOf('*/', 2) < 0) inBlock = true;
        return;
      }
      const b = /(?:^|[\s;,{}()[\]])\/\*(?!\/)(.*)$/.exec(ln);
      if (b) {
        const e = b[1].indexOf('*/');
        out.push({ n: i + 1, text: e >= 0 ? b[1].slice(0, e) : b[1] });
        if (e < 0) inBlock = true;
        return;
      }
      const m = /(?<=^|[\s;,)}\]])\/\/(?!\/)(.*)$/.exec(ln);
      if (m) out.push({ n: i + 1, text: m[1] });
    });
    return out;
  }
  if (HASH_EXT.has(ext)) {
    let blockEnd = null;
    lines.forEach((ln, i) => {
      if (blockEnd) {
        const e = ln.indexOf(blockEnd);
        out.push({ n: i + 1, text: e >= 0 ? ln.slice(0, e) : ln });
        if (e >= 0) blockEnd = null;
        return;
      }
      if (ext === '.ps1' || ext === '.psm1') {
        const s = ln.indexOf('<#');
        if (s >= 0) {
          const rest = ln.slice(s + 2);
          const e = rest.indexOf('#>');
          out.push({ n: i + 1, text: e >= 0 ? rest.slice(0, e) : rest });
          if (e < 0) blockEnd = '#>';
          return;
        }
      }
      if (ext === '.py') {
        const d = /("""|''')/.exec(ln);
        if (d) {
          const rest = ln.slice(d.index + 3);
          const e = rest.indexOf(d[1]);
          out.push({ n: i + 1, text: e >= 0 ? rest.slice(0, e) : rest });
          if (e < 0) blockEnd = d[1];
          return;
        }
      }
      const t = ln.trim();
      if (t.startsWith('#') && !t.startsWith('#!')) { out.push({ n: i + 1, text: ln }); return; }
      const m = /(?<=\s)#(?!!)(.*)$/.exec(ln);
      if (m) out.push({ n: i + 1, text: m[1] });
    });
    return out;
  }
  let fence = null;
  lines.forEach((ln, i) => {
    const f = /^\s*(```+|~~~+)/.exec(ln);
    if (f) {
      if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null;
      return;
    }
    if (!fence) out.push({ n: i + 1, text: ln });
  });
  return quoteBlockquotes(out);
}

function quoteBlockquotes(regions) {
  const out = [];
  for (let i = 0; i < regions.length;) {
    if (!/^\s*>/.test(regions[i].text)) { out.push(regions[i]); i++; continue; }
    let j = i;
    while (j + 1 < regions.length && regions[j + 1].n === regions[j].n + 1 && /^\s*>/.test(regions[j + 1].text)) j++;
    const run = regions.slice(i, j + 1).map((r) => ({ n: r.n, text: r.text.replace(/^\s*(?:>\s?)+/, '').replace(/["“”]/g, "'") }));
    let body = run.length;
    while (body > 1 && /^\s*(?:—|–|--|-)\s*\S/.test(run[body - 1].text)) body--;
    if (run[0].text.trim() && run[body - 1].text.trim()) { run[0].text = '"' + run[0].text.trimStart(); run[body - 1].text = run[body - 1].text.trimEnd() + '"'; }
    for (const r of run) out.push(r);
    i = j + 1;
  }
  return out;
}

function yamlValues(lines) {
  const out = [];
  let blockIndent = -1;
  lines.forEach((ln, i) => {
    const t = ln.trim();
    const indent = ln.length - ln.trimStart().length;
    if (blockIndent >= 0) {
      if (!t) return;
      if (indent > blockIndent) { out.push({ n: i + 1, text: t }); return; }
      blockIndent = -1;
    }
    if (!t || t.startsWith('#') || t === '---' || t === '...') return;
    const body = t.replace(/^(?:-\s+)+/, '');
    const km = /^(?:"[^"]*"|'[^']*'|[^\s:#'"][^:#]*?)\s*:(?:\s+(.*))?$/.exec(body);
    let val = km ? km[1] : body;
    if (val === undefined || val === '') return;
    val = val.replace(/\s+#.*$/, '').trim();
    if (/^[|>][+-]?\d*$/.test(val)) { blockIndent = indent; return; }
    if (val.length > 1 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))) val = val.slice(1, -1);
    if (val) out.push({ n: i + 1, text: val });
  });
  return out;
}

const PERSON_RE = /(?<![\w./@#$-])(operator|founder|ceo|owner|maintainer|he|she|his|her)(?![\w/\\@-])(['’]s)?/gi;
const PRONOUNS = new Set(['he', 'she', 'his', 'her']);
const FUNC_AFTER = new Set(['is', 'was', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'also', 'then', 'only', 'just', 'never', 'always', 'almost', 'still', 'does', 'did', 'do', 'not', 'who', 'which', 'that', 'and', 'or', 'but', 'when', 'if', 'so', 'now', 'once', 'later', 'first', 'again', 'even', 'really', 'explicitly', 'wants', 'want',
  'said', 'told', 'wrote', 'put', 'saw', 'gave', 'made', 'took', 'set', 'held', 'knew', 'felt', 'thought', 'meant', 'kept', 'sent', 'chose', 'began', 'got', 'left', 'asked', 'ran', 'spoke', 'found', 'built', 'read', 'let']);
const NAMED_SRC_RE = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)+ (?:interview|talk|keynote|essay|book|podcast)\b|\([A-Z][\w.]+(?: [A-Z][\w.]+)? (?:&|and) [A-Z][\w.]+\)/;

function stripCodeSpans(s) { return s.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length)).replace(/\]\([^)\n]*\)/g, (m) => ' '.repeat(m.length)).replace(/https?:\/\/\S+/g, (m) => ' '.repeat(m.length)); }

function naturalQuote(inner) {
  if (inner.length < 12 || /[{}=<>\\]|=>|\$\(/.test(inner) || /^\s*-/.test(inner) || /^\s*[\/.~]/.test(inner)) return false;
  const toks = inner.trim().split(/\s+/);
  if (toks.length < 2) return false;
  const words = toks.filter((t) => /^[A-Za-z][A-Za-z'’-]*[.,;:!?)]*$/.test(t));
  return words.length >= 2 && words.length >= 0.6 * toks.length;
}

function personRef(sent, skip) {
  PERSON_RE.lastIndex = 0;
  let pm;
  while ((pm = PERSON_RE.exec(sent))) {
    if (skip && skip(pm.index)) continue;
    const word = pm[1].toLowerCase();
    if (!PRONOUNS.has(word) && !pm[2]) {
      const rest = sent.slice(pm.index + pm[0].length);
      const nx = /^\s+([^\s]+)/.exec(rest);
      if (nx && /^[A-Za-z]/.test(nx[1])) {
        const w = nx[1].toLowerCase().replace(/[^a-z']+$/g, '');
        if (!FUNC_AFTER.has(w) && !/(s|ed|ing)$/.test(w)) continue;
      }
    }
    return true;
  }
  return false;
}

function speechHit(text) {
  const s = stripCodeSpans(text);
  const quotes = [];
  let m;
  const q1 = /"([^"\n]*)"/g;
  while ((m = q1.exec(s))) if (naturalQuote(m[1])) quotes.push([m.index, m.index + m[0].length]);
  const q2 = /“([^”\n]*)”/g;
  while ((m = q2.exec(s))) if (naturalQuote(m[1])) quotes.push([m.index, m.index + m[0].length]);
  const q3 = /‘((?:[^‘’\n]|(?<=\w)’(?=\w))*)’(?!\w)/g;
  while ((m = q3.exec(s))) if (naturalQuote(m[1])) quotes.push([m.index, m.index + m[0].length]);
  if (!quotes.length) return false;
  const inQuote = (i) => quotes.some(([a, b]) => i > a && i < b);
  const bounds = [0];
  const sb = /[.!?](?=\s+[A-Z"“(*`])/g;
  while ((m = sb.exec(s))) if (!inQuote(m.index)) bounds.push(m.index + 1);
  bounds.push(s.length);
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1];
    const qs = quotes.filter(([x, y]) => x >= a && y <= b + 1);
    if (!qs.length) continue;
    const sent = s.slice(a, b);
    if (NAMED_SRC_RE.test(sent)) return true;
    if (personRef(sent, (i) => inQuote(a + i))) return true;
  }
  return false;
}

const TZ = 'PDT|PST|EDT|EST|CDT|CST|MDT|MST|CEST|CET|BST|EEST|EET|JST|AEST|AEDT|IST|HST|AKST|AKDT|PT|ET|CT|MT';
const CLOCK_ZONE_RE = new RegExp('(?<![\\d:.])(?:[01]?\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:\\s?[AaPp][Mm])?\\s?\\(?\\s?(?:(?:' + TZ + ')(?![A-Za-z])|(?:UTC|GMT)\\s?[+\\-−]\\s?(\\d{1,2})(?::?([0-5]\\d))?(?!\\d))');
const CLOCK_OFFSET_RE = /(?<![\d:.])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?\s?[+\-−](\d{2})(:?)(\d{2})(?!\d)/g;
const CLOCK_ISO_T_RE = /(?<=\d)T(?:[01]\d|2[0-3]):[0-5]\d[+\-−](\d{2}):(\d{2})(?!\d)/g;
const CLOCK_ZONE_G = new RegExp(CLOCK_ZONE_RE.source, 'g');
function clockHit(line) {
  CLOCK_ZONE_G.lastIndex = 0;
  let z;
  while ((z = CLOCK_ZONE_G.exec(line))) {
    if (z[0].length === 0) { CLOCK_ZONE_G.lastIndex++; continue; }
    if (z[1] === undefined) return true;
    if (!/^0+$/.test(z[1] + (z[2] || ''))) return true;
  }
  CLOCK_ISO_T_RE.lastIndex = 0;
  let iso;
  while ((iso = CLOCK_ISO_T_RE.exec(line))) if (!/^0+$/.test(iso[1] + iso[2])) return true;
  CLOCK_OFFSET_RE.lastIndex = 0;
  let m;
  while ((m = CLOCK_OFFSET_RE.exec(line))) {
    const withSeconds = /:\d{2}:\d{2}/.test(m[0]) || !m[2];
    if (!withSeconds) continue;
    if (!/^0+$/.test(m[1] + m[3])) return true;
  }
  return false;
}

const DATE_RE = '\\d{4}-\\d{2}-\\d{2}';
const OPR_VERB = '(?:ruled|declared|directed|decided|ruling|rule|delegated|approved|authori[sz]ed)';
const PROV_A = new RegExp('\\boperator[\\s-]+' + OPR_VERB + '\\b[^\\n]{0,120}?' + DATE_RE, 'i');
const PROV_A2 = new RegExp(DATE_RE + '[^\\n]{0,60}?\\boperator[\\s-]+' + OPR_VERB + '\\b', 'i');
const PROV_B = new RegExp('\\((?:the )?operator,\\s*' + DATE_RE + '\\)', 'i');
const PROV_C = /\bper operator\b[^\n]{0,80}\bsign-?off\b/i;
const PROV_SRC = /(?:^|[\s(*_>#\/-])(?:Source|Lineage|Sources):\s*(.*)$/;
const PROV_PRIVATE = new RegExp('\\b(?:session|ruling|ruled|handoff|retro|beta|alex|alpha|oper' + 'ator|found' + 'er)\\b|[βα]|' + DATE_RE + '|\\b(?:L-\\d{4}|LRN-\\d{4}|ED-\\d{2,}|SP-\\d{6,}|PC-\\d{8}|RI-\\d{3}|P-\\d{3}|DP-gap)', 'i');
const CAL_DATE_RE = /(?<![\w./-])(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?![\w/]|\.\w)/;
const INSTANCE_ID_SRC = '(?:S-[A-Z]+-\\d{2,}|E-[A-Z]+(?:-[A-Z]+)*-\\d{2,}|SP-\\d{6,}(?:-\\d+)?|AP-\\d[\\w-]*|ED-\\d{2,}|LRN-\\d[\\w-]*|L-\\d{4}[\\w-]*|PC-\\d{8}(?:-\\d+)?|RI-\\d{3})';
const INSTANCE_ID_RE = new RegExp('(?<![\\w./-])' + INSTANCE_ID_SRC + '(?![\\w/])');
function personDatedHit(text) {
  const s = stripCodeSpans(text);
  if (!CAL_DATE_RE.test(s) && !INSTANCE_ID_RE.test(s)) return false;
  return personRef(s);
}
const PROV_D = /(?<![\w./@#$-])(?:operator|founder|ceo|owner|maintainer)(?:['’]s)?[\s-]+(?:policy|rule|ruling|directive|decision|intent|sign-?off|approval|preference|instruction|call)s?(?![\w/\\@-])/i;
function decisionHit(text) {
  const s = stripCodeSpans(text);
  return PROV_D.test(s) && (CAL_DATE_RE.test(s) || INSTANCE_ID_RE.test(s));
}
function provenanceHit(text, noPersonDated) {
  if (!noPersonDated && (personDatedHit(text) || decisionHit(text))) return true;
  if (PROV_A.test(text) || PROV_A2.test(text) || PROV_B.test(text) || PROV_C.test(text)) return true;
  const m = PROV_SRC.exec(text);
  return !!(m && PROV_PRIVATE.test(m[1]));
}

const FILE_EXT = 'md|js|cjs|mjs|ts|tsx|jsx|json|jsonl|ya?ml|ps1|sh|txt|html|css|py|toml|csv|png|svg';
const PATH_CAND_RE = new RegExp('(?<![\\w./@:~$%{<>*-])((?:[.\\w-]+/)+[\\w.-]*\\.(?:' + FILE_EXT + ')|[\\w-]+\\.(?:' + FILE_EXT + '))(?![\\w/-])', 'g');
const HEX_CAND_RE = /(?<![\w#.-])[0-9a-f]{7,40}(?![\w-])/g;
const ELIDED_HEX_RE = /(?<![\w#.-])(?=[0-9a-f]*\d)[0-9a-f]{6,40}(?:…|\.\.\.)(?=[0-9a-f]*\d)[0-9a-f]{6,40}(?![\w-])/;
const INSTANCE_DATE = /(?<!\d)(?:19|20)\d{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12]\d|3[01])(?!\d)/;
const INSTANCE_ID_SEG = new RegExp('(?<![A-Za-z0-9])' + INSTANCE_ID_SRC + '(?![A-Za-z0-9])');
function instanceFinal(seg) {
  const stem = seg.replace(/\.[^.]+$/, '');
  if (INSTANCE_DATE.test(stem) || INSTANCE_ID_SEG.test(stem)) return true;
  const runs = stem.match(/(?<![0-9a-f])[0-9a-f]{7,}(?![0-9a-f])/g) || [];
  if (runs.some((r) => /\d/.test(r) && /[a-f]/.test(r))) return true;
  return /\.md$/i.test(seg) && /^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+$/.test(stem);
}
const PLACEHOLDER_RE = /[<>{}*$%]|\.\.\.|YYYY|MMDD|NNN|XXX|\bxxx|^(?:foo|bar|baz|example|path|file|dir|name|x|y|z|abc|my-[\w-]*|your-[\w-]*)$/i;

function buildNarrativeContext(root, files, hasGit) {
  const tracked = new Set(files);
  const suffixes = new Set();
  const bases = new Set();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 0; i < parts.length; i++) suffixes.add(parts.slice(i).join('/'));
    bases.add(parts[parts.length - 1]);
  }
  const declared = new Set();
  const declaredDirs = [];
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'paths.json'), 'utf8').replace(/^﻿/, ''));
    for (const v of Object.values(reg)) {
      if (typeof v !== 'string' || !v || v.startsWith('/') || v.includes('..')) continue;
      const nv = v.replace(/\/+$/, '');
      declared.add(nv);
      if (!/\.[A-Za-z0-9]{1,6}$/.test(nv)) declaredDirs.push(nv + '/');
    }
  } catch (_) { }
  return { root, tracked, suffixes, bases, declared, declaredDirs, hasGit, commitCache: new Map() };
}

function resolveCommits(ctx, hexes) {
  const todo = hexes.filter((h) => !ctx.commitCache.has(h));
  if (!todo.length) return;
  if (!ctx.hasGit) { for (const h of todo) ctx.commitCache.set(h, false); return; }
  const r = spawnSync('git', ['-C', ctx.root, 'cat-file', '--batch-check'], {
    input: todo.map((h) => h + '^{commit}').join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 26, windowsHide: true,
  });
  if (r.error || r.status !== 0) throw new CannotRun('git cat-file failed');
  const outl = String(r.stdout).split('\n');
  todo.forEach((h, i) => ctx.commitCache.set(h, /^[0-9a-f]{40,64} commit \d+$/.test(outl[i] || '')));
}

function pathResolves(ctx, rel, cand) {
  let p = cand.replace(/^\.\//, '');
  if (ctx.declared.has(p) || ctx.declaredDirs.some((d) => p.startsWith(d))) return true;
  if (!p.includes('/')) return ctx.bases.has(p);
  if (ctx.tracked.has(p) || ctx.suffixes.has(p)) return true;
  const dir = path.posix.dirname(rel);
  if (ctx.tracked.has(path.posix.normalize(dir + '/' + p))) return true;
  return false;
}

function closureCandidates(region, rel, ctx) {
  const paths = [];
  let m;
  PATH_CAND_RE.lastIndex = 0;
  while ((m = PATH_CAND_RE.exec(region))) {
    const c = m[1].replace(/^\.\//, '');
    const segs = c.split('/');
    if (segs.some((sg) => PLACEHOLDER_RE.test(sg))) continue;
    if (/\.(?:com|org|io|ai|net|dev|app|co|gov|edu)$/i.test(segs[0])) continue;
    if (segs.includes('node_modules')) continue;
    if (/^paths\.\w+$/.test(segs[0])) continue;
    if (PLACEHOLDER_RE.test(segs[segs.length - 1].replace(/\.[^.]+$/, ''))) continue;
    if (segs.length === 1) { if (!/^[A-Z][A-Z0-9_-]*\.md$/.test(c)) continue; }
    else if (!instanceFinal(segs[segs.length - 1])) continue;
    paths.push(c);
  }
  const hexes = [];
  HEX_CAND_RE.lastIndex = 0;
  while ((m = HEX_CAND_RE.exec(region))) {
    if (/\d/.test(m[0]) && /[a-f]/.test(m[0])) hexes.push(m[0]);
  }
  return { paths, hexes, elided: ELIDED_HEX_RE.test(region) };
}

function paragraphs(rel, regions) {
  const ext = path.extname(rel).toLowerCase();
  const code = SLASH_EXT.has(ext) || HASH_EXT.has(ext);
  const out = [];
  let cur = null;
  for (const r of regions) {
    let t = r.text;
    if (code) t = t.replace(/^\s*(?:\/\/+|\/\*+|\*+\/?|#+)\s?/, ''); else t = t.trim();
    t = t.trim();
    const brk = !t || (!code && /^(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\|)/.test(t));
    if (!t) { cur = null; continue; }
    if (cur && !brk && r.n === cur.last + 1) { cur.pieces.push({ n: r.n, start: cur.text.length + 1 }); cur.text += ' ' + t; cur.last = r.n; continue; }
    cur = { text: t, pieces: [{ n: r.n, start: 0 }], last: r.n };
    out.push(cur);
    if (!code && /^(?:#{1,6}\s|\|)/.test(t)) cur = null;
  }
  return out;
}
function sentencesOf(para) {
  const s = para.text;
  const quotes = [];
  let m;
  const q = /"[^"]*"|“[^”]*”/g;
  while ((m = q.exec(s))) quotes.push([m.index, m.index + m[0].length]);
  const bounds = [0];
  const sb = /[.!?](?=\s+[A-Z"“(*\x60])/g;
  while ((m = sb.exec(s))) if (!quotes.some(([a, b]) => m.index > a && m.index < b)) bounds.push(m.index + 1);
  bounds.push(s.length);
  const res = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k], b = bounds[k + 1];
    const lines = para.pieces.filter((p, i) => { const end = i + 1 < para.pieces.length ? para.pieces[i + 1].start : s.length + 1; return p.start < b && end > a; }).map((p) => p.n);
    res.push({ text: s.slice(a, b), lines });
  }
  return res;
}

const NARR_CAP = 4000;
const NARR_WIN = 4000;
const NARR_OVERLAP = 1000;
function windowsOf(s) {
  if (s.length <= NARR_CAP) return [s];
  const out = [];
  for (let a = 0; ; a += NARR_WIN - NARR_OVERLAP) {
    out.push(s.slice(a, a + NARR_WIN));
    if (a + NARR_WIN >= s.length) break;
  }
  return out;
}

const identShaped = (v) => !/\s/.test(v.trim()) || /^[\w.\/\\:@~#-]+$/.test(v.trim());
const mkPara = (n, text) => ({ text, pieces: [{ n, start: 0 }], last: n });
function jsonStringTokens(text, baseLine) {
  const out = [];
  let line = baseLine;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c !== '"') { i++; continue; }
    const startLine = line;
    let j = i + 1;
    while (j < n && text[j] !== '"' && text[j] !== '\n') { if (text[j] === '\\' && j + 1 < n && text[j + 1] !== '\n') j++; j++; }
    let val;
    try { val = JSON.parse(text.slice(i, j + 1)); } catch (_) { val = text.slice(i + 1, j); }
    let k = j + 1;
    while (k < n && /\s/.test(text[k])) k++;
    if (text[k] !== ':') out.push({ n: startLine, text: String(val) });
    if (text[j] === '\n') line++;
    i = j + 1;
  }
  return out;
}
function csvCells(text) {
  const out = [];
  let line = 1, cellLine = 1, cur = '', inQ = false;
  const flush = () => { out.push({ n: cellLine, text: cur }); cur = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else { if (c === '\n') line++; cur += c; }
      continue;
    }
    if (c === '"' && cur === '') { inQ = true; continue; }
    if (c === ',' || c === ';' || c === '\t') { flush(); cellLine = line; continue; }
    if (c === '\r' && text[i + 1] === '\n') continue;
    if (c === '\n' || c === '\r') { flush(); line++; cellLine = line; continue; }
    cur += c;
  }
  if (inQ) return null;
  flush();
  return out;
}
const XML_ENT = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const unXml = (t) => t.replace(/&(?:lt|gt|quot|apos|amp);/g, (m) => XML_ENT[m]).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Math.min(+d, 0x10ffff)));
function svgTexts(text) {
  const out = [];
  const nl = [];
  for (let p = text.indexOf('\n'); p !== -1; p = text.indexOf('\n', p + 1)) nl.push(p);
  const lineAt = (idx) => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; } return lo + 1; };
  let m;
  const textRe = />([^<>]+)</g;
  while ((m = textRe.exec(text))) if (m[1].trim()) out.push({ n: lineAt(m.index + 1), text: unXml(m[1]) });
  const cmRe = /<!--([\s\S]*?)-->/g;
  while ((m = cmRe.exec(text))) out.push({ n: lineAt(m.index), text: unXml(m[1]) });
  const atRe = /\b(?:title|aria-label|alt|desc|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = atRe.exec(text))) out.push({ n: lineAt(m.index), text: unXml(m[1] !== undefined ? m[1] : m[2]) });
  return out;
}
function dataView(rel, text, lines) {
  const ext = path.extname(rel).toLowerCase();
  let units = null;
  if (ext === '.json' || ext === '.map') {
    try { JSON.parse(text.replace(/^﻿/, '')); units = jsonStringTokens(text, 1); } catch (_) { units = null; }
  } else if (ext === '.jsonl') {
    units = [];
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.trim()) continue;
      let ok = true;
      try { JSON.parse(ln.replace(/^﻿/, '')); } catch (_) { ok = false; }
      if (ok) { for (const t of jsonStringTokens(ln, i + 1)) units.push(t); } else units.push({ n: i + 1, text: ln, raw: true });
    }
  } else if (ext === '.csv') {
    units = csvCells(text);
  } else if (ext === '.svg') {
    units = svgTexts(text);
  }
  if (!units) {
    const regions = lines.map((ln, i) => ({ n: i + 1, text: ln }));
    return { regions, paras: paragraphs(rel, regions) };
  }
  const regions = [];
  const paras = [];
  for (const u of units) {
    if (!u.raw && identShaped(u.text)) continue;
    const t = u.text.replace(/\r\n|\r|\n/g, ' ');
    regions.push({ n: u.n, text: t });
    paras.push(mkPara(u.n, t));
  }
  return { regions, paras };
}

const lineSha = (ln) => sha256(Buffer.from(ln.replace(/\r$/, ''), 'utf8'));

function scanNarrative(rel, text, ctx, opts) {
  const noClosure = !!(opts && opts.noClosure);
  const lines = text.split(/\r\n|\r|\n/);
  const hits = [];
  const add = (check, n) => hits.push({ check, line: n });
  lines.forEach((ln, i) => {
    for (const w of windowsOf(ln)) if (clockHit(w)) { add('narrative-clock', i + 1); break; }
    if (i + 1 < lines.length && /\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?\s*$/.test(ln.slice(-60)) && clockHit(ln.slice(-60) + ' ' + lines[i + 1].slice(0, 60))) add('narrative-clock', i + 1);
  });
  const isData = DATA_EXT.has(path.extname(rel).toLowerCase());
  let regions;
  let paras;
  if (isData) {
    const dv = dataView(rel, text, lines);
    regions = dv.regions;
    paras = dv.paras;
  } else {
    regions = proseRegions(rel, lines);
    paras = paragraphs(rel, regions);
  }
  const pending = [];
  for (const para of paras) {
    for (const sn of sentencesOf(para)) {
      for (const w of windowsOf(sn.text)) {
        if (speechHit(w)) for (const n of sn.lines) add('narrative-speech', n);
        if (provenanceHit(w)) for (const n of sn.lines) add('narrative-provenance', n);
      }
    }
  }
  if (path.extname(rel).toLowerCase() === '.yml' || path.extname(rel).toLowerCase() === '.yaml') {
    for (const u of yamlValues(lines)) {
      if (identShaped(u.text)) continue;
      const para = mkPara(u.n, u.text);
      for (const sn of sentencesOf(para)) {
        for (const w of windowsOf(sn.text)) {
          if (speechHit(w)) add('narrative-speech', u.n);
          if (provenanceHit(w)) add('narrative-provenance', u.n);
        }
      }
      for (const w of windowsOf(u.text)) {
        if (speechHit(w)) add('narrative-speech', u.n);
        if (provenanceHit(w, true)) add('narrative-provenance', u.n);
      }
    }
  }
  for (const r of regions) {
    for (const w of windowsOf(r.text)) {
      if (speechHit(w)) add('narrative-speech', r.n);
      if (provenanceHit(w, true)) add('narrative-provenance', r.n);
    }
    if (isData || noClosure) continue;
    if (r.text.length > NARR_CAP) continue;
    const c = closureCandidates(r.text, rel, ctx);
    if (c.elided || c.paths.some((p) => !pathResolves(ctx, rel, p))) add('narrative-closure', r.n);
    if (c.hexes.length) pending.push({ n: r.n, hexes: c.hexes });
  }
  const allHex = [];
  for (const p of pending) for (const h of p.hexes) allHex.push(h);
  resolveCommits(ctx, Array.from(new Set(allHex)));
  for (const p of pending) if (p.hexes.some((h) => !ctx.commitCache.get(h))) add('narrative-closure', p.n);
  const seen = new Set();
  const uniq = hits.filter((h) => { const k = h.check + ':' + h.line; if (seen.has(k)) return false; seen.add(k); return true; });
  return { hits: uniq, lines, evaluated: { 'narrative-speech': true, 'narrative-clock': true, 'narrative-provenance': true, 'narrative-closure': !isData && !noClosure } };
}

function loadNarrativeAllowlist(file) {
  if (!fs.existsSync(file)) return { entries: [], present: false };
  const doc = (() => { try { return JSON.parse(readText(file, 'narrative allowlist').replace(/^﻿/, '')); } catch (e) { if (e instanceof CannotRun) throw e; throw new CannotRun('narrative allowlist is not valid JSON'); } })();
  const list = Array.isArray(doc) ? doc : (doc && doc.schema === 'mc/npc-narrative-allowlist/v1' && Array.isArray(doc.entries) ? doc.entries : null);
  if (!list) throw new CannotRun('narrative allowlist invalid');
  const entries = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.path !== 'string' || !e.path || e.path.startsWith('/') || e.path.split(/[\\/]/).includes('..')) throw new CannotRun('narrative allowlist invalid entry');
    if (typeof e.line_sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(e.line_sha256)) throw new CannotRun('narrative allowlist invalid entry');
    if (typeof e.reason !== 'string' || !e.reason.trim()) throw new CannotRun('narrative allowlist entry has no reason');
    let count = 1;
    if (e.count !== undefined) {
      if (!Number.isInteger(e.count) || e.count < 1) throw new CannotRun('narrative allowlist entry has an invalid count');
      count = e.count;
    }
    let members;
    if (e.kind === 'citation') {
      if (typeof e.name !== 'string' || !e.name.trim() || typeof e.work !== 'string' || !e.work.trim()) throw new CannotRun('narrative allowlist citation needs name and work');
      members = ['narrative-speech', 'narrative-provenance'];
    } else {
      const mem = NARR_SHORT[e.member] || e.member;
      if (!NARR_CHECKS.includes(mem)) throw new CannotRun('narrative allowlist entry has an unknown member');
      members = [mem];
    }
    for (const m of members) entries.push({ path: e.path, member: m, sha: e.line_sha256.toLowerCase(), count, citation: e.kind === 'citation' ? e.name.trim() : null });
  }
  return { entries, present: true };
}

function run(opts) {
  try {
    return runInner(opts || {});
  } catch (e) {
    const msg = e instanceof CannotRun ? e.message : 'internal error: ' + (e && e.code ? e.code : 'exception');
    return { ok: false, exit: 2, checks_run: [], scanned: {}, files_scanned: 0, violations: [], error: msg };
  }
}

function runInner(opts) {
  if (!opts.root || typeof opts.root !== 'string') throw new CannotRun('--root required');
  const root = path.resolve(opts.root);
  let st;
  try { st = fs.statSync(root); } catch (_) { throw new CannotRun('root not found'); }
  if (!st.isDirectory()) throw new CannotRun('root is not a directory');

  const fp = loadFingerprints(opts, opts.env);

  const alPath = path.join(root, 'ci', 'public-allowlist.txt');
  const allowed = new Set(parseList(readText(alPath, 'allowlist')));
  if (allowed.size === 0) throw new CannotRun('allowlist empty');

  const seedPath = path.join(root, 'ci', 'seeds.json');
  let seedsDoc;
  try { seedsDoc = JSON.parse(readText(seedPath, 'seeds').replace(/^﻿/, '')); } catch (e) {
    if (e instanceof CannotRun) throw e;
    throw new CannotRun('seeds are not valid JSON');
  }
  if (!seedsDoc || seedsDoc.schema !== 'mc/npc-seeds/v1' || !seedsDoc.seeds || typeof seedsDoc.seeds !== 'object' || Array.isArray(seedsDoc.seeds)) {
    throw new CannotRun('seeds invalid');
  }
  for (const [p, h] of Object.entries(seedsDoc.seeds)) {
    if (typeof h !== 'string' || !/^[0-9a-f]{64}$/i.test(h) || p.startsWith('/') || p.split(/[\\/]/).includes('..')) {
      throw new CannotRun('seeds invalid entry');
    }
  }

  const counts = {};
  const narrAllow = loadNarrativeAllowlist(opts.narrativeAllowlist ? path.resolve(opts.narrativeAllowlist) : path.join(root, 'ci', 'narrative-allowlist.json'));
  const narrAllowed = new Set(narrAllow.entries.map((e) => e.member + '\0' + e.path + '\0' + e.sha));

  if (!selfTest(fp)) throw new CannotRun('control self-test failed (matchers did not hit the controls)');

  let history = null;
  let tags = [];
  if (opts.history) {
    if (!fs.existsSync(path.join(root, '.git'))) throw new CannotRun('--history needs a git repository');
    if (git(root, ['rev-parse', '--is-shallow-repository']).toString().trim() !== 'false') {
      throw new CannotRun('--history on a shallow clone');
    }
    history = git(root, ['rev-list', '--all']).toString('utf8').split('\n').map((x) => x.trim()).filter(Boolean);
    if (history.length === 0) throw new CannotRun('--history found no commits');
    const refOut = git(root, ['for-each-ref', '--format=%(objectname) %(objecttype) %(refname)']).toString('utf8');
    const tagRefs = [];
    for (const l of refOut.split('\n')) {
      const m = /^([0-9a-f]{40,64}) (\S+) (.*)$/.exec(l);
      if (m) tagRefs.push({ id: m[1], type: m[2], ref: m[3] });
    }
    tags = tagRefs;
  }

  const files = fileSet(root);
  {
    const trackedSet = new Set(files);
    for (const e of narrAllow.entries) {
      const p = e.path;
      if (/[*?[\]{}]/.test(p) || p.endsWith('/') || p.includes('\\') || path.posix.normalize(p) !== p || !trackedSet.has(p)) {
        throw new CannotRun('narrative allowlist entry is not an exact tracked file path');
      }
    }
    const lineCache = new Map();
    for (const e of narrAllow.entries) {
      let shas = lineCache.get(e.path);
      if (!shas) {
        let buf;
        try { buf = fs.readFileSync(path.join(root, e.path)); } catch (_) { throw new CannotRun('narrative allowlist entry file unreadable'); }
        shas = utf8OrLatin1(buf).split(/\r\n|\r|\n/).map((ln) => ({ sha: lineSha(ln), ln }));
        lineCache.set(e.path, shas);
      }
      const hit = shas.filter((x) => x.sha === e.sha);
      if (hit.length !== e.count) throw new CannotRun('narrative allowlist entry matches ' + hit.length + ' line(s), declared ' + e.count + ' (stale or unbound)');
      if (e.citation && !hit.every((x) => x.ln.toLowerCase().includes(e.citation.toLowerCase()))) throw new CannotRun('narrative allowlist citation line does not carry its declared name');
    }
  }
  let untracked = new Set();
  if (fs.existsSync(path.join(root, '.git'))) {
    const others = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).toString('utf8').split('\0').filter(Boolean);
    untracked = new Set(others);
    for (const o of others) files.push(o);
  }
  if (files.length === 0) throw new CannotRun('empty file set');

  const redactMap = new Map();
  const redactSeg = (seg) => {
    if (!scanText(seg, fp).length) return seg;
    if (!redactMap.has(seg)) redactMap.set(seg, redactMap.size + 1);
    return '<redacted:#' + redactMap.get(seg) + '>';
  };
  const redact = (p) => p.split('/').map(redactSeg).join('/');

  const violations = [];
  const vseen = new Set();
  const add = (check, p, line) => {
    const rp = redact(p);
    const k = check + '\0' + rp + '\0' + line;
    if (vseen.has(k)) return;
    vseen.add(k);
    violations.push({ check, path: rp, line });
  };

  const reportOnly = [];
  const roSeen = new Set();
  const addReportOnly = (check, p, line) => {
    const rp = redact(p);
    const k = check + '\0' + rp + '\0' + line;
    if (roSeen.has(k)) return;
    roSeen.add(k);
    reportOnly.push({ check, path: rp, line });
  };

  const hasGit = fs.existsSync(path.join(root, '.git'));
  const nctx = buildNarrativeContext(root, files, hasGit);
  const lowerSeen = new Map();
  const present = new Set();
  let processed = 0;
  for (const rel of files) {
    processed++;
    const abs = path.join(root, rel);
    const lc = rel.toLowerCase();
    if (lowerSeen.has(lc)) { add('filetype', rel, 0); add('filetype', lowerSeen.get(lc), 0); } else lowerSeen.set(lc, rel);

    let ls;
    try { ls = fs.lstatSync(abs); } catch (_) { add('allowlist', rel, 0); continue; }
    present.add(rel);

    if (!allowed.has(rel) || untracked.has(rel)) add('allowlist', rel, 0);

    for (const h of scanText(rel, fp)) add(h.check, rel, 0);

    if (ls.isSymbolicLink() || !ls.isFile()) { add('filetype', rel, 0); continue; }

    const buf = fs.readFileSync(abs);
    const an = analyzeBlob(buf, [rel], fp);
    if (an.filetype) add('filetype', rel, 0);
    if (an.pngName) add('name', rel, 0);
    for (const text of an.texts) for (const h of scanText(text, fp, counts)) add(h.check, rel, h.line);
    if (!an.binary && !an.filetype && an.texts.length === 1) {
      const nr = scanNarrative(rel, an.texts[0], nctx);
      for (const c of NARR_CHECKS) if (nr.evaluated[c]) counts[c] = (counts[c] || 0) + 1;
      for (const h of nr.hits) {
        if (narrAllowed.has(h.check + '\0' + rel + '\0' + lineSha(nr.lines[h.line - 1] || ''))) continue;
        if (REPORT_ONLY.has(h.check)) addReportOnly(h.check, rel, h.line); else add(h.check, rel, h.line);
      }
    }
  }

  for (const a of allowed) if (!present.has(a)) add('allowlist', a, 0);

  for (const [p, h] of Object.entries(seedsDoc.seeds)) {
    const abs = path.join(root, p);
    let ls = null;
    try { ls = fs.lstatSync(abs); } catch (_) { }
    if (!ls) continue;
    if (!ls.isFile() || sha256(fs.readFileSync(abs)) !== h.toLowerCase()) add('seed', p, 0);
  }

  const checks = CHECKS_BASE.concat(NARR_CHECKS);
  if (history) {
    checks.push('history');
    const BOT_NAME = 'Master Console';
    const BOT_EMAIL = ['noreply', 'masterconsole.invalid'].join('@');
    const identity = (where, name, email) => {
      const n = String(name || '').trim();
      const e = String(email || '').trim().replace(/^<|>$/g, '');
      if (n !== BOT_NAME || e !== BOT_EMAIL) add('history', where, 0);
      for (const h of scanText(n + '\n' + e, fp)) add(h.check, where, 0);
    };
    const checkIdentities = (where, headerLines) => {
      let na = 0, nc = 0;
      for (const l of headerLines) {
        const m = /^(author|committer|tagger) (.*) <([^<>]*)> \d+ [+-]\d{4}$/.exec(l);
        if (/^(author|committer|tagger) /.test(l)) {
          if (!m) { add('history', where, 0); continue; }
          if (m[1] === 'author') na++;
          if (m[1] === 'committer') nc++;
          identity(where, m[2], m[3]);
        }
      }
      return [na, nc];
    };
    const headerOf = (buf) => {
      const nn = buf.indexOf('\n\n');
      const head = nn < 0 ? buf : buf.subarray(0, nn);
      const body = nn < 0 ? Buffer.alloc(0) : buf.subarray(nn + 2);
      const lines = [];
      for (const l of utf8OrLatin1(head).split('\n')) {
        if (l.startsWith(' ') && lines.length) lines[lines.length - 1] += '\n' + l;
        else lines.push(l);
      }
      return { lines, body: utf8OrLatin1(body), headText: utf8OrLatin1(head) };
    };

    const histNarr = (rel, text, rels) => {
      const nr = scanNarrative(rel, text, nctx, { noClosure: true });
      for (const h of nr.hits) {
        const sh = lineSha(nr.lines[h.line - 1] || '');
        if (rels.some((r) => narrAllowed.has(h.check + '\0' + r + '\0' + sh))) continue;
        add(h.check, rel, h.line);
      }
    };
    const tagObjIds = tags.filter((t) => t.type === 'tag').map((t) => t.id);
    const seenObj = new Set();
    const queue = history.concat(tagObjIds);
    const extraTreeish = [];
    while (queue.length) {
      const batchIds = queue.splice(0).filter((x) => !seenObj.has(x));
      batchIds.forEach((x) => seenObj.add(x));
      if (!batchIds.length) break;
      for (const o of catBatch(root, batchIds)) {
        const where = (o.type === 'tag' ? 'tag:' : 'commit:') + o.id.slice(0, 12);
        if (o.type === 'commit') {
          const { lines, body, headText } = headerOf(o.data);
          const [na, nc] = checkIdentities(where, lines);
          if (na !== 1 || nc !== 1) add('history', where, 0);
          for (const h of scanText(headText, fp)) add(h.check, where, 0);
          for (const h of scanText(body, fp, counts)) add(h.check, where, h.line);
          histNarr(where, body, [where]);
        } else if (o.type === 'tag') {
          const { lines, body, headText } = headerOf(o.data);
          checkIdentities(where, lines);
          for (const h of scanText(headText, fp)) add(h.check, where, 0);
          for (const h of scanText(body, fp, counts)) add(h.check, where, h.line);
          histNarr(where, body, [where]);
          const tgt = lines.map((l) => /^object ([0-9a-f]{40,64})$/.exec(l)).find(Boolean);
          const tt = lines.map((l) => /^type (\S+)$/.exec(l)).find(Boolean);
          if (tgt && tt) {
            if (tt[1] === 'tag') queue.push(tgt[1]);
            else if (tt[1] === 'commit') { queue.push(tgt[1]); extraTreeish.push({ id: tgt[1], type: 'commit' }); }
            else if (tt[1] === 'tree' || tt[1] === 'blob') extraTreeish.push({ id: tgt[1], type: tt[1] });
          }
        } else {
          add('history', where, 0);
        }
      }
    }
    for (const t of tags) {
      const w = (t.ref.startsWith('refs/tags/') ? 'tag:' : 'ref:') + t.id.slice(0, 12);
      for (const h of scanText(t.ref, fp)) add(h.check, w, 0);
    }
    for (const t of tags) {
      if (t.type === 'blob' || t.type === 'tree') extraTreeish.push({ id: t.id, type: t.type });
      else if (t.type === 'commit') extraTreeish.push({ id: t.id, type: 'commit' });
    }

    const blobPaths = new Map();
    const allPaths = new Set();
    const listTree = (id) => {
      const out = git(root, ['ls-tree', '-r', '-z', '--full-tree', id]).toString('latin1');
      for (const ent of out.split('\0')) {
        const m = /^(\d+) (\w+) ([0-9a-f]{40,64})\t([\s\S]*)$/.exec(ent);
        if (!m || m[2] !== 'blob') continue;
        const p = Buffer.from(m[4], 'latin1').toString('utf8');
        allPaths.add(p);
        if (!blobPaths.has(m[3])) blobPaths.set(m[3], new Set());
        blobPaths.get(m[3]).add(p);
      }
    };
    const listed = new Set();
    for (const id of history) if (!listed.has(id)) { listed.add(id); listTree(id); }
    for (const x of extraTreeish) {
      if (x.type === 'tree' || x.type === 'commit') { if (!listed.has(x.id)) { listed.add(x.id); listTree(x.id); } }
      else {
        const p = 'blob:' + x.id.slice(0, 12);
        if (!blobPaths.has(x.id)) blobPaths.set(x.id, new Set());
        blobPaths.get(x.id).add(p);
      }
    }
    for (const p of allPaths) {
      for (const h of scanText(p, fp)) add(h.check, p, 0);
    }
    const blobIds = Array.from(blobPaths.keys());
    for (let i = 0; i < blobIds.length; i += 200) {
      for (const o of catBatch(root, blobIds.slice(i, i + 200))) {
        const rels = Array.from(blobPaths.get(o.id));
        const rel = rels[0];
        const an = analyzeBlob(o.data, rels, fp);
        if (an.filetype) add('filetype', rel, 0);
        if (an.pngName) add('name', rel, 0);
        for (const text of an.texts) for (const h of scanText(text, fp, counts)) add(h.check, rel, h.line);
        if (!an.binary && !an.filetype && an.texts.length === 1) histNarr(rel, an.texts[0], rels);
      }
    }
  }

  if (fs.existsSync(path.join(root, '.git'))) {
    const tracked = git(root, ['ls-files', '-z']).toString('utf8').split('\0').filter(Boolean).length;
    if (tracked + untracked.size !== processed) throw new CannotRun('files scanned does not match tracked file count');
  }
  const scanned = {};
  for (const c of checks) {
    if (CONTENT_CHECKS.includes(c) || NARR_CHECKS.includes(c)) scanned[c] = counts[c] || 0;
    else if (c === 'seed') scanned[c] = Object.keys(seedsDoc.seeds).length;
    else if (c === 'history') scanned[c] = history.length;
    else scanned[c] = processed;
  }
  for (const c of CONTENT_CHECKS.concat(NARR_CHECKS)) if (!scanned[c]) throw new CannotRun('scanner examined no text: ' + c);

  const ok = violations.length === 0;
  const rep = { ok, exit: ok ? 0 : 1, checks_run: checks, scanned, files_scanned: processed, violations, report_only: reportOnly };
  if (history) rep.history_narrative = NARR_CHECKS.filter((c) => !REPORT_ONLY.has(c));
  return rep;
}

function parseArgs(argv) {
  const o = {};
  const need = (i) => {
    if (i + 1 >= argv.length) throw new CannotRun('missing value for ' + argv[i]);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') { o.root = need(i); i++; }
    else if (a === '--fingerprints') { o.fingerprints = need(i); i++; }
    else if (a === '--narrative-allowlist') { o.narrativeAllowlist = need(i); i++; }
    else if (a === '--history') o.history = true;
    else if (a === '--json') o.json = true;
    else throw new CannotRun('unknown argument');
  }
  return o;
}

function main(argv) {
  let opts = {};
  let report;
  try {
    opts = parseArgs(argv);
    report = run(opts);
  } catch (e) {
    report = { ok: false, exit: 2, checks_run: [], scanned: {}, files_scanned: 0, violations: [], error: e instanceof CannotRun ? e.message : 'internal error' };
  }
  if (opts.json) {
    process.stdout.write(JSON.stringify(report) + '\n');
  } else {
    for (const v of report.violations) process.stdout.write('[' + v.check + '] ' + v.path + ':' + v.line + '\n');
    for (const v of report.report_only || []) process.stdout.write('[' + v.check + '] ' + v.path + ':' + v.line + ' REPORT-ONLY\n');
    if (report.exit === 2) process.stdout.write('CANNOT RUN: ' + report.error + '\n');
    process.stdout.write(
      'no-personal-content: ' + (report.exit === 0 ? 'PASS' : report.exit === 1 ? 'FAIL' : 'CANNOT-RUN') +
        ' (' + report.violations.length + ' violation(s), ' + (report.report_only || []).length + ' report-only, ' + report.files_scanned + ' file(s))\n'
    );
  }
  return report.exit;
}

module.exports = { canonText, tokens, loadFingerprints, scanText, run, selfTest, NARR_CHECKS, scanNarrative, buildNarrativeContext, loadNarrativeAllowlist, lineSha };

if (require.main === module) {
  let code = 2;
  try { code = main(process.argv.slice(2)); } catch (_) { code = 2; }
  process.exitCode = code;
}
