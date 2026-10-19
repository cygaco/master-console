
const fs = require("fs");
const path = require("path");
const { PROJECT } = require("./paths");

const MODE_FILE = path.join(PROJECT, ".claude", "runtime", "mode.json");
const SESSION_FILE = path.join(PROJECT, ".claude", "runtime", ".session-id");

function readModeFile() {
  try {
    if (!fs.existsSync(MODE_FILE)) return null;
    const doc = JSON.parse(fs.readFileSync(MODE_FILE, "utf8"));
    if (typeof doc?.mode === "string") return doc.mode.toLowerCase();
    return null;
  } catch {
    return null;
  }
}

function getCurrentSessionId() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, "utf8").trim();
    }
  } catch {
  }
  return "";
}

function adhocHeartbeatMatches() {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const hb = path.join(home, ".claude", "teams", "adhoc", "heartbeat.json");
    if (!fs.existsSync(hb)) return false;
    const doc = JSON.parse(fs.readFileSync(hb, "utf8"));
    const sid = getCurrentSessionId();
    return Boolean(sid) && doc.sessionId === sid;
  } catch {
    return false;
  }
}

function getMode() {
  const explicit = readModeFile();
  if (explicit === "oneshot") return "oneshot";
  if (explicit === "sprint") return "sprint";
  if (explicit === "solo") return "solo";
  if (explicit === "adhoc") return "adhoc";
  if (adhocHeartbeatMatches()) return "adhoc";
  return "solo";
}

const isAdhoc = () => getMode() === "adhoc";
const isOneshot = () => getMode() === "oneshot";
const isSprint = () => getMode() === "sprint";
const isSolo = () => getMode() === "solo";

module.exports = {
  getMode,
  isAdhoc,
  isOneshot,
  isSprint,
  isSolo,
  readModeFile,
  getCurrentSessionId,
  adhocHeartbeatMatches,
};
