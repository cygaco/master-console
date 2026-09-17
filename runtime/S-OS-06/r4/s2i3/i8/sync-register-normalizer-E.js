"use strict";
// Lane I8 item 5: the register's $normalizer must equal the runner's NORMALIZER_DECLARATION. Replace ONLY element 0
// (the "E environment" line, which now declares the OBSERVED FLOOR) as a text-level substitution, so no other byte of
// tests/quarantine.json changes. Refuses if anything but element 0 differs.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const REG = path.join(ROOT, "tests", "quarantine.json");
const { NORMALIZER_DECLARATION } = require(path.join(ROOT, "scripts", "checks", "run-tests.js"));
const text = fs.readFileSync(REG, "utf8");
const doc = JSON.parse(text);
if (JSON.stringify(doc.$normalizer) === JSON.stringify(NORMALIZER_DECLARATION)) {
  console.log("already in sync");
  process.exit(0);
}
if (JSON.stringify(doc.$normalizer.slice(1)) !== JSON.stringify(NORMALIZER_DECLARATION.slice(1))) {
  console.error("register $normalizer differs beyond element 0; refusing");
  process.exit(1);
}
const oldLine = `    ${JSON.stringify(doc.$normalizer[0])},\n`;
if (text.split(oldLine).length !== 2) {
  console.error("element 0 line not found exactly once; refusing");
  process.exit(1);
}
const next = text.replace(oldLine, () => `    ${JSON.stringify(NORMALIZER_DECLARATION[0])},\n`);
const check = JSON.parse(next);
if (JSON.stringify(check.$normalizer) !== JSON.stringify(NORMALIZER_DECLARATION)) {
  console.error("post-replace check failed; refusing");
  process.exit(1);
}
fs.writeFileSync(REG, next, "utf8");
console.log("replaced element 0; entries untouched:", JSON.stringify(check.entries) === JSON.stringify(doc.entries));
