#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, PATHS } = require("./lib/paths");

let blockedDirs = ["src/", "extension/"];
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
  if (Array.isArray(manifest.source_dirs) && manifest.source_dirs.length > 0) {
    blockedDirs = manifest.source_dirs.map((d) =>
      d.endsWith("/") ? d : d + "/",
    );
  }
} catch {
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name;

    if (!["Read", "Grep", "Glob"].includes(toolName)) {
      process.exit(0);
    }

    const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
    const storePath = path.join(agentsDir, "store.json");

    if (!fs.existsSync(storePath)) {
      process.exit(0);
    }

    const store = JSON.parse(fs.readFileSync(storePath, "utf-8"));

    const agent = store.heartbeat?.agent;
    if (!["boss", "gamma"].includes(agent)) {
      process.exit(0);
    }

    const targetPath =
      event.tool_input?.file_path ||
      event.tool_input?.path ||
      event.tool_input?.pattern ||
      "";

    const normalized = targetPath.replace(/\\/g, "/").toLowerCase();
    const isSrcAccess = blockedDirs.some(
      (d) =>
        normalized.includes("/" + d.toLowerCase()) ||
        normalized.startsWith(d.toLowerCase()),
    );

    if (isSrcAccess) {
      process.stderr.write(
        `[boss-boundary] BLOCKED: Boss Agent cannot read source code (${targetPath}). ` +
          `Dispatch a reviewer (incl. security-reviewer) or fixer agent to analyze code. ` +
          `The Boss only reads store.json, _docs/, and reviewer output.\n`,
      );
      process.exit(2);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
});
