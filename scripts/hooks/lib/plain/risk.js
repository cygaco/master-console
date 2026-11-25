'use strict';

const DENY_WORDS = [
  'delete', 'deletion', 'destroy', 'drop', 'wipe', 'purge', 'erase',
  'spend', 'purchase', 'buy', 'pay', 'payment', 'charge', 'refund', 'invoice', 'billing', 'subscribe', 'subscription',
  'deploy', 'deployment',
];
const IRREGULAR = { pay: ['paid'], buy: ['bought'], spend: ['spent'] };

const FLAG_KEYS = ['confirm-first', 'ask-first', 'disable-model-invocation'];

function inflections(w) {
  const out = new Set([w, `${w}s`, `${w}es`, `${w}ed`, `${w}d`, `${w}ing`]);
  if (w.endsWith('e')) out.add(`${w.slice(0, -1)}ing`);
  if (/[^aeiou][aeiou][bdgmnprt]$/.test(w)) { const d = w + w.slice(-1); out.add(`${d}ed`); out.add(`${d}ing`); out.add(`${d}er`); }
  for (const x of IRREGULAR[w] || []) out.add(x);
  return [...out];
}

const DENY_FORMS = new Set(DENY_WORDS.flatMap(inflections));

function tokens(text) {
  return String(text == null ? '' : text)
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function denyWordsIn(text) {
  const hit = [];
  for (const t of tokens(text)) if (DENY_FORMS.has(t) && !hit.includes(t)) hit.push(t);
  return hit;
}

const FALSE_VALUE = /^(false|no|off|0|null|~)$/i;
function flagValueSet(v) {
  let s = String(v == null ? '' : v).trim();
  s = s.replace(/\s+#.*$/, '').trim();
  if (/^(["']).*\1$/.test(s)) s = s.slice(1, -1).trim();
  return !FALSE_VALUE.test(s);
}

const flagsIn = (fm) => FLAG_KEYS.filter((k) => fm && Object.prototype.hasOwnProperty.call(fm, k) && flagValueSet(fm[k]));

function flagLinesIn(lines) {
  const out = [];
  for (const line of lines || []) {
    const kv = String(line).match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv && FLAG_KEYS.includes(kv[1].toLowerCase()) && flagValueSet(kv[2]) && !out.includes(kv[1].toLowerCase())) out.push(kv[1].toLowerCase());
  }
  return out;
}

function denyClass({ names = [], description = '', whenToUse = '', fm = {}, flagged = [] } = {}) {
  const flags = [...new Set([...(flagged || []), ...flagsIn(fm)])];
  if (flags.length) return { kind: 'flag', flag: flags[0] };
  const words = denyWordsIn([...names, description, whenToUse].join(' '));
  if (words.length) return { kind: 'word', word: words[0] };
  return null;
}

module.exports = {
  DENY_WORDS, FLAG_KEYS, IRREGULAR, DENY_FORMS,
  inflections, tokens, denyWordsIn, flagValueSet, flagsIn, flagLinesIn, denyClass,
};
