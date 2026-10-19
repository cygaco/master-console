#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const branch = process.argv[2] || "skeleton-testN";
const storePath = (() => {
  try {
    return require("./hooks/lib/paths").PATHS.oneshotStore;
  } catch {
    return path.join(__dirname, "..", ".claude", "agents", "president", "_system", "oneshot", "store.json");
  }
})();

const s = JSON.parse(fs.readFileSync(storePath, "utf8"));

fs.writeFileSync(
  storePath + ".prev-run-backup.json",
  JSON.stringify(s, null, 2),
);

let resetCount = 0;
for (const [name, f] of Object.entries(s.features)) {
  if (name.startsWith("foundation-")) continue;
  f.status = "not_started";
  f.owner = null;
  f.fixAttempts = 0;
  f.note = null;
  resetCount++;
}

s.cycle = 0;
s.consecutiveFailures = 0;
s.totalFailures = 0;
s.circuitBreaker = "CLOSED";
s.lastCooldownMs = 0;

s.runLog = s.runLog || {};
if (
  s.runLog.finalStatus === null &&
  (s.runLog.startedAt || s.runLog.summary || s.runLog.branch)
) {
  s.runLog.finalStatus = "completed";
  s.runLog.endedAt = new Date().toISOString();
  s.runLog.closedBy = "oneshot-store-reset.js (implicit)";
}
if (s.runLog.startedAt || s.runLog.summary) {
  s.runLogHistory = s.runLogHistory || [];
  s.runLogHistory.push({ ...s.runLog });
  if (s.runLogHistory.length > 20) {
    s.runLogHistory = s.runLogHistory.slice(-20);
  }
}

const runIdMatch = (branch || "").match(/skeleton-test(\d+)/);
const runId = runIdMatch
  ? `run-${String(runIdMatch[1]).padStart(3, "0")}`
  : null;

s.runLog = {
  runId,
  branch,
  startedAt: new Date().toISOString(),
  finalStatus: null,
  endedAt: null,
  haltReason: null,
  summary: null,
};

s.heartbeat = {
  cycle: 0,
  phase: "startup",
  feature: null,
  agent: "delta",
  status: "initializing",
  cycleStep: "pre-flight",
  workstream: null,
  timestamp: new Date().toISOString(),
};

fs.writeFileSync(storePath, JSON.stringify(s, null, 2));
console.log(`Reset ${resetCount} non-foundation features to not_started`);
console.log(`Foundation features left unchanged`);
console.log(`runLog.branch=${branch}, cycle=0, circuitBreaker=CLOSED`);
console.log(`Heartbeat: delta/startup`);
console.log(`Backup: ${path.basename(storePath)}.prev-run-backup.json`);
