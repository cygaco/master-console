"use strict";

const fs = require("node:fs");
const path = require("node:path");

function resolveProjectRoot() {
  const anchor = path.resolve(__dirname, "..", "..");
  if (fs.existsSync(path.join(anchor, ".claude"))) return anchor;
  const envRoot = process.env.CLAUDE_PROJECT_DIR;
  if (envRoot && fs.existsSync(path.join(envRoot, ".claude"))) return envRoot;
  return anchor;
}

const PROJECT_ROOT = resolveProjectRoot();

const DEFAULT_CANONICAL_REGISTRY = path.join(
  PROJECT_ROOT,
  ".claude",
  "project",
  "maps",
  "cited-eds.registry.jsonl",
);
const DEFAULT_WORKTREE_LEDGER = path.join(
  PROJECT_ROOT,
  ".claude",
  "project",
  "memory",
  "enforcement-debt.jsonl",
);

const ED_TOKEN_RE = /ED-\d+/g;
const ED_ID_RE = /^ED-\d+$/;

const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "coverage", "dist", "build"]);
const CONTRACT_EXTS = new Set([".md", ".json"]);

function toArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v.slice() : [v];
}

function loadEdIdsFromFile(file) {
  const ids = new Set();
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return ids;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec && typeof rec.id === "string" && ED_ID_RE.test(rec.id)) {
      ids.add(rec.id);
    }
  }
  return ids;
}

function loadEdIdsFromFiles(files) {
  const ids = new Set();
  for (const file of toArray(files)) {
    if (!file) continue;
    for (const id of loadEdIdsFromFile(file)) ids.add(id);
  }
  return ids;
}

function resolveRoots(roots) {
  const r = roots || {};
  return {
    canonical: r.canonical != null ? toArray(r.canonical) : [DEFAULT_CANONICAL_REGISTRY],
    worktreeLocal: r.worktreeLocal != null ? toArray(r.worktreeLocal) : [DEFAULT_WORKTREE_LEDGER],
    contracts: toArray(r.contracts),
  };
}

function resolveCitedEd(edId, opts = {}) {
  if (typeof edId !== "string" || !ED_ID_RE.test(edId)) {
    return { resolved: false, source: null };
  }
  const roots = resolveRoots(opts.roots);

  const canonicalIds = loadEdIdsFromFiles(roots.canonical);
  if (canonicalIds.has(edId)) {
    return { resolved: true, source: "canonical" };
  }

  const worktreeIds = loadEdIdsFromFiles(roots.worktreeLocal);
  if (worktreeIds.has(edId)) {
    return { resolved: true, source: "worktree-local" };
  }

  return { resolved: false, source: null };
}

function extractCitedEds(text) {
  return new Set((text || "").match(ED_TOKEN_RE) || []);
}

function collectContractFiles(root) {
  let stat;
  try {
    stat = fs.lstatSync(root);
  } catch {
    return [];
  }
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) return [];

  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && CONTRACT_EXTS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }
  return out;
}

function resolveContractFiles(contracts) {
  const files = new Set();
  for (const target of toArray(contracts)) {
    if (!target) continue;
    for (const f of collectContractFiles(target)) files.add(f);
  }
  return Array.from(files);
}

function syncDriftLint(opts = {}) {
  const roots = resolveRoots(opts.roots);
  const files = resolveContractFiles(roots.contracts);

  const citations = new Map();
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const edId of extractCitedEds(text)) {
      if (!citations.has(edId)) citations.set(edId, []);
      citations.get(edId).push(file);
    }
  }

  const drifts = [];
  for (const [edId, citedIn] of citations) {
    const { resolved } = resolveCitedEd(edId, { roots });
    if (!resolved) drifts.push({ edId, citedIn });
  }

  drifts.sort((a, b) => a.edId.localeCompare(b.edId));

  return { ok: drifts.length === 0, drifts };
}

module.exports = {
  resolveCitedEd,
  syncDriftLint,
  extractCitedEds,
  loadEdIdsFromFiles,
  resolveRoots,
  DEFAULT_CANONICAL_REGISTRY,
  DEFAULT_WORKTREE_LEDGER,
};
