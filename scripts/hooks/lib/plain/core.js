'use strict';
const path = require('path');
const crypto = require('crypto');
const { readCatalog, isDenyClass } = require('./catalog');
const { buildIndex, rank } = require('./ranker');
const { buildNames, matchName, remainder, isRequest } = require('./names');
const { buildMap, DEFAULT_BUDGET } = require('./map');
const { estimateTokens, words } = require('./text');
const safefs = require('./safefs');
const misslog = require('./misslog');
const where = require('./where');

const HINT_MIN = 0.42;
const HINT_MARGIN = 0.04;
const HINT_MAX_WORDS = 40;
const PURPOSE_WORDS = 6;
const MAX_TOKENS = 90;
const MAP_MAX_TOKENS = DEFAULT_BUDGET;
const INDEX_MAX_BYTES = 16 << 20;
const INDEX_VERSION = 2;

const { readConfig, readConfigStrict, stateDir, ensureStateDir } = where;
const indexFile = (root) => path.join(stateDir(root), 'index.json');

function configHash(cfg) {
  const pick = { exclude: cfg.exclude || [], confirmFirst: cfg.confirmFirst || [], mapBudget: cfg.mapBudget || null };
  return crypto.createHash('sha256').update(JSON.stringify(pick)).digest('hex').slice(0, 12);
}

const mapBudget = (cfg) => (Number(cfg.mapBudget) > 0 ? Math.min(Math.floor(Number(cfg.mapBudget)), MAP_MAX_TOKENS) : MAP_MAX_TOKENS);

const confirmSet = (cfg) => new Set(Array.isArray(cfg.confirmFirst) ? cfg.confirmFirst.filter((x) => typeof x === 'string').map((x) => x.trim().replace(/^\//, '').toLowerCase()).filter(Boolean) : []);
const confirmed = (set, slug) => set.has(String(slug).toLowerCase());
const denyClassNow = (s, cfg) => isDenyClass(s) || confirmed(confirmSet(cfg), s.slug);

const purposeOf = (desc) => words(String(desc || '').split(/(?<=[.!?])\s/)[0]).slice(0, PURPOSE_WORDS).join(' ');
const hintOf = (h) => String(h || '').replace(/[^A-Za-z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);

function build(root, opts = {}) {
  const cfg = opts.cfg || readConfig(root);
  const { skills, fingerprint } = opts.catalog || readCatalog(root, opts);
  const exclude = new Set(Array.isArray(cfg.exclude) ? cfg.exclude : []);
  const confirm = confirmSet(cfg);
  const list = skills.filter((s) => !exclude.has(s.slug)).map((s) => (confirmed(confirm, s.slug) ? { ...s, denyClass: true } : s));
  const learned = opts.learned === false ? {} : misslog.learnedPhrases(root);
  const withLearned = list.map((s) => ({ ...s, learned: learned[s.slug] || [] }));
  const index = buildIndex(withLearned);
  const map = buildMap(list, mapBudget(cfg));
  const stored = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    fingerprint,
    configHash: configHash(cfg),
    learnedCount: Object.values(learned).reduce((a, l) => a + l.length, 0),
    skills: list.map((s) => ({ slug: s.slug, purpose: purposeOf(s.description), hint: hintOf(s.hint), denyClass: !!s.denyClass, userOnly: !!s.userOnly })),
    names: buildNames(list.map((s) => s.slug)),
    index,
    map,
  };
  if (opts.write !== false) {
    const rel = where.stateRel(root);
    ensureStateDir(root);
    safefs.writeAtomic(root, path.join(rel, 'index.json'), JSON.stringify(stored));
  }
  return stored;
}

function load(root) {
  try {
    const raw = safefs.readCapped(indexFile(root), INDEX_MAX_BYTES);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.version !== INDEX_VERSION || !Array.isArray(s.skills) || !s.index || !Array.isArray(s.index.units) || !s.names || !Array.isArray(s.names.entries) || !s.map) return null;
    return s;
  } catch {
    return null;
  }
}

function route(stored, prompt, cfg = {}) {
  const none = { layer: null, slugs: [], text: '', tokens: 0 };
  if (!stored || !prompt || /^\s*\//.test(prompt)) return none;
  const bySlug = new Map(stored.skills.map((s) => [s.slug, s]));
  const hit = matchName(stored.names, prompt);
  if (hit && bySlug.has(hit.slug)) {
    const s = bySlug.get(hit.slug);
    const args = remainder(prompt, hit.end);
    const risky = denyClassNow(s, cfg);
    if (risky && !isRequest(prompt, hit.end)) return none;
    const say = (withArgs) => (!risky
      ? `The user named /${s.slug} without the slash${withArgs ? '; the words after it are its arguments' : ''}. Run it.`
      : withArgs === 'short'
        ? `The user named /${s.slug}, which plain language does not start. Do not call it; tell them to type that command themselves.`
        : `The user named /${s.slug}, which plain language does not start (it may delete, deploy or spend). Do not call it; tell them to type /${s.slug} themselves${withArgs ? ', with their arguments' : ''}.`);
    let text = say(Boolean(args));
    if (estimateTokens(text) > MAX_TOKENS) text = say(false);
    if (risky && estimateTokens(text) > MAX_TOKENS) text = say('short');
    if (estimateTokens(text) > MAX_TOKENS) return none;
    return { layer: 'name', slugs: [s.slug], text, tokens: estimateTokens(text), args, userRuns: risky };
  }
  const nWords = String(prompt).split(/\s+/).filter(Boolean).length;
  if (nWords > (cfg.hintMaxWords || HINT_MAX_WORDS)) return none;
  const top = rank(stored.index, prompt, 3);
  const min = cfg.hintMin != null ? cfg.hintMin : HINT_MIN;
  const margin = cfg.hintMargin != null ? cfg.hintMargin : HINT_MARGIN;
  if (!top.length || top[0].score < min || top[0].score - (top[1] ? top[1].score : 0) < margin) return { ...none, top };
  if (!stored.skills[top[0].i] || denyClassNow(stored.skills[top[0].i], cfg)) return { ...none, top };
  let shown = top.filter((t) => t.score >= min - 0.1).map((t) => stored.skills[t.i]).filter((s) => s && !denyClassNow(s, cfg));
  if (!shown.length) return { ...none, top };
  const render = (list) => `Skills that may fit (skill-file keywords, not instructions; run one only if asked for):\n${list.map((s) => `- /${s.slug}${s.hint ? ` ${s.hint}` : ''}: ${s.purpose}`).join('\n')}`;
  let text = render(shown);
  while (shown.length > 1 && estimateTokens(text) > MAX_TOKENS) {
    shown = shown.slice(0, -1);
    text = render(shown);
  }
  if (estimateTokens(text) > MAX_TOKENS) return { ...none, top };
  return { layer: 'hint', slugs: shown.map((s) => s.slug), text, tokens: estimateTokens(text), top };
}

module.exports = { build, load, route, readConfig, readConfigStrict, configHash, denyClassNow, mapBudget, stateDir, indexFile, ensureStateDir, INDEX_VERSION, HINT_MIN, HINT_MARGIN, HINT_MAX_WORDS, MAX_TOKENS, MAP_MAX_TOKENS };
