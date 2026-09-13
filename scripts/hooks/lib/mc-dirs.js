"use strict";

/**
 * scripts/hooks/lib/mc-dirs.js — read-both DIRECTORY / FILE fallback for the mc@2.0.0 one-release window
 * (S-OS-06 T3 part 4c project dirs + part 5 HOME state). The env twin is ./mc-env.js; the precedence rule is
 * ./split-brain-core.js#diagnose (one rule, one place).
 *
 * For a canonical path P (under `_mc/`, `.mc/`, `~/.mc/`, `~/.codex-mc`) and its legacy twin L:
 *   P exists                 -> P (canonical precedence; a co-existing L is IGNORED, never merged or moved)
 *   only L exists            -> L + ONE deprecation line per process (stderr) — state is read/written IN PLACE
 *   neither                  -> P (new state starts on the canonical name)
 * NEVER auto-moves anything (state ceiling): migrating L -> P is an explicit operator action.
 * Dual-state CONTENT diagnosis (identical vs divergent) is scripts/open-source/split-brain.js's job — the hot
 * path here checks existence only (a full directory walk per hook process would be a tax on every tool call).
 *
 * The legacy names are DERIVED from mc-env's LEGACY_PREFIX, so this file adds no second legacy literal.
 * Removal: the legacy twins stop being read in mc@2.1.0.
 */

const fs = require("fs");
const path = require("path");
const core = require("./split-brain-core");
const { LEGACY_PREFIX, REMOVED_IN } = require("./mc-env");

const CURRENT_SLUG = "mc";
const LEGACY_SLUG = LEGACY_PREFIX.slice(0, -1).toLowerCase();
// A canonical top segment and its legacy twin: `_mc` <-> `_<legacy>`, `.mc` <-> `.<legacy>`, `.codex-mc` <-> `.codex-<legacy>`.
const SEGMENT_RE = new RegExp(`^(_|\\.|\\.codex-)${CURRENT_SLUG}$`);

let warnedLegacy = false;

function defaultSink(line) {
  try {
    process.stderr.write(`${line}\n`);
  } catch {
    /* a warning must never break a read */
  }
}
let warnSink = defaultSink;

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** `_mc` -> `_<legacy>` (etc.); any other segment -> null (not a renamed root). */
function legacySegment(segment) {
  const m = SEGMENT_RE.exec(String(segment || ""));
  return m ? `${m[1]}${LEGACY_SLUG}` : null;
}

function warnOnce(currentPath, legacyPath, { warn = true } = {}) {
  if (!warn || warnedLegacy) return;
  warnedLegacy = true;
  warnSink(
    `[mc] DEPRECATION: ${legacyPath} is in use because ${currentPath} does not exist — reading/writing it in place ` +
      `(never moved). Rename it to ${currentPath}; legacy locations stop being read in ${REMOVED_IN}. (One warning per process.)`
  );
}

/**
 * Existence-only read-both over two paths (files or directories).
 * -> { path, state, source, deprecated }. opts.warn=false defers the deprecation line to the caller (warnLegacy()).
 */
function resolvePair(currentPath, legacyPath, opts = {}) {
  if (!currentPath || !legacyPath) throw new TypeError("mc-dirs.resolvePair(currentPath, legacyPath): both paths are required");
  const side = (p, tag) => (exists(p) ? { present: true, value: p, fingerprint: tag } : { present: false });
  // Distinct fingerprints: existence says nothing about content, so a dual state is never labelled "identical".
  const d = core.diagnose({ current: side(currentPath, "current"), legacy: side(legacyPath, "legacy"), currentLabel: currentPath, legacyLabel: legacyPath });
  if (d.state === core.STATES.ABSENT) return { path: currentPath, state: d.state, source: "current", deprecated: false };
  if (d.state === core.STATES.LEGACY_ONLY) warnOnce(currentPath, legacyPath, opts);
  return { path: d.resolved, state: d.state, source: d.source, deprecated: d.state === core.STATES.LEGACY_ONLY };
}

/** Print the (once-per-process) deprecation line for a resolution made with { warn: false }. */
function warnLegacy(resolution, currentPath, legacyPath) {
  if (resolution && resolution.state === core.STATES.LEGACY_ONLY) warnOnce(currentPath, legacyPath);
}

/**
 * A project-relative registry path (`_mc/...`, `.mc/...`) -> the absolute path to use. Paths whose first segment is
 * not a renamed root are joined unchanged (zero filesystem cost).
 */
function resolveProjectPath(root, rel, opts = {}) {
  const current = path.join(root, rel);
  const segments = String(rel).split(/[\\/]+/).filter(Boolean);
  const legacyTop = segments.length ? legacySegment(segments[0]) : null;
  if (!legacyTop) return current;
  const legacy = path.join(root, legacyTop, ...segments.slice(1));
  return resolvePair(current, legacy, opts).path;
}

/** A HOME-anchored state location: resolveHomePath(home, ".mc", "portfolio.json"). */
function resolveHomePath(home, topSegment, ...rest) {
  const legacyTop = legacySegment(topSegment);
  const current = path.join(home, topSegment, ...rest);
  if (!legacyTop) return { path: current, state: core.STATES.NEW_ONLY, source: "current", deprecated: false };
  return resolvePair(current, path.join(home, legacyTop, ...rest));
}

function _resetWarningsForTest() {
  warnedLegacy = false;
}

function _setWarnSinkForTest(fn) {
  warnSink = typeof fn === "function" ? fn : defaultSink;
}

module.exports = {
  CURRENT_SLUG,
  legacySegment,
  resolvePair,
  warnLegacy,
  resolveProjectPath,
  resolveHomePath,
  _resetWarningsForTest,
  _setWarnSinkForTest,
};
