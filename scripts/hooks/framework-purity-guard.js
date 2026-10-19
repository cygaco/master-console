#!/usr/bin/env node

"use strict";
const mcEnv = require("./lib/mc-env");

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
  }
  process.exit(0);
}

if (!fs.existsSync(PURITY_SCRIPT)) {
  process.exit(0);
}

let payload = {};
try {
  const raw = fs.readFileSync(0, "utf8");
  payload = raw ? JSON.parse(raw) : {};
} catch {
}

const cmd =
  (payload && payload.tool_input && payload.tool_input.command) || "";

if (!/\bgit\s+commit\b/.test(cmd)) {
  process.exit(0);
}

if (!isCanonicalRepo()) {
  process.stderr.write(
    "framework-purity-guard: consumer repo (no canonical marker) — skipping purity scan\n",
  );
  process.exit(0);
}

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
  process.exit(0);
}

if (r.status === 2) {
  process.stderr.write(
    `framework-purity-guard: check tool errored (exit ${r.status}); allowing commit\n${r.stderr || ""}\n`,
  );
  process.exit(0);
}

let parsed = null;
try {
  parsed = JSON.parse(r.stdout || "{}");
} catch {
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

process.exit(2);
