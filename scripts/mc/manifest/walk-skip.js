"use strict";

const fs = require("fs");
const path = require("path");

const WALK_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".warpos",
  ".warpos-backup",
  ".vscode",
  ".idea",
  ".codex",
  "runtime",
  "worktrees",
  ".worktrees",
  "_planning",
  "_private",
  "_archive",
  "_reports",
  "agent-memory",
  "dispatch-backups",
]);

const WALK_SKIP_FILES = new Set([
  ".env",
  ".env.local",
  "DUMP.md",
  "MC.md",
  ".DS_Store",
  "Thumbs.db",
  ".session-start-commit",
  ".session-checkpoint.json",
  "scheduled_tasks.lock",
  "system-coherence.graph.json",
]);

const LOCAL_SKIPS_FILE = path.resolve(__dirname, "..", "..", "..", ".claude", "project", "memory", "walk-skip.local.json");
const LOCAL_SKIPS = (() => {
  const BAD = 'walk-skip: instance-local skip file malformed (expected { "skipDirs": ["…"], "skipFiles": ["…"] } of basenames)';
  let raw;
  try {
    raw = fs.readFileSync(LOCAL_SKIPS_FILE, "utf8").replace(/^﻿/, "");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw new Error("walk-skip: instance-local skip file unreadable");
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch {
    throw new Error(BAD);
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error(BAD);
  if (!("skipDirs" in cfg) && !("skipFiles" in cfg)) throw new Error(BAD);
  const okList = (v) => v === undefined || (Array.isArray(v) && v.every((s) => typeof s === "string" && s && !/[\\/]/.test(s)));
  if (!okList(cfg.skipDirs) || !okList(cfg.skipFiles)) throw new Error(BAD);
  return { dirs: cfg.skipDirs || [], files: cfg.skipFiles || [] };
})();
if (LOCAL_SKIPS) {
  for (const d of LOCAL_SKIPS.dirs) WALK_SKIP_DIRS.add(d);
  for (const f of LOCAL_SKIPS.files) WALK_SKIP_FILES.add(f);
}
const WALK_SKIP_INSTANCE = LOCAL_SKIPS ? LOCAL_SKIPS.dirs.length + LOCAL_SKIPS.files.length : "none (no instance-local skip file)";

module.exports = { WALK_SKIP_DIRS, WALK_SKIP_FILES, WALK_SKIP_INSTANCE, LOCAL_SKIPS_FILE };
