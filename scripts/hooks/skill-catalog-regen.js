#!/usr/bin/env node

"use strict";
const mcEnv = require("./lib/mc-env");

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT =
  process.env.CLAUDE_PROJECT_DIR ||
  mcEnv.readEnv("PROJECT_DIR") ||
  process.cwd();

function readStdinJson() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
    if (process.stdin.isTTY) resolve(null);
  });
}

function targetFile(event) {
  if (!event || !event.tool_input) return "";
  return (
    event.tool_input.file_path ||
    event.tool_input.path ||
    event.tool_input.notebook_path ||
    ""
  );
}

(async () => {
  try {
    const event = await readStdinJson();
    if (!event) process.exit(0);
    const file = targetFile(event);
    if (!file) process.exit(0);

    const commandsDir = path.join(PROJECT, ".claude", "commands");
    const normalized = path.resolve(file);
    if (!normalized.startsWith(path.resolve(commandsDir))) process.exit(0);
    if (!normalized.endsWith(".md")) process.exit(0);

    const child = spawn(
      process.execPath,
      [path.join(PROJECT, "scripts", "generate-skill-catalog.js")],
      {
        cwd: PROJECT,
        env: { ...process.env, CLAUDE_PROJECT_DIR: PROJECT },
        stdio: "ignore",
        detached: true,
      },
    );
    child.unref();
    process.exit(0);
  } catch {
    process.exit(0);
  }
})();
