#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PATHS = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, ".claude", "paths.json"), "utf8"),
);

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      out[k] = true;
    } else {
      out[k] = v;
      i++;
    }
  }
  return out;
}

function main() {
  const f = parseArgs(process.argv);
  if (!f.ref || !f.kind || !f.sprint || !f.reason) {
    process.stderr.write(
      "append-decision requires --ref --kind --sprint --reason\n",
    );
    return 2;
  }
  const row = {
    ts: new Date().toISOString(),
    kind: f.kind,
    decision_ref: f.ref,
    sprint: f.sprint,
    reason: f.reason,
    recorded_by: "alpha",
  };
  const target = path.join(REPO_ROOT, PATHS.decisionLedger);
  fs.appendFileSync(target, JSON.stringify(row) + "\n");
  process.stdout.write(`appended ref=${f.ref} to ${target}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
