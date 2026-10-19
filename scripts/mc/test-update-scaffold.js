#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const sc = require("./scaffold-core");

const REQUIRED_DIRS = [
  "_requirements/_audits", "_requirements/_index", "_requirements/_shared",
  "_requirements/_standards", "_requirements/00-canonical",
  "_requirements/01-design-system", "_requirements/02-copy-system",
  "_requirements/03-architecture", "_requirements/04-features",
  "_requirements/05-operations", "_requirements/06-security",
  "_requirements/07-testing", "_requirements/08-automation", "_docs",
];

let passed = 0;
let failed = 0;
const ok = (n) => { passed++; console.log(`  ok    ${n}`); };
const fail = (n, d) => { failed++; console.log(`  FAIL  ${n}`); if (d) console.log(`        ${d}`); };

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-update-scaffold-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });

  try {
    sc.scaffoldProduct({ target: tmp, mcRoot: REPO, log: () => {} });
  } catch (e) {
    fail("scaffoldProduct runs without throwing", e.message);
    fs.rmSync(tmp, { recursive: true, force: true });
    return;
  }
  ok("scaffoldProduct runs against a post-apply target (.claude/ present)");

  const missing = REQUIRED_DIRS.filter((d) => !fs.existsSync(path.join(tmp, d)));
  if (missing.length === 0) ok(`all ${REQUIRED_DIRS.length} structure-parity skeleton dirs created`);
  else fail("skeleton dirs created", `missing: ${missing.join(", ")}`);

  for (const f of ["ROADMAP.md", "PROJECT.md", ".claude/paths.json"]) {
    if (fs.existsSync(path.join(tmp, f))) ok(`${f} created`);
    else fail(`${f} created`, "scaffold did not produce it");
  }

  try {
    sc.scaffoldProduct({ target: tmp, mcRoot: REPO, log: () => {} });
    ok("idempotent re-run (no throw, no clobber)");
  } catch (e) {
    fail("idempotent re-run", e.message);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

main();
console.log(`\nupdate-scaffold test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
