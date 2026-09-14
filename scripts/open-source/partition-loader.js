"use strict";

/**
 * partition-loader.js — the ONE entry point for the S-OS-06 rename partition.
 *
 * ONE ARTIFACT (β r3 Req1 / T2 resolution R2): the committed deny-list next to this
 * module (DENYLIST_PATH) is the SOLE partition artifact. There is NO separate allow-list
 * file: "where the legacy slug may remain" is a VIEW of that one artifact — its Class-3/4
 * path entries (pathGlobs + futureEntries) plus its occurrencePins — exposed here as
 * `allowList` / `isAllowed(path)`. Two lists drift; one artifact read through one loader
 * cannot.
 *
 * RULE: every reader — the codemod (rename-mc.js), the gates (cutover-completeness.js,
 * framework-purity.js), the record-trust exit (record-trust-exit.js) and the S-OS-06
 * falsifier fixtures — consumes the partition through THIS module. A file that names the
 * artifact directly (require/readFile of its basename) is the un-routed-reader violation;
 * `findUnroutedReaders()` below is the structural guard, asserted by
 * tests/regression/S-OS-06/partition-single-loader.test.js and record-trust-exit.js item 2.
 * Git-history reads of the artifact (the F8 freeze check) are routed here too
 * (`readPartitionAt`), so no gate ever opens the artifact on its own.
 *
 * What lives here (all partition semantics, so the codemod and the gates cannot disagree):
 *   - classifyPath(path)               four-class membership + writeProtected (orthogonal)
 *   - findOccurrencePin(file, text)    R4: pins key on (file, matchText [, anchor]) — never
 *                                      a bare line number, so an edit above a pinned line
 *                                      cannot silently break the pin
 *   - historicalChangelogLines(text)   CHANGELOG sections < 2.0.0 are historical record
 *   - tallyLegacySlug(...)             per-file disposition tally (pending / pinned /
 *                                      derived / suppressed-per-entry) — the NUMBERS both
 *                                      gates emit
 *   - findCompatOccurrence(file, text) β r3b: the FIFTH disposition. A `compat` occurrence is
 *                                      permitted IFF it sits inside a REGISTERED compat window
 *                                      (compatWindows: enumerated member paths + anchored
 *                                      occurrences), each window carrying its OWN `expires`
 *                                      version. Outside the register -> live-unallowed (RED);
 *                                      at tree version >= a window's expiry -> that window's
 *                                      occurrences are live-unallowed again (RED), per entry.
 *   - validateEntries()                F2: every entry carries a one-line warrant; schema;
 *                                      "no occurrence holds two" (a compat member / occurrence
 *                                      that is also a view, glob, future entry or pin)
 *   - checkStale({ trackedFiles })     F7: an entry that matches nothing is a NON-ZERO exit
 *   - checkFreeze()                    F8: post-freeze additions must be separate, warranted
 *                                      `partition-amendment:` commits
 *   - findUnroutedReaders()            Req1 guard
 *
 * Fail-closed (F3): a missing, empty, unparseable, or header-less artifact THROWS
 * PartitionLoadError; callers map that to exit 2. It never degrades to an empty list.
 *
 * CLI:  node scripts/open-source/partition-loader.js --keys   (sorted freeze keys, JSON)
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DENYLIST_PATH = path.join(__dirname, "rename-mc.denylist.json");
const COMMITTED_LEDGER_PATH = path.join(__dirname, "rename-mc.occurrences.json");
// The repository the partition describes: two levels above this module. Fixtures copy
// this module (untracked) into a temp git repo, so the root follows the COPY (R5).
const PARTITION_ROOT = path.resolve(__dirname, "..", "..");

// The guard recognizes this module as the one legitimate load site.
const ROUTED_ENTRY_POINT = "scripts/open-source/partition-loader.js#loadPartition";

const AMENDMENT_MARKER = "partition-amendment:";
const VALID_CLASSES = [1, 2, 3, 4];
const ALLOW_CLASSES = [3, 4];
const CHANGELOG_REL = "CHANGELOG.md";
const PLACEHOLDER_WARRANT = /^(todo|tbd|fixme|n\/a|na|none|null|undefined|-+|\.+|\?+|x+)$/i;
const CODE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".cts", ".mts", ".ps1", ".sh", ".py"]);

class PartitionLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = "PartitionLoadError";
    this.code = "PARTITION_UNREADABLE";
  }
}

let _cache = null;

function _toPosix(p) {
  return String(p).split(path.sep).join("/").replace(/\\/g, "/");
}

// Minimal glob -> RegExp: `**` = any depth (incl. zero segments), `*` = within one
// path segment. Uses a plain-ASCII sentinel (no control-char escapes).
function _globToRegExp(glob) {
  const SENTINEL = "@@RENAME_MC_DOUBLESTAR@@";
  const escaped = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withDoubleStar = escaped.split("**").join(SENTINEL);
  const withSingleStar = withDoubleStar.replace(/\*/g, "[^/]*");
  const restored = withSingleStar.split(SENTINEL).join(".*");
  return new RegExp("^" + restored + "$");
}

// Parse artifact TEXT. Empty / unparseable / non-object / header-less => throw (F3).
function _parseArtifactText(raw, label) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new PartitionLoadError(
      `partition-loader: ${label} is empty — failing CLOSED (F3), never treated as an empty-but-valid partition`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ""));
  } catch (e) {
    throw new PartitionLoadError(`partition-loader: ${label} is not valid JSON — failing CLOSED (F3): ${e.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PartitionLoadError(`partition-loader: ${label} is not a JSON object — failing CLOSED (F3)`);
  }
  if (typeof parsed.$question !== "string" || !parsed.$question.trim()) {
    throw new PartitionLoadError(
      `partition-loader: ${label} carries no $question header — an artifact that does not state its question is not the partition (F3)`
    );
  }
  for (const section of ["generatedViews", "pathGlobs", "occurrencePins", "futureEntries", "compatWindows"]) {
    if (parsed[section] !== undefined && !Array.isArray(parsed[section])) {
      throw new PartitionLoadError(`partition-loader: ${label} section "${section}" is not an array — failing CLOSED (F3)`);
    }
  }
  return parsed;
}

function _readArtifactFile(p) {
  if (!fs.existsSync(p)) {
    throw new PartitionLoadError(
      `partition-loader: the committed partition artifact is required at ${p} — fail CLOSED, not open`
    );
  }
  return _parseArtifactText(fs.readFileSync(p, "utf8"), p);
}

/** Sorted, de-duplicated freeze keys over the WHOLE artifact (R4: no line numbers). */
function entryKeys(denylist) {
  const d = denylist || {};
  const keys = [];
  for (const g of d.generatedViews || []) keys.push(`view|${g && g.path}`);
  for (const g of d.pathGlobs || []) keys.push(`glob|${g && g.pattern}`);
  for (const g of d.futureEntries || []) keys.push(`future|${g && g.pattern}`);
  for (const p of d.occurrencePins || []) keys.push(`pin|${p && p.file}|${p && p.matchText}|${(p && p.anchor) || ""}`);
  keys.push(...compatKeys(d));
  return [...new Set(keys)].sort();
}

/**
 * Freeze keys for the compat register: one key PER MEMBER and PER OCCURRENCE (closed by enumeration), and each key
 * carries its window's surface id AND expiry version — so extending an expiry, or moving a member between surfaces,
 * is a NEW key (a post-freeze addition that needs its own warranted amendment, F8), never a silent edit.
 */
function compatKeys(denylist) {
  const keys = [];
  for (const w of (denylist && denylist.compatWindows) || []) {
    const head = `compat|${w && w.surface}|${w && w.expires}`;
    for (const m of (w && Array.isArray(w.members) && w.members) || []) keys.push(`${head}|path|${m}`);
    for (const o of (w && Array.isArray(w.occurrences) && w.occurrences) || []) {
      keys.push(`${head}|occ|${o && o.file}|${o && o.matchText}|${(o && o.anchor) || ""}`);
    }
  }
  return keys;
}

// ── compat expiry clock (β r3b condition 2: PER-ENTRY expiry, never a global switch) ──
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

function parseSemver(v) {
  const m = SEMVER_RE.exec(String(v === undefined || v === null ? "" : v).trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function _cmpSemver(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** The tree's own version (package.json#version at `root`) — the clock every compat expiry is read against. */
function readTreeVersion(root = PARTITION_ROOT) {
  let v;
  try {
    v = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8").replace(/^﻿/, "")).version;
  } catch (e) {
    return { version: null, reason: `package.json unreadable (${e.code || e.name}) — every compat window reads EXPIRED (fail closed)` };
  }
  if (!parseSemver(v)) return { version: null, reason: `package.json version ${JSON.stringify(v)} unparseable — every compat window reads EXPIRED (fail closed)` };
  return { version: v, reason: `package.json ${v}` };
}

/** Fail-closed: an unknown/unparseable tree version or expiry reads as EXPIRED; otherwise expired iff version >= expires. */
function isCompatExpired(expires, version) {
  const e = parseSemver(expires);
  const v = parseSemver(version);
  if (!e || !v) return true;
  return _cmpSemver(v, e) >= 0;
}

function compatLabel(w) {
  return `${w && w.surface} (expires ${w && w.expires})`;
}

/**
 * The FIVE-disposition view of a legacy-slug tally (β r3b re-ratification). `rewritten` occurrences no longer exist
 * in the tree, so what a gate sees is: pinned (occurrence pins + Class-3 path entries), derived (generated views),
 * compat (unexpired registered windows), historical-allow-listed (Class-4 path entries + CHANGELOG < 2.0.0 sections
 * + the Class-2 operator-gated tree) — and the un-dispositioned residue (live-unallowed, incl. expired compat).
 */
function dispositionSummary(tally) {
  const byClass = (tally && tally.suppressedByClass) || {};
  const cls = (n) => byClass[n] || 0;
  return {
    pinned: (tally.pinnedTotal || 0) + cls(3),
    derived: tally.derivedTotal || 0,
    compat: tally.compatTotal || 0,
    historicalAllowListed: cls(4) + cls(2) + (tally.changelogHistoricalTotal || 0),
    historicalAllowListedBreakdown: { class4: cls(4), class2Gated: cls(2), changelogHistorical: tally.changelogHistoricalTotal || 0 },
    pinnedBreakdown: { occurrencePins: tally.pinnedTotal || 0, class3Paths: cls(3) },
    liveUnallowed: tally.pendingTotal || 0,
    compatExpired: tally.compatExpiredTotal || 0,
    compatBySurface: { ...(tally.compatBySurface || {}) },
    compatExpiredBySurface: { ...(tally.compatExpiredBySurface || {}) },
  };
}

/** Line numbers (1-based) inside CHANGELOG sections for releases < 2.0.0. */
function historicalChangelogLines(content) {
  const set = new Set();
  if (typeof content !== "string") return set;
  let currentIsHistorical = false;
  content.split(/\r?\n/).forEach((lineText, idx) => {
    const heading = lineText.match(/^##\s*\[([^\]]+)\]/);
    if (heading) {
      const label = heading[1].trim();
      if (/^unreleased$/i.test(label)) {
        currentIsHistorical = false;
      } else {
        const semver = label.match(/^(\d+)\.(\d+)\.(\d+)/);
        currentIsHistorical = semver ? Number(semver[1]) < 2 : true;
      }
    }
    if (currentIsHistorical) set.add(idx + 1);
  });
  return set;
}

function _pinMatchesLine(pin, lineText) {
  if (!pin || typeof pin.matchText !== "string" || !pin.matchText) return false;
  if (!lineText.includes(pin.matchText)) return false;
  return !pin.anchor || lineText.includes(pin.anchor);
}

// Pins are recorded against pre-rename paths. After the codemod's path renames the same
// file lives at renamePath(file); resolve lazily so this module has no load-time
// dependency on the codemod (fixtures may copy the loader without it).
let _renamePathFn;
function _renamePath() {
  if (_renamePathFn === undefined) {
    try {
      _renamePathFn = require("./rename-mc").renamePath || null;
    } catch {
      _renamePathFn = null;
    }
  }
  return _renamePathFn;
}

function _pinFileCandidates(pinFile) {
  const out = [_toPosix(pinFile)];
  const rn = _renamePath();
  if (rn) {
    const to = rn(out[0]);
    if (to && to !== out[0]) out.push(to);
  }
  return out;
}

// Generated views follow the codemod's rename exactly like pins do (T3 post-apply view identity):
// once --apply MOVES a view with its Class-1 directory (the legacy-dir MANIFEST.json -> _mc/MANIFEST.json),
// the SAME declared entry answers for the post-rename path. Its content stays derived; the partition
// artifact is unchanged (no entry added, so no F8 amendment). Resolution is renamePath only — a view
// never gains any identity other than its declared path and that path's codemod rename.
const _viewPathCandidates = _pinFileCandidates;

function _gitRun(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** Repo-relative POSIX paths: tracked (+ untracked-not-ignored when others=true). Throws on git failure. */
function listRepoFiles(root = PARTITION_ROOT, { others = false } = {}) {
  const args = ["ls-files", "-z"];
  if (others) args.push("--cached", "--others", "--exclude-standard");
  const r = _gitRun(root, args);
  if (r.status !== 0) {
    throw new PartitionLoadError(`partition-loader: git ls-files failed in ${root} (status ${r.status}): ${(r.stderr || "").trim()}`);
  }
  const NUL = String.fromCharCode(0);
  return [...new Set(r.stdout.split(NUL).filter(Boolean).map(_toPosix))];
}

/** The partition artifact as it existed at a git revision; null when absent there. */
function readPartitionAt(rev, { root = PARTITION_ROOT } = {}) {
  const rel = _toPosix(path.relative(root, DENYLIST_PATH));
  const r = _gitRun(root, ["show", `${rev}:${rel}`]);
  if (r.status !== 0) return null;
  return _parseArtifactText(r.stdout, `${rev}:${rel}`);
}

/**
 * loadPartition({ forceReload }) -> the partition API (see header).
 */
function loadPartition({ forceReload = false } = {}) {
  if (_cache && !forceReload) return _cache;
  _cache = buildPartition(_readArtifactFile(DENYLIST_PATH));
  return _cache;
}

/** Pure: build the partition API from an already-parsed artifact object. */
function buildPartition(denylist) {
  const generatedViews = denylist.generatedViews || [];
  const withRe = (entry) => ({
    ...entry,
    writeProtected: entry.writeProtected !== false,
    _re: _globToRegExp(entry.pattern),
  });
  const pathGlobs = (denylist.pathGlobs || []).map(withRe);
  const futureEntries = (denylist.futureEntries || []).map(withRe);
  const occurrencePins = denylist.occurrencePins || [];
  const openQuestions = denylist.openQuestions || [];
  const generatedViewByPath = new Map();
  for (const g of generatedViews) {
    for (const p of _viewPathCandidates(g.path)) if (!generatedViewByPath.has(p)) generatedViewByPath.set(p, g);
  }
  // β r3b compat register: CLOSED by enumeration. A member is an EXACT tracked path (never a glob, never resolved
  // through renamePath — a legacy alias path's rename is a different, live file); an occurrence is (file, matchText
  // [, anchor]) like a pin. A path that merely LOOKS like compat but is not enumerated here is an ordinary live path.
  const compatWindows = denylist.compatWindows || [];
  const compatMemberByPath = new Map();
  const compatOccurrences = [];
  for (const w of compatWindows) {
    if (!w || typeof w !== "object") continue;
    for (const m of Array.isArray(w.members) ? w.members : []) {
      if (typeof m === "string" && m && !compatMemberByPath.has(_toPosix(m))) compatMemberByPath.set(_toPosix(m), w);
    }
    for (const o of Array.isArray(w.occurrences) ? w.occurrences : []) {
      if (o && typeof o === "object") compatOccurrences.push({ window: w, occ: o });
    }
  }

  function classifyPath(trackedPath) {
    const p = _toPosix(trackedPath);
    const gv = generatedViewByPath.get(p);
    if (gv) return { class: gv.class, writeProtected: true, kind: "generated-view", entry: gv };
    // A registered compat member: never a rename candidate and never rewritten (Class-3 semantics for the codemod),
    // but its occurrences carry the `compat` disposition — counted per surface and RED once the window expires.
    const cw = compatMemberByPath.get(p);
    if (cw) return { class: 3, writeProtected: true, kind: "compat", entry: cw };
    for (const glob of pathGlobs) {
      if (glob._re.test(p)) return { class: glob.class, writeProtected: glob.writeProtected, kind: "path-glob", entry: glob };
    }
    // futureEntries are declared-before-freeze paths a later ticket creates; once the path
    // exists it must classify exactly as declared (e.g. the 1.2.0-to-2.0.0 migration data).
    for (const fut of futureEntries) {
      if (fut._re.test(p)) return { class: fut.class, writeProtected: fut.writeProtected, kind: "future-entry", entry: fut };
    }
    // Default: Class 1, LIVE. An entry carrying an INVALID class propagates that class to
    // the caller, which counts it as unclassified and refuses (F4) — never coerced to 1.
    return { class: 1, writeProtected: false, kind: "default-class-1", entry: null };
  }

  function findOccurrencePin(file, lineText) {
    if (typeof lineText !== "string") {
      throw new TypeError(
        "partition-loader: findOccurrencePin(file, lineText) — R4 pins key on (file, matchText [, anchor]); pass the LINE TEXT, not a line number"
      );
    }
    const p = _toPosix(file);
    return occurrencePins.find((pin) => _pinFileCandidates(pin.file).includes(p) && _pinMatchesLine(pin, lineText)) || null;
  }

  /** The registered compat window whose anchored occurrence matches this LINE of this exact file, or null. */
  function findCompatOccurrence(file, lineText) {
    if (typeof lineText !== "string") {
      throw new TypeError("partition-loader: findCompatOccurrence(file, lineText) — pass the LINE TEXT, not a line number");
    }
    const p = _toPosix(file);
    const hit = compatOccurrences.find(({ occ }) => _toPosix(occ.file) === p && _pinMatchesLine(occ, lineText));
    return hit ? { window: hit.window, occurrence: hit.occ } : null;
  }

  // Security fix-cycle r2 F1 — the ONE occurrence-scoped disposition choke-point (loader tally + codemod ledger).
  // A pin/compat covers a needle occurrence ONLY when the occurrence's character index lies inside a span of the
  // pin/compat matchText on the line (occurrence-scoped, not line-scoped): an extra live slug beside a registered
  // occurrence on the same line is never absorbed by it.
  function _indexInMatchText(line, matchText, idx) {
    if (!matchText) return false;
    let from = 0;
    let i;
    while ((i = line.indexOf(matchText, from)) !== -1) {
      if (idx >= i && idx < i + matchText.length) return true;
      from = i + matchText.length;
    }
    return false;
  }

  /** -> { kind: "compat", window, occurrence } | { kind: "pinned", pin } | null for the needle match at matchIndex. */
  function dispositionAt(file, lineText, matchIndex) {
    if (typeof lineText !== "string" || !Number.isInteger(matchIndex)) {
      throw new TypeError("partition-loader: dispositionAt(file, lineText, matchIndex) — pass the LINE TEXT and the match's character index");
    }
    const p = _toPosix(file);
    // compat is checked BEFORE pins (existing precedence; the loader refuses a line claimed by both).
    for (const { window, occ } of compatOccurrences) {
      if (_toPosix(occ.file) !== p) continue;
      if (!_pinMatchesLine(occ, lineText)) continue; // matchText present + anchor gate
      if (_indexInMatchText(lineText, occ.matchText, matchIndex)) return { kind: "compat", window, occurrence: occ };
    }
    for (const pin of occurrencePins) {
      if (!_pinFileCandidates(pin.file).includes(p)) continue;
      if (!_pinMatchesLine(pin, lineText)) continue;
      if (_indexInMatchText(lineText, pin.matchText, matchIndex)) return { kind: "pinned", pin };
    }
    return null;
  }

  function isGeneratedView(file) {
    return generatedViewByPath.has(_toPosix(file));
  }

  // ── R2 allow-view ──────────────────────────────────────────────────────
  const allowPathEntries = [...pathGlobs, ...futureEntries].filter((e) => ALLOW_CLASSES.includes(e.class));
  const allowList = {
    pathEntries: allowPathEntries,
    occurrencePins,
    size: allowPathEntries.length + occurrencePins.length,
  };
  function isAllowed(trackedPath) {
    const c = classifyPath(trackedPath);
    return (c.kind === "path-glob" || c.kind === "future-entry") && ALLOW_CLASSES.includes(c.class) ? c.entry : null;
  }

  // ── legacy-slug disposition tally (both gates emit these NUMBERS) ──────
  /**
   * `version` is the tree version every compat expiry is read against. Omitted -> read from the partition root's
   * package.json; null / unparseable -> every compat window reads EXPIRED (fail closed, never silently permitted).
   */
  function createLegacySlugTally({ version } = {}) {
    const clock =
      version === undefined
        ? readTreeVersion(PARTITION_ROOT)
        : parseSemver(version)
          ? { version, reason: `version ${version}` }
          : { version: null, reason: `version ${JSON.stringify(version)} unknown/unparseable — every compat window reads EXPIRED (fail closed)` };
    return {
      filesWithHits: 0,
      pendingTotal: 0,
      pendingByFile: {},
      pendingSamples: {},
      pinnedTotal: 0,
      pinnedByPin: {},
      derivedTotal: 0,
      derivedByView: {},
      changelogHistoricalTotal: 0,
      suppressedTotal: 0,
      suppressedByEntry: {},
      suppressedByClass: {},
      unclassifiedByFile: {},
      version: clock.version,
      versionReason: clock.reason,
      compatTotal: 0,
      compatBySurface: {},
      compatExpiredTotal: 0,
      compatExpiredBySurface: {},
    };
  }

  function _pinLabel(pin) {
    return `pin ${pin.file} :: ${pin.matchText}${pin.anchor ? ` @ ${pin.anchor}` : ""}`;
  }

  /**
   * Tally every case-insensitive `needle` hit in one file's content. The NEEDLE is passed
   * in by the gate (each gate's needle literal is itself a Class-3 occurrence pin).
   */
  function tallyLegacySlug(tally, file, content, needle) {
    if (typeof content !== "string") throw new TypeError(`tallyLegacySlug: content for ${file} must be a string`);
    if (typeof needle !== "string" || !needle) throw new TypeError("tallyLegacySlug: needle must be a non-empty string");
    const reTest = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    if (!reTest.test(content)) return;
    const reAll = new RegExp(reTest.source, "gi");
    const count = (s) => (s.match(reAll) || []).length;
    const p = _toPosix(file);
    const add = (bucket, key, n) => {
      bucket[key] = (bucket[key] || 0) + n;
    };
    tally.filesWithHits += 1;
    const cls = classifyPath(p);
    if (cls.kind === "generated-view") {
      const n = count(content);
      tally.derivedTotal += n;
      add(tally.derivedByView, p, n);
      return;
    }
    // compat: permitted ONLY while the registered window is unexpired; an expired window's occurrences are
    // live-unallowed again (and counted as expired per surface, so the partial removal is visible).
    const addCompat = (w, n, lineNo, lineText) => {
      const label = compatLabel(w);
      if (isCompatExpired(w.expires, tally.version)) {
        tally.compatExpiredTotal += n;
        add(tally.compatExpiredBySurface, label, n);
        tally.pendingTotal += n;
        add(tally.pendingByFile, p, n);
        if (!tally.pendingSamples[p]) {
          tally.pendingSamples[p] = `compat window ${label} EXPIRED at tree version ${tally.version === null ? "<unknown>" : tally.version} — ${lineNo}: ${String(lineText).trim().slice(0, 120)}`;
        }
        return;
      }
      tally.compatTotal += n;
      add(tally.compatBySurface, label, n);
    };
    if (cls.kind === "compat") {
      content.split(/\r?\n/).forEach((lineText, idx) => {
        const n = count(lineText);
        if (n) addCompat(cls.entry, n, idx + 1, lineText);
      });
      return;
    }
    if (!VALID_CLASSES.includes(cls.class)) {
      const n = count(content);
      tally.pendingTotal += n;
      add(tally.pendingByFile, p, n);
      add(tally.unclassifiedByFile, p, n);
      return;
    }
    if (cls.class !== 1) {
      const n = count(content);
      const label = `class-${cls.class} ${cls.entry.pattern}`;
      tally.suppressedTotal += n;
      add(tally.suppressedByEntry, label, n);
      add(tally.suppressedByClass, cls.class, n);
      return;
    }
    const hist = p === CHANGELOG_REL ? historicalChangelogLines(content) : null;
    content.split(/\r?\n/).forEach((lineText, idx) => {
      // Security fix-cycle r2 F1: one disposition per needle OCCURRENCE (dispositionAt), never one per line — a
      // compat/pin match on the line no longer credits every hit on that line.
      // compat is checked BEFORE pins; validateEntries/checkStale refuse a line claimed by both (no occurrence holds two).
      reAll.lastIndex = 0;
      let m;
      while ((m = reAll.exec(lineText)) !== null) {
        const at = dispositionAt(p, lineText, m.index);
        if (at && at.kind === "compat") {
          addCompat(at.window, 1, idx + 1, lineText);
        } else if (at && at.kind === "pinned") {
          tally.pinnedTotal += 1;
          add(tally.pinnedByPin, _pinLabel(at.pin), 1);
        } else if (hist && hist.has(idx + 1)) {
          tally.changelogHistoricalTotal += 1;
        } else {
          tally.pendingTotal += 1;
          add(tally.pendingByFile, p, 1);
          if (!tally.pendingSamples[p]) tally.pendingSamples[p] = `${idx + 1}: ${lineText.trim().slice(0, 160)}`;
        }
      }
    });
  }

  function formatLegacySlugTally(tally, { indent = "    ", maxPending = 25 } = {}) {
    const lines = [];
    const sortDesc = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    lines.push(`${indent}suppressed counts (review as NUMBERS — a jump is a live leak behind an exemption):`);
    const rows = [
      ...sortDesc(tally.suppressedByEntry).map(([k, v]) => [k, v]),
      ...sortDesc(tally.pinnedByPin).map(([k, v]) => [k, v]),
      ...sortDesc(tally.derivedByView).map(([k, v]) => [`derived (generated view) ${k}`, v]),
      ...sortDesc(tally.compatBySurface || {}).map(([k, v]) => [`compat ${k}`, v]),
      ...sortDesc(tally.compatExpiredBySurface || {}).map(([k, v]) => [`compat-EXPIRED ${k} (counted live-unallowed)`, v]),
    ];
    if (tally.changelogHistoricalTotal) rows.push([`changelog-historical ${CHANGELOG_REL} (< 2.0.0 sections)`, tally.changelogHistoricalTotal]);
    if (rows.length === 0) lines.push(`${indent}  (none)`);
    for (const [k, v] of rows) lines.push(`${indent}  ${String(v).padStart(7)}  ${k}`);
    lines.push(
      `${indent}totals: suppressed=${tally.suppressedTotal} pinned=${tally.pinnedTotal} derived=${tally.derivedTotal} changelog-historical=${tally.changelogHistoricalTotal} live-unallowed=${tally.pendingTotal}`
    );
    const d = dispositionSummary(tally);
    lines.push(
      `${indent}dispositions (5, each closed by a registered artifact): pinned=${d.pinned} derived=${d.derived} compat=${d.compat} historical-allow-listed=${d.historicalAllowListed} · rewritten occurrences are gone from the tree; un-dispositioned residue live-unallowed=${d.liveUnallowed} (compat-expired=${d.compatExpired}) · compat clock: ${tally.versionReason || "n/a"}`
    );
    const pending = sortDesc(tally.pendingByFile);
    if (pending.length && maxPending > 0) {
      lines.push(`${indent}live-unallowed occurrences by file (top ${Math.min(maxPending, pending.length)} of ${pending.length}):`);
      for (const [k, v] of pending.slice(0, maxPending)) lines.push(`${indent}  ${String(v).padStart(7)}  ${k}`);
    }
    return lines;
  }

  // ── PATH-NAME tally (T5 F3): tracked paths whose NAME carries the legacy slug, by disposition ──
  /**
   * The content tally reads file BODIES; a file NAMED with the legacy slug is a separate leak surface (a shipped
   * alias skill, a migration's own filename, an archived plan). Every such tracked path gets exactly one of the
   * same dispositions, classified through the SAME partition:
   *   derived                  generated view (its name is the view's declared identity)
   *   compat                   registered compat MEMBER (per surface; RED once that window's expiry is reached)
   *   pinned                   Class-3 path entry (historical-in-live DATA names: migrations, the codemod's own data)
   *   historical-allow-listed  Class-4 path entry, or the Class-2 operator-gated tree
   *   live-unallowed           anything else (a Class-1 live path still carrying the slug in its name) — a violation
   * `rewritten` never appears: a renamed path no longer carries the slug. -> a tally object (numbers + named paths).
   */
  function tallyLegacySlugPathNames(trackedPaths, needle, { version } = {}) {
    if (!Array.isArray(trackedPaths)) throw new TypeError("tallyLegacySlugPathNames: trackedPaths must be an array");
    if (typeof needle !== "string" || !needle) throw new TypeError("tallyLegacySlugPathNames: needle must be a non-empty string");
    const clock =
      version === undefined
        ? readTreeVersion(PARTITION_ROOT)
        : parseSemver(version)
          ? { version, reason: `version ${version}` }
          : { version: null, reason: `version ${JSON.stringify(version)} unknown/unparseable — every compat window reads EXPIRED (fail closed)` };
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const t = {
      total: 0,
      byDisposition: { pinned: 0, derived: 0, compat: 0, historicalAllowListed: 0, liveUnallowed: 0 },
      byEntry: {},
      compatBySurface: {},
      compatExpiredBySurface: {},
      liveUnallowedPaths: [],
      version: clock.version,
      versionReason: clock.reason,
    };
    const bump = (obj, key) => {
      obj[key] = (obj[key] || 0) + 1;
    };
    for (const raw of trackedPaths) {
      const p = _toPosix(raw);
      if (!re.test(p)) continue;
      t.total += 1;
      const cls = classifyPath(p);
      if (cls.kind === "generated-view") {
        t.byDisposition.derived += 1;
        bump(t.byEntry, `derived (generated view) ${p}`);
      } else if (cls.kind === "compat") {
        const label = compatLabel(cls.entry);
        if (isCompatExpired(cls.entry.expires, clock.version)) {
          t.byDisposition.liveUnallowed += 1;
          bump(t.compatExpiredBySurface, label);
          t.liveUnallowedPaths.push({ path: p, reason: `compat window ${label} EXPIRED at tree version ${clock.version === null ? "<unknown>" : clock.version}` });
        } else {
          t.byDisposition.compat += 1;
          bump(t.compatBySurface, label);
          bump(t.byEntry, `compat ${label}`);
        }
      } else if (!VALID_CLASSES.includes(cls.class)) {
        t.byDisposition.liveUnallowed += 1;
        t.liveUnallowedPaths.push({ path: p, reason: `unclassified (entry class ${JSON.stringify(cls.class)})` });
      } else if (cls.class === 3) {
        t.byDisposition.pinned += 1;
        bump(t.byEntry, `class-3 ${cls.entry ? cls.entry.pattern : cls.kind}`);
      } else if (cls.class === 4 || cls.class === 2) {
        t.byDisposition.historicalAllowListed += 1;
        bump(t.byEntry, `class-${cls.class} ${cls.entry ? cls.entry.pattern : cls.kind}`);
      } else {
        t.byDisposition.liveUnallowed += 1;
        t.liveUnallowedPaths.push({ path: p, reason: `live Class-1 path (${cls.kind}) still carries the legacy slug in its NAME` });
      }
    }
    return t;
  }

  function formatPathNameTally(t, { indent = "    ", maxLive = 50 } = {}) {
    const d = t.byDisposition;
    const lines = [];
    lines.push(`${indent}path-name tally (tracked paths with the legacy slug in the NAME — review as NUMBERS):`);
    const rows = Object.entries(t.byEntry).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    if (rows.length === 0) lines.push(`${indent}  (none)`);
    for (const [k, v] of rows) lines.push(`${indent}  ${String(v).padStart(7)}  ${k}`);
    for (const [k, v] of Object.entries(t.compatExpiredBySurface)) lines.push(`${indent}  ${String(v).padStart(7)}  compat-EXPIRED ${k} (counted live-unallowed)`);
    lines.push(
      `${indent}path-name dispositions (5): pinned=${d.pinned} derived=${d.derived} compat=${d.compat} historical-allow-listed=${d.historicalAllowListed} · live-unallowed=${d.liveUnallowed} · total=${t.total} · compat clock: ${t.versionReason}`
    );
    for (const x of t.liveUnallowedPaths.slice(0, maxLive)) lines.push(`${indent}  LIVE ${x.path} — ${x.reason}`);
    return lines;
  }

  // ── F2 (+ schema): every entry carries a one-line warrant ──────────────
  function validateEntries() {
    const problems = [];
    const sections = [
      ["generatedViews", generatedViews, (e) => `view|${e && e.path}`],
      ["pathGlobs", denylist.pathGlobs || [], (e) => `glob|${e && e.pattern}`],
      ["futureEntries", denylist.futureEntries || [], (e) => `future|${e && e.pattern}`],
      ["occurrencePins", occurrencePins, (e) => `pin|${e && e.file}|${e && e.matchText}|${(e && e.anchor) || ""}`],
    ];
    for (const [section, list, keyOf] of sections) {
      for (const e of list) {
        const key = keyOf(e);
        if (!e || typeof e !== "object") {
          problems.push({ id: "SCHEMA", key, message: `${section}: entry is not an object` });
          continue;
        }
        const w = e.warrant;
        if (typeof w !== "string" || !w.trim()) {
          problems.push({ id: "F2", key, message: `${section} entry '${key}' has a missing/empty warrant — every allow-list entry must carry a one-line warrant` });
        } else if (/[\r\n]/.test(w)) {
          problems.push({ id: "F2", key, message: `${section} entry '${key}' has a multi-line warrant — a warrant is ONE line` });
        } else if (PLACEHOLDER_WARRANT.test(w.trim())) {
          problems.push({ id: "F2", key, message: `${section} entry '${key}' has a placeholder warrant ('${w.trim()}') — not a warrant` });
        }
        if (section === "occurrencePins") {
          if (typeof e.file !== "string" || !e.file || typeof e.matchText !== "string" || !e.matchText) {
            problems.push({ id: "SCHEMA", key, message: `occurrencePins entry '${key}' needs non-empty file + matchText` });
          }
          if (Object.prototype.hasOwnProperty.call(e, "line")) {
            problems.push({ id: "SCHEMA", key, message: `occurrencePins entry '${key}' carries a bare line number — R4: pins key on (file, matchText [, anchor]) only` });
          }
        } else if (section === "generatedViews") {
          if (typeof e.path !== "string" || !e.path) problems.push({ id: "SCHEMA", key, message: "generatedViews entry needs a path" });
          if (!VALID_CLASSES.includes(e.class)) problems.push({ id: "SCHEMA", key, message: `generatedViews entry '${key}' has invalid class ${JSON.stringify(e.class)}` });
        } else {
          if (typeof e.pattern !== "string" || !e.pattern) problems.push({ id: "SCHEMA", key, message: `${section} entry needs a pattern` });
          if (!VALID_CLASSES.includes(e.class)) problems.push({ id: "SCHEMA", key, message: `${section} entry '${key}' has invalid class ${JSON.stringify(e.class)}` });
        }
      }
    }

    // ── compat register (β r3b): closed by enumeration, per-entry expiry, no occurrence holds two ──
    const surfaces = new Set();
    const memberOwner = new Map();
    const pinKeys = new Set(occurrencePins.map((pin) => `${_toPosix(pin.file)}|${pin.matchText}|${pin.anchor || ""}`));
    for (const w of compatWindows) {
      const key = `compat|${w && w.surface}|${w && w.expires}`;
      if (!w || typeof w !== "object" || Array.isArray(w)) {
        problems.push({ id: "SCHEMA", key, message: "compatWindows: entry is not an object" });
        continue;
      }
      const warrant = w.warrant;
      if (typeof warrant !== "string" || !warrant.trim()) {
        problems.push({ id: "F2", key, message: `compat window '${w.surface}' has a missing/empty warrant — every register entry must carry a one-line warrant` });
      } else if (/[\r\n]/.test(warrant)) {
        problems.push({ id: "F2", key, message: `compat window '${w.surface}' has a multi-line warrant — a warrant is ONE line` });
      } else if (PLACEHOLDER_WARRANT.test(warrant.trim())) {
        problems.push({ id: "F2", key, message: `compat window '${w.surface}' has a placeholder warrant ('${warrant.trim()}') — not a warrant` });
      }
      if (typeof w.surface !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(w.surface)) {
        problems.push({ id: "SCHEMA", key, message: `compat window needs a surface id (lowercase-hyphen), got ${JSON.stringify(w.surface)}` });
      } else if (surfaces.has(w.surface)) {
        problems.push({ id: "SCHEMA", key, message: `compat surface '${w.surface}' is declared twice — one surface, one entry, one expiry` });
      } else {
        surfaces.add(w.surface);
      }
      if (!parseSemver(w.expires)) {
        problems.push({ id: "SCHEMA", key, message: `compat window '${w.surface}' needs its OWN expires version (semver) — β r3b condition 2: a per-entry expiry, never a global switch; got ${JSON.stringify(w.expires)}` });
      }
      if (Object.prototype.hasOwnProperty.call(w, "pattern") || Object.prototype.hasOwnProperty.call(w, "path")) {
        problems.push({ id: "SCHEMA", key, message: `compat window '${w.surface}' carries a pattern/path — the register is closed by ENUMERATION (members[] exact paths + occurrences[]), never by description` });
      }
      const members = w.members === undefined ? [] : w.members;
      const occurrences = w.occurrences === undefined ? [] : w.occurrences;
      if (!Array.isArray(members) || !Array.isArray(occurrences)) {
        problems.push({ id: "SCHEMA", key, message: `compat window '${w.surface}': members and occurrences must be arrays` });
        continue;
      }
      if (members.length === 0 && occurrences.length === 0) {
        problems.push({ id: "SCHEMA", key, message: `compat window '${w.surface}' enumerates no member and no occurrence — a hollow register entry` });
      }
      for (const m of members) {
        const mk = `${key}|path|${m}`;
        if (typeof m !== "string" || !m.trim()) {
          problems.push({ id: "SCHEMA", key: mk, message: `compat window '${w.surface}' has a non-string/empty member` });
          continue;
        }
        if (/[*?[\]{}]/.test(m)) {
          problems.push({ id: "SCHEMA", key: mk, message: `compat member '${m}' is a glob — members are enumerated EXACT paths (closed by registration, β r3b condition 1)` });
        }
        const p = _toPosix(m);
        if (memberOwner.has(p)) {
          problems.push({ id: "SCHEMA", key: mk, message: `compat member '${p}' is registered under two surfaces ('${memberOwner.get(p)}' and '${w.surface}') — no occurrence holds two` });
        } else {
          memberOwner.set(p, w.surface);
        }
        const also = [];
        if (generatedViewByPath.has(p)) also.push("a generated view");
        const g = pathGlobs.find((e) => e._re.test(p));
        if (g) also.push(`path glob '${g.pattern}' (class ${g.class})`);
        const f = futureEntries.find((e) => e._re.test(p));
        if (f) also.push(`future entry '${f.pattern}' (class ${f.class})`);
        if (also.length) {
          problems.push({ id: "SCHEMA", key: mk, message: `compat member '${p}' is also ${also.join(" and ")} — no occurrence holds two dispositions` });
        }
      }
      for (const o of occurrences) {
        const ok = `${key}|occ|${o && o.file}|${o && o.matchText}|${(o && o.anchor) || ""}`;
        if (!o || typeof o !== "object" || typeof o.file !== "string" || !o.file || typeof o.matchText !== "string" || !o.matchText) {
          problems.push({ id: "SCHEMA", key: ok, message: `compat occurrence in '${w && w.surface}' needs non-empty file + matchText` });
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(o, "line")) {
          problems.push({ id: "SCHEMA", key: ok, message: `compat occurrence '${ok}' carries a bare line number — keyed on (file, matchText [, anchor]) only` });
        }
        const f = _toPosix(o.file);
        if (compatMemberByPath.has(f)) {
          problems.push({ id: "SCHEMA", key: ok, message: `compat occurrence '${ok}' sits in a registered compat MEMBER file — no occurrence holds two` });
        }
        if (pinKeys.has(`${f}|${o.matchText}|${o.anchor || ""}`)) {
          problems.push({ id: "SCHEMA", key: ok, message: `compat occurrence '${ok}' is also an occurrence pin — no occurrence holds two dispositions` });
        }
      }
    }
    return problems;
  }

  // ── F7: an entry that matches NOTHING is a non-zero exit ────────────────
  function checkStale({ root = PARTITION_ROOT, trackedFiles } = {}) {
    const tracked = trackedFiles || listRepoFiles(root);
    const trackedSet = new Set(tracked);
    const problems = [];
    const notes = [];
    for (const gv of generatedViews) {
      if (!_viewPathCandidates(gv.path).some((f) => trackedSet.has(f))) {
        problems.push({ id: "F7", key: `view|${gv.path}`, message: `stale generated-view entry '${gv.path}' — no tracked file at that path (declared or post-rename)` });
      }
    }
    for (const g of pathGlobs) {
      const n = tracked.filter((f) => g._re.test(f)).length;
      if (n > 0) continue;
      const star = g.pattern.indexOf("*");
      const probe = star < 0 ? g.pattern : `${g.pattern.slice(0, star)}__partition_probe__`;
      const ci = _gitRun(root, ["check-ignore", "--no-index", "-q", probe]);
      if (ci.status === 0) {
        notes.push(`guarded-ignored: '${g.pattern}' matches 0 tracked paths but its tree is gitignored (git check-ignore) — protective, not hollow`);
      } else if (ci.status === 1) {
        problems.push({ id: "F7", key: `glob|${g.pattern}`, message: `stale allow-list entry '${g.pattern}' matches NOTHING (0 tracked paths, not a gitignored tree)` });
      } else {
        throw new PartitionLoadError(`partition-loader: git check-ignore failed for '${probe}': ${(ci.stderr || "").trim()}`);
      }
    }
    for (const fut of futureEntries) {
      const n = tracked.filter((f) => fut._re.test(f)).length;
      if (n > 0) notes.push(`future entry '${fut.pattern}' is now realized (${n} tracked path(s))`);
    }
    for (const pin of occurrencePins) {
      const key = `pin|${pin.file}|${pin.matchText}|${pin.anchor || ""}`;
      const files = _pinFileCandidates(pin.file).filter((f) => trackedSet.has(f));
      if (files.length === 0) {
        problems.push({ id: "F7", key, message: `stale occurrence pin '${key}' — its file is not tracked (at the pinned or post-rename path)` });
        continue;
      }
      const cls = classifyPath(files[0]);
      if (cls.class !== 1 || cls.kind === "generated-view") {
        problems.push({ id: "F7", key, message: `hollow occurrence pin '${key}' — its file is ${cls.kind} class ${cls.class}; pins only bind live (Class-1, non-generated) files` });
        continue;
      }
      let matches = 0;
      const where = [];
      for (const f of files) {
        let text;
        try {
          text = fs.readFileSync(path.join(root, f), "utf8");
        } catch (e) {
          throw new PartitionLoadError(`partition-loader: cannot read pinned file ${f}: ${e.message}`);
        }
        text.split(/\r?\n/).forEach((lineText, i) => {
          if (_pinMatchesLine(pin, lineText)) {
            matches += 1;
            where.push(`${f}:${i + 1}`);
          }
        });
      }
      if (matches === 0) {
        problems.push({ id: "F7", key, message: `stale occurrence pin '${key}' matches NOTHING — the pinned literal is gone (rewritten or removed)` });
      } else if (matches > 1) {
        problems.push({ id: "F7", key, message: `ambiguous occurrence pin '${key}' matches ${matches} lines (${where.slice(0, 5).join(", ")}) — add an anchor so it pins exactly one` });
      }
    }
    // compat register: every enumerated member is a tracked path; every occurrence binds EXACTLY one line of a live
    // (Class-1, non-generated, non-member) file, and that line is claimed by no pin (no occurrence holds two).
    for (const w of compatWindows) {
      if (!w || typeof w !== "object") continue;
      const head = `compat|${w.surface}|${w.expires}`;
      for (const m of Array.isArray(w.members) ? w.members : []) {
        if (typeof m === "string" && m && !trackedSet.has(_toPosix(m))) {
          problems.push({ id: "F7", key: `${head}|path|${m}`, message: `stale compat member '${m}' (surface ${w.surface}) — not a tracked path; a register entry that matches nothing is hollow` });
        }
      }
      for (const o of Array.isArray(w.occurrences) ? w.occurrences : []) {
        if (!o || typeof o.file !== "string" || typeof o.matchText !== "string") continue;
        const key = `${head}|occ|${o.file}|${o.matchText}|${o.anchor || ""}`;
        const f = _toPosix(o.file);
        if (!trackedSet.has(f)) {
          problems.push({ id: "F7", key, message: `stale compat occurrence '${key}' — its file is not tracked` });
          continue;
        }
        const cls = classifyPath(f);
        if (cls.class !== 1 || cls.kind === "generated-view") {
          problems.push({ id: "F7", key, message: `hollow compat occurrence '${key}' — its file is ${cls.kind} class ${cls.class}; occurrences only bind live (Class-1, non-generated) files` });
          continue;
        }
        let text;
        try {
          text = fs.readFileSync(path.join(root, f), "utf8");
        } catch (e) {
          throw new PartitionLoadError(`partition-loader: cannot read compat file ${f}: ${e.message}`);
        }
        const where = [];
        text.split(/\r?\n/).forEach((lineText, i) => {
          if (!_pinMatchesLine(o, lineText)) return;
          where.push(`${f}:${i + 1}`);
          const pin = findOccurrencePin(f, lineText);
          if (pin) {
            problems.push({ id: "F7", key, message: `compat occurrence '${key}' claims ${f}:${i + 1}, which pin '${pin.file} :: ${pin.matchText}' also claims — no occurrence holds two` });
          }
        });
        if (where.length === 0) {
          problems.push({ id: "F7", key, message: `stale compat occurrence '${key}' matches NOTHING — the literal is gone (removed or rewritten); retire the register entry` });
        } else if (where.length > 1) {
          problems.push({ id: "F7", key, message: `ambiguous compat occurrence '${key}' matches ${where.length} lines (${where.slice(0, 5).join(", ")}) — add an anchor so it binds exactly one` });
        }
      }
    }
    return { problems, notes };
  }

  // ── F8: the freeze ─────────────────────────────────────────────────────
  function checkFreeze({ root = PARTITION_ROOT } = {}) {
    const problems = [];
    const notes = [];
    const freeze = denylist.$freeze;
    if (!freeze || typeof freeze !== "object") {
      problems.push({ id: "F8", key: "$freeze", message: "the partition carries no $freeze block — the allow-list is not frozen" });
      return { problems, notes };
    }
    const baseline = Array.isArray(freeze.baselineKeys) ? freeze.baselineKeys : null;
    if (!baseline) problems.push({ id: "F8", key: "$freeze.baselineKeys", message: "$freeze.baselineKeys is missing" });
    const amendmentKeysOf = (dl) => {
      const f = dl && dl.$freeze;
      return new Set(((f && f.amendments) || []).map((a) => a && a.key).filter((k) => typeof k === "string"));
    };
    for (const a of freeze.amendments || []) {
      if (!a || typeof a.key !== "string" || !a.key) {
        problems.push({ id: "F8", key: "$freeze.amendments", message: "an amendment record has no key" });
      } else if (typeof a.warrant !== "string" || !a.warrant.trim() || /[\r\n]/.test(a.warrant) || PLACEHOLDER_WARRANT.test(a.warrant.trim())) {
        problems.push({ id: "F8", key: a.key, message: `amendment '${a.key}' has no one-line warrant — an unwarranted amendment is a silent addition` });
      }
    }
    const baseSet = new Set(baseline || []);
    const amendSet = amendmentKeysOf(denylist);
    for (const k of entryKeys(denylist)) {
      if (!baseSet.has(k) && !amendSet.has(k)) {
        problems.push({ id: "F8", key: k, message: `post-freeze silent addition '${k}' — not in the frozen baseline and no warranted amendment record` });
      }
    }

    // git layer: every post-freeze commit that ADDS an entry must be a separate,
    // partition-only, marked amendment; the baseline itself is immutable after freeze.
    const inside = _gitRun(root, ["rev-parse", "--is-inside-work-tree"]);
    if (inside.status !== 0 || inside.stdout.trim() !== "true") {
      throw new PartitionLoadError(`partition-loader: F8 needs git history but ${root} is not a git work tree — failing CLOSED`);
    }
    if (_gitRun(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") {
      notes.push("F8: shallow clone — the commit-separation check only sees the fetched history");
    }
    const rel = _toPosix(path.relative(root, DENYLIST_PATH));
    const ledgerRel = _toPosix(path.relative(root, COMMITTED_LEDGER_PATH));
    const log = _gitRun(root, ["log", "--no-merges", "--reverse", "--format=%H", "--", rel]);
    if (log.status !== 0) {
      // A repo with no commits yet has no history to judge — the worktree layer above still ran.
      if (/does not have any commits|bad default revision/i.test(log.stderr || "")) {
        notes.push("F8: no commits yet — freeze history not established");
        return { problems, notes };
      }
      throw new PartitionLoadError(`partition-loader: git log failed for ${rel}: ${(log.stderr || "").trim()}`);
    }
    const commits = log.stdout.split(/\r?\n/).filter(Boolean);
    let freezeCommit = null;
    let frozenBaseline = null;
    for (const c of commits) {
      let at;
      try {
        at = readPartitionAt(c, { root });
      } catch (e) {
        if (freezeCommit) problems.push({ id: "F8", key: c.slice(0, 12), message: `post-freeze commit ${c.slice(0, 12)} leaves the partition unreadable: ${e.message}` });
        continue;
      }
      if (!at) continue;
      if (!freezeCommit) {
        if (at.$freeze && Array.isArray(at.$freeze.baselineKeys)) {
          freezeCommit = c;
          frozenBaseline = JSON.stringify([...at.$freeze.baselineKeys].sort());
        }
        continue;
      }
      const short = c.slice(0, 12);
      const atBaseline = JSON.stringify([...((at.$freeze && at.$freeze.baselineKeys) || [])].sort());
      if (atBaseline !== frozenBaseline) {
        problems.push({ id: "F8", key: short, message: `commit ${short} rewrites $freeze.baselineKeys — the frozen baseline is immutable; additions go through amendments` });
      }
      let parent = null;
      try {
        parent = readPartitionAt(`${c}^`, { root });
      } catch {
        parent = null;
      }
      const before = new Set(parent ? entryKeys(parent) : []);
      const added = entryKeys(at).filter((k) => !before.has(k));
      if (added.length === 0) continue;
      const files = _gitRun(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", c]).stdout.split(/\r?\n/).filter(Boolean).map(_toPosix);
      const foreign = files.filter((f) => f !== rel && f !== ledgerRel);
      const message = _gitRun(root, ["log", "-1", "--format=%B", c]).stdout;
      const amendedHere = amendmentKeysOf(at);
      if (foreign.length) {
        problems.push({
          id: "F8",
          key: short,
          message: `commit ${short} adds allow-list entr${added.length === 1 ? "y" : "ies"} [${added.join(", ")}] inside a commit that also changes ${foreign.slice(0, 5).join(", ")} — a post-freeze addition must be its OWN warranted amendment commit, never folded into a gate-fixing commit`,
        });
      }
      if (!message.includes(AMENDMENT_MARKER)) {
        problems.push({ id: "F8", key: short, message: `commit ${short} adds [${added.join(", ")}] without the '${AMENDMENT_MARKER}' marker in its message` });
      }
      for (const k of added) {
        if (!amendedHere.has(k)) problems.push({ id: "F8", key: k, message: `commit ${short} adds '${k}' without an amendment record in $freeze.amendments` });
      }
    }
    if (!freezeCommit) notes.push("F8: the freeze is not committed yet — the working-tree baseline is authoritative until it is");
    else notes.push(`F8: frozen at ${freezeCommit.slice(0, 12)}; ${amendSet.size} amendment(s) on record`);
    return { problems, notes };
  }

  return {
    denylist,
    classifyPath,
    findOccurrencePin,
    findCompatOccurrence,
    dispositionAt,
    compatWindows,
    isCompatMember: (file) => compatMemberByPath.has(_toPosix(file)),
    isGeneratedView,
    /** A view entry's identities: its declared path, plus the codemod's rename of it when that differs. */
    viewPathCandidates: (g) => _viewPathCandidates(g && typeof g === "object" ? g.path : g),
    isAllowed,
    allowList,
    generatedViews,
    pathGlobs,
    occurrencePins,
    futureEntries,
    openQuestions,
    historicalChangelogLines,
    createLegacySlugTally,
    tallyLegacySlug,
    formatLegacySlugTally,
    tallyLegacySlugPathNames,
    formatPathNameTally,
    dispositionSummary,
    validateEntries,
    checkStale,
    checkFreeze,
    entryKeys: () => entryKeys(denylist),
  };
}

/**
 * Req1 structural guard: executable source files (outside this module) that name the
 * partition artifact directly. Scans tracked + untracked-not-ignored files.
 */
function findUnroutedReaders({ root = PARTITION_ROOT } = {}) {
  const loaderRel = _toPosix(path.relative(root, __filename));
  const basename = path.basename(DENYLIST_PATH);
  const stem = basename.replace(/\.json$/i, "");
  const offenders = [];
  for (const rel of listRepoFiles(root, { others: true })) {
    if (rel === loaderRel) continue;
    if (!CODE_EXTENSIONS.has(path.posix.extname(rel).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue; // listed but deleted on disk
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(basename) || lines[i].includes(stem)) {
        offenders.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 160) });
      }
    }
  }
  return offenders;
}

module.exports = {
  loadPartition,
  buildPartition,
  entryKeys,
  compatKeys,
  parseSemver,
  readTreeVersion,
  isCompatExpired,
  compatLabel,
  dispositionSummary,
  historicalChangelogLines,
  listRepoFiles,
  readPartitionAt,
  findUnroutedReaders,
  PartitionLoadError,
  ROUTED_ENTRY_POINT,
  DENYLIST_PATH,
  COMMITTED_LEDGER_PATH,
  PARTITION_ROOT,
  AMENDMENT_MARKER,
  VALID_CLASSES,
  ALLOW_CLASSES,
};

if (require.main === module) {
  if (process.argv.includes("--keys")) {
    try {
      process.stdout.write(JSON.stringify(loadPartition().entryKeys(), null, 2) + "\n");
      process.exit(0);
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
  }
  process.stderr.write("usage: node scripts/open-source/partition-loader.js --keys\n");
  process.exit(2);
}
