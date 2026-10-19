
"use strict";

const fs = require("fs");
const path = require("path");
const { PATHS } = require("./paths");
const logger = require("./logger");

function moduleRootRegistry() {
  return path.resolve(
    __dirname, "..", "..", "..", ".claude", "agents", "_org", "mode-lifecycle-hooks.json",
  );
}
function registryPath() {
  const keyed = PATHS.modeLifecycleHooks;
  try {
    if (keyed && fs.existsSync(keyed)) return keyed;
  } catch {
  }
  return moduleRootRegistry();
}

let _registryCache = null;
function loadRegistry(p = registryPath()) {
  if (_registryCache && _registryCache._path === p) return _registryCache;
  const raw = JSON.parse(fs.readFileSync(p, "utf8").replace(/^﻿/, ""));
  const byEvent = Object.create(null);
  for (const row of Array.isArray(raw.events) ? raw.events : []) {
    if (row && typeof row.event === "string") byEvent[row.event] = row;
  }
  _registryCache = { _path: p, doc: raw, byEvent };
  return _registryCache;
}

function _clearCache() {
  _registryCache = null;
}

function declaredEvents(p = registryPath()) {
  try {
    return Object.keys(loadRegistry(p).byEvent);
  } catch {
    return [];
  }
}

function isDeclared(event, p = registryPath()) {
  try {
    return Object.prototype.hasOwnProperty.call(loadRegistry(p).byEvent, event);
  } catch {
    return false;
  }
}

const SECRET_KEY_RE =
  /(secret|token|password|passwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|authorization|bearer|session[_-]?token|client[_-]?secret)/i;
const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9]{8,}|sk-(?:live|test|proj)[-_][A-Za-z0-9]{6,}|AKIA[0-9A-Z]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
const REDACTED = "[redacted]";

function scrubValue(v) {
  if (typeof v === "string") {
    return SECRET_VALUE_RE.test(v) ? REDACTED : v;
  }
  if (v && typeof v === "object") {
    return Array.isArray(v) ? "[array]" : "[object]";
  }
  return v;
}

function sanitizePayload(eventRow, rawPayload) {
  const out = {};
  const allowed = new Set(
    eventRow && Array.isArray(eventRow.payload_fields) ? eventRow.payload_fields : [],
  );
  const src = rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  for (const k of Object.keys(src)) {
    if (!allowed.has(k)) continue;
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = scrubValue(src[k]);
  }
  return out;
}

function emit(event, payload, opts) {
  try {
    if (typeof event !== "string" || !event) {
      logger.log("audit", {
        type: "warn",
        action: "lifecycle-event-drop",
        detail: "emit() called with a non-string/empty event",
      });
      return false;
    }

    let row;
    try {
      row = loadRegistry().byEvent[event];
    } catch (e) {
      logger.log("audit", {
        type: "warn",
        action: "lifecycle-event-drop",
        detail: `lifecycle registry unreadable: ${String(e.message).slice(0, 120)}`,
      });
      return false;
    }

    if (!row) {
      logger.log("audit", {
        type: "warn",
        action: "lifecycle-event-drop",
        detail: `undeclared lifecycle event "${String(event).slice(0, 80)}"`,
      });
      return false;
    }

    const safePayload = sanitizePayload(row, payload);
    logger.log(
      "lifecycle",
      {
        kind: "lifecycle-event",
        event,
        mode: row.mode || "advisory",
        harness_fires: false,
        payload: safePayload,
      },
      opts,
    );
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  emit,
  isDeclared,
  declaredEvents,
  sanitizePayload,
  loadRegistry,
  registryPath,
  _clearCache,
};
