#!/usr/bin/env node
/* MC 0.7.0 -> 0.7.1 migration 001 — add CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1.
 *
 * Without this env entry in .claude/settings.json, Claude Code does not load
 * the TeamCreate / SendMessage / TeamDelete primitives. /mode:adhoc Step 2 then
 * has nothing to call and falls back to misleading "no team UI today" behavior.
 *
 * Source: RT-005 + RT-006 + L-2026-05-14-env-flag-existing-install-migration.
 *
 * Fresh installs already get the flag via scripts/warp-setup.js:1000-1002.
 * This migration is the upgrade-path equivalent for existing projects.
 *
 * Idempotent: no-op when the entry is already present and equals "1".
 *
 * Invoked by update.js via migrations-loader (apply()) AND runnable as a CLI
 * (main()).
 */
const fs = require("fs");
const path = require("path");

const ENV_KEY = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";
const ENV_VALUE = "1";
const SETTINGS_REL = ".claude/settings.json";

function resolveRoot(ctx) {
  return (
    (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd()
  );
}

function addEnvFlag(root) {
  const settingsPath = path.join(root, SETTINGS_REL);
  if (!fs.existsSync(settingsPath)) {
    return { ok: true, status: "noop", reason: `${SETTINGS_REL} not found` };
  }
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch (e) {
    return { ok: false, status: "read-failed", reason: e.message };
  }
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      status: "parse-failed",
      reason: `${SETTINGS_REL} is not valid JSON: ${e.message}`,
    };
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {
      ok: false,
      status: "not-an-object",
      reason: `${SETTINGS_REL} root is not a JSON object`,
    };
  }
  if (!settings.env || typeof settings.env !== "object") {
    settings.env = {};
  }
  if (settings.env[ENV_KEY] === ENV_VALUE) {
    return {
      ok: true,
      status: "noop",
      reason: `env.${ENV_KEY} already "${ENV_VALUE}"`,
    };
  }
  const priorValue =
    settings.env[ENV_KEY] === undefined ? null : settings.env[ENV_KEY];
  settings.env[ENV_KEY] = ENV_VALUE;
  const out = JSON.stringify(settings, null, 2) + "\n";
  fs.writeFileSync(settingsPath, out, "utf8");
  return {
    ok: true,
    status: priorValue === null ? "added" : "updated",
    priorValue,
    newValue: ENV_VALUE,
    file: SETTINGS_REL,
  };
}

async function apply(ctx) {
  return addEnvFlag(resolveRoot(ctx));
}

function main() {
  const r = addEnvFlag(resolveRoot(null));
  const detail = r.reason || `${r.priorValue ?? "(absent)"} -> ${r.newValue}`;
  console.log(`[001] ${r.status}: ${detail}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "001-add-experimental-agent-teams-env",
  from: "0.7.0",
  to: "0.7.1",
  description:
    "Add env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 to .claude/settings.json so Claude Code loads TeamCreate/SendMessage primitives — required for /mode:adhoc persistent teams.",
  apply,
  main,
};
