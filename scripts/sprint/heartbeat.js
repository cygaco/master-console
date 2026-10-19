#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const SPRINT = require("./paths");
const { PATHS } = require("../hooks/lib/paths");

const AGENT = "epsilon";
const STALL_MINUTES = 30;
const TERMINAL_STATUSES = new Set(["done", "complete", "halted"]);

function mergeHeartbeat(prev, patch, nowIso) {
  return { ...(prev || {}), ...(patch || {}), agent: AGENT, ts: nowIso };
}

function evaluateStall(heartbeat, staleMinutes = STALL_MINUTES, nowMs = Date.now()) {
  if (!heartbeat || !heartbeat.ts) {
    return { stale: true, ageMinutes: null, circuit_breaker: "open", reason: "no_heartbeat" };
  }
  const t = Date.parse(heartbeat.ts);
  if (Number.isNaN(t)) {
    return { stale: true, ageMinutes: null, circuit_breaker: "open", reason: "unparseable_ts" };
  }
  const ageMinutes = (nowMs - t) / 60000;
  if (TERMINAL_STATUSES.has(String(heartbeat.status || "").toLowerCase())) {
    return { stale: false, ageMinutes, circuit_breaker: "closed", reason: "terminal" };
  }
  const stale = ageMinutes > staleMinutes;
  return {
    stale,
    ageMinutes,
    circuit_breaker: stale ? "open" : "closed",
    reason: stale ? "stale" : "live",
  };
}

function readHeartbeatFile(hbPath) {
  try {
    return JSON.parse(fs.readFileSync(hbPath, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

function emitToPath(hbPath, patch, nowIso) {
  const next = mergeHeartbeat(readHeartbeatFile(hbPath), patch, nowIso);
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  fs.writeFileSync(hbPath, JSON.stringify(next, null, 2) + "\n");
  return next;
}

function checkPath(hbPath, staleMinutes = STALL_MINUTES, nowMs = Date.now()) {
  return evaluateStall(readHeartbeatFile(hbPath), staleMinutes, nowMs);
}

function heartbeatPath(sprintId) {
  return path.join(PATHS.runtime, "sprint", String(sprintId), "heartbeat.json");
}

function emit(sprintId, patch, nowIso = new Date().toISOString()) {
  return emitToPath(heartbeatPath(sprintId), patch, nowIso);
}

function check(sprintId, staleMinutes = STALL_MINUTES, nowMs = Date.now()) {
  return checkPath(heartbeatPath(sprintId), staleMinutes, nowMs);
}

function parseFlags(argv) {
  const out = { sprint: null, staleMin: STALL_MINUTES, json: false, positional: [] };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sprint") out.sprint = argv[++i] || null;
    else if (a === "--stale-min") out.staleMin = Number(argv[++i]);
    else if (a === "--json") out.json = true;
    else out.positional.push(a);
  }
  return out;
}

function main(argv) {
  const cmd = argv[2];
  const flags = parseFlags(argv);
  const sprintId = flags.sprint || SPRINT.active();

  if (cmd === "emit") {
    if (!sprintId) {
      process.stderr.write("heartbeat: no sprint to emit for (pass --sprint <id> or set an active sprint)\n");
      return 2;
    }
    const raw = flags.positional[0];
    let patch = {};
    if (raw) {
      try {
        patch = JSON.parse(raw);
      } catch (e) {
        process.stderr.write(`heartbeat: invalid JSON patch: ${e.message}\n`);
        return 2;
      }
    }
    const hb = emit(sprintId, patch);
    process.stdout.write(`heartbeat[${sprintId}] ${JSON.stringify(hb)}\n`);
    return 0;
  }

  if (cmd === "check") {
    if (!sprintId) {
      if (flags.json) process.stdout.write(JSON.stringify({ ok: true, reason: "no_active_sprint" }) + "\n");
      else process.stdout.write("OK   [sprint-heartbeat] no active sprint to check — nothing running\n");
      return 0;
    }
    if (!Number.isFinite(flags.staleMin) || flags.staleMin <= 0) {
      process.stderr.write(`heartbeat: invalid --stale-min (must be a positive number)\n`);
      return 2;
    }
    const r = check(sprintId, flags.staleMin);
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ok: !r.stale, sprint: sprintId, ...r }) + "\n");
    } else if (r.stale) {
      const age = r.ageMinutes == null ? "n/a" : `${r.ageMinutes.toFixed(1)}m`;
      process.stderr.write(
        `STALL [sprint-heartbeat] ${sprintId} circuit_breaker=OPEN (${r.reason}; age=${age} > ${flags.staleMin}m) — run presumed hung\n`,
      );
    } else {
      process.stdout.write(
        `OK   [sprint-heartbeat] ${sprintId} live (age=${r.ageMinutes.toFixed(1)}m ≤ ${flags.staleMin}m)\n`,
      );
    }
    return r.stale ? 1 : 0;
  }

  process.stderr.write("usage: heartbeat.js <emit|check> [--sprint <id>] [--stale-min <N>] [--json] [<json-patch>]\n");
  return 2;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  mergeHeartbeat,
  evaluateStall,
  readHeartbeatFile,
  emitToPath,
  checkPath,
  heartbeatPath,
  emit,
  check,
  STALL_MINUTES,
  TERMINAL_STATUSES,
  AGENT,
};
