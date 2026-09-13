"use strict";

/**
 * partition-loader.js — the ONE entry point for the S-OS-06 rename partition.
 *
 * The partition artifact is the deny-list (scripts/open-source/rename-mc.denylist.json,
 * committed, T1) plus the allow-list (scripts/open-source/rename-mc.allowlist.json,
 * T2-authored, not yet created as of T1). Today three lists exist across the codebase
 * and drift (cutover-completeness.allowlist.json, framework-purity inline regex arrays,
 * and this codemod's own deny-list) — beta r2 Req1 requires unifying to ONE artifact
 * behind ONE loader. This module IS that loader.
 *
 * RULE: every reader — the codemod (rename-mc.js), the gates (cutover-completeness.js,
 * framework-purity.js, the T5 falsifier fixtures) — MUST call loadPartition() from here.
 * A reader that does `require("./rename-mc.denylist.json")` or
 * `require("./rename-mc.allowlist.json")` directly, bypassing this module, is the exact
 * un-routed-reader violation beta r2 Req1 names. The structural guard that FAILS a
 * direct require lands in T2/T5; this module exposes the single entry point that guard
 * checks callers against — see ROUTED_ENTRY_POINT below.
 */

const fs = require("fs");
const path = require("path");

const DENYLIST_PATH = path.join(__dirname, "rename-mc.denylist.json");
const ALLOWLIST_PATH = path.join(__dirname, "rename-mc.allowlist.json");

// The T2/T5 un-routed-reader guard greps for this exported constant's VALUE (not this
// module's own path) to recognize a legitimate load site. Any other file that contains
// a literal `require(...rename-mc.denylist.json...)` or `...rename-mc.allowlist.json...`
// outside this module is the violation.
const ROUTED_ENTRY_POINT = "scripts/open-source/partition-loader.js#loadPartition";

let _cache = null;

function _toPosix(p) {
  return p.split(path.sep).join("/");
}

// Minimal glob -> RegExp: `**` = any depth (incl. zero segments), `*` = within one
// path segment. Sufficient for the pathGlobs shapes this artifact uses (dir/**,
// exact files, no character classes). Uses a plain-ASCII sentinel (no control-char
// escapes) so the intermediate placeholder never risks becoming a stray byte in source.
function _globToRegExp(glob) {
  const SENTINEL = "@@RENAME_MC_DOUBLESTAR@@";
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withDoubleStar = escaped.split("**").join(SENTINEL);
  const withSingleStar = withDoubleStar.replace(/\*/g, "[^/]*");
  const restored = withSingleStar.split(SENTINEL).join(".*");
  return new RegExp("^" + restored + "$");
}

// Distinguish "file absent" (tolerated — T1 predates T2's allow-list) from "file
// present but truncated/empty/unparseable" (fail CLOSED — this is the record-trust
// gate's F3 falsifier: a truncated/empty allow-list must fail closed, not silently
// behave as an empty-but-valid allow-list).
function _readJsonOrThrowIfCorrupt(p, { requiredIfPresent = true } = {}) {
  if (!fs.existsSync(p)) return { present: false, data: null };
  const raw = fs.readFileSync(p, "utf8");
  if (!raw || !raw.trim()) {
    if (requiredIfPresent) {
      throw new Error(
        `partition-loader: ${p} exists but is empty — failing CLOSED (F3), not treating as an empty-but-valid list`
      );
    }
    return { present: true, data: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`partition-loader: ${p} is present but not valid JSON — failing CLOSED (F3): ${e.message}`);
  }
  return { present: true, data: parsed };
}

/**
 * loadPartition({ forceReload }) -> {
 *   denylist, allowlist, allowlistPresent,
 *   classifyPath(trackedPath) -> { class, writeProtected, kind, entry },
 *   findOccurrencePin(file, line) -> pin entry | null,
 *   isGeneratedView(file) -> boolean,
 *   generatedViews, pathGlobs, occurrencePins, futureEntries, openQuestions,
 * }
 */
function loadPartition({ forceReload = false } = {}) {
  if (_cache && !forceReload) return _cache;

  const denylistResult = _readJsonOrThrowIfCorrupt(DENYLIST_PATH, { requiredIfPresent: true });
  if (!denylistResult.present || !denylistResult.data) {
    throw new Error(
      `partition-loader: the committed deny-list is required and MUST be present at ${DENYLIST_PATH} — fail CLOSED, not open`
    );
  }
  const denylist = denylistResult.data;

  // Allow-list is T2-authored; absence is tolerated only because T1 ships standalone
  // ahead of T2. Presence-but-corrupt still fails closed (F3).
  const allowlistResult = _readJsonOrThrowIfCorrupt(ALLOWLIST_PATH, { requiredIfPresent: true });
  const allowlist = allowlistResult.data || { header: "T2-authored allow-list — not yet created as of T1", entries: [] };

  const generatedViews = denylist.generatedViews || [];
  const pathGlobs = (denylist.pathGlobs || []).map((entry) => ({
    ...entry,
    writeProtected: entry.writeProtected !== false,
    _re: _globToRegExp(entry.pattern),
  }));
  const occurrencePins = denylist.occurrencePins || [];
  const futureEntries = denylist.futureEntries || [];
  const openQuestions = denylist.openQuestions || [];

  const generatedViewByPath = new Map(generatedViews.map((g) => [g.path, g]));

  function classifyPath(trackedPath) {
    const p = _toPosix(trackedPath);

    const gv = generatedViewByPath.get(p);
    if (gv) {
      return { class: gv.class, writeProtected: true, kind: "generated-view", entry: gv };
    }

    for (const glob of pathGlobs) {
      if (glob._re.test(p)) {
        return { class: glob.class, writeProtected: glob.writeProtected, kind: "path-glob", entry: glob };
      }
    }

    // Default: Class 1, LIVE — the codemod's rename target. Every tracked path lands
    // here unless a generated-view or deny-list glob claimed it above, which is what
    // makes `unclassified=0` true by construction (see rename-mc.js for the explicit
    // assertion that still checks this, defensively, rather than trusting the construction).
    return { class: 1, writeProtected: false, kind: "default-class-1", entry: null };
  }

  function findOccurrencePin(file, line) {
    const p = _toPosix(file);
    return occurrencePins.find((pin) => pin.file === p && pin.line === line) || null;
  }

  function isGeneratedView(file) {
    return generatedViewByPath.has(_toPosix(file));
  }

  _cache = {
    denylist,
    allowlist,
    allowlistPresent: allowlistResult.present,
    classifyPath,
    findOccurrencePin,
    isGeneratedView,
    generatedViews,
    pathGlobs,
    occurrencePins,
    futureEntries,
    openQuestions,
  };
  return _cache;
}

module.exports = {
  loadPartition,
  ROUTED_ENTRY_POINT,
  DENYLIST_PATH,
  ALLOWLIST_PATH,
};
