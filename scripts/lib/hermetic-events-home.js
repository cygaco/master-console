"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_KEYS = Object.freeze(["sprintHookPoints", "orgRoleRegistry"]);
const PATHS_LIB = path.join(__dirname, "..", "hooks", "lib", "paths.js");

function pin({ realRoot, prefix = "mc-events-home-", keys = DEFAULT_KEYS } = {}) {
  if (!realRoot) throw new Error("hermetic-events-home: realRoot is required");
  if (require.cache[require.resolve(PATHS_LIB)]) {
    throw new Error(
      "hermetic-events-home: scripts/hooks/lib/paths.js is already loaded, so this pin would be silently ineffective; call pin() before requiring any project module",
    );
  }
  const viewRel = path.join(".claude", "paths.json");
  const view = JSON.parse(fs.readFileSync(path.join(realRoot, viewRel), "utf8").replace(/^﻿/, ""));
  const rels = [viewRel];
  for (const key of keys) {
    if (typeof view[key] !== "string") throw new Error(`hermetic-events-home: paths.${key} is not in the paths view`);
    rels.push(view[key]);
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const rel of rels) {
    const dest = path.join(home, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(realRoot, rel), dest);
  }
  process.env.CLAUDE_PROJECT_DIR = home;
  process.on("exit", () => {
    try {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    } catch {
    }
  });
  return { home, eventsFile: path.join(home, view.events, "events.jsonl") };
}

function inside(home, p) {
  return path.resolve(p).toLowerCase().startsWith(path.resolve(home).toLowerCase() + path.sep);
}

module.exports = { pin, inside, DEFAULT_KEYS };
