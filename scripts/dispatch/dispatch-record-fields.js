#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

let _rotate = null;
try {
  _rotate = require("../hooks/lib/rotate");
} catch {
  _rotate = null;
}

const STARTED_PHASE = "started";

function startedRow(f = {}, extra = {}) {
  if (typeof f.role !== "string" || !f.role.trim()) {
    throw new Error("startedRow: role is required");
  }
  if (typeof f.provider !== "string" || !f.provider.trim()) {
    throw new Error("startedRow: provider is required");
  }
  const startedAt = f.started_at || new Date().toISOString();
  const row = {
    phase: STARTED_PHASE,
    dispatch_id: f.dispatch_id || null,
    role: f.role,
    provider: f.provider,
    model: f.model || null,
    started_at: startedAt,
    ok: false,
    ...extra,
  };
  if (f.sprint_id) row.sprint_id = f.sprint_id;
  return row;
}

function isStartedRow(rec) {
  return !!rec && typeof rec === "object" && rec.phase === STARTED_PHASE;
}

function startedRowSuperseded(startedRec, allRecords) {
  if (!isStartedRow(startedRec) || !startedRec.dispatch_id) return false;
  return allRecords.some(
    (r) =>
      r &&
      !isStartedRow(r) &&
      r.dispatch_id === startedRec.dispatch_id &&
      typeof r.completed_at !== "undefined",
  );
}

function quotaField(provider, known = {}) {
  const q = {
    provider: provider || null,
    checked_at: new Date().toISOString(),
  };
  const keys = [
    "auth_mode",
    "plan",
    "credits_remaining",
    "requests_remaining",
    "tier_ok",
    "note",
    "source",
  ];
  let any = false;
  for (const k of keys) {
    if (known[k] !== undefined && known[k] !== null) {
      q[k] = known[k];
      any = true;
    }
  }
  q.known = any;
  return { quota: q };
}

function recordStart(file, fields = {}, extra = {}) {
  const row = startedRow(fields, extra);
  return appendRecord(file, row);
}

function appendRecord(file, record) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (_rotate) {
      try {
        _rotate.rotateSink(file);
      } catch {
      }
    }
    fs.appendFileSync(file, JSON.stringify(record) + "\n");
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  STARTED_PHASE,
  startedRow,
  isStartedRow,
  startedRowSuperseded,
  recordStart,
  quotaField,
  appendRecord,
};
