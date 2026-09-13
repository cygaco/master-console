/**
 * manifest-patch.js — JSON patch for .claude/manifest.json that preserves
 * indentation and trailing newline.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = process.cwd();
const MANIFEST_PATH = path.join(PROJECT_ROOT, ".claude", "manifest.json");

function detectIndent(raw) {
  const m = raw.match(/^(\s+)"/m);
  return m ? m[1] : "  ";
}

function detectEol(raw) {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    const err = new Error(
      `.claude/manifest.json not found at ${MANIFEST_PATH}\n` +
        `  fix: run \`/mc:setup\` to create it from project scan\n` +
        `  manifest-patch.js operates on an existing manifest — it does not create one`,
    );
    err.code = "MANIFEST_MISSING";
    throw err;
  }
  let raw;
  try {
    raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  } catch (e) {
    const err = new Error(
      `.claude/manifest.json unreadable (${MANIFEST_PATH}): ${e.message}\n` +
        `  fix: check file permissions or restore from .claude/.mc-backup/`,
    );
    err.code = "MANIFEST_UNREADABLE";
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const err = new Error(
      `.claude/manifest.json is not valid JSON (${MANIFEST_PATH}): ${e.message}\n` +
        `  fix: restore from .claude/.mc-backup/ or re-run /mc:setup`,
    );
    err.code = "MANIFEST_INVALID";
    throw err;
  }
  return {
    data,
    raw,
    indent: detectIndent(raw),
    eol: detectEol(raw),
  };
}

function writeManifest(data, indent, eol) {
  let serialized = JSON.stringify(data, null, indent);
  if (eol === "\r\n") serialized = serialized.replace(/\n/g, "\r\n");
  if (!serialized.endsWith(eol)) serialized += eol;
  fs.writeFileSync(MANIFEST_PATH, serialized, "utf8");
}

function setRoleProvider(role, provider) {
  const { data, indent, eol } = readManifest();
  data.agentProviders = data.agentProviders || {};
  data.agentProviders[role] = provider;
  writeManifest(data, indent, eol);
}

module.exports = {
  MANIFEST_PATH,
  readManifest,
  writeManifest,
  setRoleProvider,
};
