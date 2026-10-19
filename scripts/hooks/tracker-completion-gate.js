#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const VALIDATOR = path.join(ROOT, "scripts", "trackers", "validate.js");
const ENFORCE = process.env.TRACKER_GATE_ENFORCE === "1";

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function main() {
  const payload = readStdin();
  if (payload && payload.stop_hook_active) process.exit(0);

  if (!fs.existsSync(path.join(ROOT, "TRACKER.md"))) process.exit(0);

  let res = null;
  try {
    const out = execFileSync(process.execPath, [VALIDATOR, "--json"], {
      cwd: ROOT,
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000,
    });
    res = JSON.parse(out);
  } catch (e) {
    if (e && e.stdout) {
      try {
        res = JSON.parse(String(e.stdout));
      } catch {
        res = null;
      }
    }
    if (!res) process.exit(0);
  }

  const checks = Array.isArray(res.checks) ? res.checks : [];
  const failed = checks.filter((c) => c.status === "FAIL");
  if (res.ok && failed.length === 0) process.exit(0);

  const names = failed.map((c) => c.check).join(", ");
  const msg =
    `[tracker-completion-gate] TRACKER.md is RED at session end — ${failed.length}/${checks.length} ` +
    `check(s) failing: ${names}. The enforced tracker is the source of truth; do not end on a tracker ` +
    `that lies about state. Reconcile TRACKER.md + its epic/sprint files (run ` +
    `\`node scripts/trackers/validate.js\` for details), then end.` +
    (ENFORCE ? "" : " (advisory — set TRACKER_GATE_ENFORCE=1 to hard-block.)");
  process.stderr.write(msg + "\n");
  process.exit(ENFORCE ? 2 : 0);
}

main();
