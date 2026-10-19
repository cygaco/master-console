#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

const {
  mergeHeartbeat,
  evaluateStall,
  emitToPath,
  checkPath,
  heartbeatPath,
  STALL_MINUTES,
  AGENT,
} = require("./heartbeat");

let passes = 0;
let failures = 0;
function ok(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const T0 = Date.parse("2026-06-05T00:00:00.000Z");
const isoAt = (ms) => new Date(ms).toISOString();
const minutes = (n) => n * 60000;

console.log("mergeHeartbeat:");
{
  const hb = mergeHeartbeat(null, { phase: "build", status: "dispatching" }, isoAt(T0));
  ok("stamps agent=epsilon", hb.agent === AGENT, JSON.stringify(hb));
  ok("stamps ts", hb.ts === isoAt(T0));
  ok("carries patch fields", hb.phase === "build" && hb.status === "dispatching");
}
{
  const prev = { phase: "design", status: "old", unit: "u1" };
  const hb = mergeHeartbeat(prev, { phase: "build", status: "new" }, isoAt(T0));
  ok("patch overrides prev", hb.phase === "build" && hb.status === "new");
  ok("prev-only fields survive the merge", hb.unit === "u1");
  ok("agent forced even if prev had another", mergeHeartbeat({ agent: "delta" }, {}, isoAt(T0)).agent === AGENT);
}

console.log("\nevaluateStall (threshold = STALL_MINUTES = " + STALL_MINUTES + "):");
{
  const fresh = { ts: isoAt(T0) };
  const r = evaluateStall(fresh, STALL_MINUTES, T0 + minutes(5));
  ok("5m old → not stale", r.stale === false && r.circuit_breaker === "closed", JSON.stringify(r));
  ok("5m old → ageMinutes ≈ 5", Math.abs(r.ageMinutes - 5) < 1e-9, String(r.ageMinutes));
}
{
  const r = evaluateStall({ ts: isoAt(T0) }, STALL_MINUTES, T0 + minutes(30));
  ok("exactly 30m → not stale (boundary)", r.stale === false && r.circuit_breaker === "closed", JSON.stringify(r));
}
{
  const r = evaluateStall({ ts: isoAt(T0) }, STALL_MINUTES, T0 + minutes(31));
  ok("31m old → stale, circuit_breaker OPEN", r.stale === true && r.circuit_breaker === "open", JSON.stringify(r));
  ok("31m old → reason 'stale'", r.reason === "stale");
}
{
  const r = evaluateStall(null, STALL_MINUTES, T0);
  ok("no heartbeat → stale (fail-closed, absence=death)", r.stale === true && r.circuit_breaker === "open");
  ok("no heartbeat → reason 'no_heartbeat'", r.reason === "no_heartbeat");
}
{
  const r = evaluateStall({ phase: "build" }, STALL_MINUTES, T0);
  ok("heartbeat without ts → no_heartbeat (fail-closed)", r.stale === true && r.reason === "no_heartbeat");
}
{
  const r = evaluateStall({ ts: "not-a-date" }, STALL_MINUTES, T0);
  ok("unparseable ts → stale OPEN, reason 'unparseable_ts'", r.stale === true && r.reason === "unparseable_ts");
}
{
  const r = evaluateStall({ ts: isoAt(T0), status: "done" }, STALL_MINUTES, T0 + minutes(120));
  ok("terminal status 'done' (2h old) → NOT stale, reason 'terminal'", r.stale === false && r.reason === "terminal", JSON.stringify(r));
}
{
  const r = evaluateStall({ ts: isoAt(T0), status: "halted" }, STALL_MINUTES, T0 + minutes(120));
  ok("terminal status 'halted' → circuit_breaker closed", r.circuit_breaker === "closed" && r.reason === "terminal");
}

console.log("\nemit → check round-trip (temp file):");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-hb-"));
  const hbPath = path.join(tmp, "sprints", "SP-x", "heartbeat.json");
  try {
    const written = emitToPath(hbPath, { phase: "build", status: "dispatching" }, isoAt(T0));
    ok("emit creates the file (nested dirs made)", fs.existsSync(hbPath));
    ok("emit returns the stamped heartbeat", written.agent === AGENT && written.phase === "build");

    const live = checkPath(hbPath, STALL_MINUTES, T0 + minutes(5));
    ok("check 5m later → live/closed", live.stale === false && live.circuit_breaker === "closed", JSON.stringify(live));

    const stalled = checkPath(hbPath, STALL_MINUTES, T0 + minutes(45));
    ok("check 45m later → stalled/open", stalled.stale === true && stalled.circuit_breaker === "open", JSON.stringify(stalled));

    emitToPath(hbPath, { status: "reviewing" }, isoAt(T0 + minutes(10)));
    const merged = JSON.parse(fs.readFileSync(hbPath, "utf8"));
    ok("second emit merges (phase survives, status advances)", merged.phase === "build" && merged.status === "reviewing");
    const liveAgain = checkPath(hbPath, STALL_MINUTES, T0 + minutes(12));
    ok("after re-emit the run reads live again", liveAgain.stale === false, JSON.stringify(liveAgain));
  } finally {
    try { fs.rmSync(tmp, { recursive: true }); } catch { }
  }
}

console.log("\nheartbeatPath location (honesty rule):");
{
  const hp = heartbeatPath("SP-x");
  ok("resolves under a runtime segment", /[\\/]runtime[\\/]/.test(hp), hp);
  ok("ends with sprint/SP-x/heartbeat.json", /[\\/]sprint[\\/]SP-x[\\/]heartbeat\.json$/.test(hp), hp);
  ok("NOT under the tracked .claude/project/sprint dir", !/[\\/]project[\\/]sprint[\\/]/.test(hp), hp);
}

console.log("\nCLI:");
{
  const ENGINE = path.join(__dirname, "heartbeat.js");
  const r = cp.spawnSync(process.execPath, [ENGINE], { encoding: "utf8" });
  ok("no command → exit 2 (usage)", r.status === 2, `got status=${r.status} stderr=${r.stderr}`);
}

console.log(`\nResults: ${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
