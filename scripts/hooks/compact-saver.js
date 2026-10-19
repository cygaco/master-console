#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const cwd = process.env.CLAUDE_PROJECT_DIR || event.cwd;
    const claudeDir = path.join(cwd, ".claude");
    const summaryPath = path.join(claudeDir, ".compact-summary.md");

    const summary =
      event.tool_response?.summary ||
      event.tool_response?.content ||
      event.tool_response ||
      "";

    if (typeof summary === "string" && summary.trim().length > 0) {
      const timestamp = new Date().toISOString().slice(0, 19);
      const entry = `\n## Compaction at ${timestamp}\n\n${summary.trim()}\n`;
      fs.appendFileSync(summaryPath, entry);
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
