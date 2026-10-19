#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_ROOT = path.join(PROJECT_ROOT, ".claude", "runtime");

function wakeDir(root) {
  return path.join(root || DEFAULT_ROOT, "dispatch-wake");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function assertValidId(dispatchId) {
  if (typeof dispatchId !== "string" || !dispatchId.trim()) {
    throw new Error("wake-notification: dispatchId is required (non-empty string)");
  }
}

function encodeId(dispatchId) {
  return dispatchId.replace(/[^a-zA-Z0-9_-]/g, (ch) =>
    "%" + Buffer.from(ch, "utf8").toString("hex"),
  );
}

function markerPath(dispatchId, root) {
  return path.join(wakeDir(root), `${encodeId(dispatchId)}.done`);
}

function signalCompletion(dispatchId, outcome, opts = {}) {
  assertValidId(dispatchId);
  const { root } = opts;
  const dir = wakeDir(root);
  ensureDir(dir);
  const finalPath = markerPath(dispatchId, root);
  const tmpPath = path.join(
    dir,
    `.tmp-${encodeId(dispatchId)}-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  const record = {
    dispatch_id: dispatchId,
    outcome: outcome === undefined ? null : outcome,
    signaled_at: new Date().toISOString(),
    pid: process.pid,
  };
  fs.writeFileSync(tmpPath, JSON.stringify(record) + "\n");
  fs.renameSync(tmpPath, finalPath);
  return { ok: true, path: finalPath };
}

function pollCompletion(dispatchId, opts = {}) {
  assertValidId(dispatchId);
  const { root } = opts;
  let raw;
  try {
    raw = fs.readFileSync(markerPath(dispatchId, root), "utf8");
  } catch {
    return { completed: false, outcome: null, signaledAt: null };
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { completed: false, outcome: null, signaledAt: null };
  }
  return {
    completed: true,
    outcome: record.outcome === undefined ? null : record.outcome,
    signaledAt: record.signaled_at || null,
  };
}

function isReapNotCompletion(dispatchId, opts = {}) {
  const { root, pidAlive } = opts;
  const poll = pollCompletion(dispatchId, { root });
  if (poll.completed) return false;
  const alive = typeof pidAlive === "function" ? !!pidAlive() : !!pidAlive;
  return !alive;
}

module.exports = {
  signalCompletion,
  pollCompletion,
  isReapNotCompletion,
  markerPath,
  wakeDir,
  DEFAULT_ROOT,
};
