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
const FRAMEWORK_INSTALLED_PATH = path.join(
  PROJECT_DIR,
  ".claude",
  "framework-installed.json",
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

const TRACKED_PREFIXES = [
  ".claude/agents/",
  ".claude/commands/",
  ".claude/project/reference/",
  ".claude/project/maps/",
  "scripts/hooks/",
  "scripts/tools/",
  "_requirements/",
  "patterns/",
];
const TRACKED_TOP_LEVEL = [
  "scripts/path-lint.js",
  "scripts/dispatch-agent.js",
  "scripts/generate-maps.js",
  "scripts/generate-framework-manifest.js",
  "CLAUDE.md",
  "AGENTS.md",
];

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

function detectInstallKind() {
  const hasCanonicalMarkers =
    fs.existsSync(path.join(PROJECT_DIR, "version.json")) &&
    fs.existsSync(path.join(PROJECT_DIR, "install.ps1")) &&
    fs.existsSync(
      path.join(PROJECT_DIR, "scripts", "generate-framework-manifest.js"),
    );
  const hasInstalledSnapshot = fs.existsSync(FRAMEWORK_INSTALLED_PATH);
  if (hasCanonicalMarkers && !hasInstalledSnapshot) return "canonical";
  return "product";
}

function isClaudeGitignored() {
  try {
    const gi = fs.readFileSync(path.join(PROJECT_DIR, ".gitignore"), "utf8");
    return /\b\.claude\/?\s*$/m.test(gi) || /^\.claude\b/m.test(gi);
  } catch {
    return false;
  }
}

const INSTALL_KIND = detectInstallKind();
const CLAUDE_IGNORED = INSTALL_KIND === "product" && isClaudeGitignored();

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "framework-manifest-guard", "", reason);
  } catch {
  }
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
}

function warn(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("warn", "system", "framework-manifest-guard", "", reason);
  } catch {
  }
  process.stderr.write("[framework-manifest-guard] " + reason + "\n");
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

function isTracked(relPath) {
  for (const prefix of TRACKED_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  return TRACKED_TOP_LEVEL.includes(relPath);
}

function manifestFreshEnough(stagedTracked) {
  try {
    const manifestStat = fs.statSync(MANIFEST_PATH);
    const manifestMtimeMs = manifestStat.mtimeMs;
    let newestStaged = 0;
    for (const f of stagedTracked) {
      try {
        const s = fs.statSync(path.join(PROJECT_DIR, f));
        if (s.mtimeMs > newestStaged) newestStaged = s.mtimeMs;
      } catch {
      }
    }
    return manifestMtimeMs + 60_000 >= newestStaged;
  } catch {
    return false;
  }
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

    const stagedTracked = staged.filter(isTracked);
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

    if (stagedTracked.length === 0) process.exit(0);

    const manifestStaged = staged.includes(".claude/framework-manifest.json");

    if (manifestStaged) {
      process.exit(0);
    }

    const list = stagedTracked.slice(0, 6).join("\n  - ");
    const extra =
      stagedTracked.length > 6
        ? `\n  ... and ${stagedTracked.length - 6} more`
        : "";

    if (CLAUDE_IGNORED) {
      if (manifestFreshEnough(stagedTracked)) {
        process.exit(0);
      }
      warn(
        [
          "Staged MC-tracked changes detected, .claude/ is gitignored, and the",
          "on-disk framework-manifest is older than your edits.",
          "",
          `Affected files (${stagedTracked.length}):`,
          `  - ${list}${extra}`,
          "",
          "Regenerate the manifest before pushing so /mc:update consumers",
          "stay honest:",
          "  node scripts/generate-framework-manifest.js",
          "",
          "(Warn-only because product .claude/ is gitignored; the manifest",
          "cannot be tracked here.)",
        ].join("\n"),
      );
    }

    block(
      [
        "framework-manifest-guard: staged changes to MC-tracked assets,",
        "but .claude/framework-manifest.json is NOT staged. Regenerate it:",
        "",
        "  node scripts/generate-framework-manifest.js",
        "  git add .claude/framework-manifest.json",
        "",
        `Affected files (${stagedTracked.length}):`,
        `  - ${list}${extra}`,
        "",
        `Install kind: ${INSTALL_KIND} (claude_gitignored=${CLAUDE_IGNORED})`,
        bypassMessage(),
      ].join("\n"),
    );
  } catch (_e) {
    process.exit(0);
  }
});
