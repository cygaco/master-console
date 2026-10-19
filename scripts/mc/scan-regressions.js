#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const NOT_HERE = "the regression suite runs in the framework repository only; nothing to check in this project";
const MISSING = "regression suite missing in the framework repo";

function repoRole() {
  try {
    const { resolveRepoRole } = require("./repo-role");
    const r = resolveRepoRole({ root: ROOT });
    return r && typeof r.role === "string" ? r.role : "unknown";
  } catch {
    return "unknown";
  }
}

function main(argv) {
  const enforce = argv.includes("--enforce");
  const args = argv.filter((a) => a !== "--enforce");
  const name = enforce ? "enforce.js" : "run.js";
  const script = path.join(ROOT, "scripts", "testsuite", name);

  if (!fs.existsSync(script)) {
    if (repoRole() === "canonical") {
      process.stderr.write(MISSING + "\n");
      return 2;
    }
    process.stdout.write(NOT_HERE + "\n");
    return 0;
  }

  const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  if (r.error) {
    process.stderr.write(`scan-regressions: could not start scripts/testsuite/${name}: ${r.error.message}\n`);
    return 2;
  }
  if (r.status === null) {
    process.stderr.write(`scan-regressions: scripts/testsuite/${name} was stopped by signal ${r.signal}\n`);
    return 2;
  }
  return r.status;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { main, NOT_HERE, MISSING };
