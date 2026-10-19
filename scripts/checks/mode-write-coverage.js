#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const START = Date.now();
const NAME = "mode-write-coverage";

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_MODE_FILE = path.join(ROOT, ".claude", "runtime", "mode.json");
const DEFAULT_EVENTS = path.join(ROOT, ".claude", "project", "events", "events.jsonl");
const DEFAULT_WINDOW_MINUTES = 120;

const CORROBORATING_EVENTS = new Set([
  "mode:switch:after",
  "mode:switch:requested",
]);

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  return process.argv[i + 1] || null;
}

const JSON_OUT = process.argv.includes("--json");
const REPORT_ONLY = process.argv.includes("--report-only");

function evaluate({ modeState, modeUnreadable, lifecycleEvents, windowMs, nowMs }) {
  if (modeUnreadable) {
    return {
      ok: false,
      finding: {
        type: "mode-json-unreadable",
        reason:
          "mode.json is present but unparseable — cannot corroborate it against " +
          "the lifecycle event trail (fail-closed)",
      },
      corroboratingEvent: null,
    };
  }

  if (!modeState) {
    return { ok: true, finding: null, corroboratingEvent: null };
  }

  if (lifecycleEvents === null) {
    return {
      ok: false,
      finding: {
        type: "events-log-unreadable",
        mode: modeState.mode,
        reason:
          "the events log is unreadable but mode.json is present — cannot " +
          "corroborate the current mode against any lifecycle event (fail-closed)",
      },
      corroboratingEvent: null,
    };
  }

  const wantMode = String(modeState.mode || "").toLowerCase();
  const mtimeMs = modeState.mtimeMs;

  let corroborating = null;
  for (const ev of lifecycleEvents) {
    if (!ev || ev.event == null) continue;
    if (!CORROBORATING_EVENTS.has(ev.event)) continue;
    const target = String((ev.payload && ev.payload.target_mode) || "").toLowerCase();
    if (target !== wantMode) continue;
    const evMs = ev.tsMs;
    if (typeof evMs !== "number" || isNaN(evMs)) continue;
    if (evMs >= mtimeMs && evMs - mtimeMs <= windowMs) {
      corroborating = ev;
      break;
    }
  }

  if (corroborating) {
    return { ok: true, finding: null, corroboratingEvent: corroborating };
  }

  return {
    ok: false,
    finding: {
      type: "out-of-band-mode-write",
      mode: wantMode,
      mtimeMs,
      ageMinutes: Math.round((nowMs - mtimeMs) / 60000),
      reason:
        `mode.json is "${wantMode}" but NO mode-switch lifecycle event corroborates ` +
        `it within ${Math.round(windowMs / 60000)}m POST-mtime (event must be at or ` +
        `after the file write, not before) — an out-of-band write that bypassed ` +
        `scripts/mode-set.js (the single-writer chokepoint)`,
    },
    corroboratingEvent: null,
  };
}

function readModeState(modeFile) {
  let stat;
  try {
    stat = fs.statSync(modeFile);
  } catch {
    return { modeState: null, modeUnreadable: false };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(modeFile, "utf8"));
    const mode = typeof doc.mode === "string" ? doc.mode : null;
    if (!mode) return { modeState: null, modeUnreadable: true };
    return { modeState: { mode, mtimeMs: stat.mtimeMs }, modeUnreadable: false };
  } catch {
    return { modeState: null, modeUnreadable: true };
  }
}

function readLifecycleEvents(eventsFile) {
  let raw;
  try {
    raw = fs.readFileSync(eventsFile, "utf8");
  } catch {
    return null;
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.includes("lifecycle-event")) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const data = rec && rec.data;
    if (!data || data.kind !== "lifecycle-event" || typeof data.event !== "string") continue;
    const tsMs = Date.parse(rec.ts);
    out.push({
      event: data.event,
      payload: data.payload || {},
      tsMs: isNaN(tsMs) ? null : tsMs,
    });
  }
  return out;
}

function emit(result, modeFile, eventsFile, reportOnly) {
  const out = {
    name: NAME,
    status: result.ok ? "green" : "red",
    report_only: reportOnly,
    modeFile,
    eventsFile,
    finding: result.finding,
    corroboratingEvent: result.corroboratingEvent
      ? { event: result.corroboratingEvent.event }
      : null,
    durationMs: Date.now() - START,
  };
  if (JSON_OUT) {
    console.log(JSON.stringify(out));
  } else if (result.ok) {
    console.log(
      `OK   [${NAME}] mode.json corroborated by a lifecycle event (or nothing to check)`,
    );
  } else {
    const head = reportOnly ? `WARN [${NAME}] (report-only)` : `FAIL [${NAME}]`;
    console.error(`${head} ${result.finding.type}: ${result.finding.reason}`);
  }
  process.exit(result.ok || reportOnly ? 0 : 1);
}

if (require.main === module) {
  const nowArg = arg("--now");
  const nowMs = nowArg ? Date.parse(nowArg) : Date.now();
  if (nowArg && isNaN(nowMs)) {
    process.stderr.write(`[${NAME}] invalid --now value: ${nowArg}\n`);
    process.exit(2);
  }
  const windowMinutes =
    parseInt(arg("--window-minutes") || String(DEFAULT_WINDOW_MINUTES), 10) ||
    DEFAULT_WINDOW_MINUTES;
  const windowMs = windowMinutes * 60 * 1000;

  const modeFile = path.resolve(arg("--mode-file") || DEFAULT_MODE_FILE);
  const eventsFile = path.resolve(arg("--events") || DEFAULT_EVENTS);

  const { modeState, modeUnreadable } = readModeState(modeFile);
  const lifecycleEvents = readLifecycleEvents(eventsFile);

  const result = evaluate({
    modeState,
    modeUnreadable,
    lifecycleEvents,
    windowMs,
    nowMs,
  });

  emit(result, modeFile, eventsFile, REPORT_ONLY);
}

module.exports = { evaluate, readModeState, readLifecycleEvents };
