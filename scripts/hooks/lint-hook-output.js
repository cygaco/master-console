#!/usr/bin/env node

"use strict";

const SHAPE = {
  Edit: ["file_path", "old_string", "new_string"],
  Write: ["file_path", "content"],
};

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const tool = event.tool_name || event.tool;
    if (!tool) {
      process.stderr.write(
        "[lint-hook-output] event missing tool_name — skipping shape validation\n",
      );
      process.exit(0);
    }
    const required = SHAPE[tool];
    if (!required) {
      process.exit(0);
    }
    const ti = event.tool_input || {};
    const missing = required.filter((f) => !(f in ti));
    if (missing.length > 0) {
      process.stderr.write(
        `[lint-hook-output] PreToolUse ${tool} tool_input missing fields: ${missing.join(", ")} — payload-shape drift candidate (warn-only, exit 0)\n`,
      );
    }
    process.exit(0);
  } catch (err) {
    process.stderr.write(
      `[lint-hook-output] could not validate event: ${err.message} (warn-only, exit 0)\n`,
    );
    process.exit(0);
  }
});
