#!/usr/bin/env node
"use strict";

/**
 * scripts/hooks/tracker-completion-gate.js — Stop (end-of-work) enforcement hook
 * for the enforced-tracker system (_planning/tracker-system-improvements.md
 * §28.5 End-of-Work + §28.6 Completion Gate). At session stop it RUNS the tracker
 * validator and refuses to let a session end quietly on a RED tracker — a tracker
 * that lies about state, claims completion without evidence, or whose epic/sprint
 * files disagree with TRACKER.md (the cross-file-reconciliation class).
 *
 * Mirrors the house convention of scripts/hooks/retro-presence-check.js:
 *   - default = ADVISORY: a RED tracker prints a LOUD stderr warning naming the
 *     failing checks, then exits 0 (does not trap the session).
 *   - TRACKER_GATE_ENFORCE=1 → ENFORCE: a RED tracker exits 2 (blocks Stop) so the
 *     agent must reconcile before ending.
 *   - GREEN tracker → silent exit 0.
 *
 * FAIL-OPEN on a validator runner error (missing file / internal throw) — never
 * trap a session because the validator itself could not run. Respects
 * `stop_hook_active` to avoid re-entrancy loops. Roots at CLAUDE_PROJECT_DIR
 * (NOT cwd — stale-worktree-safe, G-3).
 */

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
  // Avoid infinite Stop→hook→Stop loops: if a prior stop hook is already active,
  // do not re-block.
  if (payload && payload.stop_hook_active) process.exit(0);

  // If TRACKER.md does not exist, there is nothing to gate — fail-open.
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
    // Non-zero exit but valid JSON = a real FAIL; otherwise fail-open.
    if (e && e.stdout) {
      try {
        res = JSON.parse(String(e.stdout));
      } catch {
        res = null;
      }
    }
    if (!res) process.exit(0); // runner error → never trap the session
  }

  const checks = Array.isArray(res.checks) ? res.checks : [];
  const failed = checks.filter((c) => c.status === "FAIL");
  if (res.ok && failed.length === 0) process.exit(0); // green → silent

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
