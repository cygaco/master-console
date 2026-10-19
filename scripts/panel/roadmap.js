#!/usr/bin/env node

"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = path.resolve(__dirname, "..", "..");

const NUL = String.fromCharCode(0);

function unavailable(reason) {
  return `_(section unavailable: ${reason || "unknown"})_`;
}

function resolveRoot(argv) {
  const i = argv.indexOf("--root");
  if (i !== -1 && argv[i + 1]) {
    return path.resolve(argv[i + 1]);
  }
  const env = (mcEnv.readEnv("ROADMAP_ROOT") || "").trim();
  if (env) {
    return path.resolve(env);
  }
  return DEFAULT_ROOT;
}

function parseRoadmap(root) {
  try {
    const file = path.join(root, "ROADMAP.md");
    const text = fs.readFileSync(file, "utf8");

    const hasPickupQueue = /^##\s+Sprint Pickup Queue\s*$/m.test(text);

    const lines = text.split(/\r?\n/);
    let markerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\*\*Ranked do-next:\*\*\s*$/.test(lines[i].trim())) {
        markerIdx = i;
        break;
      }
    }
    if (markerIdx === -1) {
      throw new Error("`Ranked do-next:` marker not found (renamed/removed section)");
    }

    const ranked = [];
    for (let i = markerIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      const m = /^(\d+)\.\s+(.*)$/.exec(trimmed);
      if (m) {
        ranked.push({ n: Number(m[1]), text: summarizeRankedItem(m[2]) });
        continue;
      }
      if (trimmed === "") {
        if (ranked.length > 0) break;
        continue;
      }
      if (ranked.length > 0) break;
    }

    if (ranked.length === 0) {
      throw new Error("`Ranked do-next:` present but no numbered items parsed");
    }
    return { ranked, hasPickupQueue };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

function summarizeRankedItem(s) {
  const bold = /\*\*(.+?)\*\*/.exec(s);
  if (bold && bold[1].trim()) return bold[1].trim();
  const seg = s.split(/\s+[—–-]\s+|\.\s/)[0];
  return (seg || s).trim();
}

function parseTracker(root) {
  try {
    const file = path.join(root, "TRACKER.md");
    const text = fs.readFileSync(file, "utf8");

    const headIdx = text.search(/^##\s+Current Highest-Priority Next Action\s*$/m);
    if (headIdx === -1) {
      throw new Error("`## Current Highest-Priority Next Action` heading not found");
    }
    const afterHead = text.slice(headIdx);
    const nlIdx = afterHead.indexOf("\n");
    const body = nlIdx === -1 ? "" : afterHead.slice(nlIdx + 1);
    const nextHead = body.search(/^#{1,2}\s+\S/m);
    const section = nextHead === -1 ? body : body.slice(0, nextHead);

    const m = /\*\*\s*(NEXT ACTION[\s\S]*?)\*\*/.exec(section);
    if (!m || !m[1].trim()) {
      throw new Error("no bolded **NEXT ACTION ...** line in the section");
    }
    const nextAction = m[1].replace(/\s+/g, " ").trim();
    return { nextAction };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

function parseActiveSprints(root) {
  try {
    const file = path.join(root, ".claude", "project", "sprint", "active-sprints.yaml");
    if (!fs.existsSync(file)) {
      throw new Error("active-sprints.yaml not found");
    }
    const text = fs.readFileSync(file, "utf8");
    if (!text.trim()) {
      return { sprints: [], primary: null, empty: true };
    }

    if (text.indexOf(NUL) !== -1) {
      throw new Error("file contains NUL bytes (corrupt)");
    }

    assertYamlNotCorrupt(text);

    const lines = text.split(/\r?\n/);
    let primary = null;
    const sprints = [];
    let cur = null;
    let inSprints = false;

    for (const raw of lines) {
      const line = raw.replace(/\t/g, "  ");
      const pm = /^primary:\s*(.+?)\s*$/.exec(line);
      if (pm && primary === null) {
        primary = stripYamlScalar(pm[1]);
        continue;
      }
      if (/^sprints:\s*$/.test(line)) {
        inSprints = true;
        continue;
      }
      if (!inSprints) continue;

      const idm = /^\s*-\s*id:\s*(.+?)\s*$/.exec(line);
      if (idm) {
        if (cur) sprints.push(cur);
        cur = { id: stripYamlScalar(idm[1]), status: null };
        continue;
      }
      if (cur) {
        const sm = /^\s*status:\s*(.+?)\s*$/.exec(line);
        if (sm) cur.status = stripYamlScalar(sm[1]);
      }
    }
    if (cur) sprints.push(cur);

    return { sprints, primary };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

function stripYamlScalar(s) {
  let v = (s || "").trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

function assertYamlNotCorrupt(text) {
  let brackets = 0;
  let braces = 0;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let inS = false;
    let inD = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inS) {
        if (c === "'") inS = false;
        continue;
      }
      if (inD) {
        if (c === "\\") {
          i++;
          continue;
        }
        if (c === '"') inD = false;
        continue;
      }
      if (c === "#") break;
      if (c === "'") inS = true;
      else if (c === '"') inD = true;
      else if (c === "[") brackets++;
      else if (c === "]") brackets--;
      else if (c === "{") braces++;
      else if (c === "}") braces--;
    }
    if (inS || inD) {
      throw new Error("malformed YAML: unterminated quoted scalar");
    }
    if (brackets < 0 || braces < 0) {
      throw new Error("malformed YAML: unbalanced flow collection (stray close)");
    }
  }
  if (brackets !== 0 || braces !== 0) {
    throw new Error("malformed YAML: unterminated flow collection (unclosed '[' or '{')");
  }
}

const TERMINAL_STATUSES = new Set([
  "retrospected",
  "closed",
  "released",
  "done",
  "complete",
  "completed",
  "archived",
  "abandoned",
  "cancelled",
  "canceled",
]);

function inFlight(sprints) {
  return sprints.filter(
    (s) => s && s.status && !TERMINAL_STATUSES.has(String(s.status).toLowerCase()),
  );
}

const ACTIVE_STATUSES = new Set([
  "in_progress",
  "in-progress",
  "inprogress",
  "active",
  "executing",
  "building",
  "build",
  "gauntlet",
  "review",
  "reviewing",
  "releasing",
  "release",
  "design",
  "designing",
]);

function isActivelyExecuting(s) {
  return !!(s && s.status && ACTIVE_STATUSES.has(String(s.status).toLowerCase()));
}

function isStalePlanning(s) {
  return !!(s && s.status && String(s.status).toLowerCase() === "planning");
}

function parseGaps(root) {
  try {
    const debtFile = path.join(root, ".claude", "project", "memory", "enforcement-debt.jsonl");
    const issuesFile = path.join(root, ".claude", "project", "memory", "recurring-issues.jsonl");

    const debtAbsent = !fs.existsSync(debtFile);
    const issuesAbsent = !fs.existsSync(issuesFile);
    if (debtAbsent && issuesAbsent) {
      throw new Error("open-gaps registers not found (enforcement-debt + recurring-issues absent)");
    }
    if (debtAbsent) {
      throw new Error("open-gaps register not found: enforcement-debt.jsonl");
    }
    if (issuesAbsent) {
      throw new Error("open-gaps register not found: recurring-issues.jsonl");
    }

    const debt = readJsonlOpen(debtFile, (o) => ({ id: o.id, label: o.policy || o.note || "" }));
    const issues = readJsonlOpen(issuesFile, (o) => ({ id: o.id, label: o.title || o.policy || "" }));
    return { debt, issues };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

function readJsonlOpen(file, pick) {
  if (!fs.existsSync(file)) {
    return { count: 0, items: [], absent: true };
  }
  const text = fs.readFileSync(file, "utf8");
  const items = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try {
      o = JSON.parse(t.replace(/^﻿/, ""));
    } catch {
      continue;
    }
    if (o && o.status === "open") {
      items.push(pick(o));
    }
  }
  return { count: items.length, items, absent: false };
}

function parseEpics(root) {
  try {
    const dir = path.join(root, "trackers", "epics");
    if (!fs.existsSync(dir)) {
      throw new Error("trackers/epics/ not found");
    }
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      throw new Error(`trackers/epics/ unreadable: ${e && e.message ? e.message : e}`);
    }
    const files = names
      .filter((n) => /\.md$/i.test(n))
      .sort();

    const epics = [];
    for (const name of files) {
      const file = path.join(dir, name);
      try {
        epics.push(parseOneEpic(file, name));
      } catch (e) {
        epics.push({
          id: epicIdFromFilename(name),
          parseError: e && e.message ? e.message : String(e),
        });
      }
    }
    return { epics };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e) };
  }
}

function epicIdFromFilename(name) {
  const stem = String(name || "").replace(/\.md$/i, "");
  const m = /^(E-[A-Z0-9-]*?-\d+)\b/.exec(stem);
  return m ? m[1] : stem;
}

function parseOneEpic(file, name) {
  const text = fs.readFileSync(file, "utf8");
  if (text.indexOf(NUL) !== -1) {
    throw new Error("epic file contains NUL bytes (corrupt)");
  }
  const lines = text.split(/\r?\n/);

  const idLine = matchBoldField(lines, "Epic label and number");
  const id = (idLine && idLine.trim()) || epicIdFromFilename(name);

  let title = matchBoldField(lines, "Title");
  if (!title) {
    for (const ln of lines) {
      const h = /^#\s+(.*\S)\s*$/.exec(ln);
      if (h) {
        title = h[1].trim();
        break;
      }
    }
  }
  title = (title && title.trim()) || id;

  const state = matchBoldField(lines, "Current state");
  if (!state || !state.trim()) {
    throw new Error("no `**Current state:**` line (renamed/removed)");
  }
  const stateLabel = epicStateLabel(state);

  const percent = parsePercent(matchBoldField(lines, "Percent completion"));

  const childSprints = parseRelatedSprints(lines);

  return { id: id.trim(), title, state: stateLabel, percent, childSprints };
}

function epicStateLabel(raw) {
  let s = String(raw || "").trim();
  const cut = s.search(/\s[—–-]\s|\.\s|\n/);
  if (cut !== -1) s = s.slice(0, cut).trim();
  if (s.length > 60) s = s.slice(0, 57).trimEnd() + "…";
  return s;
}

function matchBoldField(lines, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(?:[-*]\\s*)?\\*\\*\\s*${esc}\\s*:\\*\\*\\s*(.*)$`, "i");
  for (const ln of lines) {
    const m = re.exec(ln);
    if (m) return m[1].trim();
  }
  return null;
}

function parsePercent(value) {
  if (value == null) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(String(value));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function parseRelatedSprints(lines) {
  let i = 0;
  for (; i < lines.length; i++) {
    if (/^##\s+Related sprints\s*$/i.test(lines[i].trim())) break;
  }
  if (i >= lines.length) return [];

  const ids = [];
  for (let j = i + 1; j < lines.length; j++) {
    const ln = lines[j];
    if (/^#{1,2}\s+\S/.test(ln)) break;
    const trimmed = ln.trim();
    if (!trimmed) continue;
    if (/^[-*]\s+/.test(trimmed)) {
      const body = trimmed.replace(/^[-*]\s+/, "");
      const bold = /^\*\*\s*([^*]+?)\s*\*\*/.exec(body);
      const tokenSrc = bold ? bold[1] : body.split(/\s+/)[0];
      const id = (tokenSrc || "").trim();
      if (id && !/^none\b/i.test(id)) ids.push(id);
    }
  }
  return ids;
}

function parseSprintBreakdown(root, sprintIds) {
  const byId = {};
  const ids = Array.isArray(sprintIds) ? sprintIds : [];
  for (const id of ids) {
    if (!id) continue;
    try {
      const file = path.join(
        root,
        ".claude",
        "project",
        "sprint",
        "sprints",
        id,
        "current.yaml",
      );
      if (!fs.existsSync(file)) {
        byId[id] = { id, breakdownUnavailable: true, reason: "current.yaml not found" };
        continue;
      }
      const text = fs.readFileSync(file, "utf8");
      if (text.indexOf(NUL) !== -1) {
        byId[id] = { id, breakdownUnavailable: true, reason: "current.yaml contains NUL bytes (corrupt)" };
        continue;
      }
      byId[id] = parseTicketsMap(id, text);
    } catch (e) {
      byId[id] = {
        id,
        breakdownUnavailable: true,
        reason: e && e.message ? e.message : String(e),
      };
    }
  }
  return { byId };
}

function parseTicketsMap(id, text) {
  assertYamlNotCorrupt(text);

  const lines = text.split(/\r?\n/);
  let start = -1;
  let ticketsIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)tickets:\s*$/.exec(lines[i]);
    if (m) {
      start = i;
      ticketsIndent = m[1].length;
      break;
    }
  }
  if (start === -1) {
    throw new Error("no `tickets:` block in current.yaml");
  }

  const byState = {};
  let curState = null;
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const indent = raw.length - raw.replace(/^\s+/, "").length;
    if (indent <= ticketsIndent && /^\s*\S/.test(raw)) break;

    const keyM = /^\s*([A-Za-z_][\w-]*):\s*(\[\s*\])?\s*$/.exec(raw);
    if (keyM && indent === ticketsIndent + 2) {
      curState = keyM[1];
      byState[curState] = [];
      continue;
    }
    const itemM = /^\s*-\s*(.+?)\s*$/.exec(raw);
    if (itemM && curState && indent > ticketsIndent + 2) {
      byState[curState].push(stripYamlScalar(itemM[1]));
      continue;
    }
  }

  const counts = {};
  let total = 0;
  for (const k of Object.keys(byState)) {
    counts[k] = byState[k].length;
    total += byState[k].length;
  }
  return { id, byState, counts, total };
}

function buildBoard(root) {
  const active = parseActiveSprints(root);
  const inFlightIds = active.error ? [] : inFlight(active.sprints).map((s) => s.id);
  return {
    root,
    generatedAt: new Date().toISOString(),
    roadmap: parseRoadmap(root),
    tracker: parseTracker(root),
    active,
    gaps: parseGaps(root),
    epics: parseEpics(root),
    sprintBreakdown: parseSprintBreakdown(root, inFlightIds),
  };
}

function renderMarkdown(b) {
  const out = [];
  out.push("# What's next — roadmap board");
  out.push("");
  out.push("_Read-only, regenerated at a glance from the live sources. Not editable here._");
  out.push("");

  out.push("## NEXT ACTION");
  if (b.tracker.error) {
    out.push(unavailable(b.tracker.error));
  } else {
    const headline =
      b.tracker.nextAction
        .replace(/^NEXT ACTION\b\s*(\([^)]*\))?\s*[:=]?\s*/i, "")
        .replace(/^the\s+/i, "")
        .trim() || b.tracker.nextAction;
    out.push(`> **${headline}**`);
    out.push("");
    out.push("_(source: TRACKER.md -> Current Highest-Priority Next Action)_");
  }
  out.push("");

  out.push("## Ranked next (Prioritized)");
  if (b.roadmap.error) {
    out.push(unavailable(b.roadmap.error));
  } else {
    for (const r of b.roadmap.ranked) {
      out.push(`${r.n}. ${r.text}`);
    }
    out.push("");
    const pq = b.roadmap.hasPickupQueue
      ? "Sprint Pickup Queue: present"
      : "Sprint Pickup Queue: not found";
    out.push(`_(source: ROADMAP.md -> Prioritized order · ${pq})_`);
  }
  out.push("");

  out.push("## In flight");
  if (b.active.error) {
    out.push(unavailable(b.active.error));
  } else {
    const live = inFlight(b.active.sprints);
    if (live.length === 0) {
      out.push("_None in flight._");
    } else {
      const primaryRow = b.active.primary
        ? live.find((s) => s.id === b.active.primary)
        : null;
      if (primaryRow) {
        out.push(`- \`${primaryRow.id}\` — **${primaryRow.status}** (primary)`);
      }
      const rest = live.filter((s) => !primaryRow || s.id !== primaryRow.id);
      const active = rest.filter(isActivelyExecuting);
      const CAP = 8;
      for (const s of active.slice(0, CAP)) {
        out.push(`- \`${s.id}\` — **${s.status}**`);
      }
      const shown = active.slice(0, CAP).length;
      const remaining = rest.length - shown;
      if (remaining > 0) {
        const stale = rest.filter(isStalePlanning).length;
        const staleNote = stale > 0 ? ` (${stale} stale planning)` : "";
        out.push(`- …and ${remaining} more in-flight${staleNote}`);
      }
    }
    out.push("");
    out.push("_(source: .claude/project/sprint/active-sprints.yaml)_");
  }
  out.push("");

  out.push("## Open gaps / blockers");
  if (b.gaps.error) {
    out.push(unavailable(b.gaps.error));
  } else {
    const { debt, issues } = b.gaps;
    out.push(`- Enforcement debt (open): **${debt.count}**`);
    for (const d of debt.items.slice(0, 8)) {
      out.push(`  - \`${d.id || "?"}\` — ${truncate(d.label, 90)}`);
    }
    if (debt.count > 8) out.push(`  - …and ${debt.count - 8} more`);
    out.push(`- Recurring issues (open): **${issues.count}**`);
    for (const it of issues.items.slice(0, 8)) {
      out.push(`  - \`${it.id || "?"}\` — ${truncate(it.label, 90)}`);
    }
    if (issues.count > 8) out.push(`  - …and ${issues.count - 8} more`);
    out.push("");
    out.push("_(source: enforcement-debt.jsonl + recurring-issues.jsonl)_");
  }
  out.push("");

  return out.join("\n");
}

function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function toJsonSummary(b) {
  return {
    generatedAt: b.generatedAt,
    root: b.root,
    nextAction: b.tracker.error ? null : b.tracker.nextAction,
    nextActionAvailable: !b.tracker.error,
    ranked: b.roadmap.error ? [] : b.roadmap.ranked,
    rankedAvailable: !b.roadmap.error,
    hasPickupQueue: b.roadmap.error ? null : !!b.roadmap.hasPickupQueue,
    inFlight: b.active.error ? [] : inFlight(b.active.sprints),
    inFlightAvailable: !b.active.error,
    activelyExecuting: b.active.error
      ? []
      : inFlight(b.active.sprints).filter(isActivelyExecuting),
    stalePlanningCount: b.active.error
      ? 0
      : inFlight(b.active.sprints).filter(isStalePlanning).length,
    primary: b.active.error ? null : b.active.primary || null,
    gaps: b.gaps.error
      ? null
      : {
          enforcementDebtOpen: b.gaps.debt.count,
          recurringIssuesOpen: b.gaps.issues.count,
        },
    gapsAvailable: !b.gaps.error,
    epics: b.epics.error ? [] : b.epics.epics,
    epicsAvailable: !b.epics.error,
    sprintBreakdown: b.sprintBreakdown.byId,
    sectionsUnavailable: [
      b.tracker.error ? "nextAction" : null,
      b.roadmap.error ? "ranked" : null,
      b.active.error ? "inFlight" : null,
      b.gaps.error ? "gaps" : null,
      b.epics.error ? "epics" : null,
    ].filter(Boolean),
  };
}

function generate(opts) {
  const root = opts && opts.root ? path.resolve(opts.root) : DEFAULT_ROOT;
  const board = buildBoard(root);
  return {
    markdown: renderMarkdown(board),
    summary: toJsonSummary(board),
    board,
  };
}

function main(argv) {
  const root = resolveRoot(argv);
  const asJson = argv.includes("--json");
  let result;
  try {
    const board = buildBoard(root);
    result = asJson
      ? JSON.stringify(toJsonSummary(board), null, 2)
      : renderMarkdown(board);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    result = asJson
      ? JSON.stringify({ error: msg, sectionsUnavailable: ["all"] }, null, 2)
      : `# What's next — roadmap board\n\n${unavailable(msg)}\n`;
  }
  process.stdout.write(result + "\n");
  process.exit(0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  generate,
  buildBoard,
  renderMarkdown,
  toJsonSummary,
  parseRoadmap,
  parseTracker,
  parseActiveSprints,
  parseGaps,
  parseEpics,
  parseSprintBreakdown,
  inFlight,
  isActivelyExecuting,
  isStalePlanning,
  assertYamlNotCorrupt,
  unavailable,
  DEFAULT_ROOT,
};
