#!/usr/bin/env node
"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
const VALIDATOR = path.join(ROOT, "scripts", "trackers", "validate.js");

function emit(ctx) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: ctx,
      },
    })
  );
}

function main() {
  try {
    require("fs").readFileSync(0, "utf8");
  } catch {
  }

  let res;
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
    let parsed = null;
    if (e && e.stdout) {
      try {
        parsed = JSON.parse(String(e.stdout));
      } catch {
      }
    }
    if (parsed && Array.isArray(parsed.checks)) {
      res = parsed;
    } else {
      emit(
        "TRACKER.md start-of-work check: the tracker validator could not be run (fail-open). " +
          "If TRACKER.md exists, treat it as the source of truth and reconcile before claiming state; " +
          "run `node scripts/trackers/validate.js` to check."
      );
      return;
    }
  }

  const checks = Array.isArray(res.checks) ? res.checks : [];
  const failed = checks.filter((c) => c.status === "FAIL");
  if (res.ok && failed.length === 0) {
    emit(
      `TRACKER.md (the enforced source of truth) is VALID — all ${checks.length} tracker checks pass. ` +
        "Before meaningful work, consult TRACKER.md (start-of-work procedure): confirm the active epic/sprint, " +
        "the current next action, blockers, and definitions. Authority: TRACKER.md outranks memory."
    );
  } else {
    const names = failed.map((c) => c.check).join(", ");
    emit(
      `⚠️ TRACKER.md VALIDATION FAILED — ${failed.length}/${checks.length} tracker check(s) failing: ${names}. ` +
        "The tracker may be lying about state. Do NOT claim any epic/sprint state from memory; " +
        "reconcile TRACKER.md (and its epic/sprint files) against reality FIRST, then continue. " +
        "Run `node scripts/trackers/validate.js` for the failing details. Authority: TRACKER.md > memory."
    );
  }
}

main();
