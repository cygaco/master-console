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
 *               beta r1 classes, scan every Class-1 file for `warpos` occurrences,
 *               assign each occurrence exactly one disposition (rewritten / pinned /
 *               derived), and write:
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
 * Everything here is injectable-root (see run*({ root })) so tests exercise --apply
 * against a disposable temp fixture, never the live tree — the isolation the T1
 * ticket requires ("Do NOT run --apply. Do NOT rename or rewrite any existing tree file.").
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { loadPartition, historicalChangelogLines } = require("./partition-loader");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".bmp", ".webp",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".tgz", ".7z", ".pdf",
  ".mp3", ".mp4", ".mov", ".wav",
  ".pyc", ".node", ".wasm",
]);

const MAX_SCAN_BYTES = 5 * 1024 * 1024; // 5MB — skip larger blobs, they aren't hand-authored source

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

function looksBinary(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_SCAN_BYTES) return true;
    if (stat.size === 0) return false;
    const fd = fs.openSync(absPath, "r");
    const buf = Buffer.alloc(Math.min(8192, stat.size));
    fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.includes(0);
  } catch {
    return true; // unreadable -> treat as opaque, skip content scan
  }
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

// ── occurrence categorization (rewrite-plan bucketing, not disposition) ─────

function categorizeOccurrence(file, lineText) {
  if (file === "framework/paths.registry.json") return "paths-registry";
  if (/process\.env\.WARPOS_[A-Z0-9_]*/i.test(lineText)) return "env";
  if (/\bWARPOS_[A-Z0-9_]+\b/.test(lineText)) return "env";
  if (/\bwarp:[a-zA-Z][\w-]*/.test(lineText)) return "skill-namespace";
  if (/\bscan:warpos-[\w-]*/i.test(lineText)) return "skill-namespace";
  if (/(^|[^a-zA-Z0-9_])(_warpos|\.warpos-backup|\.warpos)(\/|\b)/i.test(lineText)) return "dir";
  if (/\b[a-z][a-zA-Z0-9]*Warpos[a-zA-Z0-9]*\b/.test(lineText)) return "identifier";
  if (/\bWarpos[A-Z][a-zA-Z0-9]*\b/.test(lineText)) return "identifier";
  if (/\b[a-zA-Z0-9]+_warpos_[a-zA-Z0-9]+\b/i.test(lineText)) return "identifier";
  return "prose";
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
  const underived = []; // defensive: occurrences that got NONE of the three dispositions

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
          // R4: a pin binds (file, matchText [, anchor]) — never a line number.
          const pin = partition.findOccurrencePin(relPath, lineText);
          if (pin) {
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

        if (!["rewritten", "pinned", "derived"].includes(disposition)) {
          underived.push({ file: relPath, line: lineNum, matchText });
        }

        ledger.push({ file: relPath, line: lineNum, rule, matchText, disposition, warrant });
      }
    });
  }

  return {
    trackedFileCount: trackedFiles.length,
    classCounts,
    unclassified,
    pathRenames,
    refusedRenames,
    keptHistoricalPaths,
    categoryCounts,
    ledger,
    dispositionCounts: { rewritten: rewrittenCount, pinned: pinnedCount, derived: derivedCount },
    underived,
  };
}

// ── occurrence-ledger split: full (runtime) vs committed (warranted only) ──

const COMMITTED_LEDGER_REL = "scripts/open-source/rename-mc.occurrences.json";
const FULL_LEDGER_REL = "runtime/S-OS-06/rename-occurrences.full.json";
const WARRANTED_DISPOSITIONS = ["pinned", "derived"];

// The committed ledger is the record-trust artifact: every row it persists carries a
// warrant. `rewritten` rows are the codemod PLAN (warrant:null) — they are represented
// here only as a COUNT in dispositionCounts; their row detail lives in FULL_LEDGER_REL.
// No timestamp in the committed form so a re-run over an unchanged tree is a zero diff.
function buildCommittedLedger(built) {
  const rows = built.ledger
    .filter((r) => WARRANTED_DISPOSITIONS.includes(r.disposition))
    .map(({ file, line, rule, matchText, disposition, warrant }) => ({ file, line, rule, matchText, disposition, warrant }));
  const rowsPersisted = { pinned: 0, derived: 0 };
  for (const r of rows) rowsPersisted[r.disposition] += 1;
  return {
    $question:
      "Which `warpos` occurrences in Class-1 files are NOT rewritten by rename-mc.js, and under what warrant? Warranted dispositions only (pinned + derived). The rewritten set is a COUNT here; full per-occurrence detail is regenerated by --dry-run at fullLedgerPath (not committed).",
    dispositionCounts: { ...built.dispositionCounts },
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

  const plan = {
    generatedAt: new Date().toISOString(),
    mode: "dry-run",
    trackedFileCount: built.trackedFileCount,
    classCounts: built.classCounts,
    unclassified: unclassifiedCount,
    unclassifiedPaths: built.unclassified.slice(0, 50),
    pathRenames: built.pathRenames,
    refusedRenames: built.refusedRenames,
    keptHistoricalPathCount: built.keptHistoricalPaths.length,
    keptHistoricalPaths: built.keptHistoricalPaths,
    categoryCounts: built.categoryCounts,
    dispositionCounts: built.dispositionCounts,
    unpinnedUnrewrittenUnderived: underivedCount,
    underivedOccurrences: built.underived.slice(0, 50),
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
  console.log(`  per-category (rewritten occurrences): ${JSON.stringify(built.categoryCounts)}`);
  console.log(`  disposition counts: rewritten=${built.dispositionCounts.rewritten} pinned=${built.dispositionCounts.pinned} derived=${built.dispositionCounts.derived}`);
  console.log(`  unpinned-unrewritten-underived=${underivedCount}`);
  const viewMoves = built.pathRenames.filter((r) => r.generatedViewMove).length;
  console.log(`  path renames planned: ${built.pathRenames.length} (${viewMoves} generated-view directory move(s))`);
  console.log(`  refusedRenames=${built.refusedRenames.length}`);
  console.log(`  keptHistoricalPaths=${built.keptHistoricalPaths.length}`);
  if (built.refusedRenames.length > 0) {
    // Not a dry-run exit condition (the plan is still written for inspection), but --apply refuses
    // on it and record-trust-exit item 4 asserts refusedRenames == 0.
    console.error(`rename-mc --dry-run: ${built.refusedRenames.length} refused rename(s) — --apply will refuse:`);
    built.refusedRenames.slice(0, 50).forEach((r) => console.error(`  - ${describeRefusal(r)} [${r.reason}]`));
  }

  const ok = unclassifiedCount === 0 && underivedCount === 0;
  if (!ok) {
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
  // from the ledger so pinned/derived lines are never touched. `env` category is
  // skipped — its target is a read-both helper CALL that does not exist until T3.
  const rowsByFile = new Map();
  for (const row of built.ledger) {
    if (row.disposition !== "rewritten") continue;
    if (row.rule === "env") continue; // T3 owns the helper-call rewrite
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
    const linesToRewrite = new Set(rows.map((r) => r.line));
    let changed = false;
    for (const lineNum of linesToRewrite) {
      const idx = lineNum - 1;
      if (idx < 0 || idx >= lines.length) continue;
      const before = lines[idx];
      const after = before
        .replace(/WARPOS/g, "MC")
        .replace(/WarpOS/g, "MC")
        .replace(/warpos/g, "mc");
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

// ── CLI ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const wantsApply = args.includes("--apply");
  const wantsDryRun = args.includes("--dry-run") || !wantsApply;

  if (wantsApply && args.includes("--dry-run")) {
    console.error("rename-mc: pass exactly one of --dry-run / --apply");
    process.exit(2);
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
  computeChangelogHistoricalLines,
  categorizeOccurrence,
  renamePath,
  buildLedgerAndPlan,
  buildCommittedLedger,
  serializeCommittedLedger,
  runDryRun,
  runApply,
  REPO_ROOT,
  COMMITTED_LEDGER_REL,
  FULL_LEDGER_REL,
};

// main() runs AFTER module.exports is populated: the loader lazily requires this module
// for renamePath, and a CLI run that called main() first would hand it an empty exports.
if (require.main === module) {
  main();
}
