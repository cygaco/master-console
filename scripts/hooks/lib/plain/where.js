'use strict';
const fs = require('fs');
const path = require('path');
const safefs = require('./safefs');

const STATE_KEY = 'plainState';
const MANIFEST_KEY = 'manifest';
const VIEW_MAX_BYTES = 1 << 20;
const MANIFEST_MAX_BYTES = 1 << 20;

const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

function cleanRel(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const rel = v.trim().replace(/\\/g, '/');
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) return null;
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p === '.')) return null;
  return parts.join('/');
}

function fromGenerated(key) {
  try {
    const gen = require('../paths.generated');
    if (!gen || !gen.PATHS || typeof gen.PATHS[key] !== 'string') return null;
    return cleanRel(path.relative(gen.PROJECT, gen.PATHS[key]));
  } catch {
    return null;
  }
}

function relFor(root, key) {
  try {
    const raw = safefs.readCapped(path.join(root, '.claude', 'paths.json'), VIEW_MAX_BYTES);
    if (raw != null) {
      const view = JSON.parse(stripBom(raw));
      const rel = view && typeof view === 'object' ? cleanRel(view[key]) : null;
      if (rel) return rel;
    }
  } catch {
  }
  return fromGenerated(key);
}

function stateRel(root) {
  const rel = relFor(root, STATE_KEY);
  if (!rel) throw new Error(`no ${STATE_KEY} path in the paths registry`);
  return rel;
}

const stateDir = (root) => path.join(root, stateRel(root));

function ensureStateDir(root) {
  const rel = stateRel(root);
  safefs.ensureDir(root, rel);
  const gi = path.join(rel, '.gitignore');
  if (!fs.existsSync(path.join(root, gi))) safefs.writeAtomic(root, gi, '*\n');
  return path.join(root, rel);
}

function readConfigStrict(root) {
  const rel = relFor(root, MANIFEST_KEY);
  if (!rel) return {};
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return {};
  const raw = safefs.readCapped(file, MANIFEST_MAX_BYTES);
  if (raw == null) throw new Error('the manifest is too large, a link, or not a regular file');
  const j = JSON.parse(stripBom(raw));
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('the manifest is not a JSON object');
  const block = j.mc && typeof j.mc === 'object' ? j.mc.plain : undefined;
  if (block === undefined || block === null) return {};
  if (typeof block !== 'object' || Array.isArray(block)) throw new Error('mc.plain is not an object');
  return block;
}

function readConfig(root) {
  try {
    return readConfigStrict(root);
  } catch {
    return {};
  }
}

function envOff() {
  try {
    const v = require('../mc-env').readEnv('PLAIN_OFF');
    return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());
  } catch {
    return false;
  }
}

const isOff = (cfg) => envOff() || Boolean(cfg && cfg.enabled === false);

module.exports = { stateRel, stateDir, ensureStateDir, readConfig, readConfigStrict, envOff, isOff, relFor, cleanRel, STATE_KEY };
