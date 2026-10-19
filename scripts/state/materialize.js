#!/usr/bin/env node
"use strict";

const path = require("path");
const { query } = require("../hooks/lib/logger");
const { materialize } = require("./materialize-core");

const STATE_DIR = path.join("runtime", "state");
const HAPPENED_LIMIT = 50;

function actionOf(e) {
  const d = (e && e.data) || {};
  return String(d.action || d.type || (e && e.type) || "").toLowerCase();
}
function targetOf(e) {
  const d = (e && e.data) || {};
  return String(d.target || "");
}

const INFLIGHT_KINDS = [
  {
    kind: "sprint",
    start: /^sprint[-:]?start$/,
    end: /^sprint[-:]?(close|complete|end)$/,
    keyOf: (e) => e.sprint_id || targetOf(e) || e.id,
  },
  {
    kind: "dispatch",
    start: /^dispatch[-:]?start$/,
    end: /^(dispatch[-:]?(complete|end)|completion)$/,
    keyOf: (e) =>
      targetOf(e) || (e.data && e.data.meta && e.data.meta.dispatch_id) || e.id,
  },
  {
    kind: "gauntlet-round",
    start: /^gauntlet[-:]?round[-:]?(open|start)$/,
    end: /^gauntlet[-:]?round[-:]?(close|end)$/,
    keyOf: (e) =>
      targetOf(e) ||
      (e.data && e.data.round != null ? `round-${e.data.round}` : "") ||
      e.id,
  },
];

function esc(s) {
  return String(s == null ? "" : s).replace(/\|/g, "\\|");
}

function reduceRunning(events) {
  const open = new Map();
  for (const e of events) {
    const action = actionOf(e);
    for (const spec of INFLIGHT_KINDS) {
      if (spec.start.test(action)) {
        const key = String(spec.keyOf(e));
        open.set(`${spec.kind}::${key}`, {
          kind: spec.kind,
          key,
          since: e.ts || "",
          id: e.id,
        });
        break;
      }
      if (spec.end.test(action)) {
        const key = String(spec.keyOf(e));
        open.delete(`${spec.kind}::${key}`);
        break;
      }
    }
  }
  return { inflight: Array.from(open.values()) };
}

function renderRunning(model) {
  const rows = (model && model.inflight) || [];
  let md = "# What's Running\n\n";
  md += "In-flight work — start events with no matching completion.\n";
  md += "Regenerated from the event log; events are the source of truth.\n\n";
  if (rows.length === 0) {
    md += "**Nothing in flight.** Every started unit has a matching completion.\n";
    return md;
  }
  md += "| Kind | Key | Since | Event |\n|---|---|---|---|\n";
  for (const r of rows) {
    md += `| ${esc(r.kind)} | ${esc(r.key)} | ${esc(r.since)} | ${esc(r.id)} |\n`;
  }
  return md;
}

function emptyRunning() {
  return "# What's Running\n\nNo events recorded yet. Nothing in flight.\n";
}

function reduceHappened(events) {
  const matched = [];
  for (const e of events) {
    const action = actionOf(e);
    const cat = String((e && e.cat) || "");
    if (cat === "decision" || /(decision|close|release)/.test(action)) {
      matched.push({
        ts: e.ts || "",
        cat,
        action,
        target: targetOf(e),
        id: e.id,
      });
    }
  }
  return { entries: matched.slice(-HAPPENED_LIMIT) };
}

function renderHappened(model) {
  const rows = (model && model.entries) || [];
  let md = "# What Happened\n\n";
  md += "Bounded recent digest of decision / close / release events.\n";
  md += "Regenerated from the event log; events are the source of truth.\n\n";
  if (rows.length === 0) {
    md += "**No recent decision / close / release events.**\n";
    return md;
  }
  md += "| Time | Category | Action | Target | Event |\n|---|---|---|---|---|\n";
  for (const r of rows) {
    md += `| ${esc(r.ts)} | ${esc(r.cat)} | ${esc(r.action)} | ${esc(r.target)} | ${esc(r.id)} |\n`;
  }
  return md;
}

function emptyHappened() {
  return "# What Happened\n\nNo events recorded yet.\n";
}

function run(opts) {
  const o = opts || {};
  const root = o.root || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rawSource = o.source || (() => query({}));
  let snapshot;
  try {
    snapshot = rawSource() || [];
  } catch {
    snapshot = [];
  }
  const source = () => snapshot;

  const running = materialize({
    source,
    reducer: reduceRunning,
    renderer: renderRunning,
    emptyRender: emptyRunning,
    outPath: o.runningPath || path.join(STATE_DIR, "what-running.md"),
    root,
  });

  const happened = materialize({
    source,
    reducer: reduceHappened,
    renderer: renderHappened,
    emptyRender: emptyHappened,
    outPath: o.happenedPath || path.join(STATE_DIR, "what-happened.md"),
    root,
  });

  return { running, happened };
}

module.exports = {
  run,
  reduceRunning,
  renderRunning,
  emptyRunning,
  reduceHappened,
  renderHappened,
  emptyHappened,
  INFLIGHT_KINDS,
};

if (require.main === module) {
  const res = run();
  const rok = res.running.ok ? `${res.running.bytes}b` : `FAIL:${res.running.error}`;
  const hok = res.happened.ok ? `${res.happened.bytes}b` : `FAIL:${res.happened.error}`;
  console.log(`Materialized state → what-running (${rok}), what-happened (${hok})`);
}
