#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

let PATHS = {};
let PROJECT = null;
try {
  ({ PATHS, PROJECT } = require("./paths"));
} catch {
  PATHS = {};
  PROJECT = null;
}

let _archive = null;
try {
  _archive = require("./archive");
} catch {
  _archive = null;
}

const CAP_CLASSES = {
  diagnostics: { kind: "bytes", cap: 2 * 1024 * 1024 },
  operational: { kind: "lines", cap: 20000 },
  security: { kind: "lines", cap: 50000 },
  semantic: { kind: "lines", cap: 40000 },
};

const DEFAULT_JSONL_CAP_LINES = CAP_CLASSES.operational.cap;
const DEFAULT_LOG_CAP_BYTES = CAP_CLASSES.diagnostics.cap;

const MIN_BYTES_PER_LINE = 1;

function j(dir, name) {
  return dir ? path.join(dir, name) : null;
}

const EVENTS_DIR = PATHS.events || null;
const RUNTIME_DIR = PATHS.runtime || null;

const SINK_CAPS = {};

function addSink(absPath, className) {
  if (!absPath) return;
  const cls = CAP_CLASSES[className] ? className : "operational";
  const { kind, cap } = CAP_CLASSES[cls];
  try {
    SINK_CAPS[path.resolve(absPath)] = { kind, cap, class: cls };
  } catch {
  }
}

addSink(PATHS.eventsFile || j(EVENTS_DIR, "events.jsonl"), "operational");
addSink(PATHS.toolsFile || j(EVENTS_DIR, "tools.jsonl"), "operational");
addSink(PATHS.dispatchCompletionsFile || j(RUNTIME_DIR, "dispatch-completions.jsonl"), "operational");
addSink(PATHS.requirementsFile || j(EVENTS_DIR, "requirements.jsonl"), "semantic");
addSink(PATHS.requirementsStagedFile || j(EVENTS_DIR, "requirements-staged.jsonl"), "semantic");
addSink(j(EVENTS_DIR, "code.jsonl"), "semantic");
addSink(j(EVENTS_DIR, "plans.jsonl"), "semantic");
addSink(j(EVENTS_DIR, "manager-consult.jsonl"), "semantic");
addSink(PATHS.betaEvents, "security");
if (PATHS.betaEvents) {
  const WORKSPACE = path.dirname(path.dirname(PATHS.betaEvents));
  addSink(path.join(WORKSPACE, "events.jsonl"), "operational");
  addSink(path.join(WORKSPACE, "alpha", "events.jsonl"), "security");
  addSink(path.join(WORKSPACE, "gamma", "events.jsonl"), "security");
}
addSink(j(RUNTIME_DIR, "team-guard-debug.log"), "diagnostics");

function defaultRoot() {
  return PROJECT || process.env.CLAUDE_PROJECT_DIR || null;
}

function lockPathFor(file, rootAbs) {
  const base = path.basename(file).replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(rootAbs, ".claude", "runtime", "rotate-locks", base + ".lock");
}

function rotateIfNeeded(file, capLines, opts) {
  try {
    opts = opts || {};
    if (opts.capBytes) return rotateBytesIfNeeded(file, opts.capBytes, opts);
    if (!file || typeof file !== "string") return { rotated: false, reason: "no-file" };
    const cap = capLines > 0 ? capLines : DEFAULT_JSONL_CAP_LINES;

    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return { rotated: false, reason: "missing" };
    }
    if (!st || st.size === 0) return { rotated: false, reason: "empty" };

    if (st.size < cap * MIN_BYTES_PER_LINE) {
      return { rotated: false, reason: "below-pregate" };
    }

    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      return { rotated: false, reason: "read-error" };
    }
    const lineCount = content.length === 0 ? 0 : content.split("\n").filter(Boolean).length;
    if (lineCount < cap) return { rotated: false, reason: "under-cap" };

    return archiveFile(file, opts, "rotation:over-cap-lines", () => {
      try {
        const st2 = fs.statSync(file);
        if (!st2 || st2.size === 0) return false;
        const c2 = fs.readFileSync(file, "utf8");
        const lc2 = c2.length === 0 ? 0 : c2.split("\n").filter(Boolean).length;
        return lc2 >= cap;
      } catch {
        return false;
      }
    });
  } catch {
    return { rotated: false, reason: "error" };
  }
}

function rotateBytesIfNeeded(file, capBytes, opts) {
  try {
    opts = opts || {};
    if (!file || typeof file !== "string") return { rotated: false, reason: "no-file" };
    const cap = capBytes > 0 ? capBytes : DEFAULT_LOG_CAP_BYTES;

    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return { rotated: false, reason: "missing" };
    }
    if (!st || st.size === 0) return { rotated: false, reason: "empty" };
    if (st.size < cap) return { rotated: false, reason: "under-cap" };

    return archiveFile(file, opts, "rotation:over-cap-bytes", () => {
      try {
        const st2 = fs.statSync(file);
        return !!st2 && st2.size >= cap;
      } catch {
        return false;
      }
    });
  } catch {
    return { rotated: false, reason: "error" };
  }
}

function archiveFile(file, opts, reason, verify) {
  const root = opts.root || defaultRoot();
  if (!root || !_archive) {
    return { rotated: false, reason: "no-archive-tier" };
  }
  let rootAbs;
  try {
    rootAbs = path.resolve(root);
  } catch {
    return { rotated: false, reason: "bad-root" };
  }

  const sink = SINK_CAPS[path.resolve(file)];
  if (!sink) {
    return { rotated: false, reason: "unregistered-sink" };
  }

  let release = null;
  try {
    release = _archive.tryLock(lockPathFor(file, rootAbs));
  } catch {
    release = null;
  }
  if (release === null) return { rotated: false, reason: "locked" };

  try {
    if (typeof verify === "function") {
      let stillOver;
      try {
        stillOver = verify();
      } catch {
        stillOver = false;
      }
      if (!stillOver) return { rotated: false, reason: "resolved-under-lock" };
    }
    const res = _archive.archive(file, {
      root: rootAbs,
      reason,
      shape: (sink && sink.class) || opts.shape || null,
    });
    if (res && res.ok)
      return { rotated: true, reason: "archived", archived: res.archived, indexed: res.indexed };
    return { rotated: false, reason: (res && res.reason) || "archive-failed" };
  } finally {
    if (typeof release === "function") release();
  }
}

function sinkCapFor(file) {
  try {
    return SINK_CAPS[path.resolve(file)] || null;
  } catch {
    return null;
  }
}

function rotateSink(file, opts) {
  try {
    const entry = sinkCapFor(file);
    if (!entry) return { rotated: false, reason: "unknown-sink" };
    return entry.kind === "bytes"
      ? rotateBytesIfNeeded(file, entry.cap, opts)
      : rotateIfNeeded(file, entry.cap, opts);
  } catch {
    return { rotated: false, reason: "error" };
  }
}

module.exports = {
  SINK_CAPS,
  CAP_CLASSES,
  DEFAULT_JSONL_CAP_LINES,
  DEFAULT_LOG_CAP_BYTES,
  MIN_BYTES_PER_LINE,
  rotateIfNeeded,
  rotateBytesIfNeeded,
  sinkCapFor,
  rotateSink,
};
