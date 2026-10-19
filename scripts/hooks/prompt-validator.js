#!/usr/bin/env node

const { logEvent } = require("./lib/logger");

const { normalizeRole } = require("./lib/role-aliases");

const KNOWN_SUBAGENT_TYPES = new Set([
  "builder",
  "fixer",
  "reviewer",
  "evaluator",
  "compliance",
  "qa",
  "redteam",
  "security",
  "ops-analyst",
  "learner",
  "auditor",
  "skeleton-builder",
  "cabinet",
]);

function resolveRole(subagentType, prompt) {
  if (subagentType) {
    return normalizeRole(subagentType);
  }
  return detectRole(prompt);
}

function detectRole(prompt) {
  const head = prompt.slice(0, 500).toLowerCase();
  if (/\b(reviewer|evaluator)\b/.test(head)) return "reviewer";
  if (/\bsecurity\b/.test(head) && /\bscan\b|\breview\b|\baudit\b/.test(head))
    return "security";
  if (/\bcompliance\b/.test(head)) return "compliance";
  if (
    /\bqa\b/.test(head) &&
    /\borchestrat\b|\bscan\b|\banalyz\b|\bpersona\b/.test(head)
  )
    return "qa";
  if (
    /\b(ops-analyst|learner|auditor)\b/.test(head) &&
    /\banalyz\b|\bpattern\b|\brule\b/.test(head)
  )
    return "ops-analyst";
  if (/\bfix\b/.test(head) && /\bagent\b|\bbrief\b/.test(head)) return "fixer";
  if (/\bfeature:\s*\S+/.test(prompt.slice(0, 500))) return "builder";
  if (/\bbuild\b/.test(head) && /\bimplement\b|\bcreate\b|\bgut\b/.test(head))
    return "builder";
  return "unknown";
}

function extractFeature(prompt) {
  const match = prompt.match(/^feature:\s*(\S+)/im);
  return match ? match[1] : null;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(input);
    const toolName = event.tool_name || "";

    if (toolName !== "Agent") {
      process.exit(0);
    }

    const toolInput = event.tool_input || {};
    const prompt = toolInput.prompt || "";
    if (!prompt) {
      process.exit(0);
    }

    const subagentType = toolInput.subagent_type || "";
    const role = resolveRole(subagentType, prompt);
    const feature = extractFeature(prompt);
    const warnings = [];
    const blocks = [];

    if (role === "builder") {
      const firstLines = prompt.split("\n").slice(0, 5).join("\n");
      if (!/^feature:\s*\S+/im.test(firstLines)) {
        blocks.push(
          "Builder prompt MUST have 'feature: <name>' in first 5 lines",
        );
      }

      if (!/HYGIENE|hygiene.*rule/i.test(prompt)) {
        blocks.push("Builder prompt MUST reference HYGIENE rules");
      }

      if (!/top.?5.*bug|BUG-\d{3}|bugDataset|recurring.*bug/i.test(prompt)) {
        blocks.push(
          "Builder prompt MUST include top-5 recurring bugs. Add BUG-NNN references from bugDataset.",
        );
      }

      if (
        !/file.?scope|files?\s*to\s*(modify|edit|create)|FILE-OWNERSHIP/i.test(
          prompt,
        )
      ) {
        warnings.push("Builder prompt missing file scope specification");
      }
    }

    if (role === "reviewer") {
      if (!/golden|fixture|expected.*output|step-expectations/i.test(prompt)) {
        warnings.push("Reviewer prompt missing golden fixture reference");
      }
    }

    const allIssues = [...blocks, ...warnings];
    logEvent(
      "dispatch",
      "boss",
      `dispatch-${role}`,
      feature || "unknown",
      `${role} dispatched${allIssues.length > 0 ? ` (${blocks.length} blocks, ${warnings.length} warnings)` : ""}`,
      allIssues.length > 0 ? { blocks, warnings } : undefined,
    );

    if (blocks.length > 0) {
      const blockMsg = blocks.join("; ");
      process.stderr.write(
        `\x1b[31m[prompt-validator] BLOCKED ${role} dispatch (${blocks.length} issue${blocks.length > 1 ? "s" : ""}):\x1b[0m\n`,
      );
      for (const b of blocks) {
        process.stderr.write(`  \x1b[31m- ${b}\x1b[0m\n`);
      }
      console.log(
        JSON.stringify({ decision: "block", reason: blockMsg.slice(0, 300) }),
      );
      process.exit(2);
    }

    if (warnings.length > 0) {
      process.stderr.write(
        `\x1b[33m[prompt-validator] ${warnings.length} warning(s) for ${role} dispatch:\x1b[0m\n`,
      );
      for (const w of warnings) {
        process.stderr.write(`  - ${w}\n`);
      }
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
