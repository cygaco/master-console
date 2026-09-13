#!/usr/bin/env node
/**
 * framework-purity-guard.js — PreToolUse Bash hook.
 *
 * Fires on `git commit` commands. Runs scripts/checks/framework-purity
 * .js --staged to scan ONLY the staged tree (what the commit will write —
 * WI-23). Blocks the commit if any of the four detectors fires:
 *
 *   - root_leak       (gated by ROOT_LEAK_PENDING_SCRUB)
 *   - client_slug     product slugs in canonical content
 *   - abs_path        maintainer-home absolute paths
 *   - promote_relic   reintroduction of purged paths/tokens
 *
 * Goal: close the door behind SP-20260522-001's purge commit. Once the
 * promote suite is gone, this gate refuses any future commit that would
 * reintroduce it.
 *
 * Escape hatches (mirror framework-manifest-guard):
 *   - env: MC_PURITY_GUARD=off
 *   - sentinel: .mc/purity-guard-disable
 *
 * Repo-role gate: the purity detectors only make sense in the canonical
 * framework tree — in a downstream PRODUCT repo they'd flag the product's
 * own slugs/keys and block every commit. So the guard no-ops in consumer
 * installs and only enforces in canonical. Canonical is signalled by any
 * of: _mc/MANIFEST.json present, version.json with "name":"mc", or
 * a .mc-canonical marker file. A repo with .claude/framework-installed
 * .json but NO _mc/MANIFEST.json is a consumer install (allow + note).
 */

"use strict";
const mcEnv = require("./lib/mc-env"); // S-OS-06 read-both env (MC_X, then the legacy name)

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PURITY_SCRIPT = path.join(
  PROJECT_DIR,
  "scripts",
  "checks",
  "framework-purity.js",
);
const SENTINEL_PATH = path.join(
  PROJECT_DIR,
  ".mc",
  "purity-guard-disable",
);

// ── Canonical vs consumer detection ───────────────────────────────────
// Delegated to the shared repo-role resolver (ED-009). All canonical signals
// (_mc/MANIFEST.json, .mc-canonical, manifest.json fields, version.json)
// are checked there in a single place. Do not re-derive inline.
const { resolveRepoRole } = require("../mc/repo-role");
function isCanonicalRepo() {
  return resolveRepoRole({ root: PROJECT_DIR }).role === "canonical";
}

if (mcEnv.readEnv("PURITY_GUARD") === "off") process.exit(0);

if (fs.existsSync(SENTINEL_PATH)) {
  try {
    const { logEvent } = require("./lib/logger");
    logEvent(
      "bypass",
      "system",
      "framework-purity-guard-sentinel",
      "",
      ".mc/purity-guard-disable present",
    );
  } catch {
    /* logger optional */
  }
  process.exit(0);
}

if (!fs.existsSync(PURITY_SCRIPT)) {
  // Older install without the check script — skip silently.
  process.exit(0);
}

// Read the hook payload from stdin.
let payload = {};
try {
  const raw = fs.readFileSync(0, "utf8");
  payload = raw ? JSON.parse(raw) : {};
} catch {
  /* tolerate empty/invalid payload */
}

const cmd =
  (payload && payload.tool_input && payload.tool_input.command) || "";

// Only act on `git commit` commands. Skip other Bash invocations.
if (!/\bgit\s+commit\b/.test(cmd)) {
  process.exit(0);
}

// Consumer install (framework-installed.json without _mc/MANIFEST.json, or
// no canonical signal at all) — the purity scan would flag the product's own
// content. No-op so commits flow; only canonical enforces. Checked here (after
// the commit filter) so unrelated Bash calls in a consumer repo stay quiet.
if (!isCanonicalRepo()) {
  process.stderr.write(
    "framework-purity-guard: consumer repo (no canonical marker) — skipping purity scan\n",
  );
  process.exit(0);
}

// WI-23: scope the COMMIT gate to STAGED files only. A `git commit` writes the
// staged tree — unstaged edits elsewhere are NOT part of this commit, so the
// pre-commit guard must judge only what's being committed. The full staged +
// unstaged change-set view stays in the manual /scan:framework-purity (--diff).
const r = spawnSync(
  process.execPath,
  [PURITY_SCRIPT, "--staged", "--json"],
  {
    cwd: PROJECT_DIR,
    encoding: "utf8",
    timeout: 30_000,
  },
);

if (r.status === 0) {
  // Clean — allow commit.
  process.exit(0);
}

if (r.status === 2) {
  // Tool-level error — log but don't block (fail-open on our own error).
  process.stderr.write(
    `framework-purity-guard: check tool errored (exit ${r.status}); allowing commit\n${r.stderr || ""}\n`,
  );
  process.exit(0);
}

// status === 1 → violations. Block.
let parsed = null;
try {
  parsed = JSON.parse(r.stdout || "{}");
} catch {
  /* */
}

const summary =
  parsed && parsed.summary
    ? Object.entries(parsed.summary)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
    : "violations detected";

process.stderr.write(
  [
    "framework-purity-guard: commit refused.",
    `  ${summary}`,
    "",
    "  Run for details (staged tree — what the commit refused):",
    "    node scripts/checks/framework-purity.js --staged",
    "",
    "  To bypass (logged):",
    "    set MC_PURITY_GUARD=off, OR",
    "    touch .mc/purity-guard-disable",
    "",
  ].join("\n"),
);

process.exit(2); // PreToolUse exit 2 = block the tool call.
