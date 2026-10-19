#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const RETENTION_HANDOFF_DAYS = 14;
const HANDOFF_LIVE_KEEP = 10;
const HANDOFF_LIVE_RECENT_DAYS = 3;
const MAX_DELETIONS_PER_RUN = 25;
const HANDOFF_LOAD_DAYS = 7;

if (!(RETENTION_HANDOFF_DAYS > HANDOFF_LOAD_DAYS)) {
  throw new Error(
    `retention.js: invariant violated — RETENTION_HANDOFF_DAYS (${RETENTION_HANDOFF_DAYS}) ` +
      `must be > HANDOFF_LOAD_DAYS (${HANDOFF_LOAD_DAYS}), or session-start could prune a ` +
      `handoff it still intends to load.`,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HANDOFF_LIVE_RE = /^handoff-live-[A-Za-z0-9_-]+\.md$/;

let _archive = null;
try {
  _archive = require("./archive");
} catch {
  _archive = null;
}

function safeResolve(root, absPathCandidate) {
  try {
    const rootAbs = path.resolve(root);
    const resolved = path.resolve(absPathCandidate);
    const rootWithSep = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (resolved !== rootAbs && !resolved.startsWith(rootWithSep)) {
      return null;
    }
    try {
      const real = fs.realpathSync(resolved);
      if (real !== rootAbs && !real.startsWith(rootWithSep)) return null;
    } catch {
    }
    return resolved;
  } catch {
    return null;
  }
}

function isTrustedRoot(rootAbs) {
  try {
    if (!rootAbs || !path.isAbsolute(rootAbs)) return false;
    const st = fs.statSync(rootAbs);
    if (!st.isDirectory()) return false;
    return fs.existsSync(path.join(rootAbs, ".claude"));
  } catch {
    return false;
  }
}

function buildProtectedSet(rootAbs, opts) {
  const set = new Set();
  const add = (p) => {
    const safe = safeResolve(rootAbs, path.isAbsolute(p) ? p : path.join(rootAbs, p));
    if (safe) set.add(safe);
  };
  const explicit = (opts && opts.protected) || [];
  if (Array.isArray(explicit)) {
    for (const p of explicit) {
      if (typeof p === "string" && p) add(p);
    }
  }
  try {
    for (const ref of referencedByActiveSprint(rootAbs)) add(ref);
  } catch {
  }
  return set;
}

function referencedByActiveSprint(rootAbs) {
  const out = [];
  const stateDir = path.join(rootAbs, ".claude", "runtime", "sprint");
  let entries = [];
  try {
    entries = fs.readdirSync(stateDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    let txt;
    try {
      txt = fs.readFileSync(path.join(stateDir, name), "utf8");
    } catch {
      continue;
    }
    const m = txt.match(/handoff-live-[A-Za-z0-9_-]+\.md/g);
    if (m) {
      for (const b of m) out.push(path.join(rootAbs, ".claude", "runtime", b));
    }
  }
  return out;
}

function listHandoffLive(rootAbs) {
  const dir = path.join(rootAbs, ".claude", "runtime");
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const matches = [];
  for (const name of entries) {
    if (!HANDOFF_LIVE_RE.test(name)) continue;
    const full = path.join(dir, name);
    const safe = safeResolve(rootAbs, full);
    if (!safe) continue;
    let st;
    try {
      st = fs.lstatSync(safe);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    matches.push({ path: safe, mtime: st.mtimeMs, shape: "handoff-live" });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches;
}

function eligibleHandoffLive(rootAbs, now, protectedSet) {
  const all = listHandoffLive(rootAbs);
  const recentCutoff = now - HANDOFF_LIVE_RECENT_DAYS * DAY_MS;
  const out = [];
  all.forEach((f, rank) => {
    if (rank < HANDOFF_LIVE_KEEP) return;
    if (f.mtime >= recentCutoff) return;
    if (protectedSet.has(f.path)) return;
    out.push(f);
  });
  return out;
}

function listHandoffsDirOld(rootAbs, now, protectedSet) {
  const dir = path.join(rootAbs, ".claude", "runtime", "handoffs");
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const cutoff = now - RETENTION_HANDOFF_DAYS * DAY_MS;
  const out = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    const safe = safeResolve(rootAbs, full);
    if (!safe) continue;
    if (protectedSet.has(safe)) continue;
    let st;
    try {
      st = fs.lstatSync(safe);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.mtimeMs < cutoff) out.push({ path: safe, mtime: st.mtimeMs, shape: "handoffs-dir" });
  }
  return out;
}

function namedErrLog(rootAbs, protectedSet, namedFiles) {
  const out = [];
  for (const rel of Array.isArray(namedFiles) ? namedFiles : []) {
    if (typeof rel !== "string" || !rel) continue;
    const safe = safeResolve(rootAbs, path.join(rootAbs, rel));
    if (!safe) continue;
    if (protectedSet.has(safe)) continue;
    let st;
    try {
      st = fs.lstatSync(safe);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({ path: safe, mtime: st.mtimeMs, shape: "named-err-log" });
  }
  return out;
}

function roundRobinMerge(classLists) {
  const out = [];
  const lists = classLists.filter((l) => l && l.length);
  let i = 0;
  while (lists.some((l) => i < l.length)) {
    for (const l of lists) {
      if (i < l.length) out.push(l[i]);
    }
    i++;
  }
  return out;
}

function planRetention(root, opts) {
  opts = opts || {};
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  let rootAbs;
  try {
    rootAbs = path.resolve(root);
  } catch {
    return { root: String(root), now, candidates: [], totalCandidates: 0, capped: false };
  }

  const protectedSet = buildProtectedSet(rootAbs, opts);
  const liveEligible = eligibleHandoffLive(rootAbs, now, protectedSet);
  const oldHandoffs = listHandoffsDirOld(rootAbs, now, protectedSet);
  const namedLog = namedErrLog(rootAbs, protectedSet, opts.namedFiles);

  const merged = roundRobinMerge([liveEligible, oldHandoffs, namedLog]);
  const capped = merged.length > MAX_DELETIONS_PER_RUN;
  const bounded = merged.slice(0, MAX_DELETIONS_PER_RUN);

  return {
    root: rootAbs,
    now,
    candidates: bounded,
    totalCandidates: merged.length,
    capped,
    protectedCount: protectedSet.size,
  };
}

function applyRetention(root, opts) {
  opts = opts || {};
  const plan = planRetention(root, opts);
  if (opts.apply !== true) {
    return { ...plan, applied: false, archived: [], skipped: [] };
  }

  if (!isTrustedRoot(plan.root)) {
    return { ...plan, applied: false, refused: true, reason: "untrusted-root", archived: [], skipped: [] };
  }
  if (!_archive) {
    return { ...plan, applied: false, refused: true, reason: "no-archive-tier", archived: [], skipped: [] };
  }

  const lockPath = path.join(plan.root, ".claude", "runtime", "retention.lock");
  let release = null;
  try {
    release = _archive.tryLock(lockPath, { staleMs: 5 * 60 * 1000 });
  } catch {
    release = null;
  }
  if (release === null) {
    return { ...plan, applied: false, reason: "locked", archived: [], skipped: [] };
  }

  const archived = [];
  const skipped = [];
  try {
    let moved = 0;
    for (const c of plan.candidates) {
      if (moved >= MAX_DELETIONS_PER_RUN) {
        skipped.push({ ...c, reason: "per-run-cap" });
        continue;
      }
      const safe = safeResolve(plan.root, c.path);
      if (!safe) {
        skipped.push({ ...c, reason: "escapes-root" });
        continue;
      }
      const res = _archive.archive(safe, {
        root: plan.root,
        reason: "retention:" + (c.shape || "unknown"),
        shape: c.shape || null,
      });
      if (res && res.ok) {
        archived.push({ ...c, archived: res.entry && res.entry.archived, indexed: res.indexed });
        moved++;
      } else {
        skipped.push({ ...c, reason: (res && res.reason) || "archive-failed" });
      }
    }
  } finally {
    if (typeof release === "function") release();
  }

  const indexFailures = archived.filter((a) => a.indexed === false).length;

  try {
    const { logEvent } = require("./logger");
    logEvent(
      "retention",
      "system",
      "retention-applied",
      path.basename(plan.root),
      `archived=${archived.length} skipped=${skipped.length} indexFailures=${indexFailures} totalCandidates=${plan.totalCandidates}`,
      {
        archived: archived.length,
        skipped: skipped.length,
        indexFailures,
        totalCandidates: plan.totalCandidates,
        capped: plan.capped,
        protectedCount: plan.protectedCount,
      },
    );
  } catch {
  }

  return { ...plan, applied: true, archived, skipped, indexFailures };
}

module.exports = {
  RETENTION_HANDOFF_DAYS,
  HANDOFF_LIVE_KEEP,
  HANDOFF_LIVE_RECENT_DAYS,
  MAX_DELETIONS_PER_RUN,
  HANDOFF_LOAD_DAYS,
  HANDOFF_LIVE_RE,
  safeResolve,
  isTrustedRoot,
  buildProtectedSet,
  referencedByActiveSprint,
  planRetention,
  applyRetention,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const rootIdx = args.indexOf("--root");
  const rootArg = rootIdx !== -1 && args[rootIdx + 1] ? args[rootIdx + 1] : null;
  const explicitRoot = rootArg || process.env.CLAUDE_PROJECT_DIR || null;
  if (apply && !explicitRoot) {
    const dry = applyRetention(process.cwd(), { apply: false });
    process.stdout.write(
      JSON.stringify(
        { ...dry, applied: false, refused: true, reason: "apply-needs-explicit-root" },
        null,
        2,
      ) + "\n",
    );
    process.stderr.write(
      "retention: refusing --apply without an explicit --root or CLAUDE_PROJECT_DIR " +
        "(a destructive move must not default to process.cwd()). Showing a dry-run instead.\n",
    );
    process.exit(0);
  }
  const root = explicitRoot || process.cwd();
  const result = applyRetention(root, { apply });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(0);
}
