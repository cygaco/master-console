#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const PROJECT = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const SETTINGS = path.join(PROJECT, ".claude", "settings.json");
const SNAPSHOT = path.join(
  PROJECT,
  ".claude",
  "runtime",
  "settings-pre-turbo-install.json",
);
const HOOK_CMD =
  'node "$CLAUDE_PROJECT_DIR/scripts/hooks/authorization-gate.js"';
const TARGET_MATCHERS = ["Bash", "Edit|Write"];

function parseArgs(argv) {
  const out = { dry: false, remove: false };
  for (const a of argv) {
    if (a === "--dry") out.dry = true;
    else if (a === "--remove") out.remove = true;
  }
  return out;
}

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
}

function writeSettings(obj) {
  const tmp = SETTINGS + ".turbo-install.tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, SETTINGS);
}

function findMatcherChain(settings, matcher) {
  const chains = (settings.hooks && settings.hooks.PreToolUse) || [];
  return chains.find((c) => c.matcher === matcher);
}

function alreadyFirst(chain) {
  if (!chain || !Array.isArray(chain.hooks) || chain.hooks.length === 0) {
    return false;
  }
  const first = chain.hooks[0];
  return first && first.command === HOOK_CMD;
}

function chainHasHook(chain) {
  if (!chain || !Array.isArray(chain.hooks)) return false;
  return chain.hooks.some((h) => h && h.command === HOOK_CMD);
}

function registerFirst(chain) {
  if (alreadyFirst(chain)) return false;
  chain.hooks = chain.hooks.filter((h) => h && h.command !== HOOK_CMD);
  chain.hooks.unshift({ type: "command", command: HOOK_CMD });
  return true;
}

function unregister(chain) {
  if (!chainHasHook(chain)) return false;
  chain.hooks = chain.hooks.filter((h) => h && h.command !== HOOK_CMD);
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(SETTINGS)) {
    process.stderr.write(
      `[turbo-install] FATAL: ${SETTINGS} does not exist.\n`,
    );
    process.exit(2);
  }

  const settings = readSettings();

  if (!settings.hooks || !Array.isArray(settings.hooks.PreToolUse)) {
    process.stderr.write(
      "[turbo-install] FATAL: settings.json has no hooks.PreToolUse array.\n",
    );
    process.exit(2);
  }

  const changes = [];
  for (const matcher of TARGET_MATCHERS) {
    const chain = findMatcherChain(settings, matcher);
    if (!chain) {
      process.stderr.write(
        `[turbo-install] WARN: no PreToolUse chain with matcher="${matcher}". Skipping.\n`,
      );
      continue;
    }
    if (args.remove) {
      if (unregister(chain)) changes.push(`removed from "${matcher}"`);
      else changes.push(`already absent from "${matcher}"`);
    } else {
      if (registerFirst(chain))
        changes.push(`registered FIRST in "${matcher}"`);
      else changes.push(`already FIRST in "${matcher}"`);
    }
  }

  process.stdout.write(`[turbo-install] hook: ${HOOK_CMD}\n`);
  for (const c of changes) process.stdout.write(`[turbo-install]   - ${c}\n`);

  if (args.dry) {
    process.stdout.write(
      "[turbo-install] --dry: no write performed. Re-run without --dry to apply.\n",
    );
    process.exit(0);
  }

  if (!args.remove) {
    ensureDir(path.dirname(SNAPSHOT));
    if (!fs.existsSync(SNAPSHOT)) {
      fs.writeFileSync(SNAPSHOT, fs.readFileSync(SETTINGS, "utf8"), "utf8");
      process.stdout.write(`[turbo-install] snapshot: ${SNAPSHOT}\n`);
    } else {
      process.stdout.write(
        `[turbo-install] snapshot: kept existing (${SNAPSHOT})\n`,
      );
    }
  }

  writeSettings(settings);
  process.stdout.write("[turbo-install] settings.json written.\n");
  process.exit(0);
}

if (require.main === module) main();

module.exports = { main, alreadyFirst, registerFirst, unregister };
