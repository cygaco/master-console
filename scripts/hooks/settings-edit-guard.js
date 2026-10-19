#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

let SETTINGS_REL = ".claude/settings.json";
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  if (raw && typeof raw.settings === "string") SETTINGS_REL = raw.settings;
} catch {
}

function normalize(p) {
  return String(p || "").replace(/\\/g, "/");
}

function isGeneratedSettings(filePath) {
  const norm = normalize(filePath);
  const rel = normalize(path.relative(PROJECT, path.resolve(PROJECT, norm)));
  const matchesRel = rel === SETTINGS_REL || rel.endsWith("/" + SETTINGS_REL);
  const endsWithGenerated =
    /(^|\/)\.claude\/settings\.json$/.test(norm) ||
    matchesRel;
  if (!endsWithGenerated) return false;
  if (/settings\.local\.json$/.test(norm)) return false;
  if (/\.tmp$/.test(norm)) return false;
  return true;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input || "{}");
    const toolName = event.tool_name || "";
    if (!/^(Edit|Write)$/.test(toolName)) process.exit(0);

    const ti = event.tool_input || {};
    const filePath = ti.file_path || ti.path || "";
    if (!filePath) process.exit(0);

    if (!isGeneratedSettings(filePath)) process.exit(0);

    process.stderr.write(
      [
        "[settings-edit-guard] You are editing the GENERATED .claude/settings.json directly.",
        "  This file is compiled by scripts/mc/settings/compile.js from:",
        "    - the framework defaults layer, and",
        "    - .claude/settings.local.json (the per-project override layer).",
        "  A direct edit here is OVERWRITTEN on the next compile — and a recompile",
        "  can silently DROP a security hook this way. Edit the SOURCE instead:",
        "    1. Edit .claude/settings.local.json (permissions / hooks / env overrides), then",
        "    2. node scripts/mc/settings/compile.js   # regenerate settings.json",
        "  Verify nothing drifted:",
        "    node scripts/mc/settings/compile.js --check",
        "  (Advisory only — this edit is NOT blocked. For an emergency hand-edit,",
        "   mirror the change into settings.local.json afterward so compile keeps it.)",
        "",
      ].join("\n"),
    );

    try {
      const { logEvent } = require("./lib/logger");
      logEvent(
        "warn",
        "system",
        "settings-edit-guard-handedit",
        normalize(filePath),
        "direct hand-edit of generated settings.json",
      );
    } catch {
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});

process.stdin.on("error", () => process.exit(0));

module.exports = { isGeneratedSettings };
