#!/usr/bin/env node
// MC 1.2.0 -> 2.0.0 migration 001 — downstream product LAYOUT: _warpos/ -> _mc/, .warpos/ -> .mc/, WARPOS.md -> MC.md.
//
// S-OS-06 T4 (T-20260913-363). The mc@2.0.0 rebrand renamed the framework's per-product roots. The 2.0.x compat
// window reads BOTH names (scripts/hooks/lib/mc-dirs.js: canonical path first, the legacy twin read IN PLACE, per
// path), so nothing breaks before this runs — this migration is the explicit move the state ceiling reserves for an
// update.
//
// ORDERING FACT (scripts/mc/update.js): migrations run AFTER applyUpdateDecisions has copied the 2.0.0 framework
// files, so a real update usually finds `_mc/` (templates, settings, MANIFEST) and `.mc/transactions/<active tx>`
// ALREADY present beside the legacy roots. So this is an entry-level MERGE — never a refusal, never a clobber:
//   canonical counterpart absent              -> move the legacy entry in (fs.renameSync; a subtree moves intact)
//   both present, both directories            -> recurse
//   both present, identical file bytes        -> drop the legacy copy (lossless)
//   both present, divergent / type mismatch   -> canonical wins. For the framework root (_warpos/) and the per-install
//                                                state root (.warpos/) the legacy copy is MOVED ASIDE, byte-for-byte, to
//                                                .mc/migration-backup/1.2.0-to-2.0.0/<legacy path> (lossless, and the
//                                                legacy root can go: a 1.2.0 _warpos/MANIFEST.json ALWAYS diverges from
//                                                the 2.0.0 one the update just copied). For the product-owned register
//                                                (WARPOS.md vs an existing MC.md) the legacy file is KEPT in place and
//                                                reported — product content is never hidden in a backup dir.
//                                                A backup slot already holding different bytes -> kept in place, reported.
//   a `*.lock` file under .warpos/            -> NEVER moved, NEVER deleted: a 1.2.0 `.warpos/transactions/active.lock`
//                                                is either stale or held by a 1.2.0-era process this migration does not
//                                                own; moved into `.mc/transactions/` it would block every future update
//                                                (scripts/mc/transaction.js reads only `.mc/transactions/active.lock`), and
//                                                the 2.0.0 update's OWN `.mc/transactions/active.lock` is never touched.
//                                                (Under _warpos/ — framework templates — a lock-named file is ordinary
//                                                content and merges like any other file.)
//   a legacy directory left empty             -> removed
// .gitignore: when a line ignores `.warpos/` and none ignores `.mc/`, append `.mc/` (moved per-install state + the
// backup dir stay untracked; the legacy line is kept for the compat window).
// HOME-anchored state (~/.warpos, ~/.codex-warpos) is NOT touched — T3 part 5 reads it in place and never auto-moves.
//
// CLASS-3 DATA: every legacy literal in this file is what the migration operates ON (what it migrates FROM).
// migrations/1.2.0-to-2.0.0/ is a Class-3, write-protected partition entry (the S-OS-06 partition's futureEntries, a
// frozen baseline key, read only via scripts/open-source/partition-loader.js), so no codemod or purity pass may
// rewrite these literals.
//
// Idempotent: a second run over a migrated root moves nothing -> status "noop" (kept-legacy entries are re-reported,
// never re-written). A move failure returns ok:false — the loader halts and update.js rolls back its own file copies;
// entries already moved stay readable at their canonical path and a re-run resumes where this one stopped.
//
// Invoked by update.js via migrations-loader (apply() / plan()) AND runnable as a CLI (main(); --plan = read-only).
"use strict";

const fs = require("fs");
const path = require("path");

const BACKUP_REL = ".mc/migration-backup/1.2.0-to-2.0.0";
const ROOT_PAIRS = [
  { legacy: "_warpos", current: "_mc", onDivergent: "backup", protectLocks: false },
  { legacy: ".warpos", current: ".mc", onDivergent: "backup", protectLocks: true },
  { legacy: "WARPOS.md", current: "MC.md", onDivergent: "keep", protectLocks: false },
];
const LOCK_RE = /\.lock$/i;
const GITIGNORE_REL = ".gitignore";
const LEGACY_IGNORE_LINES = [".warpos/", ".warpos", "/.warpos/", "/.warpos"];
const CURRENT_IGNORE_LINES = [".mc/", ".mc", "/.mc/", "/.mc"];
const GITIGNORE_NOTE = "# mc@2.0.0 migration 1.2.0-to-2.0.0/001: per-install state moved .warpos/ -> .mc/ (keep it untracked)";

function resolveRoot(ctx) {
  return (ctx && ctx.targetRoot) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function containsLock(dirAbs) {
  for (const e of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (containsLock(path.join(dirAbs, e.name))) return true;
    } else if (LOCK_RE.test(e.name)) {
      return true;
    }
  }
  return false;
}

function sameBytes(a, b) {
  if (fs.statSync(a).size !== fs.statSync(b).size) return false;
  return fs.readFileSync(a).equals(fs.readFileSync(b));
}

/**
 * Canonical wins over a divergent legacy entry. -> true when the legacy entry is gone afterwards (backed up), false when
 * it is kept in place.
 */
function resolveDivergent(legacyAbs, canonicalAbs, report, policy, why) {
  const rel = (abs) => path.relative(report.root, abs).split(path.sep).join("/");
  const legacyRel = rel(legacyAbs);
  if (policy.onDivergent !== "backup") {
    report.keptLegacy.push({ path: legacyRel, reason: `${why} ${rel(canonicalAbs)} — canonical wins, legacy copy kept in place (product-owned)` });
    return false;
  }
  const ls = fs.lstatSync(legacyAbs);
  if (policy.protectLocks && ls.isDirectory() && containsLock(legacyAbs)) {
    report.keptLegacy.push({ path: legacyRel, reason: `${why} ${rel(canonicalAbs)} — holds a lock file, kept in place` });
    return false;
  }
  const backupAbs = path.join(report.root, ...BACKUP_REL.split("/"), ...legacyRel.split("/"));
  const bs = lstatOrNull(backupAbs);
  if (bs) {
    if (ls.isFile() && bs.isFile() && sameBytes(legacyAbs, backupAbs)) {
      report.dedupedIdentical.push(legacyRel);
      if (report.apply) fs.unlinkSync(legacyAbs);
      return true;
    }
    report.keptLegacy.push({ path: legacyRel, reason: `${why} ${rel(canonicalAbs)} — backup slot ${rel(backupAbs)} already holds different content, kept in place` });
    return false;
  }
  report.backedUp.push({ from: legacyRel, to: rel(backupAbs), reason: `${why} ${rel(canonicalAbs)} — canonical wins` });
  if (report.apply) {
    fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
    fs.renameSync(legacyAbs, backupAbs);
  }
  return true;
}

/**
 * Merge one legacy entry into its canonical counterpart.
 * -> true when the legacy entry is gone afterwards (moved / dropped / backed up / emptied), false when something is kept.
 */
function mergeEntry(legacyAbs, canonicalAbs, report, policy) {
  const rel = (abs) => path.relative(report.root, abs).split(path.sep).join("/");
  const ls = lstatOrNull(legacyAbs);
  if (!ls) return true;
  const legacyIsDir = ls.isDirectory();

  if (policy.protectLocks && !legacyIsDir && LOCK_RE.test(path.basename(legacyAbs))) {
    report.keptLegacy.push({ path: rel(legacyAbs), reason: "lock file — never moved, never deleted (not owned by this migration)" });
    return false;
  }

  const cs = lstatOrNull(canonicalAbs);
  if (!cs) {
    if (policy.protectLocks && legacyIsDir && containsLock(legacyAbs)) {
      // Move the subtree entry by entry so its lock files stay behind.
      if (report.apply) fs.mkdirSync(canonicalAbs, { recursive: true });
      return mergeChildren(legacyAbs, canonicalAbs, report, policy);
    }
    report.moved.push({ from: rel(legacyAbs), to: rel(canonicalAbs) });
    if (report.apply) {
      fs.mkdirSync(path.dirname(canonicalAbs), { recursive: true });
      fs.renameSync(legacyAbs, canonicalAbs);
    }
    return true;
  }

  if (legacyIsDir && cs.isDirectory()) return mergeChildren(legacyAbs, canonicalAbs, report, policy);

  if (ls.isFile() && cs.isFile()) {
    if (sameBytes(legacyAbs, canonicalAbs)) {
      report.dedupedIdentical.push(rel(legacyAbs));
      if (report.apply) fs.unlinkSync(legacyAbs);
      return true;
    }
    return resolveDivergent(legacyAbs, canonicalAbs, report, policy, "divergent from");
  }

  return resolveDivergent(legacyAbs, canonicalAbs, report, policy, "type conflict with");
}

function mergeChildren(legacyDir, canonicalDir, report, policy) {
  let allGone = true;
  for (const name of fs.readdirSync(legacyDir).sort()) {
    if (!mergeEntry(path.join(legacyDir, name), path.join(canonicalDir, name), report, policy)) allGone = false;
  }
  if (allGone) {
    report.removedEmptyDirs.push(path.relative(report.root, legacyDir).split(path.sep).join("/"));
    if (report.apply) fs.rmdirSync(legacyDir);
  }
  return allGone;
}

function ensureGitignore(root, apply) {
  const file = path.join(root, GITIGNORE_REL);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { status: "noop", reason: ".gitignore not found" };
    throw e;
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (!lines.some((l) => LEGACY_IGNORE_LINES.includes(l))) return { status: "noop", reason: "no .warpos/ ignore line" };
  if (lines.some((l) => CURRENT_IGNORE_LINES.includes(l))) return { status: "noop", reason: ".mc/ already ignored" };
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const sep = text.length === 0 || text.endsWith("\n") ? "" : eol;
  if (apply) fs.writeFileSync(file, `${text}${sep}${GITIGNORE_NOTE}${eol}.mc/${eol}`, "utf8");
  return { status: "added", line: ".mc/" };
}

function run(root, apply) {
  const report = { root, apply, moved: [], dedupedIdentical: [], backedUp: [], keptLegacy: [], removedEmptyDirs: [], gitignore: null };
  try {
    for (const pair of ROOT_PAIRS) {
      const legacyAbs = path.join(root, pair.legacy);
      if (!lstatOrNull(legacyAbs)) continue;
      mergeEntry(legacyAbs, path.join(root, pair.current), report, pair);
    }
    report.gitignore = ensureGitignore(root, apply);
  } catch (e) {
    const { root: _r, apply: _a, ...partial } = report;
    return { ok: false, status: "failed", reason: `${e.code || "error"}: ${e.message}`, ...partial };
  }
  const changes =
    report.moved.length +
    report.dedupedIdentical.length +
    report.backedUp.length +
    report.removedEmptyDirs.length +
    (report.gitignore.status === "added" ? 1 : 0);
  const { root: _r, apply: _a, ...rest } = report;
  return { ok: true, status: changes === 0 ? "noop" : apply ? "migrated" : "planned", ...rest };
}

function toOps(r) {
  if (!r.ok) return [{ op: "error", reason: r.reason }];
  return [
    ...r.moved.map((m) => ({ op: "move", from: m.from, to: m.to })),
    ...r.dedupedIdentical.map((p) => ({ op: "drop-identical-legacy", path: p })),
    ...r.backedUp.map((b) => ({ op: "backup-divergent-legacy", from: b.from, to: b.to, reason: b.reason })),
    ...r.removedEmptyDirs.map((p) => ({ op: "rmdir-empty-legacy", path: p })),
    ...r.keptLegacy.map((k) => ({ op: "keep-legacy", path: k.path, reason: k.reason })),
    ...(r.gitignore && r.gitignore.status === "added" ? [{ op: "gitignore-append", line: r.gitignore.line }] : []),
  ];
}

async function apply(ctx) {
  return run(resolveRoot(ctx), true);
}

async function plan(ctx) {
  return toOps(run(resolveRoot(ctx), false));
}

function main(argv = process.argv.slice(2)) {
  const r = run(resolveRoot(null), !argv.includes("--plan"));
  const n = (a) => (Array.isArray(a) ? a.length : 0);
  console.log(
    `[001] ${r.status}: moved=${n(r.moved)} dedupedIdentical=${n(r.dedupedIdentical)} backedUp=${n(r.backedUp)} ` +
      `keptLegacy=${n(r.keptLegacy)} removedEmptyDirs=${n(r.removedEmptyDirs)} gitignore=${r.gitignore ? r.gitignore.status : "n/a"}`
  );
  for (const b of r.backedUp || []) console.log(`  backed up ${b.from} -> ${b.to}`);
  for (const k of r.keptLegacy || []) console.log(`  kept ${k.path} — ${k.reason}`);
  if (!r.ok) console.error(`[001] ${r.reason}`);
  return r.ok ? 0 : 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  id: "001-warpos-to-mc-layout",
  from: "1.2.0",
  to: "2.0.0",
  description:
    "Merge the legacy per-product roots into the mc@2.0.0 names (_warpos/ -> _mc/, .warpos/ -> .mc/, WARPOS.md -> MC.md): move absent entries, drop identical legacy copies, back up divergent framework/state copies to .mc/migration-backup/ (canonical wins; a divergent WARPOS.md is kept), never move or delete a .warpos/ lock file; keep .mc/ gitignored.",
  BACKUP_REL,
  apply,
  plan,
  main,
};
