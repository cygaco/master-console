#!/usr/bin/env node

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;

    if (!filePath || !/\.(ts|tsx)$/.test(filePath)) {
      process.exit(0);
    }

    const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || ".";
    const tscBin = path.join(cwd, "node_modules", "typescript", "bin", "tsc");

    if (!fs.existsSync(tscBin)) {
      process.exit(0);
    }

    execSync(`node "${tscBin}" --noEmit --pretty "${filePath}"`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });

    process.exit(0);
  } catch (err) {
    if (err.stderr || err.stdout) {
      const output = (err.stderr || err.stdout).toString().trim();
      if (
        output &&
        !output.includes("Cannot find module") &&
        !output.includes("ENOENT")
      ) {
        process.stderr.write(`Type error in edited file:\n${output}\n`);
        process.exit(2);
      }
    }
    process.exit(0);
  }
});
