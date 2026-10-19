"use strict";
const mcEnv = require("../hooks/lib/mc-env");

const fs = require("fs");
const path = require("path");

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;

function resolveFilePath() {
  if (mcEnv.readEnv("PROVIDER_DOWN_FILE")) {
    return mcEnv.readEnv("PROVIDER_DOWN_FILE");
  }
  const projectRoot = path.resolve(__dirname, "../../..");
  return path.join(projectRoot, ".claude", "runtime", "provider-down.json");
}

function readState() {
  try {
    const raw = fs.readFileSync(resolveFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    const filePath = resolveFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + ".tmp." + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, filePath);
  } catch {
  }
}

function computeUntil(_provider, errText, nowMs) {
  try {
    const text = String(errText || "");
    const safeNow = typeof nowMs === "number" ? nowMs : Date.now();

    const hintPatterns = [
      /reset(?:s)?\s+(?:after|in)\s+(\d+(?:\.\d+)?)\s*(h(?:r|ours?)?|m(?:in|inutes?)?|s(?:ec|econds?)?)?/i,
      /retry\s+in\s+(\d+(?:\.\d+)?)\s*(h(?:r|ours?)?|m(?:in|inutes?)?|s(?:ec|econds?)?)?/i,
      /retry[\s-]?after[:\s]+(\d+(?:\.\d+)?)\s*(h(?:r|ours?)?|m(?:in|inutes?)?|s(?:ec|econds?)?)?/i,
    ];

    let hintFound = false;
    let parsedMs = null;

    for (const pattern of hintPatterns) {
      const m = text.match(pattern);
      if (!m) continue;

      hintFound = true;
      const value = parseFloat(m[1]);
      const rawUnit = (m[2] || "").toLowerCase();

      if (!isFinite(value) || value <= 0) {
        break;
      }

      let durationMs;
      if (rawUnit.startsWith("h")) {
        durationMs = value * 60 * 60 * 1000;
      } else if (rawUnit.startsWith("m")) {
        durationMs = value * 60 * 1000;
      } else {
        durationMs = value * 1000;
      }

      if (durationMs <= 0 || durationMs > MAX_TTL_MS) {
        parsedMs = null;
      } else {
        parsedMs = durationMs;
      }
      break;
    }

    if (parsedMs !== null) {
      return safeNow + parsedMs;
    }
    return safeNow + DEFAULT_TTL_MS;
  } catch {
    const safeNow = typeof nowMs === "number" ? nowMs : Date.now();
    return safeNow + DEFAULT_TTL_MS;
  }
}

function markDown(provider, { kind, untilMs, evidence } = {}) {
  try {
    if (!provider || typeof provider !== "string") return;
    const state = readState();
    state[provider] = {
      kind: kind || "quota_exhausted",
      until: typeof untilMs === "number" ? untilMs : Date.now() + DEFAULT_TTL_MS,
      evidence: evidence ? String(evidence).slice(0, 200) : undefined,
      marked_at: Date.now(),
    };
    writeState(state);
  } catch {
  }
}

function isDown(provider) {
  try {
    if (!provider || typeof provider !== "string") return false;
    const state = readState();
    const entry = state[provider];
    if (!entry || typeof entry.until !== "number") return false;
    return Date.now() < entry.until;
  } catch {
    return false;
  }
}

function clear(provider) {
  try {
    if (!provider || typeof provider !== "string") return;
    const state = readState();
    if (Object.prototype.hasOwnProperty.call(state, provider)) {
      delete state[provider];
      writeState(state);
    }
  } catch {
  }
}

module.exports = { markDown, isDown, clear, computeUntil, DEFAULT_TTL_MS };
