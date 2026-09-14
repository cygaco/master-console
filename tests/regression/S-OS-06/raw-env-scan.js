"use strict";
/**
 * raw-env-scan — the AC-3.3 scanner behind env-read-both.test.js::no-raw-env-read-outside-helper.
 *
 * A "raw env access" is any `process.env.<MC|legacy>_*` (dot), `process.env["<MC|legacy>_…"]` /
 * process.env[`<MC|legacy>_${…}`] (bracket) or `{ <MC|legacy>_X } = process.env` (destructure) token in a
 * tracked JS file of the LIVE partition (Class 1/2, not write-protected — generated views and Class-3/4
 * historical data are out of scope, exactly the set the codemod treats as live). Comments are NOT exempt: a
 * comment quoting the raw form is rewritten too, so the scan needs no parser.
 *
 * Fail-closed: a git failure throws, and the caller asserts the scanned-file count is non-zero.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const H = require("./falsifier-harness");

const LEGACY_PREFIX = `${H.SLUG.toUpperCase()}_`;
const PREFIX_ALT = `(?:MC_|${LEGACY_PREFIX})`;
// `i`: process.env is case-insensitive on Windows, so a lowercase / mixed-case prefix is the same raw read
// (security gauntlet F3; falsify-raw-env-case-insensitive.test.js).
const RAW_ENV_PATTERNS = Object.freeze([
  { id: "dot", re: new RegExp(`process\\.env\\s*\\.\\s*${PREFIX_ALT}`, "i") },
  { id: "bracket", re: new RegExp(`process\\.env\\s*\\[\\s*[\`'"]${PREFIX_ALT}`, "i") },
  { id: "destructure", re: new RegExp(`\\{[^}]*\\b${PREFIX_ALT}[A-Za-z0-9_]+[^}]*\\}\\s*=\\s*process\\.env\\b`, "i") },
]);
const HELPER_REL = "scripts/hooks/lib/mc-env.js";
const CODE_EXT_RE = /\.(?:c|m)?js$/;

function findRawEnvReads(text) {
  const hits = [];
  String(text)
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const { id, re } of RAW_ENV_PATTERNS) {
        if (re.test(line)) {
          hits.push({ line: i + 1, id, text: line.trim().slice(0, 160) });
          break;
        }
      }
    });
  return hits;
}

function listLiveCodeFiles(root = H.REAL_ROOT) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const { loadPartition } = require(path.join(root, "scripts", "open-source", "partition-loader.js"));
  const partition = loadPartition({ forceReload: true });
  return out
    .split("\0")
    .filter((rel) => rel && CODE_EXT_RE.test(rel))
    .filter((rel) => {
      const c = partition.classifyPath(rel);
      return c && (c.class === 1 || c.class === 2) && !c.writeProtected;
    })
    .sort();
}

/** { scanned, offenders: { [rel]: hits[] } } — the helper itself is the one exempt file (AC-3.3 "outside the helper"). */
function scanRawEnvReads(root = H.REAL_ROOT) {
  const files = listLiveCodeFiles(root);
  const offenders = {};
  let scanned = 0;
  for (const rel of files) {
    if (rel === HELPER_REL) continue;
    const abs = path.join(root, rel);
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") continue; // tracked-but-deleted in the working tree: holds no read
      throw e;
    }
    scanned += 1;
    const hits = findRawEnvReads(text);
    if (hits.length) offenders[rel] = hits;
  }
  return { scanned, offenders };
}

module.exports = { RAW_ENV_PATTERNS, HELPER_REL, findRawEnvReads, listLiveCodeFiles, scanRawEnvReads };

if (require.main === module) {
  const { scanned, offenders } = scanRawEnvReads();
  const files = Object.keys(offenders);
  process.stdout.write(JSON.stringify({ scanned, files: files.length, lines: files.reduce((n, f) => n + offenders[f].length, 0), offenders: files }, null, 2) + "\n");
}
