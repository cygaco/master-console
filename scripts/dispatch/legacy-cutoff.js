#!/usr/bin/env node
"use strict";

const LEGACY_CUTOFF = null;

const CONSUMER_OVERRIDES = Object.freeze({
});

const CONSUMERS = Object.freeze(["coverage-gate-scan", "check-ac-coverage"]);

function cutoffFor(consumer) {
  const o = consumer && CONSUMER_OVERRIDES[consumer];
  return o && typeof o.cutoff === "string" && o.cutoff ? o.cutoff : LEGACY_CUTOFF;
}

function toIsoDay(date) {
  if (date == null) return null;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }
  const s = String(date).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function isLegacyDate(date, cutoff = LEGACY_CUTOFF) {
  const day = toIsoDay(date);
  if (day === null) return false;
  const cut = toIsoDay(cutoff) || toIsoDay(LEGACY_CUTOFF);
  if (cut === null) return false;
  return day < cut;
}

function recordIsLegacy(rec, opts = {}) {
  const cutoff = opts.cutoff || LEGACY_CUTOFF;
  const fields = opts.dateFields || ["ts", "created_at", "date", "started_at", "sprint_date"];
  if (!rec || typeof rec !== "object") return false;
  for (const f of fields) {
    if (rec[f] != null && toIsoDay(rec[f]) !== null) {
      return isLegacyDate(rec[f], cutoff);
    }
  }
  return false;
}

module.exports = {
  LEGACY_CUTOFF,
  CONSUMER_OVERRIDES,
  CONSUMERS,
  cutoffFor,
  isLegacyDate,
  recordIsLegacy,
  toIsoDay,
};
