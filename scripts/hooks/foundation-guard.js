#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath, PATHS } = require("./lib/paths");

let FOUNDATION_FILES = [];
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PROJECT, ".claude", "manifest.json"), "utf8"),
  );
  const ownership = manifest.fileOwnership || manifest.file_ownership || {};
  FOUNDATION_FILES = ownership.foundation || [];
} catch {
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input?.file_path || "";

    if (!filePath) {
      process.exit(0);
      return;
    }

    if (FOUNDATION_FILES.length === 0) {
      process.exit(0);
      return;
    }

    const rel = relPath(filePath);

    const isFoundation = FOUNDATION_FILES.some(
      (f) => rel === f || rel.endsWith("/" + f),
    );

    if (!isFoundation) {
      process.exit(0);
      return;
    }

    const prompt =
      (event.tool_input?.content || "") +
      (event.tool_input?.new_string || "") +
      (event.tool_input?.command || "");

    try {
      const agentsDir = PATHS.agents || path.join(PROJECT, ".claude", "agents");
      const storePath = path.join(agentsDir, "store.json");
      if (fs.existsSync(storePath)) {
        const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
        const heartbeat = store.heartbeat || {};
        if (["boss", "lead", "alpha", "gamma"].includes(heartbeat.agent)) {
          process.exit(0);
          return;
        }
      }
    } catch {
    }

    process.stderr.write(
      `BLOCKED: "${rel}" is a foundation file (read-only for feature agents).\n` +
        `If you need a change, flag a foundation-update request in store.json.\n`,
    );
    process.exit(2);
  } catch {
    process.exit(0);
  }
});
