#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { PROJECT, relPath } = require("./lib/paths");

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (!/^(Edit|Write)$/.test(toolName)) {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || "";

    if (!filePath) {
      process.exit(0);
    }

    const rel = relPath(filePath);
    if (!rel.startsWith("src/")) {
      process.exit(0);
    }

    const absPath = path.resolve(PROJECT, rel);
    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      process.exit(0);
    }

    const lines = content.split("\n");
    const warnings = [];

    const saveSessionRe = /saveSession\s*\(/;
    const stateUpdateRe =
      /\b(onComplete|setSession|setState|set[A-Z][A-Za-z0-9]*)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      if (!saveSessionRe.test(lines[i])) continue;

      const lineNum = i + 1;
      const windowEnd = Math.min(i + 5, lines.length - 1);
      let hasStateUpdate = false;

      for (let j = i; j <= windowEnd; j++) {
        if (stateUpdateRe.test(lines[j])) {
          hasStateUpdate = true;
          break;
        }
      }

      if (!hasStateUpdate) {
        warnings.push(
          `⚠️ STALE STATE RISK: saveSession() at line ${lineNum} in ${rel} — no React state update within 5 lines.`,
        );
      }
    }

    if (warnings.length > 0) {
      console.log(
        JSON.stringify({
          decision: "approve",
          message: warnings.join("\n"),
        }),
      );
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
