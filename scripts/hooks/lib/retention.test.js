#!/usr/bin/env node
"use strict";

/**
 * Adversarial ship-gate test for retention.js — conservative-by-construction
 * ARCHIVING (D-1: move-to-archive, never delete) of transient runtime cruft.
 * Uses node's built-in test runner (zero deps) against a throwaway trusted root
 * under os.tmpdir(), with a FIXED `{now}` for determinism.
 *
 * Proves:
 *   1. PLANTED ADVERSARIAL FIXTURE (the ship gate) — every decoy survives; ONLY
 *      exact allowlist shapes are ARCHIVED (moved to the archive tier), and the
 *      moved files are RECOVERABLE there (D-1), not deleted.
 *   2. path-containment — `..`, absolute-outside, escaping symlink are refused.
 *   3. dry-run is the DEFAULT — no `apply:true` archives nothing.
 *   4. per-run cap + self-cap (F-RET-5) bound the blast radius.
 *   5. keep-newest-N AND keep-recent (amendment #4) for handoff-live-*.md.
 *   6. F-RET-2: apply REFUSES an untrusted root (no `.claude/`).
 *   7. F-RET-4: a PROTECTED path (loaded/sprint-referenced) is never archived.
 *   8. F-RET-3: the tightened basename allowlist refuses `handoff-live-..md`.
 *   9. per-class round-robin — a flood of one class does not starve the others.
 *
 *   node --test scripts/hooks/lib/retention.test.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const assert = require("node:assert");

const {
  planRetention,
  applyRetention,
  safeResolve,
  isTrustedRoot,
  HANDOFF_LIVE_KEEP,
  HANDOFF_LIVE_RECENT_DAYS,
  MAX_DELETIONS_PER_RUN,
  RETENTION_HANDOFF_DAYS,
  HANDOFF_LIVE_RE,
} = require("./retention");

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const FIXED_NOW = Date.parse("2026-07-16T12:00:00.000Z");

/** A TRUSTED root: temp dir with a `.claude/runtime` (so isTrustedRoot passes). */
function mkTrustedRoot(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `mc-retention-${label}-`));
  fs.mkdirSync(path.join(root, ".claude", "runtime"), { recursive: true });
  return root;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function touch(file, mtimeMs) {
  fs.writeFileSync(file, "content\n", "utf8");
  const t = mtimeMs / 1000;
  fs.utimesSync(file, t, t);
}

function archivedCount(root) {
  const dir = path.join(root, ".claude", "runtime", "archive");
  try {
    return fs.readdirSync(dir).filter((n) => n !== "index.jsonl").length;
  } catch {
    return 0;
  }
}

// ── 1. PLANTED ADVERSARIAL FIXTURE — the ship gate ──────────────────────────
test("adversarial fixture: only exact allowlist shapes are ARCHIVED (moved, recoverable); every decoy survives", () => {
  const root = mkTrustedRoot("adversarial");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    const handoffsDir = path.join(runtimeDir, "handoffs");
    const namedLogDir = path.join(root, "runtime");
    ensureDir(handoffsDir);
    ensureDir(namedLogDir);

    // Decoy: wrong shape — `.md.bak`, must NOT match the allowlist regex.
    const evilBak = path.join(runtimeDir, "handoff-live-EVIL.md.bak");
    touch(evilBak, FIXED_NOW - 1 * DAY_MS);

    // 10 RECENT newest (minutes old): kept by rank AND recency.
    // 10 OLD (5..14 days): beyond rank-10 AND older than the recency window ⇒ eligible.
    const liveFiles = [];
    for (let i = 1; i <= 10; i++) {
      const name = `handoff-live-new-${String(i).padStart(2, "0")}.md`;
      const full = path.join(runtimeDir, name);
      touch(full, FIXED_NOW - i * MIN_MS); // all < 1h — recent + newest
      liveFiles.push({ name, full, eligible: false });
    }
    for (let i = 1; i <= 10; i++) {
      const name = `handoff-live-old-${String(i).padStart(2, "0")}.md`;
      const full = path.join(runtimeDir, name);
      touch(full, FIXED_NOW - (4 + i) * DAY_MS); // 5..14 days — beyond recency + rank
      liveFiles.push({ name, full, eligible: true });
    }
    const expectedArchivedLive = liveFiles.filter((f) => f.eligible);
    const expectedSurvivingLive = liveFiles.filter((f) => !f.eligible);

    // Decoys that must survive untouched.
    const notesFile = path.join(runtimeDir, "notes.md");
    touch(notesFile, FIXED_NOW - 1 * DAY_MS);
    const traversalNamed = path.join(runtimeDir, "..%2f..%2fpasswd");
    touch(traversalNamed, FIXED_NOW - 1 * DAY_MS);

    // handoffs/ dir: one aged 20d (eligible), one aged 2d (must survive).
    const old20d = path.join(handoffsDir, "old-handoff-20d.md");
    touch(old20d, FIXED_NOW - 20 * DAY_MS);
    const recent2d = path.join(handoffsDir, "recent-handoff-2d.md");
    touch(recent2d, FIXED_NOW - 2 * DAY_MS);

    // Named error log — the one exact-path shape, always eligible if present.
    const namedLog = path.join(namedLogDir, "s-pf-03-security-review.err.log");
    touch(namedLog, FIXED_NOW - 1 * DAY_MS);

    const result = applyRetention(root, { apply: true, now: FIXED_NOW });

    assert.strictEqual(result.applied, true);
    assert.strictEqual(result.capped, false, "12 eligible must not trip the 25 cap");

    // ── every decoy SURVIVES ──
    assert.ok(fs.existsSync(evilBak), "the .bak decoy must survive (wrong shape)");
    assert.ok(fs.existsSync(notesFile), "the unrelated notes.md must survive");
    assert.ok(fs.existsSync(traversalNamed), "the literal traversal-named file must survive");
    assert.ok(fs.existsSync(recent2d), "the 2-day-old handoffs file must survive (under the 14d cutoff)");
    for (const f of expectedSurvivingLive) {
      assert.ok(fs.existsSync(f.full), `${f.name} (recent/newest) must survive`);
    }

    // ── ONLY exact allowlist shapes were archived (moved off their origin) ──
    assert.ok(!fs.existsSync(old20d), "the 20-day-old handoffs file must be moved to archive");
    assert.ok(!fs.existsSync(namedLog), "the named err log must be moved to archive");
    for (const f of expectedArchivedLive) {
      assert.ok(!fs.existsSync(f.full), `${f.name} (old, beyond keep) must be moved to archive`);
    }

    // ── D-1: the moved files are RECOVERABLE in the archive tier ──
    assert.strictEqual(result.archived.length, 12, "err log + 20d handoffs file + 10 old handoff-live");
    assert.strictEqual(archivedCount(root), 12, "all 12 must physically exist in the archive tier (never deleted)");
    for (const a of result.archived) {
      assert.ok(a.archived, "each archived record carries its archive-relative path");
      assert.ok(fs.existsSync(path.join(root, a.archived)), "the archived file exists on disk");
    }

    const archivedPaths = new Set(result.archived.map((d) => d.path));
    assert.ok(archivedPaths.has(path.resolve(namedLog)));
    assert.ok(archivedPaths.has(path.resolve(old20d)));
    for (const f of expectedArchivedLive) {
      assert.ok(archivedPaths.has(path.resolve(f.full)), `${f.name} must be in archived[]`);
    }
    // No survivor ever appears in archived[]
    for (const f of expectedSurvivingLive) {
      assert.ok(!archivedPaths.has(path.resolve(f.full)));
    }
    assert.ok(!archivedPaths.has(path.resolve(evilBak)));
    assert.ok(!archivedPaths.has(path.resolve(recent2d)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 2. path-containment ─────────────────────────────────────────────────────
test("safeResolve refuses `..` traversal and absolute-outside paths", () => {
  const root = mkTrustedRoot("containment");
  try {
    const escapeViaDotDot = path.join(root, "..", "escape");
    assert.strictEqual(safeResolve(root, escapeViaDotDot), null);
    const absoluteOutside = path.resolve(os.tmpdir(), "definitely-outside-root-xyz");
    assert.strictEqual(safeResolve(root, absoluteOutside), null);
    const inside = path.join(root, ".claude", "runtime", "handoff-live-x.md");
    assert.strictEqual(safeResolve(root, inside), path.resolve(inside));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink under runtime whose target escapes root is never archived", (t) => {
  const root = mkTrustedRoot("symlink");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-retention-outside-"));
    const outsideTarget = path.join(outsideDir, "secret.md");
    fs.writeFileSync(outsideTarget, "should never be touched\n", "utf8");

    const symlinkPath = path.join(runtimeDir, "handoff-live-escape.md");
    let symlinkSupported = true;
    try {
      fs.symlinkSync(outsideTarget, symlinkPath, "file");
    } catch {
      symlinkSupported = false;
    }
    if (!symlinkSupported) {
      t.skip("symlink creation not permitted on this platform/user");
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }
    try {
      assert.strictEqual(safeResolve(root, symlinkPath), null);
      const result = applyRetention(root, { apply: true, now: FIXED_NOW });
      assert.ok(fs.existsSync(outsideTarget), "the outside target must survive");
      const archivedPaths = new Set(result.archived.map((d) => d.path));
      assert.ok(!archivedPaths.has(path.resolve(symlinkPath)));
      assert.ok(!archivedPaths.has(path.resolve(outsideTarget)));
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 3. dry-run is the DEFAULT ───────────────────────────────────────────────
test("dry-run (no apply) archives nothing", () => {
  const root = mkTrustedRoot("dryrun");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    const handoffsDir = path.join(runtimeDir, "handoffs");
    ensureDir(handoffsDir);
    for (let i = 1; i <= 15; i++) {
      touch(path.join(handoffsDir, `old-${String(i).padStart(2, "0")}.md`), FIXED_NOW - (20 + i) * DAY_MS);
    }
    const result = applyRetention(root, { now: FIXED_NOW }); // no apply
    assert.strictEqual(result.applied, false);
    assert.strictEqual((result.archived || []).length, 0);
    assert.ok(result.totalCandidates > 0, "sanity: there WERE eligible candidates");
    assert.strictEqual(archivedCount(root), 0, "the archive tier stays empty on a dry-run");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 4. per-run cap + self-cap (F-RET-5) ─────────────────────────────────────
test("per-run cap + self-cap bound the archive count even when far more are eligible", () => {
  const root = mkTrustedRoot("cap");
  try {
    const handoffsDir = path.join(root, ".claude", "runtime", "handoffs");
    ensureDir(handoffsDir);
    const total = 40;
    for (let i = 1; i <= total; i++) {
      touch(path.join(handoffsDir, `old-${String(i).padStart(2, "0")}.md`), FIXED_NOW - (20 + i) * DAY_MS);
    }
    const plan = planRetention(root, { now: FIXED_NOW });
    assert.strictEqual(plan.totalCandidates, total);
    assert.strictEqual(plan.capped, true);
    assert.strictEqual(plan.candidates.length, MAX_DELETIONS_PER_RUN);

    const result = applyRetention(root, { apply: true, now: FIXED_NOW });
    assert.ok(result.archived.length <= MAX_DELETIONS_PER_RUN, "self-cap: never archive more than the per-run cap");
    assert.strictEqual(result.archived.length, MAX_DELETIONS_PER_RUN);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 5. keep-newest-N AND keep-recent (amendment #4) ─────────────────────────
test("keep-newest-N: the newest N handoff-live are never candidates", () => {
  const root = mkTrustedRoot("keep-newest");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    const files = [];
    // Stagger OLD (days) so they are beyond the recency window; rank decides keep.
    for (let i = 1; i <= 20; i++) {
      const name = `handoff-live-${String(i).padStart(2, "0")}.md`;
      const full = path.join(runtimeDir, name);
      touch(full, FIXED_NOW - (21 - i) * DAY_MS - 4 * DAY_MS); // 5..24 days, i=20 newest
      files.push({ name, full, index: i });
    }
    const plan = planRetention(root, { now: FIXED_NOW });
    const candidatePaths = new Set(plan.candidates.map((c) => c.path));
    const newest10 = files.filter((f) => f.index > 10);
    const oldest10 = files.filter((f) => f.index <= 10);
    assert.strictEqual(newest10.length, HANDOFF_LIVE_KEEP);
    for (const f of newest10) {
      assert.ok(!candidatePaths.has(path.resolve(f.full)), `${f.name} (newest N) must not be a candidate`);
    }
    for (const f of oldest10) {
      assert.ok(candidatePaths.has(path.resolve(f.full)), `${f.name} (old, beyond keep) must be a candidate`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("keep-recent (amendment #4): a RECENT handoff-live beyond newest-N is still KEPT", () => {
  const root = mkTrustedRoot("keep-recent");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    // 15 files ALL within the last hour (beyond newest-10 by rank, but recent).
    for (let i = 1; i <= 15; i++) {
      touch(path.join(runtimeDir, `handoff-live-r${String(i).padStart(2, "0")}.md`), FIXED_NOW - i * MIN_MS);
    }
    const plan = planRetention(root, { now: FIXED_NOW });
    const liveCandidates = plan.candidates.filter((c) => c.shape === "handoff-live");
    assert.strictEqual(
      liveCandidates.length,
      0,
      "no recent (< HANDOFF_LIVE_RECENT_DAYS) handoff-live may be a candidate even beyond the newest-N rank",
    );
    assert.ok(HANDOFF_LIVE_RECENT_DAYS >= 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 6. F-RET-2: untrusted root is REFUSED ───────────────────────────────────
test("F-RET-2: apply REFUSES a root without a .claude/ (untrusted)", () => {
  const untrusted = fs.mkdtempSync(path.join(os.tmpdir(), "mc-untrusted-"));
  try {
    ensureDir(path.join(untrusted, "runtime"));
    touch(path.join(untrusted, "runtime", "s-pf-03-security-review.err.log"), FIXED_NOW - 1 * DAY_MS);
    assert.strictEqual(isTrustedRoot(path.resolve(untrusted)), false);
    const result = applyRetention(untrusted, { apply: true, now: FIXED_NOW });
    assert.strictEqual(result.applied, false, "an untrusted root must not apply");
    assert.strictEqual(result.refused, true);
    assert.strictEqual(result.reason, "untrusted-root");
    assert.ok(fs.existsSync(path.join(untrusted, "runtime", "s-pf-03-security-review.err.log")), "nothing moved");
  } finally {
    fs.rmSync(untrusted, { recursive: true, force: true });
  }
});

// ── 7. F-RET-4: a PROTECTED path is never archived ──────────────────────────
test("F-RET-4: a protected handoff-live (loaded/referenced) is never archived even if old + beyond keep", () => {
  const root = mkTrustedRoot("protected");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    // 20 old files (all eligible by rank+age); protect ONE of the oldest.
    const files = [];
    for (let i = 1; i <= 20; i++) {
      const full = path.join(runtimeDir, `handoff-live-${String(i).padStart(2, "0")}.md`);
      touch(full, FIXED_NOW - (21 - i) * DAY_MS - 4 * DAY_MS);
      files.push(full);
    }
    const protectedOne = files[0]; // oldest ⇒ normally eligible
    const planNoProtect = planRetention(root, { now: FIXED_NOW });
    assert.ok(
      new Set(planNoProtect.candidates.map((c) => c.path)).has(path.resolve(protectedOne)),
      "sanity: without protection the file IS a candidate",
    );

    const plan = planRetention(root, { now: FIXED_NOW, protected: [protectedOne] });
    const candidatePaths = new Set(plan.candidates.map((c) => c.path));
    assert.ok(!candidatePaths.has(path.resolve(protectedOne)), "the protected path must be excluded (F-RET-4)");
    assert.ok(plan.protectedCount >= 1);

    // And apply never moves it.
    const result = applyRetention(root, { apply: true, now: FIXED_NOW, protected: [protectedOne] });
    assert.ok(fs.existsSync(protectedOne), "the protected file must remain on its origin");
    const archivedPaths = new Set(result.archived.map((d) => d.path));
    assert.ok(!archivedPaths.has(path.resolve(protectedOne)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 8. F-RET-3: the tightened basename allowlist ────────────────────────────
test("F-RET-3: the regex refuses `handoff-live-..md` and other malformed shapes", () => {
  assert.ok(HANDOFF_LIVE_RE.test("handoff-live-abc123.md"), "a well-formed sid must match");
  assert.ok(HANDOFF_LIVE_RE.test("handoff-live-2026-07-16T12_00.md"), "sid with - and _ matches");
  assert.ok(!HANDOFF_LIVE_RE.test("handoff-live-..md"), "the `..md` traversal-ish shape must NOT match");
  assert.ok(!HANDOFF_LIVE_RE.test("handoff-live-.md"), "a bare dot sid must NOT match");
  assert.ok(!HANDOFF_LIVE_RE.test("handoff-live-a/b.md"), "a path separator must NOT match");
  assert.ok(!HANDOFF_LIVE_RE.test("handoff-live-x.md.bak"), "a .bak suffix must NOT match");

  // End-to-end: a `handoff-live-..md` on disk is never a candidate.
  const root = mkTrustedRoot("regex");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    const evil = path.join(runtimeDir, "handoff-live-..md");
    touch(evil, FIXED_NOW - 30 * DAY_MS); // old enough to be eligible IF it matched
    const plan = planRetention(root, { now: FIXED_NOW });
    const candidatePaths = new Set(plan.candidates.map((c) => c.path));
    assert.ok(!candidatePaths.has(path.resolve(evil)), "`handoff-live-..md` must never be a candidate");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── 9. per-class round-robin — a flood of one class does not starve others ───
test("per-class round-robin: a handoff-live flood does not starve handoffs/* + named-log", () => {
  const root = mkTrustedRoot("round-robin");
  try {
    const runtimeDir = path.join(root, ".claude", "runtime");
    const handoffsDir = path.join(runtimeDir, "handoffs");
    const namedLogDir = path.join(root, "runtime");
    ensureDir(handoffsDir);
    ensureDir(namedLogDir);

    // Flood: 100 OLD eligible handoff-live (beyond keep + recency).
    for (let i = 1; i <= 100; i++) {
      touch(path.join(runtimeDir, `handoff-live-f${String(i).padStart(3, "0")}.md`), FIXED_NOW - (30 + i) * DAY_MS);
    }
    // A few of the other classes.
    const old20d = path.join(handoffsDir, "old-handoff.md");
    touch(old20d, FIXED_NOW - 20 * DAY_MS);
    const namedLog = path.join(namedLogDir, "s-pf-03-security-review.err.log");
    touch(namedLog, FIXED_NOW - 1 * DAY_MS);

    const plan = planRetention(root, { now: FIXED_NOW });
    const shapes = new Set(plan.candidates.map((c) => c.shape));
    assert.ok(plan.capped, "the flood must trip the cap");
    assert.strictEqual(plan.candidates.length, MAX_DELETIONS_PER_RUN);
    // The starved classes MUST appear within the capped slice (the whole point).
    assert.ok(shapes.has("handoffs-dir"), "handoffs/* must not be starved by the handoff-live flood");
    assert.ok(shapes.has("named-err-log"), "the named err log must not be starved");
    assert.ok(shapes.has("handoff-live"), "handoff-live is still represented");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── F-RET-6: the audit event redacts the root (basename only, no absolute path) ─
test("F-RET-6: the retention-applied audit event logs a REDACTED root, never the absolute path", () => {
  const logger = require("./logger");
  const origLogEvent = logger.logEvent;
  const captured = [];
  logger.logEvent = (...args) => captured.push(args); // retention lazy-requires this cached module
  const root = mkTrustedRoot("audit-redact");
  try {
    const namedLogDir = path.join(root, "runtime");
    ensureDir(namedLogDir);
    touch(path.join(namedLogDir, "s-pf-03-security-review.err.log"), FIXED_NOW - 1 * DAY_MS);

    applyRetention(root, { apply: true, now: FIXED_NOW });

    const evt = captured.find((a) => a[2] === "retention-applied");
    assert.ok(evt, "a retention-applied audit event must be emitted on apply");
    const entity = evt[3]; // the 4th logEvent arg (entity)
    assert.strictEqual(entity, path.basename(root), "entity is the basename, not the absolute root");
    const rootAbs = path.resolve(root);
    // The absolute root path must NOT appear anywhere in the audit args/message.
    const flat = JSON.stringify(evt);
    assert.ok(!flat.includes(rootAbs), "the absolute root path must not leak into the audit event");
  } finally {
    logger.logEvent = origLogEvent;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── F-RET-3 (session-start integration): the loose regex is GONE + single-sourced ─
test("F-RET-3: session-start.js uses the shared HANDOFF_LIVE_RE, not the loose `.+` pattern", () => {
  const ssPath = path.join(__dirname, "..", "session-start.js");
  const src = fs.readFileSync(ssPath, "utf8");
  assert.ok(
    !/\/\^handoff-live-\.\+\\\.md\$\//.test(src),
    "the loose /^handoff-live-.+\\.md$/ must no longer appear in session-start.js",
  );
  assert.ok(
    /require\(["']\.\/lib\/retention["']\)/.test(src) && /HANDOFF_LIVE_RE/.test(src),
    "session-start.js imports + uses the canonical HANDOFF_LIVE_RE (single source)",
  );
});

// ── R2-ARCHIVE-INDEX: applyRetention SURFACES index-write failures (indexFailures) ─
test("R2-ARCHIVE-INDEX: applyRetention surfaces indexFailures when the archive index write fails", () => {
  const root = mkTrustedRoot("ret-index-fail");
  try {
    const namedLogDir = path.join(root, "runtime");
    ensureDir(namedLogDir);
    touch(path.join(namedLogDir, "s-pf-03-security-review.err.log"), FIXED_NOW - 1 * DAY_MS);
    const origOpen = fs.openSync;
    fs.openSync = (p, ...rest) => {
      if (String(p).endsWith("index.jsonl")) throw new Error("injected index open failure");
      return origOpen(p, ...rest);
    };
    let result;
    try {
      result = applyRetention(root, { apply: true, now: FIXED_NOW });
    } finally {
      fs.openSync = origOpen;
    }
    assert.strictEqual(result.archived.length, 1, "the file IS archived (data safe)");
    assert.strictEqual(result.indexFailures, 1, "the index failure is surfaced in the result, not swallowed");
    assert.strictEqual(result.archived[0].indexed, false, "per-item index status is exposed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── F-RET-2: the CLI REFUSES --apply without an explicit trusted-root source ─
test("F-RET-2: retention CLI refuses --apply without --root or CLAUDE_PROJECT_DIR (no cwd default)", () => {
  const { execFileSync } = require("node:child_process");
  const cliPath = path.join(__dirname, "retention.js");
  // Run in a cwd that HAS a .claude (so a cwd-default WOULD pass isTrustedRoot) —
  // proving the refusal is about requiring an EXPLICIT source, not about trust.
  const cwdRoot = mkTrustedRoot("ret-cli-cwd");
  try {
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const out = execFileSync(process.execPath, [cliPath, "--apply"], {
      cwd: cwdRoot,
      env,
      encoding: "utf8",
    });
    const res = JSON.parse(out);
    assert.strictEqual(res.applied, false, "apply must be refused without an explicit root source");
    assert.strictEqual(res.refused, true);
    assert.strictEqual(res.reason, "apply-needs-explicit-root");
  } finally {
    fs.rmSync(cwdRoot, { recursive: true, force: true });
  }
});

// ── session-start NEWDEF: the live-state scan uses lstat + an ATOMIC no-follow read ─
test("session-start.js live-state uses lstat(no-follow)+isFile AND an O_NOFOLLOW atomic read (content-injection guard)", () => {
  const ssPath = path.join(__dirname, "..", "session-start.js");
  const src = fs.readFileSync(ssPath, "utf8");
  const anchor = src.indexOf("HANDOFF_LIVE_RE.test(f)");
  const mapRegion = src.slice(anchor, anchor + 900);
  assert.ok(/lstatSync/.test(mapRegion), "the live-state scan must lstat the handoff-live entries (no-follow)");
  assert.ok(/isFile\(\)/.test(mapRegion), "the live-state scan must drop non-regular files (isFile)");
  // The READ that surfaces content must be atomic no-follow (openSync O_NOFOLLOW +
  // read from the fd), closing the lstat→read window a symlink swap could exploit.
  const readRegion = src.slice(anchor, anchor + 3800);
  assert.ok(/O_NOFOLLOW/.test(readRegion), "the surfacing read must open with O_NOFOLLOW");
  assert.ok(/openSync/.test(readRegion) && /O_RDONLY/.test(readRegion), "the surfacing read must openSync (fd-based)");
  assert.ok(
    /readFileSync\(fd/.test(readRegion) || /fstatSync\(fd/.test(readRegion),
    "the surfacing read must read from the OPEN fd (not readFileSync-by-path) so it is atomic with the check",
  );
  // Cross-platform best-effort: Windows O_NOFOLLOW is undefined→0, so the read
  // also inode-rechecks the fd against the enumeration lstat (a swap changes the inode).
  assert.ok(/inodeStable|fst\.ino/.test(readRegion), "the surfacing read must inode-recheck (fstat fd vs lstat)");
  assert.ok(/WINDOWS|Windows/.test(readRegion), "the comment must honestly note the Windows O_NOFOLLOW residual (no overclaim)");
});

// ── Bonus: the load/prune invariant this module encodes at require-time ─────
test("RETENTION_HANDOFF_DAYS stays a strict superset of the session-start load window", () => {
  assert.ok(RETENTION_HANDOFF_DAYS > 7, "must exceed the 7-day session-start load window");
});
