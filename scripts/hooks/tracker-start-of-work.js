#!/usr/bin/env node
"use strict";

/**
 * scripts/hooks/tracker-start-of-work.js — SessionStart enforcement hook for the
 * enforced-tracker system (_planning/tracker-system-improvements.md §28.2
 * Start-of-Work Enforcement). It is the HARD counterpart to the procedural
 * "consult TRACKER.md" step the four live modes carry: at every session start it
 * RUNS the tracker validator and injects the tracker's validity verdict into the
 * agent's context, so an agent cannot begin meaningful work unaware that the
 * source-of-truth tracker is red (lying about state).
 *
 *   - PASS  → a one-line confirmation + the start-of-work reminder.
 *   - FAIL  → a LOUD warning naming the failing checks + "reconcile before claiming state".
 *
 * FAIL-OPEN: a validator runner error (missing file, internal throw) never blocks
 * the session — it surfaces a brief note and exits 0. The hard gate is `/scan:full`
 * + the Stop hook; this hook's job is to make the tracker state IMPOSSIBLE to miss
 * at start-of-work, not to trap the session.
 *
 * Roots at CLAUDE_PROJECT_DIR (NOT cwd — the session may launch in a stale
 * worktree; see G-3). Emits the SessionStart additionalContext envelope.
 */

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
  // Drain stdin (SessionStart payload) so the pipe never blocks; we don't need it.
  try {
    require("fs").readFileSync(0, "utf8");
  } catch {
    /* no stdin — fine */
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
    // Fail-open: the validator may legitimately be absent (fresh clone) or error.
    // Surface a brief note; never block.
    let parsed = null;
    if (e && e.stdout) {
      try {
        parsed = JSON.parse(String(e.stdout));
      } catch {
        /* ignore */
      }
    }
    if (parsed && Array.isArray(parsed.checks)) {
      res = parsed; // non-zero exit but valid JSON (a real FAIL) — use it.
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
