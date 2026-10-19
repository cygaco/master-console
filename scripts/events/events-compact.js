#!/usr/bin/env node
"use strict";
const mcEnv = require("../hooks/lib/mc-env");

/**
 * events-compact.js — the EVENT COMPACTOR.
 *
 * THE CORE SAFETY INVARIANT: raw history is
 * NEVER destroyed. Compaction SUMMARIZES; it does not delete. This module is the
 * runtime side of the kernel contract's never-lose-raw-history rule for the
 * events subsystem, and is data-integrity-critical.
 *
 * THE LOAD-BEARING MECHANISM — whole-file-archive → reseed-a-bounded-tail (NOT
 * slice-archive + hot-log-rewrite). The ONLY destructive rename on the raw
 * events file is `archive.archive(eventsFile)` (S5), which lives INSIDE
 * archive.js (a MOVE into the indexed, restorable archive tier — never a
 * delete). This module's ONLY mutations of the events file are:
 *   • S5  archive.archive(eventsFile)  — the move (rename inside archive.js)
 *   • S9  fs.appendFileSync(eventsFile, summary + tail)  — the additive reseed
 * It NEVER calls fs.unlink / fs.rmSync / fs.truncate / fs.renameSync /
 * fs.writeFileSync on the events file. That makes the "no raw event unlinked"
 * property true BY CONSTRUCTION, verified by a grep/AST test over this
 * very source.
 *
 * NEVER THROWS: every fs call is wrapped; any fault degrades to a clean no-op
 * that CONSERVES (the events file is left in a recoverable state). The one
 * exception is the REQUIRE-TIME invariant below (fail-loud on a misconfigured
 * constant ordering — a load-time guard, not a runtime path).
 *
 * WRITE-AHEAD SEAM SEQUENCE (S0..S10). Each seam is a labelled point; the
 * test-only `crashAfter` hook performs a seam's disk side-effect then returns a
 * CLEAN early { ok:false, reason:"test-crash-injected", crashedAfter } — a
 * return, NOT a throw (composes with the never-throw contract) — so every
 * crash-recovery boundary is falsifiable.
 *
 *   S0  reconcileOrphans(root)         — re-index any on-disk archived generation
 *                                        missing from the index (runs FIRST)
 *   S1  resolve the events file path
 *   S2  read the events file           — missing/empty/unreadable ⇒ no-op
 *   S3  FOLD_TRIGGER gate              — under trigger ⇒ no-op (nothing to fold)
 *   S4  acquire the single-writer lock — held ⇒ no-op reason:"locked"
 *   S5  archive.archive(eventsFile)    — THE destructive move (into archive.js)
 *   S6  evaluate the move             — !ok ⇒ fail-closed no-op (events intact)
 *   S7  indexed:false branch          — reseed + summary(index_pending) + LOUD
 *                                        error + non-zero exit (never silent-green)
 *   S8  build the compaction summary
 *   S9  fs.appendFileSync reseed       — summary record + bounded raw TAIL
 *   S10 release lock + return ok
 *
 * CRASH-RECOVERY CONVERGENCE: after a post-S5 crash
 * the live log is EMPTY (0 < FOLD_TRIGGER) so the NEXT pass is a clean no-op —
 * the old tail is NOT auto-reseeded; it repopulates from new appends and stays
 * queryable via the archive. There is deliberately NO crash-recovery reseed
 * branch.
 */

const fs = require("fs");
const path = require("path");
const archive = require("../hooks/lib/archive");

const TAIL_KEEP_LINES = 2000;
const FOLD_TRIGGER_LINES = 8000;
const OPERATIONAL_CAP = 20000;

if (!(TAIL_KEEP_LINES < FOLD_TRIGGER_LINES && FOLD_TRIGGER_LINES < OPERATIONAL_CAP)) {
  throw new Error(
    `events-compact invariant violated: require TAIL_KEEP_LINES(${TAIL_KEEP_LINES}) < ` +
      `FOLD_TRIGGER_LINES(${FOLD_TRIGGER_LINES}) < OPERATIONAL_CAP(${OPERATIONAL_CAP})`,
  );
}

function eventsFilePath(rootAbs) {
  return path.join(rootAbs, ".claude", "project", "events", "events.jsonl");
}

function compactLockPath(rootAbs) {
  return path.join(rootAbs, ".claude", "runtime", "compact-locks", "events.lock");
}

function relFromRoot(rootAbs, abs) {
  try {
    return path.relative(rootAbs, abs).replace(/\\/g, "/");
  } catch {
    return null;
  }
}

function countLinesSafe(file) {
  try {
    const content = fs.readFileSync(file, "utf8");
    return content.length === 0 ? 0 : content.split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
}

function parseLines(lines) {
  const out = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
    }
  }
  return out;
}

function containedReal(rootAbs, candidate) {
  try {
    const lexical = path.resolve(candidate);
    const sep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (lexical !== rootAbs && !lexical.startsWith(sep)) return null;
    let probe = lexical;
    let real = null;
    for (let i = 0; i < 128; i++) {
      try {
        real = fs.realpathSync(probe);
        break;
      } catch (e) {
        if (e && e.code === "ENOENT") {
          const parent = path.dirname(probe);
          if (parent === probe) return null;
          probe = parent;
          continue;
        }
        return null;
      }
    }
    if (real === null) return null;
    if (real !== rootAbs && !real.startsWith(sep)) return null;
    const suffix = path.relative(probe, lexical);
    if (suffix.startsWith("..")) return null;
    const composed = suffix ? path.join(real, suffix) : real;
    if (composed !== rootAbs && !composed.startsWith(sep)) return null;
    return composed;
  } catch {
    return null;
  }
}

function crashEnabled() {
  return mcEnv.readEnv("COMPACT_ALLOW_CRASH") === "1";
}
function crashReturn(seam, extra) {
  return Object.assign({ ok: false, reason: "test-crash-injected", crashedAfter: seam }, extra || {});
}

let _seq = 0;
function summaryId() {
  const ts = Date.now().toString(36);
  _seq++;
  return `EVT-compact-${ts}-${process.pid}-${_seq}`;
}

function computeSummary(events) {
  const withId = events.filter((e) => e && typeof e.id === "string");
  let idMin = null;
  let idMax = null;
  if (withId.length) {
    idMin = withId[0].id;
    idMax = withId[withId.length - 1].id;
  }
  let tsMin = null;
  let tsMax = null;
  for (const e of events) {
    if (!e || typeof e.ts !== "string") continue;
    if (tsMin === null || e.ts < tsMin) tsMin = e.ts;
    if (tsMax === null || e.ts > tsMax) tsMax = e.ts;
  }
  return {
    event_count: events.length,
    id_range: { min: idMin, max: idMax },
    ts_range: { min: tsMin, max: tsMax },
  };
}

function buildSummaryRecord(data) {
  return {
    id: summaryId(),
    ts: new Date().toISOString(),
    cat: "audit",
    actor: "compactor",
    type: "compaction-summary",
    data,
  };
}

function reseed(eventsFile, summaryRecord, tailLines, partial) {
  try {
    const summaryLine = JSON.stringify(summaryRecord) + "\n";
    const tailBlock = tailLines.length ? tailLines.join("\n") + "\n" : "";
    let payload = summaryLine + tailBlock;
    if (partial) {
      payload = payload.slice(0, Math.max(1, Math.floor(payload.length / 2)));
    }
    fs.appendFileSync(eventsFile, payload, "utf8");
    return true;
  } catch {
    return false;
  }
}

function reconcileOrphans(rootAbs, opts) {
  const applyReconcile = !opts || opts.apply !== false;
  try {
    rootAbs = path.resolve(rootAbs);
    const dir = containedReal(rootAbs, archive.archiveDir(rootAbs));
    if (!dir) return { reconciled: 0 };
    const idxPath = archive.archiveIndexPath(rootAbs);
    try {
      const ist = fs.lstatSync(idxPath);
      if (ist.isSymbolicLink() || !containedReal(rootAbs, idxPath)) return { reconciled: 0 };
    } catch {
    }
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return { reconciled: 0 };
    }
    const indexedReal = new Set();
    for (const e of archive.readIndex(rootAbs)) {
      if (!e || typeof e.archived !== "string") continue;
      const abs = containedReal(rootAbs, path.resolve(rootAbs, e.archived));
      if (abs && path.dirname(abs) === dir) indexedReal.add(abs);
    }
    let count = 0;
    for (const name of entries) {
      if (name === archive.INDEX_BASENAME) continue;
      if (name.endsWith(".lock")) continue;
      const full = path.join(dir, name);
      const fullReal = containedReal(rootAbs, full);
      if (fullReal && indexedReal.has(fullReal)) continue;
      let st;
      try {
        st = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (!applyReconcile) {
        count++;
        continue;
      }
      const rel = relFromRoot(rootAbs, full);
      const entry = {
        ts: new Date().toISOString(),
        origin: null,
        archived: rel,
        shape: "reconcile",
        reason: "reconcile:orphan",
        bytes: typeof st.size === "number" ? st.size : null,
        lines: countLinesSafe(full),
        reconciled: true,
      };
      if (archive.appendIndex(rootAbs, entry)) count++;
    }
    return { reconciled: count };
  } catch {
    return { reconciled: 0 };
  }
}

function compactOnce(rootAbs, opts) {
  opts = opts || {};
  const apply = opts.apply !== false;
  const crashAfter = crashEnabled() ? opts.crashAfter || null : null;

  try {
    rootAbs = path.resolve(rootAbs);
  } catch {
    return { ok: false, reason: "bad-root", exitCode: 1 };
  }

  let reconciled = 0;
  try {
    reconciled = reconcileOrphans(rootAbs, { apply }).reconciled || 0;
  } catch {
    reconciled = 0;
  }
  if (crashAfter === "S0") return crashReturn("S0", { reconciled });

  const eventsFile = eventsFilePath(rootAbs);
  if (crashAfter === "S1") return crashReturn("S1");

  let content;
  try {
    content = fs.readFileSync(eventsFile, "utf8");
  } catch {
    return { ok: true, reason: "no-events-file", compacted: false, reconciled, exitCode: 0 };
  }
  const lines = content.length ? content.split("\n").filter(Boolean) : [];
  if (crashAfter === "S2") return crashReturn("S2");

  if (lines.length < FOLD_TRIGGER_LINES) {
    return {
      ok: true,
      reason: "below-fold-trigger",
      compacted: false,
      lineCount: lines.length,
      reconciled,
      exitCode: 0,
    };
  }
  if (crashAfter === "S3") return crashReturn("S3");

  if (!apply) {
    return {
      ok: true,
      reason: "dry-run",
      compacted: false,
      wouldCompact: true,
      lineCount: lines.length,
      reconciled,
      summary: computeSummary(parseLines(lines)),
      exitCode: 0,
    };
  }

  const lockPath = compactLockPath(rootAbs);
  let release = null;
  try {
    release = archive.tryLock(lockPath);
  } catch {
    release = null;
  }
  if (release === null) {
    return { ok: true, reason: "locked", compacted: false, reconciled, exitCode: 0 };
  }
  if (crashAfter === "S4") {
    try {
      release();
    } catch {
    }
    return crashReturn("S4");
  }

  try {
    try {
      const c2 = fs.readFileSync(eventsFile, "utf8");
      const l2 = c2.length ? c2.split("\n").filter(Boolean) : [];
      if (l2.length < FOLD_TRIGGER_LINES) {
        return {
          ok: true,
          reason: "resolved-under-lock",
          compacted: false,
          lineCount: l2.length,
          reconciled,
          exitCode: 0,
        };
      }
    } catch {
      return { ok: true, reason: "no-events-file", compacted: false, reconciled, exitCode: 0 };
    }

    let ares;
    try {
      ares = archive.archive(eventsFile, {
        root: rootAbs,
        reason: "compaction:fold",
        shape: "operational",
      });
    } catch {
      ares = { ok: false, reason: "archive-threw" };
    }
    if (crashAfter === "S5") return crashReturn("S5", { archived: ares && ares.archived });

    if (!ares || !ares.ok) {
      return {
        ok: false,
        reason: "archive-failed",
        detail: (ares && ares.reason) || null,
        compacted: false,
        reconciled,
        exitCode: 1,
      };
    }
    if (crashAfter === "S6") return crashReturn("S6", { archived: ares.archived });

    const archivedRef =
      (ares.entry && typeof ares.entry.archived === "string" && ares.entry.archived) ||
      relFromRoot(rootAbs, ares.archived);

    let archivedLines;
    try {
      const ac = fs.readFileSync(ares.archived, "utf8");
      archivedLines = ac.length ? ac.split("\n").filter(Boolean) : [];
    } catch {
      try {
        // eslint-disable-next-line no-console
        console.error(
          `[events-compact] ARCHIVED COPY UNREADABLE at ${ares.archived} after S5 — cannot build an ` +
            `accurate summary/tail. Raw is SAFE + indexed (recoverable via 'events:query --archive'); ` +
            `skipping the live reseed rather than reseeding stale bytes. FAIL-CLOSED (non-zero exit).`,
        );
      } catch {
      }
      return {
        ok: false,
        reason: "archived-copy-unreadable",
        compacted: true,
        indexed: ares.indexed !== false,
        archived: ares.archived,
        reconciled,
        exitCode: 1,
      };
    }
    const summaryData = computeSummary(parseLines(archivedLines));
    const tailLines = archivedLines.slice(Math.max(0, archivedLines.length - TAIL_KEEP_LINES));

    if (ares.indexed === false) {
      const summary = buildSummaryRecord(
        Object.assign({}, summaryData, { archived_generation_ref: null, index_pending: true }),
      );
      const reseeded = reseed(eventsFile, summary, tailLines, crashAfter === "S9-partial");
      try {
        // eslint-disable-next-line no-console
        console.error(
          reseeded
            ? `[events-compact] ARCHIVE INDEXED:FALSE — generation on disk but UNINDEXED at ` +
                `${ares.archived}. Summary flagged index_pending; reconcileOrphans re-indexes next ` +
                `pass. FAIL-CLOSED (non-zero exit).`
            :
              `[events-compact] ARCHIVE INDEXED:FALSE **AND** RESEED FAILED — generation on disk but ` +
                `UNINDEXED at ${ares.archived}, and the live summary/tail could NOT be written. Raw is ` +
                `SAFE in the archive (recoverable via 'events:query --archive'); reconcileOrphans ` +
                `re-indexes next pass. FAIL-CLOSED (non-zero exit).`,
        );
      } catch {
      }
      if (crashAfter === "S7") return crashReturn("S7", { archived: ares.archived });
      return {
        ok: false,
        reason: reseeded ? "index-pending" : "index-pending-and-reseed-failed",
        compacted: true,
        indexed: false,
        reseeded,
        archived: ares.archived,
        summary_id: reseeded ? summary.id : null,
        reconciled,
        exitCode: 1,
      };
    }

    const summary = buildSummaryRecord(
      Object.assign({}, summaryData, { archived_generation_ref: archivedRef }),
    );
    if (crashAfter === "S8") return crashReturn("S8", { archived: ares.archived });

    const partial = crashAfter === "S9-partial";
    const reseeded = reseed(eventsFile, summary, tailLines, partial);
    if (partial) return crashReturn("S9-partial", { archived: ares.archived });
    if (crashAfter === "S9") return crashReturn("S9", { archived: ares.archived });

    if (!reseeded) {
      try {
        // eslint-disable-next-line no-console
        console.error(
          `[events-compact] RESEED FAILED after S5 archive — raw is SAFE in the archived ` +
            `generation ${ares.archived} (recoverable via 'events:query --archive') but the live ` +
            `tail could not be reseeded. FAIL-CLOSED (non-zero exit).`,
        );
      } catch {
      }
      return {
        ok: false,
        reason: "reseed-failed",
        compacted: true,
        indexed: true,
        reseeded: false,
        archived: ares.archived,
        archived_generation_ref: archivedRef,
        summary_id: summary.id,
        reconciled,
        exitCode: 1,
      };
    }

    return {
      ok: true,
      reason: "compacted",
      compacted: true,
      indexed: true,
      archived: ares.archived,
      archived_generation_ref: archivedRef,
      summary_id: summary.id,
      tail_lines: tailLines.length,
      event_count: summaryData.event_count,
      reconciled,
      exitCode: 0,
    };
  } finally {
    if (typeof release === "function") {
      try {
        release();
      } catch {
      }
    }
  }
}

module.exports = {
  TAIL_KEEP_LINES,
  FOLD_TRIGGER_LINES,
  OPERATIONAL_CAP,
  eventsFilePath,
  compactLockPath,
  parseLines,
  containedReal,
  computeSummary,
  buildSummaryRecord,
  reconcileOrphans,
  compactOnce,
};

if (require.main === module) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const res = compactOnce(root, { apply: true });
  try {
    // eslint-disable-next-line no-console
    process.stdout.write(JSON.stringify(res) + "\n");
  } catch {
  }
  process.exit(res && typeof res.exitCode === "number" ? res.exitCode : 0);
}
