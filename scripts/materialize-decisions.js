#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { query } = require("./hooks/lib/logger");
const { materialize } = require("./state/materialize-core");

const PROJECT = process.env.CLAUDE_PROJECT_DIR || ".";

function readEvents() {
  const entries = query({ cat: "spec" });
  return entries.map((e) => ({
    id: e.id,
    ts: e.ts,
    file: e.data?.file || "",
    change: e.data?.change || "",
    direction: e.data?.direction || "unknown",
    group: e.data?.group || e.id,
    trigger: e.data?.trigger || "edit",
    source: e.data?.source || "Edit",
    stale_consumers: e.data?.stale_consumers || [],
    propagated: e.data?.propagated || false,
  }));
}

function inferWhy(evt) {
  const parts = [];
  if (evt.trigger && evt.trigger !== "edit") parts.push(evt.trigger);
  if (evt.source && evt.source !== "Edit" && evt.source !== "Write") {
    parts.push(`source: ${evt.source}`);
  }
  if (evt.direction && evt.direction !== "unknown") {
    parts.push(`${evt.direction} change`);
  }
  if (evt.stale_consumers?.length > 0) {
    parts.push(`→ ${evt.stale_consumers.length} file(s) marked stale`);
  }
  return parts.join(" | ") || "spec edit";
}

function propagationStatus(evt) {
  if (evt.propagated) return "✅";
  if (evt.stale_consumers?.length > 0) return "⏳";
  return "—";
}

function groupEvents(events) {
  const groups = new Map();
  for (const evt of events) {
    const key = evt.group || evt.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(evt);
  }
  return groups;
}

function renderDecisions(groups) {
  let md = `# Decision Log

Auto-generated from \`.claude/project/events/events.jsonl\` by \`materialize-decisions.js\`.
Grouped by change-set. "Why" auto-filled from event metadata.

| Time | File | Change | Why | Status |
|---|---|---|---|---|
`;

  for (const [, groupEventList] of groups) {
    for (const evt of groupEventList) {
      const time = (evt.ts || "").slice(0, 16);
      const file = evt.file || "";
      const change = (evt.change || "").replace(/\|/g, "\\|");
      const why = inferWhy(evt).replace(/\|/g, "\\|");
      const status = propagationStatus(evt);
      md += `| ${time} | ${file} | ${change} | ${why} | ${status} |\n`;
    }
  }

  return md;
}

function computeStaleSnapshot(events) {
  const staleSet = new Set();
  for (const evt of events || []) {
    if (evt.stale_consumers) {
      for (const c of evt.stale_consumers) staleSet.add(c);
    }
  }
  const currentlyStale = [];
  for (const file of staleSet) {
    const abs = path.join(PROJECT, file);
    try {
      const content = fs.readFileSync(abs, "utf8");
      if (content.includes("<!-- STALE:")) currentlyStale.push(file);
    } catch {
    }
  }
  return currentlyStale;
}

function computeStale(currentlyStale) {
  return Array.isArray(currentlyStale) ? currentlyStale : [];
}

function renderStaleFiles(currentlyStale) {
  let md = `# Stale Files

Auto-generated. Files with unresolved \`<!-- STALE: -->\` markers.

`;

  if (!currentlyStale || currentlyStale.length === 0) {
    md += "**No stale files.** All changes propagated.\n";
  } else {
    md += `**${currentlyStale.length} file(s) need review:**\n\n`;
    for (const f of currentlyStale.slice().sort()) {
      md += `- \`${f}\`\n`;
    }
  }

  return md;
}

function run() {
  const events = readEvents();
  const source = () => events;

  const decisions = materialize({
    source,
    reducer: groupEvents,
    renderer: renderDecisions,
    emptyRender: () =>
      "# Decision Log\n\nNo events recorded yet. edit-watcher.js will populate this.\n",
    outPath: path.join("docs", "DECISIONS.md"),
    root: PROJECT,
  });

  const stale = materialize({
    source: () => computeStaleSnapshot(events),
    reducer: computeStale,
    renderer: renderStaleFiles,
    emptyRender: () => renderStaleFiles([]),
    outPath: path.join("docs", ".decisions", "STALE-FILES.md"),
    root: PROJECT,
  });

  return { events, decisions, stale };
}

module.exports = {
  run,
  readEvents,
  groupEvents,
  renderDecisions,
  computeStaleSnapshot,
  computeStale,
  renderStaleFiles,
  inferWhy,
  propagationStatus,
};

if (require.main === module) {
  const { events, decisions, stale } = run();
  const d = decisions.ok ? `${decisions.bytes}b` : `FAIL:${decisions.error}`;
  const s = stale.ok ? `${stale.bytes}b` : `FAIL:${stale.error}`;
  console.log(
    `Materialized ${events.length} events → DECISIONS.md (${d}), STALE-FILES.md (${s})`,
  );
}
