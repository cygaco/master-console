#!/usr/bin/env node
"use strict";

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input || "{}");
    const toolName = event.tool_name || "";
    if (toolName !== "Edit" && toolName !== "Write") return done();

    const fp = (event.tool_input && event.tool_input.file_path) || "";
    if (!fp) return done();

    const norm = fp.replace(/\\/g, "/");
    const base = norm.split("/").pop() || "";

    const isAutoMemoryMd =
      /\/\.claude\/projects\/[^/]+\/memory\/.+\.md$/i.test(norm) &&
      base.toLowerCase() !== "memory.md";
    const isLearnings = /\/learnings\.jsonl$/i.test(norm);

    if (!isAutoMemoryMd && !isLearnings) return done();

    const kind = isLearnings ? "learning" : "auto-memory entry";
    const msg =
      `[memory-enforcement-guard] You just committed a ${kind} (${base}). ` +
      `Memory is UNRELIABLE — background context that can be missed and reflects only what was true when written. ` +
      `Rule: pair this with an ACTUAL enforcer that makes a violation self-detecting — ` +
      `a hook, a /check:* skill, a test, a release gate, a schema, or a script that exits non-zero. ` +
      `If you truly cannot enforce it now, log the gap with /enforcement:log so it surfaces at /enforcement:list and /scan:full. ` +
      `Ask: "what makes a violation of this memory self-detecting?" — do not rely on the entry alone.`;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: msg,
        },
      }),
    );
    process.stderr.write("\n" + msg + "\n\n");
    return done();
  } catch {
    return done();
  }
});

function done() {
  process.exit(0);
}
