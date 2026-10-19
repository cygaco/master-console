#!/usr/bin/env node

"use strict";

const HARDCODED_UNKNOWN_FALLBACK = Object.freeze({
  root_cause: "Unclassified provider error — catalog unavailable.",
  safe_to_autofix: false,
  fix_recipe: null,
  remediation:
    "Inspect events.jsonl for the smoke event with full stderr. " +
    "If recurring, add a catalog entry under .claude/agents/president/_system/policy/provider-failure-modes.json.",
  fallback_allowed: true,
});

function rcaFor(results, catalog) {
  if (!Array.isArray(results)) return [];

  const entries =
    catalog &&
    typeof catalog === "object" &&
    catalog.entries &&
    typeof catalog.entries === "object"
      ? catalog.entries
      : null;

  const unknownEntry =
    entries &&
    entries.unknown_error &&
    typeof entries.unknown_error === "object"
      ? entries.unknown_error
      : HARDCODED_UNKNOWN_FALLBACK;

  const out = [];

  for (const r of results) {
    if (!r || typeof r !== "object") continue;

    const status = typeof r.status === "string" ? r.status : undefined;

    if (status === "ok") continue;

    let entry;
    if (
      status &&
      entries &&
      Object.prototype.hasOwnProperty.call(entries, status) &&
      entries[status] &&
      typeof entries[status] === "object"
    ) {
      entry = entries[status];
    } else {
      entry = unknownEntry;
    }

    out.push({
      provider: r.provider,
      status: status,
      root_cause: entry.root_cause,
      safe_to_autofix: !!entry.safe_to_autofix,
      fix_recipe: entry.fix_recipe == null ? null : entry.fix_recipe,
      remediation: entry.remediation,
      fallback_allowed:
        entry.fallback_allowed === undefined ? true : !!entry.fallback_allowed,
    });
  }

  return out;
}

module.exports = {
  rcaFor: rcaFor,
  HARDCODED_UNKNOWN_FALLBACK: HARDCODED_UNKNOWN_FALLBACK,
};
