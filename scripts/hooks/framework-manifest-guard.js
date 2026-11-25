#!/usr/bin/env node

"use strict";
const mcEnv = require("./lib/mc-env");

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MANIFEST_PATH = path.join(
  PROJECT_DIR,
  ".claude",
  "framework-manifest.json",
);
const SENTINEL_PATH = path.join(
  PROJECT_DIR,
  ".mc",
  "manifest-guard-disable",
);

if (mcEnv.readEnv("MANIFEST_GUARD") === "off") process.exit(0);

if (fs.existsSync(SENTINEL_PATH)) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "bypass",
      "system",
      "framework-manifest-guard-sentinel",
      "",
      ".mc/manifest-guard-disable present",
    );
  } catch {
  }
  process.exit(0);
}

if (!fs.existsSync(MANIFEST_PATH)) process.exit(0);

const PATHS_RELATED = [
  "framework/paths.registry.json",
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "_requirements/03-architecture/PATH_KEYS.md",
  "scripts/paths/build.js",
  "scripts/paths/gate.js",
];

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "framework-manifest-guard", "", reason);
  } catch {
  }
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function bypassMessage() {
  return [
    "",
    "Bypass (use sparingly — every bypass is logged):",
    "  PowerShell (current process):",
    "    $env:MC_MANIFEST_GUARD = 'off'; <git command>; Remove-Item Env:MC_MANIFEST_GUARD",
    "  bash (NOTE: Bash-inline `VAR=val cmd` may not reach PreToolUse hooks —",
    "  set in the harness env or use the sentinel):",
    "    export MC_MANIFEST_GUARD=off && <git command> && unset MC_MANIFEST_GUARD",
    "  Repo-local sentinel (gitignore-safe; bypass is logged):",
    "    mkdir -p .mc && touch .mc/manifest-guard-disable",
  ].join("\n");
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Bash") process.exit(0);
    if (event.tool_response !== undefined) process.exit(0);

    const cmd = ((event.tool_input || {}).command || "").trim();
    if (!cmd) process.exit(0);
    if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

    let staged = [];
    try {
      staged = execSync("git diff --cached --name-only", {
        cwd: PROJECT_DIR,
        encoding: "utf8",
      })
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      process.exit(0);
    }

    const stagedPaths = staged.filter((f) => PATHS_RELATED.includes(f));

    if (stagedPaths.length > 0) {
      const { spawnSync } = require("child_process");
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT_DIR, "scripts", "paths", "gate.js")],
        { cwd: PROJECT_DIR, encoding: "utf8" },
      );
      if (result.status !== 0) {
        const out = (result.stdout || "").split("\n").slice(-12).join("\n");
        block(
          [
            "framework-manifest-guard: path coherence gate failed.",
            "Staged paths-related files require scripts/paths/gate.js to pass:",
            "",
            ...stagedPaths.map((f) => `  - ${f}`),
            "",
            "Gate output (tail):",
            out,
            "",
            "Fix the findings or run: node scripts/paths/build.js",
            bypassMessage(),
          ].join("\n"),
        );
      }
    }
    process.exit(0);
  } catch (_e) {
    process.exit(0);
  }
});
