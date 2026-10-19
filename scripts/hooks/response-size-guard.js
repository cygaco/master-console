#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

let normalizeRole = (r) => r;
try {
  ({ normalizeRole } = require("./lib/role-aliases"));
} catch {
}

const BUILD_CHAIN = new Set([
  "frontend-builder", "backend-builder", "security-builder",
  "frontend-fixer", "backend-fixer", "security-fixer",
  "frontend-reviewer", "backend-reviewer", "qa-reviewer", "security-reviewer",
  "ops-analyst", "skeleton-builder", "delta",
  "builder", "fixer", "fix-agent", "reviewer", "evaluator",
  "compliance", "learner", "auditor", "stub-scaffold", "qa", "redteam",
]);

const WARN_BYTES = 8 * 1024;
const CONCERN_BYTES = 32 * 1024;

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    if (event.tool_name !== "Agent") {
      process.exit(0);
    }

    const rawType = (event.tool_input?.subagent_type || "").toLowerCase();
    const subagentType = normalizeRole(rawType);
    if (!BUILD_CHAIN.has(subagentType) && !BUILD_CHAIN.has(rawType)) {
      process.exit(0);
    }

    const response = event.tool_response;
    let bytes = 0;
    if (typeof response === "string") {
      bytes = Buffer.byteLength(response, "utf8");
    } else if (response && typeof response === "object") {
      const candidates = [
        response.content,
        response.text,
        response.message,
        JSON.stringify(response),
      ];
      for (const c of candidates) {
        if (typeof c === "string") {
          bytes = Math.max(bytes, Buffer.byteLength(c, "utf8"));
        }
      }
    }

    if (bytes === 0) {
      process.exit(0);
    }

    const tier =
      bytes >= CONCERN_BYTES ? "concern" : bytes >= WARN_BYTES ? "warn" : "ok";

    try {
      const { logEvent } = require("./lib/logger");
      logEvent("modification", "system", "response_size", subagentType, {
        bytes,
        tier,
        warnThreshold: WARN_BYTES,
        concernThreshold: CONCERN_BYTES,
      });
    } catch {
      try {
        const logPath = path.resolve(
          __dirname,
          "..",
          "..",
          ".claude",
          "runtime",
          "response-size-guard.jsonl",
        );
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.appendFileSync(
          logPath,
          JSON.stringify({
            ts: new Date().toISOString(),
            subagent_type: subagentType,
            bytes,
            tier,
          }) + "\n",
        );
      } catch {
      }
    }

    if (tier !== "ok") {
      const kb = (bytes / 1024).toFixed(1);
      process.stderr.write(
        `[response-size-guard] ${tier.toUpperCase()}: ${subagentType} returned ${kb}KB ` +
          `(threshold ${tier === "concern" ? "32KB" : "8KB"}). ` +
          `Build-chain agents should return ~2KB JSON envelopes — this is a ` +
          `prompt-template smell. Run /scan:patterns or check learner output.\n`,
      );
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
