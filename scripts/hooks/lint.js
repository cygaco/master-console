#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function detectLintCommand(cwd) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    const scripts = pkg.scripts || {};
    if (scripts.lint) return { cmd: "npm run lint --", perFile: false };
    if (scripts["lint:fix"])
      return { cmd: "npm run lint:fix --", perFile: false };
  } catch {
  }

  try {
    if (fs.existsSync(path.join(cwd, "node_modules", "next"))) {
      return { cmd: 'npx next lint --file "{file}" --no-cache', perFile: true };
    }
  } catch {
  }

  try {
    if (fs.existsSync(path.join(cwd, "node_modules", ".bin", "eslint"))) {
      return { cmd: 'npx eslint "{file}"', perFile: true };
    }
  } catch {
  }

  return null;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath =
      event.tool_input?.file_path || event.tool_input?.content?.file_path;

    if (!filePath || !/\.(ts|tsx|js|jsx)$/.test(filePath)) {
      process.exit(0);
    }

    const cwd = event.cwd || process.env.CLAUDE_PROJECT_DIR || ".";
    const lintConfig = detectLintCommand(cwd);

    if (!lintConfig) {
      process.exit(0);
    }

    const cmd = lintConfig.perFile
      ? lintConfig.cmd.replace("{file}", filePath)
      : `${lintConfig.cmd} "${filePath}"`;

    const result = execSync(`${cmd} 2>&1`, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    });

    const output = result.toString().trim();
    if (output && !/No ESLint warnings or errors/.test(output)) {
      process.stderr.write(`Lint warnings in ${filePath}:\n${output}\n`);
    }

    process.exit(0);
  } catch (err) {
    if (err.stdout || err.stderr) {
      const output = (err.stdout || err.stderr).toString().trim();
      if (output && !/No ESLint warnings or errors/.test(output)) {
        process.stderr.write(`Lint issues:\n${output}\n`);
      }
    }
    process.exit(0);
  }
});
