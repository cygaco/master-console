#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

const NAME = "taste-gate-presence";
const ROOT = path.resolve(__dirname, "..", "..");
const SPECS = [
  ".claude/agents/product/quality/design-quality.md",
  ".claude/agents/product/quality/visual-review.md",
];

const REQUIRED = [
  { key: "section", re: /taste gate/i, desc: "a taste-gate section (the 'designed vs assembled' vibe verdict)" },
  { key: "schema", re: /"taste_gate"\s*:\s*\{\s*"pass"\s*:/, desc: 'the output-schema field "taste_gate": { "pass": … }' },
  { key: "binding", re: /pass[`"]?\s*:\s*false[\s\S]{0,120}(FAIL|binding)/i, desc: "the BINDING rule (taste_gate.pass:false → verdict FAIL)" },
];

function evaluateSpec(text) {
  const missing = [];
  for (const r of REQUIRED) if (!r.re.test(String(text || ""))) missing.push(r.desc);
  return missing;
}

function main() {
  const errors = [];
  for (const rel of SPECS) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    } catch (e) {
      process.stderr.write(`${NAME}: taste-gate spec unreadable: ${rel}: ${e.message}\n`);
      return 2;
    }
    for (const m of evaluateSpec(text)) errors.push(`spec ${rel} is MISSING ${m} — the taste-gate contract must be present`);
  }
  if (errors.length === 0) {
    process.stdout.write(`OK   [${NAME}] both design-review specs carry the taste-gate contract (section + schema + binding rule)\n`);
    return 0;
  }
  process.stderr.write(`FAIL [${NAME}] taste-gate contract missing/weakened (${errors.length}):\n${errors.map((e) => "  - " + e).join("\n")}\n`);
  return 1;
}

if (require.main === module) process.exit(main());
module.exports = { evaluateSpec, REQUIRED, SPECS, NAME };
