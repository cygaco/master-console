#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const [, , outdir] = process.argv;
if (!outdir) {
  console.error("Usage: node openai-assemble.js <outdir>");
  process.exit(1);
}

const phases = [];
for (let i = 0; i < 4; i++) {
  const f = path.join(outdir, ".tmp", "openai-phase-" + i + ".md");
  if (fs.existsSync(f)) {
    const content = fs.readFileSync(f, "utf8").trim();
    if (content) phases.push(content);
  }
}

fs.writeFileSync(
  path.join(outdir, "openai-report.md"),
  phases.join("\n\n---\n\n"),
);
console.log("Assembled " + phases.length + " phases");
