"use strict";
// Lane I7: the register's $normalizer must equal the runner's NORMALIZER_DECLARATION. Insert ONLY the new
// element 0 ("E environment ...") as a text-level line so no other byte of tests/quarantine.json changes.
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
if (JSON.stringify(doc.$normalizer) !== JSON.stringify(NORMALIZER_DECLARATION.slice(1))) {
  console.error("register $normalizer differs by more than the new environment element; refusing");
  process.exit(1);
}
const anchor = '  "$normalizer": [\n';
if (text.split(anchor).length !== 2) {
  console.error("anchor not found exactly once; refusing");
  process.exit(1);
}
const next = text.replace(anchor, `${anchor}    ${JSON.stringify(NORMALIZER_DECLARATION[0])},\n`);
const check = JSON.parse(next);
if (JSON.stringify(check.$normalizer) !== JSON.stringify(NORMALIZER_DECLARATION)) {
  console.error("post-insert check failed; refusing");
  process.exit(1);
}
fs.writeFileSync(REG, next, "utf8");
console.log("inserted the environment element; entries untouched:", JSON.stringify(check.entries) === JSON.stringify(doc.entries));
