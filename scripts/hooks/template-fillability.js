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
    if (!/^(Edit|Write)$/.test(toolName)) process.exit(0);

    const toolInput = event.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || "";
    if (!filePath) process.exit(0);

    const rel = relPath(filePath);
    if (!/\/(PRD|STORIES|HL-STORIES|AC|COPY|INPUTS)\.md$/i.test(rel)) {
      process.exit(0);
    }

    const absPath = path.resolve(PROJECT, rel);
    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      process.exit(0);
    }

    const findings = [];

    const todoCount = (content.match(/\[TODO\]/g) || []).length;
    const fillCount = (content.match(/<!--\s*FILL[:\s][^>]*-->/g) || []).length;
    const tbdCount = (content.match(/\bTBD\b/g) || []).length;
    const loremCount = (content.match(/\blorem ipsum\b/gi) || []).length;

    if (todoCount) findings.push(`${todoCount} [TODO]`);
    if (fillCount) findings.push(`${fillCount} <!-- FILL: --> markers`);
    if (tbdCount) findings.push(`${tbdCount} TBD`);
    if (loremCount) findings.push(`${loremCount} lorem-ipsum`);

    const acRegex =
      /^#{1,4}\s+(?:Acceptance Criteria|AC)\b[^\n]*\n+([\s\S]*?)(?=^#{1,4}\s|\z)/gim;
    let acMatch;
    let emptyAcSections = 0;
    while ((acMatch = acRegex.exec(content)) !== null) {
      const body = (acMatch[1] || "").trim();
      const stripped = body
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\(none\)/gi, "")
        .trim();
      if (!stripped) emptyAcSections++;
    }
    if (emptyAcSections)
      findings.push(`${emptyAcSections} empty AC section(s)`);

    if (findings.length) {
      process.stderr.write(
        `[template-fillability] ${rel} has unfilled markers: ${findings.join(", ")}. Consider asking Alex to fill them.\n`,
      );
    }

    process.exit(0);
  } catch {
    process.exit(0);
  }
});
