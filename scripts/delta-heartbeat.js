#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const STORE = (() => {
  try {
    return require("./hooks/lib/paths").PATHS.oneshotStore;
  } catch {
    return path.join(__dirname, "..", ".claude", "agents", "president", "_system", "oneshot", "store.json");
  }
})();

const patchArg = process.argv[2];
if (!patchArg) {
  console.error("usage: node scripts/delta-heartbeat.js '<json>'");
  process.exit(1);
}

let patch;
try {
  patch = JSON.parse(patchArg);
} catch (e) {
  console.error("Invalid JSON: " + e.message);
  process.exit(1);
}

const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
store.heartbeat = {
  ...(store.heartbeat || {}),
  ...patch,
  agent: "delta",
  timestamp: new Date().toISOString(),
};

fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
console.log("heartbeat updated:", JSON.stringify(store.heartbeat));
