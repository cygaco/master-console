#!/usr/bin/env node

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (toolName.startsWith("mcp__claude_ai_Excalidraw__")) {
      console.log(
        JSON.stringify({
          decision: "block",
          reason:
            "BLOCKED: Excalidraw diagrams do not render in a terminal session. Use ASCII art for flow diagrams instead.",
        }),
      );
      process.exit(0);
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
