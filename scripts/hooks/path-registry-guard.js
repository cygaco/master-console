#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const REGISTRY_FILE = "framework/paths.registry.json";
const GENERATED_FILES = [
  ".claude/paths.json",
  "scripts/hooks/lib/paths.generated.js",
  "scripts/path-lint.rules.generated.json",
  "schemas/paths.schema.json",
  "_requirements/03-architecture/PATH_KEYS.md",
];

if (process.env.PATH_REGISTRY_GUARD === "off") process.exit(0);

if (!fs.existsSync(path.join(PROJECT_DIR, REGISTRY_FILE))) process.exit(0);

function block(reason) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent("block", "system", "path-registry-guard", "", reason);
  } catch {
  }
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
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

    const registryStaged = staged.includes(REGISTRY_FILE);
    const stagedGenerated = staged.filter((f) => GENERATED_FILES.includes(f));

    if (registryStaged) {
      const missing = GENERATED_FILES.filter((f) => !staged.includes(f));
      if (missing.length > 0) {
        const result = spawnSync(
          process.execPath,
          [path.join(PROJECT_DIR, "scripts", "paths", "build.js"), "--check"],
          { cwd: PROJECT_DIR, encoding: "utf8" },
        );
        if (result.status !== 0) {
          block(
            [
              "path-registry-guard: framework/paths.registry.json is staged,",
              "but generated artifacts are stale. Run:",
              "",
              "  node scripts/paths/build.js",
              "  git add " + GENERATED_FILES.join(" \\\n          "),
              "",
              "Generated files needing updates:",
              ...missing.map((f) => `  - ${f}`),
              "",
              "Set PATH_REGISTRY_GUARD=off to bypass (use sparingly).",
            ].join("\n"),
          );
        }
      }
    }

    if (!registryStaged && stagedGenerated.length > 0) {
      const result = spawnSync(
        process.execPath,
        [path.join(PROJECT_DIR, "scripts", "paths", "build.js"), "--check"],
        { cwd: PROJECT_DIR, encoding: "utf8" },
      );
      if (result.status !== 0) {
        block(
          [
            "path-registry-guard: generated path artifacts staged without",
            "framework/paths.registry.json, AND they don't match what build.js",
            "would produce — looks like a hand-edit.",
            "",
            "Edit the registry, then run:",
            "",
            "  node scripts/paths/build.js",
            "  git add framework/paths.registry.json " +
              GENERATED_FILES.join(" \\\n          "),
            "",
            "Staged generated files:",
            ...stagedGenerated.map((f) => `  - ${f}`),
            "",
            "Set PATH_REGISTRY_GUARD=off to bypass (use sparingly).",
          ].join("\n"),
        );
      }
    }
  } catch (e) {
    process.exit(0);
  }
});
