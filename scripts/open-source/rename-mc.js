#!/usr/bin/env node
"use strict";

/**
 * rename-mc.js — the S-OS-06 mc@2.0.0 identifier-rebrand codemod engine.
 *
 * Ticket T-20260913-360 (T1, LANE A engine). DRY-RUN ONLY in this ticket — --apply
 * exists (AC-1.2, AC-1.3 need it to exist and to refuse correctly) but T1 never
 * invokes it against the real tree; T3 owns the one serial --apply commit.
 *
 * Modes:
 *   --dry-run   (default) classify every tracked path into exactly one of the four
 *               beta r1 classes, scan every Class-1 file (and every REGISTERED compat
 *               member) for `warpos` occurrences, assign each occurrence exactly one
 *               disposition (rewritten / pinned / derived / compat — β r3b: compat is
 *               permitted ONLY inside a registered compat window, each window carrying its
 *               own expiry; an occurrence in an expired window FAILS the dry-run as
 *               compatExpired), and write:
 *                 - runtime/S-OS-06/rename-plan.json  (path renames + category counts)
 *                 - runtime/S-OS-06/rename-occurrences.full.json  (ALL occurrence rows incl.
 *                   the ~33k `rewritten` codemod-plan rows; regenerated each run, NOT committed)
 *                 - scripts/open-source/rename-mc.occurrences.json  (the COMMITTED record-trust
 *                   ledger: ONLY warranted rows — pinned + derived — plus a dispositionCounts
 *                   header carrying the rewritten/pinned/derived totals over the full data)
 *               Exits non-zero if unclassified != 0 or
 *               unpinned-unrewritten-underived != 0 (names the offenders).
 *
 *   --apply     refuses immediately if it would touch a writeProtected path (AC-1.3).
 *               Otherwise renames Class-1 paths and rewrites Class-1, non-pinned,
 *               non-derived occurrences. Idempotent: a second --apply against an
 *               already-applied tree finds zero remaining rewritable occurrences and
 *               performs zero renames/rewrites (AC-1.2). Skips the `env` category
 *               (process.env.WARPOS_* reads) — that rewrite targets a read-both
 *               helper CALL that does not exist until T3; --apply does not invent one,
 *               and never performs the disallowed literal WARPOS_->MC_ env swap.
 *
 *   --apply-skill-namespace   (T3 part 1c) the SHORT-form skill namespace the warpos rewrite never
 *               matched (`warp:` is not "warpos"). ENUMERATED alternation only — never a bare prefix:
 *               `warp:(check|deprecate|diff|doctor|flag|health|md|reconcile|release|setup|sync|tour|
 *               uninstall|update)` -> `mc:$1` and `scan:warpos-<x>` -> `scan:mc-<x>`, plus the same
 *               enumeration's path form `commands/warp/<skill>.md` -> `commands/mc/<skill>.md`, over
 *               Class-1, non-write-protected files only (occurrence-pinned lines and CHANGELOG
 *               historical lines stay verbatim); `git mv`s `.claude/commands/warp/<skill>.md` to
 *               `.claude/commands/mc/<skill>.md`. Every other `warp:` token is untouched and reported
 *               by --dry-run as a named residual. Refuses on any refused skill move. Idempotent.
 *
 * Everything here is injectable-root (see run*({ root })) so tests exercise --apply
 * against a disposable temp fixture, never the live tree — the isolation the T1
 * ticket requires ("Do NOT run --apply. Do NOT rename or rewrite any existing tree file.").
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadPartition, historicalChangelogLines, readTreeVersion, isCompatExpired, compatLabel } = require("./partition-loader");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".tgz", ".7z", ".pdf",
  ".mp3", ".mp4", ".mov", ".wav",
  ".pyc", ".node", ".wasm",
]);

// Size cap for whole-file content scans. Crossing it is NEVER a silent skip (T5-C, the β fail-open
// class): a tracked TEXT file over the cap would have its `warpos` occurrences go unledgered and
// unrewritten while the dry-run reads green. So an oversized non-binary tracked file makes --dry-run
// FAIL naming it, and makes --apply / --apply-skill-namespace refuse. Binary files (by extension or a
// NUL byte in the first 8KB) stay a legitimate skip at any size.
const MAX_SCAN_BYTES = 5 * 1024 * 1024; // 5MB

// ── tracked-file enumeration ────────────────────────────────────────────────

function listTrackedFiles(root) {
  const r = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`rename-mc: git ls-files failed (status ${r.status}): ${r.stderr || ""}`);
  }
  // git ls-files -z NUL-delimits entries; build the delimiter at runtime rather than
  // as a literal control-char escape in source (keeps this file free of embedded NUL
  // bytes — see CLAUDE.md "Space before closing bracket..." NUL-byte hygiene note).
  const NUL = String.fromCharCode(0);
  return r.stdout.split(NUL).filter(Boolean).map((p) => p.split(path.sep).join("/"));
}

/**
 * One file's content-scan status: "binary" (extension or NUL in the first 8KB — a legitimate skip),
 * "unreadable" (missing / not a regular file / read error — nothing to scan), "oversized" (a TEXT file
 * over maxBytes — never silently skipped, see MAX_SCAN_BYTES) or "text" (scan it). The binary sniff runs
 * BEFORE the size cap, so a large binary blob is not misreported as an oversized text file.
 */
function scanStatus(absPath, maxBytes = MAX_SCAN_BYTES) {
  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return "binary";
  let stat;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return "unreadable";
  }
  if (!stat.isFile()) return "unreadable";
  if (stat.size === 0) return "text";
  const buf = Buffer.alloc(Math.min(8192, stat.size));
  try {
    const fd = fs.openSync(absPath, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "unreadable";
  }
  if (buf.includes(0)) return "binary";
  return stat.size > maxBytes ? "oversized" : "text";
}

/** True when the content scan does not read this file. An oversized text file is excluded here AND named by listOversizedUnscanned(). */
function looksBinary(absPath) {
  return scanStatus(absPath) !== "text";
}

/** Tracked, non-binary files over the scan cap — each one is an unverifiable scan gap the dry-run must fail on. */
function listOversizedUnscanned(root, trackedFiles, maxBytes = MAX_SCAN_BYTES) {
  const out = [];
  for (const rel of trackedFiles) {
    const abs = path.join(root, rel);
    let size;
    try {
      size = fs.statSync(abs).size;
    } catch {
      continue;
    }
    if (size <= maxBytes) continue; // cheap stat first; only over-cap files pay the binary sniff
    if (scanStatus(abs, maxBytes) === "oversized") out.push({ file: rel, bytes: size });
  }
  return out;
}

function describeOversized(o) {
  return `${o.file} (${o.bytes} bytes > MAX_SCAN_BYTES ${MAX_SCAN_BYTES}; non-binary, so its content cannot be verified)`;
}

// ── CHANGELOG.md historical-section special case ────────────────────────────
// Everything under a version heading < 2.0.0 is Class-3/4 historical DATA about a
// shipped release; the [Unreleased] section (destined to become [2.0.0]) is live.

// The section rule itself lives in the loader (historicalChangelogLines) so the codemod
// and the gates cannot disagree about which CHANGELOG lines are historical.
function computeChangelogHistoricalLines(absPath) {
  if (!fs.existsSync(absPath)) return new Set();
  return historicalChangelogLines(fs.readFileSync(absPath, "utf8"));
}

// ── skill-namespace rename (T3 part 1c — α Class-B ruling implementing R-2) ──
// The warpos->mc rewrite never matched the SHORT-form skill namespace `warp:` (it is not "warpos").
// Part 1c renames it with an ENUMERATED alternation only, never a bare `warp:` prefix: a retired or
// never-renamed `warp:<other>` token stays verbatim and is reported as a named residual. ONE
// enumeration drives the ledger's skill-namespace category, the dry-run skill-namespace counts and
// --apply-skill-namespace, so the three cannot disagree.

const SKILL_NAMESPACE_SKILLS = Object.freeze([
  "check", "deprecate", "diff", "doctor", "flag", "health", "md",
  "reconcile", "release", "setup", "sync", "tour", "uninstall", "update",
]);
const SKILL_ALT = SKILL_NAMESPACE_SKILLS.join("|");
const SKILL_TOKEN_RE = new RegExp(`\\bwarp:(${SKILL_ALT})\\b`, "g");
const SCAN_TOKEN_RE = /\bscan:warpos-([a-z-]+)\b/g;
// Path form of the SAME enumeration: live code that reads a moved skill by path (a gate allowlist key,
// the release builder's skill->script pairing, a test's content read) must follow the move instead of
// silently reading the deprecated alias left at the legacy path.
const SKILL_PATH_REF_RE = new RegExp(`\\bcommands/warp/(${SKILL_ALT})\\.md\\b`, "g");
const SKILL_FILE_RE = new RegExp(`^\\.claude/commands/warp/(${SKILL_ALT})\\.md$`);
const SKILL_HYPHEN_JOINED_RE = new RegExp(`\\bwarp:(${SKILL_ALT})-`, "g");
const ANY_WARP_TOKEN_RE = /\bwarp:[A-Za-z][\w-]*/g;

function countMatches(re, text) {
  return (String(text).match(re) || []).length;
}

/** Enumerated token rewrite of ONE line: warp:<skill> -> mc:<skill>, scan:warpos-<x> -> scan:mc-<x>. */
function rewriteSkillNamespaceTokens(lineText) {
  return lineText.replace(SKILL_TOKEN_RE, "mc:$1").replace(SCAN_TOKEN_RE, "scan:mc-$1");
}

/** Enumerated path-reference rewrite of ONE line: commands/warp/<skill>.md -> commands/mc/<skill>.md. */
function rewriteSkillPathRefs(lineText) {
  return lineText.replace(SKILL_PATH_REF_RE, "commands/mc/$1.md");
}

/** .claude/commands/warp/<skill>.md -> .claude/commands/mc/<skill>.md for the enumerated skills; any other path unchanged. */
function skillPathRename(relPath) {
  const m = SKILL_FILE_RE.exec(relPath);
  return m ? `.claude/commands/mc/${m[1]}.md` : relPath;
}

/** `warp:` tokens the enumeration does NOT change (the named residual), from a line's final text. */
function residualWarpTokens(lineText) {
  return (lineText.match(ANY_WARP_TOKEN_RE) || []).filter((tok) => rewriteSkillNamespaceTokens(tok) === tok);
}

/**
 * One line's 1c decision. `file` is the tracked path, `effective` its post-move path (they differ only
 * for a planned skill move). A line that would change but is occurrence-pinned or a CHANGELOG
 * historical line stays verbatim.
 */
function skillNamespaceLineDecision(partition, file, effective, hist, lineText, lineNum) {
  const after = rewriteSkillPathRefs(rewriteSkillNamespaceTokens(lineText));
  if (after === lineText) return { after, verbatimReason: null };
  if (partition.findCompatOccurrence(file, lineText) || (effective !== file && partition.findCompatOccurrence(effective, lineText))) {
    return { after: lineText, verbatimReason: "compat-occurrence" };
  }
  if (partition.findOccurrencePin(file, lineText) || (effective !== file && partition.findOccurrencePin(effective, lineText))) {
    return { after: lineText, verbatimReason: "occurrence-pin" };
  }
  if (hist && hist.has(lineNum)) return { after: lineText, verbatimReason: "changelog-historical" };
  return { after, verbatimReason: null };
}

/** Plan part 1c over the tracked tree: skill path moves + per-file content rewrites + honest residual counts. */
function planSkillNamespace({ root, partition, trackedFiles }) {
  const tracked = trackedFiles || listTrackedFiles(root);
  const trackedSet = new Set(tracked);

  const pathMoves = [];
  const refusedMoves = [];
  const keptLegacyPaths = []; // Class-3/4 paths at a legacy skill name (e.g. the deprecated aliases): never moved
  const moveTo = new Map();
  for (const from of tracked) {
    const to = skillPathRename(from);
    if (to === from) continue;
    const src = partition.classifyPath(from);
    if (src.class === 3 || src.class === 4) {
      keptLegacyPaths.push({ path: from, wouldBe: to, class: src.class, kind: src.kind });
      continue;
    }
    if (src.class !== 1 || src.writeProtected) {
      refusedMoves.push({ from, to, class: src.class, kind: src.kind, reason: "source-write-protected" });
      continue;
    }
    const target = partition.classifyPath(to);
    if (trackedSet.has(to) || fs.existsSync(path.join(root, to))) {
      refusedMoves.push({ from, to, class: target.class, kind: target.kind, reason: "target-exists" });
      continue;
    }
    if (target.writeProtected) {
      refusedMoves.push({ from, to, class: target.class, kind: target.kind, reason: "target-write-protected" });
      continue;
    }
    pathMoves.push({ from, to });
    moveTo.set(from, to);
  }

  const counts = {
    tokensRewritable: 0,
    pathRefsRewritable: 0,
    filesRewritable: 0,
    verbatimLines: 0,
    verbatimTokens: 0,
    derivedViewTokens: 0,
    keptNonClass1Tokens: 0,
    hyphenJoined: 0,
    otherWarpResidual: 0,
  };
  const fileRewrites = [];
  const otherWarpResidual = {};
  const otherWarpResidualByFile = {};
  const derivedByView = {};
  const keptByEntry = {};
  const verbatimByReason = {};
  const hyphenJoinedSamples = [];
  const bump = (obj, key, n = 1) => {
    obj[key] = (obj[key] || 0) + n;
  };

  for (const file of tracked) {
    const abs = path.join(root, file);
    if (looksBinary(abs)) continue;
    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (!content.includes("warp:") && !content.includes("scan:warpos-") && !content.includes("commands/warp/")) continue;

    const effective = moveTo.get(file) || file;
    const cls = partition.classifyPath(effective);
    const enumTokens = countMatches(SKILL_TOKEN_RE, content) + countMatches(SCAN_TOKEN_RE, content);
    if (partition.isGeneratedView(effective) || (cls.class === 1 && cls.writeProtected)) {
      if (enumTokens) {
        counts.derivedViewTokens += enumTokens;
        bump(derivedByView, effective, enumTokens);
      }
      continue;
    }
    if (cls.class !== 1) {
      if (enumTokens) {
        counts.keptNonClass1Tokens += enumTokens;
        const entryName = cls.entry
          ? cls.entry.pattern || cls.entry.path || (cls.kind === "compat" ? `compat ${compatLabel(cls.entry)}` : cls.kind)
          : cls.kind;
        const label = `class-${cls.class} ${entryName}`;
        bump(keptByEntry, label, enumTokens);
      }
      continue;
    }

    const hist = effective === "CHANGELOG.md" ? historicalChangelogLines(content) : null;
    let tokens = 0;
    let pathRefs = 0;
    content.split(/\r?\n/).forEach((lineText, idx) => {
      const { after, verbatimReason } = skillNamespaceLineDecision(partition, file, effective, hist, lineText, idx + 1);
      if (verbatimReason) {
        counts.verbatimLines += 1;
        counts.verbatimTokens += countMatches(SKILL_TOKEN_RE, lineText) + countMatches(SCAN_TOKEN_RE, lineText);
        bump(verbatimByReason, verbatimReason);
      } else if (after !== lineText) {
        tokens += countMatches(SKILL_TOKEN_RE, lineText) + countMatches(SCAN_TOKEN_RE, lineText);
        pathRefs += countMatches(SKILL_PATH_REF_RE, lineText);
        const joined = countMatches(SKILL_HYPHEN_JOINED_RE, lineText);
        if (joined) {
          counts.hyphenJoined += joined;
          if (hyphenJoinedSamples.length < 20) hyphenJoinedSamples.push(`${effective}:${idx + 1}: ${lineText.trim().slice(0, 140)}`);
        }
      }
      for (const tok of residualWarpTokens(after)) {
        counts.otherWarpResidual += 1;
        bump(otherWarpResidual, tok);
        bump(otherWarpResidualByFile, effective);
      }
    });
    if (tokens || pathRefs) {
      fileRewrites.push({ file, target: effective, tokens, pathRefs });
      counts.tokensRewritable += tokens;
      counts.pathRefsRewritable += pathRefs;
    }
  }
  counts.filesRewritable = fileRewrites.length;

  return {
    enumeratedSkills: [...SKILL_NAMESPACE_SKILLS],
    counts,
    pathMoves,
    refusedMoves,
    keptLegacyPaths,
    fileRewrites,
    otherWarpResidual,
    otherWarpResidualByFile,
    derivedByView,
    keptByEntry,
    verbatimByReason,
    hyphenJoinedSamples,
  };
}

// ── occurrence categorization (rewrite-plan bucketing, not disposition) ─────

function categorizeOccurrence(file, lineText) {
  if (file === "framework/paths.registry.json") return "paths-registry";
  if (/process\.env\.WARPOS_[A-Z0-9_]*/i.test(lineText)) return "env";
  if (/\bWARPOS_[A-Z0-9_]+\b/.test(lineText)) return "env";
  // Ledger honesty (T3 part 1c): skill-namespace ONLY when the enumerated alternation actually changes the
  // line. A bare `warp:<other>` token (retired / never renamed) is not a skill-namespace rewrite.
  if (rewriteSkillNamespaceTokens(lineText) !== lineText) return "skill-namespace";
  if (/(^|[^a-zA-Z0-9_])(_warpos|\.warpos-backup|\.warpos)(\/|\b)/i.test(lineText)) return "dir";
  if (/\b[a-z][a-zA-Z0-9]*Warpos[a-zA-Z0-9]*\b/.test(lineText)) return "identifier";
  if (/\bWarpos[A-Z][a-zA-Z0-9]*\b/.test(lineText)) return "identifier";
  if (/\b[a-zA-Z0-9]+_warpos_[a-zA-Z0-9]+\b/i.test(lineText)) return "identifier";
  return "prose";
}

// ── per-category transform table + structural delta (β r3c) ─────────────────
// ONE table drives BOTH --apply's content rewrite AND the per-category delta assertion, so "what the codemod
// categorizes" and "what the codemod transforms" cannot drift apart silently (the env categorize-then-skip gap:
// T1 categorized WARPOS_* lines "env", --apply skipped them, T3 rewrote only process.env reads, and the
// constants/prose fell through both). For EVERY category the categorizer owns:
//     delta(C) = categorized-lines(C) − (pinned-lines(C) + transformed-lines(C))
// where a line is "transformed" iff its category's transform returns text carrying NO legacy slug. delta != 0
// for ANY category, or a line whose category has no registered transform (uncomputable), makes --dry-run exit
// non-zero and --apply REFUSE before touching anything — never a silent skip.

const LEGACY_SLUG_ANY_RE = /warpos/i;

/** The generic slug rewrite shared by every transformable category (case-preserving for the spellings in the tree). */
function genericSlugRewrite(lineText) {
  return lineText
    .replace(/WARPOS/g, "MC")
    .replace(/WarpOS/g, "MC")
    .replace(/Warpos/g, "Mc")
    .replace(/warpos/g, "mc");
}

// A raw process.env read of a legacy-named variable has NO mechanical transform: the literal WARPOS_->MC_ swap
// silently drops the one-release legacy fallback, and the correct rewrite (a read-both helper CALL + its require)
// is not a line-local edit. Such a line is untransformable -> counted in the delta -> the codemod refuses.
// Matched case-INSENSITIVELY, aligned with categorizeOccurrence's case-insensitive env detection (7C-001): a mixed- or
// lower-case read is still a raw legacy read, and the case-preserving generic rewrite would literal-swap it too.
const RAW_LEGACY_ENV_READ_RE = /process\.env\s*(?:\.\s*WARPOS_|\[\s*["'`]WARPOS_)/i;

/**
 * Wrap a category transform so a raw legacy env read has NO transform (-> null -> refuse). Applied to EVERY category:
 * the categorizer buckets a lower/mixed-case bracket read outside "env" (e.g. prose), and that line must refuse too.
 */
function refuseRawLegacyEnvRead(transform) {
  return (lineText) => (RAW_LEGACY_ENV_READ_RE.test(lineText) ? null : transform(lineText));
}

/** category -> (lineText) => rewritten line, or null when that line has no mechanical transform. */
const CATEGORY_TRANSFORMS = Object.freeze({
  "paths-registry": refuseRawLegacyEnvRead(genericSlugRewrite),
  env: refuseRawLegacyEnvRead(genericSlugRewrite),
  "skill-namespace": refuseRawLegacyEnvRead(genericSlugRewrite),
  dir: refuseRawLegacyEnvRead(genericSlugRewrite),
  identifier: refuseRawLegacyEnvRead(genericSlugRewrite),
  prose: refuseRawLegacyEnvRead(genericSlugRewrite),
});

/** Every category the categorizer can return. A category missing from CATEGORY_TRANSFORMS is uncomputable (refuse). */
const OCCURRENCE_CATEGORIES = Object.freeze(["paths-registry", "env", "skill-namespace", "dir", "identifier", "prose"]);

function emptyCategoryDelta() {
  const out = {};
  for (const c of OCCURRENCE_CATEGORIES) out[c] = { categorized: 0, pinned: 0, transformed: 0, delta: 0 };
  return out;
}

/**
 * One slug-carrying LINE's structural decision: its category, and whether it is pinned / transformed / neither.
 * Returns { category, computable, outcome: "pinned" | "transformed" | "untransformed", after }.
 */
function computeLineCategoryDecision(relPath, lineText, pinned) {
  let category;
  try {
    category = categorizeOccurrence(relPath, lineText);
  } catch (e) {
    return { category: `<categorizer threw: ${e.message}>`, computable: false, outcome: "untransformed", after: null };
  }
  const transform = Object.prototype.hasOwnProperty.call(CATEGORY_TRANSFORMS, category) ? CATEGORY_TRANSFORMS[category] : null;
  if (!OCCURRENCE_CATEGORIES.includes(category) || typeof transform !== "function") {
    return { category: String(category), computable: false, outcome: "untransformed", after: null };
  }
  if (pinned) return { category, computable: true, outcome: "pinned", after: lineText };
  const after = transform(lineText);
  if (typeof after === "string" && !LEGACY_SLUG_ANY_RE.test(after)) return { category, computable: true, outcome: "transformed", after };
  return { category, computable: true, outcome: "untransformed", after: typeof after === "string" ? after : null };
}

// ── path rename planning (segment-level; Class-1 only) ──────────────────────

function renamePath(relPath) {
  const segments = relPath.split("/");
  const renamed = segments.map((seg, idx) => {
    const isLast = idx === segments.length - 1;
    if (seg === "warpos") return "mc";
    if (seg === "_warpos") return "_mc";
    if (seg === ".warpos") return ".mc";
    if (isLast && seg === "WARPOS.md") return "MC.md";
    if (isLast && seg.startsWith("warpos-") && seg !== "warpos-tracked-transients.js") {
      // generic warpos-<name> file basenames -> mc-<name>; the tracked-transients
      // shim is handled as its own S-4 ticket item (old name is RETAINED as a
      // compat shim, not renamed away) so it is excluded from this generic rule.
      return "mc-" + seg.slice("warpos-".length);
    }
    return seg;
  });
  return renamed.join("/");
}

// ── rename candidacy vs write permission (T3 part 0 — α/ε Class-B ruling) ──
// One list, two questions:
//   1. Is the path a rename CANDIDATE?  Class-3/4 (historical) paths never are: a historical
//      record keeps its name verbatim, by construction (β r1). They are recorded in
//      keptHistoricalPaths — never in pathRenames, never in refusedRenames.
//   2. Is the rename PERMITTED?  A write-protected source is refused, EXCEPT a generated view
//      whose name is unchanged and whose directory is renamed with a live Class-1 path moving
//      through that same directory rename: the view MOVES with its directory, and its CONTENT
//      stays derived (β r3 — derived governs content only; T5 regenerates it). A candidate
//      whose target lands ON a write-protected path is refused.
// refusedRenames therefore holds only genuine refusals.

/** The deepest renamed directory of a move whose file name is unchanged; null when the file's own name changes. */
function renamedDirectory(from, to) {
  const a = from.split("/");
  const b = to.split("/");
  if (a.length !== b.length || a[a.length - 1] !== b[b.length - 1]) return null;
  let last = -1;
  for (let i = 0; i < a.length - 1; i++) if (a[i] !== b[i]) last = i;
  if (last < 0) return null;
  return { fromDir: a.slice(0, last + 1).join("/"), toDir: b.slice(0, last + 1).join("/") };
}

function describeRefusal(r) {
  if (r.reason === "target-write-protected") {
    return `${r.from} -> ${r.to} lands on a write-protected path (class ${r.class}, ${r.kind})`;
  }
  if (r.reason === "generated-view-move-without-class1-dir-rename") {
    return (
      `${r.from} -> ${r.to} is write-protected (class ${r.class}, ${r.kind}); ` +
      `a generated view moves only with a Class-1 directory rename, and no live Class-1 path makes that move`
    );
  }
  return `${r.from} -> ${r.to} is write-protected (class ${r.class}, ${r.kind})`;
}

// ── classification + occurrence-ledger build ─────────────────────────────

function buildLedgerAndPlan({ root, partition }) {
  const trackedFiles = listTrackedFiles(root);

  const classCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const unclassified = [];
  const pathRenames = [];
  const refusedRenames = []; // AC-1.3: GENUINE refusals only — any entry makes --apply refuse; never reaches pathRenames
  const keptHistoricalPaths = []; // Class-3/4 paths a naive rename WOULD touch: never candidates, names verbatim (β r1)
  const candidates = []; // rename candidates in tracked order; write permission is decided after the scan
  const class1Files = [];
  const compatMemberFiles = []; // β r3b: registered compat members (Class-3 for renames) — their occurrences are `compat`

  for (const relPath of trackedFiles) {
    const result = partition.classifyPath(relPath);
    if (!result || ![1, 2, 3, 4].includes(result.class)) {
      unclassified.push(relPath);
      continue;
    }
    classCounts[result.class] += 1;
    if (result.class === 1) {
      class1Files.push({ relPath, writeProtected: result.writeProtected, kind: result.kind });
    }
    if (result.kind === "compat") compatMemberFiles.push({ relPath, window: result.entry });

    // Compute the would-be rename for EVERY classified path (not just Class-1) so no path a
    // naive rename WOULD touch is silently skipped: each one lands in exactly one of
    // keptHistoricalPaths / refusedRenames / pathRenames.
    const to = renamePath(relPath);
    if (to !== relPath) {
      if (result.class === 3 || result.class === 4) {
        keptHistoricalPaths.push({ path: relPath, wouldBe: to, class: result.class, kind: result.kind });
      } else if (!result.writeProtected) {
        if (result.class === 1) candidates.push({ from: relPath, to, source: result });
      } else if (result.kind === "generated-view" && renamedDirectory(relPath, to)) {
        candidates.push({ from: relPath, to, source: result, generatedViewMove: true });
      } else {
        refusedRenames.push({ from: relPath, to, class: result.class, kind: result.kind, reason: "source-write-protected" });
      }
    }
  }

  // Write permission for each candidate (question 2).
  const liveMoves = candidates.filter((c) => !c.generatedViewMove);
  for (const c of candidates) {
    if (c.generatedViewMove) {
      const dir = renamedDirectory(c.from, c.to);
      const followsClass1DirRename = liveMoves.some(
        (l) => l.from.startsWith(dir.fromDir + "/") && l.to.startsWith(dir.toDir + "/")
      );
      if (!followsClass1DirRename) {
        refusedRenames.push({
          from: c.from,
          to: c.to,
          class: c.source.class,
          kind: c.source.kind,
          reason: "generated-view-move-without-class1-dir-rename",
        });
        continue;
      }
    }
    const target = partition.classifyPath(c.to);
    // A generated view moving onto its OWN post-rename identity (the loader resolves a view entry through
    // renamePath, like a pin) is not landing on some other protected path: same entry, content derived.
    const viewFollowsItsOwnEntry =
      c.generatedViewMove && target && target.kind === "generated-view" && target.entry === c.source.entry;
    if (target && target.writeProtected && !viewFollowsItsOwnEntry) {
      refusedRenames.push({ from: c.from, to: c.to, class: target.class, kind: target.kind, reason: "target-write-protected" });
      continue;
    }
    pathRenames.push(c.generatedViewMove ? { from: c.from, to: c.to, generatedViewMove: true } : { from: c.from, to: c.to });
  }

  const changelogHistoricalLines = computeChangelogHistoricalLines(path.join(root, "CHANGELOG.md"));

  const ledger = [];
  const categoryCounts = {};
  let derivedCount = 0;
  let pinnedCount = 0;
  let rewrittenCount = 0;
  let compatCount = 0;
  const compatBySurface = {};
  const compatExpired = []; // occurrences inside a registered window whose expiry the tree version has reached — a FAIL
  const treeVersion = readTreeVersion(root);
  const noteCompat = (w, file, line, matchText) => {
    compatCount += 1;
    const label = compatLabel(w);
    compatBySurface[label] = (compatBySurface[label] || 0) + 1;
    if (isCompatExpired(w.expires, treeVersion.version)) compatExpired.push({ file, line, matchText, surface: w.surface, expires: w.expires });
  };
  const underived = []; // defensive: occurrences that got NONE of the four codemod dispositions
  // β r3c structural delta: per category, categorized LINES vs pinned + transformed lines (see CATEGORY_TRANSFORMS).
  const categoryDelta = emptyCategoryDelta();
  const categoryUncomputable = []; // a slug line whose category has no registered transform (or the categorizer threw)
  const categoryUntransformed = []; // a categorized, unpinned line its category's transform leaves carrying the slug

  for (const { relPath, writeProtected } of class1Files) {
    const absPath = path.join(root, relPath);
    if (looksBinary(absPath)) continue;

    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue; // unreadable — not a hit source, nothing to ledger
    }

    const lines = content.split(/\r?\n/);
    const isGenerated = partition.isGeneratedView(relPath);
    const isChangelog = relPath === "CHANGELOG.md";

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;
      // Structural delta — ONE decision per slug-carrying LINE of a live, non-derived file. Compat-claimed lines are
      // the compat disposition (never categorized for a rewrite); pinned lines count as pinned in their category.
      if (!isGenerated && !writeProtected && LEGACY_SLUG_ANY_RE.test(lineText) && !partition.findCompatOccurrence(relPath, lineText)) {
        const linePinned = Boolean(partition.findOccurrencePin(relPath, lineText)) || (isChangelog && changelogHistoricalLines.has(lineNum));
        const dec = computeLineCategoryDecision(relPath, lineText, linePinned);
        if (!dec.computable) {
          categoryUncomputable.push({ file: relPath, line: lineNum, category: dec.category });
        } else {
          const slot = categoryDelta[dec.category];
          slot.categorized += 1;
          if (dec.outcome === "pinned") slot.pinned += 1;
          else if (dec.outcome === "transformed") slot.transformed += 1;
          else {
            slot.delta += 1;
            categoryUntransformed.push({ file: relPath, line: lineNum, category: dec.category, text: lineText.trim().slice(0, 160) });
          }
        }
      }
      const re = /warpos/gi;
      let m;
      while ((m = re.exec(lineText)) !== null) {
        const matchText = m[0];
        let disposition;
        let warrant;
        let rule;

        if (isGenerated || writeProtected) {
          disposition = "derived";
          rule = "generated-view";
          warrant = "generated-view occurrence; permitted iff it corresponds to a Class-3 pin, asserted after manifest regen (T5)";
          derivedCount += 1;
        } else {
          // β r3b: a registered compat occurrence is checked BEFORE pins in the chain below (the loader refuses a
          // line claimed by both, so computing the pin unconditionally never changes a disposition).
          const comp = partition.findCompatOccurrence(relPath, lineText);
          // R4: a pin binds (file, matchText [, anchor]) — never a line number. This line is THE pin lever F6 mutates.
          const pin = partition.findOccurrencePin(relPath, lineText);
          if (comp) {
            disposition = "compat";
            rule = `compat:${comp.window.surface}`;
            warrant = comp.window.warrant;
            noteCompat(comp.window, relPath, lineNum, matchText);
          } else if (pin) {
            disposition = "pinned";
            rule = "occurrence-pin";
            warrant = pin.warrant;
            pinnedCount += 1;
          } else if (isChangelog && changelogHistoricalLines.has(lineNum)) {
            disposition = "pinned";
            rule = "changelog-historical";
            warrant = "changelog entry for a shipped release < 2.0.0; historical record, verbatim";
            pinnedCount += 1;
          } else {
            disposition = "rewritten";
            rule = categorizeOccurrence(relPath, lineText);
            warrant = null;
            rewrittenCount += 1;
            categoryCounts[rule] = (categoryCounts[rule] || 0) + 1;
          }
        }

        if (!["rewritten", "pinned", "derived", "compat"].includes(disposition)) {
          underived.push({ file: relPath, line: lineNum, matchText });
        }

        ledger.push({ file: relPath, line: lineNum, rule, matchText, disposition, warrant });
      }
    });
  }

  // Registered compat MEMBER files: never renamed, never rewritten, but every occurrence is ledgered `compat` so the
  // count per surface is emitted (β r3b condition 3) and an expired window fails the dry-run.
  for (const { relPath, window: w } of compatMemberFiles) {
    const absPath = path.join(root, relPath);
    if (looksBinary(absPath)) continue;
    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((lineText, idx) => {
      const re = /warpos/gi;
      let m;
      while ((m = re.exec(lineText)) !== null) {
        noteCompat(w, relPath, idx + 1, m[0]);
        ledger.push({ file: relPath, line: idx + 1, rule: `compat:${w.surface}`, matchText: m[0], disposition: "compat", warrant: w.warrant });
      }
    });
  }

  return {
    trackedFileCount: trackedFiles.length,
    classCounts,
    unclassified,
    oversizedUnscanned: listOversizedUnscanned(root, trackedFiles),
    pathRenames,
    refusedRenames,
    keptHistoricalPaths,
    categoryCounts,
    ledger,
    dispositionCounts: { rewritten: rewrittenCount, pinned: pinnedCount, derived: derivedCount, compat: compatCount },
    compatBySurface,
    compatExpired,
    treeVersion,
    underived,
    categoryDelta,
    categoryUncomputable,
    categoryUntransformed,
  };
}

/** Structural-delta verdict over a built plan: every owned category delta 0 and nothing uncomputable. */
function categoryDeltaProblems(built) {
  const problems = [];
  const delta = built && built.categoryDelta;
  if (!delta || typeof delta !== "object") return ["no categoryDelta computed (fail-closed)"];
  for (const c of OCCURRENCE_CATEGORIES) {
    const s = delta[c];
    if (!s) {
      problems.push(`category ${c}: no delta slot (uncomputable)`);
      continue;
    }
    if (s.categorized - (s.pinned + s.transformed) !== s.delta) problems.push(`category ${c}: arithmetic disagreement`);
    if (s.delta !== 0) problems.push(`category ${c}: delta=${s.delta}`);
  }
  if (!Array.isArray(built.categoryUncomputable)) problems.push("no categoryUncomputable list (fail-closed)");
  else if (built.categoryUncomputable.length) problems.push(`${built.categoryUncomputable.length} line(s) with an uncomputable category`);
  return problems;
}

function describeCategoryDelta(delta) {
  return OCCURRENCE_CATEGORIES.map((c) => {
    const s = delta[c] || {};
    return `${c}=${s.delta} (categorized=${s.categorized} pinned=${s.pinned} transformed=${s.transformed})`;
  }).join("; ");
}

// ── occurrence-ledger split: full (runtime) vs committed (warranted only) ──

const COMMITTED_LEDGER_REL = "scripts/open-source/rename-mc.occurrences.json";
const FULL_LEDGER_REL = "runtime/S-OS-06/rename-occurrences.full.json";
const WARRANTED_DISPOSITIONS = ["pinned", "derived", "compat"];

// The committed ledger is the record-trust artifact: every row it persists carries a
// warrant. `rewritten` rows are the codemod PLAN (warrant:null) — they are represented
// here only as a COUNT in dispositionCounts; their row detail lives in FULL_LEDGER_REL.
// No timestamp in the committed form so a re-run over an unchanged tree is a zero diff.
function buildCommittedLedger(built) {
  const rows = built.ledger
    .filter((r) => WARRANTED_DISPOSITIONS.includes(r.disposition))
    .map(({ file, line, rule, matchText, disposition, warrant }) => ({ file, line, rule, matchText, disposition, warrant }));
  const rowsPersisted = { pinned: 0, derived: 0, compat: 0 };
  for (const r of rows) rowsPersisted[r.disposition] += 1;
  return {
    $question:
      "Which `warpos` occurrences are NOT rewritten by rename-mc.js, and under what warrant? Warranted dispositions only (pinned + derived + compat — the last per REGISTERED compat window, each with its own expiry). The rewritten set is a COUNT here; full per-occurrence detail is regenerated by --dry-run at fullLedgerPath (not committed).",
    dispositionCounts: { ...built.dispositionCounts },
    compatBySurface: { ...(built.compatBySurface || {}) },
    rowsPersisted,
    fullLedgerPath: FULL_LEDGER_REL,
    rows,
  };
}

// One compact row per line: keeps the committed file small and its diffs line-oriented.
function serializeCommittedLedger(committed) {
  const { rows, ...header } = committed;
  const headerJson = JSON.stringify(header, null, 2); // ends with "\n}"
  const rowsJson = rows.length === 0 ? "[]" : "[\n" + rows.map((r) => "    " + JSON.stringify(r)).join(",\n") + "\n  ]";
  return headerJson.slice(0, -2) + ',\n  "rows": ' + rowsJson + "\n}\n";
}

// ── --dry-run ────────────────────────────────────────────────────────────

function runDryRun({ root = REPO_ROOT } = {}) {
  const partition = loadPartition({ forceReload: true });
  const built = buildLedgerAndPlan({ root, partition });

  const unclassifiedCount = built.unclassified.length;
  const underivedCount = built.underived.length;
  const skillNs = planSkillNamespace({ root, partition });

  const plan = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    trackedFileCount: built.trackedFileCount,
    classCounts: built.classCounts,
    unclassified: unclassifiedCount,
    unclassifiedPaths: built.unclassified.slice(0, 50),
    maxScanBytes: MAX_SCAN_BYTES,
    oversizedUnscanned: built.oversizedUnscanned.length,
    oversizedUnscannedFiles: built.oversizedUnscanned,
    pathRenames: built.pathRenames,
    refusedRenames: built.refusedRenames,
    keptHistoricalPathCount: built.keptHistoricalPaths.length,
    keptHistoricalPaths: built.keptHistoricalPaths,
    categoryCounts: built.categoryCounts,
    dispositionCounts: built.dispositionCounts,
    compatClock: built.treeVersion,
    compatBySurface: built.compatBySurface,
    compatExpired: built.compatExpired.length,
    compatExpiredOccurrences: built.compatExpired.slice(0, 50),
    unpinnedUnrewrittenUnderived: underivedCount,
    underivedOccurrences: built.underived.slice(0, 50),
    // β r3c structural delta (per owned category): categorized lines == pinned + transformed; delta 0 everywhere.
    categoryDelta: built.categoryDelta,
    categoryDeltaProblems: categoryDeltaProblems(built),
    categoryUncomputable: built.categoryUncomputable.length,
    categoryUncomputableLines: built.categoryUncomputable.slice(0, 50),
    categoryUntransformedLines: built.categoryUntransformed.slice(0, 50),
    skillNamespace: skillNs,
    openQuestions: partition.openQuestions,
    occurrenceLedgerPath: COMMITTED_LEDGER_REL,
    fullOccurrenceLedgerPath: FULL_LEDGER_REL,
  };

  const runtimeDir = path.join(root, "runtime", "S-OS-06");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "rename-plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");

  // FULL occurrence data (all three dispositions) -> runtime, regenerated each run, not committed.
  const fullLedgerOut = {
    generatedAt: plan.generatedAt,
    dispositionCounts: built.dispositionCounts,
    rows: built.ledger,
  };
  fs.writeFileSync(path.join(root, ...FULL_LEDGER_REL.split("/")), JSON.stringify(fullLedgerOut) + "\n", "utf8");

  // COMMITTED record-trust ledger -> warranted rows only + the three-disposition count header.
  fs.writeFileSync(
    path.join(root, ...COMMITTED_LEDGER_REL.split("/")),
    serializeCommittedLedger(buildCommittedLedger(built)),
    "utf8"
  );

  console.log(`rename-mc --dry-run: ${built.trackedFileCount} tracked files`);
  console.log(`  class counts: 1(live)=${built.classCounts[1]} 2(gated)=${built.classCounts[2]} 3(historical-in-live)=${built.classCounts[3]} 4(historical)=${built.classCounts[4]}`);
  console.log(`  unclassified=${unclassifiedCount}`);
  console.log(`  oversizedUnscanned=${built.oversizedUnscanned.length} (tracked non-binary files over MAX_SCAN_BYTES=${MAX_SCAN_BYTES})`);
  console.log(`  per-category (rewritten occurrences): ${JSON.stringify(built.categoryCounts)}`);
  // β r3c: the STRUCTURAL per-category delta (lines), every owned category named — a missing category is not a zero.
  const deltaTotal = OCCURRENCE_CATEGORIES.reduce((a, c) => a + ((built.categoryDelta[c] && built.categoryDelta[c].delta) || 0), 0);
  console.log(`  per-category delta (categorized-lines − pinned − transformed): ${describeCategoryDelta(built.categoryDelta)}`);
  console.log(`  categoryDeltaTotal=${deltaTotal} uncomputableCategoryLines=${built.categoryUncomputable.length}`);
  // `derived=` stays LAST on this line (record-trust-exit reads it anchored at end of line).
  console.log(
    `  disposition counts: rewritten=${built.dispositionCounts.rewritten} pinned=${built.dispositionCounts.pinned} compat=${built.dispositionCounts.compat} derived=${built.dispositionCounts.derived}`
  );
  const surfaces = Object.entries(built.compatBySurface).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  console.log(`  compat clock: ${built.treeVersion.reason}`);
  console.log(`  compat by surface: ${surfaces.length ? surfaces.map(([k, v]) => `${k}=${v}`).join("; ") : "(none registered)"}`);
  console.log(`  compatExpired=${built.compatExpired.length}`);
  console.log(`  unpinned-unrewritten-underived=${underivedCount}`);
  const viewMoves = built.pathRenames.filter((r) => r.generatedViewMove).length;
  console.log(`  path renames planned: ${built.pathRenames.length} (${viewMoves} generated-view directory move(s))`);
  console.log(`  refusedRenames=${built.refusedRenames.length}`);
  console.log(`  keptHistoricalPaths=${built.keptHistoricalPaths.length}`);
  const sc = skillNs.counts;
  console.log(
    `  skill-namespace (enumerated warp:/scan:warpos-): pathMoves=${skillNs.pathMoves.length} refusedSkillMoves=${skillNs.refusedMoves.length} ` +
      `tokensRewritable=${sc.tokensRewritable} pathRefsRewritable=${sc.pathRefsRewritable} filesRewritable=${sc.filesRewritable} ` +
      `verbatimTokens=${sc.verbatimTokens} derivedViewTokens=${sc.derivedViewTokens} keptNonClass1Tokens=${sc.keptNonClass1Tokens} ` +
      `hyphenJoined=${sc.hyphenJoined} otherWarpResidual=${sc.otherWarpResidual}`
  );
  if (skillNs.refusedMoves.length > 0) {
    console.error(`rename-mc --dry-run: ${skillNs.refusedMoves.length} refused skill move(s) — --apply-skill-namespace will refuse:`);
    skillNs.refusedMoves.forEach((r) => console.error(`  - ${r.from} -> ${r.to} [${r.reason}]`));
  }
  if (built.refusedRenames.length > 0) {
    // Not a dry-run exit condition (the plan is still written for inspection), but --apply refuses
    // on it and record-trust-exit item 4 asserts refusedRenames == 0.
    console.error(`rename-mc --dry-run: ${built.refusedRenames.length} refused rename(s) — --apply will refuse:`);
    built.refusedRenames.slice(0, 50).forEach((r) => console.error(`  - ${describeRefusal(r)} [${r.reason}]`));
  }

  const oversizedCount = built.oversizedUnscanned.length;
  const compatExpiredCount = built.compatExpired.length;
  const deltaProblems = plan.categoryDeltaProblems;
  const ok = unclassifiedCount === 0 && underivedCount === 0 && oversizedCount === 0 && compatExpiredCount === 0 && deltaProblems.length === 0;
  if (!ok) {
    if (deltaProblems.length > 0) {
      console.error(
        `rename-mc --dry-run FAILED (β r3c structural delta): ${deltaProblems.join("; ")} — every categorized line must be transformed by its category's transform or pinned; the codemod refuses, never skips:`
      );
      built.categoryUncomputable.slice(0, 25).forEach((x) => console.error(`  - uncomputable ${x.file}:${x.line} [category ${x.category}]`));
      built.categoryUntransformed.slice(0, 25).forEach((x) => console.error(`  - untransformed ${x.file}:${x.line} [${x.category}] ${x.text}`));
    }
    if (compatExpiredCount > 0) {
      console.error(
        `rename-mc --dry-run FAILED: ${compatExpiredCount} compat occurrence(s) sit in a window whose expiry the tree version (${built.treeVersion.version === null ? "<unknown>" : built.treeVersion.version}) has reached — remove them or re-register through a warranted amendment:`
      );
      built.compatExpired.slice(0, 50).forEach((o) => console.error(`  - ${o.file}:${o.line} "${o.matchText}" [surface ${o.surface}, expires ${o.expires}]`));
    }
    if (oversizedCount > 0) {
      console.error(`rename-mc --dry-run FAILED: ${oversizedCount} tracked non-binary file(s) exceed MAX_SCAN_BYTES and were NOT scanned:`);
      built.oversizedUnscanned.forEach((o) => console.error(`  - ${describeOversized(o)}`));
    }
    if (unclassifiedCount > 0) {
      console.error(`rename-mc --dry-run FAILED: unclassified paths (showing up to 50):`);
      built.unclassified.slice(0, 50).forEach((p) => console.error(`  - ${p}`));
    }
    if (underivedCount > 0) {
      console.error(`rename-mc --dry-run FAILED: occurrences with no disposition (showing up to 50):`);
      built.underived.slice(0, 50).forEach((o) => console.error(`  - ${o.file}:${o.line} "${o.matchText}"`));
    }
  }

  return { ok, plan, ledger: built.ledger };
}

// ── --apply (implemented; never invoked against the real tree in T1) ───────

function runApply({ root = REPO_ROOT, useGitMv = true } = {}) {
  const partition = loadPartition({ forceReload: true });
  const built = buildLedgerAndPlan({ root, partition });

  if (built.unclassified.length > 0) {
    throw new Error(
      `rename-mc --apply refused: ${built.unclassified.length} unclassified path(s) — fix the partition before applying`
    );
  }
  if (built.oversizedUnscanned.length > 0) {
    throw new Error(
      `rename-mc --apply refused: ${describeOversized(built.oversizedUnscanned[0])}; ` +
        `${built.oversizedUnscanned.length} oversized tracked text file(s) would be skipped unscanned`
    );
  }

  // AC-1.3: refuse if anything write-protected would be touched. Class-3/4 paths are never
  // rename candidates (keptHistoricalPaths), and a generated view moving with a Class-1
  // directory rename is a permitted move (pathRenames) — so what remains in refusedRenames is
  // a GENUINE refusal (a gated/protected source, a generated view renamed on its own, or a
  // target landing on a write-protected path), falsified by F9 and F5.
  if (built.refusedRenames.length > 0) {
    const first = built.refusedRenames[0];
    throw new Error(
      `rename-mc --apply refused: ${describeRefusal(first)}; ` +
        `${built.refusedRenames.length} write-protected path(s) would have been touched`
    );
  }

  // β r3c: refuse BEFORE any rename or write when a categorized line would be left untransformed-and-unpinned
  // (e.g. a raw process.env legacy read) or a line's category has no registered transform. Never skip-and-continue.
  const deltaProblems = categoryDeltaProblems(built);
  if (deltaProblems.length > 0) {
    const first = built.categoryUncomputable[0] || built.categoryUntransformed[0];
    throw new Error(
      `rename-mc --apply refused (β r3c structural delta): ${deltaProblems.join("; ")}` +
        (first ? `; first offender ${first.file}:${first.line} [${first.category}]` : "")
    );
  }

  let renamed = 0;
  for (const { from, to } of built.pathRenames) {
    const absFrom = path.join(root, from);
    const absTo = path.join(root, to);
    if (!fs.existsSync(absFrom)) continue;
    if (fs.existsSync(absTo) && absFrom !== absTo) continue; // never clobber
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    if (useGitMv) {
      const r = spawnSync("git", ["mv", from, to], { cwd: root, encoding: "utf8" });
      if (r.status !== 0) {
        fs.renameSync(absFrom, absTo); // fixture trees (no git mv target) fall back to a plain rename
      }
    } else {
      fs.renameSync(absFrom, absTo);
    }
    renamed += 1;
  }

  // Rewrite content for `rewritten`-disposition occurrences only. Rebuild file-by-file
  // from the ledger so pinned/derived lines are never touched. Every category — env included —
  // is rewritten through its CATEGORY_TRANSFORMS entry (the same table the delta above proved
  // complete); a raw process.env legacy read has no transform, so it refused above instead.
  const rowsByFile = new Map();
  for (const row of built.ledger) {
    if (row.disposition !== "rewritten") continue;
    if (!rowsByFile.has(row.file)) rowsByFile.set(row.file, []);
    rowsByFile.get(row.file).push(row);
  }

  let filesRewritten = 0;
  for (const [file, rows] of rowsByFile) {
    // Resolve through the SAME rename plan so content lands in the post-rename path.
    const renamedEntry = built.pathRenames.find((r) => r.from === file);
    const targetRel = renamedEntry ? renamedEntry.to : file;
    const absTarget = path.join(root, targetRel);
    if (!fs.existsSync(absTarget)) continue;

    const lines = fs.readFileSync(absTarget, "utf8").split(/\r?\n/);
    const ruleByLine = new Map(rows.map((r) => [r.line, r.rule]));
    let changed = false;
    for (const [lineNum, rule] of ruleByLine) {
      const idx = lineNum - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const before = lines[idx];
      const transform = Object.prototype.hasOwnProperty.call(CATEGORY_TRANSFORMS, rule) ? CATEGORY_TRANSFORMS[rule] : null;
      const after = transform ? transform(before) : null;
      if (typeof after !== "string") {
        // Unreachable after the delta refusal above; kept fail-closed so a table/categorizer drift can never skip a line.
        throw new Error(`rename-mc --apply refused: ${file}:${lineNum} [${rule}] has no mechanical transform`);
      }
      if (after !== before) {
        lines[idx] = after;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(absTarget, lines.join("\n"), "utf8");
      filesRewritten += 1;
    }
  }

  return { renamed, filesRewritten, ok: true };
}

// ── --apply-skill-namespace (T3 part 1c) ────────────────────────────────────

function runApplySkillNamespace({ root = REPO_ROOT, useGitMv = true } = {}) {
  const partition = loadPartition({ forceReload: true });
  const tracked = listTrackedFiles(root);
  const oversized = listOversizedUnscanned(root, tracked);
  if (oversized.length > 0) {
    throw new Error(
      `rename-mc --apply-skill-namespace refused: ${describeOversized(oversized[0])}; ` +
        `${oversized.length} oversized tracked text file(s) would be skipped unscanned`
    );
  }
  const plan = planSkillNamespace({ root, partition, trackedFiles: tracked });

  if (plan.refusedMoves.length > 0) {
    const first = plan.refusedMoves[0];
    throw new Error(
      `rename-mc --apply-skill-namespace refused: ${first.from} -> ${first.to} [${first.reason}]; ` +
        `${plan.refusedMoves.length} skill move(s) refused`
    );
  }

  let moved = 0;
  for (const { from, to } of plan.pathMoves) {
    const absFrom = path.join(root, from);
    const absTo = path.join(root, to);
    if (!fs.existsSync(absFrom) || fs.existsSync(absTo)) continue; // never clobber
    fs.mkdirSync(path.dirname(absTo), { recursive: true });
    if (useGitMv) {
      const r = spawnSync("git", ["mv", from, to], { cwd: root, encoding: "utf8" });
      if (r.status !== 0) fs.renameSync(absFrom, absTo); // fixture trees (no git mv target) fall back to a plain rename
    } else {
      fs.renameSync(absFrom, absTo);
    }
    moved += 1;
  }

  // Content: re-derive every line through the SAME decision the plan used; line endings preserved.
  let filesRewritten = 0;
  let tokensRewritten = 0;
  let pathRefsRewritten = 0;
  for (const { file, target } of plan.fileRewrites) {
    const absTarget = path.join(root, target);
    if (!fs.existsSync(absTarget)) continue;
    const content = fs.readFileSync(absTarget, "utf8");
    const hist = target === "CHANGELOG.md" ? historicalChangelogLines(content) : null;
    const parts = content.split(/(\r?\n)/); // even indices = lines, odd = the original line endings
    let changed = false;
    for (let i = 0; i < parts.length; i += 2) {
      const lineText = parts[i];
      const { after, verbatimReason } = skillNamespaceLineDecision(partition, file, target, hist, lineText, i / 2 + 1);
      if (verbatimReason || after === lineText) continue;
      tokensRewritten += countMatches(SKILL_TOKEN_RE, lineText) + countMatches(SCAN_TOKEN_RE, lineText);
      pathRefsRewritten += countMatches(SKILL_PATH_REF_RE, lineText);
      parts[i] = after;
      changed = true;
    }
    if (changed) {
      fs.writeFileSync(absTarget, parts.join(""), "utf8");
      filesRewritten += 1;
    }
  }

  return { moved, filesRewritten, tokensRewritten, pathRefsRewritten, ok: true };
}

// ── CLI ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const wantsApply = args.includes("--apply");
  const wantsSkillNamespace = args.includes("--apply-skill-namespace");
  const modeCount = [wantsApply, args.includes("--dry-run"), wantsSkillNamespace].filter(Boolean).length;
  const wantsDryRun = args.includes("--dry-run") || modeCount === 0;

  if (modeCount > 1) {
    console.error("rename-mc: pass exactly one of --dry-run / --apply / --apply-skill-namespace");
    process.exit(2);
  }

  if (wantsSkillNamespace) {
    const r = runApplySkillNamespace({});
    console.log(
      `rename-mc --apply-skill-namespace: moved=${r.moved} filesRewritten=${r.filesRewritten} tokensRewritten=${r.tokensRewritten} pathRefsRewritten=${r.pathRefsRewritten}`
    );
    process.exit(0);
  }

  if (wantsApply) {
    const result = runApply({});
    console.log(`rename-mc --apply: renamed=${result.renamed} filesRewritten=${result.filesRewritten}`);
    process.exit(0);
  }

  if (wantsDryRun) {
    const { ok } = runDryRun({});
    process.exit(ok ? 0 : 1);
  }
}

module.exports = {
  listTrackedFiles,
  looksBinary,
  scanStatus,
  listOversizedUnscanned,
  MAX_SCAN_BYTES,
  computeChangelogHistoricalLines,
  categorizeOccurrence,
  OCCURRENCE_CATEGORIES,
  CATEGORY_TRANSFORMS,
  genericSlugRewrite,
  computeLineCategoryDecision,
  categoryDeltaProblems,
  describeCategoryDelta,
  renamePath,
  buildLedgerAndPlan,
  buildCommittedLedger,
  serializeCommittedLedger,
  runDryRun,
  runApply,
  SKILL_NAMESPACE_SKILLS,
  rewriteSkillNamespaceTokens,
  rewriteSkillPathRefs,
  skillPathRename,
  residualWarpTokens,
  planSkillNamespace,
  runApplySkillNamespace,
  REPO_ROOT,
  COMMITTED_LEDGER_REL,
  FULL_LEDGER_REL,
};

// main() runs AFTER module.exports is populated: the loader lazily requires this module
// for renamePath, and a CLI run that called main() first would hand it an empty exports.
if (require.main === module) {
  main();
}
