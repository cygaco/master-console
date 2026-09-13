#!/usr/bin/env node
/**
 * settings-edit-guard.js — PreToolUse Edit|Write hook (WI-33).
 *
 * `.claude/settings.json` is a GENERATED artifact: scripts/mc/settings/
 * compile.js produces it from a defaults layer + .claude/settings.local.json
 * (the per-project override layer the operator is meant to edit). A direct
 * hand-edit to settings.json is a footgun — the next `compile` overwrites it,
 * and a recompile once SILENTLY DROPPED a security hook because the hand-edit
 * lived only in the generated file, never in a source layer.
 *
 * This guard is ADVISORY ONLY — it never blocks. It warns on stderr when an
 * Edit/Write targets the generated settings.json and points the operator at the
 * right surface (settings.local.json + recompile). A hard block would be its own
 * footgun (emergency hand-edits, broken-compile recovery), and the structural
 * enforcer for staleness is `compile --check` (WI-36) — this is the write-time
 * nudge that pairs with it.
 *
 * Why it can't false-RED the compiler: compile.js writes via fs.writeFileSync,
 * NOT the Edit/Write tool, so the legitimate generated write never reaches this
 * hook. Only a model/operator Edit|Write on settings.json triggers the warning.
 *
 * Detection is by FILE PATH (the generated artifact) — narrowed so it does NOT
 * fire on settings.local.json (the correct edit surface) or settings.json.tmp
 * scratch files.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());

// Resolve the generated settings path from the registry (never hardcode the
// literal where avoidable). Falls back to the canonical default.
let SETTINGS_REL = ".claude/settings.json";
try {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "paths.json"), "utf8"),
  );
  if (raw && typeof raw.settings === "string") SETTINGS_REL = raw.settings;
} catch {
  /* registry optional — default stands */
}

function normalize(p) {
  return String(p || "").replace(/\\/g, "/");
}

// True only for the GENERATED settings.json — not settings.local.json (the edit
// surface), not a *.tmp scratch file.
function isGeneratedSettings(filePath) {
  const norm = normalize(filePath);
  const rel = normalize(path.relative(PROJECT, path.resolve(PROJECT, norm)));
  const matchesRel = rel === SETTINGS_REL || rel.endsWith("/" + SETTINGS_REL);
  // Also catch absolute/relative forms that end in the canonical basename path
  // but only when they are NOT settings.local.json.
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
        "  once silently DROPPED a security hook this way. Edit the SOURCE instead:",
        "    1. Edit .claude/settings.local.json (permissions / hooks / env overrides), then",
        "    2. node scripts/mc/settings/compile.js   # regenerate settings.json",
        "  Verify nothing drifted:",
        "    node scripts/mc/settings/compile.js --check",
        "  (Advisory only — this edit is NOT blocked. For an emergency hand-edit,",
        "   mirror the change into settings.local.json afterward so compile keeps it.)",
        "",
      ].join("\n"),
    );

    // Best-effort telemetry — never block on logger failure.
    try {
      const { logEvent } = require("./lib/logger");
      logEvent(
        "warn",
        "system",
        "settings-edit-guard-handedit",
        normalize(filePath),
        "direct hand-edit of generated settings.json (WI-33)",
      );
    } catch {
      /* logger optional */
    }

    process.exit(0); // advisory — allow
  } catch {
    process.exit(0); // fail-open — never block on hook error
  }
});

process.stdin.on("error", () => process.exit(0));

module.exports = { isGeneratedSettings };
