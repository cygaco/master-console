"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_ROOT = path.join(PROJECT_ROOT, ".claude", "runtime");

function ledgerDir(root) {
  return path.join(root || DEFAULT_ROOT, "do-not-reopen");
}
function ledgerPath(spId, root) {
  return path.join(ledgerDir(root), `${spId}.jsonl`);
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readEntries(spId, root) {
  let raw;
  try {
    raw = fs.readFileSync(ledgerPath(spId, root), "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
    }
  }
  return out;
}

function appendEntry(spId, root, entry) {
  ensureDir(ledgerDir(root));
  fs.appendFileSync(ledgerPath(spId, root), JSON.stringify(entry) + "\n");
}

function settle(spId, decisionId, meta = {}, opts = {}) {
  const entry = {
    type: "settle",
    decisionId,
    reason: meta && meta.reason != null ? meta.reason : null,
    ts: Date.now(),
  };
  appendEntry(spId, opts.root, entry);
  return { ok: true, entry };
}

function isSettled(spId, decisionId, opts = {}) {
  const entries = readEntries(spId, opts.root).filter((e) => e && e.decisionId === decisionId);
  return entries.some((e) => e.type === "settle" || e.type === "supersede");
}

function getDisposition(spId, decisionId, opts = {}) {
  const entries = readEntries(spId, opts.root).filter((e) => e && e.decisionId === decisionId);
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

function history(spId, decisionId, opts = {}) {
  return readEntries(spId, opts.root).filter((e) => e && e.decisionId === decisionId);
}

function supersede(spId, decisionId, newEntry, opts = {}) {
  const entry = Object.assign({}, newEntry || {}, {
    type: "supersede",
    decisionId,
    ts: Date.now(),
  });
  appendEntry(spId, opts.root, entry);
  return { ok: true, entry };
}

function tryReopen(spId, decisionId, reopenOpts = {}, opts = {}) {
  const settled = isSettled(spId, decisionId, opts);
  if (!settled) {
    return { ok: true, reason: "not-previously-settled" };
  }
  if (reopenOpts && reopenOpts.supersede === true) {
    const result = supersede(
      spId,
      decisionId,
      reopenOpts.newEntry || { reason: reopenOpts.reason || "reopened via tryReopen" },
      opts,
    );
    return { ok: true, reason: "superseded", entry: result.entry };
  }
  return { ok: false, reason: "supersession-required" };
}

module.exports = {
  settle,
  isSettled,
  supersede,
  tryReopen,
  getDisposition,
  history,
};
